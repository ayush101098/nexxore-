// Main Trading Agent - Orchestrates the entire trading workflow
import cron from 'node-cron';
import config from './config.js';
import db, { initializeDatabase } from './data/database.js';
import SignalGenerator from './alpha/signalGenerator.js';
import RiskManager from './risk/riskManager.js';
import HyperliquidExecutor from './execution/hyperliquid.js';

class TradingAgent {
  constructor() {
    this.signalGenerator = new SignalGenerator();
    this.riskManager = new RiskManager();
    this.executor = new HyperliquidExecutor(process.env.HL_PRIVATE_KEY);
    this.isRunning = false;
    this.lastScanTime = null;
    this.pendingSignals = [];
  }

  // Initialize the agent
  async initialize() {
    console.log('\n╔════════════════════════════════════════════════════╗');
    console.log('║       NEXXORE AUTONOMOUS TRADING AGENT v1.0        ║');
    console.log('╠════════════════════════════════════════════════════╣');
    console.log(`║  Mode: ${config.mode.toUpperCase().padEnd(45)}║`);
    console.log(`║  Assets: ${config.assets.length} configured${''.padEnd(35)}║`);
    console.log(`║  Max Risk/Trade: ${(config.risk.maxRiskPerTrade * 100).toFixed(1)}%${''.padEnd(31)}║`);
    console.log(`║  Min Confluence: ${config.signals.minConfluenceScore}${''.padEnd(33)}║`);
    console.log('╚════════════════════════════════════════════════════╝\n');

    // Initialize database
    initializeDatabase();
    console.log('✅ Database initialized');

    // Initialize executor
    const connected = await this.executor.initialize();
    if (!connected && config.mode === 'live') {
      console.error('❌ Failed to connect to exchange in live mode');
      return false;
    }

    // Load portfolio state
    const portfolio = this.riskManager.getPortfolioSummary();
    console.log('\n📊 Portfolio Status:');
    console.log(`   Total Capital: ${portfolio.totalCapital}`);
    console.log(`   Available: ${portfolio.availableCapital}`);
    console.log(`   Open Positions: ${portfolio.openPositions}`);
    console.log(`   Win Rate: ${portfolio.winRate}`);

    return true;
  }

  // Main trading loop
  async run() {
    this.isRunning = true;
    console.log('\n🚀 Starting trading agent...\n');

    // Initial scan
    await this.scanAndTrade();

    // Schedule regular scans
    const interval = config.intervals.signalScan / 60000; // Convert to minutes
    console.log(`\n⏰ Scheduling scans every ${interval} minutes\n`);

    cron.schedule(`*/${Math.max(1, interval)} * * * *`, async () => {
      if (this.isRunning) {
        await this.scanAndTrade();
      }
    });

    // Monitor open positions more frequently
    cron.schedule('*/1 * * * *', async () => {
      if (this.isRunning) {
        await this.monitorPositions();
      }
    });

    // Daily performance report
    cron.schedule('0 0 * * *', () => {
      this.generateDailyReport();
    });
  }

  // Scan for signals and execute trades
  async scanAndTrade() {
    this.lastScanTime = new Date();
    console.log(`\n${'═'.repeat(50)}`);
    console.log(`🔍 Signal Scan - ${this.lastScanTime.toLocaleString()}`);
    console.log(`${'═'.repeat(50)}\n`);

    try {
      // Generate signals for all assets
      const signals = await this.signalGenerator.scanAllAssets();

      if (signals.length === 0) {
        console.log('📭 No actionable signals found\n');
        return;
      }

      // Sort by confluence score
      signals.sort((a, b) => b.confluenceScore - a.confluenceScore);

      console.log(`\n📈 Top Signals:`);
      signals.slice(0, 5).forEach((s, i) => {
        console.log(`   ${i + 1}. ${s.asset} ${s.direction}: Confluence ${s.confluenceScore}, R:R ${s.riskReward.toFixed(2)}`);
      });

      // Process best signal
      for (const signal of signals) {
        const result = await this.processSignal(signal);
        if (result.executed) {
          break; // Only execute one trade per scan (can be configured)
        }
      }

    } catch (error) {
      console.error('❌ Error in scan:', error.message);
      this.logEvent('SCAN_ERROR', { error: error.message });
    }
  }

