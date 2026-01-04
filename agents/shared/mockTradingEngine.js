/**
 * Mock Trading Engine
 * 
 * Paper trading system to test alpha signals:
 * - Execute trades based on signals
 * - Track open positions
 * - Manage stop losses and take profits
 * - Calculate P&L
 */

const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

class MockTradingEngine {
  constructor(config = {}) {
    this.supabase = createClient(
      config.supabaseUrl || process.env.SUPABASE_URL,
      config.supabaseKey || process.env.SUPABASE_ANON_KEY
    );
    
    this.config = {
      initialCapital: 100000,        // $100k starting capital
      maxPositionSize: 10000,        // Max $10k per position
      maxPositions: 10,              // Max 10 concurrent positions
      defaultStopLossPct: 5,         // 5% stop loss
      defaultTakeProfitPct: 15,      // 15% take profit
      tradingFeesPct: 0.1,           // 0.1% trading fees
      slippagePct: 0.1,              // 0.1% slippage
      ...config
    };
    
    this.priceFeeds = config.priceFeeds || {};
  }

  /**
   * Generate unique position ID
   */
  generatePositionId() {
    return 'pos_' + crypto.randomBytes(8).toString('hex');
  }

  /**
   * Get current portfolio state
   */
  async getPortfolio() {
    const { data, error } = await this.supabase
      .from('mock_portfolio')
      .select('*')
      .limit(1)
      .single();

    if (error || !data) {
      // Initialize portfolio if not exists
      return this.initializePortfolio();
    }
    return data;
  }

