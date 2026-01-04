/**
 * Performance Analytics Module
 * 
 * Calculate and track trading performance metrics:
 * - Win rate, profit factor, Sharpe ratio
 * - Strategy and protocol performance
 * - Daily summaries and trends
 */

const { createClient } = require('@supabase/supabase-js');

class PerformanceAnalytics {
  constructor(config = {}) {
    this.supabase = createClient(
      config.supabaseUrl || process.env.SUPABASE_URL,
      config.supabaseKey || process.env.SUPABASE_ANON_KEY
    );
  }

  /**
   * Calculate comprehensive portfolio metrics
   */
  async calculatePortfolioMetrics() {
    const { data: positions } = await this.supabase
      .from('mock_positions')
      .select('*')
      .eq('status', 'CLOSED');

    if (!positions || positions.length === 0) {
      return this.getEmptyMetrics();
    }

    const wins = positions.filter(p => parseFloat(p.realized_pnl) > 0);
    const losses = positions.filter(p => parseFloat(p.realized_pnl) < 0);

    // Basic metrics
    const totalPnl = positions.reduce((sum, p) => sum + parseFloat(p.realized_pnl || 0), 0);
    const winRate = (wins.length / positions.length) * 100;
    
    // Average metrics
    const avgWin = wins.length > 0 
      ? wins.reduce((sum, p) => sum + parseFloat(p.realized_pnl), 0) / wins.length 
      : 0;
    const avgLoss = losses.length > 0 
      ? Math.abs(losses.reduce((sum, p) => sum + parseFloat(p.realized_pnl), 0) / losses.length)
      : 0;

    // Profit factor
    const grossProfit = wins.reduce((sum, p) => sum + parseFloat(p.realized_pnl), 0);
    const grossLoss = Math.abs(losses.reduce((sum, p) => sum + parseFloat(p.realized_pnl), 0));
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

    // Holding times
    const holdingTimes = positions.map(p => {
      const entry = new Date(p.entry_timestamp);
      const exit = new Date(p.exit_timestamp);
      return (exit - entry) / (1000 * 60 * 60); // hours
    });
    const avgHoldingTime = holdingTimes.reduce((a, b) => a + b, 0) / holdingTimes.length;

    // Max drawdown and consecutive losses
    let maxDrawdown = 0;
    let currentDrawdown = 0;
    let maxConsecutiveLosses = 0;
    let currentConsecutiveLosses = 0;
    let runningPnl = 0;
    let peak = 0;

    positions.forEach(p => {
      runningPnl += parseFloat(p.realized_pnl);
      if (runningPnl > peak) peak = runningPnl;
      currentDrawdown = peak - runningPnl;
      if (currentDrawdown > maxDrawdown) maxDrawdown = currentDrawdown;

      if (parseFloat(p.realized_pnl) < 0) {
        currentConsecutiveLosses++;
        if (currentConsecutiveLosses > maxConsecutiveLosses) {
          maxConsecutiveLosses = currentConsecutiveLosses;
        }
      } else {
        currentConsecutiveLosses = 0;
      }
    });

    // Sharpe ratio (simplified - assumes risk-free rate = 0)
    const returns = positions.map(p => parseFloat(p.realized_pnl_pct));
    const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;
    const stdDev = Math.sqrt(variance);
    const sharpeRatio = stdDev > 0 ? avgReturn / stdDev : 0;

    // Expectancy
    const expectancy = (winRate / 100 * avgWin) - ((100 - winRate) / 100 * avgLoss);

    return {
      totalTrades: positions.length,
      winningTrades: wins.length,
      losingTrades: losses.length,
      winRate: winRate.toFixed(1),
      totalPnl: totalPnl.toFixed(2),
      avgWin: avgWin.toFixed(2),
      avgLoss: avgLoss.toFixed(2),
      profitFactor: profitFactor.toFixed(2),
      avgHoldingTimeHours: avgHoldingTime.toFixed(1),
      maxDrawdown: maxDrawdown.toFixed(2),
      maxConsecutiveLosses,
      sharpeRatio: sharpeRatio.toFixed(2),
      expectancy: expectancy.toFixed(2),
      bestTrade: Math.max(...positions.map(p => parseFloat(p.realized_pnl))).toFixed(2),
      worstTrade: Math.min(...positions.map(p => parseFloat(p.realized_pnl))).toFixed(2)
    };
  }

  /**
   * Get empty metrics template
   */
  getEmptyMetrics() {
    return {
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      winRate: '0.0',
      totalPnl: '0.00',
      avgWin: '0.00',
      avgLoss: '0.00',
      profitFactor: '0.00',
      avgHoldingTimeHours: '0.0',
      maxDrawdown: '0.00',
      maxConsecutiveLosses: 0,
      sharpeRatio: '0.00',
      expectancy: '0.00',
      bestTrade: '0.00',
      worstTrade: '0.00'
    };
  }

