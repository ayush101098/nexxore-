// Forecast run: every forecast logged from one snapshot, reforecast rule, failure stop.
const test = require('node:test');
const assert = require('node:assert/strict');
const { runForecast, buildRow, isDue } = require('../src/forecaster');

const CFG = {
  maxMarketsPerDay: 200, callThresholdCents: 3,
  reforecastHours: 6, reforecastMoveCents: 5, maxDaysToEnd: 90, minVolume24hUsd: 10000, minLiquidityUsd: 5000
};
const MKT = (id) => ({ marketId: id, question: `Q ${id}`, rules: 'r', endDate: '2026-12-01T00:00:00Z', category: 'politics', slug: id, liquidity: 9000, volume24h: 20000, feesEnabled: false });
const SNAP = { mid: 0.5, yesAsk: 0.51, noAsk: 0.5, at: new Date('2026-10-18T10:00:00Z') };
const log = { info() {}, error() {} };

function fakeDb({ latest = {} } = {}) {
  const db = { rows: [],
    async marketsForecastToday() { return new Set(); },
    async latestByMarket() { return latest; },
    async upsertMarket() {},
    async insertForecast(row, reasoning) { db.rows.push({ row, reasoning }); }
  };
  return db;
}
const fakePm = (markets, snap = SNAP) => ({ async listEligible() { return markets; }, async snapshot() { return snap; } });
function fakeModel(p = 0.6) {
  const model = { calls: 0, forecast() { model.calls++; return { probability: typeof p === 'function' ? p() : p, thesis: 't', invalidation: 'i', reasoning: { model: 'v1' }, modelIds: ['v1'], promptVersion: 'v1' }; } };
  return model;
}

test('every forecast is logged; only ≥ threshold rows are calls', async () => {
  const db = fakeDb();
  // p 0.6 vs ask 0.51 → +9¢ (call); p 0.52 vs 0.51 → +1¢ (logged, not a call)
  let n = 0; const model = fakeModel(() => (n++ === 0 ? 0.6 : 0.52));
  await runForecast({ cfg: CFG, pm: fakePm([MKT('a'), MKT('b')]), model, db, log });
  assert.equal(db.rows.length, 2);
  assert.deepEqual(db.rows.map((r) => r.row.is_call), [true, false]);
  assert.ok(db.rows.every((r) => r.row.prompt_version === 'v1' && r.row.status === 'open'));
});

test('no order book: no ledger row', async () => {
  const db = fakeDb();
  const model = fakeModel();
  const stats = await runForecast({ cfg: CFG, pm: fakePm([MKT('a')], null), model, db, log });
  assert.equal(db.rows.length, 0);
  assert.equal(model.calls, 0);
  assert.equal(stats.skipped, 1);
});

test('row maths: side, entry ask, fee and call flag use the shared module', () => {
  const m = { ...MKT('a'), feesEnabled: true, feeSchedule: { rate: 0.05, exponent: 1 } };
  const r = buildRow(m, { probability: 0.3, thesis: 't', invalidation: 'i', promptVersion: 'v1' }, { mid: 0.4, yesAsk: 0.41, noAsk: 0.61, at: new Date() }, CFG);
  assert.equal(r.side, 'NO');
  assert.equal(r.entry_price, 0.61);
  assert.equal(r.fee_bps, 195);       // 5% × (1 − 0.61)
  assert.equal(r.is_call, true);      // 0.7 − 0.61 × 1.0195 = 7.81¢
});

test('reforecast after 6 hours or a 5¢ move', () => {
  const now = Date.parse('2026-10-18T12:00:00Z');
  assert.equal(isDue(null, null, CFG, now), true);
  assert.equal(isDue({ flagged_at: '2026-10-18T05:00:00Z', market_prob: 0.5 }, 0.5, CFG, now), true);
  assert.equal(isDue({ flagged_at: '2026-10-18T10:00:00Z', market_prob: 0.5 }, 0.52, CFG, now), false);
  assert.equal(isDue({ flagged_at: '2026-10-18T10:00:00Z', market_prob: 0.5 }, 0.55, CFG, now), true);
});

test('three markets without a book in a row stop the run', async () => {
  const db = fakeDb(); const model = fakeModel();
  const stats = await runForecast({ cfg: CFG, pm: fakePm(['a', 'b', 'c', 'd', 'e'].map(MKT), null), model, db, log });
  assert.equal(stats.skipped, 3);
  assert.equal(stats.stoppedBy, 'consecutive_failures');
});

test('the ledger row uses the snapshot the forecast was made from', async () => {
  const db = fakeDb(); let seen = null;
  const model = { forecast(m, snap) { seen = snap; return fakeModel(0.6).forecast(); } };
  await runForecast({ cfg: CFG, pm: fakePm([MKT('a')]), model, db, log });
  assert.equal(seen, SNAP);
  assert.equal(db.rows[0].row.flagged_at, SNAP.at.toISOString());
  assert.equal(db.rows[0].row.market_prob, SNAP.mid);
});
