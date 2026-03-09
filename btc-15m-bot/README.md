# Nexxore BTC 15-Minute Trading Bot

**NautilusTrader Architecture — 7-Phase System**

A production-grade algorithmic trading bot that predicts BTC 15-minute price movements and executes on Polymarket.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                   PHASE 1: DATA SOURCES                     │
│   ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐  │
│   │Liquidity │ │  Macro   │ │ Supply   │ │ Derivatives  │  │
│   │& Whale   │ │Sentiment │ │& Demand  │ │& Leverage    │  │
│   │ (30%)    │ │ (20%)    │ │ (25%)    │ │ (25%)        │  │
│   └────┬─────┘ └────┬─────┘ └────┬─────┘ └──────┬───────┘  │
│        └────────┬────┴────────────┴──────────────┘          │
│                 ▼                                            │
│        ┌─────────────────┐                                  │
│        │ PHASE 2: INGEST │  ← Normalize + Aggregate         │
│        │    Pipeline     │                                  │
│        └───────┬─────────┘                                  │
│                ▼                                            │
│        ┌─────────────────┐                                  │
│        │ PHASE 3: ENGINE │  ← NautilusTrader Core           │
│        │   (Nautilus)    │                                  │
│        └───────┬─────────┘                                  │
│                ▼                                            │
│        ┌─────────────────┐                                  │
│        │PHASE 4: STRATEGY│  ← 70% threshold → trade         │
│        │    (Brain)      │    Quarter-Kelly sizing           │
│        └───────┬─────────┘                                  │
│                ▼                                            │
│        ┌─────────────────┐                                  │
│        │PHASE 5: EXECUTE │  ← Polymarket YES/NO tokens      │
│        │   (Hands)       │    Paper or Live mode             │
│        └───────┬─────────┘                                  │
│                ▼                                            │
│   ┌────────────┴─────────────┐                              │
│   │PHASE 6: MONITOR          │  ← Dashboard on :3848        │
│   │  FastAPI + HTML           │                              │
│   └──────────────────────────┘                              │
│                ▼                                            │
│   ┌──────────────────────────┐                              │
│   │PHASE 7: LEARN            │  ← Adapt weights, regime     │
│   │  Performance tracking     │    detection, suggestions    │
│   └──────────────────────────┘                              │
└─────────────────────────────────────────────────────────────┘
```

## What Drives BTC Price in 15 Minutes?

| Channel | Weight | What It Tracks |
|---------|--------|----------------|
| **Liquidity & Whale** | 30% | Exchange netflow, whale txns, orderbook depth, liquidations |
| **Macro Sentiment** | 20% | Fear & Greed, news sentiment, dollar strength, risk appetite |
| **Supply & Demand** | 25% | RSI, OBV, Bollinger Bands, VWAP, momentum, S/R levels |
| **Derivatives** | 25% | Funding rate, open interest, long/short ratio, leverage heatmap |

When the composite signal crosses **70%** in either direction → the bot takes a position.

## Quick Start

```bash
# 1. Navigate to bot directory
cd btc-15m-bot

# 2. Create virtual environment
python -m venv .venv
source .venv/bin/activate

# 3. Install dependencies
pip install -r requirements.txt

# 4. Configure
cp .env.example .env
# Edit .env with your API keys (optional — works with free APIs)

# 5. Test channels (verify data flows)
python test_channels.py

# 6. Run in paper mode
python main.py

# 7. Run single test cycle
python main.py --test

# 8. Run backtest
python main.py --backtest

# 9. Show performance report
python main.py --report

# 10. Run live (real money — be careful!)
python main.py --live
```

## Dashboard

Once running, open: **http://localhost:3848**

Shows:
- Capital, P&L, win rate, drawdown
- 4 channel scores with live bars
- Composite signal score
- Recent signal log
- Auto-refreshes every 10 seconds

## File Structure

```
btc-15m-bot/
├── main.py                          # Entry point — ties all phases
├── config.py                        # Central configuration
├── test_channels.py                 # Test all 4 data channels
├── requirements.txt                 # Python dependencies
├── .env.example                     # Environment template
│
├── phase1_data/                     # EYES & EARS
│   ├── channel_liquidity_whale.py   # Exchange netflow, whale txns, orderbook
│   ├── channel_macro_sentiment.py   # Fear & Greed, news, DXY, risk appetite
│   ├── channel_supply_demand.py     # RSI, OBV, BB, VWAP, momentum, S/R
│   └── channel_derivatives.py       # Funding, OI, L/S ratio, leverage
│
├── phase2_ingestion/                # PLUMBING
│   └── pipeline.py                  # Normalize + weight + aggregate
│
├── phase3_nautilus/                  # ENGINE ROOM
│   └── engine.py                    # NautilusTrader integration
│
├── phase4_strategy/                 # BRAIN
│   └── brain.py                     # 70% threshold, Kelly sizing, SL/TP
│
├── phase5_execution/                # HANDS
│   └── executor.py                  # Polymarket CLOB + paper trading
│
├── phase6_monitoring/               # DASHBOARD
│   └── dashboard.py                 # FastAPI + HTML dashboard
│
├── phase7_learning/                 # MEMORY
│   └── learner.py                   # Channel accuracy, regime, adaptation
│
├── data/                            # Persistent storage
│   └── learning_state.json          # Saved learning data
│
└── logs/                            # Daily log files
    └── bot_YYYY-MM-DD.log
```

## Signal Flow (Every 15 Minutes)

```
1. SCAN    → All 4 channels fetch data in parallel (~3 seconds)
2. SCORE   → Each channel returns 0-100 score + direction
3. WEIGHT  → Pipeline applies weights: 30% + 20% + 25% + 25%
4. DECIDE  → If composite ≥ 70 → LONG, ≤ 30 → SHORT, else HOLD
5. SIZE    → Quarter-Kelly position sizing (capped at $500)
6. EXECUTE → Place order on Polymarket (YES=long, NO=short)
7. MONITOR → Dashboard updates in real-time
8. LEARN   → Record outcome, adapt weights for next cycle
```

## Risk Management

- **Signal threshold**: 70% (only trade high-conviction signals)
- **Position sizing**: Quarter-Kelly criterion
- **Max position**: $500 per trade
- **Max daily trades**: 20
- **Max daily loss**: $200
- **Stop-loss**: 0.3% from entry
- **Take-profit**: 0.5% from entry (scales with confidence)
- **Max hold time**: 30 minutes
- **Cooldown**: 2 minutes after a loss
- **Breakeven stop**: Moves SL to entry after 0.2% profit

## API Keys (Optional)

The bot works with **free public APIs** by default. Optional keys enhance data quality:

| Key | Source | What It Improves |
|-----|--------|-----------------|
| `COINGLASS_API_KEY` | coinglass.com | Exchange netflow, liquidation data |
| `GLASSNODE_API_KEY` | glassnode.com | On-chain whale data |
| `CRYPTOCOMPARE_API_KEY` | cryptocompare.com | News sentiment volume |
| `NEWSAPI_KEY` | newsapi.org | Additional news sources |
| `POLYMARKET_*` | polymarket.com | Live trading execution |

## Disclaimer

This bot is for **educational purposes**. Trading involves risk. The bot's strategy is not guaranteed to be profitable. Always start with paper trading and small amounts. Past performance does not indicate future results.
