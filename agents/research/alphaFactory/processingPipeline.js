const EventEmitter = require('events');

class ProcessingPipeline extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = {
      bufferRetentionMs: 24 * 60 * 60 * 1000,
      ...config
    };
    this.rawBuffer = [];
    this.metrics = {
      lastBatchAt: null,
      batchCount: 0,
      errorCount: 0,
      avgLatencyMs: 0
    };
  }

  ingest(event) {
    const payload = { ...event, receivedAt: Date.now() };
    this.rawBuffer.push(payload);
    this._trimBuffer();
    this.emit('ingested', payload);
  }

  _trimBuffer() {
    const cutoff = Date.now() - this.config.bufferRetentionMs;
    this.rawBuffer = this.rawBuffer.filter(e => e.receivedAt >= cutoff);
  }

  async processBatch(batchFn) {
    const start = Date.now();
    try {
      const result = await batchFn(this.rawBuffer);
      const latency = Date.now() - start;
      this.metrics.lastBatchAt = Date.now();
      this.metrics.batchCount += 1;
      this.metrics.avgLatencyMs = this.metrics.avgLatencyMs
        ? (this.metrics.avgLatencyMs * 0.8 + latency * 0.2)
        : latency;
      this.emit('processed', result);
      return result;
    } catch (err) {
      this.metrics.errorCount += 1;
      this.emit('error', err);
      throw err;
    }
  }
}

module.exports = { ProcessingPipeline };
