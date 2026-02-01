/**
 * Prompt 21: Audit trail & explainability ledger
 */

class AuditTrail {
  constructor(config = {}) {
    this.config = {
      maxEntries: config.maxEntries || 500,
      ...config
    };
    this.entries = [];
  }

  record(type, payload = {}, meta = {}) {
    const entry = {
      id: `audit_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      type,
      payload,
      meta,
      timestamp: new Date().toISOString()
    };
    this.entries.unshift(entry);
    if (this.entries.length > this.config.maxEntries) {
      this.entries.pop();
    }
    return entry;
  }

  list({ type, limit = 50 } = {}) {
    const filtered = type ? this.entries.filter(e => e.type === type) : this.entries;
    return filtered.slice(0, limit);
  }
}

module.exports = { AuditTrail };
