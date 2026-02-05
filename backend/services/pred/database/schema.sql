-- ═══════════════════════════════════════════════════════════════════════════════
-- PRED AGENT - TimescaleDB Schema
-- ═══════════════════════════════════════════════════════════════════════════════

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- ═══════════════════════════════════════════════════════════════════════════════
-- CORE TABLES
-- ═══════════════════════════════════════════════════════════════════════════════

-- Market events (prediction markets being tracked)
CREATE TABLE IF NOT EXISTS market_events (
    event_id VARCHAR(64) PRIMARY KEY,
    question TEXT NOT NULL,
    category VARCHAR(32),
    platform VARCHAR(32) NOT NULL,
    resolution_date TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    is_resolved BOOLEAN DEFAULT FALSE,
    outcome BOOLEAN,
    metadata JSONB DEFAULT '{}'
);

CREATE INDEX idx_events_platform ON market_events(platform);
CREATE INDEX idx_events_category ON market_events(category);
CREATE INDEX idx_events_resolution ON market_events(resolution_date);

-- Model forecasts (predictions from each AI model)
CREATE TABLE IF NOT EXISTS model_forecasts (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    event_id VARCHAR(64) REFERENCES market_events(event_id),
    model_name VARCHAR(32) NOT NULL,
    probability DECIMAL(5,4) NOT NULL CHECK (probability BETWEEN 0 AND 1),
    confidence DECIMAL(5,4) CHECK (confidence BETWEEN 0 AND 1),
    reasoning TEXT,
    latency_ms INTEGER,
    tokens_used INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

SELECT create_hypertable('model_forecasts', 'created_at', if_not_exists => TRUE);
CREATE INDEX idx_forecasts_event ON model_forecasts(event_id, created_at DESC);
CREATE INDEX idx_forecasts_model ON model_forecasts(model_name, created_at DESC);

-- Model performance (historical accuracy tracking)
CREATE TABLE IF NOT EXISTS model_performance (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    model_name VARCHAR(32) NOT NULL,
    rolling_brier_score DECIMAL(6,5),
    calibration_error DECIMAL(6,5),
    total_predictions INTEGER DEFAULT 0,
    correct_predictions INTEGER DEFAULT 0,
    overconfidence_penalty DECIMAL(5,4) DEFAULT 0,
    current_weight DECIMAL(5,4) DEFAULT 0.1667,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(model_name)
);

-- Insert default model performance records
INSERT INTO model_performance (model_name, current_weight) VALUES
    ('gpt-4o', 0.20),
    ('claude-3.5', 0.18),
    ('gemini-pro', 0.15),
    ('perplexity', 0.17),
    ('mistral', 0.15),
    ('deepseek', 0.15)
ON CONFLICT (model_name) DO NOTHING;

-- Consensus forecasts (weighted ensemble predictions)
CREATE TABLE IF NOT EXISTS consensus_forecasts (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    event_id VARCHAR(64) REFERENCES market_events(event_id),
    fair_probability DECIMAL(5,4) NOT NULL,
    confidence_score DECIMAL(5,4),
    dispersion_metric DECIMAL(5,4),
    model_weights JSONB,
    recommendation VARCHAR(16),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

SELECT create_hypertable('consensus_forecasts', 'created_at', if_not_exists => TRUE);

-- ═══════════════════════════════════════════════════════════════════════════════
-- MARKET DATA TABLES
-- ═══════════════════════════════════════════════════════════════════════════════

-- Order book snapshots
CREATE TABLE IF NOT EXISTS order_books (
    id UUID DEFAULT uuid_generate_v4(),
    event_id VARCHAR(64) REFERENCES market_events(event_id),
    platform VARCHAR(32) NOT NULL,
    yes_price DECIMAL(5,4) NOT NULL,
    no_price DECIMAL(5,4) NOT NULL,
    yes_volume DECIMAL(18,2),
    no_volume DECIMAL(18,2),
    liquidity DECIMAL(18,2),
    spread DECIMAL(5,4),
    captured_at TIMESTAMPTZ DEFAULT NOW()
);

SELECT create_hypertable('order_books', 'captured_at', if_not_exists => TRUE);
CREATE INDEX idx_orderbooks_event ON order_books(event_id, captured_at DESC);

-- Fair value calculations
CREATE TABLE IF NOT EXISTS fair_values (
    id UUID DEFAULT uuid_generate_v4(),
    event_id VARCHAR(64) REFERENCES market_events(event_id),
    consensus_prob DECIMAL(5,4) NOT NULL,
    fair_value DECIMAL(5,4) NOT NULL,
    market_price DECIMAL(5,4),
    edge DECIMAL(5,4),
    edge_percent DECIMAL(7,4),
    kelly_fraction DECIMAL(5,4),
    expected_value DECIMAL(10,4),
    risk_adjusted_edge DECIMAL(5,4),
    recommended_side VARCHAR(8),
    signal_strength VARCHAR(16),
    calculated_at TIMESTAMPTZ DEFAULT NOW()
);

SELECT create_hypertable('fair_values', 'calculated_at', if_not_exists => TRUE);

-- Arbitrage opportunities
CREATE TABLE IF NOT EXISTS arbitrage_opportunities (
    id UUID DEFAULT uuid_generate_v4(),
    canonical_id VARCHAR(32),
    question TEXT,
    buy_platform VARCHAR(32) NOT NULL,
    buy_price DECIMAL(5,4) NOT NULL,
    sell_platform VARCHAR(32) NOT NULL,
    sell_price DECIMAL(5,4) NOT NULL,
    gross_spread DECIMAL(5,4),
    net_spread DECIMAL(5,4),
    estimated_profit_pct DECIMAL(7,4),
    max_size DECIMAL(18,2),
    confidence DECIMAL(5,4),
    detected_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    status VARCHAR(16) DEFAULT 'OPEN'
);

SELECT create_hypertable('arbitrage_opportunities', 'detected_at', if_not_exists => TRUE);

-- ═══════════════════════════════════════════════════════════════════════════════
-- NEWS & SENTIMENT TABLES
-- ═══════════════════════════════════════════════════════════════════════════════

-- News articles
CREATE TABLE IF NOT EXISTS news_articles (
    id VARCHAR(64) PRIMARY KEY,
    title TEXT NOT NULL,
    summary TEXT,
    source VARCHAR(64),
    url TEXT,
    published_at TIMESTAMPTZ,
    raw_sentiment DECIMAL(4,3),
    entities TEXT[],
    keywords TEXT[],
    processed_at TIMESTAMPTZ DEFAULT NOW()
);

-- News impacts on events
CREATE TABLE IF NOT EXISTS news_impacts (
    id UUID DEFAULT uuid_generate_v4(),
    article_id VARCHAR(64) REFERENCES news_articles(id),
    event_id VARCHAR(64) REFERENCES market_events(event_id),
    impact_level VARCHAR(16),
    sentiment_direction VARCHAR(16),
    probability_shift DECIMAL(5,4),
    confidence DECIMAL(5,4),
    reasoning TEXT,
    processed_at TIMESTAMPTZ DEFAULT NOW()
);

SELECT create_hypertable('news_impacts', 'processed_at', if_not_exists => TRUE);

-- ═══════════════════════════════════════════════════════════════════════════════
-- EXECUTION TABLES
-- ═══════════════════════════════════════════════════════════════════════════════

-- Trade orders
CREATE TABLE IF NOT EXISTS orders (
    order_id VARCHAR(64) PRIMARY KEY,
    event_id VARCHAR(64) REFERENCES market_events(event_id),
    platform VARCHAR(32) NOT NULL,
    side VARCHAR(8) NOT NULL CHECK (side IN ('YES', 'NO')),
    size_usd DECIMAL(18,2) NOT NULL,
    price DECIMAL(5,4) NOT NULL,
    order_type VARCHAR(16) DEFAULT 'MARKET',
    stop_loss DECIMAL(5,4),
    take_profit DECIMAL(5,4),
    status VARCHAR(16) DEFAULT 'PENDING',
    rejection_reason VARCHAR(32),
    executed_price DECIMAL(5,4),
    executed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_orders_event ON orders(event_id);
CREATE INDEX idx_orders_status ON orders(status);

-- Portfolio positions
CREATE TABLE IF NOT EXISTS positions (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    event_id VARCHAR(64) REFERENCES market_events(event_id),
    platform VARCHAR(32) NOT NULL,
    side VARCHAR(8) NOT NULL,
    size_usd DECIMAL(18,2) NOT NULL,
    avg_entry_price DECIMAL(5,4) NOT NULL,
    current_price DECIMAL(5,4),
    unrealized_pnl DECIMAL(18,4) DEFAULT 0,
    realized_pnl DECIMAL(18,4) DEFAULT 0,
    opened_at TIMESTAMPTZ DEFAULT NOW(),
    closed_at TIMESTAMPTZ,
    is_active BOOLEAN DEFAULT TRUE,
    UNIQUE(event_id, platform, is_active) -- One active position per event/platform
);

-- Trade executions log
CREATE TABLE IF NOT EXISTS trade_executions (
    id UUID DEFAULT uuid_generate_v4(),
    order_id VARCHAR(64) REFERENCES orders(order_id),
    position_id UUID REFERENCES positions(id),
    event_id VARCHAR(64),
    side VARCHAR(8) NOT NULL,
    size_usd DECIMAL(18,2) NOT NULL,
    entry_price DECIMAL(5,4),
    exit_price DECIMAL(5,4),
    pnl DECIMAL(18,4),
    fees DECIMAL(18,4) DEFAULT 0,
    executed_at TIMESTAMPTZ DEFAULT NOW()
);

SELECT create_hypertable('trade_executions', 'executed_at', if_not_exists => TRUE);

-- Risk metrics snapshots
CREATE TABLE IF NOT EXISTS risk_metrics (
    id UUID DEFAULT uuid_generate_v4(),
    total_equity DECIMAL(18,2),
    total_exposure DECIMAL(18,2),
    exposure_pct DECIMAL(7,4),
    daily_pnl DECIMAL(18,4),
    daily_pnl_pct DECIMAL(7,4),
    max_drawdown DECIMAL(7,4),
    current_drawdown DECIMAL(7,4),
    sharpe_ratio DECIMAL(7,4),
    win_rate DECIMAL(5,4),
    position_count INTEGER,
    circuit_breaker_active BOOLEAN DEFAULT FALSE,
    captured_at TIMESTAMPTZ DEFAULT NOW()
);

SELECT create_hypertable('risk_metrics', 'captured_at', if_not_exists => TRUE);

-- ═══════════════════════════════════════════════════════════════════════════════
-- FUNCTIONS
-- ═══════════════════════════════════════════════════════════════════════════════

-- Calculate Brier score for a forecast
CREATE OR REPLACE FUNCTION calculate_brier_score(forecast DECIMAL, outcome BOOLEAN)
RETURNS DECIMAL AS $$
BEGIN
    RETURN POWER(forecast - CASE WHEN outcome THEN 1 ELSE 0 END, 2);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Calculate Kelly fraction
CREATE OR REPLACE FUNCTION kelly_fraction(fair_value DECIMAL, market_price DECIMAL)
RETURNS DECIMAL AS $$
BEGIN
    IF market_price <= 0 OR market_price >= 1 THEN
        RETURN 0;
    END IF;
    RETURN (fair_value - market_price) / (1 - market_price);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Update model weights from Brier scores
CREATE OR REPLACE FUNCTION update_model_weights()
RETURNS TRIGGER AS $$
DECLARE
    total_inverse DECIMAL;
BEGIN
    -- Calculate total inverse Brier score
    SELECT SUM(1.0 / GREATEST(rolling_brier_score, 0.01))
    INTO total_inverse
    FROM model_performance;
    
    -- Update weights
    UPDATE model_performance
    SET current_weight = (1.0 / GREATEST(rolling_brier_score, 0.01)) / total_inverse,
        updated_at = NOW();
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ═══════════════════════════════════════════════════════════════════════════════
-- MATERIALIZED VIEWS
-- ═══════════════════════════════════════════════════════════════════════════════

-- Recent performance by model (last 30 days)
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_model_recent_performance AS
SELECT 
    mf.model_name,
    COUNT(*) as total_forecasts,
    AVG(calculate_brier_score(mf.probability, me.outcome)) as avg_brier,
    AVG(mf.confidence) as avg_confidence,
    AVG(mf.latency_ms) as avg_latency_ms,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY mf.probability) as median_prob
FROM model_forecasts mf
JOIN market_events me ON mf.event_id = me.event_id
WHERE me.is_resolved = TRUE
  AND mf.created_at > NOW() - INTERVAL '30 days'
GROUP BY mf.model_name;

-- Arbitrage summary
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_arbitrage_summary AS
SELECT 
    DATE_TRUNC('day', detected_at) as day,
    COUNT(*) as opportunities_found,
    AVG(net_spread) as avg_net_spread,
    SUM(max_size * net_spread) as total_opportunity_value,
    COUNT(CASE WHEN status = 'EXECUTED' THEN 1 END) as opportunities_executed
FROM arbitrage_opportunities
WHERE detected_at > NOW() - INTERVAL '30 days'
GROUP BY DATE_TRUNC('day', detected_at)
ORDER BY day DESC;

-- Daily P&L
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_daily_pnl AS
SELECT 
    DATE_TRUNC('day', executed_at) as day,
    COUNT(*) as trade_count,
    SUM(pnl) as total_pnl,
    SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END)::DECIMAL / NULLIF(COUNT(*), 0) as win_rate,
    AVG(CASE WHEN pnl > 0 THEN pnl END) as avg_win,
    AVG(CASE WHEN pnl < 0 THEN pnl END) as avg_loss
FROM trade_executions
WHERE executed_at > NOW() - INTERVAL '90 days'
GROUP BY DATE_TRUNC('day', executed_at)
ORDER BY day DESC;

-- ═══════════════════════════════════════════════════════════════════════════════
-- REFRESH FUNCTIONS
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION refresh_all_materialized_views()
RETURNS void AS $$
BEGIN
    REFRESH MATERIALIZED VIEW mv_model_recent_performance;
    REFRESH MATERIALIZED VIEW mv_arbitrage_summary;
    REFRESH MATERIALIZED VIEW mv_daily_pnl;
END;
$$ LANGUAGE plpgsql;

-- Schedule refresh (requires pg_cron extension)
-- SELECT cron.schedule('refresh-mv', '0 * * * *', 'SELECT refresh_all_materialized_views()');

-- ═══════════════════════════════════════════════════════════════════════════════
-- INDEXES FOR COMMON QUERIES
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_positions_active ON positions(is_active) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_orders_pending ON orders(status) WHERE status = 'PENDING';
CREATE INDEX IF NOT EXISTS idx_arb_open ON arbitrage_opportunities(status) WHERE status = 'OPEN';

-- Grant permissions
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO pred_user;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO pred_user;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO pred_user;
