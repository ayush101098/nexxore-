// Risk Manager - Position sizing, exposure control, and risk management
import config from '../config.js';
import db from '../data/database.js';

class RiskManager {
  constructor() {
    this.portfolio = this.loadPortfolio();
    this.maxRiskPerTrade = config.risk.maxRiskPerTrade;
    this.maxExposure = config.risk.maxExposure;
    this.maxDrawdown = config.risk.maxDrawdown;
    this.maxPositions = config.risk.maxPositions;
  }

  // Load portfolio state from database
  loadPortfolio() {
    try {
      const row = db.prepare('SELECT * FROM portfolio ORDER BY updated_at DESC LIMIT 1').get();
      if (row) {
        return {
          totalCapital: row.total_capital,
          availableCapital: row.available_capital,
          allocatedCapital: row.allocated_capital,
          unrealizedPnl: row.unrealized_pnl,
          realizedPnl: row.realized_pnl,
          currentDrawdown: row.current_drawdown,
          peakEquity: row.peak_equity,
          totalTrades: row.total_trades,
          winningTrades: row.winning_trades,
          losingTrades: row.losing_trades
        };
      }
      // Default portfolio
      return {
        totalCapital: 10000,
        availableCapital: 10000,
        allocatedCapital: 0,
        unrealizedPnl: 0,
        realizedPnl: 0,
        currentDrawdown: 0,
        peakEquity: 10000,
        totalTrades: 0,
        winningTrades: 0,
        losingTrades: 0
      };
    } catch (error) {
      console.error('Error loading portfolio:', error.message);
      return null;
    }
  }

  // Get current open positions
  getOpenPositions() {
    try {
      return db.prepare(`
        SELECT * FROM positions WHERE status = 'OPEN'
      `).all();
    } catch (error) {
      console.error('Error getting positions:', error.message);
      return [];
    }
  }

  // Calculate position size using Kelly Criterion with cap
  calculatePositionSize(signal) {
    const { totalCapital, availableCapital, currentDrawdown } = this.portfolio;
    const openPositions = this.getOpenPositions();
    
    // Check max positions
    if (openPositions.length >= this.maxPositions) {
      console.log(`⚠️ Max positions (${this.maxPositions}) reached`);
      return { approved: false, reason: 'Max positions reached' };
    }
    
    // Check drawdown limit
    if (currentDrawdown >= this.maxDrawdown) {
      console.log(`⚠️ Max drawdown (${this.maxDrawdown * 100}%) reached`);
      return { approved: false, reason: 'Max drawdown reached' };
    }
    
    // Check exposure
    const currentExposure = openPositions.reduce((sum, p) => sum + p.position_size * p.entry_price, 0) / totalCapital;
    if (currentExposure >= this.maxExposure) {
      console.log(`⚠️ Max exposure (${this.maxExposure * 100}%) reached`);
      return { approved: false, reason: 'Max exposure reached' };
    }
    
    // Check if already have position in this asset
    const existingPosition = openPositions.find(p => p.asset === signal.asset);
    if (existingPosition) {
      console.log(`⚠️ Already have open position in ${signal.asset}`);
      return { approved: false, reason: `Already holding ${signal.asset}` };
    }
    
    // Calculate win rate from history
    const winRate = this.portfolio.totalTrades > 10 
      ? this.portfolio.winningTrades / this.portfolio.totalTrades 
      : 0.55; // Default assumption
    
    // Kelly Criterion: f* = (bp - q) / b
    // b = win/loss ratio, p = win probability, q = 1-p
    const avgWin = signal.riskReward || 2.0;
    const avgLoss = 1;
    const b = avgWin / avgLoss;
    const p = winRate;
    const q = 1 - p;
    const kellyFraction = (b * p - q) / b;
    
    // Use half-Kelly for safety
    const halfKelly = Math.max(0.01, kellyFraction / 2);
    
    // Cap at max risk per trade
    const riskFraction = Math.min(halfKelly, this.maxRiskPerTrade);
    
    // Calculate position size based on risk
    const riskAmount = totalCapital * riskFraction;
    const stopDistance = Math.abs(signal.suggestedEntry - signal.suggestedStop) / signal.suggestedEntry;
    const positionValue = riskAmount / stopDistance;
    
    // Cap at available capital
    const maxPositionValue = availableCapital * 0.9; // Leave 10% buffer
    const finalPositionValue = Math.min(positionValue, maxPositionValue);
    
    // Calculate units
    const positionSize = finalPositionValue / signal.suggestedEntry;
    
    // Calculate leverage needed
    const leverage = Math.min(positionValue / (totalCapital * 0.25), config.hyperliquid.maxLeverage);
    
    return {
      approved: true,
      positionSize: parseFloat(positionSize.toFixed(4)),
      positionValue: parseFloat(finalPositionValue.toFixed(2)),
      riskAmount: parseFloat(riskAmount.toFixed(2)),
      riskPercent: parseFloat((riskFraction * 100).toFixed(2)),
      leverage: parseFloat(leverage.toFixed(1)),
      stopDistance: parseFloat((stopDistance * 100).toFixed(2)),
      kellyFraction: parseFloat((kellyFraction * 100).toFixed(2)),
      exposureAfterTrade: parseFloat(((currentExposure + finalPositionValue / totalCapital) * 100).toFixed(2))
    };
  }

