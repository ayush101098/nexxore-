/* Nexxore — single source of truth for product claims and data-state labels.
 *
 * Facts: any element with data-nx-fact="key" gets its text from FACTS[key].
 *   Edit a number, price or status here and every page that shows it updates.
 *   Only list what the product can substantiate today.
 *
 * Status: data-nx-status="key" renders the availability pill for STATUS[key].
 *
 * Data states: data-nx-state="live|delayed|paper|simulated|sample|unavailable|awaiting|connecting"
 *   renders a pill. Add data-nx-watch="<css selector>" (and optional
 *   data-nx-ttl="<seconds>", default 120) to make a live pill self-updating:
 *   it reads "Connecting" until the watched element first changes, then
 *   "Live · Ns ago", falling back to "Delayed" when updates stop and to
 *   "Unavailable" if nothing ever arrives. Pages can also call
 *   NX.setState(el, state, note) directly.
 */
(function () {
  var FACTS = {
    priceStreams: '16',
    priceStreamsLabel: '16 live price streams',
    priceStreamsSource: 'Binance WebSocket',
    predictionVenue: 'Polymarket',
    predictionCoverage: 'Live Polymarket markets, ranked by 24h volume',
    swarmSources: '8',
    swarmHorizon: '1 hour',
    proPrice: '$49/mo',
    proPriceShort: '$49',
    proAccess: 'Waitlist · founding rate locked at sign-up',
    scannerRefresh: '60s',
    whaleRefresh: '20s',
    leaderboardRefresh: '3 min'
  };

  /* Availability of each product surface. One of:
     live · paper · simulated · waitlist · planned · after-audit · own-key */
  var STATUS = {
    terminal: 'live',
    predictionTerminal: 'live',
    swarm: 'paper',
    intelligence: 'paper',
    strategyBuilder: 'live',
    strategyExecution: 'own-key',
    stablecoinHub: 'planned', // parked until audit + track record
    alerts: 'live',
    trackRecord: 'paper',
    pro: 'waitlist',
    proFeed: 'simulated',
    sandbox: 'planned',
    agentMarketplace: 'planned',
    vaults: 'after-audit',
    onchainExecution: 'planned'
  };

  var STATUS_LABEL = {
    live: 'Live',
    paper: 'Paper only',
    simulated: 'Simulated',
    waitlist: 'Waitlist',
    planned: 'Planned',
    'after-audit': 'After audit',
    'own-key': 'Live · your API key'
  };

  var STATE = {
    live:        { label: 'Live',            fg: '#3DD6B0', bg: 'rgba(61,214,176,0.12)',  bd: 'rgba(61,214,176,0.35)' },
    connecting:  { label: 'Connecting',      fg: '#7CC4FF', bg: 'rgba(124,196,255,0.10)', bd: 'rgba(124,196,255,0.30)' },
    delayed:     { label: 'Delayed',         fg: '#E8A33D', bg: 'rgba(232,163,61,0.12)',  bd: 'rgba(232,163,61,0.35)' },
    paper:       { label: 'Paper',           fg: '#E8A33D', bg: 'rgba(232,163,61,0.10)',  bd: 'rgba(232,163,61,0.30)' },
    simulated:   { label: 'Simulated',       fg: '#B79CFF', bg: 'rgba(183,156,255,0.12)', bd: 'rgba(183,156,255,0.35)' },
    sample:      { label: 'Illustrative',    fg: '#B79CFF', bg: 'rgba(183,156,255,0.10)', bd: 'rgba(183,156,255,0.30)' },
    unavailable: { label: 'Unavailable',     fg: '#9AA3B2', bg: 'transparent',            bd: 'rgba(154,163,178,0.35)' },
    awaiting:    { label: 'Awaiting selection', fg: '#9AA3B2', bg: 'transparent',         bd: 'rgba(154,163,178,0.30)' },
    planned:     { label: 'Not yet available', fg: '#9AA3B2', bg: 'transparent',          bd: 'rgba(154,163,178,0.30)' }
  };
  var STATUS_TO_STATE = { live: 'live', paper: 'paper', simulated: 'simulated', waitlist: 'planned', planned: 'planned', 'after-audit': 'planned', 'own-key': 'live' };

  function css() {
    if (document.getElementById('nx-state-css')) return;
    var s = document.createElement('style');
    s.id = 'nx-state-css';
    s.textContent =
      '.nx-state{display:inline-flex;align-items:center;gap:5px;font:500 9.5px/1 "JetBrains Mono",ui-monospace,monospace;' +
      'letter-spacing:.06em;text-transform:uppercase;padding:3px 7px;border-radius:999px;border:1px solid;white-space:nowrap;vertical-align:middle}' +
      '.nx-state i{width:5px;height:5px;border-radius:50%;background:currentColor;flex:none}' +
      '.nx-state[data-s="live"] i{box-shadow:0 0 6px currentColor}' +
      '.nx-state[data-s="connecting"] i{animation:nxPulse 1.2s ease-in-out infinite}' +
      '.nx-state[data-s="unavailable"] i,.nx-state[data-s="awaiting"] i,.nx-state[data-s="planned"] i{background:transparent;border:1px solid currentColor}' +
      '@keyframes nxPulse{50%{opacity:.25}}' +
      '@media (prefers-reduced-motion:reduce){.nx-state i{animation:none!important}}';
    document.head.appendChild(s);
  }

  function ago(ms) {
    var s = Math.max(1, Math.round(ms / 1000));
    if (s < 60) return s + 's ago';
    if (s < 3600) return Math.round(s / 60) + 'm ago';
    return Math.round(s / 3600) + 'h ago';
  }

  function setState(el, state, note) {
    if (!el) return;
    var d = STATE[state] || STATE.unavailable;
    el.classList.add('nx-state');
    el.setAttribute('data-s', state);
    el.style.color = d.fg; el.style.background = d.bg; el.style.borderColor = d.bd;
    el.innerHTML = '<i></i>';
    el.appendChild(document.createTextNode(d.label + (note ? ' · ' + note : '')));
    if (!el.title) el.title = TITLES[state] || '';
  }

  var TITLES = {
    live: 'Streaming from the source; timestamp shows the last update',
    connecting: 'Waiting for the first response from the data source',
    delayed: 'No update within the expected refresh window',
    paper: 'Paper-only: no real money is involved',
    simulated: 'Deterministic simulated feed, not market data',
    sample: 'Illustrative example, not a live signal',
    unavailable: 'The data source did not respond',
    awaiting: 'Select an item to load this panel',
    planned: 'Not available yet'
  };

  function watch(el) {
    var target = document.querySelector(el.getAttribute('data-nx-watch'));
    var ttl = (parseFloat(el.getAttribute('data-nx-ttl')) || 120) * 1000;
    var grace = (parseFloat(el.getAttribute('data-nx-grace')) || 25) * 1000;
    var start = Date.now(), last = 0;
    setState(el, 'connecting');
    if (!target) { setState(el, 'unavailable'); return; }
    new MutationObserver(function () { last = Date.now(); }).observe(target, { childList: true, subtree: true, characterData: true });
    function tick() {
      var now = Date.now();
      if (!last) { if (now - start > grace) setState(el, 'unavailable'); return; }
      setState(el, now - last > ttl ? 'delayed' : 'live', ago(now - last));
    }
    setInterval(tick, 5000);
    setTimeout(tick, 1500);
  }

  function apply(root) {
    root = root || document;
    css();
    root.querySelectorAll('[data-nx-fact]').forEach(function (el) {
      var v = FACTS[el.getAttribute('data-nx-fact')];
      if (v != null) el.textContent = v;
    });
    root.querySelectorAll('[data-nx-status]').forEach(function (el) {
      var st = STATUS[el.getAttribute('data-nx-status')];
      if (st) { setState(el, STATUS_TO_STATE[st]); el.lastChild.textContent = STATUS_LABEL[st]; }
    });
    root.querySelectorAll('[data-nx-state]').forEach(function (el) {
      if (el.__nx) return; el.__nx = true;
      if (el.hasAttribute('data-nx-watch')) watch(el);
      else setState(el, el.getAttribute('data-nx-state'), el.getAttribute('data-nx-note'));
    });
  }

  window.NX = { facts: FACTS, status: STATUS, setState: setState, apply: apply };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { apply(); });
  else apply();
})();
