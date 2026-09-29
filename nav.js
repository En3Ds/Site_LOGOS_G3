(function(){
  try{
    var toggle = document.querySelector('.menu-toggle');
    var nav = document.querySelector('.nav');
    if(toggle && nav){
      toggle.addEventListener('click', function(){
        var open = nav.getAttribute('data-open') === 'true';
        nav.setAttribute('data-open', String(!open));
        toggle.setAttribute('aria-expanded', String(!open));
        toggle.textContent = !open ? '✕' : '☰';
      });
    }
    var path = (window.location.pathname.split('/').pop() || 'index.html');
    document.querySelectorAll('.nav a[href]').forEach(function(a){
      var href = a.getAttribute('href');
      if(href === path || (href === 'index.html' && (path === '' || path === '/'))){
        a.classList.add('is-active');
      }
    });
  }catch(e){ /* no-op */ }
})();

/* Contato renderizado só em tempo de execução: e-mail e telefone nunca aparecem
   como texto simples no HTML/JS entregue, para dificultar a coleta automática
   por robôs de spam. Um visitante comum (com JavaScript ativo) vê os dados
   normalmente. */
(function(){
  try{
    function reverse(s){ return s.split('').reverse().join(''); }

    var user = reverse('otnemidneta');            // atendimento
    var host = reverse('rb.moc.3gsogol');          // logosg3.com.br
    var email = user + String.fromCharCode(64) + host;

    var digits = reverse('045798831155');          // 55 11 3889-7540
    var ddd = digits.slice(2, 4);
    var rest = digits.slice(4);
    var phoneDisplay = '(' + ddd + ') ' + rest.slice(0, 4) + '-' + rest.slice(4);
    var telHref = 'tel:+' + digits;
    var waHref = 'https://wa.me/' + digits;

    document.querySelectorAll('[data-cta="email"]').forEach(function(el){
      el.textContent = email;
      el.setAttribute('href', 'mailto:' + email);
      el.removeAttribute('rel');
    });
    document.querySelectorAll('[data-cta="phone"]').forEach(function(el){
      el.textContent = phoneDisplay;
      el.setAttribute('href', telHref);
      el.removeAttribute('rel');
    });
    document.querySelectorAll('[data-cta="whatsapp"]').forEach(function(el){
      el.setAttribute('href', waHref);
      el.setAttribute('target', '_blank');
      el.setAttribute('rel', 'noopener');
    });
    document.querySelectorAll('[data-cta="whatsapp-text"]').forEach(function(el){
      el.textContent = phoneDisplay;
    });
  }catch(e){ /* no-op */ }
})();

/* Formulário de contato → Formspree (https://formspree.io/f/meokvade), via fetch
   para o visitante nunca sair do site. Sem biblioteca externa: é só um POST. */
(function(){
  try{
    var form = document.getElementById('contact-form');
    if(!form) return;
    var status = form.querySelector('[data-form-status]');
    var btn = form.querySelector('button[type="submit"]');

    form.addEventListener('submit', function(ev){
      ev.preventDefault();
      if(btn){ btn.disabled = true; }
      if(status){ status.textContent = 'Enviando...'; status.className = 'form-status'; }

      fetch(form.action, {
        method: 'POST',
        body: new FormData(form),
        headers: { 'Accept': 'application/json' }
      }).then(function(res){
        if(res.ok){
          form.reset();
          if(status){ status.textContent = 'Mensagem enviada — obrigado! Retornamos em breve.'; status.className = 'form-status is-success'; }
        } else {
          return res.json().then(function(data){
            var msg = (data && data.errors && data.errors.length) ? data.errors.map(function(e){return e.message;}).join(', ') : 'Não foi possível enviar. Tente novamente ou use o WhatsApp/e-mail ao lado.';
            if(status){ status.textContent = msg; status.className = 'form-status is-error'; }
          });
        }
      }).catch(function(){
        if(status){ status.textContent = 'Não foi possível enviar. Tente novamente ou use o WhatsApp/e-mail ao lado.'; status.className = 'form-status is-error'; }
      }).finally(function(){
        if(btn){ btn.disabled = false; }
      });
    });
  }catch(e){ /* no-op */ }
})();
