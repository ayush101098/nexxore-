'use strict';

const { optimizePortfolio } = require('./portfolioOptimizer');

const assets = [
  { symbol: 'SOL', confidence: 0.8, momentum: 0.9, isStablecoin: false },
  { symbol: 'ETH', confidence: 0.7, momentum: 0.6, isStablecoin: false },
  { symbol: 'BTC', confidence: 0.6, momentum: 0.5, isStablecoin: false },
  { symbol: 'USDC', confidence: 0.2, momentum: 0.1, isStablecoin: true },
];

const returnsHistory = [
  [0.02, -0.01, 0.015, 0.005, 0.01],
  [0.01, -0.005, 0.012, 0.004, 0.008],
  [0.008, -0.006, 0.01, 0.003, 0.006],
  [0.0002, 0.0001, 0.0001, 0.0001, 0.0001],
];

const result = optimizePortfolio({
  timestamp: '2026-01-27',
  assets,
  returnsHistory,
  riskAversion: 2.5,
  maxWeight: 0.35,
  stablecoinBuffer: { min: 0.2, max: 0.4 },
  perAssetVolCap: 0.25,
});

console.log(JSON.stringify(result, null, 2));
