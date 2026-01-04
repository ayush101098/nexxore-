/**
 * Signal Tracking Runner
 * 
 * Integrates alpha detection with signal tracking and mock trading:
 * - Runs alpha scans
 * - Records signals to database
 * - Auto-executes high-confidence signals
 * - Updates position prices
 * - Generates performance reports
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const AlphaDetectionAgent = require('./agent');
const { SignalTracker } = require('../shared/signalTracker');
const { MockTradingEngine } = require('../shared/mockTradingEngine');
const { PerformanceAnalytics } = require('../shared/performanceAnalytics');
const { DataFetcher } = require('../shared/dataSources');

class SignalTrackingRunner {
  constructor(config = {}) {
    this.config = {
      scanIntervalMs: 5 * 60 * 1000,       // 5 minutes
      priceUpdateIntervalMs: 60 * 1000,     // 1 minute
      reportIntervalMs: 60 * 60 * 1000,     // 1 hour
      autoExecuteMinScore: 75,              // Auto-execute signals with 75+ score
      autoExecuteEnabled: config.autoExecute || false,
      ...config
    };

    // Initialize components
    this.alphaAgent = new AlphaDetectionAgent({
      minAlphaScore: 40,
      apiKeys: {
        defillamaKey: process.env.DEFILLAMA_API_KEY,
        anthropicKey: process.env.ANTHROPIC_API_KEY
      }
    });

    this.signalTracker = new SignalTracker({
      supabaseUrl: process.env.SUPABASE_URL,
      supabaseKey: process.env.SUPABASE_ANON_KEY
    });

    this.tradingEngine = new MockTradingEngine({
      supabaseUrl: process.env.SUPABASE_URL,
      supabaseKey: process.env.SUPABASE_ANON_KEY,
      initialCapital: 100000,
      maxPositionSize: 10000
    });

    this.analytics = new PerformanceAnalytics({
      supabaseUrl: process.env.SUPABASE_URL,
      supabaseKey: process.env.SUPABASE_ANON_KEY
    });

    this.dataFetcher = new DataFetcher();

    this.intervals = {};
    this.isRunning = false;
  }

  /**
   * Start the signal tracking system
   */
  async start() {
    if (this.isRunning) {
      console.log('⚠️  Signal tracking already running');
      return;
    }

    console.log('🚀 Starting Signal Tracking System...');
    this.isRunning = true;

    // Initial run
    await this.runAlphaScan();
    await this.updatePositionPrices();

    // Schedule recurring tasks
    this.intervals.scan = setInterval(
      () => this.runAlphaScan(),
      this.config.scanIntervalMs
    );

    this.intervals.priceUpdate = setInterval(
      () => this.updatePositionPrices(),
      this.config.priceUpdateIntervalMs
    );

    this.intervals.report = setInterval(
      () => this.generateReport(),
      this.config.reportIntervalMs
    );

    // Expire old signals every hour
    this.intervals.expire = setInterval(
      () => this.signalTracker.expireOldSignals(),
      60 * 60 * 1000
    );

    console.log('✅ Signal Tracking System started');
    console.log(`   📊 Scan interval: ${this.config.scanIntervalMs / 1000}s`);
    console.log(`   💰 Price updates: ${this.config.priceUpdateIntervalMs / 1000}s`);
    console.log(`   🤖 Auto-execute: ${this.config.autoExecuteEnabled ? 'ON' : 'OFF'}`);
  }

  /**
   * Stop the system
   */
  stop() {
    console.log('🛑 Stopping Signal Tracking System...');
    
    Object.values(this.intervals).forEach(interval => {
      clearInterval(interval);
    });
    this.intervals = {};
    this.isRunning = false;

    console.log('✅ Signal Tracking System stopped');
  }

  /**
   * Run alpha scan and track signals
   */
  async runAlphaScan() {
    console.log('\n🔍 Running alpha scan...');
    
    try {
      // Get alpha opportunities
      const scanResult = await this.alphaAgent.scanForAlpha();
      const opportunities = scanResult.alphaOpportunities || [];

      console.log(`   Found ${opportunities.length} opportunities`);

      // Record each signal
      const recordedSignals = [];
      for (const opp of opportunities) {
        try {
          // Enrich signal with trading parameters
          const enrichedSignal = await this.enrichSignalForTrading(opp);
          
          // Record to database
          const recorded = await this.signalTracker.recordSignal(enrichedSignal);
          recordedSignals.push(recorded);

          // Auto-execute if enabled and score is high enough
          if (this.config.autoExecuteEnabled && opp.alphaScore >= this.config.autoExecuteMinScore) {
            console.log(`   ⚡ Auto-executing: ${opp.protocol} (Score: ${opp.alphaScore})`);
            await this.tradingEngine.executeSignal(recorded);
          }
        } catch (err) {
          console.error(`   ❌ Failed to process ${opp.protocol}:`, err.message);
        }
      }

      console.log(`   ✅ Recorded ${recordedSignals.length} signals`);

      return recordedSignals;
    } catch (err) {
      console.error('❌ Alpha scan failed:', err.message);
      return [];
    }
  }

  /**
   * Enrich signal with trading parameters
   */
  async enrichSignalForTrading(signal) {
    // Try to get current price
    let entryPrice = null;
    try {
      if (signal.tokenAddress) {
        const priceData = await this.dataFetcher.prices.fetchTokenPrice(signal.tokenAddress);
        entryPrice = priceData?.price;
      }
    } catch (err) {
      // Use estimated price if available
    }

    // Calculate trading parameters based on alpha score
    const alphaScore = signal.alphaScore || 50;
    
    // Higher alpha score = more aggressive targets
    const targetMultiplier = 1 + (0.05 + (alphaScore / 100) * 0.15); // 5-20% target
    const stopMultiplier = 1 - (0.02 + ((100 - alphaScore) / 100) * 0.08); // 2-10% stop

    return {
      ...signal,
      protocol: signal.protocol,
      chain: signal.chain || 'ethereum',
      tokenSymbol: signal.tokenSymbol || signal.protocol,
      tokenAddress: signal.tokenAddress,
      type: signal.category || this.categorizeSignal(signal),
      action: 'BUY',
      alphaScore: signal.alphaScore,
      confidence: signal.confidence || this.calculateConfidence(signal),
      entryPrice: entryPrice || signal.estimatedPrice || 1,
      targetPrice: entryPrice ? entryPrice * targetMultiplier : null,
      stopLoss: entryPrice ? entryPrice * stopMultiplier : null,
      expectedReturn: ((targetMultiplier - 1) * 100).toFixed(2),
      apy: signal.metrics?.apy,
      timeHorizonHours: this.getTimeHorizon(signal),
      tvl: signal.metrics?.tvl,
      volume24h: signal.metrics?.volume24h,
      sentimentScore: signal.metrics?.sentiment,
      reasoning: signal.summary,
      newsContext: signal.newsArticles?.map(n => n.title).join('; ')
    };
  }

  /**
   * Categorize signal type
   */
  categorizeSignal(signal) {
    if (signal.metrics?.apy > 10) return 'yield';
    if (signal.scores?.tvlVolume > 0.7) return 'momentum';
    if (signal.scores?.liquidityFlow > 0.7) return 'liquidity';
    return 'momentum';
  }

  /**
   * Calculate confidence score
   */
  calculateConfidence(signal) {
    const scores = signal.scores || {};
    const scoreValues = Object.values(scores).filter(v => typeof v === 'number');
    
    if (scoreValues.length === 0) return 50;
    
    // Confidence = consistency of scores (lower std dev = higher confidence)
    const avg = scoreValues.reduce((a, b) => a + b, 0) / scoreValues.length;
    const variance = scoreValues.reduce((sum, s) => sum + Math.pow(s - avg, 2), 0) / scoreValues.length;
    const stdDev = Math.sqrt(variance);
    
    // Convert std dev to confidence (0 = 100%, 0.3 = 50%, 0.5+ = 30%)
    const confidence = Math.max(30, 100 - (stdDev * 200));
    return Math.round(confidence);
  }

  /**
   * Get time horizon based on signal type
   */
  getTimeHorizon(signal) {
    const category = signal.category || 'momentum';
    switch (category) {
      case 'yield': return 168; // 7 days for yield
      case 'arbitrage': return 4; // 4 hours for arbitrage
      case 'momentum': return 48; // 2 days for momentum
      default: return 24;
    }
  }

  /**
   * Update all position prices
   */
  async updatePositionPrices() {
    try {
      const positions = await this.tradingEngine.getOpenPositions();
      
      if (positions.length === 0) return;

      console.log(`📈 Updating prices for ${positions.length} positions...`);

      for (const position of positions) {
        try {
          // Get current price
          let currentPrice = null;
          
          if (position.token_address) {
            const priceData = await this.dataFetcher.prices.fetchTokenPrice(position.token_address);
            currentPrice = priceData?.price;
          }

          // Simulate price movement if no real price available
          if (!currentPrice) {
            currentPrice = this.simulatePriceMovement(position);
          }

          // Update position
          await this.tradingEngine.updatePositionPrice(position.position_id, currentPrice);
          
        } catch (err) {
          console.error(`   Failed to update ${position.position_id}:`, err.message);
        }
      }

      // Update unrealized P&L in portfolio
      await this.updatePortfolioUnrealizedPnl();
      
    } catch (err) {
      console.error('Price update failed:', err.message);
    }
  }

  /**
   * Simulate price movement for testing
   */
  simulatePriceMovement(position) {
    const entryPrice = parseFloat(position.entry_price);
    const hoursOpen = (Date.now() - new Date(position.entry_timestamp)) / (1000 * 60 * 60);
    
    // Random walk with slight upward bias (mimicking bull market)
    const volatility = 0.02; // 2% hourly volatility
    const drift = 0.001; // 0.1% hourly drift up
    
    const randomFactor = (Math.random() - 0.5) * 2 * volatility * Math.sqrt(hoursOpen);
    const driftFactor = drift * hoursOpen;
    
    return entryPrice * (1 + randomFactor + driftFactor);
  }

  /**
   * Update portfolio unrealized P&L
   */
  async updatePortfolioUnrealizedPnl() {
    const positions = await this.tradingEngine.getOpenPositions();
    const totalUnrealized = positions.reduce(
      (sum, p) => sum + parseFloat(p.unrealized_pnl || 0),
      0
    );

    // This would update the portfolio table
    // For now, just log it
    if (positions.length > 0) {
      console.log(`   💰 Total unrealized P&L: $${totalUnrealized.toFixed(2)}`);
    }
  }

  /**
   * Generate performance report
   */
  async generateReport() {
    console.log('\n📊 Generating performance report...');
    
    try {
      // Generate daily summary
      await this.analytics.generateDailySummary();
      
      // Get full report
      const report = await this.analytics.getFullReport();
      
      // Update strategy performance
      await this.analytics.getStrategyPerformance();
      await this.analytics.getProtocolPerformance();

      // Log summary
      console.log('\n════════════════════════════════════════');
      console.log('📈 PERFORMANCE SUMMARY');
      console.log('════════════════════════════════════════');
      console.log(`Total Trades: ${report.portfolio.totalTrades}`);
      console.log(`Win Rate: ${report.portfolio.winRate}%`);
      console.log(`Total P&L: $${report.portfolio.totalPnl}`);
      console.log(`Profit Factor: ${report.portfolio.profitFactor}`);
      console.log(`Sharpe Ratio: ${report.portfolio.sharpeRatio}`);
      console.log(`Best Trade: +$${report.portfolio.bestTrade}`);
      console.log(`Worst Trade: $${report.portfolio.worstTrade}`);
      console.log('════════════════════════════════════════\n');

      return report;
    } catch (err) {
      console.error('Report generation failed:', err.message);
    }
  }

  /**
   * Execute a specific signal manually
   */
  async executeSignal(signalId, options = {}) {
    const signal = await this.signalTracker.getSignal(signalId);
    if (!signal) {
      console.log(`Signal ${signalId} not found`);
      return null;
    }

    return await this.tradingEngine.executeSignal(signal, options);
  }

  /**
   * Close a position manually
   */
  async closePosition(positionId) {
    const positions = await this.tradingEngine.getOpenPositions();
    const position = positions.find(p => p.position_id === positionId);
    
    if (!position) {
      console.log(`Position ${positionId} not found`);
      return null;
    }

    return await this.tradingEngine.closePosition(positionId, parseFloat(position.current_price), 'MANUAL');
  }

  /**
   * Get current status
   */
  async getStatus() {
    const [signalStats, tradingStats, portfolioMetrics] = await Promise.all([
      this.signalTracker.getSignalStats(),
      this.tradingEngine.getTradingStats(),
      this.analytics.calculatePortfolioMetrics()
    ]);

    return {
      isRunning: this.isRunning,
      signals: signalStats,
      trading: tradingStats,
      performance: portfolioMetrics,
      config: {
        scanInterval: this.config.scanIntervalMs / 1000 + 's',
        autoExecute: this.config.autoExecuteEnabled,
        minAutoExecuteScore: this.config.autoExecuteMinScore
      }
    };
  }
}

