-- ============================================================
-- Nexxore MCP Server — TimescaleDB Schema
-- Two domains: trading (Hyperliquid) + predictions (Polymarket)
-- Same instance, separate schemas
-- ============================================================

-- Enable TimescaleDB
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- ────────────────────────────────────────────────────────────
-- SCHEMA: trading
-- Hyperliquid clearinghouse data, cohort intelligence
-- ────────────────────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS trading;

-- ──── 1. Market trades (anonymous, from WS `trades` channel) ────
-- Every trade on Hyperliquid, all coins. No wallet attribution.
-- Primary source for market intelligence tools.
CREATE TABLE trading.market_trades (
    time        TIMESTAMPTZ     NOT NULL,
    coin        TEXT            NOT NULL,
    side        TEXT            NOT NULL,   -- 'A' (sell/ask) | 'B' (buy/bid)
    price       DOUBLE PRECISION NOT NULL,
    size        DOUBLE PRECISION NOT NULL,
    notional    DOUBLE PRECISION NOT NULL,  -- price × size
    trade_id    TEXT,
    hash        TEXT
);

SELECT create_hypertable('trading.market_trades', 'time',
    chunk_time_interval => INTERVAL '1 day');

CREATE INDEX idx_mt_coin_time ON trading.market_trades (coin, time DESC);
CREATE INDEX idx_mt_notional  ON trading.market_trades (notional DESC, time DESC);

-- ──── 2. Wallet fills (attributed, from REST userFills) ────
-- Per-wallet fill history. Source for trader analytics + cohort engine.
CREATE TABLE trading.fills (
    time            TIMESTAMPTZ     NOT NULL,
    coin            TEXT            NOT NULL,
    wallet          TEXT            NOT NULL,
    side            TEXT            NOT NULL,   -- 'Buy' | 'Sell'
    price           DOUBLE PRECISION NOT NULL,
    size            DOUBLE PRECISION NOT NULL,
    notional        DOUBLE PRECISION NOT NULL,
    fee             DOUBLE PRECISION DEFAULT 0,
    fee_token       TEXT            DEFAULT 'USDC',
    closed_pnl      DOUBLE PRECISION DEFAULT 0,
    direction       TEXT,                       -- 'Open Long' | 'Close Long' | 'Open Short' | 'Close Short'
    order_id        TEXT,
    trade_id        TEXT,
    is_liquidation  BOOLEAN         DEFAULT FALSE,
    crossed         BOOLEAN         DEFAULT FALSE, -- taker
    hash            TEXT
);

SELECT create_hypertable('trading.fills', 'time',
    chunk_time_interval => INTERVAL '1 day');

CREATE INDEX idx_fills_wallet_time ON trading.fills (wallet, time DESC);
CREATE INDEX idx_fills_coin_time   ON trading.fills (coin, time DESC);
CREATE INDEX idx_fills_wallet_coin ON trading.fills (wallet, coin, time DESC);
-- Dedup index: prevent duplicate fills on re-index
CREATE UNIQUE INDEX idx_fills_dedup ON trading.fills (wallet, trade_id, time)
    WHERE trade_id IS NOT NULL;

-- ──── 3. Funding rate snapshots ────
CREATE TABLE trading.funding_rates (
    time            TIMESTAMPTZ     NOT NULL,
    coin            TEXT            NOT NULL,
    funding_rate    DOUBLE PRECISION NOT NULL,
    premium         DOUBLE PRECISION,
    open_interest   DOUBLE PRECISION,
    mark_price      DOUBLE PRECISION,
    oracle_price    DOUBLE PRECISION
);

SELECT create_hypertable('trading.funding_rates', 'time',
    chunk_time_interval => INTERVAL '7 days');

CREATE INDEX idx_fr_coin_time ON trading.funding_rates (coin, time DESC);

-- ──── 4. Order book snapshots ────
CREATE TABLE trading.orderbook_snapshots (
    time        TIMESTAMPTZ     NOT NULL,
    coin        TEXT            NOT NULL,
    bid_depth   DOUBLE PRECISION,  -- total bid notional in top N levels
    ask_depth   DOUBLE PRECISION,  -- total ask notional in top N levels
    spread      DOUBLE PRECISION,  -- best ask − best bid
    mid_price   DOUBLE PRECISION,
    imbalance   DOUBLE PRECISION,  -- (bid_depth − ask_depth) / (bid_depth + ask_depth)
    levels_json JSONB              -- top 10 bid/ask levels
);

