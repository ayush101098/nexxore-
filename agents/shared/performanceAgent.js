'use strict';

const sum = (arr) => arr.reduce((acc, v) => acc + v, 0);
const avg = (arr) => (arr.length ? sum(arr) / arr.length : 0);
const stdev = (arr) => {
  if (arr.length === 0) return 0;
  const mean = avg(arr);
  const variance = avg(arr.map((v) => (v - mean) ** 2));
  return Math.sqrt(variance);
};

const maxDrawdown = (returns) => {
  let peak = 1;
  let equity = 1;
  let maxDd = 0;
  returns.forEach((r) => {
    equity *= (1 + r);
    if (equity > peak) peak = equity;
    const dd = (peak - equity) / peak;
    if (dd > maxDd) maxDd = dd;
  });
  return maxDd;
};

const profitFactor = (returns) => {
  const gains = returns.filter((r) => r > 0).map((r) => r);
  const losses = returns.filter((r) => r < 0).map((r) => Math.abs(r));
  const grossProfit = sum(gains);
  const grossLoss = sum(losses);
  if (grossLoss === 0) return grossProfit > 0 ? Infinity : 0;
  return grossProfit / grossLoss;
};

const winRate = (returns) => {
  if (!returns.length) return 0;
  const wins = returns.filter((r) => r > 0).length;
  return wins / returns.length;
};

const volatilityAdjustedPnl = (returns) => {
  const pnl = sum(returns);
  const vol = stdev(returns);
  return vol > 0 ? pnl / vol : 0;
};

const computeAlpha = (strategyReturns, benchmarkReturns) => {
  if (!strategyReturns.length || !benchmarkReturns.length) return 0;
  const len = Math.min(strategyReturns.length, benchmarkReturns.length);
  const strat = strategyReturns.slice(0, len);
  const bench = benchmarkReturns.slice(0, len);
  const diff = strat.map((r, i) => r - bench[i]);
  return avg(diff);
};

const signalDecay = (signals) => {
  if (!signals?.length) return 0;
  const now = Date.now();
  const ages = signals.map((s) => (now - new Date(s.timestamp).getTime()) / (1000 * 60 * 60));
  const halfLife = 24;
  const decayScores = ages.map((h) => Math.exp(-Math.log(2) * (h / halfLife)));
  return avg(decayScores);
};

class PerformanceAgent {
  constructor(config = {}) {
    this.config = {
      sharpeThreshold: 1.0,
      riskFreeRate: 0,
      ...config,
    };
  }

  computeStrategyMetrics(strategy, benchmarkReturns = []) {
    const returns = strategy.returns || [];
    const meanReturn = avg(returns);
    const vol = stdev(returns);
    const sharpe = vol > 0 ? (meanReturn - this.config.riskFreeRate) / vol : 0;

    return {
      name: strategy.name,
      sharpe: Number(sharpe.toFixed(2)),
      max_drawdown: Number(maxDrawdown(returns).toFixed(3)),
      win_rate: Number((winRate(returns) * 100).toFixed(1)),
      profit_factor: Number(profitFactor(returns).toFixed(2)),
      vol_adjusted_pnl: Number(volatilityAdjustedPnl(returns).toFixed(3)),
      alpha_vs_btc: Number(computeAlpha(returns, benchmarkReturns).toFixed(4)),
      signal_decay: Number(signalDecay(strategy.signals || []).toFixed(3)),
    };
  }

  evaluateStrategies(strategies, benchmarkReturns = []) {
    return strategies.map((strategy) => this.computeStrategyMetrics(strategy, benchmarkReturns));
  }

  scoreHypotheses(hypotheses = []) {
    return hypotheses.map((h) => ({
      id: h.id,
      name: h.name,
      accuracy: Number((h.correct / Math.max(1, h.total)) * 100).toFixed(1),
      score: Number((h.weight * (h.correct / Math.max(1, h.total))).toFixed(3)),
    }));
  }

  generateFeedback(performance) {
    const lowSharpe = performance.filter((p) => p.sharpe < this.config.sharpeThreshold);
    const highSharpe = performance.filter((p) => p.sharpe >= this.config.sharpeThreshold);

    return {
      action: 'Increase confidence threshold for low-Sharpe strategies',
      capital_shift: `Allocate less to strategies with Sharpe < ${this.config.sharpeThreshold.toFixed(1)}`,
      increase_allocation: highSharpe.map((p) => p.name),
      reduce_allocation: lowSharpe.map((p) => p.name),
    };
  }
}

module.exports = {
  PerformanceAgent,
};
