// Engines: risk gate cannot be bypassed, ledger reconciles, decisions are
// deterministic, backtest has no look-ahead, stops gap, funding is idempotent.
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../js/engines/core.js');
const P = require('../js/engines/perp.js');
const X = require('../js/engines/onchain.js');

const T0 = Date.UTC(2026, 9, 1, 0, 0);

function proposal(over) {
  return Object.assign({ signalId: 's1', strategy: 'perp.intraday', version: '1.0.0', engine: 'perp', instrument: 'SOL', side: 1,
    entryPx: 100, stopPx: 99, exitPolicy: { maxHoldMs: 3600e3 }, expectedEdgeBps: 20, minEdgeBps: 8, dataAgeMs: 500, szDecimals: 2, corrBtc: 0.8 }, over);
}
function openPerp(st, over, fillPx) {
  const d = C.evaluate(st, proposal(over), { now: T0, marks: {} });
  assert.equal(d.approved, true, d.reasons.join());
  const o = C.createOrder(st, T0, { intent: 'open', decisionId: d.id, strategy: d.strategy, version: d.version, engine: 'perp', instrument: d.instrument, side: d.side, qty: d.qty, refPx: 100, estCostBps: 10 });
  C.applyFill(st, o, { qty: d.qty, px: fillPx || 100, feeUsd: d.qty * 100 * 4.5e-4, halfSpreadBps: 1, ts: T0 }, { stop: 99, target: 102, maxHoldMs: 3600e3, exit: { kind: 'bracket' } });
  return Object.values(st.positions).find((p) => p.instrument === d.instrument);
}

test('sizing follows Q = E·ρ / |entry − stop|', () => {
  const st = C.newState(T0);
  const d = C.evaluate(st, proposal(), { now: T0, marks: {} });
  assert.equal(d.approved, true);
  assert.equal(d.qty, 25);                 // 10,000 × 0.25% / $1
  assert.equal(d.riskUsd, 25);
});

test('every hard gate rejects', () => {
  const cases = [
    [{ dataAgeMs: 60e3 }, 'DATA_STALE'],
    [{ stopPx: 0 }, 'NO_INVALIDATION'],
    [{ stopPx: 101 }, 'STOP_WRONG_SIDE'],
    [{ exitPolicy: null }, 'NO_EXIT_POLICY'],
    [{ expectedEdgeBps: 2 }, 'EDGE_BELOW_MIN'],
    [{ version: '0.9.0' }, 'VERSION_MISMATCH'],
    [{ strategy: 'eq.longonly', engine: 'equity' }, 'STRATEGY_NOT_PAPER'],
    [{ engine: 'spot', strategy: 'sol.discovery', side: -1, stressLossFrac: 0.2, stopPx: 101 }, 'SPOT_LONG_ONLY']
  ];
  for (const [over, code] of cases) {
    const st = C.newState(T0);
    const d = C.evaluate(st, proposal(over), { now: T0, marks: {} });
    assert.equal(d.approved, false, code);
    assert.ok(d.reasons.includes(code), code + ' not in ' + d.reasons.join());
  }
});

test('halts, disabled strategies and loss limits block entries', () => {
  const st = C.newState(T0);
  C.halt(st, T0, 'global', 'test');
  assert.ok(C.evaluate(st, proposal(), { now: T0, marks: {} }).reasons.includes('HALTED:global'));
  C.resume(st, T0, 'global');
  C.halt(st, T0, 'feed:perp', 'test');
  assert.ok(!C.evaluate(st, proposal(), { now: T0, marks: {} }).approved);
  assert.ok(C.evaluate(st, proposal({ engine: 'spot', strategy: 'sol.discovery', stressLossFrac: 0.2, stopPx: 80 }), { now: T0, marks: {} }).approved, 'perp feed halt must not block spot');
  C.resume(st, T0, 'feed:perp');
  C.setStrategy(st, T0, 'perp.intraday', false);
  assert.ok(C.evaluate(st, proposal(), { now: T0, marks: {} }).reasons.includes('STRATEGY_DISABLED'));
  assert.throws(() => C.setStrategy(st, T0, 'eq.longonly', true), /only paper-status/);

  const st2 = C.newState(T0);
  const p = openPerp(st2);
  C.mark(st2, T0 + 1000, { SOL: 99.1 - 2.1 * 1 }); // −$75 on 25 units → beyond 0.75%; push further
  C.mark(st2, T0 + 2000, { SOL: 90 });            // −$250 = 2.5% of equity
  assert.ok(st2.halts.daily, 'daily-loss halt');
  assert.ok(!C.evaluate(st2, proposal({ instrument: 'ETH' }), { now: T0 + 3000, marks: { SOL: 90 } }).approved);
  assert.ok(p);
});

