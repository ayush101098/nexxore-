# Nexxore Predictions Agent — Polymarket Data Pipeline

Complete infrastructure for ingesting, normalizing, storing, and querying prediction market data from Polymarket.

## Architecture

```
Polymarket APIs
├── Gamma API (market metadata)     ─┐
└── CLOB API  (prices, books, trades) ─┤
                                       ▼
                              ┌─────────────┐
                              │  REST Client │  (api_client.py)
                              └──────┬──────┘
                                     │
                              ┌──────▼──────┐
                              │  Normalizer  │  (normalizer.py)
                              └──────┬──────┘
                                     │
              ┌──────────────────────┼───────────────────────┐
              │                      │                       │
    ┌─────────▼─────────┐   ┌───────▼──────┐   ┌───────────▼──────────┐
    │  WebSocket Feed    │   │   SQLite DB   │   │  Pipeline Orchestrator│
    │  (ws_feed.py)      │──▶│  (storage.py) │◀──│  (pipeline.py)       │
    └────────────────────┘   └───────┬──────┘   └──────────────────────┘
                                     │
                              ┌──────▼──────┐
                              │   Queries    │  (queries.py)
                              └─────────────┘
```

## Quick Start

```bash
cd agents/predictions
pip install -r requirements.txt

# Seed the database with active markets
python run.py --seed

# Run the full pipeline (REST + WebSocket + periodic refresh)
python run.py

# Check DB stats
python run.py --status
```

## CLI Reference

```bash
# Full pipeline (default)
python run.py

# Seed markets only (no streaming)
python run.py --seed

# Show database statistics
python run.py --status

# Find markets that moved ≥5¢ in the last hour
python run.py --movers --hours 1 --min-move 0.05

# Find highest-volume markets
python run.py --volume --limit 20

# Find markets expiring within 48 hours
python run.py --expiring --hours 48

# Show calibration data for resolved markets
python run.py --calibration

# Summary for a specific market
python run.py --summary <MARKET_ID>
```

### Pipeline Options

| Flag | Default | Description |
|------|---------|-------------|
| `--db` | `polymarket.db` | SQLite database path |
| `--min-liquidity` | `5000` | Min liquidity ($) to monitor a market |
| `--snapshot-interval` | `60` | REST snapshot interval (seconds) |
| `--refresh-interval` | `300` | Metadata refresh interval (seconds) |
| `--rate-limit` | `3.0` | API requests per second |

## Module Overview

### `api_client.py` — REST API Client
- Token-bucket rate limiter
- Exponential-backoff retries on 429 / 5xx / connection errors
- Automatic pagination for bulk market fetches
- Covers Gamma API (metadata) and CLOB API (prices, order book, trades)

### `normalizer.py` — Data Normalization
- `Market` and `OutcomeToken` dataclasses
- Handles missing fields, type coercion, timestamp parsing
- Batch normalization with error tolerance

### `storage.py` — SQLite Storage
- WAL mode for concurrent reads/writes
- Tables: `markets`, `outcome_tokens`, `price_snapshots`, `trades`, `market_state_history`
- Idempotent inserts (unique constraints prevent duplicate snapshots/trades on reconnect)
- Lifecycle tracking: records state transitions (active → closed → resolved)

### `ws_feed.py` — WebSocket Feed
- Connects to Polymarket's CLOB WebSocket
- Auto-reconnect with exponential backoff (max 60s)
- Async ingestion queue → batch writer to avoid DB contention
- Handles `price_change`, `book`, and `last_trade_price` events

### `pipeline.py` — Orchestrator
- Seeds market metadata on startup
- Identifies liquid markets to monitor
- Runs 4 concurrent tasks: WebSocket feed, batch writer, REST snapshots, metadata refresh

### `queries.py` — Analysis Utilities
- `market_summary()` — current state + 24h price range
- `find_moving_markets()` — detect information arrivals
- `find_high_volume_markets()` — top markets by volume
- `find_expiring_soon()` — approaching deadlines
- `price_volatility()` — std dev, CV for YES prices
- `calibration_data()` — predicted vs actual resolution rates

## Database Schema

```sql
markets              — metadata, state, liquidity
outcome_tokens       — YES/NO token mapping per market
price_snapshots      — time-series price + bid/ask data
trades               — individual trade events
market_state_history — lifecycle state transitions
```

## Data Flow

```
Polymarket Gamma API  ──►  Market metadata
Polymarket CLOB API   ──►  Prices, order books, trades
                           │
                     ┌─────▼─────┐
         ┌──────────│  Normalizer │──────────┐
         │          └────────────┘           │
    ┌────▼────┐                        ┌────▼────┐
    │ REST    │                        │WebSocket│
    │Snapshots│                        │ Feed    │
    └────┬────┘                        └────┬────┘
         │                                  │
         │          ┌────────────┐           │
         └─────────►│  Async     │◄──────────┘
                    │  Queue     │
                    └─────┬──────┘
                          │
                    ┌─────▼──────┐
                    │ Batch      │
                    │ Writer     │
                    └─────┬──────┘
                          │
                    ┌─────▼──────┐
                    │  SQLite DB │
                    └────────────┘
```

## What You Can Build On Top

Once the pipeline is running, the database provides:
- A catalogue of active markets with metadata
- Price snapshots at regular intervals
- Real-time updates via WebSocket for liquid markets
- Historical price series for any market
- Trade events with price, size, and side

Use cases:
- **Calibration studies** — are market prices well-calibrated?
- **Price movement patterns** — information incorporation speed
- **Volume-weighted indicators** — VWAP, trade flow analysis
- **Correlation analysis** — related markets moving together
- **Signal generation** — feed into the Nexxore alpha pipeline
