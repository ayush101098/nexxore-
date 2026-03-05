-- ================================================================
-- Safe Yield Vault — Supabase Schema
-- Run this in the Supabase SQL Editor to create vault tables
-- ================================================================

-- Transaction log (deposits + withdrawals)
CREATE TABLE IF NOT EXISTS safe_yield_transactions (
    id           BIGSERIAL PRIMARY KEY,
    user_address TEXT        NOT NULL,
    tx_hash      TEXT        NOT NULL UNIQUE,
    tx_type      TEXT        NOT NULL CHECK (tx_type IN ('deposit', 'withdraw')),
    amount_usdc  NUMERIC     NOT NULL,
    shares       NUMERIC,
    network      TEXT        NOT NULL DEFAULT 'ethereum',
    block_number BIGINT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_syt_user    ON safe_yield_transactions(user_address);
CREATE INDEX IF NOT EXISTS idx_syt_type    ON safe_yield_transactions(tx_type);
CREATE INDEX IF NOT EXISTS idx_syt_time    ON safe_yield_transactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_syt_network ON safe_yield_transactions(network);

-- Row Level Security
ALTER TABLE safe_yield_transactions ENABLE ROW LEVEL SECURITY;

-- Policy: Anyone can read (public vault data)
CREATE POLICY "Public read safe_yield_transactions"
  ON safe_yield_transactions FOR SELECT
  USING (true);

-- Policy: Service role can insert/update
CREATE POLICY "Service insert safe_yield_transactions"
  ON safe_yield_transactions FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Service update safe_yield_transactions"
  ON safe_yield_transactions FOR UPDATE
  USING (true);

-- ================================================================
-- Vault snapshots (for TVL / APY tracking over time)
-- ================================================================
CREATE TABLE IF NOT EXISTS safe_yield_snapshots (
    id           BIGSERIAL PRIMARY KEY,
    total_assets NUMERIC     NOT NULL DEFAULT 0,
    total_shares NUMERIC     NOT NULL DEFAULT 0,
    share_price  NUMERIC     NOT NULL DEFAULT 1.0,
    blended_apy  NUMERIC,
    aave_apy     NUMERIC,
    compound_apy NUMERIC,
    maker_apy    NUMERIC,
    lido_apy     NUMERIC,
    risk_score   NUMERIC,
    network      TEXT        NOT NULL DEFAULT 'ethereum',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sys_time ON safe_yield_snapshots(created_at DESC);

-- ================================================================
-- Helper view: user position summary
-- ================================================================
CREATE OR REPLACE VIEW safe_yield_user_positions AS
SELECT
    user_address,
    network,
    SUM(CASE WHEN tx_type = 'deposit'  THEN amount_usdc ELSE 0 END) AS total_deposited,
    SUM(CASE WHEN tx_type = 'withdraw' THEN amount_usdc ELSE 0 END) AS total_withdrawn,
    SUM(CASE WHEN tx_type = 'deposit'  THEN amount_usdc ELSE 0 END)
  - SUM(CASE WHEN tx_type = 'withdraw' THEN amount_usdc ELSE 0 END) AS net_deposited,
    COUNT(*)                                                         AS tx_count,
    MAX(created_at)                                                  AS last_activity
FROM safe_yield_transactions
GROUP BY user_address, network;
