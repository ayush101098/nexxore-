const DEFAULT_WEIGHTS = {
  technical: 0.30,
  funding: 0.25,
  social: 0.25,
  oi: 0.20
};

class HypothesisEngine {
  constructor(config = {}) {
    this.weights = { ...DEFAULT_WEIGHTS, ...(config.weights || {}) };
  }

  scoreSignals(signals = {}) {
    const tech = signals.technical ?? 0.5;
    const funding = signals.funding ?? 0.5;
    const social = signals.social ?? 0.5;
    const oi = signals.oi ?? 0.5;

    const composite = (
      tech * this.weights.technical +
      funding * this.weights.funding +
      social * this.weights.social +
      oi * this.weights.oi
    );

    return { composite, breakdown: { tech, funding, social, oi } };
  }

  biasFromScore(score) {
    if (score > 0.6) return 'LONG';
    if (score < 0.4) return 'SHORT';
    return 'NEUTRAL';
  }

  determineStrategy({ fundingSkew = 0, momentum = 0, basis = 0, rsi = 50 } = {}) {
    if (Math.abs(basis) > 1) return 'Arbitrage';
    if (momentum > 0.6) return 'Momentum';
    if (rsi < 30 || rsi > 70) return 'Mean Reversion';
    if (Math.abs(fundingSkew) > 1) return 'Narrative Breakout';
    return 'Momentum';
  }

  determineHorizon({ atr = 0, socialMomentum = 0 }) {
    if (atr > 5 || socialMomentum > 0.7) return '1-2 days';
    if (atr > 2) return '3-5 days';
    return '7-14 days';
  }

  confidence({ composite = 0.5, alignment = 0.5, backtestWinRate = 0.5 }) {
    return Math.max(0, Math.min(1, (composite * 0.6) + (alignment * 0.2) + (backtestWinRate * 0.2)));
  }

  build({ asset, signals, indicators }) {
    const { composite } = this.scoreSignals(signals);
    const bias = this.biasFromScore(composite);
    const strategy = this.determineStrategy(indicators);
    const timeHorizon = this.determineHorizon(indicators);

    const alignment = (
      (signals.technical > 0.5 ? 1 : 0) +
      (signals.funding > 0.5 ? 1 : 0) +
      (signals.social > 0.5 ? 1 : 0) +
      (signals.oi > 0.5 ? 1 : 0)
    ) / 4;

    const confidence = this.confidence({ composite, alignment, backtestWinRate: 0.55 });

    return {
      asset,
      bias,
      strategy,
      timeHorizon,
      compositeScore: composite,
      confidence
    };
  }
}

module.exports = { HypothesisEngine };
