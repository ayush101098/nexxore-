/**
 * Signal Tracker Module
 * 
 * Tracks all alpha signals and manages their lifecycle:
 * - Records new signals to database
 * - Tracks price movements
 * - Updates signal performance metrics
 * - Manages signal expiration
 */

const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

class SignalTracker {
  constructor(config = {}) {
    this.supabase = createClient(
      config.supabaseUrl || process.env.SUPABASE_URL,
      config.supabaseKey || process.env.SUPABASE_ANON_KEY
    );
    
    this.config = {
      defaultExpiryHours: 72,  // Signals expire after 72 hours
      priceCheckIntervalMs: 60000,  // Check prices every minute
      ...config
    };
    
    this.priceCheckInterval = null;
  }

  /**
   * Generate unique signal ID
   */
  generateSignalId(signal) {
    const data = `${signal.protocol}-${signal.chain}-${signal.signal_type}-${Date.now()}`;
    return crypto.createHash('sha256').update(data).digest('hex').slice(0, 16);
  }

  /**
   * Record a new alpha signal
   */
  async recordSignal(signal) {
    const signalId = this.generateSignalId(signal);
    
    const signalRecord = {
      signal_id: signalId,
      protocol: signal.protocol,
      chain: signal.chain || 'ethereum',
      token_symbol: signal.tokenSymbol,
      token_address: signal.tokenAddress,
      signal_type: signal.type || 'momentum',
      action: signal.action || 'BUY',
      alpha_score: signal.alphaScore || 0,
      confidence: signal.confidence || 50,
      risk_level: this.calculateRiskLevel(signal),
      entry_price: signal.entryPrice,
      target_price: signal.targetPrice,
      stop_loss_price: signal.stopLoss,
      expected_return_pct: signal.expectedReturn,
      expected_apy: signal.apy,
      time_horizon_hours: signal.timeHorizonHours || 24,
      tvl_at_signal: signal.tvl,
      volume_24h: signal.volume24h,
      sentiment_score: signal.sentimentScore,
      reasoning: signal.reasoning || signal.summary,
      news_context: signal.newsContext,
      raw_data: signal,
      generated_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + (this.config.defaultExpiryHours * 60 * 60 * 1000)).toISOString(),
      status: 'ACTIVE'
    };

    const { data, error } = await this.supabase
      .from('alpha_signals')
      .insert(signalRecord)
      .select()
      .single();

    if (error) {
      console.error('Failed to record signal:', error);
      throw error;
    }

    // Initialize performance tracking
    await this.initializePerformance(signalId, signal.entryPrice);