  /**
   * Initialize portfolio
   */
  async initializePortfolio() {
    const portfolio = {
      total_capital: this.config.initialCapital,
      available_capital: this.config.initialCapital,
      allocated_capital: 0,
      total_realized_pnl: 0,
      total_unrealized_pnl: 0,
      total_trades: 0,
      winning_trades: 0,
      losing_trades: 0,
      max_position_size: this.config.maxPositionSize,
      max_portfolio_risk_pct: 20
    };

    const { data, error } = await this.supabase
      .from('mock_portfolio')
      .upsert(portfolio)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  /**
   * Execute a trade based on signal
   */
  async executeSignal(signal, options = {}) {
    const portfolio = await this.getPortfolio();
    
    // Calculate position size
    let positionSize = options.positionSize || this.calculatePositionSize(signal, portfolio);
    
    // Validate trade
    const validation = await this.validateTrade(signal, positionSize, portfolio);
    if (!validation.valid) {
      console.log(`❌ Trade rejected: ${validation.reason}`);
      return { success: false, reason: validation.reason };
    }

    // Get current price (use signal entry price or fetch live)
    const entryPrice = options.entryPrice || signal.entry_price || signal.entryPrice;
    if (!entryPrice) {
      return { success: false, reason: 'No entry price available' };
    }

    // Apply slippage
    const slippageMultiplier = 1 + (this.config.slippagePct / 100);
    const executionPrice = signal.action === 'BUY' 
      ? entryPrice * slippageMultiplier 
      : entryPrice / slippageMultiplier;

    // Calculate quantity
    const quantity = positionSize / executionPrice;

    // Calculate fees
    const fees = positionSize * (this.config.tradingFeesPct / 100);

    // Create position
    const position = {
      position_id: this.generatePositionId(),
      signal_id: signal.signal_id,
      protocol: signal.protocol,
      chain: signal.chain || 'ethereum',
      token_symbol: signal.token_symbol || signal.tokenSymbol,
      token_address: signal.token_address || signal.tokenAddress,
      position_type: signal.action === 'BUY' ? 'LONG' : 'SHORT',
      entry_price: executionPrice,
      entry_amount: positionSize,
      entry_quantity: quantity,
      entry_timestamp: new Date().toISOString(),
      current_price: executionPrice,
      current_value: positionSize,
      unrealized_pnl: 0,
      unrealized_pnl_pct: 0,
      stop_loss_price: signal.stop_loss_price || (executionPrice * (1 - this.config.defaultStopLossPct / 100)),
      take_profit_price: signal.target_price || (executionPrice * (1 + this.config.defaultTakeProfitPct / 100)),
      trailing_stop_pct: options.trailingStop,
      fees_paid: fees,
      status: 'OPEN'
    };

    // Insert position
    const { data: positionData, error: posError } = await this.supabase
      .from('mock_positions')
      .insert(position)
      .select()
      .single();

    if (posError) {
      console.error('Failed to create position:', posError);
      return { success: false, reason: posError.message };
    }

    // Update portfolio
    await this.supabase
      .from('mock_portfolio')
      .update({
        available_capital: portfolio.available_capital - positionSize - fees,
        allocated_capital: portfolio.allocated_capital + positionSize,
        total_trades: portfolio.total_trades + 1,
        last_updated: new Date().toISOString()
      })
      .eq('id', portfolio.id);

    // Update signal status
    await this.supabase
      .from('alpha_signals')
      .update({ status: 'EXECUTED' })
      .eq('signal_id', signal.signal_id);

    // Log trade
    await this.logPositionEvent(position.position_id, 'OPEN', {
      price: executionPrice,
      quantity,
      value: positionSize
    });

    console.log(`✅ Position opened: ${position.position_id}`);
    console.log(`   ${signal.protocol} | ${position.position_type} | $${positionSize.toFixed(2)}`);
    console.log(`   Entry: $${executionPrice.toFixed(6)} | SL: $${position.stop_loss_price.toFixed(6)} | TP: $${position.take_profit_price.toFixed(6)}`);

    return { success: true, position: positionData };
  }

  /**
   * Calculate position size based on risk
   */
  calculatePositionSize(signal, portfolio) {
    const alphaScore = signal.alpha_score || signal.alphaScore || 50;
    const confidence = signal.confidence || 50;
    
    // Base size is 5% of available capital
    let baseSize = portfolio.available_capital * 0.05;
    
    // Adjust based on alpha score (higher score = larger position)
    const alphaMultiplier = 0.5 + (alphaScore / 100);
    
    // Adjust based on confidence
    const confidenceMultiplier = 0.5 + (confidence / 200);
    
    let size = baseSize * alphaMultiplier * confidenceMultiplier;
    
    // Cap at max position size
    size = Math.min(size, this.config.maxPositionSize);
    
    // Cap at available capital
    size = Math.min(size, portfolio.available_capital * 0.9); // Leave 10% buffer
    
    return Math.round(size * 100) / 100;
  }

  /**
   * Validate trade before execution
   */
  async validateTrade(signal, positionSize, portfolio) {
    // Check available capital
    if (positionSize > portfolio.available_capital) {
      return { valid: false, reason: 'Insufficient capital' };
    }

    // Check position count
    const { count } = await this.supabase
      .from('mock_positions')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'OPEN');

    if (count >= this.config.maxPositions) {
      return { valid: false, reason: `Max positions (${this.config.maxPositions}) reached` };
    }

    // Check if already have position in this protocol
    const { data: existing } = await this.supabase
      .from('mock_positions')
      .select('*')
      .eq('protocol', signal.protocol)
      .eq('status', 'OPEN');

    if (existing && existing.length > 0) {
      return { valid: false, reason: `Already have open position in ${signal.protocol}` };
    }

    // Check minimum alpha score
    if ((signal.alpha_score || signal.alphaScore || 0) < 40) {
      return { valid: false, reason: 'Alpha score too low (min: 40)' };
    }

    return { valid: true };
  }

  /**
   * Update position with new price
   */
  async updatePositionPrice(positionId, currentPrice) {
    const { data: position, error } = await this.supabase
      .from('mock_positions')
      .select('*')
      .eq('position_id', positionId)
      .single();

    if (error || !position || position.status !== 'OPEN') return;

    const entryPrice = parseFloat(position.entry_price);
    const entryAmount = parseFloat(position.entry_amount);
    const quantity = parseFloat(position.entry_quantity);

    // Calculate P&L
    let pnl, pnlPct;
    if (position.position_type === 'LONG') {
      pnl = (currentPrice - entryPrice) * quantity;
      pnlPct = ((currentPrice - entryPrice) / entryPrice) * 100;
    } else {
      pnl = (entryPrice - currentPrice) * quantity;
      pnlPct = ((entryPrice - currentPrice) / entryPrice) * 100;
    }

    const currentValue = entryAmount + pnl;

    // Update position
    await this.supabase
      .from('mock_positions')
      .update({
        current_price: currentPrice,
        current_value: currentValue,
        unrealized_pnl: pnl,
        unrealized_pnl_pct: pnlPct,
        last_updated: new Date().toISOString()
      })
      .eq('position_id', positionId);

    // Check stop loss
    const stopLoss = parseFloat(position.stop_loss_price);
    if (position.position_type === 'LONG' && currentPrice <= stopLoss) {
      await this.closePosition(positionId, currentPrice, 'STOP_LOSS');
      return;
    } else if (position.position_type === 'SHORT' && currentPrice >= stopLoss) {
      await this.closePosition(positionId, currentPrice, 'STOP_LOSS');
      return;
    }

    // Check take profit
    const takeProfit = parseFloat(position.take_profit_price);
    if (position.position_type === 'LONG' && currentPrice >= takeProfit) {
      await this.closePosition(positionId, currentPrice, 'TAKE_PROFIT');
      return;
    } else if (position.position_type === 'SHORT' && currentPrice <= takeProfit) {
      await this.closePosition(positionId, currentPrice, 'TAKE_PROFIT');
      return;
    }

    // Update trailing stop if configured
    if (position.trailing_stop_pct) {
      await this.updateTrailingStop(position, currentPrice);
    }
  }

