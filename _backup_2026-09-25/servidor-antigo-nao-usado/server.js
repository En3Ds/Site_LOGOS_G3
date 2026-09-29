const path = require("path");
const express = require("express");
const admin = require("firebase-admin");

// Só precisa do project id pra verificar token (não precisa de service account secreto).
admin.initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID || "login-site-74597" });

const app = express();
app.use(express.json({ limit: "15mb" })); // comprovante em base64 pode ser alguns MB

// site institucional, sem mudança nenhuma
app.use(express.static(__dirname, { extensions: ["html"] }));

// secao /caixa (controle de caixa) — arquivos estáticos; quem protege os dados de
// verdade é a checagem de login em cada rota /api abaixo, não o acesso ao HTML em si.
app.use("/caixa", express.static(path.join(__dirname, "caixa"), { extensions: ["html"] }));

// ---- Autenticação: confere o token do Firebase mandado pelo navegador ----
async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: "sem token" });
  try {
    req.user = await admin.auth().verifyIdToken(token);
    next();
  } catch (err) {
    res.status(401).json({ error: "token inválido: " + err.message });
  }
}

// ---- Turso: token e URL guardados como variável de ambiente no Render, nunca em
// arquivo/no navegador. ----
const TURSO_URL = process.env.TURSO_URL;
const TURSO_TOKEN = process.env.TURSO_TOKEN;

