/**
 * Prompt 22: Quality gate & calibration checks
 */

class QualityGate {
  constructor(config = {}) {
    this.config = {
      minConfidence: config.minConfidence || 0.6,
      minSignals: config.minSignals || 3,
      maxRiskFlags: config.maxRiskFlags || 2,
      ...config
    };
  }

  evaluate({ hypothesis, signals = {}, risks = [] } = {}) {
    const confidence = hypothesis?.confidence ?? hypothesis?.confidenceScore ?? 0;
    const signalCount = Object.values(signals).filter(v => typeof v === 'number' && v > 0).length;
    const riskFlags = risks.length + (hypothesis?.invalidations?.length || 0);

    const passed =
      confidence >= this.config.minConfidence &&
      signalCount >= this.config.minSignals &&
      riskFlags <= this.config.maxRiskFlags;

    return {
      passed,
      confidence,
      signalCount,
      riskFlags,
      reasons: [
        confidence < this.config.minConfidence ? 'confidence_below_threshold' : null,
        signalCount < this.config.minSignals ? 'insufficient_signal_coverage' : null,
        riskFlags > this.config.maxRiskFlags ? 'excess_risk_flags' : null
      ].filter(Boolean)
    };
  }
}

module.exports = { QualityGate };
