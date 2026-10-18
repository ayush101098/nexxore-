// Calibration model: fitting, prediction and the shipped model file.
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../src/calibration');
const { loadModel, makeCalibratedForecaster } = require('../src/model');

test('weights [0, 1, 0] reproduce the market price', () => {
  const m = { weights: [0, 1, 0] };
  for (const p of [0.03, 0.4, 0.97]) assert.ok(Math.abs(C.predict(m, p, 10) - p) < 1e-9);
});

test('fit recovers known weights from synthetic data', () => {
  let seed = 7; const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const truth = { weights: [-0.2, 0.8, 0.1] };
  const rows = [];
  for (let i = 0; i < 20000; i++) {
    const price = 0.02 + 0.96 * rand(), days = 90 * rand();
    rows.push({ price, days, y: rand() < C.predict(truth, price, days) ? 1 : 0 });
  }
  const w = C.fit(rows);
  truth.weights.forEach((t, i) => assert.ok(Math.abs(w[i] - t) < 0.06, `w${i} ${w[i]} vs ${t}`));
});

test('the shipped model loads and gives probabilities in range', () => {
  const model = loadModel();
  const f = makeCalibratedForecaster(model);
  const now = Date.parse('2026-10-18T00:00:00Z');
  const out = f.forecast({ endDate: '2026-10-25T00:00:00Z' }, { mid: 0.05 }, now);
  assert.ok(out.probability >= 0.01 && out.probability <= 0.99);
  assert.match(out.thesis, /resolved YES/);
  assert.ok(out.thesis.length <= 280 && out.invalidation.length <= 140);
  assert.equal(out.promptVersion, model.version);
});

test('a model file with bad weights is rejected', () => {
  const fs = require('fs'), path = require('path'), os = require('os');
  const f = path.join(os.tmpdir(), `cal-${process.pid}.json`);
  fs.writeFileSync(f, JSON.stringify({ weights: [0, 'x', 0] }));
  assert.throws(() => loadModel(f), /invalid weights/);
});