    console.log(`📊 Signal recorded: ${signalId} - ${signal.protocol} (Score: ${signal.alphaScore})`);
    return data;
  }

  /**
   * Initialize performance tracking for a signal
   */
  async initializePerformance(signalId, entryPrice) {
    const { error } = await this.supabase
      .from('signal_performance')
      .insert({
        signal_id: signalId,
        outcome: 'PENDING',
        price_at_signal: entryPrice,
        first_check: new Date().toISOString()
      });

    if (error && error.code !== '23505') { // Ignore duplicate key errors
      console.error('Failed to initialize performance:', error);
    }
  }

  /**
   * Calculate risk level based on signal parameters
   */
  calculateRiskLevel(signal) {
    const alphaScore = signal.alphaScore || 0;
    const confidence = signal.confidence || 50;
    
    // Higher alpha + lower confidence = higher risk
    const riskScore = (100 - alphaScore) * 0.4 + (100 - confidence) * 0.6;
    
    if (riskScore < 25) return 'LOW';
    if (riskScore < 50) return 'MEDIUM';
    if (riskScore < 75) return 'HIGH';
    return 'EXTREME';
  }

  /**
   * Get all active signals
   */
  async getActiveSignals() {
    const { data, error } = await this.supabase
      .from('alpha_signals')
      .select('*')
      .eq('status', 'ACTIVE')
      .order('alpha_score', { ascending: false });

    if (error) throw error;
    return data || [];
  }

  /**
   * Get signals by protocol
   */
  async getSignalsByProtocol(protocol) {
    const { data, error } = await this.supabase
      .from('alpha_signals')
      .select('*')
      .eq('protocol', protocol)
      .order('generated_at', { ascending: false })
      .limit(50);

    if (error) throw error;
    return data || [];
  }

  /**
   * Get signals by type
   */
  async getSignalsByType(signalType) {
    const { data, error } = await this.supabase
      .from('alpha_signals')
      .select('*')
      .eq('signal_type', signalType)
      .order('generated_at', { ascending: false })
      .limit(50);

    if (error) throw error;
    return data || [];
  }

  /**
   * Update signal status
   */
  async updateSignalStatus(signalId, status) {
    const { error } = await this.supabase
      .from('alpha_signals')
      .update({ status })
      .eq('signal_id', signalId);

    if (error) throw error;
  }

  /**
   * Update signal performance with new price
   */
  async updatePerformance(signalId, currentPrice, timeframe = '1h') {
    const signal = await this.getSignal(signalId);
    if (!signal) return;

    const entryPrice = parseFloat(signal.entry_price);
    const returnPct = ((currentPrice - entryPrice) / entryPrice) * 100;

    const updates = {
      last_check: new Date().toISOString()
    };

    // Update appropriate timeframe
    switch (timeframe) {
      case '1h':
        updates.price_1h = currentPrice;
        updates.return_1h = returnPct;
        break;
      case '4h':
        updates.price_4h = currentPrice;
        updates.return_4h = returnPct;
        break;
      case '24h':
        updates.price_24h = currentPrice;
        updates.return_24h = returnPct;
        break;
      case '7d':
        updates.price_7d = currentPrice;
        updates.return_7d = returnPct;
        break;
    }

    // Check if target or stop loss hit
    if (signal.target_price && currentPrice >= parseFloat(signal.target_price)) {
      updates.hit_target = true;
      updates.outcome = 'WIN';
      await this.updateSignalStatus(signalId, 'EXECUTED');
    } else if (signal.stop_loss_price && currentPrice <= parseFloat(signal.stop_loss_price)) {
      updates.hit_stop_loss = true;
      updates.outcome = 'LOSS';
      await this.updateSignalStatus(signalId, 'EXECUTED');
    }

    // Track max return and max drawdown
    const { data: existing } = await this.supabase
      .from('signal_performance')
      .select('max_return, max_drawdown')
      .eq('signal_id', signalId)
      .single();

    if (existing) {
      if (!existing.max_return || returnPct > existing.max_return) {
        updates.max_return = returnPct;
      }
      if (!existing.max_drawdown || returnPct < existing.max_drawdown) {
        updates.max_drawdown = returnPct;
      }
    }

    const { error } = await this.supabase
      .from('signal_performance')
      .update(updates)
      .eq('signal_id', signalId);

    if (error) {
      console.error('Failed to update performance:', error);
    }
  }

  /**
   * Get a single signal
   */
  async getSignal(signalId) {
    const { data, error } = await this.supabase
      .from('alpha_signals')
      .select('*')
      .eq('signal_id', signalId)
      .single();

    if (error) return null;
    return data;
  }

  /**
   * Expire old signals
   */
  async expireOldSignals() {
    const { error } = await this.supabase
      .from('alpha_signals')
      .update({ status: 'EXPIRED' })
      .eq('status', 'ACTIVE')
      .lt('expires_at', new Date().toISOString());

    if (error) {
      console.error('Failed to expire signals:', error);
    }
  }

  /**
   * Get signal statistics
   */
  async getSignalStats() {
    const { data: signals } = await this.supabase
      .from('alpha_signals')
      .select('status, signal_type, alpha_score');

    if (!signals) return null;

    const stats = {
      total: signals.length,
      active: signals.filter(s => s.status === 'ACTIVE').length,
      executed: signals.filter(s => s.status === 'EXECUTED').length,
      expired: signals.filter(s => s.status === 'EXPIRED').length,
      byType: {},
      avgAlphaScore: 0
    };

    // Count by type
    signals.forEach(s => {
      stats.byType[s.signal_type] = (stats.byType[s.signal_type] || 0) + 1;
    });

    // Average alpha score
    stats.avgAlphaScore = signals.reduce((sum, s) => sum + (s.alpha_score || 0), 0) / signals.length;

    return stats;
  }

  /**
   * Get performance summary
   */
  async getPerformanceSummary() {
    const { data: performance } = await this.supabase
      .from('signal_performance')
      .select('outcome, return_24h, max_return, max_drawdown, hit_target, hit_stop_loss');

    if (!performance || performance.length === 0) {
      return {
        totalSignals: 0,
        wins: 0,
        losses: 0,
        pending: 0,
        winRate: 0,
        avgReturn: 0,
        bestTrade: 0,
        worstTrade: 0
      };
    }

    const completed = performance.filter(p => p.outcome !== 'PENDING');
    const wins = completed.filter(p => p.outcome === 'WIN').length;
    const losses = completed.filter(p => p.outcome === 'LOSS').length;

    return {
      totalSignals: performance.length,
      wins,
      losses,
      pending: performance.filter(p => p.outcome === 'PENDING').length,
      winRate: completed.length > 0 ? (wins / completed.length * 100).toFixed(1) : 0,
      avgReturn: (performance.reduce((sum, p) => sum + (p.return_24h || 0), 0) / performance.length).toFixed(2),
      bestTrade: Math.max(...performance.map(p => p.max_return || 0)).toFixed(2),
      worstTrade: Math.min(...performance.map(p => p.max_drawdown || 0)).toFixed(2),
      hitTargetRate: (performance.filter(p => p.hit_target).length / performance.length * 100).toFixed(1),
      hitStopRate: (performance.filter(p => p.hit_stop_loss).length / performance.length * 100).toFixed(1)
    };
  }

  /**
   * Get recent signals with performance
   */
  async getRecentSignalsWithPerformance(limit = 20) {
    const { data, error } = await this.supabase
      .from('alpha_signals')
      .select(`
        *,
        signal_performance (*)
      `)
      .order('generated_at', { ascending: false })
      .limit(limit);

    if (error) throw error;
    return data || [];
  }
}

module.exports = { SignalTracker };
