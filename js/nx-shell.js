/* Nexxore app shell — left feature rail + email access gate.
 *
 * Loaded on every product page. Adds a fixed left rail linking every feature,
 * shifts the page's fixed headers clear of it, and shows an email gate until
 * the visitor has entered an email (stored in localStorage as nx_access_v1;
 * the homepage form writes the same key). Signups that could not reach
 * /api/waitlist are retried here on later visits.
 */
(function () {
  var KEY = 'nx_access_v1';
  var RAIL = 68;
  var UNGATED = ['track-record']; // public proof page: rail, but no gate

  var I = { // 18px stroke icons
    terminal: '<path d="M4 6l5 5-5 5M11 17h7"/>',
    predict: '<circle cx="11" cy="11" r="7"/><circle cx="11" cy="11" r="3"/><path d="M11 2v3M11 17v3M2 11h3M17 11h3"/>',
    swarm: '<circle cx="6" cy="7" r="2.2"/><circle cx="16" cy="7" r="2.2"/><circle cx="11" cy="16" r="2.2"/><path d="M8 8l2 6M14 8l-2 6M8.2 7h5.6"/>',
    alerts: '<path d="M6 15V10a5 5 0 0110 0v5l1.5 2h-13L6 15zM9.5 19a1.8 1.8 0 003 0"/>',
    builder: '<path d="M3 17l5-6 4 3 7-9"/><path d="M15 5h4v4"/>',
    risk: '<path d="M11 3l7 3v5c0 4.2-3 7.4-7 8.5-4-1.1-7-4.3-7-8.5V6l7-3z"/><path d="M11 8v4M11 15v.5"/>',
    yield: '<circle cx="11" cy="11" r="8"/><path d="M13.6 8.2c-.5-.9-1.5-1.3-2.6-1.3-1.5 0-2.6.8-2.6 2s1.1 1.7 2.6 2c1.6.3 2.7.8 2.7 2.1s-1.2 2.1-2.7 2.1c-1.2 0-2.2-.5-2.7-1.4M11 5.5v1.4M11 15.1v1.4"/>',
    record: '<path d="M5 3h9l3 3v13H5z"/><path d="M8 10h6M8 13h6M8 16h4"/>',
    pro: '<path d="M11 3l2.4 5 5.6.8-4 3.9 1 5.5-5-2.7-5 2.7 1-5.5-4-3.9 5.6-.8z"/>'
  };
  var NAV = [
    { group: 'Markets' },
    { href: '/terminal', match: 'terminal', icon: 'terminal', label: 'Terminal', full: 'Trading Terminal' },
    { href: '/prediction-terminal', match: 'prediction-terminal', icon: 'predict', label: 'Predict', full: 'Prediction Terminal' },
    { group: 'Research' },
    { href: '/swarm', match: 'swarm', icon: 'swarm', label: 'Swarm', full: 'The Swarm' },
    { href: '/predictions', match: 'predictions', icon: 'alerts', label: 'Alerts', full: 'Prediction Agent & Alerts' },
    { group: 'Strategies' },
    { href: '/strategy-builder', match: 'strategy-builder', icon: 'builder', label: 'Builder', full: 'Strategy Builder' },
    { href: '/intelligence', match: 'intelligence', icon: 'risk', label: 'Risk', full: 'Intelligence & Risk Engine' },
    { href: '/stablecoin-hub', match: 'stablecoin-hub', icon: 'yield', label: 'Yield', full: 'Stablecoin Hub' },
    { group: 'Proof' },
    { href: '/track-record', match: 'track-record', icon: 'record', label: 'Record', full: 'Track Record' },
    { sep: true },
    { href: '/terminal-pro', match: 'terminal-pro', icon: 'pro', label: 'Pro', full: 'Pro workspace' }
  ];

  function page() { return location.pathname.replace(/^\/|\.html$/g, '').replace(/\/$/, '') || 'index'; }
  function access() { try { return JSON.parse(localStorage.getItem(KEY)); } catch (e) { return null; } }
  function esc(t) { return String(t).replace(/[<>&"]/g, function (c) { return { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]; }); }
  function svg(k) { return '<svg viewBox="0 0 22 22" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + I[k] + '</svg>'; }

  function css() {
    var s = document.createElement('style');
    s.textContent =
      'html{--nx-rail:' + RAIL + 'px}' +
      'body.nx-has-rail{margin-left:var(--nx-rail)!important;width:auto!important;min-width:0}' +
      '.nx-rail{position:fixed;top:0;left:0;bottom:0;width:var(--nx-rail);z-index:2147483000;background:#070A12;border-right:1px solid rgba(138,180,255,.12);' +
      'display:flex;flex-direction:column;align-items:stretch;padding:10px 0;font-family:Inter,system-ui,sans-serif;overflow-y:auto;overflow-x:hidden;scrollbar-width:none}' +
      '.nx-rail::-webkit-scrollbar{display:none}' +
      '.nx-rail-logo{display:flex;justify-content:center;padding:4px 0 10px;margin-bottom:4px;border-bottom:1px solid rgba(138,180,255,.08)}' +
      '.nx-rail-logo img{width:28px;height:28px}' +
      '.nx-rail-group{font:600 8.5px/1 "JetBrains Mono",monospace;letter-spacing:.12em;text-transform:uppercase;color:rgba(159,176,199,.45);text-align:center;margin:12px 0 4px}' +
      '.nx-rail-sep{flex:1;min-height:12px}' +
      '.nx-rail a.nx-ri{position:relative;display:flex;flex-direction:column;align-items:center;gap:4px;margin:1px 7px;padding:8px 0 7px;border-radius:8px;color:#8C9AB0;text-decoration:none;' +
      'font-size:10px;font-weight:500;letter-spacing:.01em;transition:color .12s,background .12s}' +
      '.nx-rail a.nx-ri:hover{color:#F4F8FF;background:rgba(255,255,255,.05)}' +
      '.nx-rail a.nx-ri.on{color:#39D5FF;background:rgba(57,213,255,.10)}' +
      '.nx-rail a.nx-ri.on::before{content:"";position:absolute;left:-7px;top:8px;bottom:8px;width:2px;border-radius:2px;background:#39D5FF}' +
      '.nx-rail a.nx-ri:focus-visible{outline:2px solid #39D5FF;outline-offset:1px}' +
      '.nx-tip{position:fixed;left:calc(var(--nx-rail) + 6px);z-index:2147483001;background:#111826;color:#F4F8FF;border:1px solid rgba(138,180,255,.2);border-radius:6px;' +
      'padding:5px 9px;font:500 12px/1.3 Inter,system-ui,sans-serif;white-space:nowrap;pointer-events:none;opacity:0;transform:translateX(-4px);transition:opacity .1s,transform .1s}' +
      '.nx-tip.show{opacity:1;transform:none}' +
      '.nx-rail-acct{display:flex;justify-content:center;margin-top:8px;padding-top:10px;border-top:1px solid rgba(138,180,255,.08)}' +
      '.nx-rail-acct button{width:30px;height:30px;border-radius:50%;border:1px solid rgba(138,180,255,.25);background:rgba(57,213,255,.08);color:#39D5FF;font:600 12px/1 Inter,sans-serif;cursor:pointer}' +
      '@media (max-width:760px){html{--nx-rail:0px}.nx-rail{top:auto;left:0;right:0;width:auto;height:58px;flex-direction:row;padding:0 4px;border-right:none;border-top:1px solid rgba(138,180,255,.12);overflow-x:auto}' +
      '.nx-rail-logo,.nx-rail-group,.nx-rail-sep,.nx-rail-acct{display:none}.nx-rail a.nx-ri{flex:0 0 auto;min-width:58px;margin:6px 1px}.nx-rail a.nx-ri.on::before{display:none}' +
      'body.nx-has-rail{padding-bottom:58px!important}}' +
      /* gate */
      '.nx-gate{position:fixed;inset:0;z-index:2147483600;background:rgba(5,8,14,.72);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);display:flex;align-items:center;justify-content:center;padding:20px}' +
      '.nx-gate-card{width:100%;max-width:420px;background:#0E1420;border:1px solid rgba(138,180,255,.16);border-radius:12px;padding:32px 28px;text-align:center;color:#EAE5D6;font-family:Inter,system-ui,sans-serif;box-shadow:0 24px 60px rgba(0,0,0,.5)}' +
      '.nx-gate-card img{width:40px;height:40px;margin-bottom:14px}' +
      '.nx-gate-card h2{font:400 30px/1.15 "Instrument Serif",Georgia,serif;margin:0 0 8px;color:#EAE5D6}' +
      '.nx-gate-card p{font-size:14px;line-height:1.55;color:rgba(234,229,214,.62);margin:0 0 22px}' +
      '.nx-gate-card form{display:flex;flex-direction:column;gap:8px}' +
      '.nx-gate-card input{padding:12px 14px;background:rgba(255,255,255,.03);border:1px solid rgba(234,229,214,.14);border-radius:6px;color:#EAE5D6;font:14.5px Inter,sans-serif;outline:none}' +
      '.nx-gate-card input:focus{border-color:rgba(111,201,186,.55)}' +
      '.nx-gate-card input.err{border-color:#D9584B}' +
      '.nx-gate-card button{padding:12px;background:#EAE5D6;color:#0A0E17;border:none;border-radius:6px;font:600 13px "JetBrains Mono",monospace;cursor:pointer}' +
      '.nx-gate-card button:disabled{opacity:.6;cursor:wait}' +
      '.nx-gate-note{font:11.5px "JetBrains Mono",monospace;color:rgba(234,229,214,.4);margin-top:12px;min-height:14px}' +
      '.nx-gate-note.err{color:#D9584B}' +
      'body.nx-gated{overflow:hidden!important}';
    document.head.appendChild(s);
  }

  function tip(el, text) {
    var t;
    el.addEventListener('mouseenter', function () {
      t = document.createElement('div'); t.className = 'nx-tip'; t.textContent = text; document.body.appendChild(t);
      var r = el.getBoundingClientRect(); t.style.top = (r.top + r.height / 2 - t.offsetHeight / 2) + 'px';
      requestAnimationFrame(function () { t.classList.add('show'); });
    });
    el.addEventListener('mouseleave', function () { if (t) { t.remove(); t = null; } });
  }

  function rail() {
    var cur = page(), nav = document.createElement('nav');
    nav.className = 'nx-rail'; nav.setAttribute('aria-label', 'Nexxore features');
    var html = '<a class="nx-rail-logo" href="/" aria-label="Nexxore home"><img src="/assets/logo-mark.svg" alt=""></a>';
    NAV.forEach(function (n) {
      if (n.group) html += '<div class="nx-rail-group">' + n.group + '</div>';
      else if (n.sep) html += '<div class="nx-rail-sep"></div>';
      else html += '<a class="nx-ri' + (cur === n.match ? ' on' : '') + '" href="' + n.href + '" data-full="' + esc(n.full) + '"' + (cur === n.match ? ' aria-current="page"' : '') + '>' + svg(n.icon) + '<span>' + n.label + '</span></a>';
    });
    var a = access();
    if (a && a.email) html += '<div class="nx-rail-acct"><button type="button" title="' + esc(a.email) + ' · click to sign out" aria-label="Account">' + esc(a.email.charAt(0).toUpperCase()) + '</button></div>';
    nav.innerHTML = html;
    document.body.insertBefore(nav, document.body.firstChild);
    document.body.classList.add('nx-has-rail');
    nav.querySelectorAll('a.nx-ri').forEach(function (el) { tip(el, el.getAttribute('data-full')); });
    var acct = nav.querySelector('.nx-rail-acct button');
    if (acct) acct.addEventListener('click', function () {
      if (confirm('Signed in as ' + a.email + '.\n\nSign out on this device?')) { try { localStorage.removeItem(KEY); } catch (e) {} location.href = '/'; }
    });
    shiftFixed();
    setTimeout(shiftFixed, 800);
  }

  /* Page headers are position:fixed with left:0, so they ignore the body margin.
     Move any full-width fixed bar (not full-screen overlays) clear of the rail. */
  function shiftFixed() {
    if (window.innerWidth <= 760) return;
    var all = document.body.getElementsByTagName('*');
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (el.closest('.nx-rail,.nx-gate') || el.__nxShift) continue;
      var cs = getComputedStyle(el);
      if (cs.position !== 'fixed' || cs.pointerEvents === 'none') continue;
      var r = el.getBoundingClientRect();
      if (r.width < window.innerWidth * 0.6 || r.left > 4) continue;
      if (r.height > window.innerHeight * 0.6) continue; // full-screen overlays/modals stay put
      el.__nxShift = true;
      el.style.left = RAIL + 'px';
      if (cs.right === '0px') el.style.width = 'auto';
    }
  }

  function syncPending() {
    var a = access();
    if (!a || !a.email || a.synced) return;
    fetch('/api/waitlist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: a.email, source: 'app:' + page() }) })
      .then(function (r) { return r.json(); })
      .then(function (d) { if (d && d.success) { a.synced = true; try { localStorage.setItem(KEY, JSON.stringify(a)); } catch (e) {} } })
      .catch(function () {});
  }

  function gate() {
    var g = document.createElement('div');
    g.className = 'nx-gate'; g.setAttribute('role', 'dialog'); g.setAttribute('aria-modal', 'true'); g.setAttribute('aria-labelledby', 'nxGateTitle');
    g.innerHTML = '<div class="nx-gate-card"><img src="/assets/logo-mark.svg" alt="">' +
      '<h2 id="nxGateTitle">Get access to Nexxore</h2>' +
      '<p>Enter your email to open every Nexxore tool.</p>' +
      '<form novalidate><input type="email" placeholder="you@domain.com" autocomplete="email" aria-label="Email address" required>' +
      '<button type="submit">Get access →</button></form><div class="nx-gate-note">Free. One email, then you\'re in.</div></div>';
    document.body.appendChild(g);
    document.body.classList.add('nx-gated');
    var input = g.querySelector('input'), btn = g.querySelector('button'), note = g.querySelector('.nx-gate-note');
    setTimeout(function () { input.focus(); }, 50);
    g.querySelector('form').addEventListener('submit', function (e) {
      e.preventDefault();
      var email = input.value.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        input.classList.add('err'); note.className = 'nx-gate-note err'; note.textContent = 'Enter a valid email address.';
        return;
      }
      btn.disabled = true; btn.textContent = 'Opening…';
      var done = function (synced) {
        try { localStorage.setItem(KEY, JSON.stringify({ email: email, ts: Date.now(), synced: synced })); } catch (err) {}
        location.reload();
      };
      fetch('/api/waitlist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email, source: 'gate:' + page() }) })
        .then(function (r) { return r.json(); })
        .then(function (d) { done(!!(d && d.success)); })
        .catch(function () { done(false); });
    });
  }

  function init() {
    css();
    rail();
    var a = access();
    if (a && a.email) syncPending();
    else if (UNGATED.indexOf(page()) === -1) gate();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
