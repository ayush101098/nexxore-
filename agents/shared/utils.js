/**
 * Shared utilities for Nexxore agents
 */

const crypto = require('crypto');

/**
 * Generate unique agent message ID
 */
function generateInsightId() {
  return `insight_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

/**
 * Normalize protocol name
 */
function normalizeProtocol(name) {
  return (name || '').toUpperCase().trim();
}

/**
 * Calculate confidence score (0-1)
 */
function calculateConfidence(signals) {
  if (!signals || signals.length === 0) return 0;
  
  const weighted = signals.reduce((sum, sig) => {
    const weight = sig.weight || 1 / signals.length;
    const value = (sig.score || sig.value || 0);
    const normalized = typeof value === 'number' ? Math.min(Math.max(value, 0), 1) : 0;
    return sum + (normalized * weight);
  }, 0);
  
  return Math.round(weighted * 100) / 100;
}

/**
 * Categorize sentiment (-1 to +1 → "bearish", "neutral", "bullish")
 */
function categorizeSentiment(score) {
  if (score > 0.3) return 'bullish';
  if (score < -0.3) return 'bearish';
  return 'neutral';
}

/**
 * Merge insights from multiple sources with dedup
 */
function mergeInsights(insightArrays = []) {
  const seen = new Set();
  const merged = [];
  
  insightArrays.flat().forEach(insight => {
    const key = `${insight.protocol}_${insight.type}`;
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(insight);
    }
  });
  
  return merged.sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
}

/**
 * Format insight for display
 */
function formatInsight(insight) {
  return {
    id: insight.id || generateInsightId(),
    type: insight.type || 'research',
    protocol: normalizeProtocol(insight.protocol),
    confidence: insight.confidence || 0,
    summary: insight.summary || '',
    signals: insight.signals || [],
    tags: insight.tags || [],
    timestamp: insight.timestamp || new Date().toISOString(),
    source: insight.source || 'unknown'
  };
}

/**
 * Retry async function with exponential backoff
 */
async function retryAsync(fn, maxRetries = 3, delayMs = 1000) {
  let lastError;
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (i < maxRetries - 1) {
        const wait = delayMs * Math.pow(2, i);
        await new Promise(r => setTimeout(r, wait));
      }
    }
  }
  
  throw lastError;
}

/**
 * Fetch with timeout
 */
async function fetchWithTimeout(url, options = {}, timeoutMs = 10000) {
  // Ensure fetch is available (Node.js 18+)
  if (typeof fetch === 'undefined') {
    throw new Error('fetch is not available. Please use Node.js 18+ or install node-fetch');
  }
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Parse timestamp safely
 */
function parseTimestamp(value) {
  if (!value) return new Date();
  
  const date = new Date(value);
  return isNaN(date.getTime()) ? new Date() : date;
}

/**
 * Logger with context
 */
class AgentLogger {
  constructor(agentName) {
    this.agentName = agentName;
    this.debugEnabled = process.env.DEBUG?.includes('nexxore');
  }
  
  log(level, message, data = {}) {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level,
      agent: this.agentName,
      message,
      ...data
    };
    
    if (level === 'error' || level === 'warn' || this.debugEnabled) {
      console.log(JSON.stringify(logEntry));
    }
  }
  
  info(message, data) { this.log('info', message, data); }
  warn(message, data) { this.log('warn', message, data); }
  error(message, data) { this.log('error', message, data); }
  debug(message, data) { if (this.debugEnabled) this.log('debug', message, data); }
}

module.exports = {
  generateInsightId,
  normalizeProtocol,
  calculateConfidence,
  categorizeSentiment,
  mergeInsights,
  formatInsight,
  retryAsync,
  fetchWithTimeout,
  parseTimestamp,
  AgentLogger
};
