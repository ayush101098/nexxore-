// Calibration model: P(YES) from the market's own price and time to close,
// fitted on resolved Polymarket markets. No LLM.
//
//   p = sigmoid(w0 + w1·logit(m) + w2·logit(m)·ln(1 + days))
//
// w1 < 1 means prices are too extreme (longshots overpriced, favourites
// underpriced); w2 lets that correction change with the time remaining.

const EPS = 0.005;

function clampP(p) { return Math.min(1 - EPS, Math.max(EPS, p)); }
function logit(p) { p = clampP(p); return Math.log(p / (1 - p)); }
function sigmoid(z) { return 1 / (1 + Math.exp(-z)); }

function features(price, days) {
  const l = logit(price);
  return [1, l, l * Math.log1p(Math.max(0, days))];
}

function predict(model, price, days) {
  const x = features(price, days);
  return sigmoid(x.reduce((s, v, i) => s + v * model.weights[i], 0));
}

/** Logistic regression by Newton's method (IRLS) with a small ridge penalty.
 *  Starts from "the market is right" (w = [0, 1, 0]). */
function fit(rows, { ridge = 1e-3, iterations = 50 } = {}) {
  const k = 3;
  let w = [0, 1, 0];
  for (let it = 0; it < iterations; it++) {
    const g = new Array(k).fill(0);
    const H = Array.from({ length: k }, () => new Array(k).fill(0));
    for (const r of rows) {
      const x = features(r.price, r.days);
      const p = sigmoid(x.reduce((s, v, i) => s + v * w[i], 0));
      const wt = p * (1 - p);
      for (let i = 0; i < k; i++) {
        g[i] += (p - r.y) * x[i];
        for (let j = 0; j < k; j++) H[i][j] += wt * x[i] * x[j];
      }
    }
    for (let i = 0; i < k; i++) { g[i] += ridge * (w[i] - (i === 1 ? 1 : 0)); H[i][i] += ridge; }
    const step = solve(H, g);
    w = w.map((v, i) => v - step[i]);
    if (Math.max(...step.map(Math.abs)) < 1e-9) break;
  }
  return w;
}

/** Solve A·x = b by Gaussian elimination (3×3). */
function solve(A, b) {
  const n = b.length, M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let j = c; j <= n; j++) M[r][j] -= f * M[c][j];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

function brier(rows, prob) {
  return rows.reduce((s, r) => s + Math.pow(prob(r) - r.y, 2), 0) / rows.length;
}

/** One-line explanation for the ledger's thesis and invalidation fields. */
function explain(model, price, days, p) {
  const d = days < 1 ? 'under a day' : `${Math.round(days)} day${Math.round(days) === 1 ? '' : 's'}`;
  return {
    thesis: `Priced at ${Math.round(price * 100)}¢ with ${d} left, comparable Polymarket markets resolved YES ${(p * 100).toFixed(1)}% of the time (calibration fitted on ${model.trainMarkets} resolved markets).`.slice(0, 280),
    invalidation: 'Re-forecast if the price moves 5¢ or more; void if the market is cancelled.'
  };
}

module.exports = { logit, sigmoid, features, predict, fit, brier, explain };
