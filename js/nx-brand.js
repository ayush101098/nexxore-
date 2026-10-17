/* Puts the Nexxore mark on every brand/logo element and sets the favicon. */
(function () {
  var SRC = '/assets/logo-mark.svg';
  var SEL = '.logo, .nx-shell-logo, .tb-logo, .nav-logo, .brand, .footer-brand, .header-logo, .site-logo';
  function mark(h) {
    var i = document.createElement('img');
    i.src = SRC; i.alt = ''; i.setAttribute('data-nx-mark', '');
    i.style.cssText = 'height:' + h + 'px;width:' + h + 'px;flex:none;display:inline-block;vertical-align:middle;margin-right:8px;object-fit:contain';
    return i;
  }
  function apply() {
    document.querySelectorAll(SEL).forEach(function (el) {
      if (el.querySelector('img[data-nx-mark]')) return;
      el.querySelectorAll('svg, .dot, .nx-shell-dot, .tb-dot, img').forEach(function (n) { n.remove(); });
      var h = el.matches('.footer-brand') ? 18 : 24;
      el.insertBefore(mark(h), el.firstChild);
      if (getComputedStyle(el).display === 'inline') el.style.display = 'inline-flex';
      el.style.alignItems = el.style.alignItems || 'center';
    });
    if (!document.querySelector('link[rel~="icon"][data-nx]')) {
      document.querySelectorAll('link[rel~="icon"]').forEach(function (l) { l.remove(); });
      var l = document.createElement('link');
      l.rel = 'icon'; l.type = 'image/svg+xml'; l.href = SRC; l.setAttribute('data-nx', '');
      document.head.appendChild(l);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply); else apply();
})();
