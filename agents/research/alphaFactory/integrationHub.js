/**
 * Prompt 17: Integration Hub
 * Routes refined research outputs to external systems (webhooks, files, custom handlers).
 */

const fs = require('fs');
const path = require('path');

class IntegrationHub {
  constructor(config = {}) {
    this.config = {
      fileExportDir: config.fileExportDir || null,
      maxMemory: config.maxMemory || 50,
      webhooks: Array.isArray(config.webhooks) ? config.webhooks : [],
      ...config
    };

    this.handlers = new Map();
    this.memoryLog = [];
  }

  registerHandler(type, handler) {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, []);
    }
    this.handlers.get(type).push(handler);
  }

  addWebhookTarget(url, headers = {}) {
    this.config.webhooks.push({ url, headers });
  }

  async dispatch(payload, meta = {}) {
    const results = [];

    if (this.config.fileExportDir) {
      const fileResult = await this._exportToFile(payload);
      results.push(fileResult);
    }

    if (this.config.webhooks.length > 0) {
      const webhookResults = await this._dispatchWebhooks(payload, meta);
      results.push(...webhookResults);
    }

    for (const [type, handlers] of this.handlers) {
      for (const handler of handlers) {
        try {
          const result = await handler(payload, meta);
          results.push({ handler: type, status: 'sent', result });
        } catch (error) {
          results.push({ handler: type, status: 'failed', error: error.message });
        }
      }
    }

    this.memoryLog.unshift({
      payload,
      meta,
      timestamp: new Date().toISOString()
    });
    if (this.memoryLog.length > this.config.maxMemory) {
      this.memoryLog.pop();
    }

    return results;
  }

  getRecentDispatches() {
    return this.memoryLog;
  }

  async _exportToFile(payload) {
    try {
      const dir = this.config.fileExportDir;
      if (!dir) return { handler: 'file', status: 'skipped' };

      const filePath = path.join(dir, `research-output-${new Date().toISOString().split('T')[0]}.jsonl`);
      const line = JSON.stringify({
        payload,
        timestamp: new Date().toISOString()
      }) + '\n';

      fs.mkdirSync(dir, { recursive: true });
      fs.appendFileSync(filePath, line, 'utf8');
      return { handler: 'file', status: 'sent', filePath };
    } catch (error) {
      return { handler: 'file', status: 'failed', error: error.message };
    }
  }

  async _dispatchWebhooks(payload, meta) {
    const results = [];
    if (typeof fetch !== 'function') {
      return this.config.webhooks.map(target => ({
        handler: 'webhook',
        status: 'failed',
        error: 'fetch unavailable',
        target: target.url
      }));
    }

    for (const target of this.config.webhooks) {
      try {
        const res = await fetch(target.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(target.headers || {})
          },
          body: JSON.stringify({ payload, meta })
        });
        results.push({ handler: 'webhook', status: res.ok ? 'sent' : 'failed', target: target.url, statusCode: res.status });
      } catch (error) {
        results.push({ handler: 'webhook', status: 'failed', target: target.url, error: error.message });
      }
    }

    return results;
  }
}

module.exports = { IntegrationHub };
