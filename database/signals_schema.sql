-- ============================================================================
-- Nexxore Alpha Signal Tracking Schema
-- Track all signals, mock positions, and performance metrics
-- ============================================================================

-- Alpha Signals Table
-- Stores all generated alpha signals from the detection agent
CREATE TABLE IF NOT EXISTS alpha_signals (
    id SERIAL PRIMARY KEY,
    signal_id VARCHAR(64) UNIQUE NOT NULL,
    
    -- Signal identification
    protocol VARCHAR(100) NOT NULL,
    chain VARCHAR(50) NOT NULL,
    token_symbol VARCHAR(20),
    token_address VARCHAR(255),
    
    -- Signal type and action
    signal_type VARCHAR(50) NOT NULL,  -- 'yield', 'momentum', 'arbitrage', 'liquidity', 'governance'
    action VARCHAR(20) NOT NULL,        -- 'BUY', 'SELL', 'PROVIDE_LP', 'STAKE', 'UNSTAKE'
    
    -- Scoring
    alpha_score INTEGER NOT NULL,       -- 0-100
    confidence DECIMAL(5,2) NOT NULL,   -- 0-100%
    risk_level VARCHAR(20) NOT NULL,    -- 'LOW', 'MEDIUM', 'HIGH', 'EXTREME'
    
    -- Price data at signal time
    entry_price DECIMAL(30,18),
    target_price DECIMAL(30,18),
    stop_loss_price DECIMAL(30,18),
    
    -- Expected returns
    expected_return_pct DECIMAL(10,4),  -- Expected % return
    expected_apy DECIMAL(10,4),         -- For yield signals
    time_horizon_hours INTEGER,         -- Expected holding period
    
    -- Source data
    tvl_at_signal DECIMAL(30,2),
    volume_24h DECIMAL(30,2),
    sentiment_score INTEGER,            -- -100 to 100
    
    -- Metadata
    reasoning TEXT,                     -- AI explanation
    news_context TEXT,                  -- Related news
    raw_data JSONB,                     -- Full signal data
    
    -- Timestamps
    generated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMP,
    
    -- Status tracking
    status VARCHAR(20) DEFAULT 'ACTIVE', -- 'ACTIVE', 'EXPIRED', 'EXECUTED', 'CANCELLED'
    
    CONSTRAINT valid_alpha_score CHECK (alpha_score >= 0 AND alpha_score <= 100),
    CONSTRAINT valid_confidence CHECK (confidence >= 0 AND confidence <= 100)
);

CREATE INDEX idx_signals_protocol ON alpha_signals(protocol);
CREATE INDEX idx_signals_chain ON alpha_signals(chain);
CREATE INDEX idx_signals_type ON alpha_signals(signal_type);
CREATE INDEX idx_signals_score ON alpha_signals(alpha_score DESC);
CREATE INDEX idx_signals_status ON alpha_signals(status);
CREATE INDEX idx_signals_generated ON alpha_signals(generated_at DESC);

-- ============================================================================
-- Mock Trading Positions
-- Paper trade positions based on signals
-- ============================================================================

