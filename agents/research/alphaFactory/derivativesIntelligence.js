class DerivativesIntelligence {
  constructor(config = {}) {
    this.neutralRate = config.neutralRate ?? 0.0005; // 0.05% default
  }

  calculateFundingSkew(fundingRates = []) {
    if (fundingRates.length === 0) return 0;
    const avg = fundingRates.reduce((s, r) => s + r, 0) / fundingRates.length;
    const variance = fundingRates.reduce((s, r) => s + Math.pow(r - avg, 2), 0) / fundingRates.length;
    const std = Math.sqrt(variance || 1);
    return (avg - this.neutralRate) / std;
  }

  detectFundingExtremes(rate) {
    if (rate > 0.003) return 'OVERLEVERAGED_LONG';
    if (rate < -0.001) return 'SHORT_SQUEEZE_SETUP';
    return 'NORMAL';
  }

  analyzeOpenInterest(oiNow, oiPrev) {
    if (!oiPrev || oiPrev <= 0) return { changePct: 0, signal: 'NEUTRAL' };
    const changePct = ((oiNow - oiPrev) / oiPrev) * 100;
    return { changePct, signal: changePct > 5 ? 'EXPANSION' : changePct < -5 ? 'CONTRACTION' : 'STABLE' };
  }

  detectOISignal(oiChangePct, priceChangePct) {
    if (oiChangePct > 5 && priceChangePct > 0) return 'TREND_CONFIRMATION';
    if (oiChangePct > 5 && priceChangePct < 0) return 'CAPITULATION';
    if (oiChangePct < -5) return 'UNWINDING';
    return 'NEUTRAL';
  }

  basis(perp, spot) {
    if (!spot || spot === 0) return 0;
    return ((perp - spot) / spot) * 100;
  }

  fundingDivergence(ratesByExchange = {}) {
    const entries = Object.entries(ratesByExchange).filter(([, v]) => typeof v === 'number');
    if (entries.length < 2) return { divergence: 0, signal: 'NORMAL' };
    const values = entries.map(([, v]) => v);
    const max = Math.max(...values);
    const min = Math.min(...values);
    const divergence = max - min;
    return { divergence, signal: divergence > 0.001 ? 'IMBALANCE' : 'NORMAL' };
  }

  analyze({ fundingRates = {}, openInterest = {}, prices = {} } = {}) {
    const fundingList = Object.values(fundingRates).filter(v => typeof v === 'number');
    const fundingSkew = this.calculateFundingSkew(fundingList);
    const fundingExtremes = this.detectFundingExtremes(fundingList[0] || 0);

    const oi = openInterest.current || 0;
    const oiPrev = openInterest.previous || 0;
    const oiMetrics = this.analyzeOpenInterest(oi, oiPrev);
    const priceChangePct = prices.changePct || 0;
    const oiSignal = this.detectOISignal(oiMetrics.changePct, priceChangePct);

    const basisPct = this.basis(prices.perp, prices.spot);
    const divergence = this.fundingDivergence(fundingRates);

    return {
      fundingSkew,
      fundingExtremes,
      oiChangePct: oiMetrics.changePct,
      oiSignal,
      basisPct,
      fundingDivergence: divergence.divergence,
      divergenceSignal: divergence.signal
    };
  }
}

module.exports = { DerivativesIntelligence };
