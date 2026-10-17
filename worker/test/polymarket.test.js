// F1.7 selection and F2.6 void handling.
const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyResolution, isEligible, toMarket } = require('../src/polymarket');
const { runResolve } = require('../src/resolver');

test('resolution: YES, NO, 50/50 void, still open', () => {
  const base = { closed: true, umaResolutionStatus: 'resolved', closedTime: '2026-10-17 12:00:00+00' };
  assert.deepEqual({ ...classifyResolution({ ...base, outcomePrices: '["1","0"]' }), at: undefined }, { state: 'resolved', yes: 1, at: undefined });
  assert.equal(classifyResolution({ ...base, outcomePrices: '["0","1"]' }).yes, 0);
  assert.equal(classifyResolution({ ...base, outcomePrices: '["0.5","0.5"]' }).state, 'void');
  assert.equal(classifyResolution({ closed: true, umaResolutionStatus: 'proposed', outcomePrices: '["1","0"]' }).state, 'open');
  assert.equal(classifyResolution({ ...base, outcomePrices: '["1","0"]' }).at.toISOString(), '2026-10-17T12:00:00.000Z');
});

test('resolver marks void markets void and resolved markets resolved', async () => {
  const updates = [];
  const db = { async openMarketIds() { return ['a', 'b', 'c']; }, async resolveMarket(id, u) { updates.push([id, u.status, u.resolvedYes]); } };
  const pm = { async resolution(id) { return { a: { state: 'resolved', yes: 1, at: new Date() }, b: { state: 'void', at: new Date() }, c: { state: 'open' } }[id]; } };
  const stats = await runResolve({ pm, db, log: { error() {} } });
  assert.deepEqual(updates, [['a', 'resolved', 1], ['b', 'void', null]]);
  assert.deepEqual(stats, { checked: 3, resolved: 1, void: 1, errors: 0 });
});

test('eligibility: volume, liquidity, end within 90 days, binary', () => {
  const cfg = { minVolume24hUsd: 10000, minLiquidityUsd: 5000, maxDaysToEnd: 90 };
  const now = Date.parse('2026-10-18T00:00:00Z');
  const raw = { conditionId: '0x1', question: 'Q', clobTokenIds: '["1","2"]', outcomes: '["Yes","No"]', endDate: '2026-11-01T00:00:00Z', volume24hr: 20000, liquidityNum: 9000 };
  assert.equal(isEligible(toMarket(raw), cfg, now), true);
  assert.equal(isEligible(toMarket({ ...raw, volume24hr: 9999 }), cfg, now), false);
  assert.equal(isEligible(toMarket({ ...raw, liquidityNum: 4999 }), cfg, now), false);
  assert.equal(isEligible(toMarket({ ...raw, endDate: '2027-03-01T00:00:00Z' }), cfg, now), false);
  assert.equal(isEligible(toMarket({ ...raw, endDate: '2026-10-01T00:00:00Z' }), cfg, now), false);
  assert.equal(isEligible(toMarket({ ...raw, outcomes: '["A","B","C"]' }), cfg, now), false);
});
