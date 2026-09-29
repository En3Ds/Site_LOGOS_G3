// Cloudflare Worker — responde só /api/* (rota configurada em wrangler.toml).
// Tudo mais (o site, o /caixa/*.html) continua sendo servido estático pelo Render,
// sem passar por aqui. Esse Worker é o único lugar que conhece o token do Turso
// (variável de ambiente/secret do Cloudflare) e só fala com o banco depois de
// conferir que quem pediu tem um login válido do Firebase.

import { verifyFirebaseToken } from "./lib/verify-firebase-token.js";

class ErroHttp extends Error {
  constructor(status, mensagem) {
    super(mensagem);
    this.status = status;
  }
}

function json(dados, status) {
  return new Response(JSON.stringify(dados), {
    status: status || 200,
    headers: { "Content-Type": "application/json" },
  });
}

// ---- Turso ----
function tursoArg(v) {
  if (v === null || v === undefined) return { type: "null" };
  if (typeof v === "number") {
    return Number.isInteger(v) ? { type: "integer", value: String(v) } : { type: "float", value: v };
  }
  return { type: "text", value: String(v) };
}
async function tursoExec(sql, args, env) {
  const res = await fetch(env.TURSO_URL, {
    method: "POST",
    headers: { Authorization: "Bearer " + env.TURSO_TOKEN, "Content-Type": "application/json" },
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
function tursoTry(sql, env) {
  return tursoExec(sql, [], env).catch(() => {});
}
// Várias instruções num só POST ao Turso — usado no import em massa pra não estourar
// o limite de subrequests do plano free do Workers (1 fetch por lote, não por linha).
async function tursoBatch(statements, env) {
  const requests = statements.map((s) => ({
    type: "execute",
    stmt: { sql: s.sql, args: (s.args || []).map(tursoArg) },
  }));
  requests.push({ type: "close" });
  const res = await fetch(env.TURSO_URL, {
    method: "POST",
    headers: { Authorization: "Bearer " + env.TURSO_TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify({ requests }),
  });
  const dados = await res.json();
  for (const r of dados.results) {
    if (r.type === "error") throw new Error(r.error.message);
  }
}
function chunk(arr, n) {
  const grupos = [];
  for (let i = 0; i < arr.length; i += n) grupos.push(arr.slice(i, i + n));
  return grupos;
}

// ---- Autenticação ----
async function exigirLogin(request, env) {
  const authHeader = request.headers.get("Authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) throw new ErroHttp(401, "sem token");
  try {
    return await verifyFirebaseToken(token, env.FIREBASE_PROJECT_ID);
  } catch (err) {
    throw new ErroHttp(401, "token inválido: " + err.message);
  }
}

// ---- Despesas ----
async function ensureDespesas(env) {
  await tursoExec(
    "CREATE TABLE IF NOT EXISTS despesas (id INTEGER PRIMARY KEY AUTOINCREMENT, descricao TEXT, valor REAL, vencimento TEXT)",
    [], env
  );
  await tursoTry("ALTER TABLE despesas ADD COLUMN comprovante TEXT", env);
  await tursoTry("ALTER TABLE despesas ADD COLUMN comprovante_nome TEXT", env);
}
async function rotaDespesas(method, id, body, env) {
  await ensureDespesas(env);
  if (method === "GET") return await tursoExec("SELECT * FROM despesas ORDER BY vencimento", [], env);
  if (method === "POST") {
    await tursoExec(
      "INSERT INTO despesas (descricao, valor, vencimento, comprovante, comprovante_nome) VALUES (?, ?, ?, ?, ?)",
      [body.descricao, body.valor, body.vencimento, body.comprovante || null, body.comprovante_nome || null], env
    );
    return { ok: true };
  }
  if (method === "PUT") {
    if (!id) throw new ErroHttp(400, "id obrigatório");
    if (body.comprovante) {
      await tursoExec(
        "UPDATE despesas SET descricao=?, valor=?, vencimento=?, comprovante=?, comprovante_nome=? WHERE id=?",
        [body.descricao, body.valor, body.vencimento, body.comprovante, body.comprovante_nome || null, id], env
      );
    } else {
      await tursoExec("UPDATE despesas SET descricao=?, valor=?, vencimento=? WHERE id=?",
        [body.descricao, body.valor, body.vencimento, id], env);
    }
    return { ok: true };
  }
  if (method === "DELETE") {
    if (!id) throw new ErroHttp(400, "id obrigatório");
    await tursoExec("DELETE FROM despesas WHERE id=?", [id], env);
    return { ok: true };
  }
  throw new ErroHttp(405, "método não suportado");
}
async function bulkDespesas(body, env) {
  await ensureDespesas(env);
  const linhas = (body && body.rows) || [];
  for (const grupo of chunk(linhas, 50)) {
    await tursoBatch(
      grupo.map((d) => ({
        sql: "INSERT INTO despesas (descricao, valor, vencimento) VALUES (?, ?, ?)",
        args: [d.descricao, d.valor, d.vencimento],
      })),
      env
    );
  }
  return { importadas: linhas.length };
}

// ---- Despesas pessoais ----
async function ensurePessoais(env) {
  await tursoExec(
    "CREATE TABLE IF NOT EXISTS despesas_pessoais (id INTEGER PRIMARY KEY AUTOINCREMENT, pessoa TEXT, item TEXT, valor REAL, forma_pagamento TEXT, parcelado TEXT, quantidade TEXT, data_compra TEXT, vencimento TEXT)",
    [], env
  );
}
async function rotaPessoais(method, id, body, url, env) {
  await ensurePessoais(env);
  if (method === "GET") {
    const pessoa = url.searchParams.get("pessoa");
    if (pessoa) return await tursoExec("SELECT * FROM despesas_pessoais WHERE pessoa = ? ORDER BY vencimento", [pessoa], env);
    return await tursoExec("SELECT * FROM despesas_pessoais ORDER BY pessoa, item, valor, data_compra", [], env);
  }
  if (method === "POST") {
    const d = body;
    await tursoExec(
      "INSERT INTO despesas_pessoais (pessoa, item, valor, forma_pagamento, parcelado, quantidade, data_compra, vencimento) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [d.pessoa, d.item, d.valor, d.forma_pagamento || null, d.parcelado || null, d.quantidade || null, d.data_compra || null, d.vencimento || null], env
    );
    return { ok: true };
  }
  if (method === "PUT") {
    if (!id) throw new ErroHttp(400, "id obrigatório");
    await tursoExec(
      "UPDATE despesas_pessoais SET item=?, valor=?, forma_pagamento=?, parcelado=?, data_compra=?, vencimento=? WHERE id=?",
      [body.item, body.valor, body.forma_pagamento || null, body.parcelado || null, body.data_compra || null, body.vencimento || null, id], env
    );
    return { ok: true };
  }
  if (method === "DELETE") {
    if (!id) throw new ErroHttp(400, "id obrigatório");
    await tursoExec("DELETE FROM despesas_pessoais WHERE id=?", [id], env);
    return { ok: true };
  }
  throw new ErroHttp(405, "método não suportado");
}
async function bulkPessoais(body, env) {
  await ensurePessoais(env);
  const linhas = (body && body.rows) || [];
  for (const grupo of chunk(linhas, 50)) {
    await tursoBatch(
      grupo.map((d) => ({
        sql: "INSERT INTO despesas_pessoais (pessoa, item, valor, forma_pagamento, parcelado, quantidade, data_compra, vencimento) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        args: [d.pessoa, d.item, d.valor, d.forma_pagamento, d.parcelado, d.quantidade, d.data_compra, d.vencimento],
      })),
      env
    );
  }
  return { importadas: linhas.length };
}

// ---- Lista de compras ----
async function ensureCompras(env) {
  await tursoExec("CREATE TABLE IF NOT EXISTS compras (id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT, marcado INTEGER DEFAULT 0)", [], env);
}
const ITENS_PADRAO = [
  "Papel Sulfite 500 Und.", "Papel Higiênico", "Papel Interfolha", "Sabonete Liquido",
  "Pasta Suspensa Amarela", "Pasta L", "Clips", "Grampos", "Caneta", "Tinta de Impressora",
  "Copo descartavel (200 ml)", "Limpador Multiuso - VEJA",
  "Refil de Tinta Preta de Impressora L3250 - T544 ECOTANK",
];
async function rotaCompras(method, id, body, env) {
  await ensureCompras(env);
  if (method === "GET") {
    const contagem = await tursoExec("SELECT COUNT(*) as n FROM compras", [], env);
    if (Number(contagem[0].n) === 0) {
      for (const nome of ITENS_PADRAO) {
        await tursoExec("INSERT INTO compras (nome, marcado) VALUES (?, 0)", [nome], env);
      }
    }
    return await tursoExec("SELECT * FROM compras ORDER BY id", [], env);
  }
  if (method === "POST") {
    await tursoExec("INSERT INTO compras (nome, marcado) VALUES (?, 1)", [body.nome], env);
    return { ok: true };
  }
  if (method === "PUT") {
    if (!id) throw new ErroHttp(400, "id obrigatório");
    await tursoExec("UPDATE compras SET marcado=? WHERE id=?", [body.marcado ? 1 : 0, id], env);
    return { ok: true };
  }
  if (method === "DELETE") {
    if (!id) throw new ErroHttp(400, "id obrigatório");
    await tursoExec("DELETE FROM compras WHERE id=?", [id], env);
    return { ok: true };
  }
  throw new ErroHttp(405, "método não suportado");
}

// ---- Notas ----
async function ensureNotas(env) {
  await tursoExec("CREATE TABLE IF NOT EXISTS notas (id INTEGER PRIMARY KEY, texto TEXT)", [], env);
}
async function rotaNotas(method, id, body, env) {
  await ensureNotas(env);
  const notaId = id || 1;
  if (method === "GET") {
    const linhas = await tursoExec("SELECT texto FROM notas WHERE id=?", [notaId], env);
    return { texto: (linhas[0] && linhas[0].texto) || "" };
  }
  if (method === "PUT") {
    await tursoExec(
      "INSERT INTO notas (id, texto) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET texto = excluded.texto",
      [notaId, body.texto], env
    );
    return { ok: true };
  }
  throw new ErroHttp(405, "método não suportado");
}

// ---- Roteador ----
// Aceita tanto /api/despesas quanto /despesas — o wrangler.toml direciona
// logosg3.com.br/api/* pra esse Worker, então o caminho já chega sem o "/api".
function segmentosDaRota(pathname) {
  const partes = pathname.split("/").filter(Boolean);
  if (partes[0] === "api") partes.shift();
  return partes;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const segmentos = segmentosDaRota(url.pathname);
    const recurso = segmentos[0];
    const segundo = segmentos[1];
    const id = segundo && segundo !== "bulk" ? Number(segundo) : null;

    try {
      await exigirLogin(request, env);
      const method = request.method;
      const body = method === "GET" || method === "DELETE" ? null : await request.json();

      let resultado;
      if (recurso === "despesas" && segundo === "bulk" && method === "POST") {
        resultado = await bulkDespesas(body, env);
      } else if (recurso === "despesas") {
        resultado = await rotaDespesas(method, id, body, env);
      } else if (recurso === "despesas-pessoais" && segundo === "bulk" && method === "POST") {
        resultado = await bulkPessoais(body, env);
      } else if (recurso === "despesas-pessoais") {
        resultado = await rotaPessoais(method, id, body, url, env);
      } else if (recurso === "compras") {
        resultado = await rotaCompras(method, id, body, env);
      } else if (recurso === "notas") {
        resultado = await rotaNotas(method, id, body, env);
      } else {
        throw new ErroHttp(404, "rota desconhecida");
      }
      return json(resultado);
    } catch (err) {
      const status = err.status || 500;
      return json({ error: err.message }, status);
    }
  },
};
