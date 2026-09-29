// Verifica um ID token do Firebase Auth sem precisar do firebase-admin (que não roda
// no runtime do Cloudflare Workers, baseado em Web Workers, não em Node).
//
// Confere a assinatura RS256 contra as chaves públicas do Google e os campos
// obrigatórios do token. Se tudo bater, devolve os dados do usuário logado (uid,
// email); se qualquer coisa não bater, lança um erro.

const JWK_URL =
  "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";

let chavesCache = null;
let chavesCacheEm = 0;
const UMA_HORA_MS = 60 * 60 * 1000;

function base64urlParaBytes(b64url) {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const resto = b64.length % 4;
  const comPad = resto ? b64 + "=".repeat(4 - resto) : b64;
  const binario = atob(comPad);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return bytes;
}

function base64urlParaJson(b64url) {
  return JSON.parse(new TextDecoder().decode(base64urlParaBytes(b64url)));
}

async function buscarChavesGoogle() {
  if (chavesCache && Date.now() - chavesCacheEm < UMA_HORA_MS) return chavesCache;
  const res = await fetch(JWK_URL);
  if (!res.ok) throw new Error("não consegui buscar as chaves públicas do Google");
  const dados = await res.json();
  chavesCache = dados.keys;
  chavesCacheEm = Date.now();
  return chavesCache;
}

export async function verifyFirebaseToken(idToken, projectId) {
  const partes = idToken.split(".");
  if (partes.length !== 3) throw new Error("token mal formado");
  const [headerB64, payloadB64, assinaturaB64] = partes;

  const header = base64urlParaJson(headerB64);
  const payload = base64urlParaJson(payloadB64);

  if (header.alg !== "RS256") throw new Error("algoritmo de assinatura inesperado");

  let chaves = await buscarChavesGoogle();
  let jwk = chaves.find((k) => k.kid === header.kid);
  if (!jwk) {
    chavesCache = null;
    chaves = await buscarChavesGoogle();
    jwk = chaves.find((k) => k.kid === header.kid);
  }
  if (!jwk) throw new Error("chave de assinatura desconhecida (token de outra origem?)");

  const chavePublica = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"]
  );

  const dadosAssinados = new TextEncoder().encode(headerB64 + "." + payloadB64);
  const assinatura = base64urlParaBytes(assinaturaB64);
  const assinaturaValida = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    chavePublica,
    assinatura,
    dadosAssinados
  );
  if (!assinaturaValida) throw new Error("assinatura inválida");

  const agora = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== "number" || payload.exp < agora) throw new Error("token expirado");
  if (typeof payload.iat !== "number" || payload.iat > agora + 60) throw new Error("token emitido no futuro");
  if (payload.aud !== projectId) throw new Error("token de outro projeto Firebase");
  if (payload.iss !== "https://securetoken.google.com/" + projectId) throw new Error("issuer inesperado");
  if (!payload.sub) throw new Error("token sem uid");

  return payload;
}