SELECT create_hypertable('trading.orderbook_snapshots', 'time',
    chunk_time_interval => INTERVAL '1 day');

CREATE INDEX idx_ob_coin_time ON trading.orderbook_snapshots (coin, time DESC);

-- ──── 5. Wallet metrics (materialized, recomputed by cohort engine) ────
CREATE TABLE trading.wallet_metrics (
    wallet                  TEXT            PRIMARY KEY,
    total_pnl               DOUBLE PRECISION DEFAULT 0,
    trade_count             INTEGER         DEFAULT 0,
    win_count               INTEGER         DEFAULT 0,
    loss_count              INTEGER         DEFAULT 0,
    win_rate                DOUBLE PRECISION DEFAULT 0,
    total_volume            DOUBLE PRECISION DEFAULT 0,
    total_fees              DOUBLE PRECISION DEFAULT 0,
    largest_win             DOUBLE PRECISION DEFAULT 0,
    largest_loss            DOUBLE PRECISION DEFAULT 0,
    avg_trade_size          DOUBLE PRECISION DEFAULT 0,
    avg_hold_duration_sec   DOUBLE PRECISION,
    profit_factor           DOUBLE PRECISION DEFAULT 0,
    sharpe_ratio            DOUBLE PRECISION,
    sortino_ratio           DOUBLE PRECISION,
    max_drawdown            DOUBLE PRECISION,
    avg_leverage            DOUBLE PRECISION,
    unique_coins_traded     INTEGER         DEFAULT 0,
    active_since            TIMESTAMPTZ,
    last_trade              TIMESTAMPTZ,
    updated_at              TIMESTAMPTZ     DEFAULT NOW()
);

CREATE INDEX idx_wm_pnl     ON trading.wallet_metrics (total_pnl DESC);
CREATE INDEX idx_wm_volume   ON trading.wallet_metrics (total_volume DESC);
CREATE INDEX idx_wm_winrate  ON trading.wallet_metrics (win_rate DESC)
    WHERE trade_count >= 10;
CREATE INDEX idx_wm_trades   ON trading.wallet_metrics (trade_count DESC);

-- ──── 6. Wallet cohorts (tier assignments) ────
CREATE TABLE trading.wallet_cohorts (
    wallet          TEXT            PRIMARY KEY,
    pnl_tier        TEXT            NOT NULL,   -- money_printer | profitable | breakeven | losing | giga_rekt
    size_tier       TEXT            NOT NULL,   -- leviathan | whale | dolphin | fish | shrimp
    consistency     TEXT,                       -- consistent | moderate | erratic
    style           TEXT,                       -- scalper | swing | position | mixed
    risk_profile    TEXT,                       -- conservative | moderate | aggressive | degen
    updated_at      TIMESTAMPTZ     DEFAULT NOW()
);

CREATE INDEX idx_wc_pnl_tier  ON trading.wallet_cohorts (pnl_tier);
CREATE INDEX idx_wc_size_tier ON trading.wallet_cohorts (size_tier);

-- ──── 7. Open positions (snapshot, refreshed periodically) ────
CREATE TABLE trading.positions (
    wallet              TEXT            NOT NULL,
    coin                TEXT            NOT NULL,
    side                TEXT            NOT NULL,   -- 'long' | 'short'
    size                DOUBLE PRECISION NOT NULL,
    entry_price         DOUBLE PRECISION NOT NULL,
    mark_price          DOUBLE PRECISION,
    unrealized_pnl      DOUBLE PRECISION,
    leverage            DOUBLE PRECISION,
    liquidation_price   DOUBLE PRECISION,
    margin_used         DOUBLE PRECISION,
    return_on_equity    DOUBLE PRECISION,
    updated_at          TIMESTAMPTZ     DEFAULT NOW(),
    PRIMARY KEY (wallet, coin)
);

CREATE INDEX idx_pos_coin     ON trading.positions (coin);
CREATE INDEX idx_pos_side     ON trading.positions (side);
CREATE INDEX idx_pos_notional ON trading.positions ((size * entry_price) DESC);

