/* Nexxore engines — page controller for /engines.
 *
 * Two ledgers:
 *   S  the models' automatic paper record (signal → risk → simulated fill), the honest track record
 *   M  your paper trades from the ticket (your margin and leverage, same hard risk gates)
 * Live trades go through NXExec: signed by your wallet (Hyperliquid, Jupiter) or
 * placed by you on a centralised exchange from a ticket.
 */
(function () {
  'use strict';
  var C = window.NXCore, P = window.NXPerp, X = window.NXChain, E = window.NXExec, CFG = window.NX_CONFIG;
  var HOUR = 3600e3, MIN = 60e3;
  var $ = function (id) { return document.getElementById(id); };

  /* ------------------------------------------------------------ helpers */

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function uniq(a) { return a.filter(function (x, i) { return a.indexOf(x) === i; }); }
  function vals(o) { return Object.keys(o).map(function (k) { return o[k]; }); }
  function usd(x, dp) { if (x == null || !isFinite(x)) return '—'; dp = dp == null ? 2 : dp; return (x < 0 ? '−' : '') + '$' + Math.abs(x).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp }); }
  function sUsd(x, dp) { return x == null || !isFinite(x) ? '—' : (x > 0 ? '+' : '') + usd(x, dp); }
  function px(x) {
    if (x == null || !isFinite(x)) return '—';
    var a = Math.abs(x);
    if (a >= 1000) return x.toLocaleString('en-US', { maximumFractionDigits: 1 });
    if (a >= 1) return x.toFixed(4);
    return a === 0 ? '0' : x.toPrecision(4);
  }
  function pct(x, dp) { return x == null || !isFinite(x) ? '—' : (x * 100).toFixed(dp == null ? 1 : dp) + '%'; }
  function sPct(x, dp) { return x == null || !isFinite(x) ? '—' : (x > 0 ? '+' : x < 0 ? '−' : '') + Math.abs(x * 100).toFixed(dp == null ? 2 : dp) + '%'; }
  function cls(x) { return x > 0 ? 'up' : x < 0 ? 'down' : ''; }
  function dur(ms) { if (ms == null || !isFinite(ms)) return '—'; var s = Math.round(ms / 1000); return s < 60 ? s + 's' : s < 3600 ? Math.round(s / 60) + 'm' : s < 172800 ? (s / 3600).toFixed(1) + 'h' : Math.round(s / 86400) + 'd'; }
  function hhmm(ts) { return new Date(ts).toISOString().slice(11, 16); }
  function dayTime(ts) { var d = new Date(ts).toISOString(); return d.slice(5, 10) + ' ' + d.slice(11, 16); }
  function shortAddr(a) { return a ? a.slice(0, 4) + '…' + a.slice(-4) : ''; }
  function lsGet(k, d) { try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function loadScript(src) {
    return new Promise(function (res, rej) { var s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = function () { rej(new Error('could not load ' + src)); }; document.head.appendChild(s); });
  }

  var REASONS = {
    DATA_STALE: 'Price data is stale. Wait a few seconds.', INSUFFICIENT_MARGIN: 'Not enough free paper balance.',
    LEVERAGE_ABOVE_MAX: 'Leverage is above the maximum for this market.', DUPLICATE_POSITION: 'You already hold this market.',
    CONFLICTING_POSITION: 'You hold the opposite side of this market. Close it first.', ORDER_IN_FLIGHT: 'An order for this market is still in flight.',
    SIZE_BELOW_MIN: 'Order too small (minimum $10 notional).', DAILY_LOSS_LIMIT: 'Daily loss limit reached. New entries resume tomorrow (UTC).',
    DRAWDOWN_LIMIT: 'Drawdown limit reached.', STOP_WRONG_SIDE: 'Stop is on the wrong side of the price.', NO_INVALIDATION: 'Set a stop.',
    NO_PRICE: 'No live price yet.', SPOT_LONG_ONLY: 'Spot is long only.', STRATEGY_DISABLED: 'Paper trading is paused.'
  };
  function humanReasons(rs) { return rs.map(function (r) { return r.indexOf('HALTED') === 0 ? 'New entries are paused (' + r.slice(7) + ').' : REASONS[r] || r; }).join(' '); }

  /* -------------------------------------------------------------- ledgers */

  function loadLedger(key) {
    try { var j = localStorage.getItem(key); if (j) return C.deserialize(j); } catch (e) {}
    var s = C.newState(Date.now()); C.audit(s, Date.now(), 'user', 'create', 'new paper account'); return s;
  }
  var S = loadLedger('nx_engines_v1'), M = loadLedger('nx_manual_v1');
  var seen = new Set(S.signals.map(function (s) { return s.key; }));
  var dirtyS = false, dirtyM = false;
  function dirty(st) { if (st === M) dirtyM = true; else dirtyS = true; }
  function compact(st) {
    if (st.journal.length <= 3000) return;
    var old = st.journal.splice(0, st.journal.length - 2000), sum = old.reduce(function (a, x) { return a + x.amt; }, 0);
    st.journal.unshift({ ts: old[old.length - 1].ts, type: 'checkpoint', amt: sum, ref: 'folded ' + old.length });
  }
  function saveLedger(key, st) {
    compact(st);
    var lim = { signals: 500, decisions: 1000, orders: 600, fills: 1000, audit: 600, funding: 400, closed: 1000, snapshots: 4000 };
    var copy = Object.assign({}, st); Object.keys(lim).forEach(function (k) { copy[k] = st[k].slice(-lim[k]); });
    try { localStorage.setItem(key, C.serialize(copy)); } catch (e) {
      try { Object.keys(lim).forEach(function (k) { copy[k] = copy[k].slice(-Math.floor(lim[k] / 4)); }); localStorage.setItem(key, C.serialize(copy)); } catch (e2) {}
    }
  }
  function save() {
    if (dirtyS) { dirtyS = false; saveLedger('nx_engines_v1', S); }
    if (dirtyM) { dirtyM = false; saveLedger('nx_manual_v1', M); }
  }

  var HL = new P.PerpLive({ onUpdate: function (w) { if (w === 'ws-gap') PV.gapAt = Date.now(); } });
  var SOL = new X.SolLive();
  var PV = { rowsA: [], rowsB: [], regime: null, watch: [], scanA: 0, scanB: 0, gapAt: 0 };
  var SV = { rows: [], funnel: null, ts: 0 };
  var busy = {};

  function closedFor(st, id) { return st.closed.filter(function (t) { return t.strategy === id; }); }
  function solPrice(mint) { var p = SOL.pairs[mint]; return p && p.id ? parseFloat(p.id.pair.priceUsd) : null; }
  function marksOf(st) {
    var m = {};
    vals(st.positions).forEach(function (p) { var x = p.kind === 'perp' ? HL.price(p.instrument) : solPrice(p.instrument); if (x > 0) m[p.instrument] = x; });
    return m;
  }
  function equityOf(st) { return C.fromMicro(C.equity(st, marksOf(st))); }

  /* ------------------------------------------------- feed health / halts */

  var feedBad = { perp: 0, spot: 0 }, feedGood = { perp: 0, spot: 0 };
  function feedCheck(now) {
    var btc = HL.mids.BTC, u = HL.universe.BTC;
    var perpOk = HL.health.rest.ok !== false && !!((btc && now - btc.ts < 20000) || (u && now - u.ts < 60000));
    var spotOk = SOL.health.dexscreener.ok !== false && SOL.health.jupiter.ok !== false;
    [['perp', perpOk, 'Hyperliquid data degraded'], ['spot', spotOk, 'Solana data degraded']].forEach(function (x) {
      var k = x[0], scope = 'feed:' + k;
      if (!x[1]) {
        feedGood[k] = 0; feedBad[k] = feedBad[k] || now;
        if (now - feedBad[k] > 15000) [S, M].forEach(function (st) { if (!st.halts[scope]) { C.halt(st, now, scope, x[2], 'monitor'); dirty(st); } });
      } else {
        feedBad[k] = 0; feedGood[k] = feedGood[k] || now;
        if (now - feedGood[k] > 60000) [S, M].forEach(function (st) { if (st.halts[scope]) { C.resume(st, now, scope, 'feed healthy for 60s', 'monitor'); dirty(st); } });
      }
    });
    [S, M].forEach(function (st) { var r = C.reconcile(st); if (!r.ok && !st.halts.recon) { C.halt(st, now, 'recon', 'ledger mismatch ' + r.diff + ' µ$', 'monitor'); dirty(st); } });
  }

  /* ------------------------------------------------ model engine (paper) */

  function decisionCore(sig) {
    return { trigger: sig.trigger, dir: sig.dir, entry: sig.entryPx, stop: sig.stopPx, target: sig.targetPx,
      exp: sig.edge ? +sig.edge.expBps.toFixed(6) : null, checks: sig.checks.map(function (c) { return c[0] + (c[1] ? '1' : '0'); }) };
  }
  function impactSpread(u) { return u.impact && u.mid ? Math.max(0.5, (u.impact[1] - u.impact[0]) / u.mid * 1e4) : null; }
  function freshBook(coin, maxAge) { var b = HL.books[coin]; if (b && Date.now() - b.received < maxAge) return Promise.resolve(b); return HL.book(coin).catch(function () { return null; }); }
  function nextBook(coin, after) {
    return new Promise(function (res) {
      var t0 = Date.now();
      (function poll() {
        var b = HL.books[coin];
        if (b && b.received > after) return res(b);
        if (Date.now() - t0 > 2500) return HL.book(coin).then(res, function () { res(null); });
        setTimeout(poll, 150);
      })();
    });
  }
  function estQty(price, stopDist) { return equityOf(S) * S.config.perpRiskPct / Math.max(stopDist, price * 1e-4); }

  var runningB = false;
  async function scanB() {
    if (runningB) return; runningB = true;
    try {
      var Pb = P.PARAMS['perp.intraday'], elig = HL.eligible(Pb.minDayVolume).slice(0, 20);
      var held = vals(S.positions).concat(vals(M.positions)).filter(function (p) { return p.kind === 'perp'; }).map(function (p) { return p.instrument; });
      var coins = uniq(['BTC', 'ETH'].concat(elig.map(function (u) { return u.coin; })).concat(held)), now = Date.now();
      await Promise.all(coins.filter(function (c) { return !HL.c5[c] || now - HL.c5[c].ts > 110000 || PV.gapAt > HL.c5[c].ts; })
        .map(function (c) { return HL.candles(c, '5m', 26 * HOUR).catch(function () { return null; }); }));
      now = Date.now();
      var bench = HL.c5.BTC ? P.closedBars(HL.c5.BTC.bars, now, 5 * MIN) : null, eth = HL.c5.ETH ? P.closedBars(HL.c5.ETH.bars, now, 5 * MIN) : null;
      var feats = [];
      elig.forEach(function (u) {
        var cs = HL.c5[u.coin]; if (!cs || now - cs.ts > 180000) return;
        var b = HL.books[u.coin];
        var f = P.featuresIntraday(P.closedBars(cs.bars, now, 5 * MIN), { bench: bench, eth: eth, funding: u.funding, oiChgPct: HL.oiChange(u.coin),
          spreadBps: b && now - b.received < 60000 ? b.spreadBps : impactSpread(u), dayVolume: u.dayVolume, breadth: null });
        if (f) { f.coin = u.coin; feats.push({ u: u, f: f }); }
      });
      var breadth = feats.length ? feats.filter(function (x) { return x.f.r1h > 0; }).length / feats.length : null;
      var post = P.posterior(Pb.prior, closedFor(S, 'perp.intraday'));
      var rows = feats.map(function (x) { x.f.breadth = breadth; return { u: x.u, f: x.f, sig: P.signalIntraday(x.f, Pb, post) }; });
      rows.sort(function (a, b) { return b.sig.score - a.sig.score; });
      for (var i = 0; i < rows.length; i++) {
        var r = rows[i];
        if (!r.sig.checks.some(function (c) { return c[0] === 'SETUP' && c[1]; })) continue;
        if (r.sig.trigger) {
          var book = await freshBook(r.u.coin, 5000);
          if (book) { r.f.spreadBps = book.spreadBps; r.f.impactBps = P.walkBook(book, r.sig.dir, estQty(r.f.px, Math.abs(r.sig.entryPx - r.sig.stopPx)), 50).impactBps; r.sig = P.signalIntraday(r.f, Pb, post); }
        }
        await record('perp.intraday', r, post);
      }
      PV.rowsB = rows; PV.scanB = Date.now();
    } catch (e) { console.warn('scanB', e); } finally { runningB = false; }
  }

  var runningA = false;
  async function scanA() {
    if (runningA) return; runningA = true;
    try {
      var Pa = P.PARAMS['perp.scalp'], elig = HL.eligible(Pa.minDayVolume).slice(0, 8);
      PV.watch = elig.map(function (u) { return u.coin; });
      var held = vals(S.positions).concat(vals(M.positions)).filter(function (p) { return p.kind === 'perp'; }).map(function (p) { return p.instrument; });
      HL.watch(uniq(PV.watch.concat(held)));
      var now = Date.now();
      await Promise.all(['BTC'].concat(PV.watch).filter(function (c) { return !HL.c1[c] || now - HL.c1[c].ts > 28000 || PV.gapAt > HL.c1[c].ts; })
        .map(function (c) { return HL.candles(c, '1m', 100 * MIN).catch(function () { return null; }); }));
      await Promise.all(PV.watch.map(function (c) { var b = HL.books[c]; if (!b || Date.now() - b.received > 8000) return HL.book(c).catch(function () { return null; }); }));
      now = Date.now();
      var btc1m = HL.c1.BTC ? P.closedBars(HL.c1.BTC.bars, now, MIN) : null, post = P.posterior(Pa.prior, closedFor(S, 'perp.scalp')), rows = [];
      elig.forEach(function (u) {
        var cs = HL.c1[u.coin]; if (!cs || now - cs.ts > 90000) return;
        var book = HL.books[u.coin];
        var live = { book: book && now - book.received < 15000 ? book : null, flow: HL.flow(u.coin, MIN), mid: HL.price(u.coin), dayVolume: u.dayVolume, btc1m: btc1m };
        var f = P.featuresScalp(P.closedBars(cs.bars, now, MIN), live); if (!f) return;
        f.coin = u.coin;
        if (live.book) { var d = f.brkUp ? 1 : f.brkDn ? -1 : (f.r5m >= 0 ? 1 : -1); f.impactBps = P.walkBook(live.book, d, estQty(f.mid, Math.max(1.5 * f.atr1, f.mid * Pa.stopMinBps / 1e4)), 30).impactBps; }
        rows.push({ u: u, f: f, sig: P.signalScalp(f, Pa, post) });
      });
      rows.sort(function (a, b) { return b.sig.score - a.sig.score; });
      PV.rowsA = rows; PV.scanA = Date.now();
      for (var i = 0; i < rows.length; i++) if (rows[i].sig.checks.some(function (c) { return c[0] === 'BREAKOUT' && c[1]; })) await record('perp.scalp', rows[i], post);
    } catch (e) { console.warn('scanA', e); } finally { runningA = false; }
  }

  async function record(model, r, post) {
    var key = model + ':' + r.u.coin + ':' + r.f.t;
    if (seen.has(key)) return; seen.add(key);
    var sig = r.sig, now = Date.now();
    var rec = C.recordSignal(S, { key: key, ts: now, engine: 'perp', strategy: model, version: sig.version, featureSet: sig.featureSet, instrument: r.u.coin, label: r.u.coin,
      direction: sig.dir, score: +sig.score.toFixed(2), entryPx: sig.entryPx, stopPx: sig.stopPx, targetPx: sig.targetPx, exit: sig.exit, edge: sig.edge, checks: sig.checks,
      failed: sig.failed, rationale: sig.rationale || '', features: JSON.parse(JSON.stringify(r.f)), post: { p: post.p, a: post.a, b: post.b, n: post.n },
      decHash: C.hash(decisionCore(sig)), status: sig.trigger ? 'pending' : 'filtered' });
    dirty(S);
    if (sig.trigger) await proposePerp(rec, sig, r.f, r.u);
  }

  async function proposePerp(rec, sig, f, u) {
    var now = Date.now(), model = rec.strategy, Pm = P.PARAMS[model], book = HL.books[u.coin], depthCap = null;
    if (book) { var bi = P.bookImbalance(book, 20); depthCap = 0.2 * (sig.dir > 0 ? bi.askUsd : bi.bidUsd); }
    var dec = C.evaluate(S, { signalId: rec.id, strategy: model, version: sig.version, engine: 'perp', instrument: u.coin, side: sig.dir, entryPx: sig.entryPx, stopPx: sig.stopPx,
      exitPolicy: sig.exit, expectedEdgeBps: sig.edge.expBps, minEdgeBps: Pm.minEdgeBps, dataAgeMs: HL.midAge(u.coin), szDecimals: u.szDecimals, corrBtc: f.corrBtc || 0, maxNotionalByLiquidity: depthCap },
      { now: now, marks: marksOf(S) });
    rec.decisionId = dec.id; rec.status = dec.approved ? 'approved' : 'rejected'; rec.reasons = dec.reasons; dirty(S);
    if (!dec.approved) return;
    var o = C.createOrder(S, now, { intent: 'open', decisionId: dec.id, signalId: rec.id, strategy: model, version: sig.version, engine: 'perp', instrument: u.coin, side: sig.dir, qty: dec.qty, refPx: sig.entryPx, estCostBps: sig.edge.costBps, signalTs: rec.ts, reason: sig.rationale });
    await fillPerpEntry(S, o, u, model === 'perp.scalp' ? 15 : 30, 0,
      { stop: sig.stopPx, target: sig.targetPx, maxHoldMs: sig.exit.maxHoldMs, exit: sig.exit, corrBtc: f.corrBtc || 0, thesis: sig.rationale, extra: { mmFrac: 1 / (2 * (u.maxLeverage || 20)) } });
  }

  /* Fill an entry order against the next live book. nxTenths = simulated Nexxore commission (paper). */
  async function fillPerpEntry(st, o, u, capBps, nxTenths, meta) {
    var bk = await nextBook(u.coin, o.ts), ts = Date.now();
    if (!bk) { C.rejectOrder(st, ts, o, 'no order book after the signal'); dirty(st); return null; }
    var w = P.walkBook(bk, o.side, o.qty, capBps), q = w.complete ? o.qty : C.roundTo(w.filled, u.szDecimals);
    if (!(q > 0)) { C.transition(o, 'accepted', ts, 'simulator accepted'); C.transition(o, 'expired', ts, 'no liquidity within the slippage cap'); dirty(st); return null; }
    try {
      var f = C.applyFill(st, o, { qty: q, px: w.avgPx, feeUsd: q * w.avgPx * (P.VENUE.takerBps / 1e4 + (nxTenths || 0) / 1e5), halfSpreadBps: bk.spreadBps / 2, ts: ts }, meta);
      if (o.status === 'partially_filled') C.transition(o, 'cancelled', ts, 'remainder beyond the slippage cap');
      dirty(st); return f;
    } catch (e) { C.audit(st, ts, 'simulator', 'error', e.message); dirty(st); return null; }
  }

  function managePerps() { // model positions (S)
    var now = Date.now();
    vals(S.positions).filter(function (p) { return p.kind === 'perp' && !busy[p.id]; }).forEach(function (p) {
      var x = HL.price(p.instrument); if (!x) return;
      var age = HL.midAge(p.instrument), ex = p.exit || {};
      if (age > S.config.staleMs.perp) { if (ex.exitOnStaleFeed && !p.extra.staleExit) { p.extra.staleExit = true; exitPerp(S, p, 'feed unreliable'); } return; }
      if (p.side > 0 ? x <= p.liqPx : x >= p.liqPx) { C.liquidate(S, p, now, x, P.VENUE.takerBps / 1e4); dirty(S); return; }
      if (p.side > 0 ? x <= p.stop : x >= p.stop) { exitPerp(S, p, p.extra.partial ? 'trailing stop' : p.extra.be ? 'breakeven stop' : 'stop'); return; }
      if (ex.kind === 'bracket') {
        if (p.side > 0 ? x >= p.target : x <= p.target) { exitPerp(S, p, 'target'); return; }
        if (!p.extra.be && (p.side > 0 ? x >= ex.breakevenAtPx : x <= ex.breakevenAtPx)) { p.stop = p.avgEntry; p.extra.be = true; C.refreshRisk(S, p); dirty(S); }
      } else if (ex.kind === 'staged') {
        if (!p.extra.partial && (p.side > 0 ? x >= ex.partialAtPx : x <= ex.partialAtPx)) {
          p.extra.partial = true;
          exitPerp(S, p, 'partial target', ex.partialFrac).then(function () { if (S.positions[p.id]) { p.stop = p.avgEntry; C.refreshRisk(S, p); dirty(S); } });
          return;
        }
        if (p.extra.partial) { var tr = p.side > 0 ? x - ex.trailAtrUsd : x + ex.trailAtrUsd; if (p.side > 0 ? tr > p.stop : tr < p.stop) { p.stop = tr; C.refreshRisk(S, p); dirty(S); } }
      }
      if (now - p.openedAt >= p.maxHoldMs) { exitPerp(S, p, 'max hold'); return; }
      if (ex.flatUtc && Math.floor(now / C.DAY) !== Math.floor(p.openedAt / C.DAY)) exitPerp(S, p, 'session close');
    });
  }

  async function exitPerp(st, p, reason, frac, nxTenths) {
    if (busy[p.id]) return; busy[p.id] = 1;
    try {
      var u = HL.universe[p.instrument], dp = u ? u.szDecimals : 4, q = frac ? C.roundTo(p.qty * frac, dp) : p.qty;
      if (!(q > 0)) return;
      var o = C.createOrder(st, Date.now(), { intent: 'close', positionId: p.id, strategy: p.strategy, version: p.version, engine: 'perp', instrument: p.instrument, side: -p.side, qty: q, refPx: HL.price(p.instrument), reason: reason });
      var bk = await nextBook(p.instrument, o.ts), ts = Date.now();
      if (!bk) { C.rejectOrder(st, ts, o, 'no order book for the exit'); return; }
      var w = P.walkBook(bk, -p.side, q, 500), fq = w.complete ? q : C.roundTo(w.filled, dp);
      if (!(fq > 0)) { C.rejectOrder(st, ts, o, 'no liquidity within 5% of mid'); return; }
      C.applyFill(st, o, { qty: fq, px: w.avgPx, feeUsd: fq * w.avgPx * (P.VENUE.takerBps / 1e4 + (nxTenths || 0) / 1e5), halfSpreadBps: bk.spreadBps / 2, ts: ts }, { reason: reason });
      if (o.status === 'partially_filled') C.transition(o, 'cancelled', ts, 'remainder retried next tick');
    } catch (e) { C.audit(st, Date.now(), 'simulator', 'error', e.message); }
    finally { delete busy[p.id]; dirty(st); }
  }

  var fundingBusy = false;
  async function fundingTick() {
    var h = Math.floor(Date.now() / HOUR); if (fundingBusy) return; fundingBusy = true;
    try {
      for (var k = 0; k < 2; k++) {
        var st = [S, M][k], last = st.counters.fundHour || h;
        if (h > last) {
          var perps = vals(st.positions).filter(function (p) { return p.kind === 'perp'; });
          for (var i = 0; i < perps.length; i++) {
            var p = perps[i], u = HL.universe[p.instrument];
            if (h - last > 1) {
              var hist = await HL.fundingHistory(p.instrument, Math.max(p.openedAt, last * HOUR)).catch(function () { return []; });
              hist.forEach(function (e) { var ts = Math.round(e.time / HOUR) * HOUR; if (ts > p.openedAt && st.positions[p.id]) C.accrueFunding(st, p, ts, parseFloat(e.fundingRate), u ? u.oracle : p.avgEntry); });
            } else if (u && isFinite(u.funding) && p.openedAt < h * HOUR) C.accrueFunding(st, p, h * HOUR, u.funding, u.oracle || u.mark);
          }
          dirty(st);
        }
        st.counters.fundHour = h;
      }
    } finally { fundingBusy = false; }
  }

  var runningSol = false;
  async function solCycle() {
    if (runningSol) return; runningSol = true;
    try {
      var XP = X.PARAMS;
      if (SOL.health.jupiter.ok === false) await SOL.quote(X.USDC, 'So11111111111111111111111111111111111111112', 1e6).catch(function () {});
      await SOL.discover();
      var held = vals(S.positions).concat(vals(M.positions)).filter(function (p) { return p.kind === 'spot'; }).map(function (p) { return p.instrument; })
        .concat(lsGet('nx_live_sol_v1', []).map(function (x) { return x.mint; }));
      var mints = uniq(Object.keys(SOL.discovered).sort(function (a, b) { return SOL.discovered[b].lastSeen - SOL.discovered[a].lastSeen; }).slice(0, 90).concat(held));
      await SOL.resolve(mints);
      var now = Date.now();
      var rows = mints.filter(function (m) { return SOL.pairs[m] && SOL.pairs[m].id; }).map(function (m) { var id = SOL.pairs[m].id; return { m: m, id: id, f: X.features(id.pair, null, SOL.hist[m], now) }; });
      var basic = function (r) { return r.f.ageMin >= XP.minAgeMin && r.f.liqUsd >= XP.minLiqUsd && r.f.vol1h >= XP.minVol1hUsd; };
      await SOL.geckoPools(rows.filter(basic).sort(function (a, b) { return b.f.liqUsd - a.f.liqUsd; }).slice(0, 30).map(function (r) { return r.id.pool; }));
      now = Date.now();
      var post = P.posterior(XP.prior, closedFor(S, 'sol.discovery'));
      rows.forEach(function (r) { var g = SOL.gecko[r.id.pool]; r.f = X.features(r.id.pair, g && now - g.ts < 180000 ? g.a : null, SOL.hist[r.m], now); r.ev = X.evaluateToken(r.id, r.f, null, null); });
      var pre = rows.filter(function (r) { return ['IDENTITY', 'POOL_AGE', 'LIQUIDITY', 'VOLUME'].every(function (k) { return r.ev.gates.filter(function (g) { return g[0] === k; })[0][1]; }); });
      var shortlist = pre.slice().sort(function (a, b) { return b.ev.score.S - a.ev.score.S; }).slice(0, 6);
      for (var i = 0; i < shortlist.length; i++) {
        var r = shortlist[i], rep = await SOL.report(r.m);
        r.flags = X.riskFlags(rep.r, rep.ts, r.f);
        if (!r.flags.some(function (x) { return x.sev === 'high'; })) r.q = await SOL.roundTrip(r.m, XP.probeUsd, r.f.priceUsd);
        r.ev = X.edge(X.evaluateToken(r.id, r.f, r.flags, r.q || null), post); r.checked = true;
      }
      SV.rows = shortlist; SV.ts = Date.now();
      SV.funnel = { discovered: Object.keys(SOL.discovered).length, resolved: rows.length, basic: pre.length };
      for (var j = 0; j < shortlist.length; j++) if (shortlist[j].ev.eligible) await recordSpot(shortlist[j], post);
    } catch (e) { console.warn('solCycle', e); } finally { runningSol = false; }
  }

  async function recordSpot(r, post) {
    var key = 'sol:' + r.m + ':' + Math.floor(Date.now() / (15 * MIN));
    if (seen.has(key)) return; seen.add(key);
    var ev = r.ev, now = Date.now();
    var rec = C.recordSignal(S, { key: key, ts: now, engine: 'spot', strategy: 'sol.discovery', version: X.PARAMS.version, featureSet: X.PARAMS.featureSet, instrument: r.m, label: r.id.symbol,
      direction: 1, score: +ev.score.S.toFixed(2), entryPx: r.f.priceUsd, stopPx: r.f.priceUsd * (1 - X.PARAMS.stopPct / 100), exit: ev.exit, edge: ev.edge, checks: ev.gates.concat(ev.checks),
      failed: ev.failed, flags: r.flags, quote: r.q, stress: ev.stress, features: JSON.parse(JSON.stringify(r.f)), post: { p: post.p, n: post.n }, status: ev.trigger ? 'pending' : 'filtered' });
    dirty(S);
    if (!ev.trigger) return;
    var XP = X.PARAMS;
    var dec = C.evaluate(S, { signalId: rec.id, strategy: 'sol.discovery', version: XP.version, engine: 'spot', instrument: r.m, side: 1, entryPx: r.f.priceUsd, stopPx: r.f.priceUsd * (1 - XP.stopPct / 100),
      exitPolicy: ev.exit, expectedEdgeBps: ev.edge.expBps, minEdgeBps: XP.minEdgeBps, dataAgeMs: now - SOL.pairs[r.m].ts, stressLossFrac: ev.stress.frac, maxNotionalByLiquidity: r.f.liqUsd * 0.005 }, { now: now, marks: marksOf(S) });
    rec.decisionId = dec.id; rec.status = dec.approved ? 'approved' : 'rejected'; rec.reasons = dec.reasons; dirty(S);
    if (dec.approved) await buySpotPaper(S, dec, r.m, r.id, r.f, r.q && r.q.decimals, ev.exit, ev.stress.frac, 0, rec.id);
  }

  /* Paper spot buy at an executable Jupiter quote. nxBps = simulated Nexxore commission. */
  async function buySpotPaper(st, dec, mint, id, f, decimals, exit, stressFrac, nxBps, signalId) {
    var XP = X.PARAMS;
    var o = C.createOrder(st, Date.now(), { intent: 'open', decisionId: dec.id, signalId: signalId, strategy: dec.strategy, version: dec.version, engine: 'spot', instrument: mint, side: 1, qty: dec.notional / f.priceUsd, notional: dec.notional, refPx: f.priceUsd });
    var q;
    try { q = await SOL.quote(X.USDC, mint, dec.notional * 1e6); } catch (e) { C.rejectOrder(st, Date.now(), o, 'no executable buy route'); dirty(st); return 'No executable buy route.'; }
    var d = decimals != null ? decimals : X.inferDecimals(+q.outAmount, dec.notional, f.priceUsd);
    if (d == null) { C.rejectOrder(st, Date.now(), o, 'token decimals unresolved'); dirty(st); return 'Could not resolve token decimals.'; }
    var ts = Date.now(), raw = Math.floor(+q.outAmount * (1 - XP.landSlipPct / 100)), qty = raw / Math.pow(10, d), fillPx = dec.notional / qty;
    o.qty = qty; o.history.push({ status: o.status, ts: ts, reason: 'quantity from executable quote' });
    C.applyFill(st, o, { qty: qty, px: fillPx, feeUsd: XP.priorityFeeUsd + dec.notional * (nxBps || 0) / 1e4, halfSpreadBps: null, ts: ts }, {
      stop: exit.stopPx || fillPx * (1 - XP.stopPct / 100), target: exit.tpPx || null, maxHoldMs: exit.maxHoldMs, exit: exit, stressLossFrac: stressFrac,
      extra: { mint: mint, pool: id && id.pool, dex: id && id.dex, symbol: id && id.symbol, decimals: d, rawQty: raw, entryLiq: f.liqUsd } });
    dirty(st); return null;
  }

  var runningSpot = false;
  async function manageSpot() {
    if (runningSpot) return; runningSpot = true;
    try {
      var all = vals(S.positions).map(function (p) { return [S, p]; }).concat(vals(M.positions).map(function (p) { return [M, p]; })).filter(function (x) { return x[1].kind === 'spot'; });
      if (!all.length) return;
      await SOL.resolve(uniq(all.map(function (x) { return x[1].instrument; })));
      for (var i = 0; i < all.length; i++) {
        var st = all[i][0], p = all[i][1], now = Date.now(), pr = SOL.pairs[p.instrument];
        if (busy[p.id] || !st.positions[p.id] || !pr || !pr.id) continue;
        var f = X.features(pr.id.pair, null, SOL.hist[p.instrument], now);
        st.lastMark[p.instrument] = f.priceUsd; p.extra.liq = f.liqUsd;
        var reason = null;
        if (st === S) {
          X.updateTrail(p, f.priceUsd);
          var rep = await SOL.report(p.instrument); reason = X.exitDecision(p, f, X.riskFlags(rep.r, rep.ts, f), now);
        } else {
          if (p.target && f.priceUsd >= p.target) reason = 'take profit';
          else if (f.priceUsd <= p.stop) reason = 'stop';
          else if (p.extra.entryLiq && f.liqUsd <= p.extra.entryLiq * 0.7) reason = 'liquidity dropped 30%';
        }
        if (reason) await exitSpot(st, p, reason, st === M ? (CFG.jupiter.feeBps || 0) : 0);
        dirty(st);
      }
    } catch (e) { console.warn('manageSpot', e); } finally { runningSpot = false; }
  }

  async function exitSpot(st, p, reason, nxBps) {
    if (busy[p.id]) return; busy[p.id] = 1;
    try {
      var XP = X.PARAMS;
      var o = C.createOrder(st, Date.now(), { intent: 'close', positionId: p.id, strategy: p.strategy, version: p.version, engine: 'spot', instrument: p.instrument, side: -1, qty: p.qty, refPx: st.lastMark[p.instrument] || p.avgEntry, reason: reason });
      var q;
      try { q = await SOL.quote(p.instrument, X.USDC, p.extra.rawQty); }
      catch (e) { p.extra.exitFails = (p.extra.exitFails || 0) + 1; C.rejectOrder(st, Date.now(), o, 'no executable sell route — retrying'); return; }
      var impact = parseFloat(q.priceImpactPct) * 100;
      if (impact > XP.maxExitImpactPct && !/liquidity|risk|max hold|manual/.test(reason) && (p.extra.exitFails || 0) < 3) {
        p.extra.exitFails = (p.extra.exitFails || 0) + 1; C.rejectOrder(st, Date.now(), o, 'sell impact ' + impact.toFixed(1) + '% — retrying'); return;
      }
      var got = +q.outAmount / 1e6 * (1 - XP.landSlipPct / 100), ts = Date.now();
      C.applyFill(st, o, { qty: p.qty, px: got / p.qty, feeUsd: XP.priorityFeeUsd + got * (nxBps || 0) / 1e4, halfSpreadBps: null, ts: ts }, { reason: reason });
    } catch (e) { C.audit(st, Date.now(), 'simulator', 'error', e.message); }
    finally { delete busy[p.id]; dirty(st); }
  }

  /* --------------------------------------------- your paper trades (M) */

  function manageManual() {
    var now = Date.now(), nx = CFG.hyperliquid.feeTenthsBps || 0;
    vals(M.positions).filter(function (p) { return p.kind === 'perp' && !busy[p.id]; }).forEach(function (p) {
      if (p.extra.hedgeOf) { if (!M.positions[p.extra.hedgeOf]) exitPerp(M, p, 'hedged position closed', null, nx); return; }
      var x = HL.price(p.instrument); if (!x || HL.midAge(p.instrument) > M.config.staleMs.perp) return;
      if (p.side > 0 ? x <= p.liqPx : x >= p.liqPx) { C.liquidate(M, p, now, x, P.VENUE.takerBps / 1e4); dirty(M); return; }
      if (p.target && (p.side > 0 ? x >= p.target : x <= p.target)) { exitPerp(M, p, 'take profit', null, nx); return; }
      var hit = p.side > 0 ? x <= p.stop : x >= p.stop;
      if (!hit) return;
      if ((p.exit || {}).mode === 'hedge') { if (!p.extra.hedgeId && !p.extra.hedging) openPaperHedge(p); }
      else exitPerp(M, p, 'stop', null, nx);
    });
  }

  /* Hedge leg: opposite side in BTC sized by beta, so the position's market exposure goes flat. */
  async function openPaperHedge(p) {
    p.extra.hedging = true;
    try {
      var u = HL.universe.BTC, x = HL.price(p.instrument), b = HL.price('BTC');
      var beta = p.extra.beta || 1, notional = p.qty * x * Math.abs(beta), lev = p.extra.lev || 1;
      var d = C.evaluateManual(M, { engine: 'perp', instrument: 'BTC', side: -p.side * Math.sign(beta || 1), entryPx: b, margin: notional / lev, leverage: lev, venueMaxLev: u.maxLeverage,
        dataAgeMs: HL.midAge('BTC'), szDecimals: u.szDecimals, hedgeOf: p.id }, { now: Date.now(), marks: marksOf(M) });
      if (!d.approved) { C.audit(M, Date.now(), 'user', 'hedge-rejected', humanReasons(d.reasons), { position: p.id }); dirty(M); return; }
      var o = C.createOrder(M, Date.now(), { intent: 'open', decisionId: d.id, strategy: 'manual', version: '1', engine: 'perp', instrument: 'BTC', side: d.side, qty: d.qty, refPx: b, reason: 'hedge ' + p.instrument });
      var f = await fillPerpEntry(M, o, u, 50, CFG.hyperliquid.feeTenthsBps || 0, { stop: 0, exit: { kind: 'hedge' }, extra: { lev: lev, hedgeOf: p.id, mmFrac: 1 / (2 * u.maxLeverage) }, thesis: 'hedge for ' + p.instrument });
      if (f) { p.extra.hedgeId = o.positionId; C.audit(M, Date.now(), 'system', 'hedge', 'stop hit on ' + p.instrument + ': hedged with BTC (β ' + beta.toFixed(2) + ')', { position: p.id }); }
    } finally { p.extra.hedging = false; dirty(M); }
  }

  /* ------------------------------------------------------ wallets / live */

  var W = { evm: null, hl: null, hlState: null, hlTs: 0, sol: null, solProv: null };
  var LIVE_META = 'nx_live_meta_v1', LIVE_SOL = 'nx_live_sol_v1', EXEC_LOG = 'nx_exec_log_v1';
  var libsReady = null;
  function loadLibs(needSol) {
    var base = libsReady || (libsReady = Promise.all([
      window.ethers ? null : loadScript('https://cdnjs.cloudflare.com/ajax/libs/ethers/6.13.4/ethers.umd.min.js'),
      window.MessagePack ? null : loadScript('https://cdn.jsdelivr.net/npm/@msgpack/msgpack@2.8.0/dist.es5+umd/msgpack.min.js')
    ]));
    return base.then(function () { return needSol && !window.solanaWeb3 ? loadScript('https://unpkg.com/@solana/web3.js@1.95.3/lib/index.iife.min.js') : null; })
      .then(function () { E.init({ ethers: window.ethers, msgpack: window.MessagePack, web3: window.solanaWeb3 }); });
  }
  async function connectEvm() {
    if (!window.ethereum) throw new Error('No EVM wallet found. Install MetaMask or Rabby, then reload.');
    await loadLibs(false);
    var a = await window.ethereum.request({ method: 'eth_requestAccounts' });
    W.evm = a[0]; W.hl = new E.HLSession(window.ethereum, W.evm); pollHL();
    if (window.ethereum.on && !W.evmHooked) { W.evmHooked = true; window.ethereum.on('accountsChanged', function (x) { W.evm = x[0] || null; W.hl = W.evm ? new E.HLSession(window.ethereum, W.evm) : null; W.hlState = null; render(); }); }
    render();
  }
  function solProvider() { return (window.phantom && window.phantom.solana) || window.solflare || (window.backpack && window.backpack.solana) || window.solana || null; }
  async function connectSol() {
    var pv = solProvider(); if (!pv) throw new Error('No Solana wallet found. Install Phantom, Solflare or Backpack, then reload.');
    var r = await pv.connect(); W.solProv = pv; W.sol = (r && r.publicKey ? r.publicKey : pv.publicKey).toString();
    await loadLibs(true); render();
  }
  async function pollHL() {
    if (!W.hl) return;
    try { W.hlState = await W.hl.state(); W.hlTs = Date.now(); } catch (e) {}
  }
  function logExec(e) { var l = lsGet(EXEC_LOG, []); l.push(Object.assign({ ts: Date.now() }, e)); lsSet(EXEC_LOG, l.slice(-500)); }
  function hlHint(msg) {
    if (/does not exist|not found|Insufficient margin|must deposit/i.test(msg)) return msg + ' Deposit USDC to Hyperliquid first (app.hyperliquid.xyz → Deposit).';
    if (/builder/i.test(msg)) return msg + ' (the Nexxore builder address must hold ≥100 USDC on Hyperliquid).';
    return msg;
  }

  async function execHL(t, say) {
    if (!W.hl) { say('Connect your wallet…'); await connectEvm(); }
    var u = HL.universe[t.coin], cfg = CFG.hyperliquid; if (!u) throw new Error('Unknown market');
    if (!W.hl.agent) { say('Approve the Nexxore trading key in your wallet. One time. It can place orders but cannot withdraw.'); await W.hl.ensureAgent(); }
    if (cfg.builder) { say('Approve the Nexxore fee (up to ' + E.feeRateString(cfg.feeTenthsBps) + ') in your wallet. One time.'); await W.hl.ensureBuilder(cfg.builder, cfg.feeTenthsBps); }
    say('Setting ' + t.lev + '× isolated…');
    await W.hl.l1(E.leverageAction(u.idx, t.lev, false));
    var mid = HL.price(t.coin), builder = cfg.builder ? { b: cfg.builder, f: cfg.feeTenthsBps } : null;
    var action = E.bracket({ asset: u.idx, szDecimals: u.szDecimals, isBuy: t.side > 0, mid: mid, size: t.margin * t.lev / mid, tpPx: t.tpPx, slPx: t.mode === 'stop' ? t.slPx : null, slippagePct: CFG.slippagePct }, builder);
    say('Placing order…');
    var st = E.statuses(await W.hl.l1(action));
    if (!st[0] || !st[0].ok) throw new Error(st[0] ? st[0].error : 'no response');
    if (st[0].kind !== 'filled') throw new Error('Entry did not fill at the limit (' + CFG.slippagePct + '% from mid). Nothing is open.');
    var notional = st[0].sz * st[0].px;
    var meta = lsGet(LIVE_META, {}); meta[t.coin] = { tp: t.tpPx, stop: t.slPx, mode: t.mode, beta: t.beta || 1, entry: st[0].px, side: t.side, ts: Date.now(), hedged: false }; lsSet(LIVE_META, meta);
    logExec({ venue: 'hyperliquid', market: t.coin, side: t.side, size: st[0].sz, px: st[0].px, notional: notional, nxFee: builder ? E.builderFeeUsd(notional, cfg.feeTenthsBps) : 0 });
    pollHL();
    return 'Filled ' + st[0].sz + ' ' + t.coin + ' at ' + px(st[0].px) + '. ' + (t.mode === 'stop' ? 'Take-profit and stop are live on Hyperliquid.' : 'Take-profit is live on Hyperliquid. Hedge mode: you get a hedge signal here at ' + px(t.slPx) + '.');
  }
  async function closeHL(coin, szi) {
    var u = HL.universe[coin], cfg = CFG.hyperliquid, builder = cfg.builder ? { b: cfg.builder, f: cfg.feeTenthsBps } : null, mid = HL.price(coin);
    var st = E.statuses(await W.hl.l1(E.closeAction(u.idx, u.szDecimals, szi, mid, 2, builder)));
    if (!st[0] || !st[0].ok) throw new Error(st[0] ? st[0].error : 'no response');
    if (st[0].kind === 'filled') logExec({ venue: 'hyperliquid', market: coin, side: szi > 0 ? -1 : 1, size: st[0].sz, px: st[0].px, notional: st[0].sz * st[0].px, nxFee: builder ? E.builderFeeUsd(st[0].sz * st[0].px, cfg.feeTenthsBps) : 0, close: true });
    pollHL();
  }
  async function hedgeHL(coin, szi) {
    var meta = lsGet(LIVE_META, {}), m = meta[coin] || {}, u = HL.universe.BTC, cfg = CFG.hyperliquid, builder = cfg.builder ? { b: cfg.builder, f: cfg.feeTenthsBps } : null;
    var b = HL.price('BTC'), x = HL.price(coin), beta = m.beta || 1, isBuy = szi < 0;
    var sz = E.roundSz(Math.abs(szi) * x * Math.abs(beta) / b, u.szDecimals);
    var st = E.statuses(await W.hl.l1(E.orderAction([E.limitWire(u.idx, isBuy, E.slippagePx(b, isBuy, CFG.slippagePct, u.szDecimals), sz, false, 'Ioc')], 'na', builder)));
    if (!st[0] || !st[0].ok || st[0].kind !== 'filled') throw new Error(st[0] && st[0].error || 'hedge did not fill');
    m.hedged = true; m.hedgeSz = st[0].sz; meta[coin] = m; lsSet(LIVE_META, meta);
    logExec({ venue: 'hyperliquid', market: 'BTC', side: isBuy ? 1 : -1, size: st[0].sz, px: st[0].px, notional: st[0].sz * st[0].px, nxFee: builder ? E.builderFeeUsd(st[0].sz * st[0].px, cfg.feeTenthsBps) : 0, hedgeFor: coin });
    pollHL();
  }

  async function execJup(t, say) {
    if (!W.sol) { say('Connect your Solana wallet…'); await connectSol(); }
    await loadLibs(true);
    say('Getting a route…');
    var order = await E.jupOrder(X.USDC, t.mint, t.margin * 1e6, W.sol, CFG.jupiter);
    say('Confirm the swap in your wallet…');
    var res = await E.jupSwap(W.solProv, order);
    var raw = +(res.outputAmountResult || order.outAmount), price = solPrice(t.mint) || t.price, dec = X.inferDecimals(raw, t.margin, price);
    var list = lsGet(LIVE_SOL, []);
    list.push({ mint: t.mint, symbol: t.symbol, rawQty: raw, decimals: dec, cost: t.margin, entryPx: dec != null ? t.margin / (raw / Math.pow(10, dec)) : price, tp: t.tpPx, stop: t.slPx, ts: Date.now(), sig: res.signature });
    lsSet(LIVE_SOL, list);
    logExec({ venue: 'jupiter', market: t.symbol, mint: t.mint, side: 1, notional: t.margin, nxFee: CFG.jupiter.referralAccount ? t.margin * CFG.jupiter.feeBps / 1e4 : 0, tx: res.signature });
    return 'Bought. Transaction ' + shortAddr(res.signature) + '.';
  }
  async function sellJup(i) {
    var list = lsGet(LIVE_SOL, []), p = list[i]; if (!p) return;
    if (!W.sol) await connectSol();
    await loadLibs(true);
    var raw = p.rawQty;
    try { var bal = await E.jupBalances(W.sol); if (bal[p.mint] && +bal[p.mint].amount > 0) raw = +bal[p.mint].amount; } catch (e) {}
    var order = await E.jupOrder(p.mint, X.USDC, raw, W.sol, CFG.jupiter);
    var res = await E.jupSwap(W.solProv, order), got = +(res.outputAmountResult || order.outAmount) / 1e6;
    list.splice(i, 1); lsSet(LIVE_SOL, list);
    logExec({ venue: 'jupiter', market: p.symbol, mint: p.mint, side: -1, notional: got, nxFee: CFG.jupiter.referralAccount ? got * CFG.jupiter.feeBps / 1e4 : 0, tx: res.signature, close: true });
  }

  /* ------------------------------------------------------------- ticket */

  var tab = 'perps';
  var prefs = Object.assign({ perps: { venue: 'paper', margin: 100, lev: 3, mode: 'stop' }, solana: { venue: 'paper', margin: 50 } }, lsGet('nx_ticket_v1', {}));
  var T = { perps: null, solana: null };
  var cexShown = null;
  function savePrefs() { lsSet('nx_ticket_v1', prefs); }

  /* Stop/target for any row: the model's own levels when a setup formed, otherwise
     the same volatility rule it would use (B: 1.5×ATR15, A: 1.5×ATR1m; target 2R). */
  function planFor(x) {
    var s = x.r.sig, f = x.r.f, P2 = P.PARAMS[x.m === 'A' ? 'perp.scalp' : 'perp.intraday'];
    if (s.stopPx && s.targetPx) return { stop: s.stopPx, target: s.targetPx };
    var p0 = f.mid || f.px, atr = x.m === 'A' ? 1.5 * f.atr1 : P2.stopAtr * f.atr15;
    var d = Math.max(atr || 0, p0 * P2.stopMinBps / 1e4);
    return { stop: p0 - s.dir * d, target: p0 + s.dir * 2 * d };
  }
  function selectPerp(coin, sig, f) {
    var x = HL.price(coin) || (f && f.px);
    var sl = sig && sig.stopPx && x ? Math.abs(x - sig.stopPx) / x * 100 : 2;
    var tp = sig && sig.targetPx && x ? Math.abs(sig.targetPx - x) / x * 100 : sl * 2;
    var beta = f && f.betaBtc;
    if (beta == null) { var b = PV.rowsB.filter(function (r) { return r.u.coin === coin; })[0]; beta = b ? b.f.betaBtc : null; }
    T.perps = { coin: coin, side: sig ? sig.dir : 1, slPct: +sl.toFixed(2), tpPct: +tp.toFixed(2), beta: beta == null ? 1 : +beta.toFixed(2), model: sig ? sig.model : null };
    cexShown = null; buildTicket();
  }
  function selectToken(r) {
    T.solana = { mint: r.m, symbol: r.id.symbol, slPct: X.PARAMS.stopPct, tpPct: 25, price: r.f.priceUsd, decimals: r.q && r.q.decimals };
    buildTicket();
  }

  function segHtml(name, opts, cur, extraCls) {
    return '<div class="seg ' + (extraCls || '') + '" data-seg="' + name + '">' + opts.map(function (o) {
      return '<button type="button" data-v="' + o[0] + '" aria-pressed="' + (String(o[0]) === String(cur)) + '"' + (o[2] ? ' disabled title="' + esc(o[2]) + '"' : '') + '>' + o[1] + '</button>';
    }).join('') + '</div>';
  }

  function buildTicket() {
    var el = $('ticket');
    if (tab === 'equities') { el.hidden = true; return; }
    el.hidden = false;
    if (tab === 'perps') {
      var t = T.perps, pf = prefs.perps;
      if (!t) { el.innerHTML = '<div class="faint" style="font-size:13px">Pick a signal to trade it.</div>'; return; }
      var u = HL.universe[t.coin], venMax = Math.min(CFG.maxLeverage, u ? u.maxLeverage : 10);
      var levs = [1, 2, 3, 5, 10].map(function (l) { return [l, l + '×', l > venMax ? 'max ' + venMax + '× on ' + t.coin : null]; });
      if (pf.lev > venMax) pf.lev = venMax;
      el.innerHTML =
        '<div class="t-head"><span class="mk">' + esc(t.coin) + '-PERP</span><span class="px" id="tPx">—</span></div>' +
        (t.model ? '<div class="t-sub">' + (t.model === 'A' ? 'Scalp signal' : 'Intraday signal') + '</div>' : '') +
        segHtml('side', [[1, 'Long'], [-1, 'Short']], t.side, 'side') +
        '<div class="fl"><span>Venue</span></div>' +
        segHtml('venue', [['paper', 'Paper'], ['hyperliquid', 'Hyperliquid'], ['binance', 'Binance'], ['bybit', 'Bybit'], ['okx', 'OKX']], pf.venue) +
        '<div class="fl"><span>Margin</span></div><div class="inp"><input id="tMargin" inputmode="decimal" value="' + pf.margin + '" aria-label="Margin in USDC"><span>USDC</span></div>' +
        '<div class="fl"><span>Leverage</span><span>isolated</span></div>' + segHtml('lev', levs, pf.lev) +
        '<div class="fl"><span>Take profit</span><span id="tTpPx"></span></div><div class="inp"><input id="tTp" inputmode="decimal" value="' + t.tpPct + '" aria-label="Take profit percent"><span>%</span></div>' +
        '<div class="chips">' + [1, 2, 3].map(function (k) { return '<button type="button" data-r="' + k + '">' + k + 'R</button>'; }).join('') + '</div>' +
        '<div class="fl"><span>Stop</span><span id="tSlPx"></span></div><div class="inp"><input id="tSl" inputmode="decimal" value="' + t.slPct + '" aria-label="Stop percent"><span>%</span></div>' +
        '<div class="fl"><span>At the stop</span><span id="tHedgeNote"></span></div>' + segHtml('mode', [['stop', 'Close'], ['hedge', 'Hedge with BTC']], pf.mode) +
        '<div class="sum" id="tSum"></div>' +
        '<button class="go" id="tGo" type="button"></button><div class="msg" id="tMsg"></div><div id="tCex"></div>';
    } else {
      var s = T.solana, ps = prefs.solana;
      if (!s) { el.innerHTML = '<div class="faint" style="font-size:13px">Pick a token to trade it.</div>'; return; }
      el.innerHTML =
        '<div class="t-head"><span class="mk">' + esc(s.symbol) + '</span><span class="px" id="tPx">—</span></div>' +
        '<div class="t-sub"><a href="https://solscan.io/token/' + esc(s.mint) + '" target="_blank" rel="noopener">' + shortAddr(s.mint) + '</a> · spot, no leverage</div>' +
        '<div class="fl"><span>Venue</span></div>' + segHtml('venue', [['paper', 'Paper'], ['jupiter', 'Jupiter']], ps.venue) +
        '<div class="fl"><span>Amount</span></div><div class="inp"><input id="tMargin" inputmode="decimal" value="' + ps.margin + '" aria-label="Amount in USDC"><span>USDC</span></div>' +
        '<div class="fl"><span>Take profit</span><span id="tTpPx"></span></div><div class="inp"><input id="tTp" inputmode="decimal" value="' + s.tpPct + '" aria-label="Take profit percent"><span>%</span></div>' +
        '<div class="fl"><span>Stop</span><span id="tSlPx"></span></div><div class="inp"><input id="tSl" inputmode="decimal" value="' + s.slPct + '" aria-label="Stop percent"><span>%</span></div>' +
        '<div class="sum" id="tSum"></div>' +
        '<button class="go" id="tGo" type="button"></button><div class="msg" id="tMsg"></div>' +
        '<div class="note">Paper and Jupiter positions are watched here. When take-profit or stop is hit you get a sell signal; Jupiter sells need your wallet to confirm.</div>';
    }
    updateTicket();
  }

  function ticketValues() {
    var perps = tab === 'perps', t = perps ? T.perps : T.solana, pf = perps ? prefs.perps : prefs.solana;
    var x = perps ? HL.price(t.coin) : (solPrice(t.mint) || t.price);
    var margin = parseFloat($('tMargin').value) || 0, tp = parseFloat($('tTp').value) || 0, sl = parseFloat($('tSl').value) || 0;
    var side = perps ? t.side : 1, lev = perps ? pf.lev : 1;
    return { x: x, margin: margin, tp: tp, sl: sl, side: side, lev: lev, notional: margin * lev,
      tpPx: x && tp > 0 ? x * (1 + side * tp / 100) : null, slPx: x && sl > 0 ? x * (1 - side * sl / 100) : null };
  }

  function updateTicket() {
    if (tab === 'equities' || !$('tGo')) return;
    var perps = tab === 'perps', t = perps ? T.perps : T.solana; if (!t) return;
    var pf = perps ? prefs.perps : prefs.solana, v = ticketValues();
    $('tPx').textContent = px(v.x);
    $('tTpPx').textContent = v.tpPx ? px(v.tpPx) : '';
    $('tSlPx').textContent = v.slPx ? px(v.slPx) : '';
    var feeLine, venueFee, rows = [];
    if (perps) {
      var u = HL.universe[t.coin] || { maxLeverage: 20 }, mm = 1 / (2 * u.maxLeverage);
      var liq = v.x ? (v.side > 0 ? v.x * (1 - 1 / v.lev) / (1 - mm) : v.x * (1 + 1 / v.lev) / (1 + mm)) : null;
      venueFee = v.notional * P.VENUE.takerBps / 1e4 * 2;
      var nx = CFG.hyperliquid.feeTenthsBps, nxUsd = E.builderFeeUsd(v.notional, nx) * 2;
      if (pf.venue === 'hyperliquid') feeLine = CFG.hyperliquid.builder ? usd(nxUsd) + ' (' + E.feeRateString(nx) + ' × 2)' : '0 (vault not set)';
      else if (pf.venue === 'paper') feeLine = usd(nxUsd) + ' (simulated)';
      else feeLine = 'via referral';
      var loss = v.notional * v.sl / 100 + venueFee, gain = v.notional * v.tp / 100 - venueFee;
      rows = [['Notional', usd(v.notional)], ['Size', v.x ? (+(v.notional / v.x).toPrecision(5)) + ' ' + esc(t.coin) : '—'], ['Liquidation', v.lev > 1 ? px(liq) : 'none at 1×'],
        [pf.mode === 'hedge' ? 'Loss to hedge point' : 'Loss at stop', '<span class="down">' + usd(-loss) + '</span>'], ['Profit at take profit', '<span class="up">' + sUsd(gain) + '</span>'],
        ['Venue fees', usd(venueFee) + ' (taker, in and out)'], ['Nexxore fee', feeLine]];
      if (v.lev > 1 && liq && v.slPx && (v.side > 0 ? liq >= v.slPx : liq <= v.slPx)) rows.push(['', '<span class="warn">Liquidation comes before your stop. Lower leverage.</span>']);
      $('tHedgeNote').textContent = pf.mode === 'hedge' ? (v.side > 0 ? 'short ' : 'long ') + usd(v.notional * Math.abs(t.beta || 1), 0) + ' BTC (β ' + (t.beta || 1).toFixed(2) + ')' : '';
      var go = $('tGo');
      go.className = 'go' + (t.side < 0 ? ' short' : '');
      go.textContent = pf.venue === 'paper' ? 'Place paper ' + (t.side > 0 ? 'long' : 'short') : pf.venue === 'hyperliquid' ? (t.side > 0 ? 'Long' : 'Short') + ' on Hyperliquid' : 'Open ' + CFG.cex[pf.venue].name + ' ticket';
    } else {
      var nxs = CFG.jupiter.feeBps;
      feeLine = (pf.venue === 'jupiter' ? (CFG.jupiter.referralAccount ? usd(v.margin * nxs / 1e4) + ' (' + (nxs / 100).toFixed(2) + '%)' : '0 (vault not set)') : usd(v.margin * nxs / 1e4) + ' (simulated)');
      rows = [['Amount', usd(v.margin)], ['Loss at stop', '<span class="down">' + usd(-v.margin * v.sl / 100) + '</span>'], ['Profit at take profit', '<span class="up">' + sUsd(v.margin * v.tp / 100) + '</span>'],
        ['Network + priority', '~' + usd(X.PARAMS.priorityFeeUsd * 2)], ['Nexxore fee', feeLine]];
      $('tGo').className = 'go';
      $('tGo').textContent = pf.venue === 'paper' ? 'Place paper buy' : 'Buy with wallet';
    }
    $('tSum').innerHTML = rows.map(function (r) { return '<div><span>' + r[0] + '</span><b>' + r[1] + '</b></div>'; }).join('');
  }

  async function execute() {
    var perps = tab === 'perps', t = perps ? T.perps : T.solana, pf = perps ? prefs.perps : prefs.solana, v = ticketValues();
    var msg = $('tMsg'), go = $('tGo');
    var say = function (s, k) { msg.className = 'msg' + (k ? ' ' + k : ''); msg.textContent = s; };
    if (!(v.margin > 0)) return say('Enter an amount.', 'err');
    if (!(v.sl > 0)) return say('Set a stop.', 'err');
    if (!(v.tp > 0)) return say('Set a take-profit.', 'err');
    if (!v.x) return say('No live price yet.', 'err');
    go.disabled = true;
    try {
      if (perps && pf.venue === 'paper') say(await paperPerp(t, v, pf) || 'Filled on paper.', 'ok');
      else if (perps && pf.venue === 'hyperliquid') {
        if (!confirm((t.side > 0 ? 'Long ' : 'Short ') + t.coin + ' on Hyperliquid with ' + usd(v.margin) + ' margin at ' + pf.lev + '× (' + usd(v.notional) + ' notional). This is a real order. Continue?')) { say(''); return; }
        say(await execHL({ coin: t.coin, side: t.side, margin: v.margin, lev: pf.lev, tpPx: v.tpPx, slPx: v.slPx, mode: pf.mode, beta: t.beta }, say), 'ok');
      } else if (perps) { showCex(pf.venue, t, v); say(''); }
      else if (pf.venue === 'paper') say(await paperSpot(t, v) || 'Bought on paper.', 'ok');
      else {
        if (!confirm('Buy ' + usd(v.margin) + ' of ' + t.symbol + ' with your wallet. This is a real swap. Continue?')) { say(''); return; }
        say(await execJup({ mint: t.mint, symbol: t.symbol, margin: v.margin, price: v.x, tpPx: v.tpPx, slPx: v.slPx }, say), 'ok');
      }
    } catch (e) {
      var m = e && (e.shortMessage || e.message) || String(e);
      if (/user rejected|denied|4001/i.test(m)) m = 'Cancelled in wallet.';
      say(perps ? hlHint(m) : m, 'err');
    } finally { go.disabled = false; render(); }
  }

  async function paperPerp(t, v, pf) {
    var u = HL.universe[t.coin], now = Date.now();
    var d = C.evaluateManual(M, { engine: 'perp', instrument: t.coin, side: t.side, entryPx: v.x, stopPx: v.slPx, margin: v.margin, leverage: pf.lev, venueMaxLev: u.maxLeverage,
      dataAgeMs: HL.midAge(t.coin), szDecimals: u.szDecimals }, { now: now, marks: marksOf(M) });
    dirty(M);
    if (!d.approved) throw new Error(humanReasons(d.reasons));
    var o = C.createOrder(M, now, { intent: 'open', decisionId: d.id, strategy: 'manual', version: '1', engine: 'perp', instrument: t.coin, side: t.side, qty: d.qty, refPx: v.x, reason: 'your trade' });
    var f = await fillPerpEntry(M, o, u, 50, CFG.hyperliquid.feeTenthsBps || 0, { stop: v.slPx, target: v.tpPx, exit: { kind: 'manual', mode: pf.mode }, thesis: t.model ? 'signal ' + t.model : 'manual',
      extra: { lev: pf.lev, beta: t.beta, mmFrac: 1 / (2 * u.maxLeverage) } });
    if (!f) throw new Error('No fill within 0.5% of mid.');
    return 'Filled ' + f.qty + ' ' + t.coin + ' at ' + px(f.px) + ' (paper).';
  }
  async function paperSpot(t, v) {
    var pr = SOL.pairs[t.mint], now = Date.now();
    var d = C.evaluateManual(M, { engine: 'spot', instrument: t.mint, side: 1, entryPx: v.x, stopPx: v.slPx, margin: v.margin, leverage: 1, dataAgeMs: pr ? now - pr.ts : Infinity }, { now: now, marks: marksOf(M) });
    dirty(M);
    if (!d.approved) throw new Error(humanReasons(d.reasons));
    var f = pr && pr.id ? X.features(pr.id.pair, null, SOL.hist[t.mint], now) : { priceUsd: v.x, liqUsd: null };
    var err = await buySpotPaper(M, d, t.mint, pr && pr.id, f, t.decimals, { stopPx: v.slPx, tpPx: v.tpPx, maxHoldMs: Infinity }, 0.25, CFG.jupiter.feeBps || 0, null);
    if (err) throw new Error(err);
    return 'Bought on paper at an executable Jupiter quote.';
  }

  function showCex(ex, t, v) {
    var tk = E.cexTicket(ex, CFG, { coin: t.coin, isBuy: t.side > 0, leverage: prefs.perps.lev, size: v.notional / v.x, tpPx: +px(v.tpPx).replace(/,/g, ''), slPx: prefs.perps.mode === 'stop' ? +px(v.slPx).replace(/,/g, '') : null });
    $('tCex').innerHTML = '<div class="cex">' + tk.rows.map(function (r) { return '<div><span class="faint">' + esc(r[0]) + '</span><b>' + esc(r[1]) + '<button type="button" data-copy="' + esc(r[1]) + '">copy</button></b></div>'; }).join('') + '</div>' +
      '<a class="go" style="display:block;text-align:center;text-decoration:none" href="' + esc(tk.url) + '" target="_blank" rel="noopener">Open ' + esc(tk.venue) + ' →</a>' +
      '<div class="note">Place it on ' + esc(tk.venue) + ' with these values. Nexxore earns a referral rebate from the exchange; nothing is added to your fees.' + (prefs.perps.mode === 'hedge' ? ' Hedge mode: watch for the hedge signal here, then short BTC on ' + esc(tk.venue) + '.' : '') + '</div>';
    logExec({ venue: ex, market: t.coin, side: t.side, notional: v.notional, ticket: true });
  }

  /* --------------------------------------------------------------- render */

  function signalPill(side, entry, mark, stop, tp, mode, hedged) {
    if (hedged) return '<span class="pill warn">Hedged</span>';
    if (tp && (side > 0 ? mark >= tp : mark <= tp)) return '<span class="pill go">Take profit</span>';
    if (stop && (side > 0 ? mark <= stop : mark >= stop)) return mode === 'hedge' ? '<span class="pill bad">Hedge now</span>' : '<span class="pill bad">Stop hit</span>';
    var prog = stop && entry !== stop ? (mark - stop) / (entry - stop) : 1;
    return prog < 0.3 ? '<span class="pill warn">Near stop</span>' : '<span class="pill">OK</span>';
  }

  function renderPerpSignals() {
    var rows = [];
    PV.rowsB.forEach(function (r) { rows.push({ m: 'B', r: r }); });
    PV.rowsA.forEach(function (r) { if (r.sig.trigger || r.sig.checks.some(function (c) { return c[0] === 'BREAKOUT' && c[1]; })) rows.push({ m: 'A', r: r }); });
    rows.sort(function (a, b) { return (b.r.sig.trigger ? 1 : 0) - (a.r.sig.trigger ? 1 : 0) || b.r.sig.score - a.r.sig.score; });
    rows = rows.slice(0, 14);
    PV.view = rows;
    $('sigSub').textContent = 'Hyperliquid' + (PV.scanB ? ' · ' + hhmm(PV.scanB) + ' UTC' : ' · loading');
    var sel = T.perps && T.perps.coin;
    $('sigTable').innerHTML = '<thead><tr><th class="l">Market</th><th class="l">Type</th><th class="l">Side</th><th>Score</th><th>Price</th><th>Stop</th><th>Target</th><th>Hedge</th><th class="l">Status</th></tr></thead><tbody>' +
      (rows.length ? rows.map(function (x, i) {
        var r = x.r, s = r.sig, f = r.f, beta = f.betaBtc != null ? f.betaBtc : (PV.rowsB.filter(function (b) { return b.u.coin === r.u.coin; })[0] || { f: {} }).f.betaBtc;
        return '<tr class="pick' + (sel === r.u.coin ? ' sel' : '') + '" tabindex="0" data-sig="' + esc(x.m + ':' + r.u.coin) + '"><td class="l"><span class="sym">' + esc(r.u.coin) + '</span></td><td class="l dim">' + (x.m === 'A' ? 'Scalp' : 'Intraday') + '</td>' +
          '<td class="l ' + (s.dir > 0 ? 'up' : 'down') + '">' + (s.dir > 0 ? 'Long' : 'Short') + '</td><td>' + s.score.toFixed(0) + '</td><td>' + px(f.mid || f.px) + '</td><td>' + px(planFor(x).stop) + '</td><td>' + px(planFor(x).target) + '</td>' +
          '<td class="dim">' + (beta != null ? beta.toFixed(2) + '× BTC' : '—') + '</td><td class="l">' + (s.trigger ? '<span class="pill go">Signal</span>' : '<span class="pill" title="' + esc((s.failed || []).join(', ')) + '">Watching</span>') + '</td></tr>';
      }).join('') : '<tr><td colspan="9" class="empty">Loading markets…</td></tr>') + '</tbody>';
  }

  function renderPerpPositions() {
    var rows = [], m = marksOf(M), now = Date.now();
    vals(M.positions).filter(function (p) { return p.kind === 'perp'; }).forEach(function (p) {
      var x = m[p.instrument] || p.avgEntry, pnl = C.posValue(p, x), hedge = p.extra.hedgeOf;
      rows.push('<tr><td class="l dim">Paper</td><td class="l"><span class="sym">' + esc(p.instrument) + '</span>' + (hedge ? ' <span class="faint">hedge</span>' : '') + '</td><td class="l ' + (p.side > 0 ? 'up' : 'down') + '">' + (p.side > 0 ? 'Long' : 'Short') + ' ' + (p.extra.lev || 1) + '×</td>' +
        '<td>' + usd(p.qty * x, 0) + '</td><td>' + px(p.avgEntry) + '</td><td>' + px(x) + '</td><td class="' + cls(pnl) + '">' + sUsd(pnl) + '</td><td>' + px(p.target) + '</td><td>' + (hedge ? '—' : px(p.stop)) + '</td>' +
        '<td class="l">' + (hedge ? '<span class="pill warn">Hedge</span>' : signalPill(p.side, p.avgEntry, x, p.stop, p.target, (p.exit || {}).mode, !!p.extra.hedgeId)) + '</td>' +
        '<td><button class="act" type="button" data-pclose="' + p.id + '">Close</button></td></tr>');
    });
    var meta = lsGet(LIVE_META, {});
    ((W.hlState && W.hlState.assetPositions) || []).forEach(function (ap) {
      var q = ap.position, coin = q.coin, szi = +q.szi; if (!szi) return;
      var x = HL.price(coin) || +q.entryPx, mt = meta[coin] || {}, side = szi > 0 ? 1 : -1, hot = mt.mode === 'hedge' && !mt.hedged && mt.stop && (side > 0 ? x <= mt.stop : x >= mt.stop);
      rows.push('<tr><td class="l">Hyperliquid</td><td class="l"><span class="sym">' + esc(coin) + '</span></td><td class="l ' + (side > 0 ? 'up' : 'down') + '">' + (side > 0 ? 'Long' : 'Short') + ' ' + (q.leverage ? q.leverage.value : '') + '×</td>' +
        '<td>' + usd(Math.abs(szi) * x, 0) + '</td><td>' + px(+q.entryPx) + '</td><td>' + px(x) + '</td><td class="' + cls(+q.unrealizedPnl) + '">' + sUsd(+q.unrealizedPnl) + '</td><td>' + px(mt.tp) + '</td><td>' + px(mt.stop) + '</td>' +
        '<td class="l">' + (mt.side ? signalPill(side, +q.entryPx, x, mt.stop, mt.tp, mt.mode, mt.hedged) : '<span class="pill">—</span>') + '</td>' +
        '<td>' + (mt.mode === 'hedge' && !mt.hedged ? '<button class="act' + (hot ? ' hot' : '') + '" type="button" data-hhedge="' + esc(coin) + '" data-szi="' + szi + '">Hedge</button> ' : '') + '<button class="act" type="button" data-hclose="' + esc(coin) + '" data-szi="' + szi + '">Close</button></td></tr>');
    });
    $('posSub').textContent = W.evm ? 'Paper + Hyperliquid ' + shortAddr(W.evm) + (W.hlTs ? ' · ' + dur(now - W.hlTs) + ' ago' : '') : 'Paper · connect a wallet to see Hyperliquid positions';
    $('posTable').innerHTML = '<thead><tr><th class="l">Venue</th><th class="l">Market</th><th class="l">Side</th><th>Value</th><th>Entry</th><th>Mark</th><th>PnL</th><th>Take profit</th><th>Stop</th><th class="l">Signal</th><th></th></tr></thead><tbody>' +
      (rows.length ? rows.join('') : '<tr><td colspan="11" class="empty">No positions.</td></tr>') + '</tbody>';
  }

  function renderSolSignals() {
    var rows = SV.rows.slice().sort(function (a, b) { return (b.ev.trigger ? 2 : b.ev.eligible ? 1 : 0) - (a.ev.trigger ? 2 : a.ev.eligible ? 1 : 0) || b.ev.score.S - a.ev.score.S; });
    $('sigSub').textContent = 'Solana' + (SV.funnel ? ' · ' + SV.funnel.discovered + ' found, ' + SV.funnel.basic + ' liquid, top ' + rows.length + ' checked · ' + hhmm(SV.ts) + ' UTC' : ' · loading');
    var sel = T.solana && T.solana.mint;
    $('sigTable').innerHTML = '<thead><tr><th class="l">Token</th><th>Price</th><th>Liquidity</th><th>1h</th><th>Buys 5m</th><th>Round trip</th><th>Score</th><th class="l">Status</th></tr></thead><tbody>' +
      (rows.length ? rows.map(function (r) {
        var f = r.f, ev = r.ev, high = (r.flags || []).filter(function (x) { return x.sev === 'high'; });
        var st = ev.trigger ? '<span class="pill go">Signal</span>' : high.length ? '<span class="pill bad" title="' + esc(high.map(function (x) { return x.detail; }).join('; ')) + '">Risky</span>' : ev.eligible ? '<span class="pill">Watching</span>' : '<span class="pill" title="' + esc(ev.failed.join(', ')) + '">Not tradable</span>';
        return '<tr class="pick' + (sel === r.m ? ' sel' : '') + '" tabindex="0" data-tok="' + esc(r.m) + '"><td class="l"><span class="sym">' + esc(r.id.symbol) + '</span> <span class="faint">' + shortAddr(r.m) + '</span></td><td>' + px(f.priceUsd) + '</td><td>' + P.fmtUsd(f.liqUsd) + '</td>' +
          '<td class="' + cls(f.px1h) + '">' + (f.px1h == null ? '—' : (f.px1h > 0 ? '+' : '') + f.px1h.toFixed(1) + '%') + '</td><td>' + (f.buyRatio5 == null ? '—' : Math.round(f.buyRatio5 * 100) + '%') + '</td>' +
          '<td>' + (r.q && r.q.roundTripPct != null ? r.q.roundTripPct.toFixed(2) + '%' : '—') + '</td><td>' + ev.score.S.toFixed(0) + '</td><td class="l">' + st + '</td></tr>';
      }).join('') : '<tr><td colspan="8" class="empty">Scanning Solana pools…</td></tr>') + '</tbody>';
  }

  function renderSolPositions() {
    var rows = [], m = marksOf(M);
    vals(M.positions).filter(function (p) { return p.kind === 'spot'; }).forEach(function (p) {
      var x = m[p.instrument] || M.lastMark[p.instrument] || p.avgEntry, v = p.qty * x, pnl = v - p.entryNotional;
      rows.push('<tr><td class="l dim">Paper</td><td class="l"><span class="sym">' + esc(p.extra.symbol || shortAddr(p.instrument)) + '</span></td><td>' + usd(p.entryNotional) + '</td><td>' + usd(v) + '</td><td class="' + cls(pnl) + '">' + sUsd(pnl) + '</td>' +
        '<td>' + px(p.target) + '</td><td>' + px(p.stop) + '</td><td class="l">' + signalPill(1, p.avgEntry, x, p.stop, p.target, 'stop', false) + '</td><td><button class="act" type="button" data-pclose="' + p.id + '">Sell</button></td></tr>');
    });
    lsGet(LIVE_SOL, []).forEach(function (p, i) {
      var x = solPrice(p.mint), v = x && p.decimals != null ? p.rawQty / Math.pow(10, p.decimals) * x : null, pnl = v == null ? null : v - p.cost;
      var sig = x ? signalPill(1, p.entryPx, x, p.stop, p.tp, 'stop', false).replace('Stop hit', 'Sell: stop').replace('Take profit', 'Sell: target') : '<span class="pill">—</span>';
      rows.push('<tr><td class="l">Jupiter</td><td class="l"><span class="sym">' + esc(p.symbol) + '</span></td><td>' + usd(p.cost) + '</td><td>' + usd(v) + '</td><td class="' + cls(pnl) + '">' + sUsd(pnl) + '</td>' +
        '<td>' + px(p.tp) + '</td><td>' + px(p.stop) + '</td><td class="l">' + sig + '</td><td><button class="act" type="button" data-jsell="' + i + '">Sell</button></td></tr>');
    });
    $('posSub').textContent = W.sol ? 'Paper + wallet ' + shortAddr(W.sol) : 'Paper · connect a Solana wallet to trade live';
    $('posTable').innerHTML = '<thead><tr><th class="l">Venue</th><th class="l">Token</th><th>Cost</th><th>Value</th><th>PnL</th><th>Take profit</th><th>Stop</th><th class="l">Signal</th><th></th></tr></thead><tbody>' +
      (rows.length ? rows.join('') : '<tr><td colspan="9" class="empty">No positions.</td></tr>') + '</tbody>';
  }

  function stat(l, v, c) { return '<div>' + l + '<b class="' + (c || '') + '">' + v + '</b></div>'; }
  function renderRecord() {
    if (!$('more').open) return;
    var ids = tab === 'perps' ? ['perp.scalp', 'perp.intraday'] : ['sol.discovery'];
    var h = '<p class="note">The models trade a $10,000 paper account automatically with fixed risk rules. This is their real record since ' + dayTime(S.created) + ' UTC.</p>';
    ids.forEach(function (id) {
      var tr = closedFor(S, id), m = C.metrics(tr, [], C.fromMicro(S.equity0), 0), s = S.strategies[id];
      h += '<div class="kv">' + stat({ 'perp.scalp': 'Scalp', 'perp.intraday': 'Intraday', 'sol.discovery': 'Solana' }[id], s.enabled ? 'on' : 'off') + stat('Trades', m.n) + stat('Win rate', m.n ? pct(m.winRate, 0) : '—') +
        stat('Net', sUsd(m.net), cls(m.net)) + stat('Per trade', m.n ? sUsd(m.expectancy) : '—', cls(m.expectancy)) + stat('Fees paid', usd(m.fees)) + '</div>';
    });
    var paused = !!S.halts.global;
    h += '<button class="act" type="button" id="pauseBtn">' + (paused ? 'Resume automatic paper trading' : 'Pause automatic paper trading') + '</button>';
    if (Object.keys(S.halts).filter(function (k) { return k !== 'global'; }).length) h += ' <span class="warn" style="font-size:12px">' + esc(Object.keys(S.halts).filter(function (k) { return k !== 'global'; }).map(function (k) { return S.halts[k].reason; }).join(' · ')) + '</span>';
    if (tab === 'perps') {
      h += '<div style="margin-top:16px;display:flex;gap:8px;align-items:center;flex-wrap:wrap"><span class="dim" style="font-size:12.5px">Backtest</span>' +
        '<select class="act" id="btModel"><option value="perp.intraday">Intraday · 14 days</option><option value="perp.scalp">Scalp · 3 days</option></select>' +
        '<button class="act" id="btRun" type="button">Run</button></div><div id="btOut">' + (BT.html || '') + '</div>';
    }
    if ($('record').dataset.h !== h) { $('record').innerHTML = h; $('record').dataset.h = h; if (BT.curve) drawCurve($('btChart'), BT.curve, 10000); }
  }

  /* backtest (kept small) */
  var BT = { html: '', curve: null }, worker = null;
  async function runBacktest() {
    var model = $('btModel').value, A = model === 'perp.scalp', ivl = A ? '1m' : '5m', ivlMs = A ? MIN : 5 * MIN, days = A ? 3 : 14;
    var out = $('btOut'), say = function (t) { BT.html = '<p class="note">' + t + '</p>'; out.innerHTML = BT.html; };
    $('btRun').disabled = true;
    try {
      var elig = HL.eligible(P.PARAMS[model].minDayVolume).slice(0, 8), end = Date.now(), start = end - days * C.DAY;
      var get = function (c) { return HL.post({ type: 'candleSnapshot', req: { coin: c, interval: ivl, startTime: start, endTime: end } }).then(function (r) { return P.closedBars(P.parseCandles(r), end, ivlMs); }); };
      var data = { coins: {} }; say('Loading BTC, ETH…'); data.bench = await get('BTC'); data.eth = await get('ETH');
      for (var i = 0; i < elig.length; i++) {
        var u = elig[i]; say('Loading ' + esc(u.coin) + ' (' + (i + 1) + '/' + elig.length + ')…');
        var bk = await HL.book(u.coin).catch(function () { return null; });
        data.coins[u.coin] = { bars: await get(u.coin), funding: await HL.fundingHistory(u.coin, start).catch(function () { return []; }), szDecimals: u.szDecimals, maxLeverage: u.maxLeverage, spreadBps: bk ? Math.max(0.5, bk.spreadBps) : 2, dayVolume: u.dayVolume };
      }
      say('Replaying…');
      worker = worker || new Worker('/js/engines/bt-worker.js');
      var res = await new Promise(function (resolve, reject) {
        worker.onmessage = function (e) { if (e.data.error) reject(new Error(e.data.error)); else if (e.data.results) resolve(e.data.results); };
        worker.postMessage({ id: Date.now(), data: data, runs: [{ model: model }, { model: model, costMult: 2 }] });
      });
      var m = res[0].metrics, m2 = res[1].metrics;
      BT.curve = res[0].curve;
      BT.html = '<div class="kv">' + stat('Trades', m.n) + stat('Net', sUsd(m.net), cls(m.net)) + stat('Win rate', m.n ? pct(m.winRate, 0) : '—') + stat('Profit factor', m.n && isFinite(m.profitFactor) ? m.profitFactor.toFixed(2) : '—') +
        stat('Max drawdown', pct(m.maxDD)) + stat('Fees', usd(m.fees)) + stat('Net at 2× costs', sUsd(m2.net), cls(m2.net)) + stat('Before costs', sUsd(m.net + m.fees + m.funding), cls(m.net + m.fees + m.funding)) + '</div>' +
        '<div class="chart" id="btChart"></div><p class="note">' + days + ' days, top ' + elig.length + ' markets listed today. Entry at the next bar\'s open; stop checked before target. A short window, so it is a sanity check rather than proof.</p>';
      $('btOut').innerHTML = BT.html; drawCurve($('btChart'), BT.curve, 10000);
    } catch (e) { say('Backtest failed: ' + esc(e.message)); }
    finally { var b = $('btRun'); if (b) b.disabled = false; }
  }

  function drawCurve(el, pts, ref) {
    if (!el) return;
    if (!pts || pts.length < 2) { el.innerHTML = ''; return; }
    var W2 = el.clientWidth || 600, H = el.clientHeight || 150, pl = 58, pr = 6, pt = 8, pb = 18;
    var t0 = pts[0].ts, t1 = pts[pts.length - 1].ts, ys = pts.map(function (p) { return p.equity; }).concat([ref]);
    var lo = Math.min.apply(null, ys), hi = Math.max.apply(null, ys), pad = Math.max((hi - lo) * 0.1, 1); lo -= pad; hi += pad;
    var Xf = function (t) { return pl + (t - t0) / Math.max(1, t1 - t0) * (W2 - pl - pr); }, Y = function (v) { return pt + (hi - v) / (hi - lo) * (H - pt - pb); };
    var d = pts.map(function (p, i) { return (i ? 'L' : 'M') + Xf(p.ts).toFixed(1) + ' ' + Y(p.equity).toFixed(1); }).join('');
    var txt = function (x, y, s, a) { return '<text x="' + x + '" y="' + y + '" text-anchor="' + (a || 'start') + '" fill="rgba(232,230,223,.36)" font-family="JetBrains Mono" font-size="10">' + s + '</text>'; };
    el.innerHTML = '<svg viewBox="0 0 ' + W2 + ' ' + H + '" preserveAspectRatio="none" aria-hidden="true">' +
      '<line x1="' + pl + '" x2="' + (W2 - pr) + '" y1="' + Y(ref) + '" y2="' + Y(ref) + '" stroke="rgba(232,230,223,.25)" stroke-dasharray="3 4"/>' +
      txt(pl - 6, Y(hi - pad) + 4, usd(hi - pad, 0), 'end') + txt(pl - 6, Y(lo + pad) + 4, usd(lo + pad, 0), 'end') + txt(pl, H - 4, dayTime(t0)) + txt(W2 - pr, H - 4, dayTime(t1), 'end') +
      '<path d="' + d + '" fill="none" stroke="var(--series)" stroke-width="2" stroke-linejoin="round"/>' +
      '<line class="xh" y1="' + pt + '" y2="' + (H - pb) + '" stroke="rgba(232,230,223,.3)" visibility="hidden"/><circle class="pt" r="4" fill="var(--series)" stroke="var(--panel)" stroke-width="2" visibility="hidden"/></svg><div class="tip"></div>';
    var svg = el.querySelector('svg'), tip = el.querySelector('.tip'), xh = el.querySelector('.xh'), dot = el.querySelector('.pt');
    el.onmousemove = function (e) {
      var r = svg.getBoundingClientRect(), t = t0 + ((e.clientX - r.left) / r.width * W2 - pl) / (W2 - pl - pr) * (t1 - t0), best = pts[0];
      pts.forEach(function (p) { if (Math.abs(p.ts - t) < Math.abs(best.ts - t)) best = p; });
      var bx = Xf(best.ts), by = Y(best.equity);
      xh.setAttribute('x1', bx); xh.setAttribute('x2', bx); xh.setAttribute('visibility', 'visible'); dot.setAttribute('cx', bx); dot.setAttribute('cy', by); dot.setAttribute('visibility', 'visible');
      tip.style.display = 'block'; tip.innerHTML = usd(best.equity) + ' · ' + dayTime(best.ts);
      tip.style.left = Math.min(r.width - tip.offsetWidth - 4, bx / W2 * r.width + 10) + 'px'; tip.style.top = Math.max(0, by / H * r.height - 30) + 'px';
    };
    el.onmouseleave = function () { tip.style.display = 'none'; xh.setAttribute('visibility', 'hidden'); dot.setAttribute('visibility', 'hidden'); };
  }

  function renderHeader() {
    $('hdrBal').textContent = 'Paper ' + usd(equityOf(M));
    var ok = HL.health.rest.ok !== false && (tab !== 'solana' || SOL.health.dexscreener.ok !== false);
    $('hdrFeed').innerHTML = '<span class="dot ' + (ok ? 'ok' : 'bad') + '"></span>' + (ok ? 'Live' : 'Data delayed');
    var addr = tab === 'solana' ? W.sol : W.evm;
    $('walletBtn').textContent = addr ? shortAddr(addr) : tab === 'solana' ? 'Connect Solana wallet' : 'Connect wallet';
    $('walletBtn').hidden = tab === 'equities';
  }

  function render() {
    try {
      renderHeader();
      if (tab === 'equities') return;
      if (tab === 'perps') { renderPerpSignals(); renderPerpPositions(); } else { renderSolSignals(); renderSolPositions(); }
      updateTicket(); renderRecord();
    } catch (e) { console.warn('render', e); }
  }

  function setTab(t) {
    tab = ['perps', 'solana', 'equities'].indexOf(t) >= 0 ? t : 'perps';
    document.querySelectorAll('nav.tabs button').forEach(function (b) { b.setAttribute('aria-selected', b.dataset.tab === tab ? 'true' : 'false'); });
    $('trade').hidden = tab === 'equities'; $('equities').hidden = tab !== 'equities';
    if (location.hash !== '#' + tab) history.replaceState(null, '', '#' + tab);
    $('record').dataset.h = '';
    buildTicket(); render();
  }

  /* --------------------------------------------------------------- vault */

  async function openVault() {
    var cfg = CFG, log = lsGet(EXEC_LOG, []), body = $('drBody');
    var sum = function (v) { return log.filter(function (e) { return e.venue === v; }).reduce(function (a, e) { return a + (e.nxFee || 0); }, 0); };
    var row = function (a, b) { return '<div class="row"><span>' + a + '</span><span>' + b + '</span></div>'; };
    $('drTitle').textContent = 'Vault';
    body.innerHTML =
      '<p class="note" style="margin-top:0">Commission goes straight from the venue to these addresses. It never passes through a Nexxore server or your balance.</p>' +
      '<h4>Perps · Hyperliquid builder</h4>' + row('Address', cfg.hyperliquid.builder ? esc(cfg.hyperliquid.builder) : '<span class="warn">not set</span>') +
      row('Rate', E.feeRateString(cfg.hyperliquid.feeTenthsBps) + ' per fill') + row('Builder rewards', '<span id="vHl">' + (cfg.hyperliquid.builder ? '…' : '—') + '</span>') +
      row('From this browser', usd(sum('hyperliquid'))) + (W.evm ? row('Paid by ' + shortAddr(W.evm), '<span id="vMine">…</span>') : '') +
      '<h4>Solana · Jupiter referral</h4>' + row('Account', cfg.jupiter.referralAccount ? esc(cfg.jupiter.referralAccount) : '<span class="warn">not set</span>') +
      row('Rate', (cfg.jupiter.feeBps / 100).toFixed(2) + '% per swap') + row('From this browser', usd(sum('jupiter'))) +
      '<h4>Centralised exchanges</h4>' + Object.keys(cfg.cex).map(function (k) { return row(cfg.cex[k].name, 'referral rebate · ' + log.filter(function (e) { return e.venue === k; }).length + ' tickets'); }).join('') +
      '<h4>Recent executions</h4>' + (log.length ? log.slice(-12).reverse().map(function (e) { return row(dayTime(e.ts) + ' · ' + esc(e.venue) + ' · ' + esc(e.market) + (e.close ? ' close' : e.ticket ? ' ticket' : ''), e.nxFee ? usd(e.nxFee, 4) : '—'); }).join('') : '<div class="note">None yet.</div>') +
      (!cfg.hyperliquid.builder || !cfg.jupiter.referralAccount ? '<p class="note">Set the vault addresses in js/engines/config.js. Until then live orders work but no commission is collected.</p>' : '');
    $('drawer').classList.add('on'); $('scrim').classList.add('on'); $('drClose').focus();
    if (cfg.hyperliquid.builder) E.info({ type: 'referral', user: cfg.hyperliquid.builder }).then(function (r) { var el = $('vHl'); if (el) el.textContent = usd(+(r.builderRewards || 0)); }).catch(function () {});
    if (W.hl) W.hl.fills().then(function (fs) { var el = $('vMine'); if (el) el.textContent = usd((fs || []).reduce(function (a, f) { return a + (+f.builderFee || 0); }, 0), 4); }).catch(function () {});
  }
  function closeDrawer() { $('drawer').classList.remove('on'); $('scrim').classList.remove('on'); }

  /* -------------------------------------------------------------- events */

  document.addEventListener('click', function (e) {
    var t = e.target.closest('button,tr.pick,a'); if (!t) return;
    if (t.matches('nav.tabs button')) return setTab(t.dataset.tab);
    if (t.id === 'vaultBtn') return openVault();
    if (t.id === 'drClose') return closeDrawer();
    if (t.id === 'walletBtn') { (tab === 'solana' ? connectSol() : connectEvm()).catch(function (err) { alert(err.message); }); return; }
    if (t.id === 'tGo') return execute();
    if (t.id === 'btRun') return runBacktest();
    if (t.id === 'eqNotify') return notify();
    if (t.id === 'pauseBtn') { var now = Date.now(); if (S.halts.global) C.resume(S, now, 'global', 'resumed', 'user'); else C.halt(S, now, 'global', 'paused by user', 'user'); dirty(S); $('record').dataset.h = ''; return render(); }
    if (t.dataset.copy != null) { navigator.clipboard && navigator.clipboard.writeText(t.dataset.copy); t.textContent = 'copied'; return; }
    if (t.dataset.sig != null) { var x = PV.view.filter(function (v) { return v.m + ':' + v.r.u.coin === t.dataset.sig; })[0]; if (x) { var s = x.r.sig, pl = planFor(x); selectPerp(x.r.u.coin, { dir: s.dir, stopPx: pl.stop, targetPx: pl.target, model: x.m }, x.r.f); scrollTicket(); } return render(); }
    if (t.dataset.tok) { var r = SV.rows.filter(function (y) { return y.m === t.dataset.tok; })[0]; if (r) { selectToken(r); scrollTicket(); } return render(); }
    if (t.dataset.pclose) {
      var p = M.positions[t.dataset.pclose]; if (!p) return;
      (p.kind === 'perp' ? exitPerp(M, p, 'closed by you', null, CFG.hyperliquid.feeTenthsBps || 0) : exitSpot(M, p, 'manual sell', CFG.jupiter.feeBps || 0)).then(render); return;
    }
    if (t.dataset.hclose) { if (!confirm('Close your ' + t.dataset.hclose + ' position on Hyperliquid at market?')) return; t.disabled = true; closeHL(t.dataset.hclose, +t.dataset.szi).catch(function (err) { alert(hlHint(err.message)); }).then(render); return; }
    if (t.dataset.hhedge) { if (!confirm('Hedge ' + t.dataset.hhedge + ' with an opposite BTC position on Hyperliquid?')) return; t.disabled = true; hedgeHL(t.dataset.hhedge, +t.dataset.szi).catch(function (err) { alert(hlHint(err.message)); }).then(render); return; }
    if (t.dataset.jsell != null) { t.disabled = true; sellJup(+t.dataset.jsell).catch(function (err) { alert(err.message); }).then(render); return; }
    var seg = t.closest('[data-seg]');
    if (seg) {
      var name = seg.dataset.seg, v = t.dataset.v, pf = tab === 'perps' ? prefs.perps : prefs.solana;
      if (name === 'side') T.perps.side = +v;
      else if (name === 'lev') pf.lev = +v;
      else pf[name] = v;
      savePrefs(); cexShown = null;
      seg.querySelectorAll('button').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.v === v ? 'true' : 'false'); });
      if ($('tCex')) $('tCex').innerHTML = '';
      return updateTicket();
    }
    if (t.dataset.r) { var sl = parseFloat($('tSl').value) || 0; $('tTp').value = +(sl * +t.dataset.r).toFixed(2); return updateTicket(); }
  });
  document.addEventListener('input', function (e) {
    if (e.target.id === 'tMargin') { var pf = tab === 'perps' ? prefs.perps : prefs.solana; pf.margin = parseFloat(e.target.value) || 0; savePrefs(); }
    if (e.target.id === 'tTp' || e.target.id === 'tSl' || e.target.id === 'tMargin') {
      var t = tab === 'perps' ? T.perps : T.solana; if (t) { t.tpPct = parseFloat($('tTp').value) || 0; t.slPct = parseFloat($('tSl').value) || 0; }
      updateTicket();
    }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeDrawer();
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('tr.pick')) { e.preventDefault(); e.target.click(); }
  });
  $('scrim').addEventListener('click', closeDrawer);
  $('more').addEventListener('toggle', function () { $('record').dataset.h = ''; renderRecord(); });
  function scrollTicket() { if (window.innerWidth <= 1000) $('ticket').scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  function notify() {
    var a = lsGet('nx_access_v1', null), note = $('eqNote');
    if (!a || !a.email) { note.textContent = 'Sign in with your email first.'; return; }
    fetch('/api/waitlist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: a.email, source: 'engines:equities' }) })
      .then(function (r) { return r.json(); }).then(function (d) { note.textContent = d && d.success ? 'We\'ll email ' + a.email + '.' : 'Could not save. Try later.'; })
      .catch(function () { note.textContent = 'Could not reach the server.'; });
  }

  /* --------------------------------------------------------------- loops */

  function tick() {
    var now = Date.now();
    managePerps(); manageManual(); feedCheck(now); fundingTick();
    C.mark(S, now, marksOf(S)); C.mark(M, now, marksOf(M)); dirty(S); dirty(M);
  }

  setTab(location.hash.replace('#', '') || 'perps');
  window.addEventListener('hashchange', function () { setTab(location.hash.replace('#', '')); });
  HL.connect();
  HL.refreshUniverse().then(function () { scanB(); scanA(); }).catch(function () {});
  solCycle();
  setInterval(tick, 2000);
  setInterval(render, 2500);
  setInterval(save, 5000);
  setInterval(function () { HL.refreshUniverse().catch(function () {}); }, 30000);
  setInterval(scanA, 15000);
  setInterval(scanB, 60000);
  setInterval(solCycle, 60000);
  setInterval(manageSpot, 20000);
  setInterval(function () { if (W.hl) pollHL(); }, 8000);
  window.addEventListener('beforeunload', function () { dirtyS = dirtyM = true; save(); });
})();
