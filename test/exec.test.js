// Execution layer: Hyperliquid wire format (mirrors hyperliquid-python-sdk), fee maths,
// CEX tickets, and the risk gate on user-sized paper trades.
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../js/engines/exec.js');
const C = require('../js/engines/core.js');

test('floatToWire matches the SDK', () => {
  assert.equal(E.floatToWire(100), '100');
  assert.equal(E.floatToWire(0.1), '0.1');
  assert.equal(E.floatToWire(1177198), '1177198');
  assert.equal(E.floatToWire(0.0044406), '0.0044406');
  assert.equal(E.floatToWire(0), '0');
  assert.throws(() => E.floatToWire(0.123456789), /rounding/);
});

test('prices round to 5 significant figures and (6 − szDecimals) decimals', () => {
  assert.equal(E.roundPx(103.8149, 2), 103.81);
  assert.equal(E.roundPx(0.00444061234, 0), 0.004441);
  assert.equal(E.roundPx(81372.4, 5), 81372);
  assert.equal(E.roundPx(123456.7, 1), 123457);
  assert.equal(E.roundSz(4.829, 2), 4.82);   // sizes floor, never round up past what the user asked for
});

test('bracket: entry + TP + SL grouped, reduce-only exits, builder last and lower-cased', () => {
  const a = E.bracket({ asset: 5, szDecimals: 2, isBuy: true, mid: 100, size: 4.829, tpPx: 104, slPx: 98, slippagePct: 0.5 }, { b: '0xABCdef0000000000000000000000000000000001', f: 50 });
  assert.deepEqual(Object.keys(a), ['type', 'orders', 'grouping', 'builder']);
  assert.equal(a.grouping, 'normalTpsl');
  assert.deepEqual(Object.keys(a.orders[0]), ['a', 'b', 'p', 's', 'r', 't']);
  assert.deepEqual(a.orders[0], { a: 5, b: true, p: '100.5', s: '4.82', r: false, t: { limit: { tif: 'Ioc' } } });
  assert.deepEqual(a.orders[1].t, { trigger: { isMarket: true, triggerPx: '104', tpsl: 'tp' } });
  assert.equal(a.orders[1].b, false); assert.equal(a.orders[1].r, true);
  assert.deepEqual(a.orders[2].t, { trigger: { isMarket: true, triggerPx: '98', tpsl: 'sl' } });
  assert.equal(a.orders[2].p, '88.2');      // worst acceptable fill for a triggered sell
  assert.equal(a.builder.b, '0xabcdef0000000000000000000000000000000001');
  const h = E.bracket({ asset: 5, szDecimals: 2, isBuy: false, mid: 100, size: 1, tpPx: 96, slPx: null, slippagePct: 0.5 }, null);
  assert.equal(h.orders.length, 2);         // hedge mode: no stop order on the venue
  assert.equal(h.builder, undefined);
  assert.throws(() => E.bracket({ asset: 1, szDecimals: 0, isBuy: true, mid: 100, size: 0.4 }), /zero/);
});

test('close is reduce-only on the opposite side', () => {
  const a = E.closeAction(3, 1, -2.55, 50, 2, null);
  assert.deepEqual(a.orders[0], { a: 3, b: true, p: '51', s: '2.5', r: true, t: { limit: { tif: 'Ioc' } } });
});

test('commission maths', () => {
  assert.equal(E.feeRateString(50), '0.05%');
  assert.equal(E.feeRateString(1000), '1%');
  assert.equal(E.builderFeeUsd(10000, 50), 5);   // 0.05% of $10k
  assert.deepEqual(E.statuses({ data: { statuses: [{ filled: { totalSz: '2', avgPx: '10', oid: 7 } }, 'waitingForTrigger', { error: 'Insufficient margin' }] } }),
    [{ ok: true, kind: 'filled', sz: 2, px: 10, oid: 7 }, { ok: true, kind: 'waitingForTrigger' }, { ok: false, kind: 'error', error: 'Insufficient margin' }]);
});

test('CEX ticket fills symbol and referral link', () => {
  const cfg = { cex: { okx: { name: 'OKX', url: 'https://www.okx.com/trade-swap/{symbol}-usdt-swap?channelid=X' } } };
  const t = E.cexTicket('okx', cfg, { coin: 'SOL', isBuy: false, leverage: 3, size: 1.23456789, tpPx: 90, slPx: null });
  assert.equal(t.url, 'https://www.okx.com/trade-swap/sol-usdt-swap?channelid=X');
  assert.deepEqual(t.rows.find((r) => r[0] === 'Side'), ['Side', 'Sell / Short']);
  assert.match(t.rows.find((r) => r[0] === 'Stop loss')[1], /hedge/);
});

test('user-sized paper trades still pass the hard gates', () => {
  const now = Date.UTC(2026, 9, 1);
  const base = { engine: 'perp', instrument: 'SOL', side: 1, entryPx: 100, stopPx: 98, margin: 200, leverage: 3, venueMaxLev: 20, dataAgeMs: 100, szDecimals: 2 };
  const st = C.newState(now);
  const d = C.evaluateManual(st, base, { now, marks: {} });
  assert.equal(d.approved, true);
  assert.equal(d.qty, 6);                    // $200 × 3 / $100
  const bad = (over, code) => {
    const r = C.evaluateManual(C.newState(now), Object.assign({}, base, over), { now, marks: {} });
    assert.equal(r.approved, false, code); assert.ok(r.reasons.includes(code), code + ' ∉ ' + r.reasons);
  };
  bad({ leverage: 11 }, 'LEVERAGE_ABOVE_MAX');
  bad({ leverage: 5, venueMaxLev: 3 }, 'LEVERAGE_ABOVE_MAX');
  bad({ margin: 20000 }, 'INSUFFICIENT_MARGIN');
  bad({ dataAgeMs: 60000 }, 'DATA_STALE');
  bad({ stopPx: 101 }, 'STOP_WRONG_SIDE');
  bad({ engine: 'spot', leverage: 2 }, 'SPOT_NO_LEVERAGE');
  bad({ margin: 2, leverage: 1 }, 'SIZE_BELOW_MIN');
  const h = C.evaluateManual(C.newState(now), Object.assign({}, base, { stopPx: 0, hedgeOf: 'ps_1' }), { now, marks: {} });
  assert.equal(h.approved, true, 'a hedge leg needs no stop of its own');
  C.halt(st, now, 'global', 'paused');
  assert.ok(C.evaluateManual(st, Object.assign({}, base, { instrument: 'ETH' }), { now, marks: {} }).reasons.includes('HALTED:global'));
});
