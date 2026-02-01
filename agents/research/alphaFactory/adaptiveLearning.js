class AdaptiveLearningEngine {
  constructor(config = {}) {
    this.weights = { technical: 0.3, funding: 0.25, social: 0.25, oi: 0.2, ...(config.weights || {}) };
    this.performanceHistory = [];
    this.degradationThreshold = config.degradationThreshold ?? 0.15;
  }

  updateWeights({ outcome, signals }) {
    const lr = 0.05;
    Object.keys(this.weights).forEach(k => {
      const signal = signals[k] ?? 0.5;
      const target = outcome > 0 ? 1 : 0;
      this.weights[k] = Math.max(0.05, Math.min(0.5, this.weights[k] + lr * (target - signal)));
    });
  }

  recordPerformance({ winRate, sharpe }) {
    this.performanceHistory.push({ winRate, sharpe, ts: Date.now() });
  }

  detectDrift() {
    if (this.performanceHistory.length < 5) return false;
    const recent = this.performanceHistory.slice(-5);
    const avgWin = recent.reduce((s, r) => s + r.winRate, 0) / recent.length;
    const baseline = this.performanceHistory[0]?.winRate || avgWin;
    return baseline - avgWin > this.degradationThreshold;
  }

  getWeights() {
    return this.weights;
  }
}

module.exports = { AdaptiveLearningEngine };
