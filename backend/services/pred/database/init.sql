-- ═══════════════════════════════════════════════════════════════════════════════
-- PREDICTION AGENT DATABASE SCHEMA
-- TimescaleDB / PostgreSQL - Optimized for Time-Series Queries
-- ═══════════════════════════════════════════════════════════════════════════════

-- Enable TimescaleDB extension
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- ═══════════════════════════════════════════════════════════════════════════════
-- LAYER 1: INTELLIGENCE ENGINE TABLES
-- ═══════════════════════════════════════════════════════════════════════════════

-- Market Events (Polymarket/Kalshi unified)
CREATE TABLE market_events (
    id SERIAL PRIMARY KEY,
    external_id VARCHAR(255) NOT NULL,
    platform VARCHAR(20) NOT NULL CHECK (platform IN ('polymarket', 'kalshi')),
    question TEXT NOT NULL,
    category VARCHAR(50),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    resolution_date TIMESTAMPTZ,
    resolved_at TIMESTAMPTZ,
    outcome BOOLEAN, -- NULL = unresolved, TRUE = yes, FALSE = no
    resolution_source VARCHAR(255),
    metadata JSONB DEFAULT '{}',
    UNIQUE(external_id, platform)
);

CREATE INDEX idx_market_events_platform ON market_events(platform);
CREATE INDEX idx_market_events_category ON market_events(category);
CREATE INDEX idx_market_events_resolution ON market_events(resolution_date);
CREATE INDEX idx_market_events_outcome ON market_events(outcome) WHERE outcome IS NOT NULL;

-- Model Forecasts (6 LLM predictions)
CREATE TABLE model_forecasts (
    id SERIAL PRIMARY KEY,
    event_id INTEGER REFERENCES market_events(id) ON DELETE CASCADE,
    model_name VARCHAR(50) NOT NULL CHECK (model_name IN ('gpt-4o', 'claude-3.5', 'gemini-pro', 'perplexity', 'mistral', 'deepseek')),
    probability DECIMAL(5,4) NOT NULL CHECK (probability >= 0 AND probability <= 1),
    confidence DECIMAL(5,4) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
    reasoning TEXT,
    tokens_used INTEGER,
    latency_ms INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    raw_response JSONB
);

-- Convert to hypertable for time-series optimization
SELECT create_hypertable('model_forecasts', 'created_at', if_not_exists => TRUE);

CREATE INDEX idx_forecasts_event ON model_forecasts(event_id);
CREATE INDEX idx_forecasts_model ON model_forecasts(model_name);
CREATE INDEX idx_forecasts_time ON model_forecasts(created_at DESC);

-- Model Performance (Rolling Brier Scores)
CREATE TABLE model_performance (
    id SERIAL PRIMARY KEY,
    model_name VARCHAR(50) NOT NULL,
    brier_score DECIMAL(8,6),
    rolling_brier_50 DECIMAL(8,6), -- Last 50 events
    rolling_brier_200 DECIMAL(8,6), -- Last 200 events
    calibration_score DECIMAL(8,6), -- How well-calibrated
    overconfidence_penalty DECIMAL(8,6),
    total_predictions INTEGER DEFAULT 0,
    correct_predictions INTEGER DEFAULT 0,
    weight DECIMAL(5,4) DEFAULT 0.1667, -- 1/6 default
    calculated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(model_name, calculated_at)
);

SELECT create_hypertable('model_performance', 'calculated_at', if_not_exists => TRUE);

CREATE INDEX idx_performance_model ON model_performance(model_name);

-- Consensus Forecasts (Weighted ensemble)
CREATE TABLE consensus_forecasts (
    id SERIAL PRIMARY KEY,
    event_id INTEGER REFERENCES market_events(id) ON DELETE CASCADE,
    fair_probability DECIMAL(5,4) NOT NULL,
    confidence_score DECIMAL(5,4),
    dispersion_metric DECIMAL(5,4), -- Std dev of models
    model_weights JSONB, -- {"gpt-4o": 0.2, "claude": 0.18, ...}
    individual_forecasts JSONB, -- Full breakdown
    created_at TIMESTAMPTZ DEFAULT NOW()
);

SELECT create_hypertable('consensus_forecasts', 'created_at', if_not_exists => TRUE);

-- ═══════════════════════════════════════════════════════════════════════════════
-- LAYER 2: MARKET ENGINE TABLES
-- ═══════════════════════════════════════════════════════════════════════════════

