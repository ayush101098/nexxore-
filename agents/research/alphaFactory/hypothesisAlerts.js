/**
 * Prompt 16: Alerting & monitoring for hypotheses
 */

class HypothesisAlertingEngine {
  constructor(config = {}) {
    this.config = {
      minConfidence: config.minConfidence || 0.7,
      invalidationSeverity: config.invalidationSeverity || 'high',
      maxAlertsPerRun: config.maxAlertsPerRun || 10,
      ...config
    };
  }

  evaluate(hypotheses = [], context = {}) {
    const alerts = [];

    for (const hypothesis of hypotheses) {
      if (!hypothesis) continue;

      const confidence = hypothesis.confidence ?? hypothesis.confidenceScore ?? 0;
      const bias = hypothesis.bias || hypothesis.direction || 'NEUTRAL';
      const invalidations = hypothesis.invalidations || [];
      const riskFlags = hypothesis.riskFlags || [];

      if (confidence >= this.config.minConfidence) {
        alerts.push({
          type: 'hypothesis_signal',
          severity: confidence >= 0.85 ? 'critical' : 'high',
          title: `🧠 Hypothesis ${hypothesis.asset || hypothesis.market || ''} ${bias}`.trim(),
          message: hypothesis.summary || hypothesis.strategy || 'High-confidence hypothesis detected.',
          action: 'review_hypothesis',
          metadata: {
            hypothesis,
            context
          }
        });
      }

      if (riskFlags.length > 0 || invalidations.length > 0) {
        alerts.push({
          type: 'hypothesis_invalidation',
          severity: this.config.invalidationSeverity,
          title: `⚠️ Invalidation Risk: ${hypothesis.asset || hypothesis.market || hypothesis.id || ''}`.trim(),
          message: invalidations[0] || 'Invalidation conditions present.',
          action: 'monitor_invalidation',
          metadata: {
            hypothesis,
            riskFlags,
            context
          }
        });
      }

      if (alerts.length >= this.config.maxAlertsPerRun) break;
    }

    return alerts;
  }
}

module.exports = { HypothesisAlertingEngine };