  // Process a single signal
  async processSignal(signal) {
    console.log(`\n📋 Processing ${signal.asset} ${signal.direction} signal...`);

    // Calculate position sizing
    const sizing = this.riskManager.calculatePositionSize(signal);
    
    if (!sizing.approved) {
      console.log(`⏸️ Signal rejected: ${sizing.reason}`);
      return { executed: false, reason: sizing.reason };
    }

    console.log(`\n💰 Position Sizing:`);
    console.log(`   Size: ${sizing.positionSize} ${signal.asset}`);
    console.log(`   Value: $${sizing.positionValue}`);
    console.log(`   Risk: ${sizing.riskPercent}% ($${sizing.riskAmount})`);
    console.log(`   Leverage: ${sizing.leverage}x`);

    // Validate trade
    const validation = this.riskManager.validateTrade(signal, sizing);
    
    console.log(`\n✓ Risk Validation:`);
    validation.validations.forEach(v => {
      console.log(`   ${v.passed ? '✅' : '❌'} ${v.check}: ${v.message}`);
    });

    if (!validation.approved) {
      console.log(`\n⏸️ Trade not approved: ${validation.summary}`);
      return { executed: false, reason: validation.summary };
    }

    // Execute trade
    const result = await this.executor.openPosition(signal, sizing);

    if (result.success) {
      // Update portfolio
      this.riskManager.updatePortfolioOnEntry({
        positionValue: sizing.positionValue
      });

      this.logEvent('TRADE_EXECUTED', {
        asset: signal.asset,
        direction: signal.direction,
        size: sizing.positionSize,
        entry: signal.suggestedEntry,
        stop: signal.suggestedStop,
        confluence: signal.confluenceScore
      });

      return { executed: true, trade: result.trade };
    }

    return { executed: false, reason: result.error };
  }

  // Monitor open positions
  async monitorPositions() {
    const positions = this.executor.getOpenPositions();
    
    if (positions.length === 0) return;

    console.log(`\n📊 Monitoring ${positions.length} open position(s)...`);

    for (const position of positions) {
      try {
        const currentPrice = await this.executor.getCurrentPrice(position.asset);
        
        if (!currentPrice) continue;

        // Check if should close
        const check = this.riskManager.shouldClosePosition(position, currentPrice);

        if (check.close) {
          console.log(`\n⚡ ${position.asset}: ${check.reason} at ${check.pnlPercent.toFixed(2)}%`);
          await this.executor.closePosition(position.id, check.reason);
          
          // Update portfolio
          const pnl = check.pnlPercent * position.position_size * position.entry_price / 100;
          this.riskManager.updatePortfolioOnExit(
            { positionValue: position.position_size * position.entry_price },
            pnl
          );
        } else if (check.moveStopToBE) {
          console.log(`\n📈 ${position.asset}: Moving stop to breakeven`);
          await this.executor.updateStopLoss(position.id, position.entry_price);
        } else if (check.partialClose) {
          console.log(`\n💰 ${position.asset}: Partial close at TP2`);
          // Implement partial close logic
        }

      } catch (error) {
        console.error(`Error monitoring ${position.asset}:`, error.message);
      }
    }
  }

  // Generate daily performance report
  generateDailyReport() {
    const stats = this.executor.getPerformanceStats();
    const portfolio = this.riskManager.getPortfolioSummary();

    console.log('\n╔════════════════════════════════════════════════════╗');
    console.log('║              DAILY PERFORMANCE REPORT              ║');
    console.log('╠════════════════════════════════════════════════════╣');
    console.log(`║  Total Trades: ${stats.totalTrades.toString().padEnd(36)}║`);
    console.log(`║  Win Rate: ${stats.winRate}%${''.padEnd(35 - stats.winRate.toString().length)}║`);
    console.log(`║  Total P&L: $${stats.totalPnl}${''.padEnd(33 - stats.totalPnl.toString().length)}║`);
    console.log(`║  Profit Factor: ${stats.profitFactor}${''.padEnd(33 - stats.profitFactor.toString().length)}║`);
    console.log(`║  Portfolio: ${portfolio.totalCapital}${''.padEnd(35 - portfolio.totalCapital.length)}║`);
    console.log('╚════════════════════════════════════════════════════╝\n');

    this.logEvent('DAILY_REPORT', { stats, portfolio });

    return { stats, portfolio };
  }

  // Stop the agent
  stop() {
    console.log('\n🛑 Stopping trading agent...');
    this.isRunning = false;
    this.logEvent('AGENT_STOPPED', { timestamp: new Date() });
  }

  // Log event
  logEvent(eventType, data) {
    try {
      db.prepare(`
        INSERT INTO event_log (event_type, data) VALUES (?, ?)
      `).run(eventType, JSON.stringify(data));
    } catch (error) {
      console.error('Error logging event:', error.message);
    }
  }

  // Get current status
  getStatus() {
    return {
      isRunning: this.isRunning,
      lastScan: this.lastScanTime,
      mode: config.mode,
      portfolio: this.riskManager.getPortfolioSummary(),
      openPositions: this.executor.getOpenPositions().length,
      performance: this.executor.getPerformanceStats()
    };
  }
}

// Main entry point
async function main() {
  const agent = new TradingAgent();
  
  // Handle graceful shutdown
  process.on('SIGINT', () => {
    agent.stop();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    agent.stop();
    process.exit(0);
  });

  // Initialize and run
  const initialized = await agent.initialize();
  
  if (initialized) {
    await agent.run();
  } else {
    console.error('❌ Failed to initialize agent');
    process.exit(1);
  }
}

export { TradingAgent };
export default main;

// Run if executed directly
main().catch(console.error);