  /**
   * Close a position
   */
  async closePosition(positionId, exitPrice, exitReason = 'MANUAL') {
    const { data: position, error } = await this.supabase
      .from('mock_positions')
      .select('*')
      .eq('position_id', positionId)
      .single();

    if (error || !position || position.status !== 'OPEN') {
      return { success: false, reason: 'Position not found or already closed' };
    }

    // Apply slippage to exit
    const slippageMultiplier = 1 - (this.config.slippagePct / 100);
    const executionPrice = position.position_type === 'LONG'
      ? exitPrice * slippageMultiplier
      : exitPrice / slippageMultiplier;

    // Calculate realized P&L
    const entryPrice = parseFloat(position.entry_price);
    const quantity = parseFloat(position.entry_quantity);
    const entryAmount = parseFloat(position.entry_amount);

    let realizedPnl;
    if (position.position_type === 'LONG') {
      realizedPnl = (executionPrice - entryPrice) * quantity;
    } else {
      realizedPnl = (entryPrice - executionPrice) * quantity;
    }

    // Subtract fees
    const exitFees = entryAmount * (this.config.tradingFeesPct / 100);
    realizedPnl -= exitFees;
    realizedPnl -= parseFloat(position.fees_paid);

    const realizedPnlPct = (realizedPnl / entryAmount) * 100;

    // Update position
    await this.supabase
      .from('mock_positions')
      .update({
        exit_price: executionPrice,
        exit_timestamp: new Date().toISOString(),
        exit_reason: exitReason,
        realized_pnl: realizedPnl,
        realized_pnl_pct: realizedPnlPct,
        fees_paid: parseFloat(position.fees_paid) + exitFees,
        status: 'CLOSED',
        last_updated: new Date().toISOString()
      })
      .eq('position_id', positionId);

    // Update portfolio
    const portfolio = await this.getPortfolio();
    const returnedCapital = entryAmount + realizedPnl;

    const portfolioUpdate = {
      available_capital: portfolio.available_capital + returnedCapital,
      allocated_capital: portfolio.allocated_capital - entryAmount,
      total_realized_pnl: portfolio.total_realized_pnl + realizedPnl,
      last_updated: new Date().toISOString()
    };

    if (realizedPnl > 0) {
      portfolioUpdate.winning_trades = portfolio.winning_trades + 1;
    } else {
      portfolioUpdate.losing_trades = portfolio.losing_trades + 1;
    }

    await this.supabase
      .from('mock_portfolio')
      .update(portfolioUpdate)
      .eq('id', portfolio.id);

    // Update signal performance
    if (position.signal_id) {
      const outcome = realizedPnl > 0 ? 'WIN' : (realizedPnl < 0 ? 'LOSS' : 'BREAKEVEN');
      await this.supabase
        .from('signal_performance')
        .update({ outcome })
        .eq('signal_id', position.signal_id);
    }

    // Log event
    await this.logPositionEvent(positionId, 'CLOSE', {
      price: executionPrice,
      pnl: realizedPnl,
      pnlPct: realizedPnlPct,
      reason: exitReason
    });

    const emoji = realizedPnl >= 0 ? '🟢' : '🔴';
    console.log(`${emoji} Position closed: ${positionId}`);
    console.log(`   ${position.protocol} | ${exitReason} | P&L: $${realizedPnl.toFixed(2)} (${realizedPnlPct.toFixed(2)}%)`);

    return { 
      success: true, 
      realizedPnl, 
      realizedPnlPct 
    };
  }

