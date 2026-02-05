// Hyperliquid Execution Engine - Trade execution and position management
import { ethers } from 'ethers';
import axios from 'axios';
import config from '../config.js';
import db from '../data/database.js';

class HyperliquidExecutor {
  constructor(privateKey = null) {
    this.isPaperTrading = config.mode === 'paper';
    this.baseUrl = this.isPaperTrading ? config.hyperliquid.testnet : config.hyperliquid.mainnet;
    this.wallet = privateKey ? new ethers.Wallet(privateKey) : null;
    this.positions = new Map();
    this.orders = [];
  }

  // Initialize connection
  async initialize() {
    if (this.isPaperTrading) {
      console.log('📝 Paper Trading Mode - No real orders will be executed');
      return true;
    }

    if (!this.wallet) {
      console.error('❌ No private key provided for live trading');
      return false;
    }

    try {
      // Verify connection
      const response = await axios.post(`${this.baseUrl}/info`, {
        type: 'meta'
      });
      console.log('✅ Connected to Hyperliquid');
      return true;
    } catch (error) {
      console.error('❌ Failed to connect to Hyperliquid:', error.message);
      return false;
    }
  }

  // Get current price for an asset
  async getCurrentPrice(asset) {
    try {
      // Use Binance for price data
      const response = await axios.get(
        `${config.apis.binance}/ticker/price?symbol=${asset}USDT`
      );
      return parseFloat(response.data.price);
    } catch (error) {
      console.error(`Error getting price for ${asset}:`, error.message);
      return null;
    }
  }

  // Open a new position
  async openPosition(signal, sizing) {
    const {
      asset,
      direction,
      suggestedEntry,
      suggestedStop,
      suggestedTp1,
      suggestedTp2,
      suggestedTp3,
      confluenceScore,
      reasoning
    } = signal;

    const { positionSize, positionValue, leverage, riskPercent } = sizing;

    console.log(`\n🚀 Opening ${direction} position on ${asset}`);
    console.log(`   Size: ${positionSize} ${asset} ($${positionValue})`);
    console.log(`   Entry: $${suggestedEntry.toFixed(2)}`);
    console.log(`   Stop: $${suggestedStop.toFixed(2)}`);
    console.log(`   TP1: $${suggestedTp1.toFixed(2)}`);
    console.log(`   TP2: $${suggestedTp2.toFixed(2)}`);
    console.log(`   TP3: $${suggestedTp3.toFixed(2)}`);

    if (this.isPaperTrading) {
      // Simulate order execution
      const executionPrice = await this.getCurrentPrice(asset) || suggestedEntry;
      
      const trade = {
        id: `TRADE-${Date.now()}-${asset}`,
        asset,
        direction,
        positionSize,
        positionValue,
        entryPrice: executionPrice,
        stopLoss: suggestedStop,
        takeProfit1: suggestedTp1,
        takeProfit2: suggestedTp2,
        takeProfit3: suggestedTp3,
        leverage,
        status: 'OPEN',
        openTime: new Date(),
        confluenceScore,
        reasoning
      };

      // Save to database
      this.savePosition(trade);
      
      // Store in memory
      this.positions.set(trade.id, trade);
      
      console.log(`✅ Paper trade opened: ${trade.id}`);
      this.logEvent('POSITION_OPENED', trade);
      
      return { success: true, trade };
    }

    // Live trading logic
    try {
      // Create order payload for Hyperliquid
      const timestamp = Date.now();
      const order = {
        a: this.getAssetIndex(asset), // Asset index
        b: direction === 'LONG', // isBuy
        p: suggestedEntry.toString(), // price
        s: positionSize.toString(), // size
        r: false, // reduceOnly
        t: {
          limit: {
            tif: 'Gtc' // Good til cancelled
          }
        },
        c: `nexxore-${timestamp}` // client order id
      };

      // Sign the order
      const orderPayload = this.signOrder(order, timestamp);

      // Submit order
      const response = await axios.post(`${this.baseUrl}/exchange`, {
        action: {
          type: 'order',
          orders: [order],
          grouping: 'na'
        },
        nonce: timestamp,
        signature: orderPayload.signature
      });

      if (response.data.status === 'ok') {
        const trade = {
          id: response.data.response.data.statuses[0].resting?.oid || `HL-${timestamp}`,
          asset,
          direction,
          positionSize,
          positionValue,
          entryPrice: suggestedEntry,
          stopLoss: suggestedStop,
          takeProfit1: suggestedTp1,
          takeProfit2: suggestedTp2,
          takeProfit3: suggestedTp3,
          leverage,
          status: 'OPEN',
          openTime: new Date(),
          confluenceScore,
          reasoning
        };

        this.savePosition(trade);
        this.positions.set(trade.id, trade);

        // Set stop loss and take profit orders
        await this.setStopLoss(asset, positionSize, suggestedStop, direction);
        await this.setTakeProfit(asset, positionSize * 0.5, suggestedTp2, direction);

        console.log(`✅ Live trade opened: ${trade.id}`);
        this.logEvent('POSITION_OPENED', trade);

        return { success: true, trade };
      } else {
        throw new Error(response.data.error || 'Order failed');
      }
    } catch (error) {
      console.error(`❌ Failed to open position: ${error.message}`);
      this.logEvent('POSITION_ERROR', { asset, error: error.message });
      return { success: false, error: error.message };
    }
  }