CREATE TABLE IF NOT EXISTS mock_positions (
    id SERIAL PRIMARY KEY,
    position_id VARCHAR(64) UNIQUE NOT NULL,
    signal_id VARCHAR(64) REFERENCES alpha_signals(signal_id),
    
    -- Position details
    protocol VARCHAR(100) NOT NULL,
    chain VARCHAR(50) NOT NULL,
    token_symbol VARCHAR(20),
    token_address VARCHAR(255),
    
    -- Position type
    position_type VARCHAR(20) NOT NULL,  -- 'LONG', 'SHORT', 'LP', 'STAKE'
    
    -- Entry details
    entry_price DECIMAL(30,18) NOT NULL,
    entry_amount DECIMAL(30,18) NOT NULL,  -- In base currency (e.g., USDC)
    entry_quantity DECIMAL(30,18),          -- In tokens
    entry_timestamp TIMESTAMP NOT NULL DEFAULT NOW(),
    
    -- Current state
    current_price DECIMAL(30,18),
    current_value DECIMAL(30,18),
    unrealized_pnl DECIMAL(30,18) DEFAULT 0,
    unrealized_pnl_pct DECIMAL(10,4) DEFAULT 0,
    
    -- Risk management
    stop_loss_price DECIMAL(30,18),
    take_profit_price DECIMAL(30,18),
    trailing_stop_pct DECIMAL(5,2),
    
    -- Exit details (filled when position closes)
    exit_price DECIMAL(30,18),
    exit_timestamp TIMESTAMP,
    exit_reason VARCHAR(50),  -- 'TAKE_PROFIT', 'STOP_LOSS', 'MANUAL', 'EXPIRED', 'SIGNAL_REVERSED'
    
    -- Realized P&L
    realized_pnl DECIMAL(30,18),
    realized_pnl_pct DECIMAL(10,4),
    fees_paid DECIMAL(30,18) DEFAULT 0,
    
    -- Status
    status VARCHAR(20) DEFAULT 'OPEN',  -- 'OPEN', 'CLOSED', 'LIQUIDATED'
    
    -- Timestamps
    last_updated TIMESTAMP DEFAULT NOW(),
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_positions_signal ON mock_positions(signal_id);
CREATE INDEX idx_positions_status ON mock_positions(status);
CREATE INDEX idx_positions_protocol ON mock_positions(protocol);
CREATE INDEX idx_positions_entry_time ON mock_positions(entry_timestamp DESC);

-- ============================================================================
-- Position History / Trade Log
-- Detailed log of all position changes
-- ============================================================================

CREATE TABLE IF NOT EXISTS position_history (
    id SERIAL PRIMARY KEY,
    position_id VARCHAR(64) REFERENCES mock_positions(position_id),
    
    -- Event type
    event_type VARCHAR(30) NOT NULL,  -- 'OPEN', 'PARTIAL_CLOSE', 'ADD', 'CLOSE', 'PRICE_UPDATE', 'STOP_TRIGGERED'
    
    -- Values at event
    price_at_event DECIMAL(30,18),
    quantity_changed DECIMAL(30,18),
    value_changed DECIMAL(30,18),
    pnl_at_event DECIMAL(30,18),
    
    -- Metadata
    notes TEXT,
    triggered_by VARCHAR(50),  -- 'MANUAL', 'AUTO', 'STOP_LOSS', 'TAKE_PROFIT', 'TRAILING_STOP'
    
    -- Timestamp
    event_timestamp TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_history_position ON position_history(position_id);
CREATE INDEX idx_history_timestamp ON position_history(event_timestamp DESC);

-- ============================================================================
-- Signal Performance Metrics
-- Aggregate performance tracking per signal
-- ============================================================================

CREATE TABLE IF NOT EXISTS signal_performance (
    id SERIAL PRIMARY KEY,
    signal_id VARCHAR(64) UNIQUE REFERENCES alpha_signals(signal_id),
    
    -- Outcome
    outcome VARCHAR(20),  -- 'WIN', 'LOSS', 'BREAKEVEN', 'PENDING'
    
    -- Price tracking
    price_at_signal DECIMAL(30,18),
    price_1h DECIMAL(30,18),
    price_4h DECIMAL(30,18),
    price_24h DECIMAL(30,18),
    price_7d DECIMAL(30,18),
    price_30d DECIMAL(30,18),
    
    -- Returns
    return_1h DECIMAL(10,4),
    return_4h DECIMAL(10,4),
    return_24h DECIMAL(10,4),
    return_7d DECIMAL(10,4),
    return_30d DECIMAL(10,4),
    max_return DECIMAL(10,4),       -- Best return achieved
    max_drawdown DECIMAL(10,4),     -- Worst drawdown from entry
    
    -- Target achievement
    hit_target BOOLEAN DEFAULT FALSE,
    hit_stop_loss BOOLEAN DEFAULT FALSE,
    time_to_target_hours INTEGER,
    time_to_stop_hours INTEGER,
    
    -- Scoring
    actual_vs_expected DECIMAL(10,4),  -- Actual return / Expected return
    
    -- Timestamps
    first_check TIMESTAMP,
    last_check TIMESTAMP,
    
    CONSTRAINT valid_outcome CHECK (outcome IN ('WIN', 'LOSS', 'BREAKEVEN', 'PENDING', NULL))
);

CREATE INDEX idx_perf_outcome ON signal_performance(outcome);
CREATE INDEX idx_perf_signal ON signal_performance(signal_id);

-- ============================================================================
-- Daily Performance Summary
-- Aggregate daily stats for dashboard
-- ============================================================================

CREATE TABLE IF NOT EXISTS daily_performance (
    id SERIAL PRIMARY KEY,
    date DATE UNIQUE NOT NULL,
    
    -- Signal counts
    signals_generated INTEGER DEFAULT 0,
    signals_executed INTEGER DEFAULT 0,
    
    -- Position stats
    positions_opened INTEGER DEFAULT 0,
    positions_closed INTEGER DEFAULT 0,
    
    -- P&L
    total_pnl DECIMAL(30,18) DEFAULT 0,
    winning_trades INTEGER DEFAULT 0,
    losing_trades INTEGER DEFAULT 0,
    
    -- Win rate
    win_rate DECIMAL(5,2),  -- percentage
    
    -- Best/Worst
    best_trade_pnl DECIMAL(30,18),
    worst_trade_pnl DECIMAL(30,18),
    best_signal_id VARCHAR(64),
    worst_signal_id VARCHAR(64),
    
    -- Portfolio value
    portfolio_value_start DECIMAL(30,18),
    portfolio_value_end DECIMAL(30,18),
    portfolio_return_pct DECIMAL(10,4),
    
    -- By signal type
    yield_signals_count INTEGER DEFAULT 0,
    momentum_signals_count INTEGER DEFAULT 0,
    arbitrage_signals_count INTEGER DEFAULT 0,
    
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_daily_date ON daily_performance(date DESC);

-- ============================================================================
-- Strategy Performance
-- Track performance by strategy type
-- ============================================================================

CREATE TABLE IF NOT EXISTS strategy_performance (
    id SERIAL PRIMARY KEY,
    strategy_type VARCHAR(50) NOT NULL,  -- 'yield', 'momentum', etc.
    
    -- Lifetime stats
    total_signals INTEGER DEFAULT 0,
    total_positions INTEGER DEFAULT 0,
    winning_positions INTEGER DEFAULT 0,
    losing_positions INTEGER DEFAULT 0,
    
    -- P&L
    total_pnl DECIMAL(30,18) DEFAULT 0,
    avg_pnl_per_trade DECIMAL(30,18),
    best_trade DECIMAL(30,18),
    worst_trade DECIMAL(30,18),
    
    -- Rates
    win_rate DECIMAL(5,2),
    avg_holding_time_hours DECIMAL(10,2),
    
    -- Risk metrics
    sharpe_ratio DECIMAL(10,4),
    max_drawdown DECIMAL(10,4),
    profit_factor DECIMAL(10,4),  -- Total wins / Total losses
    
    last_updated TIMESTAMP DEFAULT NOW(),
    
    UNIQUE(strategy_type)
);

-- ============================================================================
-- Protocol Performance
-- Track performance by protocol
-- ============================================================================

CREATE TABLE IF NOT EXISTS protocol_performance (
    id SERIAL PRIMARY KEY,
    protocol VARCHAR(100) NOT NULL,
    chain VARCHAR(50) NOT NULL,
    
    -- Stats
    total_signals INTEGER DEFAULT 0,
    total_positions INTEGER DEFAULT 0,
    winning_positions INTEGER DEFAULT 0,
    losing_positions INTEGER DEFAULT 0,
    
    -- P&L
    total_pnl DECIMAL(30,18) DEFAULT 0,
    avg_pnl_per_trade DECIMAL(30,18),
    
    -- Rates
    win_rate DECIMAL(5,2),
    avg_alpha_score DECIMAL(5,2),
    
    last_updated TIMESTAMP DEFAULT NOW(),
    
    UNIQUE(protocol, chain)
);

CREATE INDEX idx_protocol_perf ON protocol_performance(protocol);

-- ============================================================================
-- Mock Portfolio State
-- Current portfolio balances and allocations
-- ============================================================================

CREATE TABLE IF NOT EXISTS mock_portfolio (
    id SERIAL PRIMARY KEY,
    
    -- Balance
    total_capital DECIMAL(30,18) DEFAULT 100000,  -- Start with $100k
    available_capital DECIMAL(30,18) DEFAULT 100000,
    allocated_capital DECIMAL(30,18) DEFAULT 0,
    
    -- P&L
    total_realized_pnl DECIMAL(30,18) DEFAULT 0,
    total_unrealized_pnl DECIMAL(30,18) DEFAULT 0,
    
    -- Stats
    total_trades INTEGER DEFAULT 0,
    winning_trades INTEGER DEFAULT 0,
    losing_trades INTEGER DEFAULT 0,
    
    -- Risk settings
    max_position_size DECIMAL(30,18) DEFAULT 10000,  -- Max $10k per position
    max_portfolio_risk_pct DECIMAL(5,2) DEFAULT 20,  -- Max 20% at risk
    
    last_updated TIMESTAMP DEFAULT NOW(),
    created_at TIMESTAMP DEFAULT NOW()
);

-- Initialize portfolio
INSERT INTO mock_portfolio (total_capital, available_capital) 
VALUES (100000, 100000)
ON CONFLICT DO NOTHING;

-- ============================================================================
-- Price Cache
-- Cache historical prices for performance tracking
-- ============================================================================

CREATE TABLE IF NOT EXISTS price_cache (
    id SERIAL PRIMARY KEY,
    token_address VARCHAR(255) NOT NULL,
    chain VARCHAR(50) NOT NULL,
    
    price DECIMAL(30,18) NOT NULL,
    timestamp TIMESTAMP NOT NULL,
    source VARCHAR(50),  -- 'coingecko', 'dexscreener', etc.
    
    UNIQUE(token_address, chain, timestamp)
);

CREATE INDEX idx_price_token ON price_cache(token_address, chain);
CREATE INDEX idx_price_timestamp ON price_cache(timestamp DESC);

-- ============================================================================
-- Alert Settings
-- Configure alerts for signal performance
-- ============================================================================

CREATE TABLE IF NOT EXISTS alert_settings (
    id SERIAL PRIMARY KEY,
    
    alert_type VARCHAR(50) NOT NULL,  -- 'STOP_LOSS_HIT', 'TARGET_HIT', 'NEW_SIGNAL', etc.
    enabled BOOLEAN DEFAULT TRUE,
    
    -- Thresholds
    threshold_value DECIMAL(10,4),
    
    -- Notification channels
    notify_telegram BOOLEAN DEFAULT TRUE,
    notify_email BOOLEAN DEFAULT FALSE,
    
    created_at TIMESTAMP DEFAULT NOW(),
    
    UNIQUE(alert_type)
);

-- Default alerts
INSERT INTO alert_settings (alert_type, enabled, threshold_value) VALUES
    ('NEW_HIGH_ALPHA_SIGNAL', TRUE, 80),     -- Alert when alpha score > 80
    ('STOP_LOSS_HIT', TRUE, NULL),
    ('TARGET_HIT', TRUE, NULL),
    ('DAILY_SUMMARY', TRUE, NULL),
    ('DRAWDOWN_WARNING', TRUE, -10),          -- Alert at -10% drawdown
    ('WINNING_STREAK', TRUE, 5)               -- Alert on 5+ winning trades
ON CONFLICT (alert_type) DO NOTHING;
