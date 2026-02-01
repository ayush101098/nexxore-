/**
 * Prompt 19: Experimental Signals Lab
 * Sandbox for new signal ideas before productionizing.
 */

class ExperimentalSignalsLab {
  constructor(config = {}) {
    this.config = {
      maxSignals: config.maxSignals || 20,
      ...config
    };
    this.registry = new Map();
  }

  registerSignal(name, fn, meta = {}) {
    if (!name || typeof fn !== 'function') return false;
    if (this.registry.size >= this.config.maxSignals) return false;

    this.registry.set(name, { fn, meta });
    return true;
  }

  unregisterSignal(name) {
    return this.registry.delete(name);
  }

  evaluate(context = {}) {
    const results = [];

    for (const [name, { fn, meta }] of this.registry.entries()) {
      try {
        const output = fn(context) || {};
        const score = typeof output.score === 'number' ? output.score : 0.5;
        results.push({
          name,
          score: Math.max(0, Math.min(1, score)),
          confidence: output.confidence ?? 0.5,
          signal: output.signal || 'neutral',
          notes: output.notes || '',
          meta
        });
      } catch (error) {
        results.push({ name, score: 0, confidence: 0, signal: 'error', notes: error.message, meta });
      }
    }

    results.sort((a, b) => b.score - a.score);

    const composite = results.length
      ? results.reduce((sum, r) => sum + r.score, 0) / results.length
      : 0.5;

    return {
      composite,
      results
    };
  }
}

module.exports = { ExperimentalSignalsLab };
