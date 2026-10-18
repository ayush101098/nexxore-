// Forecaster backed by the fitted calibration model (no LLM).
const fs = require('fs');
const path = require('path');
const C = require('./calibration');

function loadModel(file) {
  const m = JSON.parse(fs.readFileSync(file || path.join(__dirname, '..', 'model', 'calibration.json'), 'utf8'));
  if (!Array.isArray(m.weights) || m.weights.length !== 3 || m.weights.some((w) => !Number.isFinite(w))) {
    throw new Error('calibration model has invalid weights');
  }
  return m;
}

function makeCalibratedForecaster(model) {
  /** Probability for a market from its snapshot midpoint and time to end. */
  function forecast(market, snap, now = Date.now()) {
    const days = Math.max(0, (Date.parse(market.endDate) - now) / 86400e3);
    const p = Math.min(0.99, Math.max(0.01, C.predict(model, snap.mid, days)));
    const { thesis, invalidation } = C.explain(model, snap.mid, days, p);
    return {
      probability: p,
      thesis,
      invalidation,
      reasoning: { model: model.version, form: model.form, weights: model.weights, inputs: { mid: snap.mid, days: Number(days.toFixed(3)) } },
      modelIds: [model.version],
      promptVersion: model.version
    };
  }
  return { forecast };
}

module.exports = { loadModel, makeCalibratedForecaster };