-- ──── 8. Wallet discovery queue ────
-- Wallets discovered from leaderboard, cross-references, etc.
CREATE TABLE trading.wallet_queue (
    wallet          TEXT            PRIMARY KEY,
    source          TEXT            DEFAULT 'manual', -- leaderboard | cross_ref | manual
    priority        INTEGER         DEFAULT 0,
    last_indexed    TIMESTAMPTZ,
    fill_count      INTEGER         DEFAULT 0,
    status          TEXT            DEFAULT 'pending', -- pending | indexed | failed
    created_at      TIMESTAMPTZ     DEFAULT NOW()
);

CREATE INDEX idx_wq_status ON trading.wallet_queue (status, priority DESC);

-- ──── 9. Liquidation events ────
CREATE TABLE trading.liquidations (
    time            TIMESTAMPTZ     NOT NULL,
    coin            TEXT            NOT NULL,
    wallet          TEXT,
    side            TEXT            NOT NULL,
    price           DOUBLE PRECISION NOT NULL,
    size            DOUBLE PRECISION NOT NULL,
    notional        DOUBLE PRECISION NOT NULL
);

SELECT create_hypertable('trading.liquidations', 'time',
    chunk_time_interval => INTERVAL '7 days');

CREATE INDEX idx_liq_coin_time ON trading.liquidations (coin, time DESC);

-- ──── 10. Asset metadata (coin universe) ────
CREATE TABLE trading.assets (
    coin            TEXT            PRIMARY KEY,
    asset_index     INTEGER,
    max_leverage    INTEGER,
    sz_decimals     INTEGER,
    mark_price      DOUBLE PRECISION,
    mid_price       DOUBLE PRECISION,
    funding_rate    DOUBLE PRECISION,
    open_interest   DOUBLE PRECISION,
    volume_24h      DOUBLE PRECISION,
    updated_at      TIMESTAMPTZ     DEFAULT NOW()
);


-- ────────────────────────────────────────────────────────────
-- SCHEMA: predictions
-- Polymarket + other prediction market data
-- ────────────────────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS predictions;

-- ──── 1. Prediction markets ────
CREATE TABLE predictions.markets (
    market_id       TEXT            PRIMARY KEY,
    condition_id    TEXT,
    question        TEXT            NOT NULL,
    description     TEXT,
    category        TEXT,
    end_date        TIMESTAMPTZ,
    liquidity       DOUBLE PRECISION,
    volume          DOUBLE PRECISION,
    source          TEXT            DEFAULT 'polymarket',
    active          BOOLEAN         DEFAULT TRUE,
    resolved        BOOLEAN         DEFAULT FALSE,
    outcome         TEXT,           -- resolution outcome
    created_at      TIMESTAMPTZ     DEFAULT NOW(),
    updated_at      TIMESTAMPTZ     DEFAULT NOW()
);

CREATE INDEX idx_pm_active   ON predictions.markets (active, end_date);
CREATE INDEX idx_pm_category ON predictions.markets (category);
CREATE INDEX idx_pm_source   ON predictions.markets (source);

-- ──── 2. Outcome tokens ────
CREATE TABLE predictions.outcome_tokens (
    token_id        TEXT            PRIMARY KEY,
    market_id       TEXT            NOT NULL REFERENCES predictions.markets(market_id),
    outcome         TEXT            NOT NULL,
    price           DOUBLE PRECISION,
    winner          BOOLEAN
);

CREATE INDEX idx_ot_market ON predictions.outcome_tokens (market_id);

-- ──── 3. Price snapshots ────
CREATE TABLE predictions.price_snapshots (
    time            TIMESTAMPTZ     NOT NULL,
    market_id       TEXT            NOT NULL,
    token_id        TEXT,
    outcome         TEXT,
    price           DOUBLE PRECISION NOT NULL,
    volume          DOUBLE PRECISION
);

SELECT create_hypertable('predictions.price_snapshots', 'time',
    chunk_time_interval => INTERVAL '1 day');

CREATE INDEX idx_ps_market_time ON predictions.price_snapshots (market_id, time DESC);

-- ──── 4. Prediction trades ────
CREATE TABLE predictions.trades (
    time            TIMESTAMPTZ     NOT NULL,
    market_id       TEXT            NOT NULL,
    token_id        TEXT,
    side            TEXT            NOT NULL,
    price           DOUBLE PRECISION NOT NULL,
    size            DOUBLE PRECISION NOT NULL
);

SELECT create_hypertable('predictions.trades', 'time',
    chunk_time_interval => INTERVAL '1 day');

CREATE INDEX idx_pt_market_time ON predictions.trades (market_id, time DESC);

