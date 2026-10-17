// Shared edge module: the spec's worked examples must match to the cent.
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../js/edge.js');

const cents = (x) => Math.round(x * 100) / 100;

test('A: big edge hits the 5% cap', () => {
  assert.equal(cents(E.netEdgeCents(0.58, 0.46, 100)), 11.54);
  assert.equal(Number(E.kelly(0.58, 0.46, 100).toFixed(4)), 0.2155);
  const s = E.stake(0.58, 0.46, 100, 10000);
  assert.equal(cents((s.kelly / 4) * 10000), 538.85); // quarter Kelly before the cap
  assert.equal(s.stake, 500);
  assert.equal(s.limitedBy, 'cap');
});

test('B: small edge, quarter Kelly', () => {
  assert.equal(cents(E.netEdgeCents(0.52, 0.48, 0)), 4.0);
  assert.equal(Number(E.kelly(0.52, 0.48, 0).toFixed(4)), 0.0769);
  const s = E.stake(0.52, 0.48, 0, 10000);
  assert.equal(cents(s.stake), 192.31);
  assert.equal(s.limitedBy, 'kelly');
});

test('C: no edge means no bet', () => {
  assert.equal(cents(E.netEdgeCents(0.5, 0.51, 0)), -1.0);
  const s = E.stake(0.5, 0.51, 0, 10000);
  assert.equal(s.stake, 0);
  assert.equal(s.noBet, true);
});

test('stake never exceeds the depth limit', () => {
  const asks = [{ price: '0.46', size: '300' }, { price: '0.50', size: '400' }, { price: '0.60', size: '1000' }];
  const d = E.depthLimit(0.58, asks, 100); // 0.60 × 1.01 > 0.58, so the third level is excluded
  assert.equal(cents(d.usd), 338);         // 0.46·300 + 0.50·400
  const s = E.stake(0.58, 0.46, 100, 10000, d.usd);
  assert.equal(cents(s.stake), 338);
  assert.equal(s.limitedBy, 'depth');
});

test('depth limit is zero when even the best ask has no edge', () => {
  assert.equal(E.depthLimit(0.4, [{ price: 0.45, size: 100 }], 0).usd, 0);
});

test('side selection and side probability', () => {
  assert.equal(E.chooseSide(0.6, 0.5), 'YES');
  assert.equal(E.chooseSide(0.4, 0.5), 'NO');
  assert.equal(E.chooseSide(0.5, 0.5), 'NO');
  assert.equal(E.sideProb(0.3, 'NO'), 0.7);
});

test('YES side without fees: edge, Brier and P&L', () => {
  const r = E.evaluate({ p: 0.6, m: 0.5, ask: 0.51, feeBps: 0, y: 1 });
  assert.equal(r.side, 'YES');
  assert.equal(cents(r.netEdgeC), 9);
  assert.equal(cents(r.brierModel), 0.16);
  assert.equal(cents(r.brierMarket), 0.25);
  assert.equal(Math.round(r.netPnlBps), 9608); // (1 − 0.51) / 0.51
});

test('NO side with fees: edge and a loss', () => {
  const r = E.evaluate({ p: 0.3, m: 0.4, ask: 0.62, feeBps: 100, y: 1 });
  assert.equal(r.side, 'NO');
  assert.equal(cents(r.netEdgeC), 7.38); // 0.7 − 0.62 × 1.01
  assert.equal(r.won, false);
  assert.equal(Math.round(r.netPnlBps), -10000); // a lost stake is −100%; fees are inside the cost
});

test('NO side without fees wins', () => {
  const r = E.evaluate({ p: 0.2, m: 0.35, ask: 0.66, feeBps: 0, y: 0 });
  assert.equal(r.won, true);
  assert.equal(Math.round(r.netPnlBps), Math.round((1 - 0.66) / 0.66 * 10000));
});

test('Brier skill', () => {
  assert.equal(Number(E.brierSkill(0.2, 0.25).toFixed(2)), 0.2);
  assert.equal(E.brierSkill(null, 0.25), null);
  assert.equal(E.brierSkill(0.2, 0), null);
});

test('Polymarket fee: rate · (1 − p) of the amount paid when exponent is 1', () => {
  const m = { feesEnabled: true, feeSchedule: { rate: 0.05, exponent: 1 } };
  assert.equal(cents(E.polymarketFeeBps(m, 0.46)), 270); // 5% × 0.54
  // Docs example: 100 shares at 0.50, crypto rate 0.07 → $1.75 on $50 spent = 350 bps
  assert.equal(cents(E.polymarketFeeBps({ feesEnabled: true, feeSchedule: { rate: 0.07, exponent: 1 } }, 0.5)), 350);
  assert.equal(E.polymarketFeeBps({ feesEnabled: false, feeSchedule: { rate: 0.05 } }, 0.46), 0);
  assert.equal(E.polymarketFeeBps(m, 0), 0);
});