  // Close a position
  async closePosition(positionId, reason = 'Manual close') {
    const position = this.positions.get(positionId) || this.getPositionFromDb(positionId);
    
    if (!position) {
      console.error(`Position ${positionId} not found`);
      return { success: false, error: 'Position not found' };
    }

    console.log(`\n📤 Closing ${position.direction} position on ${position.asset}`);
    console.log(`   Reason: ${reason}`);

    const currentPrice = await this.getCurrentPrice(position.asset);
    
    if (!currentPrice) {
      console.error('Could not get current price');
      return { success: false, error: 'Price unavailable' };
    }

    // Calculate P&L
    const pnl = position.direction === 'LONG'
      ? (currentPrice - position.entryPrice) * position.positionSize
      : (position.entryPrice - currentPrice) * position.positionSize;

    const pnlPercent = position.direction === 'LONG'
      ? ((currentPrice - position.entryPrice) / position.entryPrice) * 100
      : ((position.entryPrice - currentPrice) / position.entryPrice) * 100;

    if (this.isPaperTrading) {
      // Update position status
      const closedTrade = {
        ...position,
        status: 'CLOSED',
        closeTime: new Date(),
        closePrice: currentPrice,
        closedPnl: pnl,
        closedPnlPercent: pnlPercent,
        closeReason: reason
      };

      this.updatePositionInDb(closedTrade);
      this.saveTrade(closedTrade);
      this.positions.delete(positionId);

      console.log(`✅ Paper trade closed: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)} (${pnlPercent.toFixed(2)}%)`);
      this.logEvent('POSITION_CLOSED', closedTrade);

      return { success: true, trade: closedTrade, pnl, pnlPercent };
    }

    // Live trading close
    try {
      const timestamp = Date.now();
      const closeOrder = {
        a: this.getAssetIndex(position.asset),
        b: position.direction === 'SHORT', // Opposite direction to close
        p: currentPrice.toString(),
        s: position.positionSize.toString(),
        r: true, // reduceOnly
        t: {
          limit: {
            tif: 'Ioc' // Immediate or cancel
          }
        },
        c: `close-${timestamp}`
      };

      const orderPayload = this.signOrder(closeOrder, timestamp);

      const response = await axios.post(`${this.baseUrl}/exchange`, {
        action: {
          type: 'order',
          orders: [closeOrder],
          grouping: 'na'
        },
        nonce: timestamp,
        signature: orderPayload.signature
      });

      if (response.data.status === 'ok') {
        const closedTrade = {
          ...position,
          status: 'CLOSED',
          closeTime: new Date(),
          closePrice: currentPrice,
          closedPnl: pnl,
          closedPnlPercent: pnlPercent,
          closeReason: reason
        };

        this.updatePositionInDb(closedTrade);
        this.saveTrade(closedTrade);
        this.positions.delete(positionId);

        // Cancel associated orders
        await this.cancelAllOrders(position.asset);

        console.log(`✅ Live trade closed: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`);
        this.logEvent('POSITION_CLOSED', closedTrade);

        return { success: true, trade: closedTrade, pnl, pnlPercent };
      }
    } catch (error) {
      console.error(`❌ Failed to close position: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  // Update position's stop loss
  async updateStopLoss(positionId, newStopLoss) {
    const position = this.positions.get(positionId) || this.getPositionFromDb(positionId);
    
    if (!position) return { success: false, error: 'Position not found' };

    console.log(`📊 Updating stop loss for ${position.asset}: $${position.stopLoss} → $${newStopLoss}`);

    if (this.isPaperTrading) {
      position.stopLoss = newStopLoss;
      this.updatePositionInDb(position);
      return { success: true };
    }

    // Live - cancel old SL and set new one
    try {
      await this.cancelStopLoss(position.asset);
      await this.setStopLoss(position.asset, position.positionSize, newStopLoss, position.direction);
      position.stopLoss = newStopLoss;
      this.updatePositionInDb(position);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // Set stop loss order
  async setStopLoss(asset, size, stopPrice, direction) {
    if (this.isPaperTrading) return true;

    try {
      const timestamp = Date.now();
      const stopOrder = {
        a: this.getAssetIndex(asset),
        b: direction === 'SHORT', // Close long = sell, close short = buy
        p: stopPrice.toString(),
        s: size.toString(),
        r: true,
        t: {
          trigger: {
            isMarket: true,
            triggerPx: stopPrice.toString(),
            tpsl: direction === 'LONG' ? 'sl' : 'sl'
          }
        },
        c: `sl-${timestamp}`
      };

      const orderPayload = this.signOrder(stopOrder, timestamp);

      await axios.post(`${this.baseUrl}/exchange`, {
        action: {
          type: 'order',
          orders: [stopOrder],
          grouping: 'na'
        },
        nonce: timestamp,
        signature: orderPayload.signature
      });

      return true;
    } catch (error) {
      console.error('Failed to set stop loss:', error.message);
      return false;
    }
  }

  // Set take profit order
  async setTakeProfit(asset, size, tpPrice, direction) {
    if (this.isPaperTrading) return true;

    try {
      const timestamp = Date.now();
      const tpOrder = {
        a: this.getAssetIndex(asset),
        b: direction === 'SHORT',
        p: tpPrice.toString(),
        s: size.toString(),
        r: true,
        t: {
          trigger: {
            isMarket: true,
            triggerPx: tpPrice.toString(),
            tpsl: 'tp'
          }
        },
        c: `tp-${timestamp}`
      };

      const orderPayload = this.signOrder(tpOrder, timestamp);

      await axios.post(`${this.baseUrl}/exchange`, {
        action: {
          type: 'order',
          orders: [tpOrder],
          grouping: 'na'
        },
        nonce: timestamp,
        signature: orderPayload.signature
      });

      return true;
    } catch (error) {
      console.error('Failed to set take profit:', error.message);
      return false;
    }
  }

  // Cancel all orders for an asset
  async cancelAllOrders(asset) {
    if (this.isPaperTrading) return true;

    try {
      const timestamp = Date.now();
      await axios.post(`${this.baseUrl}/exchange`, {
        action: {
          type: 'cancelByCloid',
          cancels: [{ asset: this.getAssetIndex(asset) }]
        },
        nonce: timestamp,
        signature: this.signCancel(timestamp)
      });
      return true;
    } catch (error) {
      console.error('Failed to cancel orders:', error.message);
      return false;
    }
  }

  // Sign order (simplified - actual implementation needs proper EIP-712)
  signOrder(order, nonce) {
    if (!this.wallet) return { signature: null };
    
    // In production, implement proper EIP-712 signing
    const message = JSON.stringify({ order, nonce });
    const signature = this.wallet.signMessageSync(message);
    return { signature };
  }

  // Sign cancel
  signCancel(nonce) {
    if (!this.wallet) return null;
    return this.wallet.signMessageSync(JSON.stringify({ action: 'cancel', nonce }));
  }

  // Get asset index for Hyperliquid
  getAssetIndex(asset) {
    const assetMap = {
      'BTC': 0, 'ETH': 1, 'SOL': 2, 'AVAX': 3, 'ARB': 4,
      'OP': 5, 'MATIC': 6, 'LINK': 7, 'UNI': 8, 'AAVE': 9,
      'DOGE': 10, 'LTC': 11, 'NEAR': 12, 'ATOM': 13, 'DOT': 14
    };
    return assetMap[asset] || 0;
  }

  // Database operations
  savePosition(trade) {
    try {
      db.prepare(`
        INSERT INTO positions (
          asset, direction, position_size, entry_price,
          stop_loss, take_profit_1, take_profit_2, take_profit_3,
          leverage, status, confluence_score, reasoning
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        trade.asset, trade.direction, trade.positionSize, trade.entryPrice,
        trade.stopLoss, trade.takeProfit1, trade.takeProfit2, trade.takeProfit3,
        trade.leverage, trade.status, trade.confluenceScore, trade.reasoning
      );
    } catch (error) {
      console.error('Error saving position:', error.message);
    }
  }

  updatePositionInDb(trade) {
    try {
      db.prepare(`
        UPDATE positions SET
          current_price = ?,
          unrealized_pnl = ?,
          unrealized_pnl_percent = ?,
          stop_loss = ?,
          status = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE asset = ? AND status = 'OPEN'
      `).run(
        trade.closePrice || trade.currentPrice,
        trade.closedPnl || 0,
        trade.closedPnlPercent || 0,
        trade.stopLoss,
        trade.status,
        trade.asset
      );
    } catch (error) {
      console.error('Error updating position:', error.message);
    }
  }

  saveTrade(trade) {
    try {
      db.prepare(`
        INSERT INTO trades (
          asset, direction, position_size, entry_price, exit_price,
          stop_loss, take_profit, leverage, pnl, pnl_percent,
          confluence_score, entry_reason, exit_reason, status, closed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        trade.asset, trade.direction, trade.positionSize,
        trade.entryPrice, trade.closePrice,
        trade.stopLoss, trade.takeProfit2, trade.leverage,
        trade.closedPnl, trade.closedPnlPercent,
        trade.confluenceScore, trade.reasoning, trade.closeReason,
        'CLOSED', new Date().toISOString()
      );
    } catch (error) {
      console.error('Error saving trade:', error.message);
    }
  }

  getPositionFromDb(positionId) {
    try {
      return db.prepare('SELECT * FROM positions WHERE id = ?').get(positionId);
    } catch (error) {
      return null;
    }
  }

  getOpenPositions() {
    try {
      return db.prepare('SELECT * FROM positions WHERE status = ?').all('OPEN');
    } catch (error) {
      return [];
    }
  }

  logEvent(eventType, data) {
    try {
      db.prepare(`
        INSERT INTO event_log (event_type, data) VALUES (?, ?)
      `).run(eventType, JSON.stringify(data));
    } catch (error) {
      console.error('Error logging event:', error.message);
    }
  }

  // Get trade history
  getTradeHistory(limit = 50) {
    try {
      return db.prepare(`
        SELECT * FROM trades ORDER BY closed_at DESC LIMIT ?
      `).all(limit);
    } catch (error) {
      return [];
    }
  }

  // Get performance stats
  getPerformanceStats() {
    try {
      const trades = db.prepare('SELECT * FROM trades WHERE status = ?').all('CLOSED');
      
      if (trades.length === 0) {
        return {
          totalTrades: 0,
          winRate: 0,
          avgPnl: 0,
          totalPnl: 0,
          profitFactor: 0,
          maxDrawdown: 0
        };
      }

      const winners = trades.filter(t => t.pnl > 0);
      const losers = trades.filter(t => t.pnl <= 0);
      const totalPnl = trades.reduce((sum, t) => sum + t.pnl, 0);
      const grossProfit = winners.reduce((sum, t) => sum + t.pnl, 0);
      const grossLoss = Math.abs(losers.reduce((sum, t) => sum + t.pnl, 0));

      return {
        totalTrades: trades.length,
        winningTrades: winners.length,
        losingTrades: losers.length,
        winRate: ((winners.length / trades.length) * 100).toFixed(1),
        avgPnl: (totalPnl / trades.length).toFixed(2),
        avgWin: winners.length > 0 ? (grossProfit / winners.length).toFixed(2) : 0,
        avgLoss: losers.length > 0 ? (grossLoss / losers.length).toFixed(2) : 0,
        totalPnl: totalPnl.toFixed(2),
        profitFactor: grossLoss > 0 ? (grossProfit / grossLoss).toFixed(2) : 'Infinite',
        largestWin: Math.max(...trades.map(t => t.pnl)).toFixed(2),
        largestLoss: Math.min(...trades.map(t => t.pnl)).toFixed(2)
      };
    } catch (error) {
      console.error('Error getting performance stats:', error.message);
      return null;
    }
  }
}

export default HyperliquidExecutor;
