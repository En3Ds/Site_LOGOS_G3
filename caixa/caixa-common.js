// Incluir em toda página protegida do caixa, logo depois de firebase-cfg.js.
// Cuida do redirecionamento se não estiver logado e do botão "Sair", que antes eram
// copiados e colados em cada página.
if (!sessionStorage.getItem("logadoComo")) {
  location.href = "index.html";
}
if (typeof firebase !== "undefined") {
  firebase.initializeApp(firebaseConfig);
}
document.addEventListener("DOMContentLoaded", function () {
  var sair = document.getElementById("sair");
  if (sair) {
    sair.addEventListener("click", function () {
      sessionStorage.removeItem("logadoComo");
      if (typeof firebase !== "undefined") { firebase.auth().signOut(); }
      location.href = "index.html";
    });
  }
});
