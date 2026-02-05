# PRED Agent - Prediction Market Intelligence System

## Overview

PRED Agent is a comprehensive prediction market intelligence system that combines AI-powered forecasting, fair value calculation, cross-platform arbitrage detection, and risk-managed execution.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           PRED AGENT ARCHITECTURE                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                     INTELLIGENCE LAYER                                │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │   │
│  │  │   GPT-4o    │  │ Claude 3.5  │  │ Gemini Pro  │  │ Perplexity  │  │   │
│  │  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  │   │
│  │         │                │                │                │         │   │
│  │         └────────────────┼────────────────┼────────────────┘         │   │
│  │                          ▼                ▼                          │   │
│  │                 ┌─────────────────────────────────┐                  │   │
│  │                 │   AI CONSENSUS ENGINE           │                  │   │
│  │                 │   (Dynamic Brier Weighting)     │                  │   │
│  │                 └───────────────┬─────────────────┘                  │   │
│  └─────────────────────────────────┼────────────────────────────────────┘   │
│                                    │                                         │
│                                    ▼                                         │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                       MARKET LAYER                                    │   │
│  │                                                                       │   │
│  │  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐   │   │
│  │  │  FAIR VALUE      │  │  ARBITRAGE       │  │  NEWS IMPACT     │   │   │
│  │  │  CALCULATOR      │  │  SCANNER         │  │  ENGINE          │   │   │
│  │  │                  │  │                  │  │                  │   │   │
│  │  │  • Edge Detect   │  │  • Polymarket    │  │  • Sentiment     │   │   │
│  │  │  • Kelly Sizing  │  │  • Kalshi        │  │  • Entity NER    │   │   │
│  │  │  • EV Calc       │  │  • Manifold      │  │  • Impact Score  │   │   │
│  │  └────────┬─────────┘  └────────┬─────────┘  └────────┬─────────┘   │   │
│  └───────────┼─────────────────────┼─────────────────────┼──────────────┘   │
│              │                     │                     │                   │
│              └─────────────────────┼─────────────────────┘                   │
│                                    ▼                                         │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                      EXECUTION LAYER                                  │   │
│  │                                                                       │   │
│  │  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐   │   │
│  │  │  RISK ENGINE     │  │  PORTFOLIO       │  │  ORDER           │   │   │
│  │  │                  │  │  TRACKER         │  │  PROCESSOR       │   │   │
│  │  │  • Drawdown Chk  │  │  • Position Mgmt │  │  • Validation    │   │   │
│  │  │  • Position Lim  │  │  • P&L Tracking  │  │  • Execution     │   │   │
│  │  │  • Circuit Brkr  │  │  • Risk Metrics  │  │  • Callbacks     │   │   │
│  │  └──────────────────┘  └──────────────────┘  └──────────────────┘   │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Components

### 1. Intelligence Engine (`intelligence/consensus_engine.py`)

6-model AI consensus system with dynamic weighting:

- **Models**: GPT-4o, Claude 3.5, Gemini Pro, Perplexity, Mistral, DeepSeek
- **Weighting**: Dynamic weights based on rolling Brier scores
- **Output**: Consensus probability, confidence score, recommendation

```python
from intelligence.consensus_engine import AIConsensusEngine

engine = AIConsensusEngine(api_keys={...})
result = await engine.get_consensus(
    question="Will Bitcoin reach $150k by July 2026?",
    context="Current price: $98,500..."
)

print(f"Fair probability: {result.fair_probability:.1%}")
print(f"Recommendation: {result.recommendation}")
```

### 2. Fair Value Calculator (`market/fair_value.py`)

Edge detection and optimal bet sizing:

- **Fair Value**: Uncertainty-adjusted probability
- **Edge**: Difference between fair value and market price
- **Kelly Criterion**: Optimal position sizing
- **Risk-Adjusted**: Accounts for liquidity, time, volume

```python
from market.fair_value import FairValueCalculator, MarketData

calc = FairValueCalculator(bankroll=10000, risk_tolerance=0.5)

analysis = calc.analyze_edge(
    fair_value=0.58,
    market_data=market_data,
    consensus_confidence=0.72,
    model_dispersion=0.08
)

print(f"Edge: {analysis.edge:.1%}")
print(f"Kelly fraction: {analysis.kelly_fraction:.1%}")
print(f"Recommended size: ${analysis.recommended_size:,.2f}")
```

### 3. Arbitrage Scanner (`market/arbitrage_scanner.py`)

Cross-platform price discovery:

- **Platforms**: Polymarket, Kalshi, Manifold, Metaculus, PredictIt
- **Event Matching**: Semantic similarity for cross-platform linking
- **Spread Calculation**: Gross and net (after fees) spread

```python
from market.arbitrage_scanner import ArbitrageScanner

scanner = ArbitrageScanner()
opportunities = await scanner.run_scan()

for opp in opportunities:
    print(f"Buy {opp.buy_platform.value} @ {opp.buy_price:.1%}")
    print(f"Sell {opp.sell_platform.value} @ {opp.sell_price:.1%}")
    print(f"Net spread: {opp.net_spread:.1%}")
```

