# Signal Engine

The Signal Engine is Nexxore's Market Intelligence Agent. It consumes real-time market data from the Market Data Agent and produces composite alpha trading signals using 4 independent detectors and a weighted scoring system.

---

## Overview

The Signal Engine runs as a standalone Python/FastAPI microservice on **port 3861**. It pulls data from the Market Data Agent (port 3860), maintains rolling time windows, runs 4 signal detectors on each data update, and combines results into a 0–100 composite score.

### Key Features

- **4 Alpha Signal Detectors** — Momentum, volume, liquidity, and new pair detection
- **Composite Scoring (0–100)** — Weighted combination of all signals with classification
- **Rolling Window Pipeline** — Maintains 5m, 15m, 1h, and 24h time windows per pair
- **Real-Time WebSocket** — Live signal feed at `/ws/signals/live`
- **REST API** — Query top signals, strong trades, watchlist, per-token, per-chain

---

## Signal Detectors

### 1. Momentum Spike (0–40 points)

Detects rapid price acceleration with volume confirmation.

| Parameter | Threshold |
|-----------|-----------|
| Price change (5m) | > 5% |
| Volume (5m) | > 2× rolling average |
| Minimum liquidity | > $500,000 |

**Strength breakdown:**
- Price movement magnitude: 40%
- Volume ratio (current vs average): 35%
- Liquidity depth (pool size): 25%

---

### 2. Volume Breakout (0–30 points)

Detects when hourly volume significantly exceeds historical average.

| Parameter | Threshold |
|-----------|-----------|
| Volume (1h) | > 3× average hourly volume from 24h |
| Minimum 24h volume | > $10,000 |
| Minimum transactions | > 20 in 1h |

**Strength breakdown:**
- Volume ratio (current vs historical): 45%
- Transaction velocity: 25%
- Buy pressure (buy ratio): 30%

---

### 3. Liquidity Inflow (0–20 points)

Detects significant capital entering a pool.

| Parameter | Threshold |
|-----------|-----------|
| Liquidity increase | > 20% in 10-minute window |
| Minimum current liquidity | > $50,000 |

**Strength breakdown:**
- Inflow magnitude: 50%
- Resulting pool size: 30%
- Speed of inflow: 20%

---

### 4. New Pair Detection (0–10 points)

Identifies newly created pairs with meaningful early traction.

| Parameter | Threshold |
|-----------|-----------|
| Pair age | < 24 hours |
| Minimum liquidity | > $100,000 |
| Minimum volume (1h) | > $5,000 |

**Strength breakdown:**
- Liquidity depth: 35%
- Early volume: 30%
- Freshness (newer = higher): 20%
- Transaction activity: 15%

---

## Scoring System

Each token receives a composite score from 0–100:

```
Total Score = momentum_score + volume_score + liquidity_score + new_pair_score
            = (0–40)        + (0–30)       + (0–20)          + (0–10)
```

### Weights

| Signal | Max Points | Weight |
|--------|-----------|--------|
| Momentum Spike | 40 | 40% |
| Volume Breakout | 30 | 30% |
| Liquidity Inflow | 20 | 20% |
| New Pair | 10 | 10% |

### Classification

| Score Range | Classification | Action |
|-------------|---------------|--------|
| **> 70** | 🟢 Strong Trade | High-confidence alpha opportunity |
| **50–70** | 🟡 Watchlist | Monitor for breakout confirmation |
| **< 50** | 🔴 Ignore | No actionable signal |

---

## Architecture

```
Market Data Agent (:3860)
    │
    ▼
┌────────────────────────────┐
│  Data Pipeline             │
│  HTTP poll every 10s       │
│  Rolling Windows per pair  │
│  (5m / 15m / 1h / 24h)    │
└──────────┬─────────────────┘
           │
    ┌──────┴──────────────────────┐
    │      │       │              │
    ▼      ▼       ▼              ▼
┌──────┐ ┌──────┐ ┌──────────┐ ┌──────┐
│Momnm │ │Volume│ │Liquidity │ │New   │
│Spike │ │Break │ │Inflow    │ │Pair  │
│0-40  │ │0-30  │ │0-20      │ │0-10  │
└──┬───┘ └──┬───┘ └────┬─────┘ └──┬───┘
   │        │          │           │
   └────────┴──────────┴───────────┘
           │
           ▼
┌────────────────────────────┐
│  Signal Scorer             │
│  Weighted composite 0-100  │
│  Classification engine     │
└──────────┬─────────────────┘
           │
    ┌──────┴──────┐
    │             │
    ▼             ▼
┌─────────┐  ┌──────────┐
│ REST    │  │ WebSocket│
│ API     │  │ Live Feed│
│ :3861   │  │ /ws/...  │
└─────────┘  └──────────┘
```

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/health` | Health check + uptime |
| `GET` | `/api/v1/stats` | Service statistics |
| `GET` | `/api/v1/signals/top` | Top scored tokens (limit param) |
| `GET` | `/api/v1/signals/strong-trades` | Tokens with score > 70 |
| `GET` | `/api/v1/signals/watchlist` | Tokens with score 50–70 |
| `GET` | `/api/v1/signals/{token_address}` | Signal details for specific token |
| `GET` | `/api/v1/signals/chain/{chain_id}` | Signals filtered by chain |
| `WS` | `/ws/signals/live` | Live signal WebSocket feed |

### WebSocket Messages

The `/ws/signals/live` endpoint broadcasts three types of messages:

| Type | Frequency | Content |
|------|-----------|---------|
| `signals_update` | Every 5s | Top signals summary |
| `signal_event` | Real-time | Individual signal detections |
| `heartbeat` | Every 30s | Keep-alive ping |

Client commands: send `ping` for pong, `top` for top signals, `stats` for service stats.

---

## Quick Start

```bash
# Install dependencies
pip install -r services/signal-engine/requirements.txt

# Start Market Data Agent first (required)
python -m services.market-data.main &

# Start Signal Engine
python -m services.signal-engine.main

# Or with uvicorn
uvicorn services.signal-engine.main:app --port 3861 --reload
```

---

## Data Flow

```
Dexscreener → Market Data Agent → Signal Engine → REST API + WebSocket
                                       │
                                       ├── On-Chain Analyst (research.html)
                                       ├── Execution Agents
                                       └── External Consumers
```

---

## Configuration

| Parameter | Default | Description |
|-----------|---------|-------------|
| `MARKET_DATA_URL` | `http://localhost:3860` | Market Data Agent URL |
| `SIGNAL_ENGINE_PORT` | `3861` | Signal Engine port |
| `SIGNAL_POLL_INTERVAL` | `10` | Pipeline poll interval (seconds) |
| Momentum price threshold | 5% | Price change 5m to trigger |
| Volume breakout multiplier | 3× | Volume vs 24h average |
| Liquidity inflow threshold | 20% | Liquidity increase in 10 min |
| New pair max age | 24h | Maximum pair age |
| Strong trade threshold | >70 | Score for strong trade |
| Watchlist threshold | 50–70 | Score for watchlist |

---

## Integration

The Signal Engine feeds into:

| Consumer | Integration Method |
|----------|-------------------|
| On-Chain Analyst | REST API (Signals tab in research.html) |
| Execution Agents | REST + WebSocket |
| Strategy Builder | Signal consumption via API |
| Telegram Alerts | Webhook on strong_trade events (planned) |

---

## Next Steps

- [Market Data Agent →](./market-data.md)
- [On-Chain Analyst →](./research-agent.md)
- [Agent Overview →](./overview.md)