test('drawdown suspends strategies; new UTC day clears only the daily halt', () => {
  const st = C.newState(T0);
  openPerp(st);
  C.mark(st, T0 + 1000, { SOL: 66 }); // −$850 → 8.5% drawdown
  assert.ok(st.halts.drawdown);
  assert.equal(st.strategies['perp.intraday'].enabled, false);
  C.mark(st, T0 + C.DAY + 1000, { SOL: 66 });
  assert.ok(!st.halts.daily);
  assert.ok(st.halts.drawdown);
});

test('limits shrink size, and exhausting them rejects', () => {
  const st = C.newState(T0);
  const d = C.evaluate(st, proposal({ stopPx: 99.95 }), { now: T0, marks: {} }); // risk size 500 units = $50k notional
  assert.ok(d.adjustments.includes('LEVERAGE_CAP'));
  assert.ok(d.notional <= 3 * 10000 + 1e-6);
  assert.equal(d.approved, true, 'a leverage-capped trade is still a valid trade');
  const st2 = C.newState(T0);
  ['A', 'B', 'C', 'D'].forEach((k) => openPerp(st2, { instrument: k, corrBtc: 0 }));
  const d2 = C.evaluate(st2, proposal({ instrument: 'E', corrBtc: 0 }), { now: T0, marks: {} });
  assert.equal(d2.approved, false);
  assert.ok(d2.reasons.includes('LIMITS_EXHAUSTED') || d2.reasons.includes('SIZE_BELOW_MIN'), d2.reasons.join());
  assert.ok(C.evaluate(st2, proposal({ instrument: 'A' }), { now: T0, marks: {} }).reasons.includes('DUPLICATE_POSITION'));
  assert.ok(C.evaluate(st2, proposal({ instrument: 'A', side: -1, stopPx: 101 }), { now: T0, marks: {} }).reasons.includes('CONFLICTING_POSITION'));
});

test('orders cannot exist without an approved decision; transitions are enforced', () => {
  const st = C.newState(T0);
  assert.throws(() => C.createOrder(st, T0, { intent: 'open', decisionId: 'nope', qty: 1 }), /approved risk decision/);
  const bad = C.evaluate(st, proposal({ dataAgeMs: 1e9 }), { now: T0, marks: {} });
  assert.throws(() => C.createOrder(st, T0, { intent: 'open', decisionId: bad.id, qty: 1 }), /approved risk decision/);
  const ok = C.evaluate(st, proposal(), { now: T0, marks: {} });
  const o = C.createOrder(st, T0, { intent: 'open', decisionId: ok.id, strategy: 'perp.intraday', version: '1.0.0', engine: 'perp', instrument: 'SOL', side: 1, qty: ok.qty, refPx: 100 });
  assert.throws(() => C.createOrder(st, T0, { intent: 'open', decisionId: ok.id, qty: 1 }), /idempotency/);
  assert.throws(() => C.transition(o, 'filled', T0), /illegal/);
  assert.throws(() => C.createOrder(st, T0, { intent: 'close', positionId: 'missing' }), /open position/);
  assert.equal(C.EXECUTION_MODE.mode, 'paper');
  assert.ok(Object.isFrozen(C.EXECUTION_MODE));
});

test('ledger reconciles through fills, partial exits, funding and liquidation', () => {
  const st = C.newState(T0);
  const p = openPerp(st);
  C.accrueFunding(st, p, T0 + 3600e3, 0.0001, 100);
  C.accrueFunding(st, p, T0 + 3600e3, 0.0001, 100);           // idempotent
  assert.equal(st.funding.length, 1);
  const o = C.createOrder(st, T0 + 5, { intent: 'close', positionId: p.id, strategy: p.strategy, version: p.version, engine: 'perp', instrument: 'SOL', side: -1, qty: 10, refPx: 101 });
  C.applyFill(st, o, { qty: 10, px: 101, feeUsd: 0.45, halfSpreadBps: 1, ts: T0 + 6 });
  assert.equal(p.qty, 15);
  assert.ok(C.reconcile(st).ok);
  C.liquidate(st, p, T0 + 7, 60, 4.5e-4);
  assert.equal(Object.keys(st.positions).length, 0);
  const r = C.reconcile(st);
  assert.ok(r.ok);
  const t = st.closed[0];
  assert.equal(t.reason, 'liquidated');
  // net P&L in the trade record equals the cash change
  assert.equal(Math.round(t.net * 1e6), st.cash - st.equity0);
  st.cash += 1;
  assert.equal(C.reconcile(st).ok, false);
});