  // Validate trade parameters
  validateTrade(signal, sizing) {
    const validations = [];
    
    // Minimum confluence score
    if (signal.confluenceScore < config.signals.minConfluenceScore) {
      validations.push({
        passed: false,
        check: 'Confluence Score',
        message: `${signal.confluenceScore} < ${config.signals.minConfluenceScore} required`
      });
    } else {
      validations.push({
        passed: true,
        check: 'Confluence Score',
        message: `${signal.confluenceScore} >= ${config.signals.minConfluenceScore} ✓`
      });
    }
    
    // Risk/Reward ratio
    if (signal.riskReward < 2.0) {
      validations.push({
        passed: false,
        check: 'Risk/Reward',
        message: `${signal.riskReward.toFixed(2)} < 2.0 required`
      });
    } else {
      validations.push({
        passed: true,
        check: 'Risk/Reward',
        message: `${signal.riskReward.toFixed(2)} >= 2.0 ✓`
      });
    }
    
    // Position size
    if (sizing.positionValue < 50) {
      validations.push({
        passed: false,
        check: 'Position Size',
        message: `$${sizing.positionValue} too small (min $50)`
      });
    } else {
      validations.push({
        passed: true,
        check: 'Position Size',
        message: `$${sizing.positionValue} ✓`
      });
    }
    
    // Exposure check
    if (sizing.exposureAfterTrade > this.maxExposure * 100) {
      validations.push({
        passed: false,
        check: 'Portfolio Exposure',
        message: `${sizing.exposureAfterTrade}% > ${this.maxExposure * 100}% max`
      });
    } else {
      validations.push({
        passed: true,
        check: 'Portfolio Exposure',
        message: `${sizing.exposureAfterTrade}% ✓`
      });
    }
    
    const allPassed = validations.every(v => v.passed);
    
    return {
      approved: allPassed,
      validations,
      summary: allPassed 
        ? '✅ All risk checks passed' 
        : '❌ Some risk checks failed'
    };
  }

  // Update portfolio after trade
  updatePortfolioOnEntry(trade) {
    this.portfolio.allocatedCapital += trade.positionValue;
    this.portfolio.availableCapital = this.portfolio.totalCapital - this.portfolio.allocatedCapital;
    
    this.savePortfolio();
  }

  // Update portfolio after trade close
  updatePortfolioOnExit(trade, pnl) {
    this.portfolio.allocatedCapital -= trade.positionValue;
    this.portfolio.realizedPnl += pnl;
    this.portfolio.totalCapital += pnl;
    this.portfolio.availableCapital = this.portfolio.totalCapital - this.portfolio.allocatedCapital;
    this.portfolio.totalTrades++;
    
    if (pnl > 0) {
      this.portfolio.winningTrades++;
    } else {
      this.portfolio.losingTrades++;
    }
    
    // Update peak equity and drawdown
    if (this.portfolio.totalCapital > this.portfolio.peakEquity) {
      this.portfolio.peakEquity = this.portfolio.totalCapital;
    }
    this.portfolio.currentDrawdown = (this.portfolio.peakEquity - this.portfolio.totalCapital) / this.portfolio.peakEquity;
    
    this.savePortfolio();
    this.saveDailyMetrics();
  }