-- Real-time Order Books
CREATE TABLE order_books (
    id SERIAL PRIMARY KEY,
    event_id INTEGER REFERENCES market_events(id) ON DELETE CASCADE,
    platform VARCHAR(20) NOT NULL,
    timestamp TIMESTAMPTZ DEFAULT NOW(),
    best_bid DECIMAL(8,4),
    best_ask DECIMAL(8,4),
    bid_depth DECIMAL(12,2), -- Total $ at bid
    ask_depth DECIMAL(12,2), -- Total $ at ask
    spread DECIMAL(6,4),
    mid_price DECIMAL(8,4),
    full_book JSONB -- Full order book snapshot
);

SELECT create_hypertable('order_books', 'timestamp', if_not_exists => TRUE);

CREATE INDEX idx_orderbooks_event ON order_books(event_id, timestamp DESC);
CREATE INDEX idx_orderbooks_platform ON order_books(platform);

-- Fair Value Calculations
CREATE TABLE fair_values (
    id SERIAL PRIMARY KEY,
    event_id INTEGER REFERENCES market_events(id) ON DELETE CASCADE,
    ai_probability DECIMAL(5,4),
    market_price DECIMAL(8,4),
    edge DECIMAL(6,4), -- ai_prob - market_prob
    expected_value DECIMAL(10,4),
    kelly_fraction DECIMAL(6,4),
    liquidity_score DECIMAL(5,4),
    trade_signal VARCHAR(20) CHECK (trade_signal IN ('STRONG_BUY', 'BUY', 'HOLD', 'SELL', 'STRONG_SELL')),
    calculated_at TIMESTAMPTZ DEFAULT NOW()
);

SELECT create_hypertable('fair_values', 'calculated_at', if_not_exists => TRUE);

-- Arbitrage Opportunities
CREATE TABLE arbitrage_opportunities (
    id SERIAL PRIMARY KEY,
    event_id INTEGER REFERENCES market_events(id),
    poly_yes_price DECIMAL(8,4),
    poly_no_price DECIMAL(8,4),
    kalshi_yes_price DECIMAL(8,4),
    kalshi_no_price DECIMAL(8,4),
    total_cost DECIMAL(8,4), -- poly_yes + kalshi_no or vice versa
    guaranteed_profit DECIMAL(8,4),
    annualized_return DECIMAL(8,4),
    capital_efficiency DECIMAL(8,4),
    time_to_resolution INTEGER, -- Days
    detected_at TIMESTAMPTZ DEFAULT NOW(),
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'executed', 'expired', 'closed'))
);

SELECT create_hypertable('arbitrage_opportunities', 'detected_at', if_not_exists => TRUE);

-- News Impact Events
CREATE TABLE news_events (
    id SERIAL PRIMARY KEY,
    headline TEXT NOT NULL,
    source VARCHAR(100),
    author VARCHAR(100),
    authority_score DECIMAL(5,4), -- Source reliability
    sentiment DECIMAL(5,4) CHECK (sentiment >= -1 AND sentiment <= 1),
    relevance_scores JSONB, -- {event_id: relevance_score}
    delta_estimate DECIMAL(6,4), -- Predicted probability shift
    category VARCHAR(50),
    entities JSONB, -- Extracted entities
    published_at TIMESTAMPTZ,
    processed_at TIMESTAMPTZ DEFAULT NOW()
);

SELECT create_hypertable('news_events', 'processed_at', if_not_exists => TRUE);

CREATE INDEX idx_news_sentiment ON news_events(sentiment);
CREATE INDEX idx_news_published ON news_events(published_at DESC);

-- ═══════════════════════════════════════════════════════════════════════════════
-- LAYER 3: EXECUTION ENGINE TABLES
-- ═══════════════════════════════════════════════════════════════════════════════

-- Trade Execution Log
CREATE TABLE trade_executions (
    id SERIAL PRIMARY KEY,
    event_id INTEGER REFERENCES market_events(id),
    platform VARCHAR(20) NOT NULL,
    side VARCHAR(10) NOT NULL CHECK (side IN ('YES', 'NO')),
    action VARCHAR(10) NOT NULL CHECK (action IN ('BUY', 'SELL')),
    size DECIMAL(12,2) NOT NULL,
    price DECIMAL(8,4) NOT NULL,
    expected_ev DECIMAL(10,4),
    kelly_optimal DECIMAL(6,4),
    actual_fill_price DECIMAL(8,4),
    slippage DECIMAL(6,4),
    fees DECIMAL(10,4),
    order_id VARCHAR(255),
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'filled', 'partial', 'cancelled', 'rejected')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    executed_at TIMESTAMPTZ,
    metadata JSONB
);