  /**
   * Calculate performance by strategy type
   */
  async getStrategyPerformance() {
    const { data: positions } = await this.supabase
      .from('mock_positions')
      .select(`
        *,
        alpha_signals!inner (signal_type)
      `)
      .eq('status', 'CLOSED');

    if (!positions || positions.length === 0) return {};

    const byStrategy = {};
    
    positions.forEach(p => {
      const type = p.alpha_signals?.signal_type || 'unknown';
      if (!byStrategy[type]) {
        byStrategy[type] = {
          trades: 0,
          wins: 0,
          losses: 0,
          totalPnl: 0,
          positions: []
        };
      }
      byStrategy[type].trades++;
      byStrategy[type].totalPnl += parseFloat(p.realized_pnl || 0);
      byStrategy[type].positions.push(p);
      
      if (parseFloat(p.realized_pnl) > 0) {
        byStrategy[type].wins++;
      } else if (parseFloat(p.realized_pnl) < 0) {
        byStrategy[type].losses++;
      }
    });

    // Calculate metrics for each strategy
    Object.keys(byStrategy).forEach(type => {
      const s = byStrategy[type];
      s.winRate = s.trades > 0 ? ((s.wins / s.trades) * 100).toFixed(1) : '0.0';
      s.avgPnl = s.trades > 0 ? (s.totalPnl / s.trades).toFixed(2) : '0.00';
      s.totalPnl = s.totalPnl.toFixed(2);
      delete s.positions; // Clean up
    });

    // Update database
    for (const [type, stats] of Object.entries(byStrategy)) {
      await this.supabase
        .from('strategy_performance')
        .upsert({
          strategy_type: type,
          total_signals: stats.trades,
          total_positions: stats.trades,
          winning_positions: stats.wins,
          losing_positions: stats.losses,
          total_pnl: parseFloat(stats.totalPnl),
          win_rate: parseFloat(stats.winRate),
          last_updated: new Date().toISOString()
        }, {
          onConflict: 'strategy_type'
        });
    }

    return byStrategy;
  }

  /**
   * Calculate performance by protocol
   */
  async getProtocolPerformance() {
    const { data: positions } = await this.supabase
      .from('mock_positions')
      .select('*')
      .eq('status', 'CLOSED');

    if (!positions || positions.length === 0) return {};

    const byProtocol = {};
    
    positions.forEach(p => {
      const key = `${p.protocol}_${p.chain}`;
      if (!byProtocol[key]) {
        byProtocol[key] = {
          protocol: p.protocol,
          chain: p.chain,
          trades: 0,
          wins: 0,
          losses: 0,
          totalPnl: 0
        };
      }
      byProtocol[key].trades++;
      byProtocol[key].totalPnl += parseFloat(p.realized_pnl || 0);
      
      if (parseFloat(p.realized_pnl) > 0) {
        byProtocol[key].wins++;
      } else if (parseFloat(p.realized_pnl) < 0) {
        byProtocol[key].losses++;
      }
    });

    // Calculate win rates
    Object.keys(byProtocol).forEach(key => {
      const p = byProtocol[key];
      p.winRate = p.trades > 0 ? ((p.wins / p.trades) * 100).toFixed(1) : '0.0';
      p.avgPnl = p.trades > 0 ? (p.totalPnl / p.trades).toFixed(2) : '0.00';
      p.totalPnl = p.totalPnl.toFixed(2);
    });

    // Update database
    for (const stats of Object.values(byProtocol)) {
      await this.supabase
        .from('protocol_performance')
        .upsert({
          protocol: stats.protocol,
          chain: stats.chain,
          total_signals: stats.trades,
          total_positions: stats.trades,
          winning_positions: stats.wins,
          losing_positions: stats.losses,
          total_pnl: parseFloat(stats.totalPnl),
          win_rate: parseFloat(stats.winRate),
          last_updated: new Date().toISOString()
        }, {
          onConflict: 'protocol,chain'
        });
    }

    return Object.values(byProtocol).sort((a, b) => parseFloat(b.totalPnl) - parseFloat(a.totalPnl));
  }

