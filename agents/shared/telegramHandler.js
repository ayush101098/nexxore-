/**
 * Telegram Bot Handler for Web3 Intelligence
 * 
 * Usage:
 *   1. Create Telegram bot with @BotFather
 *   2. Set TELEGRAM_BOT_TOKEN env var
 *   3. Get chat ID from /start command
 *   4. Register handler with alertSystem
 */

const { AgentLogger } = require('./utils');

class TelegramHandler {
  constructor(botToken, chatId) {
    this.name = 'TelegramHandler';
    this.logger = new AgentLogger(this.name);
    this.botToken = botToken;
    this.chatId = chatId;
    this.apiUrl = `https://api.telegram.org/bot${botToken}`;
    
    if (!botToken || !chatId) {
      this.logger.warn('Telegram handler initialized without token/chatId - will be disabled');
    }
  }
  
  /**
   * Send alert via Telegram
   */
  async handle(alert) {
    if (!this.botToken || !this.chatId) {
      this.logger.warn('Telegram handler not configured');
      return { status: 'skipped', reason: 'not_configured' };
    }
    
    try {
      const message = this.formatMessage(alert);
      
      const response = await fetch(`${this.apiUrl}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: this.chatId,
          text: message,
          parse_mode: 'Markdown',
          disable_web_page_preview: true
        })
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.description || 'Failed to send message');
      }
      
      const result = await response.json();
      this.logger.debug('Telegram message sent', { messageId: result.result.message_id });
      
      return {
        status: 'sent',
        messageId: result.result.message_id,
        timestamp: new Date().toISOString()
      };
    } catch (err) {
      this.logger.error('Failed to send Telegram message', { error: err.message });
      throw err;
    }
  }
  
  /**
   * Format alert as Telegram message
   */
  formatMessage(alert) {
    const severity = {
      critical: '🔴 CRITICAL',
      high: '🟠 HIGH',
      medium: '🟡 MEDIUM',
      low: '🟢 LOW'
    };
    
    const lines = [
      `*${severity[alert.severity] || alert.severity}*`,
      `*${alert.title}*`,
      '',
      alert.message
    ];
    
    if (alert.action) {
      lines.push('');
      lines.push(`_Recommended: ${alert.action}_`);
    }
    
    if (alert.url) {
      lines.push(`[View Details](${alert.url})`);
    }
    
    lines.push('');
    lines.push(`_${new Date(alert.timestamp).toLocaleTimeString()}_`);
    
    return lines.join('\n');
  }
  
  /**
   * Send test message
   */
  async sendTest() {
    const testAlert = {
      severity: 'high',
      title: '✅ Telegram Handler Connected',
      message: 'Your Web3 alerts are now active!',
      action: null,
      timestamp: new Date().toISOString()
    };
    
    return this.handle(testAlert);
  }
  
  /**
   * Get handler metadata
   */
  getMetadata() {
    return {
      name: this.name,
      type: 'telegram',
      configured: !!(this.botToken && this.chatId),
      supportedAlertTypes: [
        'alpha_opportunity',
        'sentiment_spike',
        'whale_transaction',
        'new_token_launch',
        'protocol_event'
      ]
    };
  }
}

// Factory function
async function createTelegramHandler(botToken, chatId) {
  const handler = new TelegramHandler(botToken, chatId);
  
  if (botToken && chatId) {
    try {
      await handler.sendTest();
      console.log('✅ Telegram handler connected');
    } catch (err) {
      console.warn('⚠️ Telegram handler test failed:', err.message);
    }
  }
  
  return handler;
}

module.exports = { TelegramHandler, createTelegramHandler };
