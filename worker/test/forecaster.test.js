// F1/F2: budget stop, failed calls leave no row, every forecast logged, reforecast rule.
const test = require('node:test');
const assert = require('node:assert/strict');
const { runForecast, buildRow, isDue } = require('../src/forecaster');

const CFG = {
  dailyBudgetUsd: 10, perForecastReserveUsd: 0.15, maxMarketsPerDay: 200, callThresholdCents: 3,
  reforecastHours: 6, reforecastMoveCents: 5, maxDaysToEnd: 90, minVolume24hUsd: 10000, minLiquidityUsd: 5000
};
const MKT = (id) => ({ marketId: id, question: `Q ${id}`, rules: 'r', endDate: '2026-12-01T00:00:00Z', category: 'politics', slug: id, liquidity: 9000, volume24h: 20000, feesEnabled: false });
const SNAP = { mid: 0.5, yesAsk: 0.51, noAsk: 0.5, at: new Date('2026-10-18T10:00:00Z') };
const log = { info() {}, error() {} };

function fakeDb({ spent = 0, latest = {} } = {}) {
  const db = { rows: [], spends: [], spent,
    async spentToday() { return db.spent; },
    async marketsForecastToday() { return new Set(); },
    async latestByMarket() { return latest; },
    async upsertMarket() {},
    async insertForecast(row, reasoning, spends) { db.rows.push({ row, reasoning }); db.spends.push(...spends); },
    async recordSpend(spends) { db.spends.push(...spends); }
  };
  return db;
}
const fakePm = (markets, snap = SNAP) => ({ async listEligible() { return markets; }, async snapshot() { return snap; } });
const spend = (c) => ({ model: 'm', input_tokens: 10, output_tokens: 5, cost_usd: c });
function fakeLlm(p = 0.6) {
  const llm = { calls: 0, async forecast() { llm.calls++; return { probability: p, thesis: 't', invalidation: 'i', bull: 'b', bear: 'c', judgeOutput: {}, modelIds: ['m'], promptVersion: 'v1', spends: [spend(0.05)] }; } };
  return llm;
}

test('budget stop: $0.01 budget makes no model calls', async () => {
  const llm = fakeLlm(); const db = fakeDb();
  const stats = await runForecast({ cfg: { ...CFG, dailyBudgetUsd: 0.01 }, pm: fakePm([MKT('a')]), llm, db, log });
  assert.equal(llm.calls, 0);
  assert.equal(stats.stoppedBy, 'budget');
  assert.equal(db.rows.length, 0);
});

test('budget stop mid-run once spend reaches the limit', async () => {
  const llm = fakeLlm(); const db = fakeDb({ spent: 9.8 });
  const stats = await runForecast({ cfg: CFG, pm: fakePm([MKT('a'), MKT('b'), MKT('c')]), llm, db, log });
  assert.equal(llm.calls, 1); // 9.80 + 0.15 ≤ 10 → one; 9.85 + 0.15 > 10 → stop
  assert.equal(stats.stoppedBy, 'budget');
});

test('a failed model call writes no ledger row but records the spend', async () => {
  const db = fakeDb(); const errors = [];
  const llm = { async forecast() { throw Object.assign(new Error('judge pass refused'), { spends: [spend(0.02)] }); } };
  const stats = await runForecast({ cfg: CFG, pm: fakePm([MKT('a')]), llm, db, log: { info() {}, error: (m) => errors.push(m) } });
  assert.equal(db.rows.length, 0);
  assert.equal(db.spends.length, 1);
  assert.equal(stats.failures, 1);
  assert.match(errors[0], /judge pass refused/);
});

test('every forecast is logged; only ≥ threshold rows are calls', async () => {
  const db = fakeDb();
  // p 0.6 vs ask 0.51 → +9¢ (call); p 0.52 vs 0.51 → +1¢ (logged, not a call)
  let n = 0; const llm = { async forecast() { const p = n++ === 0 ? 0.6 : 0.52; return { ...(await fakeLlm(p).forecast()), probability: p }; } };
  await runForecast({ cfg: CFG, pm: fakePm([MKT('a'), MKT('b')]), llm, db, log });
  assert.equal(db.rows.length, 2);
  assert.deepEqual(db.rows.map((r) => r.row.is_call), [true, false]);
  assert.ok(db.rows.every((r) => r.row.prompt_version === 'v1' && r.row.status === 'open'));
});

test('no order book: no ledger row', async () => {
  const db = fakeDb();
  const stats = await runForecast({ cfg: CFG, pm: fakePm([MKT('a')], null), llm: fakeLlm(), db, log });
  assert.equal(db.rows.length, 0);
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

test('three failures in a row stop the run', async () => {
  const db = fakeDb(); let calls = 0;
  const llm = { async forecast() { calls++; throw Object.assign(new Error('credit balance is too low'), { spends: [] }); } };
  const stats = await runForecast({ cfg: CFG, pm: fakePm(['a', 'b', 'c', 'd', 'e'].map(MKT)), llm, db, log });
  assert.equal(calls, 3);
  assert.equal(stats.stoppedBy, 'consecutive_failures');
});