  /**
   * Generate daily performance summary
   */
  async generateDailySummary(date = new Date()) {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    // Get signals generated today
    const { data: signals } = await this.supabase
      .from('alpha_signals')
      .select('signal_type')
      .gte('generated_at', startOfDay.toISOString())
      .lte('generated_at', endOfDay.toISOString());

    // Get positions opened today
    const { data: opened } = await this.supabase
      .from('mock_positions')
      .select('*')
      .gte('entry_timestamp', startOfDay.toISOString())
      .lte('entry_timestamp', endOfDay.toISOString());

    // Get positions closed today
    const { data: closed } = await this.supabase
      .from('mock_positions')
      .select('*')
      .eq('status', 'CLOSED')
      .gte('exit_timestamp', startOfDay.toISOString())
      .lte('exit_timestamp', endOfDay.toISOString());

    const closedPositions = closed || [];
    const wins = closedPositions.filter(p => parseFloat(p.realized_pnl) > 0);
    const losses = closedPositions.filter(p => parseFloat(p.realized_pnl) < 0);
    const totalPnl = closedPositions.reduce((sum, p) => sum + parseFloat(p.realized_pnl || 0), 0);

    // Signal type counts
    const signalTypes = (signals || []).reduce((acc, s) => {
      acc[s.signal_type] = (acc[s.signal_type] || 0) + 1;
      return acc;
    }, {});

    const summary = {
      date: startOfDay.toISOString().split('T')[0],
      signals_generated: signals?.length || 0,
      signals_executed: opened?.length || 0,
      positions_opened: opened?.length || 0,
      positions_closed: closedPositions.length,
      total_pnl: totalPnl,
      winning_trades: wins.length,
      losing_trades: losses.length,
      win_rate: closedPositions.length > 0 ? ((wins.length / closedPositions.length) * 100) : null,
      best_trade_pnl: closedPositions.length > 0 ? Math.max(...closedPositions.map(p => parseFloat(p.realized_pnl))) : null,
      worst_trade_pnl: closedPositions.length > 0 ? Math.min(...closedPositions.map(p => parseFloat(p.realized_pnl))) : null,
      yield_signals_count: signalTypes.yield || 0,
      momentum_signals_count: signalTypes.momentum || 0,
      arbitrage_signals_count: signalTypes.arbitrage || 0
    };

    // Upsert to database
    await this.supabase
      .from('daily_performance')
      .upsert(summary, { onConflict: 'date' });

    return summary;
  }

  /**
   * Get performance history (daily summaries)
   */
  async getPerformanceHistory(days = 30) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const { data, error } = await this.supabase
      .from('daily_performance')
      .select('*')
      .gte('date', startDate.toISOString().split('T')[0])
      .order('date', { ascending: false });

    if (error) throw error;
    return data || [];
  }

  /**
   * Get signal quality metrics
   */
  async getSignalQualityMetrics() {
    const { data: signals } = await this.supabase
      .from('alpha_signals')
      .select(`
        *,
        signal_performance (*)
      `);

    if (!signals || signals.length === 0) {
      return {
        totalSignals: 0,
        avgAlphaScore: 0,
        avgConfidence: 0,
        hitTargetRate: 0,
        hitStopRate: 0,
        avgTimeToTarget: 0
      };
    }

    const withPerf = signals.filter(s => s.signal_performance);
    const hitTarget = withPerf.filter(s => s.signal_performance?.hit_target);
    const hitStop = withPerf.filter(s => s.signal_performance?.hit_stop_loss);

    return {
      totalSignals: signals.length,
      avgAlphaScore: (signals.reduce((sum, s) => sum + (s.alpha_score || 0), 0) / signals.length).toFixed(1),
      avgConfidence: (signals.reduce((sum, s) => sum + (s.confidence || 0), 0) / signals.length).toFixed(1),
      hitTargetRate: withPerf.length > 0 ? ((hitTarget.length / withPerf.length) * 100).toFixed(1) : '0.0',
      hitStopRate: withPerf.length > 0 ? ((hitStop.length / withPerf.length) * 100).toFixed(1) : '0.0',
      byRiskLevel: this.groupByField(signals, 'risk_level'),
      byType: this.groupByField(signals, 'signal_type')
    };
  }

  /**
   * Helper to group signals by field
   */
  groupByField(signals, field) {
    return signals.reduce((acc, s) => {
      const key = s[field] || 'unknown';
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
  }

  /**
   * Get complete performance report
   */
  async getFullReport() {
    const [
      portfolio,
      strategy,
      protocol,
      signalQuality,
      history
    ] = await Promise.all([
      this.calculatePortfolioMetrics(),
      this.getStrategyPerformance(),
      this.getProtocolPerformance(),
      this.getSignalQualityMetrics(),
      this.getPerformanceHistory(7)
    ]);

    return {
      generatedAt: new Date().toISOString(),
      portfolio,
      byStrategy: strategy,
      byProtocol: protocol,
      signalQuality,
      recentHistory: history
    };
  }
}

module.exports = { PerformanceAnalytics };