SELECT create_hypertable('trade_executions', 'created_at', if_not_exists => TRUE);

CREATE INDEX idx_trades_event ON trade_executions(event_id);
CREATE INDEX idx_trades_status ON trade_executions(status);
CREATE INDEX idx_trades_platform ON trade_executions(platform);

-- Portfolio Positions
CREATE TABLE portfolio_positions (
    id SERIAL PRIMARY KEY,
    event_id INTEGER REFERENCES market_events(id),
    platform VARCHAR(20) NOT NULL,
    side VARCHAR(10) NOT NULL,
    quantity DECIMAL(12,4) NOT NULL,
    avg_entry_price DECIMAL(8,4) NOT NULL,
    current_price DECIMAL(8,4),
    unrealized_pnl DECIMAL(12,4),
    realized_pnl DECIMAL(12,4) DEFAULT 0,
    category VARCHAR(50),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(event_id, platform, side)
);

-- Risk Metrics
CREATE TABLE risk_metrics (
    id SERIAL PRIMARY KEY,
    timestamp TIMESTAMPTZ DEFAULT NOW(),
    total_exposure DECIMAL(14,2),
    category_exposures JSONB, -- {"politics": 5000, "crypto": 3000}
    current_drawdown DECIMAL(8,4),
    max_drawdown DECIMAL(8,4),
    sharpe_ratio DECIMAL(8,4),
    win_rate DECIMAL(5,4),
    total_trades INTEGER,
    total_pnl DECIMAL(14,2),
    daily_pnl DECIMAL(14,2)
);

SELECT create_hypertable('risk_metrics', 'timestamp', if_not_exists => TRUE);