-- ──── 5. Market state history ────
CREATE TABLE predictions.market_state_history (
    time            TIMESTAMPTZ     NOT NULL,
    market_id       TEXT            NOT NULL,
    old_state       TEXT,
    new_state       TEXT            NOT NULL
);

SELECT create_hypertable('predictions.market_state_history', 'time',
    chunk_time_interval => INTERVAL '30 days');


-- ────────────────────────────────────────────────────────────
-- CONTINUOUS AGGREGATES (TimescaleDB materialised views)
-- ────────────────────────────────────────────────────────────

-- 1-minute trade candles per coin
CREATE MATERIALIZED VIEW trading.candles_1m
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 minute', time) AS bucket,
    coin,
    first(price, time)  AS open,
    max(price)          AS high,
    min(price)          AS low,
    last(price, time)   AS close,
    sum(notional)       AS volume,
    count(*)            AS trade_count,
    sum(CASE WHEN side = 'B' THEN notional ELSE 0 END) AS buy_volume,
    sum(CASE WHEN side = 'A' THEN notional ELSE 0 END) AS sell_volume
FROM trading.market_trades
GROUP BY bucket, coin
WITH NO DATA;

-- Refresh policy: every minute, cover last 3 minutes
SELECT add_continuous_aggregate_policy('trading.candles_1m',
    start_offset    => INTERVAL '3 minutes',
    end_offset      => INTERVAL '1 minute',
    schedule_interval => INTERVAL '1 minute');

-- 1-hour trade candles per coin
CREATE MATERIALIZED VIEW trading.candles_1h
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 hour', time) AS bucket,
    coin,
    first(price, time)  AS open,
    max(price)          AS high,
    min(price)          AS low,
    last(price, time)   AS close,
    sum(notional)       AS volume,
    count(*)            AS trade_count,
    sum(CASE WHEN side = 'B' THEN notional ELSE 0 END) AS buy_volume,
    sum(CASE WHEN side = 'A' THEN notional ELSE 0 END) AS sell_volume
FROM trading.market_trades
GROUP BY bucket, coin
WITH NO DATA;

SELECT add_continuous_aggregate_policy('trading.candles_1h',
    start_offset    => INTERVAL '3 hours',
    end_offset      => INTERVAL '1 hour',
    schedule_interval => INTERVAL '1 hour');

-- Hourly fill aggregates per wallet
CREATE MATERIALIZED VIEW trading.wallet_fills_1h
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 hour', time) AS bucket,
    wallet,
    coin,
    count(*)            AS fill_count,
    sum(notional)       AS total_notional,
    sum(closed_pnl)     AS realized_pnl,
    sum(fee)            AS total_fees
FROM trading.fills
GROUP BY bucket, wallet, coin
WITH NO DATA;

SELECT add_continuous_aggregate_policy('trading.wallet_fills_1h',
    start_offset    => INTERVAL '3 hours',
    end_offset      => INTERVAL '1 hour',
    schedule_interval => INTERVAL '1 hour');


-- ────────────────────────────────────────────────────────────
-- RETENTION POLICIES
-- ────────────────────────────────────────────────────────────

-- Keep raw market trades for 90 days (candles retain aggregated data forever)
SELECT add_retention_policy('trading.market_trades', INTERVAL '90 days');

-- Keep orderbook snapshots for 30 days
SELECT add_retention_policy('trading.orderbook_snapshots', INTERVAL '30 days');

-- Keep wallet fills forever (they're the source of truth for cohorts)
-- No retention policy on trading.fills

-- Keep prediction snapshots for 1 year
SELECT add_retention_policy('predictions.price_snapshots', INTERVAL '365 days');


-- ────────────────────────────────────────────────────────────
-- COMPRESSION POLICIES (reduce storage 10–20×)
-- ────────────────────────────────────────────────────────────

ALTER TABLE trading.market_trades SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'coin',
    timescaledb.compress_orderby = 'time DESC'
);
SELECT add_compression_policy('trading.market_trades', INTERVAL '7 days');

ALTER TABLE trading.fills SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'wallet',
    timescaledb.compress_orderby = 'time DESC'
);
SELECT add_compression_policy('trading.fills', INTERVAL '14 days');

ALTER TABLE trading.funding_rates SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'coin',
    timescaledb.compress_orderby = 'time DESC'
);
SELECT add_compression_policy('trading.funding_rates', INTERVAL '7 days');