  /**
   * Update trailing stop
   */
  async updateTrailingStop(position, currentPrice) {
    const trailingPct = parseFloat(position.trailing_stop_pct);
    const currentStop = parseFloat(position.stop_loss_price);

    if (position.position_type === 'LONG') {
      const newStop = currentPrice * (1 - trailingPct / 100);
      if (newStop > currentStop) {
        await this.supabase
          .from('mock_positions')
          .update({ stop_loss_price: newStop })
          .eq('position_id', position.position_id);
      }
    } else {
      const newStop = currentPrice * (1 + trailingPct / 100);
      if (newStop < currentStop) {
        await this.supabase
          .from('mock_positions')
          .update({ stop_loss_price: newStop })
          .eq('position_id', position.position_id);
      }
    }
  }

  /**
   * Log position event
   */
  async logPositionEvent(positionId, eventType, data = {}) {
    await this.supabase
      .from('position_history')
      .insert({
        position_id: positionId,
        event_type: eventType,
        price_at_event: data.price,
        quantity_changed: data.quantity,
        value_changed: data.value,
        pnl_at_event: data.pnl,
        notes: data.notes,
        triggered_by: data.reason || 'AUTO',
        event_timestamp: new Date().toISOString()
      });
  }

  /**
   * Get all open positions
   */
  async getOpenPositions() {
    const { data, error } = await this.supabase
      .from('mock_positions')
      .select('*')
      .eq('status', 'OPEN')
      .order('entry_timestamp', { ascending: false });

    if (error) throw error;
    return data || [];
  }

  /**
   * Get position history
   */
  async getPositionHistory(limit = 50) {
    const { data, error } = await this.supabase
      .from('mock_positions')
      .select('*')
      .eq('status', 'CLOSED')
      .order('exit_timestamp', { ascending: false })
      .limit(limit);

    if (error) throw error;
    return data || [];
  }

  /**
   * Get trading statistics
   */
  async getTradingStats() {
    const portfolio = await this.getPortfolio();
    const openPositions = await this.getOpenPositions();
    
    // Calculate total unrealized P&L
    const totalUnrealizedPnl = openPositions.reduce(
      (sum, p) => sum + parseFloat(p.unrealized_pnl || 0), 
      0
    );

    // Calculate total portfolio value
    const totalValue = parseFloat(portfolio.available_capital) + 
                       parseFloat(portfolio.allocated_capital) + 
                       totalUnrealizedPnl;

    const totalPnl = parseFloat(portfolio.total_realized_pnl) + totalUnrealizedPnl;
    const totalTrades = portfolio.total_trades;
    const winRate = totalTrades > 0 
      ? (portfolio.winning_trades / (portfolio.winning_trades + portfolio.losing_trades) * 100)
      : 0;

    return {
      totalCapital: parseFloat(portfolio.total_capital),
      availableCapital: parseFloat(portfolio.available_capital),
      allocatedCapital: parseFloat(portfolio.allocated_capital),
      totalValue,
      totalPnl,
      totalPnlPct: (totalPnl / parseFloat(portfolio.total_capital)) * 100,
      realizedPnl: parseFloat(portfolio.total_realized_pnl),
      unrealizedPnl: totalUnrealizedPnl,
      openPositions: openPositions.length,
      totalTrades,
      winningTrades: portfolio.winning_trades,
      losingTrades: portfolio.losing_trades,
      winRate: winRate.toFixed(1),
      avgTradeSize: totalTrades > 0 ? (parseFloat(portfolio.allocated_capital) / openPositions.length || 0).toFixed(2) : 0
    };
  }

  /**
   * Update all open positions with latest prices
   */
  async updateAllPositions(priceFetcher) {
    const positions = await this.getOpenPositions();
    
    for (const position of positions) {
      try {
        // Fetch current price (implement based on your price source)
        const currentPrice = await priceFetcher(position.token_address, position.chain);
        if (currentPrice) {
          await this.updatePositionPrice(position.position_id, currentPrice);
        }
      } catch (err) {
        console.error(`Failed to update position ${position.position_id}:`, err.message);
      }
    }
  }

  /**
   * Auto-execute high-confidence signals
   */
  async autoExecuteSignals(signals, minAlphaScore = 70) {
    const results = [];
    
    for (const signal of signals) {
      const alphaScore = signal.alpha_score || signal.alphaScore;
      if (alphaScore >= minAlphaScore) {
        const result = await this.executeSignal(signal);
        results.push({
          signal_id: signal.signal_id,
          protocol: signal.protocol,
          executed: result.success,
          reason: result.reason,
          position_id: result.position?.position_id
        });
      }
    }
    
    return results;
  }
}

module.exports = { MockTradingEngine };
