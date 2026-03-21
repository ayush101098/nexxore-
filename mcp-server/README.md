# Nexxore Hyperliquid MCP Server

Data intelligence layer for Hyperliquid — real-time trade ingestion, wallet cohort classification, and 26 MCP tools for AI-powered market analysis.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     MCP Server (TypeScript)                 │
│          26 tools • stdio transport • pg pool               │
├──────────┬──────────┬──────────────┬────────────────────────┤
│ Cohort   │ Trader   │ Market       │ Real-Time              │
│ Intel    │ Analytics│ Intelligence │ Trade Flow             │
│ (4)      │ (10)     │ (6)          │ (6)                    │
└────┬─────┴────┬─────┴──────┬───────┴────────────┬──────────┘
     │          │            │                    │
     ▼          ▼            ▼                    ▼
┌─────────────────────────────────────────────────────────────┐
│                   TimescaleDB (PostgreSQL)                  │
│  trading.*  15 tables  │  predictions.*  5 tables           │
│  3 continuous aggregates │ retention + compression          │
└────────────────────┬────────────────────────────────────────┘
                     ▲
     ┌───────────────┼───────────────┐
     │               │               │
┌────┴─────┐   ┌─────┴────┐   ┌─────┴──────┐
│ WS Trade │   │ Fill     │   │ Cohort     │
│ Stream   │   │ Indexer  │   │ Classifier │
│ (Python) │   │ (Python) │   │ (Python)   │
└────┬─────┘   └─────┬────┘   └────────────┘
     │               │
     ▼               ▼
  Hyperliquid    Hyperliquid
  WebSocket       REST API
```

## Quick Start

### 1. Start TimescaleDB

```bash
cd mcp-server
cp .env.example .env
docker compose up -d
```

Wait for the container to initialize (~10s). The schema is auto-applied.

### 2. Install Dependencies

```bash
# TypeScript MCP server
npm install

# Python ingestion + cohorts
pip install -r requirements.txt
```

### 3. Seed Assets & Start Ingestion

```bash
# Seed the coin universe from Hyperliquid meta
python ingestion/run.py --seed-assets

# Start full pipeline (WebSocket trades + REST fill indexer)
python ingestion/run.py
```

### 4. Start Cohort Classifier

```bash
# Run once
python cohorts/run.py --once

# Or continuous (recomputes every 5 min)
python cohorts/run.py
```

### 5. Start MCP Server

```bash
npm run dev
```

The server runs on stdio — connect it to Claude Desktop, Cursor, or any MCP client.

### Claude Desktop Config

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "nexxore-hyperliquid": {
      "command": "npx",
      "args": ["tsx", "server/index.ts"],
      "cwd": "/path/to/nexxore/mcp-server",
      "env": {
        "DATABASE_URL": "postgresql://nexxore:nexxore_mcp_2025@localhost:5433/nexxore_mcp"
      }
    }
  }
}
```

## Tool Reference

### Cohort Intelligence (4 tools)

| Tool | Description | Key Inputs |
|------|-------------|------------|
| `classify_wallet` | Classify a wallet into PnL / Size / Consistency / Style / Risk tiers | `address` |
| `get_cohort_positions` | Current positions held by wallets in a cohort tier | `pnl_tier?`, `size_tier?`, `coin?` |
| `live_cohort_bias` | Long/short bias for a coin by PnL cohort tier | `coin` |
| `cohort_flow_analysis` | Net buy/sell dollar flow by cohort over N hours | `hours?`, `coin?` |

### Trader Analytics (10 tools)

| Tool | Description | Key Inputs |
|------|-------------|------------|
| `pulse_trader_profile` | Full profile — metrics, tiers, positions, recent fills | `address` |
| `rank_traders` | Leaderboard by any metric | `metric`, `direction?`, `pnl_tier?` |
| `trader_positions` | All open positions for a wallet | `address` |
| `trader_history` | Recent fills / trade log | `address`, `coin?`, `hours?` |
| `trader_pnl_breakdown` | PnL breakdown by coin | `address` |
| `hidden_gem_discovery` | Find small but consistent wallets | `min_win_rate?`, `min_trades?` |
| `trader_comparison` | Head-to-head comparison of 2-5 wallets | `wallets[]` |
| `trader_risk_analysis` | Drawdown, leverage, concentration, risk rating | `address` |
| `trader_coin_exposure` | Long vs short notional exposure by coin | `address` |
| `trader_performance_over_time` | PnL timeseries (1h/1d/1w buckets) | `address`, `days?`, `granularity?` |

### Market Intelligence (6 tools)

| Tool | Description | Key Inputs |
|------|-------------|------------|
| `funding_rate_scanner` | Top/bottom funding rates with annualized projection | `sort?`, `limit?` |
| `liquidation_heatmap` | Recent liquidations by coin & size | `coin?`, `hours?` |
| `volume_profile` | Volume distribution by price level | `coin`, `hours?`, `buckets?` |
| `order_book_depth` | Bid/ask depth, spread, imbalance | `coin` |
| `long_short_ratio` | Aggregate long vs short by coin, optionally by cohort | `coin?`, `pnl_tier?` |
| `market_overview` | Top coins by volume, OI, price change, funding | `hours?`, `limit?` |

### Real-Time Trade Flow (6 tools)