-- Trade Performance (For Brier Score Calibration)
CREATE TABLE trade_performance (
    id SERIAL PRIMARY KEY,
    trade_id INTEGER REFERENCES trade_executions(id),
    event_id INTEGER REFERENCES market_events(id),
    entry_price DECIMAL(8,4),
    exit_price DECIMAL(8,4),
    predicted_probability DECIMAL(5,4),
    actual_outcome BOOLEAN,
    pnl DECIMAL(12,4),
    pnl_percentage DECIMAL(8,4),
    hold_time_hours INTEGER,
    resolved_at TIMESTAMPTZ
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- MATERIALIZED VIEWS FOR FAST QUERIES
-- ═══════════════════════════════════════════════════════════════════════════════

-- Latest model weights (for real-time consensus)
CREATE MATERIALIZED VIEW latest_model_weights AS
SELECT DISTINCT ON (model_name) 
    model_name,
    weight,
    rolling_brier_50,
    calculated_at
FROM model_performance
ORDER BY model_name, calculated_at DESC;

CREATE UNIQUE INDEX idx_latest_weights ON latest_model_weights(model_name);

-- Active arbitrage opportunities
CREATE MATERIALIZED VIEW active_arbitrage AS
SELECT * FROM arbitrage_opportunities
WHERE status = 'active'
  AND guaranteed_profit > 0.01
ORDER BY annualized_return DESC;

-- ═══════════════════════════════════════════════════════════════════════════════
-- CONTINUOUS AGGREGATES (TimescaleDB)
-- ═══════════════════════════════════════════════════════════════════════════════

-- Hourly model accuracy
CREATE MATERIALIZED VIEW model_hourly_accuracy
WITH (timescaledb.continuous) AS
SELECT 
    time_bucket('1 hour', mf.created_at) AS bucket,
    mf.model_name,
    COUNT(*) AS predictions,
    AVG(CASE WHEN me.outcome IS NOT NULL THEN 
        POWER(mf.probability - me.outcome::int, 2) 
    END) AS avg_brier_score
FROM model_forecasts mf
JOIN market_events me ON mf.event_id = me.id
GROUP BY bucket, mf.model_name;

-- Daily PnL aggregation
CREATE MATERIALIZED VIEW daily_pnl
WITH (timescaledb.continuous) AS
SELECT 
    time_bucket('1 day', created_at) AS day,
    platform,
    COUNT(*) AS trade_count,
    SUM(CASE WHEN status = 'filled' THEN (actual_fill_price - price) * size ELSE 0 END) AS pnl,
    AVG(slippage) AS avg_slippage
FROM trade_executions
GROUP BY day, platform;

-- ═══════════════════════════════════════════════════════════════════════════════
-- FUNCTIONS
-- ═══════════════════════════════════════════════════════════════════════════════

-- Calculate Brier Score for a model
CREATE OR REPLACE FUNCTION calculate_brier_score(p_model VARCHAR, p_limit INTEGER DEFAULT 50)
RETURNS DECIMAL AS $$
DECLARE
    result DECIMAL;
BEGIN
    SELECT AVG(POWER(mf.probability - me.outcome::int, 2))
    INTO result
    FROM model_forecasts mf
    JOIN market_events me ON mf.event_id = me.id
    WHERE mf.model_name = p_model
      AND me.outcome IS NOT NULL
    ORDER BY mf.created_at DESC
    LIMIT p_limit;
    
    RETURN COALESCE(result, 0.25); -- Default to 0.25 (random)
END;
$$ LANGUAGE plpgsql;

-- Update model weights based on Brier scores
CREATE OR REPLACE FUNCTION update_model_weights()
RETURNS VOID AS $$
DECLARE
    total_inverse_brier DECIMAL;
    model_record RECORD;
BEGIN
    -- Calculate total inverse Brier (for normalization)
    SELECT SUM(1.0 / GREATEST(calculate_brier_score(model_name), 0.01))
    INTO total_inverse_brier
    FROM (SELECT DISTINCT model_name FROM model_forecasts) m;
    
    -- Update each model's weight
    FOR model_record IN SELECT DISTINCT model_name FROM model_forecasts LOOP
        INSERT INTO model_performance (model_name, brier_score, rolling_brier_50, weight)
        VALUES (
            model_record.model_name,
            calculate_brier_score(model_record.model_name, 1000),
            calculate_brier_score(model_record.model_name, 50),
            (1.0 / GREATEST(calculate_brier_score(model_record.model_name, 50), 0.01)) / total_inverse_brier
        );
    END LOOP;
    
    -- Refresh materialized view
    REFRESH MATERIALIZED VIEW CONCURRENTLY latest_model_weights;
END;
$$ LANGUAGE plpgsql;

-- Kelly Criterion Calculator
CREATE OR REPLACE FUNCTION kelly_fraction(
    p_probability DECIMAL,
    p_odds DECIMAL,
    p_fraction DECIMAL DEFAULT 0.5
)
RETURNS DECIMAL AS $$
DECLARE
    decimal_odds DECIMAL;
    q DECIMAL;
    kelly DECIMAL;
BEGIN
    decimal_odds := (1.0 / p_odds) - 1;
    q := 1 - p_probability;
    kelly := (p_probability * decimal_odds - q) / decimal_odds;
    RETURN GREATEST(0, kelly * p_fraction);
END;
$$ LANGUAGE plpgsql;

-- ═══════════════════════════════════════════════════════════════════════════════
-- TRIGGERS
-- ═══════════════════════════════════════════════════════════════════════════════

-- Auto-update portfolio positions on trade execution
CREATE OR REPLACE FUNCTION update_portfolio_on_trade()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status = 'filled' THEN
        INSERT INTO portfolio_positions (event_id, platform, side, quantity, avg_entry_price)
        VALUES (NEW.event_id, NEW.platform, NEW.side, NEW.size, NEW.actual_fill_price)
        ON CONFLICT (event_id, platform, side) DO UPDATE SET
            quantity = portfolio_positions.quantity + NEW.size,
            avg_entry_price = (portfolio_positions.avg_entry_price * portfolio_positions.quantity + NEW.actual_fill_price * NEW.size) 
                             / (portfolio_positions.quantity + NEW.size),
            updated_at = NOW();
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_portfolio
AFTER UPDATE ON trade_executions
FOR EACH ROW
WHEN (OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION update_portfolio_on_trade();

-- ═══════════════════════════════════════════════════════════════════════════════
-- SEED DEFAULT MODEL WEIGHTS
-- ═══════════════════════════════════════════════════════════════════════════════

INSERT INTO model_performance (model_name, weight, brier_score, rolling_brier_50)
VALUES 
    ('gpt-4o', 0.20, 0.15, 0.15),
    ('claude-3.5', 0.18, 0.16, 0.16),
    ('gemini-pro', 0.15, 0.18, 0.18),
    ('perplexity', 0.17, 0.17, 0.17),
    ('mistral', 0.15, 0.19, 0.19),
    ('deepseek', 0.15, 0.19, 0.19);

REFRESH MATERIALIZED VIEW latest_model_weights;
