// Configuration for the Trading Agent
import 'dotenv/config';

export const config = {
  // Trading Mode
  mode: process.env.TRADING_MODE || 'paper', // 'paper' or 'live'
  
  // Supported Assets
  assets: ['BTC', 'ETH', 'SOL', 'ARB', 'AVAX', 'LINK', 'BNB', 'XRP'],
  
  // Hyperliquid Config
  hyperliquid: {
    privateKey: process.env.HL_PRIVATE_KEY,
    walletAddress: process.env.HL_WALLET_ADDRESS,
    testnet: process.env.HL_TESTNET === 'true',
    baseUrl: process.env.HL_TESTNET === 'true' 
      ? 'https://api.hyperliquid-testnet.xyz'
      : 'https://api.hyperliquid.xyz'
  },
  
  // Risk Management
  risk: {
    maxRiskPerTrade: parseFloat(process.env.MAX_RISK_PER_TRADE) || 0.02,     // 2% per trade
    maxTotalExposure: parseFloat(process.env.MAX_TOTAL_EXPOSURE) || 0.20,    // 20% total
    maxDrawdown: parseFloat(process.env.MAX_DRAWDOWN) || 0.15,               // 15% max DD
    maxConcurrentPositions: 5,
    maxAssetExposure: 0.10,                                                   // 10% per asset
    dailyLossLimit: 0.05,                                                     // 5% daily
    maxCorrelation: 0.70
  },
  
  // Signal Thresholds
  signals: {
    minConfluenceScore: parseInt(process.env.MIN_CONFLUENCE_SCORE) || 75,
    minAlphaScore: 60,
    minWinRate: parseFloat(process.env.MIN_WIN_RATE) || 0.60,
    
    // Entry conditions
    entry: {
      nearSRThreshold: 0.02,        // Within 2% of S/R level
      rsiOversold: 30,
      rsiOverbought: 70,
      volumeMultiplier: 1.5         // 1.5x average volume
    },
    
    // Exit conditions
    exit: {
      tp1Portion: 0.40,             // 40% at TP1
      tp2Portion: 0.40,             // 40% at TP2
      tp3Portion: 0.20,             // 20% runner
      trailingStopATR: 2.0,         // 2 ATR trailing
      maxHoldTime: 24 * 60 * 60 * 1000,  // 24 hours
      breakEvenAfterTP1: true
    }
  },
  
  // Portfolio
  portfolio: {
    initialCapital: parseFloat(process.env.INITIAL_CAPITAL) || 10000
  },
  
  // Data Sources
  apis: {
    binance: 'https://api.binance.com/api/v3',
    coingecko: 'https://api.coingecko.com/api/v3',
    defillama: 'https://api.llama.fi',
    fearGreed: 'https://api.alternative.me/fng'
  },
  
  // Intervals
  intervals: {
    signalCheck: 5 * 60 * 1000,     // Check signals every 5 minutes
    positionMonitor: 30 * 1000,      // Monitor positions every 30 seconds
    riskCheck: 60 * 1000,            // Risk check every minute
    metricsUpdate: 60 * 60 * 1000    // Update metrics every hour
  },
  
  // Dashboard
  dashboard: {
    port: parseInt(process.env.DASHBOARD_PORT) || 3050
  },
  
  // Logging
  logging: {
    level: 'info',
    file: './logs/trading-agent.log'
  }
};

export default config;