### 4. News Impact Engine (`market/news_impact.py`)

Real-time sentiment analysis:

- **Sources**: RSS feeds, news APIs, social media
- **Sentiment**: Rule-based + LLM analysis
- **Impact**: Probability shift estimation
- **Alerts**: High-impact news notifications

```python
from market.news_impact import NewsImpactEngine, MarketEvent

engine = NewsImpactEngine()
engine.track_event(MarketEvent(
    event_id="btc150k",
    question="Will BTC reach $150k?",
    keywords=["bitcoin", "btc", "crypto"],
    current_probability=0.45
))

impacts = await engine.scan_for_impacts()
alerts = engine.generate_alerts(impacts)
```

### 5. Execution Engine (`execution/risk_engine.py`)

Risk-managed order processing:

- **Risk Checks**: Drawdown, position limits, daily loss, correlation
- **Circuit Breaker**: Auto-pause on excessive losses
- **Portfolio Tracking**: Real-time P&L, metrics
- **Order Processing**: Validation, execution, callbacks

```python
from execution.risk_engine import ExecutionEngine, Order

engine = ExecutionEngine(
    initial_capital=10000,
    risk_limits=RiskLimits(max_drawdown_pct=0.15)
)

order = Order(
    event_id="btc150k",
    side="YES",
    size_usd=500,
    price=0.45
)

await engine.submit_order(order)
status = engine.get_status()
```

## API Endpoints

### Prediction
- `POST /api/v1/predict` - Get AI consensus prediction
- `POST /api/v1/edge` - Calculate edge and Kelly sizing

### Arbitrage
- `GET /api/v1/arbitrage` - Scan for arbitrage opportunities

### News
- `POST /api/v1/news/track` - Track an event for news impacts
- `GET /api/v1/news/scan` - Scan news for market impacts

### Execution
- `GET /api/v1/portfolio` - Get portfolio status
- `POST /api/v1/orders` - Submit a trade order

### Real-time
- `WebSocket /ws` - Real-time updates stream

## Quick Start

### 1. Install Dependencies

```bash
cd backend/services/pred
pip install -r requirements.txt
```

### 2. Set Environment Variables

```bash
export OPENAI_API_KEY="sk-..."
export ANTHROPIC_API_KEY="sk-ant-..."
export KALSHI_API_KEY="..."
```

### 3. Run the Server

```bash
python main.py
# or
uvicorn main:app --reload --port 8000
```

### 4. Test the API

```bash
# Get prediction
curl -X POST http://localhost:8000/api/v1/predict \
  -H "Content-Type: application/json" \
  -d '{"question": "Will Bitcoin reach $150k by July 2026?", "market_price": 0.42}'

# Scan arbitrage
curl http://localhost:8000/api/v1/arbitrage

# Get portfolio
curl http://localhost:8000/api/v1/portfolio
```

## Docker Deployment

```bash
docker-compose up -d
```

Services:
- `intelligence-engine`: 8001
- `market-engine`: 8002
- `execution-engine`: 8003
- `gateway`: 8000 (main API)
- `timescaledb`: 5433
- `redis`: 6380

## Risk Management

### Configurable Limits

```python
RiskLimits(
    max_drawdown_pct=0.15,      # 15% max drawdown
    max_daily_loss_pct=0.05,    # 5% max daily loss
    max_position_size_pct=0.10, # 10% max single position
    max_total_exposure_pct=0.50,# 50% max total exposure
    max_correlation_exposure=0.30, # 30% in correlated events
    cooldown_after_loss_hours=4 # 4h cooldown after big loss
)
```

### Circuit Breaker

Automatically activates when:
- Drawdown exceeds limit
- Daily loss exceeds limit

During circuit breaker:
- All new orders rejected
- Existing positions monitored
- Auto-resumes after cooldown

## Performance

- **Consensus Latency**: ~2-5 seconds (parallel LLM calls)
- **Arbitrage Scan**: ~10-30 seconds (all platforms)
- **News Scan**: ~5-10 seconds
- **Order Processing**: <100ms (after approval)

## Files

```
backend/services/pred/
├── main.py                      # FastAPI entry point
├── docker-compose.yml           # Container orchestration
├── requirements.txt             # Python dependencies
├── README.md                    # This file
│
├── intelligence/
│   ├── __init__.py
│   └── consensus_engine.py      # 6-model AI consensus
│
├── market/
│   ├── __init__.py
│   ├── fair_value.py           # Edge & Kelly calculator
│   ├── arbitrage_scanner.py    # Cross-platform scanner
│   └── news_impact.py          # Sentiment analysis
│
├── execution/
│   ├── __init__.py
│   └── risk_engine.py          # Risk management
│
└── database/
    └── init.sql                # TimescaleDB schema
```

## License

MIT License - See LICENSE file
