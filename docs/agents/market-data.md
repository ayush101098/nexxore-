# Market Data Agent

The Market Data Agent is Nexxore's Dexscreener integration layer. It ingests real-time DEX pair data across 5 chains, caches it locally, and exposes a clean REST API consumed by the Signal Engine and On-Chain Analyst.

---

## Overview

The Market Data Agent runs as a standalone Python/FastAPI microservice on **port 3860**. It polls the Dexscreener API every 10 seconds, detects market events (volume spikes, new pairs, liquidity shifts), and stores time-series snapshots in SQLite.

### Key Features

- **Async Dexscreener Client** — Rate-limited HTTP client (60 rpm slow / 300 rpm fast bucket)
- **Top Movers Discovery** — Aggregates boosted tokens + trending profiles into a ranked top movers list
- **New Pair Detection** — Surfaces pairs created within the last 24 hours with meaningful liquidity (>$100K)
- **Liquidity Monitoring** — Detects >20% liquidity changes within a 10-minute window
- **Token Search** — Full-text search across Dexscreener's pair database
- **Event Detection** — Emits events for volume spikes (2×), new pairs, liquidity shifts, and price surges (5% in 5 min)

---

## Architecture

```
Dexscreener API (free, no key required)
    │
    ├── /token-profiles/latest/v1  (slow, 60 rpm)
    ├── /token-boosts/latest/v1    (slow, 60 rpm)
    ├── /token-boosts/top/v1       (slow, 60 rpm)
    ├── /latest/dex/pairs/{chain}/{pair}  (fast, 300 rpm)
    ├── /latest/dex/search?q=...         (fast, 300 rpm)
    └── /tokens/v1/{chain}/{addresses}   (fast, 300 rpm, up to 30)
    │
    ▼
┌────────────────────────────┐
│  Dexscreener Client        │
│  (RateLimiter per bucket)  │
└──────────┬─────────────────┘
           │
    ┌──────┴───────┐
    │              │
    ▼              ▼
┌─────────┐  ┌──────────┐
│ Redis   │  │ SQLite   │
│ Cache   │  │ Storage  │
│ (LRU    │  │ (7-day   │
│ fallback)│ │ retention)│
└────┬────┘  └────┬─────┘
     │            │
     ▼            ▼
┌────────────────────────────┐
│  Background Poller (10s)   │
│  Event Detection Engine    │
│  Subscriber Pattern        │
└──────────┬─────────────────┘
           │
           ▼
┌────────────────────────────┐
│  FastAPI REST API :3860    │
│  /api/v1/pairs/*           │
└────────────────────────────┘
```

---

## Data Model

### PairData

The core normalized model parsed from Dexscreener's raw API response:

| Field | Type | Description |
|-------|------|-------------|
| `pair_address` | string | DEX pair contract address |
| `chain_id` | string | Chain identifier (solana, ethereum, base, etc.) |
| `dex_id` | string | DEX identifier (raydium, uniswap, etc.) |
| `base_token_symbol` | string | Base token symbol (e.g., SOL) |
| `quote_token_symbol` | string | Quote token symbol (e.g., USDC) |
| `price_usd` | float | Current price in USD |
| `volume_5m` | float | Volume in last 5 minutes |
| `volume_1h` | float | Volume in last 1 hour |
| `volume_6h` | float | Volume in last 6 hours |
| `volume_24h` | float | Volume in last 24 hours |
| `liquidity_usd` | float | Total liquidity in USD |
| `fdv` | float | Fully diluted valuation |
| `market_cap` | float | Market capitalization |
| `price_change_5m` | float | 5-minute price change % |
| `price_change_1h` | float | 1-hour price change % |
| `price_change_24h` | float | 24-hour price change % |
| `txns_5m` | int | Total transactions in 5 min |
| `buy_pressure_5m` | float | Buy ratio (buys / total txns) |
| `pair_created_at` | int | Pair creation timestamp (ms) |

---

## Cache Configuration

| Category | TTL | Description |
|----------|-----|-------------|
| `top_movers` | 10s | Top movers list (fast refresh) |
| `pair_info` | 30s | Individual pair details |
| `token_pairs` | 300s | Token pair lookup (5 min) |
| `search` | 60s | Search results |
| `boosts` | 30s | Token boosts data |
| `profiles` | 120s | Token profiles |

The cache uses Redis when available, with an automatic fallback to an in-memory LRU cache (2000 max entries).

---

## Storage

SQLite database with WAL mode for concurrent reads/writes:

### Tables

| Table | Purpose |
|-------|---------|
| `dex_pairs_snapshot` | Time-series pair data (indexed on pair_address, chain_id, timestamp) |
| `dex_pairs_latest` | Materialized latest state with previous values for change detection |

Snapshots older than 7 days are automatically cleaned up.

---

## Event Detection

The background poller detects market events by comparing current state against previous state:

| Event Type | Trigger | Threshold |
|------------|---------|-----------|
| `pair_update` | Any pair data change | Always |
| `new_pair` | Pair not seen before | Liquidity > $100K |
| `volume_spike` | Volume exceeds expected | 2× multiplier |
| `liquidity_change` | Significant liquidity shift | >20% change |
| `price_surge` | Rapid price movement | >5% in 5 min |

Events are distributed to subscribers (e.g., the Signal Engine).

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/health` | Health check + uptime |
| `GET` | `/api/v1/stats` | Service statistics |
| `GET` | `/api/v1/pairs/top-movers/{chain}` | Top movers for a specific chain |
| `GET` | `/api/v1/pairs/top-movers` | Top movers across all chains |
| `GET` | `/api/v1/pairs/{chain}/{token}` | Token pair data by chain |
| `GET` | `/api/v1/pairs/info/{pair_address}` | Specific pair info |
| `GET` | `/api/v1/search?q=` | Search Dexscreener pairs |
| `GET` | `/api/v1/pairs/new` | Newly created pairs |
| `GET` | `/api/v1/pairs/liquidity-changes` | Significant liquidity shifts |
| `GET` | `/api/v1/pairs/history/{pair_address}` | Price history for a pair |

---

## Quick Start

```bash
# Install dependencies
pip install -r services/market-data/requirements.txt

# Run the service
python -m services.market-data.main

# Or with uvicorn (reload mode)
uvicorn services.market-data.main:app --port 3860 --reload
```

No API keys required — Dexscreener is free and public.

---

## Integration

The Market Data Agent is consumed by:

| Consumer | Integration |
|----------|-------------|
| Signal Engine | HTTP polling every 10s (`/api/v1/pairs/top-movers`) |
| On-Chain Analyst | Dexscreener tab in research.html |
| External agents | REST API on port 3860 |

---

## Next Steps

- [Signal Engine →](./signal-engine.md)
- [On-Chain Analyst →](./research-agent.md)
- [Agent Overview →](./overview.md)
