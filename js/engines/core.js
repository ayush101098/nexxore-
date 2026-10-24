/* Nexxore engines — shared core: paper ledger, risk engine, order state machine,
 * accounting, kill switches and performance metrics.
 *
 * Everything here is pure or mutates only the `state` object passed in, so the
 * same code runs in the browser (window.NXCore) and under node:test (require).
 * There is no live-execution path anywhere in this module: EXECUTION_MODE is
 * frozen to 'paper' and every order passes assertPaper() before it is recorded.
 *
 * Money is held in integer micro-dollars (1e-6 USD) so the cash ledger never
 * drifts through float rounding; prices and quantities stay as numbers rounded
 * to venue precision.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NXCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var EXECUTION_MODE = Object.freeze({ mode: 'paper', liveOrderSubmission: false });
  var MICRO = 1e6;
  var HOUR = 3600e3, DAY = 86400e3;

  function toMicro(usd) { return Math.round(usd * MICRO); }
  function fromMicro(m) { return m / MICRO; }
  function utcDay(ts) { return Math.floor(ts / DAY); }
  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  function roundTo(x, dp) { var f = Math.pow(10, dp); return Math.floor(x * f + 1e-9) / f; }

  /* FNV-1a over a canonical JSON string: used to fingerprint feature snapshots,
     parameters and backtest datasets so a decision can be shown to reproduce. */
  function canonical(v) {
    if (v === null || typeof v !== 'object') return JSON.stringify(typeof v === 'number' && !isFinite(v) ? null : v);
    if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
    return '{' + Object.keys(v).sort().map(function (k) { return JSON.stringify(k) + ':' + canonical(v[k]); }).join(',') + '}';
  }
  function hash(v) {
    var s = typeof v === 'string' ? v : canonical(v), h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return ('0000000' + (h >>> 0).toString(16)).slice(-8);
  }

  /* ---------------------------------------------------------------- config */

  var DEFAULT_CONFIG = {
    startEquity: 10000,
    perpRiskPct: 0.0025,        // risk budget per perp trade (stop distance)
    tokenRiskPct: 0.0025,       // per-token loss budget at stressed exit
    maxOpenRiskPct: 0.01,       // aggregate open stop-risk
    dailyLossPct: 0.02,         // of start-of-day equity → halt new entries
    maxDrawdownPct: 0.08,       // peak-to-trough, of initial equity → suspend strategies
    perpIsolatedLev: 3,         // simulated isolated leverage (margin = notional / lev)
    maxPositionLev: 3,          // per-position notional / equity
    maxGrossLev: 3,             // all perp notional / equity
    maxClusterLev: 2.5,         // same-direction notional among BTC-correlated perps / equity
    clusterCorr: 0.6,           // |ρ| vs BTC at which a perp joins the correlated cluster
    maxTokenAllocPct: 0.03,     // per-token notional / equity
    maxTokenPositions: 4,
    minPerpNotional: 10,        // venue minimum order value (USD)
    minResizeFrac: 0.25,
    manualMaxLev: 10,           // cap on user-chosen leverage (venue max may be lower)        // reject if limits shrink a trade below this fraction of its risk size
    staleMs: { perp: 20000, spot: 150000 },
    slipAlert: { minBps: 10, mult: 3, strikes: 3 },
    rejectAlert: { count: 5, windowMs: 10 * 60e3 }
  };

  var STRATEGIES = {
    'perp.scalp':    { engine: 'perp', name: 'Model A · Fast scalp', version: '1.0.0', status: 'paper' },
    'perp.intraday': { engine: 'perp', name: 'Model B · Intraday continuation', version: '1.0.0', status: 'paper' },
    'sol.discovery': { engine: 'spot', name: 'Onchain discovery · long-only spot', version: '1.0.0', status: 'paper' },
    'eq.longonly':   { engine: 'equity', name: 'US equity intelligence', version: '0.0.0', status: 'research' },
    'manual':        { engine: 'any', name: 'Your trades', version: '1', status: 'paper' }
  };
  var LIFECYCLE = ['research', 'candidate', 'paper', 'approved_for_review', 'disabled'];

  function newState(now, cfg) {
    var c = Object.assign({}, DEFAULT_CONFIG, cfg || {});
    var eq = toMicro(c.startEquity);
    var strategies = {};
    Object.keys(STRATEGIES).forEach(function (id) {
      var s = STRATEGIES[id];
      strategies[id] = { engine: s.engine, name: s.name, version: s.version, status: s.status, enabled: s.status === 'paper' };
    });
    return {
      schema: 1, created: now, config: c,
      equity0: eq, cash: eq, journal: [],
      day: { day: utcDay(now), startEquity: eq },
      peak: eq,
      positions: {}, orders: [], fills: [], closed: [],
      signals: [], decisions: [], audit: [], snapshots: [], funding: [],
      halts: {}, strategies: strategies,
      counters: { seq: 0, slipStrikes: { perp: 0, spot: 0 }, rejects: [] },
      lastMark: {}
    };
  }

  function nextId(state, prefix) { state.counters.seq += 1; return prefix + '_' + state.counters.seq.toString(36) + '_' + (state.created % 1e6).toString(36); }

  function audit(state, ts, actor, action, reason, meta) {
    state.audit.push({ id: nextId(state, 'au'), ts: ts, actor: actor, action: action, reason: reason || '', meta: meta || null });
    if (state.audit.length > 1500) state.audit.splice(0, state.audit.length - 1500);
  }

  /* --------------------------------------------------------- cash journal */

  function post(state, ts, type, amountMicro, ref) {
    if (!amountMicro) return;
    state.journal.push({ ts: ts, type: type, amt: amountMicro, ref: ref });
    state.cash += amountMicro;
  }

  /* Cash must equal start equity plus every journal entry. A mismatch means the
     accounting path has a bug, which is a kill-switch condition. */
  function reconcile(state) {
    var sum = state.equity0;
    for (var i = 0; i < state.journal.length; i++) sum += state.journal[i].amt;
    return { ok: sum === state.cash, expected: sum, actual: state.cash, diff: state.cash - sum };
  }

  /* ------------------------------------------------------ valuation / marks */

  function posValue(p, mark) {
    if (p.kind === 'perp') return p.side * p.qty * (mark - p.avgEntry); // unrealized P&L; cash holds the rest
    return p.qty * mark;                                                // spot: tokens × mark price
  }

  function equity(state, marks) {
    var e = state.cash;
    Object.keys(state.positions).forEach(function (id) {
      var p = state.positions[id], m = (marks && marks[p.instrument]) || state.lastMark[p.instrument] || p.avgEntry;
      e += toMicro(posValue(p, m));
    });
    return e;
  }

  function openRiskUsd(state) {
    var r = 0;
    Object.keys(state.positions).forEach(function (id) { r += state.positions[id].riskUsd || 0; });
    return r;
  }

  function exposure(state, marks) {
    var gross = 0, net = 0, spot = 0, clusterLong = 0, clusterShort = 0;
    Object.keys(state.positions).forEach(function (id) {
      var p = state.positions[id], m = (marks && marks[p.instrument]) || state.lastMark[p.instrument] || p.avgEntry;
      var n = p.qty * m;
      if (p.kind === 'perp') {
        gross += n; net += p.side * n;
        if (Math.abs(p.corrBtc || 0) >= state.config.clusterCorr) { if (p.side > 0) clusterLong += n; else clusterShort += n; }
      } else spot += n;
    });
    return { gross: gross, net: net, spot: spot, clusterLong: clusterLong, clusterShort: clusterShort };
  }

  /* Update marks, roll the UTC day, track peak, and trip the loss limits. */
  function mark(state, ts, marks) {
    Object.keys(marks || {}).forEach(function (k) { if (marks[k] > 0) state.lastMark[k] = marks[k]; });
    var eq = equity(state, marks);
    var d = utcDay(ts);
    if (d !== state.day.day) {
      state.day = { day: d, startEquity: eq };
      if (state.halts.daily) { delete state.halts.daily; audit(state, ts, 'risk', 'resume', 'new UTC day — daily-loss halt cleared'); }
    }
    if (eq > state.peak) state.peak = eq;
    var c = state.config;
    var dayLoss = (state.day.startEquity - eq) / state.day.startEquity;
    if (dayLoss >= c.dailyLossPct && !state.halts.daily) halt(state, ts, 'daily', 'Daily loss ' + (dayLoss * 100).toFixed(2) + '% ≥ ' + (c.dailyLossPct * 100) + '% of start-of-day equity', 'risk');
    var dd = (state.peak - eq) / state.equity0;
    if (dd >= c.maxDrawdownPct && !state.halts.drawdown) {
      halt(state, ts, 'drawdown', 'Drawdown ' + (dd * 100).toFixed(2) + '% ≥ ' + (c.maxDrawdownPct * 100) + '% of initial equity — strategies suspended for review', 'risk');
      Object.keys(state.strategies).forEach(function (id) { if (state.strategies[id].enabled) setStrategy(state, ts, id, false, 'risk', 'drawdown suspension'); });
    }
    var last = state.snapshots[state.snapshots.length - 1];
    if (!last || ts - last.ts >= 60e3) {
      var ex = exposure(state, marks);
      state.snapshots.push({ ts: ts, equity: eq, gross: Math.round(ex.gross), dd: +dd.toFixed(5) });
      if (state.snapshots.length > 6000) state.snapshots = downsample(state.snapshots);
    }
    return { equity: eq, dayLossPct: dayLoss, ddPct: dd };
  }

  function downsample(s) { // keep the latest 2000 at full resolution, thin the rest to every 4th
    var keep = s.slice(-2000), old = s.slice(0, -2000).filter(function (_, i) { return i % 4 === 0; });
    return old.concat(keep);
  }

  /* --------------------------------------------------------- kill switches */

  function halt(state, ts, scope, reason, actor) {
    state.halts[scope] = { ts: ts, reason: reason };
    audit(state, ts, actor || 'system', 'suspend', reason, { scope: scope });
  }
  function resume(state, ts, scope, reason, actor) {
    if (!state.halts[scope]) return false;
    delete state.halts[scope];
    audit(state, ts, actor || 'user', 'resume', reason || 'manual resume', { scope: scope });
    return true;
  }
  /* Scopes that block an engine: global/daily/drawdown/recon block everything,
     'perp' / 'spot' / 'feed:<engine>' / 'slip:<engine>' / 'rejects:<engine>' block one engine. */
  function blockingHalts(state, engine) {
    return Object.keys(state.halts).filter(function (k) {
      return k === 'global' || k === 'daily' || k === 'drawdown' || k === 'recon' || k === engine || k.split(':')[1] === engine;
    }).map(function (k) { return { scope: k, reason: state.halts[k].reason }; });
  }

  function setStrategy(state, ts, id, enabled, actor, reason) {
    var s = state.strategies[id];
    if (!s) throw new Error('unknown strategy ' + id);
    if (enabled && s.status !== 'paper') throw new Error('strategy ' + id + ' is ' + s.status + '; only paper-status strategies can be enabled');
    s.enabled = !!enabled;
    audit(state, ts, actor || 'user', enabled ? 'enable' : 'disable', reason || '', { strategy: id, version: s.version });
  }

  /* ------------------------------------------------------------ risk engine */

  /* proposal: { signalId, strategy, version, engine:'perp'|'spot', instrument,
       side:+1|-1, entryPx, stopPx, exitPolicy:{maxHoldMs,...}, expectedEdgeBps,
       minEdgeBps, dataAgeMs, szDecimals, corrBtc, maxNotionalByLiquidity,
       stressLossFrac (spot only: loss per $ of notional at stop under stressed exit) }
     Returns a decision; approved decisions carry the allowed qty / notional. */
  function evaluate(state, proposal, ctx) {
    var c = state.config, now = ctx.now, reasons = [], adjustments = [];
    var p = proposal, strat = state.strategies[p.strategy];
    var eqMicro = equity(state, ctx.marks), E = fromMicro(eqMicro);
    var ex = exposure(state, ctx.marks), openRisk = openRiskUsd(state);
    var dd = (state.peak - eqMicro) / state.equity0;
    var dayLoss = (state.day.startEquity - eqMicro) / state.day.startEquity;

    blockingHalts(state, p.engine).forEach(function (h) { reasons.push('HALTED:' + h.scope); });
    if (!strat) reasons.push('STRATEGY_UNKNOWN');
    else {
      if (strat.status !== 'paper') reasons.push('STRATEGY_NOT_PAPER');
      if (!strat.enabled) reasons.push('STRATEGY_DISABLED');
      if (p.version !== strat.version) reasons.push('VERSION_MISMATCH');
    }
    if (EXECUTION_MODE.mode !== 'paper') reasons.push('LIVE_MODE_BLOCKED');
    if (!(p.dataAgeMs >= 0) || p.dataAgeMs > c.staleMs[p.engine]) reasons.push('DATA_STALE');
    if (!(p.entryPx > 0) || !(p.stopPx > 0) || p.stopPx === p.entryPx) reasons.push('NO_INVALIDATION');
    else if ((p.side > 0 && p.stopPx >= p.entryPx) || (p.side < 0 && p.stopPx <= p.entryPx)) reasons.push('STOP_WRONG_SIDE');
    if (!p.exitPolicy || !(p.exitPolicy.maxHoldMs > 0)) reasons.push('NO_EXIT_POLICY');
    if (p.engine === 'spot' && p.side < 0) reasons.push('SPOT_LONG_ONLY');
    if (dayLoss >= c.dailyLossPct) reasons.push('DAILY_LOSS_LIMIT');
    if (dd >= c.maxDrawdownPct) reasons.push('DRAWDOWN_LIMIT');
    if (!(p.expectedEdgeBps >= p.minEdgeBps)) reasons.push('EDGE_BELOW_MIN');
    Object.keys(state.positions).forEach(function (id) {
      if (state.positions[id].instrument === p.instrument) reasons.push(state.positions[id].side === p.side ? 'DUPLICATE_POSITION' : 'CONFLICTING_POSITION');
    });
    state.orders.forEach(function (o) {
      if (o.instrument === p.instrument && (o.status === 'created' || o.status === 'accepted' || o.status === 'partially_filled')) reasons.push('ORDER_IN_FLIGHT');
    });
    if (p.engine === 'spot') {
      var nTok = Object.keys(state.positions).filter(function (id) { return state.positions[id].kind === 'spot'; }).length;
      if (nTok >= c.maxTokenPositions) reasons.push('MAX_TOKEN_POSITIONS');
    }

    // Sizing — only meaningful when the inputs are sane.
    var qty = 0, notional = 0, riskUsd = 0, baseRisk = 0;
    var BUDGET = { OPEN_RISK_CAP: 1, GROSS_CAP: 1, CORRELATION_CAP: 1, CASH_CAP: 1 }; // portfolio budgets, vs per-trade caps
    if (reasons.indexOf('NO_INVALIDATION') < 0 && reasons.indexOf('STOP_WRONG_SIDE') < 0) {
      if (p.engine === 'perp') {
        var stopDist = Math.abs(p.entryPx - p.stopPx);
        baseRisk = E * c.perpRiskPct;
        qty = baseRisk / stopDist;                                         // Q = E·ρ / |P_entry − P_stop|
        var caps = [
          ['LEVERAGE_CAP', c.maxPositionLev * E / p.entryPx],
          ['GROSS_CAP', Math.max(0, c.maxGrossLev * E - ex.gross) / p.entryPx],
          ['OPEN_RISK_CAP', Math.max(0, c.maxOpenRiskPct * E - openRisk) / stopDist],
          ['LIQUIDITY_CAP', p.maxNotionalByLiquidity > 0 ? p.maxNotionalByLiquidity / p.entryPx : Infinity]
        ];
        if (Math.abs(p.corrBtc || 0) >= c.clusterCorr) {
          var used = p.side > 0 ? ex.clusterLong : ex.clusterShort;
          caps.push(['CORRELATION_CAP', Math.max(0, c.maxClusterLev * E - used) / p.entryPx]);
        }
        caps.forEach(function (cap) { if (cap[1] < qty) { adjustments.push(cap[0]); qty = cap[1]; } });
        qty = roundTo(qty, p.szDecimals == null ? 4 : p.szDecimals);
        notional = qty * p.entryPx;
        riskUsd = qty * stopDist;
        if (notional < c.minPerpNotional) reasons.push('SIZE_BELOW_MIN');
      } else {
        if (!(p.stressLossFrac > 0 && p.stressLossFrac < 1)) reasons.push('NO_STRESS_ESTIMATE');
        else {
          baseRisk = E * c.tokenRiskPct;
          notional = baseRisk / p.stressLossFrac;                          // size by stressed-exit loss, not chart stop
          var scaps = [
            ['TOKEN_ALLOC_CAP', c.maxTokenAllocPct * E],
            ['OPEN_RISK_CAP', Math.max(0, c.maxOpenRiskPct * E - openRisk) / p.stressLossFrac],
            ['LIQUIDITY_CAP', p.maxNotionalByLiquidity > 0 ? p.maxNotionalByLiquidity : Infinity],
            ['CASH_CAP', Math.max(0, fromMicro(state.cash) - c.perpRiskPct * E * 4)]
          ];
          scaps.forEach(function (cap) { if (cap[1] < notional) { adjustments.push(cap[0]); notional = cap[1]; } });
          notional = Math.floor(notional * 100) / 100;
          riskUsd = notional * p.stressLossFrac;
          if (notional < 5) reasons.push('SIZE_BELOW_MIN');
        }
      }
      // A per-trade cap (leverage, depth, allocation) may legitimately shrink a trade; a
      // portfolio budget that leaves only a sliver of the intended risk means the book is full.
      var budgetBound = adjustments.some(function (a) { return BUDGET[a]; });
      if (budgetBound && baseRisk > 0 && riskUsd < baseRisk * c.minResizeFrac && reasons.indexOf('SIZE_BELOW_MIN') < 0) reasons.push('LIMITS_EXHAUSTED');
    }

    var approved = reasons.length === 0;
    var decision = {
      id: nextId(state, 'rd'), ts: now, signalId: p.signalId, strategy: p.strategy, version: p.version,
      instrument: p.instrument, side: p.side, approved: approved,
      reasons: approved ? ['APPROVED'] : uniq(reasons), adjustments: adjustments,
      qty: approved ? qty : 0, notional: approved ? +notional.toFixed(2) : 0, riskUsd: approved ? +riskUsd.toFixed(4) : 0,
      snapshot: {
        equity: +E.toFixed(2), openRiskUsd: +openRisk.toFixed(2), openRiskCapUsd: +(c.maxOpenRiskPct * E).toFixed(2),
        grossLev: +(ex.gross / E).toFixed(3), dayLossPct: +(dayLoss * 100).toFixed(3), ddPct: +(dd * 100).toFixed(3),
        dataAgeMs: p.dataAgeMs, edgeBps: p.expectedEdgeBps, minEdgeBps: p.minEdgeBps
      }
    };
    state.decisions.push(decision);
    trim(state.decisions, 2500);
    return decision;
  }

  /* User-sized trades (paper venue): the user picks margin and leverage instead of
     risk-based sizing, but every hard gate still applies. A hedge leg has no stop of
     its own — it lives and dies with the position it hedges.
     p: { signalId, engine, instrument, side, entryPx, stopPx, margin, leverage, venueMaxLev, dataAgeMs, szDecimals, hedgeOf } */
  function evaluateManual(state, p, ctx) {
    var c = state.config, now = ctx.now, reasons = [];
    var eqMicro = equity(state, ctx.marks), E = fromMicro(eqMicro);
    var dd = (state.peak - eqMicro) / state.equity0, dayLoss = (state.day.startEquity - eqMicro) / state.day.startEquity;
    blockingHalts(state, p.engine).forEach(function (h) { reasons.push('HALTED:' + h.scope); });
    if (!state.strategies.manual || !state.strategies.manual.enabled) reasons.push('STRATEGY_DISABLED');
    if (EXECUTION_MODE.mode !== 'paper') reasons.push('LIVE_MODE_BLOCKED');
    if (!(p.dataAgeMs >= 0) || p.dataAgeMs > c.staleMs[p.engine === 'spot' ? 'spot' : 'perp']) reasons.push('DATA_STALE');
    if (!(p.entryPx > 0)) reasons.push('NO_PRICE');
    if (!p.hedgeOf) {
      if (!(p.stopPx > 0)) reasons.push('NO_INVALIDATION');
      else if ((p.side > 0 && p.stopPx >= p.entryPx) || (p.side < 0 && p.stopPx <= p.entryPx)) reasons.push('STOP_WRONG_SIDE');
    }
    if (p.engine === 'spot' && p.side < 0) reasons.push('SPOT_LONG_ONLY');
    if (p.engine === 'spot' && p.leverage !== 1) reasons.push('SPOT_NO_LEVERAGE');
    var maxLev = Math.min(c.manualMaxLev || 10, p.venueMaxLev || Infinity);
    if (!(p.leverage >= 1) || p.leverage > maxLev) reasons.push('LEVERAGE_ABOVE_MAX');
    if (dayLoss >= c.dailyLossPct) reasons.push('DAILY_LOSS_LIMIT');
    if (dd >= c.maxDrawdownPct) reasons.push('DRAWDOWN_LIMIT');
    Object.keys(state.positions).forEach(function (id) {
      var q = state.positions[id];
      if (q.instrument === p.instrument) reasons.push(q.side === p.side ? 'DUPLICATE_POSITION' : 'CONFLICTING_POSITION');
    });
    state.orders.forEach(function (o) {
      if (o.instrument === p.instrument && (o.status === 'created' || o.status === 'accepted' || o.status === 'partially_filled')) reasons.push('ORDER_IN_FLIGHT');
    });
    var used = 0;
    Object.keys(state.positions).forEach(function (id) { var q = state.positions[id]; used += q.kind === 'perp' ? q.margin : q.qty * q.avgEntry; });
    if (!(p.margin > 0)) reasons.push('SIZE_BELOW_MIN');
    else if (p.margin > E - used + 1e-9) reasons.push('INSUFFICIENT_MARGIN');
    var notional = (p.margin || 0) * (p.leverage || 1);
    var qty = p.engine === 'spot' ? notional / p.entryPx : roundTo(notional / p.entryPx, p.szDecimals == null ? 4 : p.szDecimals);
    if (p.engine !== 'spot' && qty * p.entryPx < c.minPerpNotional) reasons.push('SIZE_BELOW_MIN');
    var riskUsd = p.stopPx > 0 ? qty * Math.abs(p.entryPx - p.stopPx) : 0;
    var approved = reasons.length === 0;
    var d = {
      id: nextId(state, 'rd'), ts: now, signalId: p.signalId || null, strategy: 'manual', version: '1', instrument: p.instrument, side: p.side,
      approved: approved, reasons: approved ? ['APPROVED'] : uniq(reasons), adjustments: [],
      qty: approved ? qty : 0, notional: approved ? +(qty * p.entryPx).toFixed(2) : 0, riskUsd: approved ? +riskUsd.toFixed(4) : 0,
      snapshot: { equity: +E.toFixed(2), marginUsed: +used.toFixed(2), leverage: p.leverage, dataAgeMs: p.dataAgeMs, ddPct: +(dd * 100).toFixed(3), dayLossPct: +(dayLoss * 100).toFixed(3) }
    };
    state.decisions.push(d); trim(state.decisions, 2500);
    return d;
  }

  function uniq(a) { return a.filter(function (x, i) { return a.indexOf(x) === i; }); }
  function trim(a, n) { if (a.length > n) a.splice(0, a.length - n); }

  /* ---------------------------------------------------- order state machine */

  var TRANSITIONS = {
    created: ['accepted', 'rejected'],
    accepted: ['partially_filled', 'filled', 'cancelled', 'expired', 'rejected'],
    partially_filled: ['partially_filled', 'filled', 'cancelled', 'expired'],
    filled: [], rejected: [], cancelled: [], expired: []
  };
  function transition(order, to, ts, reason) {
    if ((TRANSITIONS[order.status] || []).indexOf(to) < 0) throw new Error('illegal order transition ' + order.status + ' → ' + to);
    order.status = to;
    order.history.push({ status: to, ts: ts, reason: reason || '' });
  }

  function assertPaper() {
    if (EXECUTION_MODE.mode !== 'paper' || EXECUTION_MODE.liveOrderSubmission) throw new Error('live order submission is hard-blocked in this release');
  }

  /* Orders can only be created from an approved risk decision (entries) or an
     existing position (exits). There is no other constructor. */
  function createOrder(state, ts, spec) {
    assertPaper();
    var entry = spec.intent === 'open';
    if (entry) {
      var d = state.decisions.filter(function (x) { return x.id === spec.decisionId; })[0];
      if (!d || !d.approved) throw new Error('entry order requires an approved risk decision');
      if (state.orders.some(function (o) { return o.decisionId === d.id; })) throw new Error('decision ' + d.id + ' already has an order (idempotency)');
    } else if (!state.positions[spec.positionId]) throw new Error('exit order requires an open position');
    var o = {
      id: nextId(state, 'po'), ts: ts, intent: spec.intent, decisionId: spec.decisionId || null, positionId: spec.positionId || null,
      signalId: spec.signalId || null, strategy: spec.strategy, version: spec.version, engine: spec.engine, instrument: spec.instrument,
      side: spec.side, type: spec.type || 'market', qty: spec.qty, notional: spec.notional || null, refPx: spec.refPx,
      estCostBps: spec.estCostBps == null ? null : spec.estCostBps, reason: spec.reason || '', signalTs: spec.signalTs || ts,
      filledQty: 0, avgPx: 0, status: 'created', history: [{ status: 'created', ts: ts, reason: spec.reason || '' }]
    };
    state.orders.push(o);
    trim(state.orders, 1500);
    return o;
  }

  function rejectOrder(state, ts, order, reason) {
    transition(order, 'rejected', ts, reason);
    var r = state.counters.rejects; r.push({ ts: ts, engine: order.engine });
    while (r.length && ts - r[0].ts > state.config.rejectAlert.windowMs) r.shift();
    var n = r.filter(function (x) { return x.engine === order.engine; }).length;
    if (n >= state.config.rejectAlert.count && !state.halts['rejects:' + order.engine]) halt(state, ts, 'rejects:' + order.engine, n + ' simulated order rejections in 10 min', 'monitor');
  }

  /* Apply simulated fills to an order and to the portfolio, atomically: the
     function computes everything first and mutates only once nothing can throw.
     fill: { qty, px, feeUsd, midPx, halfSpreadBps, ts, liquidity:'taker' } */
  function applyFill(state, order, fill, meta) {
    meta = meta || {};
    if (!(fill.qty > 0) || !(fill.px > 0)) throw new Error('fill needs positive qty and price');
    if (order.status === 'created') transition(order, 'accepted', fill.ts, 'simulator accepted');
    var remaining = order.qty - order.filledQty;
    if (fill.qty > remaining + 1e-12) throw new Error('overfill');
    var slipBps = order.refPx > 0 ? (fill.px - order.refPx) / order.refPx * 1e4 * order.side : 0; // + = adverse
    var f = {
      id: nextId(state, 'pf'), orderId: order.id, ts: fill.ts, qty: fill.qty, px: fill.px, fee: toMicro(fill.feeUsd || 0),
      slippageBps: +slipBps.toFixed(2), spreadBps: fill.halfSpreadBps == null ? null : +fill.halfSpreadBps.toFixed(2),
      impactBps: fill.halfSpreadBps == null ? null : +(slipBps - fill.halfSpreadBps).toFixed(2),
      liquidity: fill.liquidity || 'taker', instrument: order.instrument, strategy: order.strategy
    };
    var newFilled = order.filledQty + fill.qty;
    order.avgPx = (order.avgPx * order.filledQty + fill.px * fill.qty) / newFilled;
    order.filledQty = newFilled;
    transition(order, newFilled >= order.qty - 1e-12 ? 'filled' : 'partially_filled', fill.ts, meta.note || '');
    state.fills.push(f); trim(state.fills, 3000);
    post(state, fill.ts, 'fee', -f.fee, f.id);

    if (order.intent === 'open') openOrAdd(state, order, f, meta);
    else reduce(state, order, f, meta);
    slipMonitor(state, order, f, fill.ts);
    return f;
  }

  function openOrAdd(state, order, f, meta) {
    var id = order.positionId;
    var p = id && state.positions[id];
    if (!p) {
      id = nextId(state, 'ps'); order.positionId = id;
      var d = state.decisions.filter(function (x) { return x.id === order.decisionId; })[0] || {};
      p = state.positions[id] = {
        id: id, kind: order.engine === 'perp' ? 'perp' : 'spot', engine: order.engine, strategy: order.strategy, version: order.version,
        instrument: order.instrument, side: order.side, qty: 0, avgEntry: 0, openedAt: f.ts, signalId: order.signalId,
        stop: meta.stop, target: meta.target, trail: meta.trail || null, maxHoldMs: meta.maxHoldMs, exit: meta.exit || {},
        liqPx: null, margin: 0, riskUsd: 0, fees: 0, funding: 0, realized: 0, peakPx: f.px, troughPx: f.px,
        corrBtc: meta.corrBtc || 0, thesis: meta.thesis || '', estCostBps: order.estCostBps, entryCostBps: f.slippageBps,
        stressLossFrac: meta.stressLossFrac || null, extra: meta.extra || {}, decisionRisk: d.riskUsd || 0, entryNotional: 0
      };
    }
    p.avgEntry = (p.avgEntry * p.qty + f.px * f.qty) / (p.qty + f.qty);
    p.qty += f.qty;
    p.fees += f.fee;
    p.entryNotional += f.qty * f.px;
    legCosts(p, f);
    if (p.kind === 'spot') post(state, f.ts, 'spot_buy', -toMicro(f.qty * f.px), f.id);
    refreshRisk(state, p);
  }

  /* Split each fill's adverse price vs the decision reference into the half-spread
     paid and the remaining impact/latency slippage, in USD. */
  function legCosts(p, f) {
    var n = f.qty * f.px;
    p.extra.spreadCost = (p.extra.spreadCost || 0) + (f.spreadBps == null ? 0 : n * f.spreadBps / 1e4);
    p.extra.impactCost = (p.extra.impactCost || 0) + (f.impactBps == null ? Math.max(0, n * f.slippageBps / 1e4) : n * f.impactBps / 1e4);
  }

  function refreshRisk(state, p) {
    if (p.kind === 'perp') {
      var lev = p.extra.lev || state.config.perpIsolatedLev, mm = p.extra.mmFrac || 0.0125;
      p.margin = p.qty * p.avgEntry / lev;
      p.liqPx = p.side > 0 ? p.avgEntry * (1 - 1 / lev) / (1 - mm) : p.avgEntry * (1 + 1 / lev) / (1 + mm);
      p.riskUsd = Math.max(0, p.qty * (p.avgEntry - p.stop) * p.side);
    } else {
      p.riskUsd = p.qty * p.avgEntry * (p.stressLossFrac || 0.25);
    }
  }

  function reduce(state, order, f, meta) {
    var p = state.positions[order.positionId];
    var q = Math.min(f.qty, p.qty);
    var pnl = p.kind === 'perp' ? p.side * q * (f.px - p.avgEntry) : q * (f.px - p.avgEntry);
    var pnlMicro = toMicro(pnl);
    if (p.kind === 'perp') post(state, f.ts, 'realized', pnlMicro, f.id);
    else post(state, f.ts, 'spot_sell', toMicro(q * f.px), f.id);
    p.realized += pnlMicro;
    p.fees += f.fee;
    legCosts(p, f);
    p.qty = +(p.qty - q).toFixed(12);
    if (p.qty <= 1e-12) closePosition(state, p, f.ts, order.reason || meta.reason || 'exit', f.px);
    else refreshRisk(state, p);
  }

  function closePosition(state, p, ts, reason, exitPx) {
    var net = p.realized - p.fees - p.funding;
    state.closed.push({
      id: p.id, strategy: p.strategy, version: p.version, engine: p.engine, instrument: p.instrument, side: p.side,
      openedAt: p.openedAt, closedAt: ts, holdMs: ts - p.openedAt, entryPx: p.avgEntry, exitPx: exitPx,
      notional: +p.entryNotional.toFixed(2), gross: fromMicro(p.realized), fees: fromMicro(p.fees), funding: fromMicro(p.funding),
      net: fromMicro(net), spreadCost: +(p.extra.spreadCost || 0).toFixed(4), impactCost: +(p.extra.impactCost || 0).toFixed(4), riskUsd: p.decisionRisk, r: p.decisionRisk > 0 ? fromMicro(net) / p.decisionRisk : null,
      reason: reason, signalId: p.signalId, estCostBps: p.estCostBps, thesis: p.thesis
    });
    trim(state.closed, 2000);
    delete state.positions[p.id];
    audit(state, ts, 'simulator', 'close', reason, { position: p.id, instrument: p.instrument, net: fromMicro(net) });
  }

  /* Isolated-margin liquidation: the position loses its margin; the stop never
     filled. Logged as a distinct exit reason. */
  function liquidate(state, p, ts, px, feeFrac) {
    var loss = -p.margin;
    var fee = p.qty * px * (feeFrac || 0);
    post(state, ts, 'realized', toMicro(loss), p.id + ':liq');
    post(state, ts, 'fee', -toMicro(fee), p.id + ':liqfee');
    p.realized += toMicro(loss); p.fees += toMicro(fee);
    closePosition(state, p, ts, 'liquidated', px);
  }

  /* Funding on a perp at a funding timestamp; idempotent per (position, ts).
     Positive rate: longs pay shorts. rate is the venue's per-interval rate. */
  function accrueFunding(state, p, ts, rate, refPx) {
    var key = p.id + '@' + ts;
    if (p.extra.fundingKeys && p.extra.fundingKeys.indexOf(key) >= 0) return 0;
    var pay = p.side * p.qty * refPx * rate;        // + = position pays
    var m = toMicro(pay);
    post(state, ts, 'funding', -m, key);
    p.funding += m;
    (p.extra.fundingKeys = p.extra.fundingKeys || []).push(key);
    if (p.extra.fundingKeys.length > 48) p.extra.fundingKeys.shift();
    state.funding.push({ ts: ts, instrument: p.instrument, rate: rate, refPx: refPx, position: p.id, amount: -pay });
    trim(state.funding, 1500);
    return pay;
  }

  function slipMonitor(state, order, f, ts) {
    if (order.estCostBps == null || f.spreadBps == null) return;
    var c = state.config.slipAlert, est = order.estCostBps / 2; // estimate is round-trip; compare one leg
    var bad = f.slippageBps - est > Math.max(c.minBps, c.mult * Math.max(est, 1));
    var k = order.engine;
    state.counters.slipStrikes[k] = bad ? (state.counters.slipStrikes[k] || 0) + 1 : 0;
    if (state.counters.slipStrikes[k] >= c.strikes && !state.halts['slip:' + k]) halt(state, ts, 'slip:' + k, c.strikes + ' consecutive fills with slippage beyond the calibrated range', 'monitor');
  }

  /* ------------------------------------------------------------- signals */

  function recordSignal(state, sig) {
    sig.id = sig.id || nextId(state, 'sg');
    state.signals.push(sig);
    trim(state.signals, 2000);
    return sig;
  }

  /* --------------------------------------------------------------- metrics */

  function mean(a) { if (!a.length) return 0; var s = 0; for (var i = 0; i < a.length; i++) s += a[i]; return s / a.length; }
  function sd(a) { if (a.length < 2) return 0; var m = mean(a), s = 0; for (var i = 0; i < a.length; i++) s += (a[i] - m) * (a[i] - m); return Math.sqrt(s / (a.length - 1)); }

  /* trades: closed-trade records ({net, fees, funding, holdMs, instrument, strategy, notional})
     curve: [{ts, equity (USD)}] at a fixed sampling step (stepMs) for Sharpe/Sortino. */
  function metrics(trades, curve, startEquity, stepMs) {
    var nets = trades.map(function (t) { return t.net; });
    var wins = nets.filter(function (x) { return x > 0; }), losses = nets.filter(function (x) { return x <= 0; });
    var gw = wins.reduce(function (a, b) { return a + b; }, 0), gl = -losses.reduce(function (a, b) { return a + b; }, 0);
    var net = nets.reduce(function (a, b) { return a + b; }, 0);
    var exp = mean(nets), se = nets.length > 1 ? sd(nets) / Math.sqrt(nets.length) : 0;
    var maxDD = 0, peak = -Infinity, uw = 0, uwMax = 0, uwStart = null;
    curve.forEach(function (p) {
      if (p.equity >= peak) { peak = p.equity; if (uwStart != null) { uwMax = Math.max(uwMax, p.ts - uwStart); uwStart = null; } }
      else { if (uwStart == null) uwStart = p.ts; maxDD = Math.max(maxDD, (peak - p.equity) / peak); }
    });
    if (uwStart != null && curve.length) uwMax = Math.max(uwMax, curve[curve.length - 1].ts - uwStart);
    var rets = [];
    for (var i = 1; i < curve.length; i++) rets.push(curve[i].equity / curve[i - 1].equity - 1);
    var periodsPerYear = stepMs ? (365 * DAY) / stepMs : 0;
    var mr = mean(rets), sr = sd(rets);
    var down = rets.filter(function (r) { return r < 0; });
    var dsd = down.length ? Math.sqrt(down.reduce(function (a, r) { return a + r * r; }, 0) / rets.length) : 0;
    var by = function (key) {
      var o = {};
      trades.forEach(function (t) { var k = t[key]; o[k] = o[k] || { n: 0, net: 0, wins: 0 }; o[k].n++; o[k].net += t.net; if (t.net > 0) o[k].wins++; });
      return o;
    };
    var notional = trades.reduce(function (a, t) { return a + (t.notional || 0); }, 0);
    var top = nets.slice().sort(function (a, b) { return b - a; });
    return {
      n: trades.length, net: net, ret: startEquity ? net / startEquity : 0,
      winRate: trades.length ? wins.length / trades.length : 0,
      avgWin: wins.length ? gw / wins.length : 0, avgLoss: losses.length ? -gl / losses.length : 0,
      profitFactor: gl > 0 ? gw / gl : (gw > 0 ? Infinity : 0),
      expectancy: exp, expectancyCI: [exp - 1.96 * se, exp + 1.96 * se],
      maxDD: maxDD, timeUnderWaterMs: uwMax,
      sharpe: sr > 0 && periodsPerYear ? mr / sr * Math.sqrt(periodsPerYear) : null,
      sortino: dsd > 0 && periodsPerYear ? mr / dsd * Math.sqrt(periodsPerYear) : null,
      sampling: stepMs ? (stepMs / 60e3) + 'm returns, annualised ×√' + Math.round(periodsPerYear) + ' (365-day year)' : '',
      fees: trades.reduce(function (a, t) { return a + (t.fees || 0); }, 0),
      funding: trades.reduce(function (a, t) { return a + (t.funding || 0); }, 0),
      spread: trades.reduce(function (a, t) { return a + (t.spreadCost || 0); }, 0),
      slippage: trades.reduce(function (a, t) { return a + (t.impactCost || 0); }, 0),
      turnover: startEquity ? notional / startEquity : 0,
      avgHoldMs: mean(trades.map(function (t) { return t.holdMs || 0; })),
      topTradeShare: net > 0 && top.length ? top[0] / net : null,
      byInstrument: by('instrument'), byStrategy: by('strategy')
    };
  }

  /* Paper-account curve sampled at a fixed step from the snapshot log. */
  function resampleCurve(snaps, stepMs) {
    if (!snaps.length) return [];
    var out = [], t = snaps[0].ts, j = 0;
    var end = snaps[snaps.length - 1].ts;
    while (t <= end) {
      while (j + 1 < snaps.length && snaps[j + 1].ts <= t) j++;
      out.push({ ts: t, equity: fromMicro(snaps[j].equity) });
      t += stepMs;
    }
    return out;
  }

  /* ---------------------------------------------------------- persistence */

  function serialize(state) { return JSON.stringify(state); }
  function deserialize(json) {
    var s = JSON.parse(json);
    if (!s || s.schema !== 1) throw new Error('unsupported ledger schema');
    // strategy registry may have gained entries since the ledger was written
    Object.keys(STRATEGIES).forEach(function (id) {
      if (!s.strategies[id]) { var d = STRATEGIES[id]; s.strategies[id] = { engine: d.engine, name: d.name, version: d.version, status: d.status, enabled: d.status === 'paper' }; }
    });
    return s;
  }

  return {
    EXECUTION_MODE: EXECUTION_MODE, DEFAULT_CONFIG: DEFAULT_CONFIG, STRATEGIES: STRATEGIES, LIFECYCLE: LIFECYCLE,
    HOUR: HOUR, DAY: DAY,
    toMicro: toMicro, fromMicro: fromMicro, clamp: clamp, roundTo: roundTo, hash: hash, canonical: canonical, mean: mean, sd: sd,
    newState: newState, audit: audit, reconcile: reconcile, equity: equity, exposure: exposure, openRiskUsd: openRiskUsd,
    mark: mark, halt: halt, resume: resume, blockingHalts: blockingHalts, setStrategy: setStrategy,
    evaluate: evaluate, evaluateManual: evaluateManual, createOrder: createOrder, rejectOrder: rejectOrder, transition: transition, applyFill: applyFill,
    accrueFunding: accrueFunding, liquidate: liquidate, refreshRisk: refreshRisk, recordSignal: recordSignal,
    metrics: metrics, resampleCurve: resampleCurve, serialize: serialize, deserialize: deserialize, assertPaper: assertPaper,
    posValue: posValue
  };
});
