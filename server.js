const path = require("path");
const express = require("express");
const admin = require("firebase-admin");

// Only needs the project id to verify tokens (no service account secret required).
admin.initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID || "login-site-74597" });

const app = express();
app.use(express.json());

// site institucional atual, sem mudanca nenhuma
app.use(express.static(__dirname, { extensions: ["html"] }));

// secao nova: /caixa (controle de caixa)
app.use("/caixa", express.static(path.join(__dirname, "caixa"), { extensions: ["html"] }));

// checa o token do Firebase mandado pelo navegador (Authorization: Bearer <idToken>)
async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: "sem token" });
  try {
    req.user = await admin.auth().verifyIdToken(token);
    next();
  } catch (err) {
    res.status(401).json({ error: "token invalido" });
  }
}

// prova que o login funciona de ponta a ponta: navegador -> Firebase -> aqui
app.get("/api/me", requireAuth, (req, res) => {
  res.json({ uid: req.user.uid, email: req.user.email });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`rodando na porta ${PORT}`));
