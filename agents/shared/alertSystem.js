/**
 * Web3 Alert System
 * 
 * Real-time alerts for:
 * - Alpha opportunities (>70 score)
 * - Whale transactions
 * - Protocol events
 * - Sentiment spikes
 * - New token launches
 */

const { AgentLogger } = require('../shared/utils');

class AlertSystem {
  constructor(config = {}) {
    this.name = 'AlertSystem';
    this.logger = new AgentLogger(this.name);
    this.config = {
      minAlphaScore: 70,
      minSentimentChange: 0.5,
      checkIntervalMs: 300000, // 5 min
      ...config
    };
    
    this.handlers = new Map();
    this.alertQueue = [];
    this.isRunning = false;
  }
  
  /**
   * Register alert handler (Telegram, Email, Webhook, etc)
   */
  registerHandler(type, handler) {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, []);
    }
    this.handlers.get(type).push(handler);
    this.logger.debug(`Registered handler: ${type}`);
  }
  
  /**
   * Create alpha opportunity alert
   */
  async createAlphaAlert(signal) {
    if (signal.alphaScore < this.config.minAlphaScore) return;
    
    const alert = {
      id: `alpha_${Date.now()}`,
      type: 'alpha_opportunity',
      severity: this.scoreSeverity(signal.alphaScore),
      protocol: signal.protocol,
      score: signal.alphaScore,
      category: signal.category,
      title: `🎯 ALPHA: ${signal.protocol} - Score ${signal.alphaScore}/100`,
      message: this.formatAlphaMessage(signal),
      action: this.getRecommendedAction(signal),
      timestamp: new Date().toISOString(),
      metadata: signal
    };
    
    return await this.dispatch(alert);
  }
  
  /**
   * Create sentiment spike alert
   */
  async createSentimentAlert(token, change) {
    if (Math.abs(change) < this.config.minSentimentChange) return;
    
    const severity = Math.abs(change) > 1.0 ? 'critical' : 'high';
    
    const alert = {
      id: `sentiment_${Date.now()}`,
      type: 'sentiment_spike',
      severity,
      token,
      change,
      direction: change > 0 ? 'bullish' : 'bearish',
      title: `📊 SENTIMENT: ${token} ${change > 0 ? '📈' : '📉'}`,
      message: `${token} sentiment shift: ${Math.abs(change).toFixed(2)} ${change > 0 ? 'bullish' : 'bearish'}`,
      action: change > 0 ? 'monitor_for_entry' : 'reduce_exposure',
      timestamp: new Date().toISOString()
    };
    
    return await this.dispatch(alert);
  }
  
  /**
   * Create whale transaction alert
   */
  async createWhaleAlert(txData) {
    const alert = {
      id: `whale_${Date.now()}`,
      type: 'whale_transaction',
      severity: 'high',
      token: txData.token,
      amount: txData.amount,
      amountUSD: txData.amountUSD,
      txType: txData.type, // 'buy' or 'sell'
      wallet: txData.wallet,
      title: `🐋 WHALE: ${txData.type.toUpperCase()} ${(txData.amountUSD / 1000000).toFixed(1)}M ${txData.token}`,
      message: `Whale wallet made ${txData.type === 'buy' ? 'buying' : 'selling'} activity`,
      action: 'monitor',
      timestamp: new Date().toISOString(),
      metadata: txData
    };
    
    return await this.dispatch(alert);
  }
  
  /**
   * Create new token launch alert
   */
  async createLaunchAlert(token) {
    const alert = {
      id: `launch_${Date.now()}`,
      type: 'new_token_launch',
      severity: 'medium',
      token: token.symbol,
      name: token.name,
      chain: token.chain,
      title: `🚀 LAUNCH: ${token.symbol} - ${token.name}`,
      message: `New token launched on ${token.chain}`,
      action: 'research',
      timestamp: new Date().toISOString(),
      url: token.url,
      metadata: token
    };
    
    return await this.dispatch(alert);
  }
  
  /**
   * Create protocol event alert
   */
  async createEventAlert(event) {
    const alert = {
      id: `event_${Date.now()}`,
      type: 'protocol_event',
      severity: event.critical ? 'critical' : 'medium',
      protocol: event.protocol,
      eventType: event.type,
      title: `⚡ EVENT: ${event.protocol} - ${event.type}`,
      message: event.description,
      action: event.action || 'monitor',
      timestamp: new Date().toISOString(),
      metadata: event
    };
    
    return await this.dispatch(alert);
  }
  
  /**
   * Dispatch alert to all registered handlers
   */
  async dispatch(alert) {
    this.logger.debug(`Dispatching alert: ${alert.type}`, { severity: alert.severity });
    
    try {
      const results = [];
      
      for (const [handlerType, handlers] of this.handlers) {
        for (const handler of handlers) {
          try {
            const result = await handler(alert);
            results.push({ handler: handlerType, status: 'sent', result });
          } catch (err) {
            this.logger.warn(`Handler ${handlerType} failed`, { error: err.message });
            results.push({ handler: handlerType, status: 'failed', error: err.message });
          }
        }
      }
      
      return {
        alertId: alert.id,
        dispatched: results.length,
        results
      };
    } catch (err) {
      this.logger.error('Alert dispatch failed', { error: err.message });
      throw err;
    }
  }
  
  /**
   * Score severity (critical, high, medium, low)
   */
  scoreSeverity(alphaScore) {
    if (alphaScore >= 85) return 'critical';
    if (alphaScore >= 75) return 'high';
    if (alphaScore >= 60) return 'medium';
    return 'low';
  }
  
  /**
   * Format alpha message for alert
   */
  formatAlphaMessage(signal) {
    const lines = [
      `Protocol: ${signal.protocol}`,
      `Alpha Score: ${signal.alphaScore}/100`,
      `Category: ${signal.category}`,
      `APY: ${(signal.metrics.apy || 0).toFixed(2)}%`,
      `Sentiment: ${(signal.metrics.sentiment * 100).toFixed(0)}% positive`
    ];
    
    return lines.join('\n');
  }
  
  /**
   * Get recommended action
   */
  getRecommendedAction(signal) {
    if (signal.alphaScore >= 85) return 'immediate_research';
    if (signal.category === 'yield_farming') return 'research_yield_terms';
    if (signal.category === 'emerging_protocol') return 'monitor_growth';
    return 'track_developments';
  }
  
  /**
   * Start alert monitoring loop
   */
  async start() {
    if (this.isRunning) {
      this.logger.warn('Alert system already running');
      return;
    }
    
    this.isRunning = true;
    this.logger.info('Alert system started');
    
    return this;
  }
  
  /**
   * Stop alert monitoring
   */
  stop() {
    this.isRunning = false;
    this.logger.info('Alert system stopped');
  }
  
  /**
   * Get alert statistics
   */
  getStats() {
    return {
      handlersRegistered: Array.from(this.handlers.keys()),
      alertsQueued: this.alertQueue.length,
      isRunning: this.isRunning,
      registeredTypes: Array.from(this.handlers.keys())
    };
  }
}

module.exports = AlertSystem;
