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
    var form = document.querySelector('[data-mail-form]');
    if(form){ form.setAttribute('action', 'mailto:' + email); }
  }catch(e){ /* no-op */ }
})();