// CLI interface
async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'start';

  const runner = new SignalTrackingRunner({
    autoExecute: args.includes('--auto-execute')
  });

  switch (command) {
    case 'start':
      await runner.start();
      
      // Keep running
      process.on('SIGINT', () => {
        runner.stop();
        process.exit(0);
      });
      break;

    case 'scan':
      // Single scan
      const signals = await runner.runAlphaScan();
      console.log(`\nRecorded ${signals.length} signals`);
      process.exit(0);
      break;

    case 'status':
      const status = await runner.getStatus();
      console.log('\n📊 System Status:');
      console.log(JSON.stringify(status, null, 2));
      process.exit(0);
      break;

    case 'report':
      await runner.generateReport();
      process.exit(0);
      break;

    case 'execute':
      const signalId = args[1];
      if (!signalId) {
        console.log('Usage: node run.js execute <signal_id>');
        process.exit(1);
      }
      await runner.executeSignal(signalId);
      process.exit(0);
      break;

    case 'close':
      const positionId = args[1];
      if (!positionId) {
        console.log('Usage: node run.js close <position_id>');
        process.exit(1);
      }
      await runner.closePosition(positionId);
      process.exit(0);
      break;

    default:
      console.log(`
Signal Tracking Runner

Usage:
  node run.js start [--auto-execute]  Start the tracking system
  node run.js scan                    Run a single alpha scan
  node run.js status                  Get current status
  node run.js report                  Generate performance report
  node run.js execute <signal_id>     Execute a specific signal
  node run.js close <position_id>     Close a position
      `);
      process.exit(0);
  }
}

// Export for programmatic use
module.exports = { SignalTrackingRunner };

// Run if called directly
if (require.main === module) {
  main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}
