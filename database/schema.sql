-- Nexxore Vault Database Schema

-- User Shares Table
CREATE TABLE IF NOT EXISTS user_shares (
    id SERIAL PRIMARY KEY,
    chain VARCHAR(50) NOT NULL,
    asset VARCHAR(50) NOT NULL,
    user_address VARCHAR(255) NOT NULL,
    shares TEXT NOT NULL,
    updated_at TIMESTAMP DEFAULT NOW(),
    vault_address VARCHAR(255),
    UNIQUE(chain, asset, user_address)
);

CREATE INDEX idx_user_shares_user ON user_shares(user_address);
CREATE INDEX idx_user_shares_chain_asset ON user_shares(chain, asset);

-- Deposits Table
CREATE TABLE IF NOT EXISTS deposits (
    id SERIAL PRIMARY KEY,
    chain VARCHAR(50) NOT NULL,
    asset VARCHAR(50) NOT NULL,
    user_address VARCHAR(255) NOT NULL,
    assets TEXT NOT NULL,
    shares TEXT NOT NULL,
    timestamp TIMESTAMP NOT NULL,
    tx_hash VARCHAR(255) NOT NULL,
    block_number BIGINT,
    log_index INTEGER,
    UNIQUE(tx_hash, log_index)
);

CREATE INDEX idx_deposits_user ON deposits(user_address);
CREATE INDEX idx_deposits_chain ON deposits(chain);
CREATE INDEX idx_deposits_timestamp ON deposits(timestamp DESC);

-- Withdrawals Table
CREATE TABLE IF NOT EXISTS withdrawals (
    id SERIAL PRIMARY KEY,
    chain VARCHAR(50) NOT NULL,
    asset VARCHAR(50) NOT NULL,
    user_address VARCHAR(255) NOT NULL,
    assets TEXT NOT NULL,
    shares TEXT NOT NULL,
    timestamp TIMESTAMP NOT NULL,
    tx_hash VARCHAR(255) NOT NULL,
    block_number BIGINT,
    log_index INTEGER,
    UNIQUE(tx_hash, log_index)
);

CREATE INDEX idx_withdrawals_user ON withdrawals(user_address);
CREATE INDEX idx_withdrawals_chain ON withdrawals(chain);
CREATE INDEX idx_withdrawals_timestamp ON withdrawals(timestamp DESC);

-- Indexer State Table
CREATE TABLE IF NOT EXISTS indexer_state (
    id SERIAL PRIMARY KEY,
    chain VARCHAR(50) NOT NULL,
    asset VARCHAR(50) NOT NULL,
    last_block BIGINT NOT NULL,
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(chain, asset)
);

-- Solana Transactions Table
CREATE TABLE IF NOT EXISTS solana_transactions (
    id SERIAL PRIMARY KEY,
    signature VARCHAR(255) UNIQUE NOT NULL,
    indexed_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_solana_tx_signature ON solana_transactions(signature);

-- Bitcoin Vault Addresses Table
CREATE TABLE IF NOT EXISTS btc_vault_addresses (
    id SERIAL PRIMARY KEY,
    user_address VARCHAR(255) NOT NULL,
    btc_address VARCHAR(255) UNIQUE NOT NULL,
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_btc_vault_user ON btc_vault_addresses(user_address);
CREATE INDEX idx_btc_vault_address ON btc_vault_addresses(btc_address);

-- Bitcoin Deposits Table
CREATE TABLE IF NOT EXISTS btc_deposits (
    id SERIAL PRIMARY KEY,
    vault_address VARCHAR(255) NOT NULL,
    user_address VARCHAR(255),
    txid VARCHAR(255) NOT NULL,
    vout_index INTEGER NOT NULL,
    amount BIGINT NOT NULL,
    confirmations INTEGER DEFAULT 0,
    timestamp TIMESTAMP NOT NULL,
    status VARCHAR(20) DEFAULT 'pending',
    UNIQUE(txid, vout_index)
);

CREATE INDEX idx_btc_deposits_vault ON btc_deposits(vault_address);
CREATE INDEX idx_btc_deposits_user ON btc_deposits(user_address);
CREATE INDEX idx_btc_deposits_status ON btc_deposits(status);

-- Vault Metadata Table (for TVL tracking)
CREATE TABLE IF NOT EXISTS vault_metadata (
    id SERIAL PRIMARY KEY,
    chain VARCHAR(50) NOT NULL,
    asset VARCHAR(50) NOT NULL,
    vault_address VARCHAR(255) NOT NULL,
    total_assets TEXT NOT NULL,
    total_shares TEXT NOT NULL,
    last_updated TIMESTAMP DEFAULT NOW(),
    UNIQUE(chain, asset, vault_address)
);

-- Price Feed Table (for USD calculations)
CREATE TABLE IF NOT EXISTS price_feed (
    id SERIAL PRIMARY KEY,
    asset VARCHAR(50) NOT NULL,
    price_usd DECIMAL(20, 8) NOT NULL,
    timestamp TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_price_feed_asset ON price_feed(asset);
CREATE INDEX idx_price_feed_timestamp ON price_feed(timestamp DESC);

-- Function to get user total value
CREATE OR REPLACE FUNCTION get_user_total_value(
    p_user_address VARCHAR(255)
) RETURNS TABLE (
    total_value_usd DECIMAL
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        SUM(
            (us.shares::numeric / NULLIF(vm.total_shares::numeric, 0)) * 
            vm.total_assets::numeric * 
            pf.price_usd
        ) as total_value_usd
    FROM user_shares us
    JOIN vault_metadata vm ON 
        us.chain = vm.chain AND 
        us.asset = vm.asset
    LEFT JOIN LATERAL (
        SELECT price_usd 
        FROM price_feed 
        WHERE asset = us.asset 
        ORDER BY timestamp DESC 
        LIMIT 1
    ) pf ON true
    WHERE us.user_address = p_user_address;
END;
$$ LANGUAGE plpgsql;

-- View for recent transactions
CREATE OR REPLACE VIEW recent_transactions AS
SELECT 
    'deposit' as type,
    chain,
    asset,
    user_address,
    assets,
    shares,
    timestamp,
    tx_hash
FROM deposits
UNION ALL
SELECT 
    'withdrawal' as type,
    chain,
    asset,
    user_address,
    assets,
    shares,
    timestamp,
    tx_hash
FROM withdrawals
ORDER BY timestamp DESC
LIMIT 100;
