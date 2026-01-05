# Crypto Research Analyst Bot

> **Autonomous crypto trading research system** that ingests multi-source market data, applies advanced feature engineering and ML models, and generates ranked, confidence-scored trade setups.

## 🎯 Overview

This is NOT a backtester or execution engine - it's an **intelligence layer** that:
- Collects market data from 5+ sources (exchanges, derivatives, on-chain, social, news)
- Engineers 100+ features per asset using technical analysis and ML techniques
- Runs ensemble ML models (XGBoost/LightGBM, HMM regime detection)
- Generates confidence-scored trade setups with entry/stop/target levels
- Serves real-time insights via REST API and WebSocket

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        DATA SOURCES                              │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐   │
│  │ Binance │ │ Bybit   │ │Coinglass│ │DefiLlama│ │CryptoPanic│  │
│  └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘   │
└───────┼──────────┼──────────┼──────────┼──────────┼────────────┘
        │          │          │          │          │
        ▼          ▼          ▼          ▼          ▼
┌─────────────────────────────────────────────────────────────────┐
│                     DATA COLLECTORS                              │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐               │
│  │ MarketData  │ │ Derivatives │ │ OnChain     │               │
│  │ Collector   │ │ Collector   │ │ Collector   │               │
│  └─────────────┘ └─────────────┘ └─────────────┘               │
│  ┌─────────────┐ ┌─────────────┐                               │
│  │ Social      │ │ News        │  ← Rate Limited + Retry Logic │
│  │ Collector   │ │ Collector   │                               │
│  └─────────────┘ └─────────────┘                               │
└─────────────────────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────────────────┐
│                     TIMESCALEDB                                  │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐   │
│  │market_data │ │derivatives │ │onchain_data│ │social_data │   │
│  │(hypertable)│ │(hypertable)│ │(hypertable)│ │(hypertable)│   │
│  └────────────┘ └────────────┘ └────────────┘ └────────────┘   │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐                  │
│  │news_events │ │feature_store│ │trade_setups│ ← 90 day raw   │
│  └────────────┘ └────────────┘ └────────────┘   retention      │
└─────────────────────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────────────────┐
│                  FEATURE ENGINEERING                             │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Price Features: returns, volatility, trend, range       │   │
│  │ Momentum: RSI, Stochastic, CCI, Williams %R             │   │
│  │ Volume: OBV, relative volume, price-volume correlation  │   │
│  │ Regime: HMM-based + rule-based detection                │   │
│  │ Order Flow: funding, OI, long/short ratio, liquidations │   │
│  │ Cross-Asset: BTC correlation, beta, relative strength   │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────────────────┐
│                     ML MODELS                                    │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐               │
│  │ Direction   │ │ Breakout    │ │ Volatility  │               │
│  │ Model       │ │ Model       │ │ Model       │               │
│  │ (LightGBM)  │ │ (LightGBM)  │ │ (LightGBM)  │               │
│  └─────────────┘ └─────────────┘ └─────────────┘               │
│  ┌─────────────────────────────────────────────┐               │
│  │        Ensemble Predictor                    │               │
│  │  Combines predictions + computes scores      │               │
│  └─────────────────────────────────────────────┘               │
└─────────────────────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────────────────┐
│                  SIGNAL GENERATOR                                │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ - Combines ML predictions + technical features           │   │
│  │ - Calculates entry/stop/target levels                    │   │
│  │ - Computes confidence & quality scores                   │   │
│  │ - Generates supporting factors & risk warnings           │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────────────────┐
│                     FASTAPI SERVER                               │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ GET  /api/v1/setups          - Active trade setups      │   │
│  │ GET  /api/v1/predictions/:sym - ML predictions          │   │
│  │ GET  /api/v1/market/overview - Market summary           │   │
│  │ WS   /ws/setups              - Real-time updates        │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## 🚀 Quick Start

### Prerequisites
- Docker & Docker Compose
- 8GB+ RAM recommended
- API keys (optional but recommended):
  - Binance/Bybit API keys
  - Coinglass API key
  - Glassnode API key
  - Twitter API Bearer Token

### 1. Clone and Configure

```bash
# Navigate to research-bot directory
cd research-bot

# Copy environment template
cp .env.example .env

# Edit .env with your API keys
vim .env
```

### 2. Start Services

```bash
# Start all services
docker-compose up -d

# Check logs
docker-compose logs -f research-bot

# Check health
curl http://localhost:8001/health
```

### 3. Access the API

```bash
# Get active trade setups
curl http://localhost:8001/api/v1/setups

# Get market overview
curl http://localhost:8001/api/v1/market/overview

# Get predictions for a symbol
curl http://localhost:8001/api/v1/predictions/BTCUSDT
```

## 📡 API Endpoints

### Trade Setups

```
GET /api/v1/setups
```
Returns ranked trade setups with confidence scores.

Query Parameters:
- `min_confidence` (float): Minimum confidence threshold (default: 0.5)
- `direction` (string): Filter by LONG or SHORT
- `symbol` (string): Filter by specific symbol
- `limit` (int): Max results (default: 20)

