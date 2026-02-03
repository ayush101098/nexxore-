'use strict';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const sum = (arr) => arr.reduce((acc, v) => acc + v, 0);

const normalize = (weights) => {
  const total = sum(weights);
  if (total === 0) return weights.map(() => 0);
  return weights.map((w) => w / total);
};

const dot = (a, b) => a.reduce((acc, v, i) => acc + v * b[i], 0);

const matVec = (m, v) => m.map((row) => dot(row, v));

const computeCovariance = (returnsMatrix) => {
  const n = returnsMatrix.length;
  const t = returnsMatrix[0]?.length || 0;
  if (n === 0 || t === 0) return [];

  const means = returnsMatrix.map((series) => sum(series) / t);
  const cov = Array.from({ length: n }, () => Array(n).fill(0));

  for (let i = 0; i < n; i += 1) {
    for (let j = i; j < n; j += 1) {
      let c = 0;
      for (let k = 0; k < t; k += 1) {
        c += (returnsMatrix[i][k] - means[i]) * (returnsMatrix[j][k] - means[j]);
      }
      c = c / Math.max(1, t - 1);
      cov[i][j] = c;
      cov[j][i] = c;
    }
  }

  return cov;
};

const projectWeights = ({
  weights,
  assets,
  maxWeight,
  stablecoinBuffer,
  volCaps,
}) => {
  const n = weights.length;
  const caps = assets.map((asset, i) => {
    const baseCap = asset.maxWeight ?? maxWeight ?? 1;
    const volCap = Number.isFinite(volCaps[i]) ? volCaps[i] : baseCap;
    return Math.min(baseCap, volCap);
  });

  let projected = weights.map((w, i) => clamp(w, 0, caps[i]));

  const stableIndices = assets
    .map((asset, i) => (asset.isStablecoin ? i : -1))
    .filter((i) => i >= 0);

  const nonStableIndices = assets
    .map((asset, i) => (!asset.isStablecoin ? i : -1))
    .filter((i) => i >= 0);

  const buffer = typeof stablecoinBuffer === 'number'
    ? { min: stablecoinBuffer, max: 1 }
    : {
        min: stablecoinBuffer?.min ?? 0.2,
        max: stablecoinBuffer?.max ?? 0.4,
      };

  const stableWeight = sum(stableIndices.map((i) => projected[i]));
  if (stableWeight < buffer.min && stableIndices.length > 0) {
    const deficit = buffer.min - stableWeight;
    const add = deficit / stableIndices.length;
    stableIndices.forEach((i) => {
      projected[i] = clamp(projected[i] + add, 0, caps[i]);
    });
  }

  if (stableWeight > buffer.max) {
    const excess = stableWeight - buffer.max;
    const remove = excess / Math.max(1, stableIndices.length);
    stableIndices.forEach((i) => {
      projected[i] = clamp(projected[i] - remove, 0, caps[i]);
    });
  }

  const total = sum(projected);
  if (total === 0) return projected;
  projected = projected.map((w) => w / total);

  const nonStableTotal = sum(nonStableIndices.map((i) => projected[i]));
  const stableTotal = sum(stableIndices.map((i) => projected[i]));
  if (stableTotal < buffer.min && nonStableTotal > 0) {
    const needed = buffer.min - stableTotal;
    const scale = Math.max(0, 1 - needed / nonStableTotal);
    nonStableIndices.forEach((i) => {
      projected[i] *= scale;
    });
    const per = needed / Math.max(1, stableIndices.length);
    stableIndices.forEach((i) => {
      projected[i] = clamp(projected[i] + per, 0, caps[i]);
    });
  }

  return normalize(projected);
};

const buildInitialWeights = (assets, mu, stablecoinBuffer) => {
  const stableIndices = assets
    .map((asset, i) => (asset.isStablecoin ? i : -1))
    .filter((i) => i >= 0);
  const nonStableIndices = assets
    .map((asset, i) => (!asset.isStablecoin ? i : -1))
    .filter((i) => i >= 0);

  const buffer = typeof stablecoinBuffer === 'number'
    ? { min: stablecoinBuffer, max: 1 }
    : {
        min: stablecoinBuffer?.min ?? 0.2,
        max: stablecoinBuffer?.max ?? 0.4,
      };

  const stableTarget = clamp(buffer.min, 0, 1);
  const weights = Array(assets.length).fill(0);

  if (stableIndices.length > 0) {
    const per = stableTarget / stableIndices.length;
    stableIndices.forEach((i) => {
      weights[i] = per;
    });
  }

  const remaining = 1 - stableTarget;
  if (nonStableIndices.length > 0) {
    const scores = nonStableIndices.map((i) => Math.max(0, mu[i]));
    const scoreSum = sum(scores);
    nonStableIndices.forEach((i, idx) => {
      weights[i] = scoreSum > 0 ? (scores[idx] / scoreSum) * remaining : remaining / nonStableIndices.length;
    });
  }

  return normalize(weights);
};

const computeRiskMetrics = (weights, mu, cov) => {
  const expectedReturn = dot(mu, weights);
  const variance = dot(weights, matVec(cov, weights));
  const expectedVol = Math.sqrt(Math.max(variance, 0));
  return { expected_return: expectedReturn, expected_vol: expectedVol };
};

const buildVolCaps = (cov, perAssetVolCap) => {
  if (!cov.length) return [];
  const vols = cov.map((row, i) => Math.sqrt(Math.max(row[i], 0)) || 0);
  if (!perAssetVolCap) return vols.map(() => Infinity);
  return vols.map((vol) => (vol > 0 ? perAssetVolCap / vol : Infinity));
};

const optimizePortfolio = ({
  timestamp,
  assets,
  returnsHistory,
  covariance,
  riskAversion = 2.5,
  maxWeight = 0.35,
  stablecoinBuffer = { min: 0.2, max: 0.4 },
  perAssetVolCap = 0.25,
  iterations = 20,
  step = 0.08,
}) => {
  if (!assets?.length) {
    return { timestamp, weights: {}, risk_metrics: { expected_vol: 0, expected_return: 0 } };
  }

  const mu = assets.map((asset) => (asset.confidence ?? 0) * (asset.momentum ?? 0));
  const cov = covariance?.length ? covariance : computeCovariance(returnsHistory || []);
  const volCaps = buildVolCaps(cov, perAssetVolCap);

  let weights = buildInitialWeights(assets, mu, stablecoinBuffer);
  weights = projectWeights({ weights, assets, maxWeight, stablecoinBuffer, volCaps });

  for (let i = 0; i < iterations; i += 1) {
    const grad = matVec(cov, weights).map((v, idx) => mu[idx] - 2 * riskAversion * v);
    const next = weights.map((w, idx) => w + step * grad[idx]);
    weights = projectWeights({ weights: next, assets, maxWeight, stablecoinBuffer, volCaps });
  }

  const metrics = computeRiskMetrics(weights, mu, cov);
  const weightMap = {};
  assets.forEach((asset, i) => {
    weightMap[asset.symbol] = Number(weights[i].toFixed(4));
  });

  return {
    timestamp,
    weights: weightMap,
    risk_metrics: {
      expected_vol: Number(metrics.expected_vol.toFixed(4)),
      expected_return: Number(metrics.expected_return.toFixed(4)),
    },
  };
};

module.exports = {
  optimizePortfolio,
  computeCovariance,
};