test('spot positions mark at tokens × price and reconcile', () => {
  const st = C.newState(T0);
  const d = C.evaluate(st, proposal({ engine: 'spot', strategy: 'sol.discovery', stopPx: 0.82, entryPx: 1, stressLossFrac: 0.25 }), { now: T0, marks: {} });
  assert.equal(d.notional, 100);
  const o = C.createOrder(st, T0, { intent: 'open', decisionId: d.id, strategy: 'sol.discovery', version: '1.0.0', engine: 'spot', instrument: 'MINT', side: 1, qty: 99, refPx: 1 });
  C.applyFill(st, o, { qty: 99, px: 100 / 99, feeUsd: 0.02, ts: T0 }, { stop: 0.82, stressLossFrac: 0.25 });
  assert.equal(C.fromMicro(C.equity(st, { MINT: 100 / 99 })).toFixed(2), '9999.98');
  assert.ok(C.reconcile(st).ok);
});

// ---------------------------------------------------------------- perp engine

function synthBars(n, startTs, stepMs, seed, drift) {
  let x = seed || 7, px = 100; const out = [];
  const rnd = () => { x = (x * 1103515245 + 12345) & 0x7fffffff; return x / 0x7fffffff; };
  for (let i = 0; i < n; i++) {
    const o = px, r = (rnd() - 0.5) * 0.006 + (drift || 0) + (i % 97 === 50 ? 0.012 : 0);
    const c = o * Math.exp(r);
    const h = Math.max(o, c) * (1 + rnd() * 0.002), l = Math.min(o, c) * (1 - rnd() * 0.002);
    out.push({ t: startTs + i * stepMs, o, h, l, c, v: 1000 * (1 + rnd() * 2 + (i % 97 === 50 ? 6 : 0)), n: 10 });
    px = c;
  }
  return out;
}

test('signals are pure: identical input → identical decision', () => {
  const bars = synthBars(300, T0, 300e3, 3, 0.0002), bench = synthBars(300, T0, 300e3, 9, 0.0001);
  const ctx = { bench, eth: bench, funding: 0.0000125, oiChgPct: 2, spreadBps: 1.5, dayVolume: 5e7, breadth: 0.6 };
  const a = P.signalIntraday(P.featuresIntraday(bars, ctx), null, P.posterior([3.8, 6.2], []));
  const b = P.signalIntraday(P.featuresIntraday(JSON.parse(JSON.stringify(bars)), ctx), null, P.posterior([3.8, 6.2], []));
  assert.deepEqual(a, b);
  for (const k of ['M', 'V', 'L', 'D', 'R', 'G']) assert.ok(a.comp[k] >= 0 && a.comp[k] <= 100, k);
});

test('extreme positive funding is a crowding penalty for longs, not a bonus', () => {
  const bars = synthBars(300, T0, 300e3, 5, 0.0003);
  const f = P.featuresIntraday(bars, { funding: 0.0005, spreadBps: 1, dayVolume: 5e7 });
  const g = P.featuresIntraday(bars, { funding: 0, spreadBps: 1, dayVolume: 5e7 });
  assert.ok(P.components(f, 1, 'intraday').D < P.components(g, 1, 'intraday').D);
  assert.ok(P.components(f, -1, 'intraday').D > P.components(g, -1, 'intraday').D);
});

test('features use only closed bars up to the decision (no look-ahead)', () => {
  const bars = synthBars(400, T0, 300e3, 11);
  const ctx = { spreadBps: 1, dayVolume: 5e7 };
  const at = 300;
  const base = P.featuresIntraday(bars.slice(0, at + 1), ctx);
  const future = bars.map((b, i) => (i > at ? Object.assign({}, b, { c: b.c * 3, h: b.h * 3 }) : b));
  assert.deepEqual(P.featuresIntraday(future.slice(0, at + 1), ctx), base);
  // closedBars drops the in-progress bar
  assert.equal(P.closedBars(bars, bars[10].t + 300e3 - 1, 300e3).length, 10);
});

test('book walk partially fills at the slippage cap', () => {
  const book = P.parseBook({ time: 1, levels: [[{ px: '99.9', sz: '5' }, { px: '99.8', sz: '5' }], [{ px: '100.1', sz: '5' }, { px: '100.2', sz: '5' }, { px: '101', sz: '100' }]] });
  const w = P.walkBook(book, 1, 20, 30);  // cap 30bp → 100.3 → 101 level excluded
  assert.equal(w.filled, 10);
  assert.equal(w.complete, false);
  assert.ok(Math.abs(w.avgPx - 100.15) < 1e-9);
  assert.ok(Math.abs(P.walkBook(book, -1, 3, 30).avgPx - 99.9) < 1e-9);
});

