# Nexxore Services
# ==================
# Dexscreener Data Integration + Market Intelligence Agent

## Architecture

```
services/
├── market-data/          # Dexscreener API integration (port 3860)
│   ├── main.py           # FastAPI entry point
│   ├── config.py         # Configuration + cache TTLs
│   ├── models.py         # PairData, MarketEvent, TopMover
│   ├── dexscreener/
│   │   └── client.py     # Async Dexscreener client + rate limiting
│   ├── cache/
│   │   └── redis_cache.py # Redis cache with in-memory fallback
│   ├── storage/
│   │   └── database.py   # SQLite time-series storage
│   ├── poller/
│   │   └── worker.py     # Background polling (10s interval)
│   └── api/
│       └── routes.py     # REST API endpoints
│
├── signal-engine/        # Market Intelligence Agent (port 3861)
│   ├── main.py           # FastAPI + WebSocket entry point
│   ├── config.py         # Signal thresholds + scoring weights
│   ├── models.py         # Signal, ScoredToken, SignalEvent
│   ├── pipeline/
│   │   └── data_pipeline.py  # Rolling window data ingestion
│   ├── signals/
│   │   ├── momentum.py   # Signal 1: Momentum Spike
│   │   ├── liquidity.py  # Signal 2: Liquidity Inflow
│   │   ├── volume.py     # Signal 3: Volume Breakout
│   │   └── new_pair.py   # Signal 4: New Pair Detection
│   ├── scoring/
│   │   └── scorer.py     # Composite 0-100 scoring system
│   ├── api/
│   │   └── routes.py     # Signal query endpoints
│   └── streaming/
│       └── websocket.py  # WebSocket live signal feed
│
└── test_services.py      # Integration tests
```

## Quick Start

### 1. Install Dependencies
```bash
cd nexxore-
pip install -r services/market-data/requirements.txt
pip install -r services/signal-engine/requirements.txt
```

### 2. Start Market Data Service (port 3860)
```bash
python -m services.market-data.main
# or
uvicorn services.market-data.main:app --port 3860 --reload
```

### 3. Start Signal Engine (port 3861)
```bash
python -m services.signal-engine.main
# or
uvicorn services.signal-engine.main:app --port 3861 --reload
```

### 4. Run Tests
```bash
python services/test_services.py
```

## API Endpoints

### Market Data Service (:3860)
| Endpoint | Description |
|----------|-------------|
| `GET /api/v1/health` | Health check |
| `GET /api/v1/stats` | Service statistics |
| `GET /api/v1/pairs/top-movers/{chain}` | Top movers by chain |
| `GET /api/v1/pairs/top-movers` | Top movers all chains |
| `GET /api/v1/pairs/{chain}/{token}` | Token pair data |
| `GET /api/v1/pairs/info/{pair_address}` | Specific pair info |
| `GET /api/v1/search?q=SOL` | Search Dexscreener |
| `GET /api/v1/pairs/new` | New pairs |
| `GET /api/v1/pairs/liquidity-changes` | Liquidity changes |
| `GET /api/v1/pairs/history/{pair_address}` | Price history |

### Signal Engine (:3861)
| Endpoint | Description |
|----------|-------------|
| `GET /api/v1/health` | Health check |
| `GET /api/v1/stats` | Service statistics |
| `GET /api/v1/signals/top` | Top scored tokens |
| `GET /api/v1/signals/strong-trades` | Score > 70 |
| `GET /api/v1/signals/watchlist` | Score 50-70 |
| `GET /api/v1/signals/{token}` | Token signal details |
| `GET /api/v1/signals/chain/{chain}` | Chain-specific signals |
| `WS /ws/signals/live` | Live signal feed |

## Signal Types

| Signal | Trigger | Weight |
|--------|---------|--------|
| **Momentum Spike** | price_5m > 5%, vol > 2x avg, liq > $500k | 0-40 pts |
| **Volume Breakout** | vol_1h > 3x 24h avg, > 20 txns | 0-30 pts |
| **Liquidity Inflow** | liq increase > 20% in 10 min | 0-20 pts |
| **New Pair** | age < 24h, liq > $100k | 0-10 pts |

## Scoring Classification
- **Score > 70**: Strong Trade
- **Score 50-70**: Watchlist
- **Score < 50**: Ignore

## Data Flow
```
Dexscreener API
    │
    ▼
[Market Data Service]  ──→  SQLite (snapshots)
    │                        Redis/In-Memory (cache)
    ▼
[Signal Engine]  ──→  Pipeline (rolling windows)
    │                  Signals (4 detectors)
    │                  Scorer (0-100 composite)
    ▼
REST API + WebSocket  ──→  Dashboard / Agents
```

## Environment Variables

### Market Data
| Variable | Default | Description |
|----------|---------|-------------|
| `REDIS_URL` | `redis://localhost:6379/0` | Redis connection |
| `CACHE_ENABLED` | `true` | Enable caching |
| `MARKET_DATA_PORT` | `3860` | Service port |
| `POLL_INTERVAL` | `10` | Poll interval (seconds) |

### Signal Engine
| Variable | Default | Description |
|----------|---------|-------------|
| `MARKET_DATA_URL` | `http://localhost:3860` | Market data service URL |
| `SIGNAL_ENGINE_PORT` | `3861` | Service port |
| `SIGNAL_POLL_INTERVAL` | `10` | Poll interval (seconds) |
