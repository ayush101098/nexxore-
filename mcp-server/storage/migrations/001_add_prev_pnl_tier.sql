-- Migration: add prev_pnl_tier to wallet_cohorts
-- Required by the tier_migration MCP tool.
-- Stores the previous PnL tier before each reclassification so we can
-- detect wallets that moved between tiers.

ALTER TABLE trading.wallet_cohorts
ADD COLUMN IF NOT EXISTS prev_pnl_tier TEXT;

COMMENT ON COLUMN trading.wallet_cohorts.prev_pnl_tier IS
    'PnL tier before most recent reclassification (set by classifier upsert)';