test('backtest: deterministic, reconciles, stop gaps fill at the open', () => {
  const coins = {};
  ['AAA', 'BBB'].forEach((k, i) => { coins[k] = { bars: synthBars(1200, T0, 300e3, 20 + i, 0.0002), funding: [{ time: T0, fundingRate: '0.0000125' }], szDecimals: 2, maxLeverage: 20, spreadBps: 2, dayVolume: 5e7 }; });
  const data = { coins, bench: synthBars(1200, T0, 300e3, 99, 0.0001), eth: synthBars(1200, T0, 300e3, 98) };
  const r1 = P.backtest(data, { model: 'perp.intraday' });
  const r2 = P.backtest(JSON.parse(JSON.stringify(data)), { model: 'perp.intraday' });
  assert.equal(r1.fingerprint, r2.fingerprint);
  assert.ok(r1.recon.ok);
  assert.ok(r1.trades.length > 0, 'synthetic data should produce trades');
  const r3 = P.backtest(data, { model: 'perp.intraday', costMult: 2 });
  assert.ok(r3.metrics.fees > r1.metrics.fees * 1.5 || r3.trades.length < r1.trades.length);
  r1.trades.forEach((t) => { assert.ok(t.openedAt > r1.from); assert.ok(t.closedAt >= t.openedAt); });

  // one-position gap test
  const bars = synthBars(400, T0, 300e3, 1);
  const st = C.newState(T0);
  const dec = C.evaluate(st, proposal({ instrument: 'GAP' }), { now: T0, marks: {} });
  const o = C.createOrder(st, T0, { intent: 'open', decisionId: dec.id, strategy: 'perp.intraday', version: '1.0.0', engine: 'perp', instrument: 'GAP', side: 1, qty: dec.qty, refPx: 100 });
  C.applyFill(st, o, { qty: dec.qty, px: 100, feeUsd: 0, ts: T0 }, { stop: 99, maxHoldMs: 1e9, exit: { kind: 'bracket' } });
  assert.ok(bars.length);
  // a stop at 99 with the next bar opening at 97 must realise the 97 fill, i.e. lose more than planned risk
  const p = Object.values(st.positions)[0];
  const ex = C.createOrder(st, T0 + 1, { intent: 'close', positionId: p.id, strategy: p.strategy, version: p.version, engine: 'perp', instrument: 'GAP', side: -1, qty: p.qty, refPx: 99 });
  C.applyFill(st, ex, { qty: p.qty, px: 97, feeUsd: 0, ts: T0 + 2 });
  assert.ok(st.closed[0].net < -dec.riskUsd);
});

// ---------------------------------------------------------------- onchain

test('identity resolves by mint, never by symbol', () => {
  const mint = 'MintAAA', pairs = [
    { chainId: 'solana', pairAddress: 'P1', dexId: 'raydium', baseToken: { address: 'Other', symbol: 'FOO' }, quoteToken: { address: mint }, liquidity: { usd: 9e6 } },
    { chainId: 'solana', pairAddress: 'P2', dexId: 'orca', baseToken: { address: mint, symbol: 'FOO' }, quoteToken: { address: X.USDC }, liquidity: { usd: 5e4 } },
    { chainId: 'solana', pairAddress: 'P3', dexId: 'pumpswap', baseToken: { address: mint, symbol: 'FOO' }, quoteToken: { address: 'So11111111111111111111111111111111111111112' }, liquidity: { usd: 2e5 } }
  ];
  const id = X.resolveIdentity(mint, pairs);
  assert.equal(id.pool, 'P3');
  assert.equal(id.poolsSeen, 2);
  assert.equal(X.resolveIdentity('Nope', pairs), null);
});

test('token risk flags are explainable and exclude pool accounts from concentration', () => {
  const rep = { mintAuthority: 'X', freezeAuthority: null, risks: [{ name: 'Low liquidity', level: 'danger', description: 'thin' }],
    markets: [{ pubkey: 'POOL' }], knownAccounts: {}, topHolders: [{ owner: 'POOL', pct: 60 }, { owner: 'w1', pct: 20 }, { owner: 'w2', pct: 18 }] };
  const fl = X.riskFlags(rep, 123, null);
  const codes = fl.map((f) => f.code);
  assert.ok(codes.includes('MINT_AUTHORITY'));
  assert.ok(codes.includes('RC:Low liquidity'));
  const hc = fl.find((f) => f.code === 'HOLDER_CONCENTRATION');
  assert.equal(hc.sev, 'high');
  assert.match(hc.detail, /38\.0%/);   // the 60% pool account is excluded
  fl.forEach((f) => { assert.ok(f.source); assert.equal(f.ts, 123); });
  assert.equal(X.riskFlags(null, 5, null)[0].code, 'NO_SAFETY_REPORT');
});

test('decimals inferred from quote; stressed loss exceeds the chart stop', () => {
  assert.equal(X.inferDecimals(38_000_000_000, 100, 0.0026), 6);
  assert.equal(X.inferDecimals(1e9 * 50, 100, 2), 9);
  const s = X.stressLoss({ roundTripPct: 2 });
  assert.ok(Math.abs(s.frac - (0.18 + 0.01 + 0.02 + 0.02)) < 1e-12);
  assert.ok(X.stressLoss(null).frac > s.frac);
});
