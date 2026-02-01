/**
 * Prompt 23: Metrics & reporting layer
 */

class MetricsReporter {
  constructor(config = {}) {
    this.config = {
      maxSamples: config.maxSamples || 500,
      ...config
    };
    this.samples = [];
  }

  record(sample = {}) {
    const entry = {
      timestamp: new Date().toISOString(),
      ...sample
    };
    this.samples.unshift(entry);
    if (this.samples.length > this.config.maxSamples) {
      this.samples.pop();
    }
    return entry;
  }

  summary({ limit = 100 } = {}) {
    const data = this.samples.slice(0, limit);
    if (data.length === 0) {
      return { count: 0 };
    }

    const avg = (key) => {
      const vals = data.map(d => d[key]).filter(v => typeof v === 'number');
      if (!vals.length) return 0;
      return vals.reduce((a, b) => a + b, 0) / vals.length;
    };

    return {
      count: data.length,
      avgConfidence: avg('confidence'),
      avgSignalStrength: avg('signalStrength'),
      avgQualityPassRate: avg('qualityPassRate')
    };
  }
}

module.exports = { MetricsReporter };
