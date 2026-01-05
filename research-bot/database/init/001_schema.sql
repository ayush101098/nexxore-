-- ==============================================
-- CRYPTO RESEARCH ANALYST BOT - DATABASE SCHEMA
-- TimescaleDB with hypertables for time-series data
-- ==============================================

-- Enable TimescaleDB extension
CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE;
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- ==============================================
-- MARKET DATA (OHLCV)
-- ==============================================
CREATE TABLE IF NOT EXISTS market_data (
    id BIGSERIAL,
    symbol VARCHAR(20) NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL,
    timeframe VARCHAR(5) NOT NULL, -- 1m, 5m, 15m, 1h, 4h, 1d
    exchange VARCHAR(20) DEFAULT 'binance',
    open NUMERIC(20, 8) NOT NULL,
    high NUMERIC(20, 8) NOT NULL,
    low NUMERIC(20, 8) NOT NULL,
    close NUMERIC(20, 8) NOT NULL,
    volume NUMERIC(30, 8) NOT NULL,
    quote_volume NUMERIC(30, 8),
    trades_count INTEGER,
    taker_buy_volume NUMERIC(30, 8),
    taker_sell_volume NUMERIC(30, 8),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (symbol, timeframe, timestamp, exchange)
);

-- Convert to hypertable for time-series optimization
SELECT create_hypertable('market_data', 'timestamp', 
    chunk_time_interval => INTERVAL '1 day',
    if_not_exists => TRUE
);