Response:
```json
{
  "setups": [
    {
      "id": 1,
      "symbol": "BTCUSDT",
      "direction": "LONG",
      "setup_type": "breakout",
      "current_price": 67500.00,
      "entry_min": 67300.00,
      "entry_max": 67700.00,
      "invalidation": 66500.00,
      "target_1": 69500.00,
      "target_2": 72000.00,
      "confidence_score": 0.75,
      "risk_reward_ratio": 2.5,
      "quality_score": 0.82,
      "regime": "trending_up",
      "supporting_factors": {
        "technical": ["RSI oversold (28.5)", "MACD bullish crossover"],
        "ml_signals": ["direction: UP (78%)", "breakout: BREAKOUT (65%)"],
        "summary": "Strong bullish setup with multiple confirming signals"
      },
      "risk_factors": {
        "warnings": ["High volatility environment"],
        "volatility_risk": "high"
      },
      "created_at": "2024-01-15T10:30:00Z",
      "status": "ACTIVE"
    }
  ],
  "count": 1,
  "timestamp": "2024-01-15T10:35:00Z"
}
```

### Market Overview

```
GET /api/v1/market/overview
```

Returns aggregated market statistics and top opportunities.

### ML Predictions

```
GET /api/v1/predictions/{symbol}
```

Returns detailed ML predictions and features for a symbol.

### WebSocket Real-time Updates

```
WS /ws/setups
```

Connect for real-time setup notifications.

## 🧠 ML Models

### Direction Model
- **Algorithm**: LightGBM multi-class classifier
- **Target**: Price direction (UP/DOWN/NEUTRAL) over N candles
- **Features**: 80+ technical and order flow features
- **Output**: Class probabilities with confidence

### Breakout Model
- **Algorithm**: LightGBM binary classifier
- **Target**: Significant price move (>2%) in horizon
- **Features**: Range, volatility compression, volume patterns
- **Output**: Breakout probability

### Volatility Model
- **Algorithm**: LightGBM multi-class classifier
- **Target**: Future volatility bucket (very_low to very_high)
- **Features**: Historical volatility, ATR, regime indicators
- **Output**: Volatility regime prediction

### Regime Detection
- **Method**: HMM (Hidden Markov Model) + rule-based
- **States**: trending_up, trending_down, ranging, high_vol, low_vol, breakout
- **Features**: Returns, volatility, trend indicators

## 📊 Feature Categories

| Category | Features | Description |
|----------|----------|-------------|
| **Price** | returns_1/5/15/60/240, volatility_20/50/100, parkinson_vol | Multi-horizon returns and volatility measures |
| **Trend** | ma_7/21/50/200, ema_12/26, macd, macd_signal, adx | Moving averages and trend strength |
| **Momentum** | rsi_7/14/21, stoch_k/d, cci, williams_r | Oscillators and momentum indicators |
| **Volume** | volume_ma_10/20, obv, price_volume_corr | Volume analysis and flow |
| **Range** | range_position_20/50, range_width, dist_from_high/low | Price position within ranges |
| **Order Flow** | funding_rate, oi_change, ls_ratio, liquidations | Derivatives market data |
| **Cross-Asset** | btc_correlation, btc_beta, relative_strength | Correlation and relative performance |
| **Regime** | market_regime (HMM-based) | Current market state classification |

## 📁 Project Structure

```
research-bot/
├── docker-compose.yml      # Multi-service orchestration
├── Dockerfile              # Python application container
├── requirements.txt        # Python dependencies
├── .env.example           # Environment variables template
├── database/
│   └── init/
│       └── 001_schema.sql  # TimescaleDB schema
└── src/
    ├── main.py            # Main orchestrator
    ├── api/
    │   └── api.py         # FastAPI server
    ├── collectors/
    │   ├── base_collector.py
    │   ├── market_data_collector.py
    │   ├── derivatives_collector.py
    │   ├── onchain_collector.py
    │   ├── social_collector.py
    │   └── news_collector.py
    ├── features/
    │   └── feature_engineering.py
    ├── models/
    │   └── ml_models.py
    └── signals/
        └── signal_generator.py
```

## 🔧 Configuration

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `DB_HOST` | TimescaleDB host | Yes |
| `DB_PASSWORD` | Database password | Yes |
| `REDIS_URL` | Redis connection URL | Yes |
| `BINANCE_API_KEY` | Binance API key | No |
| `COINGLASS_API_KEY` | Coinglass API key | No |
| `GLASSNODE_API_KEY` | Glassnode API key | No |
| `TWITTER_BEARER_TOKEN` | Twitter API token | No |

### Collection Intervals

Default intervals (configurable in main.py):
- Market data: 1 minute
- Derivatives: 5 minutes
- On-chain: 1 hour
- Social: 30 minutes
- News: 15 minutes
- Feature computation: 5 minutes
- Signal generation: 5 minutes

## 📈 Monitoring

### Grafana Dashboard
Access at http://localhost:3001 (default admin/admin)

Metrics include:
- Data freshness by source
- Collection success/failure rates
- Active setup counts
- Model prediction accuracy
- API latency

### Health Check

```bash
curl http://localhost:8001/health
```

```json
{
  "status": "healthy",
  "database": "connected",
  "redis": "connected",
  "collectors": {
    "market_data": "idle",
    "derivatives": "idle",
    "onchain": "idle"
  }
}
```

## 🛠️ Development

### Run Locally (without Docker)

```bash
# Install dependencies
pip install -r requirements.txt

# Set environment variables
export DB_HOST=localhost
export REDIS_URL=redis://localhost:6379

# Run the bot
python src/main.py

# Run API server
uvicorn src.api.api:app --host 0.0.0.0 --port 8001 --reload
```

### Run Tests

```bash
pytest tests/ -v
```

## 📝 License

MIT License - see LICENSE file

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## ⚠️ Disclaimer

This software is for educational and research purposes only. It is NOT financial advice. Trading cryptocurrencies involves significant risk. Always do your own research and never invest more than you can afford to lose.