function tursoArg(v) {
  if (v === null || v === undefined) return { type: "null" };
  if (typeof v === "number") {
    return Number.isInteger(v) ? { type: "integer", value: String(v) } : { type: "float", value: v };
  }
  return { type: "text", value: String(v) };
}
async function tursoExec(sql, args) {
  const res = await fetch(TURSO_URL, {
    method: "POST",
    headers: { Authorization: "Bearer " + TURSO_TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify({
      requests: [
        { type: "execute", stmt: { sql, args: (args || []).map(tursoArg) } },
        { type: "close" },
      ],
    }),
  });
  const dados = await res.json();
  const resultado = dados.results[0];
  if (resultado.type === "error") throw new Error(resultado.error.message);
  const linha = resultado.response.result;
  const cols = linha.cols.map((c) => c.name);
  return linha.rows.map((row) => {
    const obj = {};
    row.forEach((cel, i) => { obj[cols[i]] = cel.type === "null" ? null : cel.value; });
    return obj;
  });
}
function tursoTry(sql) { return tursoExec(sql, []).catch(() => {}); }

// atalho pra rota async: joga erro pra fora como resposta JSON em vez de precisar
// repetir try/catch em cada rota.
function h(fn) {
  return (req, res) => fn(req, res).catch((err) => res.status(err.status || 500).json({ error: err.message }));
}
class ErroHttp extends Error {
  constructor(status, mensagem) { super(mensagem); this.status = status; }
}

const api = express.Router();
api.use(requireAuth);

// ---- Despesas (caixa da empresa) ----
async function ensureDespesas() {
  await tursoExec("CREATE TABLE IF NOT EXISTS despesas (id INTEGER PRIMARY KEY AUTOINCREMENT, descricao TEXT, valor REAL, vencimento TEXT)");
  await tursoTry("ALTER TABLE despesas ADD COLUMN comprovante TEXT");
  await tursoTry("ALTER TABLE despesas ADD COLUMN comprovante_nome TEXT");
}
api.get("/despesas", h(async (req, res) => {
  await ensureDespesas();
  res.json(await tursoExec("SELECT * FROM despesas ORDER BY vencimento"));
}));
api.post("/despesas", h(async (req, res) => {
  await ensureDespesas();
  const b = req.body;
  await tursoExec(
    "INSERT INTO despesas (descricao, valor, vencimento, comprovante, comprovante_nome) VALUES (?, ?, ?, ?, ?)",
    [b.descricao, b.valor, b.vencimento, b.comprovante || null, b.comprovante_nome || null]
  );
  res.json({ ok: true });
}));
api.post("/despesas/bulk", h(async (req, res) => {
  await ensureDespesas();
  const linhas = (req.body && req.body.rows) || [];
  for (const d of linhas) {
    await tursoExec("INSERT INTO despesas (descricao, valor, vencimento) VALUES (?, ?, ?)", [d.descricao, d.valor, d.vencimento]);
  }
  res.json({ importadas: linhas.length });
}));
api.put("/despesas/:id", h(async (req, res) => {
  const id = Number(req.params.id);
  const b = req.body;
  if (b.comprovante) {
    await tursoExec(
      "UPDATE despesas SET descricao=?, valor=?, vencimento=?, comprovante=?, comprovante_nome=? WHERE id=?",
      [b.descricao, b.valor, b.vencimento, b.comprovante, b.comprovante_nome || null, id]
    );
  } else {
    await tursoExec("UPDATE despesas SET descricao=?, valor=?, vencimento=? WHERE id=?", [b.descricao, b.valor, b.vencimento, id]);
  }
  res.json({ ok: true });
}));
api.delete("/despesas/:id", h(async (req, res) => {
  await tursoExec("DELETE FROM despesas WHERE id=?", [Number(req.params.id)]);
  res.json({ ok: true });
}));

// ---- Despesas pessoais (Glerton / Claudio) ----
async function ensurePessoais() {
  await tursoExec(
    "CREATE TABLE IF NOT EXISTS despesas_pessoais (id INTEGER PRIMARY KEY AUTOINCREMENT, pessoa TEXT, item TEXT, valor REAL, forma_pagamento TEXT, parcelado TEXT, quantidade TEXT, data_compra TEXT, vencimento TEXT)"
  );
}
api.get("/despesas-pessoais", h(async (req, res) => {
  await ensurePessoais();
  const pessoa = req.query.pessoa;
  if (pessoa) return res.json(await tursoExec("SELECT * FROM despesas_pessoais WHERE pessoa = ? ORDER BY vencimento", [pessoa]));
  res.json(await tursoExec("SELECT * FROM despesas_pessoais ORDER BY pessoa, item, valor, data_compra"));
}));
api.post("/despesas-pessoais", h(async (req, res) => {
  await ensurePessoais();
  const d = req.body;
  await tursoExec(
    "INSERT INTO despesas_pessoais (pessoa, item, valor, forma_pagamento, parcelado, quantidade, data_compra, vencimento) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [d.pessoa, d.item, d.valor, d.forma_pagamento || null, d.parcelado || null, d.quantidade || null, d.data_compra || null, d.vencimento || null]
  );
  res.json({ ok: true });
}));
api.post("/despesas-pessoais/bulk", h(async (req, res) => {
  await ensurePessoais();
  const linhas = (req.body && req.body.rows) || [];
  for (const d of linhas) {
    await tursoExec(
      "INSERT INTO despesas_pessoais (pessoa, item, valor, forma_pagamento, parcelado, quantidade, data_compra, vencimento) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [d.pessoa, d.item, d.valor, d.forma_pagamento, d.parcelado, d.quantidade, d.data_compra, d.vencimento]
    );
  }
  res.json({ importadas: linhas.length });
}));
api.put("/despesas-pessoais/:id", h(async (req, res) => {
  const id = Number(req.params.id);
  const b = req.body;
  await tursoExec(
    "UPDATE despesas_pessoais SET item=?, valor=?, forma_pagamento=?, parcelado=?, data_compra=?, vencimento=? WHERE id=?",
    [b.item, b.valor, b.forma_pagamento || null, b.parcelado || null, b.data_compra || null, b.vencimento || null, id]
  );
  res.json({ ok: true });
}));
api.delete("/despesas-pessoais/:id", h(async (req, res) => {
  await tursoExec("DELETE FROM despesas_pessoais WHERE id=?", [Number(req.params.id)]);
  res.json({ ok: true });
}));

// ---- Lista de compras ----
async function ensureCompras() {
  await tursoExec("CREATE TABLE IF NOT EXISTS compras (id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT, marcado INTEGER DEFAULT 0)");
}
const ITENS_PADRAO = [
  "Papel Sulfite 500 Und.", "Papel Higiênico", "Papel Interfolha", "Sabonete Liquido",
  "Pasta Suspensa Amarela", "Pasta L", "Clips", "Grampos", "Caneta", "Tinta de Impressora",
  "Copo descartavel (200 ml)", "Limpador Multiuso - VEJA",
  "Refil de Tinta Preta de Impressora L3250 - T544 ECOTANK",
];
api.get("/compras", h(async (req, res) => {
  await ensureCompras();
  const contagem = await tursoExec("SELECT COUNT(*) as n FROM compras");
  if (Number(contagem[0].n) === 0) {
    for (const nome of ITENS_PADRAO) {
      await tursoExec("INSERT INTO compras (nome, marcado) VALUES (?, 0)", [nome]);
    }
  }
  res.json(await tursoExec("SELECT * FROM compras ORDER BY id"));
}));
api.post("/compras", h(async (req, res) => {
  await ensureCompras();
  await tursoExec("INSERT INTO compras (nome, marcado) VALUES (?, 1)", [req.body.nome]);
  res.json({ ok: true });
}));
api.put("/compras/:id", h(async (req, res) => {
  await tursoExec("UPDATE compras SET marcado=? WHERE id=?", [req.body.marcado ? 1 : 0, Number(req.params.id)]);
  res.json({ ok: true });
}));
api.delete("/compras/:id", h(async (req, res) => {
  await tursoExec("DELETE FROM compras WHERE id=?", [Number(req.params.id)]);
  res.json({ ok: true });
}));

// ---- Notas (observações livres) ----
async function ensureNotas() {
  await tursoExec("CREATE TABLE IF NOT EXISTS notas (id INTEGER PRIMARY KEY, texto TEXT)");
}
api.get("/notas/:id", h(async (req, res) => {
  await ensureNotas();
  const linhas = await tursoExec("SELECT texto FROM notas WHERE id=?", [Number(req.params.id)]);
  res.json({ texto: (linhas[0] && linhas[0].texto) || "" });
}));
api.put("/notas/:id", h(async (req, res) => {
  await ensureNotas();
  await tursoExec(
    "INSERT INTO notas (id, texto) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET texto = excluded.texto",
    [Number(req.params.id), req.body.texto]
  );
  res.json({ ok: true });
}));

app.use("/api", api);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`rodando na porta ${PORT}`));