  // Save portfolio to database
  savePortfolio() {
    try {
      db.prepare(`
        INSERT INTO portfolio (
          total_capital, available_capital, allocated_capital,
          unrealized_pnl, realized_pnl, current_drawdown, peak_equity,
          total_trades, winning_trades, losing_trades
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        this.portfolio.totalCapital,
        this.portfolio.availableCapital,
        this.portfolio.allocatedCapital,
        this.portfolio.unrealizedPnl,
        this.portfolio.realizedPnl,
        this.portfolio.currentDrawdown,
        this.portfolio.peakEquity,
        this.portfolio.totalTrades,
        this.portfolio.winningTrades,
        this.portfolio.losingTrades
      );
    } catch (error) {
      console.error('Error saving portfolio:', error.message);
    }
  }

  // Save daily metrics
  saveDailyMetrics() {
    const today = new Date().toISOString().split('T')[0];
    const winRate = this.portfolio.totalTrades > 0 
      ? this.portfolio.winningTrades / this.portfolio.totalTrades 
      : 0;
    
    try {
      db.prepare(`
        INSERT OR REPLACE INTO daily_metrics (
          date, starting_capital, ending_capital, pnl,
          trades_taken, winning_trades, losing_trades, win_rate, max_drawdown
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        today,
        this.portfolio.peakEquity,
        this.portfolio.totalCapital,
        this.portfolio.realizedPnl,
        this.portfolio.totalTrades,
        this.portfolio.winningTrades,
        this.portfolio.losingTrades,
        winRate,
        this.portfolio.currentDrawdown
      );
    } catch (error) {
      console.error('Error saving daily metrics:', error.message);
    }
  }

  // Check if should close position (trailing stop, time-based, etc.)
  shouldClosePosition(position, currentPrice) {
    const direction = position.direction;
    const entryPrice = position.entry_price;
    const stopLoss = position.stop_loss;
    const tp1 = position.take_profit_1;
    const tp2 = position.take_profit_2;
    const tp3 = position.take_profit_3;
    
    // Calculate current P&L
    const pnlPercent = direction === 'LONG'
      ? ((currentPrice - entryPrice) / entryPrice) * 100
      : ((entryPrice - currentPrice) / entryPrice) * 100;
    
    // Check stop loss
    if (direction === 'LONG' && currentPrice <= stopLoss) {
      return { close: true, reason: 'Stop loss hit', pnlPercent };
    }
    if (direction === 'SHORT' && currentPrice >= stopLoss) {
      return { close: true, reason: 'Stop loss hit', pnlPercent };
    }
    
    // Check TP3 (full close)
    if (direction === 'LONG' && currentPrice >= tp3) {
      return { close: true, reason: 'TP3 reached', pnlPercent };
    }
    if (direction === 'SHORT' && currentPrice <= tp3) {
      return { close: true, reason: 'TP3 reached', pnlPercent };
    }
    
    // Check TP2 (partial close logic would go here)
    if (direction === 'LONG' && currentPrice >= tp2) {
      return { partialClose: 0.5, reason: 'TP2 reached - partial close', pnlPercent };
    }
    if (direction === 'SHORT' && currentPrice <= tp2) {
      return { partialClose: 0.5, reason: 'TP2 reached - partial close', pnlPercent };
    }
    
    // Check TP1 (move stop to breakeven)
    if (direction === 'LONG' && currentPrice >= tp1) {
      return { moveStopToBE: true, reason: 'TP1 reached - move stop to BE', pnlPercent };
    }
    if (direction === 'SHORT' && currentPrice <= tp1) {
      return { moveStopToBE: true, reason: 'TP1 reached - move stop to BE', pnlPercent };
    }
    
    return { close: false, pnlPercent };
  }

  // Get portfolio summary
  getPortfolioSummary() {
    const positions = this.getOpenPositions();
    const winRate = this.portfolio.totalTrades > 0 
      ? (this.portfolio.winningTrades / this.portfolio.totalTrades * 100).toFixed(1) 
      : 'N/A';
    
    return {
      totalCapital: `$${this.portfolio.totalCapital.toFixed(2)}`,
      availableCapital: `$${this.portfolio.availableCapital.toFixed(2)}`,
      allocatedCapital: `$${this.portfolio.allocatedCapital.toFixed(2)}`,
      unrealizedPnl: `$${this.portfolio.unrealizedPnl.toFixed(2)}`,
      realizedPnl: `$${this.portfolio.realizedPnl.toFixed(2)}`,
      currentDrawdown: `${(this.portfolio.currentDrawdown * 100).toFixed(2)}%`,
      totalTrades: this.portfolio.totalTrades,
      winRate: `${winRate}%`,
      openPositions: positions.length,
      positions: positions.map(p => ({
        asset: p.asset,
        direction: p.direction,
        size: p.position_size,
        entry: p.entry_price,
        current: p.current_price,
        pnl: `${p.unrealized_pnl_percent.toFixed(2)}%`
      }))
    };
  }
}

export default RiskManager;
