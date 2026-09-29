// Cliente mínimo pra falar com o backend em /api/* (uma Cloudflare Pages Function —
// veja functions/api/[[path]].js). Antes, as páginas do caixa falavam direto com o
// Turso e carregavam o token do banco no próprio arquivo (turso.js); agora quem fala
// com o Turso é só a function, que fica no servidor. Aqui a gente só anexa o token de
// login do Firebase em cada chamada, pra provar que quem está pedindo passou pelo login.

function caixaEsperaLogin() {
  return new Promise(function (resolve, reject) {
    if (typeof firebase === "undefined") { reject(new Error("Firebase não carregou")); return; }
    var respondeu = false;
    firebase.auth().onAuthStateChanged(function (user) {
      if (respondeu) return;
      respondeu = true;
      if (user) resolve(user); else reject(new Error("não autenticado"));
    });
  });
}

// method: "GET" | "POST" | "PUT" | "DELETE"
// caminho: ex. "despesas", "despesas/12", "despesas-pessoais?pessoa=Glerton"
// corpo: objeto (vira JSON) ou undefined
function api(method, caminho, corpo) {
  return caixaEsperaLogin()
    .then(function (user) { return user.getIdToken(); })
    .then(function (token) {
      return fetch("/api/" + caminho, {
        method: method,
        headers: {
          "Authorization": "Bearer " + token,
          "Content-Type": "application/json",
        },
        body: corpo !== undefined ? JSON.stringify(corpo) : undefined,
      });
    })
    .then(function (res) {
      return res.json().then(function (dados) {
        if (!res.ok) throw new Error(dados.error || ("erro " + res.status));
        return dados;
      });
    });
}
