# Nexxore Autonomous Trading Agent

A high-performance autonomous trading agent designed for consistent profits with a 70%+ win rate target.

## 🎯 Overview

This trading agent automatically:
- Generates alpha signals from multiple data sources
- Calculates optimal position sizes using Kelly Criterion
- Executes trades on Hyperliquid (paper or live)
- Manages risk with strict exposure limits
- Monitors positions and adjusts stops/targets
- Tracks performance metrics

## 🏗️ Architecture

```
trading-agent/
├── src/
│   ├── index.js              # Main orchestrator
│   ├── config.js             # Configuration
│   ├── alpha/
│   │   └── signalGenerator.js # Signal generation
│   ├── risk/
│   │   └── riskManager.js    # Position sizing & risk
│   ├── execution/
│   │   └── hyperliquid.js    # Trade execution
│   ├── data/
│   │   └── database.js       # SQLite data layer
│   └── api/
│       └── server.js         # Dashboard API
├── dashboard.html            # Web dashboard
└── package.json
```

## 🚀 Quick Start

### 1. Install Dependencies
```bash
cd trading-agent
npm install
```

### 2. Configure Environment
```bash
cp .env.example .env
# Edit .env with your settings
```

### 3. Run in Paper Trading Mode (Recommended)
```bash
npm start
```

### 4. View Dashboard
Open another terminal:
```bash
npm run dashboard
```
Then open `http://localhost:3001` in your browser.

## ⚙️ Configuration

### Environment Variables
```env
# Trading Mode
TRADING_MODE=paper          # 'paper' or 'live'

# Hyperliquid (for live trading)
HL_PRIVATE_KEY=your_key_here

# Risk Parameters
MAX_RISK_PER_TRADE=0.02     # 2% per trade
MAX_PORTFOLIO_EXPOSURE=0.20  # 20% max exposure
MAX_DRAWDOWN=0.15           # 15% max drawdown

# Signal Settings
MIN_CONFLUENCE_SCORE=75     # Minimum score to trade
```

### Assets Traded
- BTC, ETH, SOL, AVAX, ARB
- OP, MATIC, LINK, UNI, AAVE
- (Configurable in config.js)

## 📊 Signal Generation

Signals are scored using weighted confluence:
- **On-Chain (30%)**: Exchange flows, whale activity
- **Technical (25%)**: S/R levels, RSI, momentum
- **Derivatives (25%)**: Funding, OI, long/short ratio
- **Sentiment (20%)**: Fear & Greed Index

Minimum score to trade: **75/100**

## 💰 Risk Management

### Position Sizing
- Uses Half-Kelly Criterion for optimal sizing
- Maximum 2% risk per trade
- Capped at 20% portfolio exposure

### Stop Loss & Take Profit
- Stop Loss: Below S2 (longs) / Above R2 (shorts)
- TP1: R1/S1 (move stop to breakeven)
- TP2: R2/S2 (partial close 50%)
- TP3: Extended target (full close)

### Drawdown Protection
- Trading paused at 15% drawdown
- Maximum 5 concurrent positions

## 📈 Performance Tracking

The agent tracks:
- Win rate & profit factor
- Average win/loss
- Maximum drawdown
- Equity curve
- Daily/weekly/monthly P&L

## 🔧 API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/health` | Health check |
| `GET /api/portfolio` | Portfolio summary |
| `GET /api/positions` | Open positions |
| `GET /api/trades` | Trade history |
| `GET /api/signals` | Recent signals |
| `GET /api/performance` | Performance stats |
| `GET /api/events` | Event log |

## ⚠️ Disclaimer

This trading agent is for educational purposes. Cryptocurrency trading involves significant risk. Always:
- Start with paper trading
- Never risk more than you can afford to lose
- Monitor the agent regularly
- Understand the strategy before going live

## 📝 License

MIT