-- Indexes for fast queries
CREATE INDEX IF NOT EXISTS idx_market_data_symbol_ts ON market_data (symbol, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_market_data_timeframe ON market_data (timeframe, timestamp DESC);

-- ==============================================
-- DERIVATIVES DATA
-- ==============================================
CREATE TABLE IF NOT EXISTS derivatives_data (
    id BIGSERIAL,
    symbol VARCHAR(20) NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL,
    exchange VARCHAR(20) DEFAULT 'binance',
    funding_rate NUMERIC(20, 10),
    open_interest NUMERIC(30, 8),
    open_interest_value NUMERIC(30, 8),
    long_short_ratio NUMERIC(10, 4),
    top_trader_long_short_ratio NUMERIC(10, 4),
    liquidation_volume_long NUMERIC(30, 8),
    liquidation_volume_short NUMERIC(30, 8),
    liquidation_count_long INTEGER,
    liquidation_count_short INTEGER,
    mark_price NUMERIC(20, 8),
    index_price NUMERIC(20, 8),
    implied_volatility NUMERIC(10, 4),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (symbol, timestamp, exchange)
);

SELECT create_hypertable('derivatives_data', 'timestamp',
    chunk_time_interval => INTERVAL '1 day',
    if_not_exists => TRUE
);

CREATE INDEX IF NOT EXISTS idx_derivatives_symbol_ts ON derivatives_data (symbol, timestamp DESC);

-- ==============================================
-- ON-CHAIN METRICS
-- ==============================================
CREATE TABLE IF NOT EXISTS onchain_data (
    id BIGSERIAL,
    symbol VARCHAR(20) NOT NULL,
    chain VARCHAR(20) DEFAULT 'ethereum',
    timestamp TIMESTAMPTZ NOT NULL,
    -- Exchange flows
    exchange_netflow NUMERIC(30, 8),
    exchange_inflow NUMERIC(30, 8),
    exchange_outflow NUMERIC(30, 8),
    -- Whale activity
    whale_netflow NUMERIC(30, 8),
    whale_transactions_count INTEGER,
    large_txn_volume NUMERIC(30, 8),
    -- Supply metrics
    circulating_supply NUMERIC(30, 8),
    stablecoin_supply_change NUMERIC(30, 8),
    -- DeFi metrics
    tvl NUMERIC(30, 8),
    tvl_change_24h NUMERIC(10, 4),
    -- Network activity
    active_addresses INTEGER,
    new_addresses INTEGER,
    transaction_count INTEGER,
    transaction_volume NUMERIC(30, 8),
    -- Mining/Staking
    hash_rate NUMERIC(30, 8),
    staking_rate NUMERIC(10, 4),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (symbol, chain, timestamp)
);

SELECT create_hypertable('onchain_data', 'timestamp',
    chunk_time_interval => INTERVAL '1 day',
    if_not_exists => TRUE
);

CREATE INDEX IF NOT EXISTS idx_onchain_symbol_ts ON onchain_data (symbol, timestamp DESC);

-- ==============================================
-- SOCIAL & SENTIMENT METRICS
-- ==============================================
CREATE TABLE IF NOT EXISTS social_metrics (
    id BIGSERIAL,
    symbol VARCHAR(20) NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL,
    source VARCHAR(30) NOT NULL, -- twitter, telegram, reddit, discord
    -- Volume metrics
    mention_count INTEGER DEFAULT 0,
    unique_authors INTEGER DEFAULT 0,
    engagement_score INTEGER DEFAULT 0,
    -- Sentiment analysis
    sentiment_score NUMERIC(5, 4), -- [-1, 1]
    sentiment_positive_count INTEGER DEFAULT 0,
    sentiment_negative_count INTEGER DEFAULT 0,
    sentiment_neutral_count INTEGER DEFAULT 0,
    -- Trend metrics
    mention_change_1h NUMERIC(10, 4),
    mention_change_24h NUMERIC(10, 4),
    -- Influencer activity
    influencer_mentions INTEGER DEFAULT 0,
    viral_posts INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (symbol, source, timestamp)
);

SELECT create_hypertable('social_metrics', 'timestamp',
    chunk_time_interval => INTERVAL '1 day',
    if_not_exists => TRUE
);

CREATE INDEX IF NOT EXISTS idx_social_symbol_ts ON social_metrics (symbol, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_social_source ON social_metrics (source, timestamp DESC);

-- ==============================================
-- NEWS & EVENTS
-- ==============================================
CREATE TABLE IF NOT EXISTS news_events (
    id SERIAL PRIMARY KEY,
    symbol VARCHAR(20),
    timestamp TIMESTAMPTZ NOT NULL,
    source VARCHAR(50) NOT NULL,
    event_type VARCHAR(50), -- upgrade, unlock, exploit, regulatory, partnership, listing
    title TEXT NOT NULL,
    content TEXT,
    url TEXT,
    -- NLP analysis
    sentiment_polarity NUMERIC(5, 4), -- [-1, 1]
    sentiment_intensity NUMERIC(5, 4), -- [0, 1]
    relevance_score NUMERIC(5, 4), -- [0, 1]
    -- Event classification
    is_breaking BOOLEAN DEFAULT FALSE,
    impact_level VARCHAR(20), -- low, medium, high, critical
    entities JSONB, -- extracted entities
    keywords TEXT[],
    -- Processing status
    processed BOOLEAN DEFAULT FALSE,
    processed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_news_symbol ON news_events (symbol, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_news_type ON news_events (event_type, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_news_impact ON news_events (impact_level, timestamp DESC);

-- ==============================================
-- ORDERBOOK SNAPSHOTS
-- ==============================================
CREATE TABLE IF NOT EXISTS orderbook_snapshots (
    id BIGSERIAL,
    symbol VARCHAR(20) NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL,
    exchange VARCHAR(20) DEFAULT 'binance',
    -- Aggregated metrics
    bid_total_volume NUMERIC(30, 8),
    ask_total_volume NUMERIC(30, 8),
    spread_bps NUMERIC(10, 4),
    mid_price NUMERIC(20, 8),
    -- Depth analysis
    bid_depth_1pct NUMERIC(30, 8),
    ask_depth_1pct NUMERIC(30, 8),
    bid_depth_2pct NUMERIC(30, 8),
    ask_depth_2pct NUMERIC(30, 8),
    -- Imbalance
    order_imbalance NUMERIC(10, 4), -- [-1, 1] negative = more asks
    -- Raw data (compressed)
    bids JSONB, -- Top 20 levels: [[price, quantity], ...]
    asks JSONB, -- Top 20 levels
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (symbol, timestamp, exchange)
);

SELECT create_hypertable('orderbook_snapshots', 'timestamp',
    chunk_time_interval => INTERVAL '6 hours',
    if_not_exists => TRUE
);

CREATE INDEX IF NOT EXISTS idx_orderbook_symbol_ts ON orderbook_snapshots (symbol, timestamp DESC);

-- ==============================================
-- FEATURE STORE (Computed Features)
-- ==============================================
CREATE TABLE IF NOT EXISTS feature_store (
    id BIGSERIAL,
    symbol VARCHAR(20) NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL,
    timeframe VARCHAR(5) NOT NULL,
    feature_set VARCHAR(50) NOT NULL, -- price, regime, orderflow, cross_asset, indicator
    feature_name VARCHAR(100) NOT NULL,
    feature_value NUMERIC(30, 10),
    feature_metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (symbol, timeframe, timestamp, feature_set, feature_name)
);

SELECT create_hypertable('feature_store', 'timestamp',
    chunk_time_interval => INTERVAL '1 day',
    if_not_exists => TRUE
);

CREATE INDEX IF NOT EXISTS idx_feature_symbol_ts ON feature_store (symbol, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_feature_set ON feature_store (feature_set, feature_name);

-- ==============================================
-- MODEL PREDICTIONS
-- ==============================================
CREATE TABLE IF NOT EXISTS model_predictions (
    id SERIAL PRIMARY KEY,
    symbol VARCHAR(20) NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL,
    model_name VARCHAR(50) NOT NULL,
    model_version VARCHAR(20),
    timeframe VARCHAR(5) NOT NULL,
    prediction_type VARCHAR(50) NOT NULL, -- direction, breakout_prob, volatility, regime
    prediction_horizon INTEGER, -- in candles
    prediction_value NUMERIC(20, 10),
    prediction_class VARCHAR(50), -- for classification
    confidence NUMERIC(5, 4),
    probability_distribution JSONB, -- {class: probability}
    feature_importance JSONB, -- top contributing features
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_predictions_symbol_ts ON model_predictions (symbol, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_predictions_model ON model_predictions (model_name, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_predictions_type ON model_predictions (prediction_type, timestamp DESC);

-- ==============================================
-- TRADE SETUPS (Final Output)
-- ==============================================
CREATE TABLE IF NOT EXISTS trade_setups (
    id SERIAL PRIMARY KEY,
    symbol VARCHAR(20) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    -- Setup details
    direction VARCHAR(10) NOT NULL, -- LONG, SHORT
    timeframe VARCHAR(5) NOT NULL,
    setup_type VARCHAR(50) NOT NULL, -- breakout, mean_reversion, trend_continuation, etc.
    -- Scoring
    confidence_score NUMERIC(5, 4) NOT NULL, -- [0, 1]
    risk_reward_ratio NUMERIC(5, 2),
    quality_score NUMERIC(5, 4),
    -- Price levels
    current_price NUMERIC(20, 8),
    entry_min NUMERIC(20, 8) NOT NULL,
    entry_max NUMERIC(20, 8) NOT NULL,
    invalidation NUMERIC(20, 8) NOT NULL, -- stop loss
    target_1 NUMERIC(20, 8),
    target_2 NUMERIC(20, 8),
    target_max NUMERIC(20, 8),
    -- Context
    regime VARCHAR(50),
    market_condition VARCHAR(50),
    -- Supporting data
    supporting_factors JSONB NOT NULL, -- detailed reasoning
    risk_factors JSONB,
    model_predictions JSONB,
    feature_snapshot JSONB,
    -- Status tracking
    status VARCHAR(20) DEFAULT 'ACTIVE', -- ACTIVE, INVALIDATED, ENTRY_HIT, TARGET_1_HIT, TARGET_2_HIT, STOPPED_OUT
    invalidated_at TIMESTAMPTZ,
    invalidation_reason TEXT,
    -- Performance tracking
    entry_hit_at TIMESTAMPTZ,
    entry_price_actual NUMERIC(20, 8),
    exit_at TIMESTAMPTZ,
    exit_price NUMERIC(20, 8),
    actual_return_pct NUMERIC(10, 4),
    -- Alerts
    alert_sent BOOLEAN DEFAULT FALSE,
    alert_sent_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_setups_symbol ON trade_setups (symbol, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_setups_status ON trade_setups (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_setups_confidence ON trade_setups (confidence_score DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_setups_direction ON trade_setups (direction, created_at DESC);

-- ==============================================
-- SYMBOL UNIVERSE (Tracked Assets)
-- ==============================================
CREATE TABLE IF NOT EXISTS symbol_universe (
    id SERIAL PRIMARY KEY,
    symbol VARCHAR(20) UNIQUE NOT NULL,
    base_asset VARCHAR(20) NOT NULL,
    quote_asset VARCHAR(20) NOT NULL,
    -- Classification
    category VARCHAR(50), -- L1, L2, DeFi, Infrastructure, Memecoin
    sector VARCHAR(50),
    tags TEXT[],
    -- Exchange info
    exchanges TEXT[],
    primary_exchange VARCHAR(20) DEFAULT 'binance',
    -- Risk parameters
    min_position_size NUMERIC(20, 8),
    max_position_size NUMERIC(20, 8),
    volatility_class VARCHAR(20), -- low, medium, high, extreme
    -- Tracking status
    is_active BOOLEAN DEFAULT TRUE,
    track_market_data BOOLEAN DEFAULT TRUE,
    track_derivatives BOOLEAN DEFAULT TRUE,
    track_onchain BOOLEAN DEFAULT FALSE,
    track_social BOOLEAN DEFAULT FALSE,
    -- Metadata
    coingecko_id VARCHAR(50),
    contract_address VARCHAR(100),
    chain VARCHAR(20),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_universe_active ON symbol_universe (is_active);
CREATE INDEX IF NOT EXISTS idx_universe_category ON symbol_universe (category);

-- ==============================================
-- MODEL REGISTRY
-- ==============================================
CREATE TABLE IF NOT EXISTS model_registry (
    id SERIAL PRIMARY KEY,
    model_name VARCHAR(50) NOT NULL,
    model_version VARCHAR(20) NOT NULL,
    model_type VARCHAR(50) NOT NULL, -- xgboost, lightgbm, lstm, transformer
    target_type VARCHAR(50) NOT NULL, -- direction, breakout, volatility
    timeframe VARCHAR(5),
    -- Performance metrics
    accuracy NUMERIC(5, 4),
    precision_score NUMERIC(5, 4),
    recall_score NUMERIC(5, 4),
    f1_score NUMERIC(5, 4),
    auc_roc NUMERIC(5, 4),
    sharpe_ratio NUMERIC(10, 4),
    -- Training info
    train_start_date TIMESTAMPTZ,
    train_end_date TIMESTAMPTZ,
    validation_start_date TIMESTAMPTZ,
    validation_end_date TIMESTAMPTZ,
    feature_count INTEGER,
    training_samples INTEGER,
    -- Artifacts
    model_path TEXT,
    feature_importance JSONB,
    hyperparameters JSONB,
    -- Status
    is_active BOOLEAN DEFAULT FALSE,
    deployed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (model_name, model_version)
);

-- ==============================================
-- DATA QUALITY MONITORING
-- ==============================================
CREATE TABLE IF NOT EXISTS data_quality_logs (
    id SERIAL PRIMARY KEY,
    timestamp TIMESTAMPTZ DEFAULT NOW(),
    source VARCHAR(50) NOT NULL, -- market_data, derivatives, onchain, social, news
    symbol VARCHAR(20),
    -- Quality metrics
    records_fetched INTEGER,
    records_stored INTEGER,
    records_rejected INTEGER,
    missing_values INTEGER,
    outliers_detected INTEGER,
    -- Timing
    fetch_duration_ms INTEGER,
    process_duration_ms INTEGER,
    -- Status
    status VARCHAR(20), -- success, partial, failed
    error_message TEXT,
    error_details JSONB
);

CREATE INDEX IF NOT EXISTS idx_quality_timestamp ON data_quality_logs (timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_quality_source ON data_quality_logs (source, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_quality_status ON data_quality_logs (status, timestamp DESC);

-- ==============================================
-- ALERTS & NOTIFICATIONS
-- ==============================================
CREATE TABLE IF NOT EXISTS alerts (
    id SERIAL PRIMARY KEY,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    alert_type VARCHAR(50) NOT NULL, -- new_setup, setup_invalidated, data_gap, model_drift
    severity VARCHAR(20) NOT NULL, -- info, warning, critical
    symbol VARCHAR(20),
    setup_id INTEGER REFERENCES trade_setups(id),
    title TEXT NOT NULL,
    message TEXT,
    metadata JSONB,
    -- Delivery status
    sent_telegram BOOLEAN DEFAULT FALSE,
    sent_email BOOLEAN DEFAULT FALSE,
    sent_webhook BOOLEAN DEFAULT FALSE,
    acknowledged BOOLEAN DEFAULT FALSE,
    acknowledged_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_alerts_type ON alerts (alert_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_severity ON alerts (severity, created_at DESC);

-- ==============================================
-- DATA RETENTION POLICIES
-- ==============================================

-- Keep raw 1m data for 7 days
SELECT add_retention_policy('market_data', INTERVAL '7 days', if_not_exists => TRUE);

-- Keep derivatives data for 90 days
SELECT add_retention_policy('derivatives_data', INTERVAL '90 days', if_not_exists => TRUE);

-- Keep orderbook snapshots for 3 days
SELECT add_retention_policy('orderbook_snapshots', INTERVAL '3 days', if_not_exists => TRUE);

-- Keep features for 180 days
SELECT add_retention_policy('feature_store', INTERVAL '180 days', if_not_exists => TRUE);

-- ==============================================
-- CONTINUOUS AGGREGATES (Materialized Views)
-- ==============================================

-- Hourly OHLCV aggregates
CREATE MATERIALIZED VIEW IF NOT EXISTS market_data_1h
WITH (timescaledb.continuous) AS
SELECT
    symbol,
    exchange,
    time_bucket('1 hour', timestamp) AS bucket,
    FIRST(open, timestamp) AS open,
    MAX(high) AS high,
    MIN(low) AS low,
    LAST(close, timestamp) AS close,
    SUM(volume) AS volume,
    SUM(quote_volume) AS quote_volume,
    SUM(trades_count) AS trades_count,
    SUM(taker_buy_volume) AS taker_buy_volume,
    SUM(taker_sell_volume) AS taker_sell_volume
FROM market_data
WHERE timeframe = '1m'
GROUP BY symbol, exchange, bucket
WITH NO DATA;

-- Daily OHLCV aggregates  
CREATE MATERIALIZED VIEW IF NOT EXISTS market_data_1d
WITH (timescaledb.continuous) AS
SELECT
    symbol,
    exchange,
    time_bucket('1 day', timestamp) AS bucket,
    FIRST(open, timestamp) AS open,
    MAX(high) AS high,
    MIN(low) AS low,
    LAST(close, timestamp) AS close,
    SUM(volume) AS volume,
    SUM(quote_volume) AS quote_volume,
    SUM(trades_count) AS trades_count
FROM market_data
WHERE timeframe = '1m'
GROUP BY symbol, exchange, bucket
WITH NO DATA;

-- Refresh policies for continuous aggregates
SELECT add_continuous_aggregate_policy('market_data_1h',
    start_offset => INTERVAL '3 hours',
    end_offset => INTERVAL '1 hour',
    schedule_interval => INTERVAL '1 hour',
    if_not_exists => TRUE
);

SELECT add_continuous_aggregate_policy('market_data_1d',
    start_offset => INTERVAL '3 days',
    end_offset => INTERVAL '1 day',
    schedule_interval => INTERVAL '1 day',
    if_not_exists => TRUE
);

-- ==============================================
-- HELPER FUNCTIONS
-- ==============================================

-- Function to get latest price
CREATE OR REPLACE FUNCTION get_latest_price(p_symbol VARCHAR)
RETURNS NUMERIC AS $$
DECLARE
    price NUMERIC;
BEGIN
    SELECT close INTO price
    FROM market_data
    WHERE symbol = p_symbol AND timeframe = '1m'
    ORDER BY timestamp DESC
    LIMIT 1;
    RETURN price;
END;
$$ LANGUAGE plpgsql;

-- Function to get latest regime
CREATE OR REPLACE FUNCTION get_latest_regime(p_symbol VARCHAR)
RETURNS VARCHAR AS $$
DECLARE
    regime VARCHAR;
BEGIN
    SELECT feature_value::VARCHAR INTO regime
    FROM feature_store
    WHERE symbol = p_symbol 
      AND feature_name = 'regime'
    ORDER BY timestamp DESC
    LIMIT 1;
    RETURN regime;
END;
$$ LANGUAGE plpgsql;

-- Function to check data freshness
CREATE OR REPLACE FUNCTION check_data_freshness(p_source VARCHAR, p_max_age_minutes INTEGER DEFAULT 15)
RETURNS TABLE(symbol VARCHAR, last_update TIMESTAMPTZ, age_minutes INTEGER, is_stale BOOLEAN) AS $$
BEGIN
    IF p_source = 'market_data' THEN
        RETURN QUERY
        SELECT 
            m.symbol,
            MAX(m.timestamp) as last_update,
            EXTRACT(EPOCH FROM (NOW() - MAX(m.timestamp)))::INTEGER / 60 as age_minutes,
            EXTRACT(EPOCH FROM (NOW() - MAX(m.timestamp)))::INTEGER / 60 > p_max_age_minutes as is_stale
        FROM market_data m
        WHERE m.timeframe = '1m'
        GROUP BY m.symbol;
    ELSIF p_source = 'derivatives_data' THEN
        RETURN QUERY
        SELECT 
            d.symbol,
            MAX(d.timestamp) as last_update,
            EXTRACT(EPOCH FROM (NOW() - MAX(d.timestamp)))::INTEGER / 60 as age_minutes,
            EXTRACT(EPOCH FROM (NOW() - MAX(d.timestamp)))::INTEGER / 60 > p_max_age_minutes as is_stale
        FROM derivatives_data d
        GROUP BY d.symbol;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- ==============================================
-- SEED DATA - Symbol Universe
-- ==============================================

INSERT INTO symbol_universe (symbol, base_asset, quote_asset, category, sector, exchanges, is_active, track_derivatives)
VALUES
    ('BTCUSDT', 'BTC', 'USDT', 'L1', 'Store of Value', ARRAY['binance', 'bybit', 'okx'], true, true),
    ('ETHUSDT', 'ETH', 'USDT', 'L1', 'Smart Contract Platform', ARRAY['binance', 'bybit', 'okx'], true, true),
    ('SOLUSDT', 'SOL', 'USDT', 'L1', 'Smart Contract Platform', ARRAY['binance', 'bybit', 'okx'], true, true),
    ('BNBUSDT', 'BNB', 'USDT', 'L1', 'Exchange Token', ARRAY['binance'], true, true),
    ('XRPUSDT', 'XRP', 'USDT', 'L1', 'Payments', ARRAY['binance', 'bybit'], true, true),
    ('ADAUSDT', 'ADA', 'USDT', 'L1', 'Smart Contract Platform', ARRAY['binance', 'bybit'], true, true),
    ('AVAXUSDT', 'AVAX', 'USDT', 'L1', 'Smart Contract Platform', ARRAY['binance', 'bybit'], true, true),
    ('DOTUSDT', 'DOT', 'USDT', 'L1', 'Interoperability', ARRAY['binance', 'bybit'], true, true),
    ('LINKUSDT', 'LINK', 'USDT', 'Infrastructure', 'Oracle', ARRAY['binance', 'bybit', 'okx'], true, true),
    ('MATICUSDT', 'MATIC', 'USDT', 'L2', 'Scaling', ARRAY['binance', 'bybit'], true, true),
    ('UNIUSDT', 'UNI', 'USDT', 'DeFi', 'DEX', ARRAY['binance', 'bybit'], true, true),
    ('AAVEUSDT', 'AAVE', 'USDT', 'DeFi', 'Lending', ARRAY['binance', 'bybit'], true, true),
    ('ATOMUSDT', 'ATOM', 'USDT', 'L1', 'Interoperability', ARRAY['binance', 'bybit'], true, true),
    ('LTCUSDT', 'LTC', 'USDT', 'L1', 'Payments', ARRAY['binance', 'bybit'], true, true),
    ('NEARUSDT', 'NEAR', 'USDT', 'L1', 'Smart Contract Platform', ARRAY['binance', 'bybit'], true, true),
    ('APTUSDT', 'APT', 'USDT', 'L1', 'Smart Contract Platform', ARRAY['binance', 'bybit'], true, true),
    ('OPUSDT', 'OP', 'USDT', 'L2', 'Scaling', ARRAY['binance', 'bybit'], true, true),
    ('ARBUSDT', 'ARB', 'USDT', 'L2', 'Scaling', ARRAY['binance', 'bybit'], true, true),
    ('INJUSDT', 'INJ', 'USDT', 'DeFi', 'Derivatives', ARRAY['binance', 'bybit'], true, true),
    ('SUIUSDT', 'SUI', 'USDT', 'L1', 'Smart Contract Platform', ARRAY['binance', 'bybit'], true, true),
    ('FTMUSDT', 'FTM', 'USDT', 'L1', 'Smart Contract Platform', ARRAY['binance', 'bybit'], true, true),
    ('RNDRUSDT', 'RNDR', 'USDT', 'Infrastructure', 'GPU Computing', ARRAY['binance', 'bybit'], true, true),
    ('GRTUSDT', 'GRT', 'USDT', 'Infrastructure', 'Indexing', ARRAY['binance', 'bybit'], true, true),
    ('MKRUSDT', 'MKR', 'USDT', 'DeFi', 'CDP', ARRAY['binance', 'bybit'], true, true),
    ('LDOUSDT', 'LDO', 'USDT', 'DeFi', 'Liquid Staking', ARRAY['binance', 'bybit'], true, true),
    ('SNXUSDT', 'SNX', 'USDT', 'DeFi', 'Synthetics', ARRAY['binance', 'bybit'], true, true),
    ('CRVUSDT', 'CRV', 'USDT', 'DeFi', 'DEX', ARRAY['binance', 'bybit'], true, true),
    ('GMXUSDT', 'GMX', 'USDT', 'DeFi', 'Derivatives', ARRAY['binance', 'bybit'], true, true),
    ('DYDXUSDT', 'DYDX', 'USDT', 'DeFi', 'Derivatives', ARRAY['binance', 'bybit'], true, true),
    ('PENDLEUSDT', 'PENDLE', 'USDT', 'DeFi', 'Yield', ARRAY['binance', 'bybit'], true, true)
ON CONFLICT (symbol) DO UPDATE SET
    updated_at = NOW();

COMMIT;