| Tool | Description | Key Inputs |
|------|-------------|------------|
| `largest_trades` | Biggest trades by notional in a time window | `coin?`, `hours?` |
| `trade_flow_summary` | Buy/sell flow per coin | `hours?`, `limit?` |
| `whale_alert` | Large fills from whale/leviathan wallets | `min_notional?`, `hours?` |
| `position_lifecycle` | Trace open → close for a wallet+coin | `address`, `coin`, `days?` |
| `aggregated_flow` | Net flow timeseries (5m/15m/1h/4h buckets) | `hours?`, `granularity?` |
| `flow_by_cohort` | Flow broken down by PnL tier × size tier | `coin?`, `hours?` |

## Data Sources

All data is sourced from Hyperliquid's public APIs:

| Endpoint | Usage |
|----------|-------|
| `wss://api.hyperliquid.xyz/ws` | Real-time trade stream (all coins) |
| `POST /info` `type: meta` | Coin universe + asset metadata |
| `POST /info` `type: allMids` | Mid prices for all coins |
| `POST /info` `type: userFillsByTime` | Historical fills per wallet |
| `POST /info` `type: clearinghouseState` | Current positions per wallet |
| `POST /info` `type: fundingHistory` | Historical funding rates |
| `POST /info` `type: leaderboard` | Wallet discovery |

## Database Schema

### Trading Schema (10 tables)

- `market_trades` — Hypertable, 1-day chunks, 90-day retention
- `fills` — Hypertable, per-wallet fills with dedup
- `funding_rates` — Hypertable, 7-day chunks
- `orderbook_snapshots` — Hypertable, 30-day retention
- `liquidations` — Hypertable
- `wallet_metrics` — Aggregate metrics per wallet
- `wallet_cohorts` — Behavioral tier assignments
- `positions` — Current open positions
- `wallet_queue` — Discovery & indexing queue
- `assets` — Coin metadata

### Continuous Aggregates

- `candles_1m` — 1-minute OHLCV from market_trades
- `candles_1h` — 1-hour OHLCV
- `wallet_fills_1h` — Hourly PnL per wallet

### Compression & Retention

| Table | Compression After | Retention |
|-------|-------------------|-----------|
| `market_trades` | 7 days | 90 days |
| `fills` | 14 days | — |
| `funding_rates` | 7 days | — |
| `orderbook_snapshots` | — | 30 days |

## Cohort Tiers

### PnL Tier
| Tier | Criteria |
|------|----------|
| `money_printer` | Top 5% by PnL |
| `profitable` | PnL > $100 |
| `breakeven` | PnL between -$100 and $100 |
| `losing` | PnL < -$100 |
| `giga_rekt` | Bottom 5% by PnL |

### Size Tier
| Tier | Volume Threshold |
|------|------------------|
| `leviathan` | > $100M |
| `whale` | > $10M |
| `dolphin` | > $1M |
| `fish` | > $100K |
| `shrimp` | ≤ $100K |

### Additional Dimensions
- **Consistency**: `consistent` (60%+ WR, 50+ trades), `moderate`, `erratic`
- **Style**: `scalper` (<5min avg), `swing` (<7d), `position` (≥7d), `mixed`
- **Risk**: `conservative` (≤3x), `moderate` (≤10x), `aggressive` (≤20x), `degen` (>20x)

## CLI Reference

### Ingestion

```bash
python ingestion/run.py                # Full pipeline (WS + fill indexer)
python ingestion/run.py --trades-only  # WebSocket trades only
python ingestion/run.py --fills-only   # REST fill indexer only
python ingestion/run.py --backfill     # Historical backfill (all wallets)
python ingestion/run.py --backfill-funding  # Backfill funding rates
python ingestion/run.py --seed-assets  # Seed coin universe
python ingestion/run.py --add-wallets 0x1,0x2  # Add wallets to index
python ingestion/run.py --status       # Show ingestion stats
```

### Cohorts

```bash
python cohorts/run.py              # Continuous scheduler (every 5 min)
python cohorts/run.py --once       # Single compute + classify cycle
python cohorts/run.py --wallet 0x  # Classify a single wallet
python cohorts/run.py --summary    # Show cohort distribution
```

### Docker

```bash
npm run db:up      # Start TimescaleDB
npm run db:down    # Stop TimescaleDB
npm run dev        # Start MCP server (tsx)
```

## File Structure

```
mcp-server/
├── docker-compose.yml      # TimescaleDB container
├── .env.example            # Environment template
├── package.json            # Node dependencies + scripts
├── tsconfig.json           # TypeScript config
├── requirements.txt        # Python dependencies
├── README.md               # This file
│
├── storage/
│   └── schema.sql          # Full TimescaleDB schema
│
├── ingestion/              # Python data pipeline
│   ├── __init__.py
│   ├── config.py           # Centralized config
│   ├── db.py               # Async DB operations
│   ├── ws_trades.py        # WebSocket trade stream
│   ├── fill_indexer.py     # REST fill indexer
│   ├── backfill.py         # Historical backfill
│   └── run.py              # CLI entry point
│
├── cohorts/                # Python cohort engine
│   ├── __init__.py
│   ├── metrics.py          # Wallet metrics computer
│   ├── classifier.py       # Behavioral tier classifier
│   ├── scheduler.py        # Periodic recomputation
│   └── run.py              # CLI entry point
│
└── server/                 # TypeScript MCP server
    ├── index.ts            # Main entry — 26 tool registrations
    ├── db.ts               # PostgreSQL pool + query helpers
    ├── types.ts            # Shared type definitions
    └── tools/
        ├── cohort.ts       # 4 Cohort Intelligence tools
        ├── trader.ts       # 10 Trader Analytics tools
        ├── market.ts       # 6 Market Intelligence tools
        └── flow.ts         # 6 Real-Time Trade Flow tools
```
