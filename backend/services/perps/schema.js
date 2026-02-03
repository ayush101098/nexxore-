const { query } = require('./db');

const ensureSchema = async () => {
  await query(`
    CREATE TABLE IF NOT EXISTS perps_trades (
      id BIGINT PRIMARY KEY,
      wallet_address TEXT,
      chain TEXT,
      market TEXT,
      side TEXT,
      order_type TEXT,
      price NUMERIC,
      amount NUMERIC,
      leverage NUMERIC,
      execution_model TEXT,
      execution_status TEXT,
      execution_mode TEXT,
      status TEXT,
      route TEXT,
      fee_rate NUMERIC,
      fee_amount NUMERIC,
      fee_role TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS perps_user_trades (
      id BIGINT PRIMARY KEY,
      wallet_address TEXT,
      chain TEXT,
      market TEXT,
      side TEXT,
      order_type TEXT,
      price NUMERIC,
      amount NUMERIC,
      leverage NUMERIC,
      execution_model TEXT,
      execution_status TEXT,
      execution_mode TEXT,
      status TEXT,
      route TEXT,
      fee_rate NUMERIC,
      fee_amount NUMERIC,
      fee_role TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS perps_positions (
      id BIGSERIAL PRIMARY KEY,
      wallet_address TEXT,
      chain TEXT,
      market TEXT,
      side TEXT,
      size NUMERIC,
      entry_price NUMERIC,
      mark_price NUMERIC,
      liq_price NUMERIC,
      unrealized_pnl NUMERIC,
      realized_pnl NUMERIC,
      margin NUMERIC,
      leverage NUMERIC,
      tp_price NUMERIC,
      sl_price NUMERIC,
      status TEXT DEFAULT 'open',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      closed_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS perps_alerts (
      id BIGSERIAL PRIMARY KEY,
      wallet_address TEXT,
      market TEXT,
      alert_type TEXT,
      message TEXT,
      status TEXT DEFAULT 'open',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS perps_liquidations (
      id BIGSERIAL PRIMARY KEY,
      wallet_address TEXT,
      market TEXT,
      position_id BIGINT,
      liq_price NUMERIC,
      mark_price NUMERIC,
      size NUMERIC,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS perps_orders (
      id BIGSERIAL PRIMARY KEY,
      wallet_address TEXT,
      chain TEXT,
      market TEXT,
      side TEXT,
      order_type TEXT,
      price NUMERIC,
      amount NUMERIC,
      leverage NUMERIC,
      remaining_size NUMERIC,
      reduce_only BOOLEAN DEFAULT FALSE,
      post_only BOOLEAN DEFAULT FALSE,
      tp_price NUMERIC,
      sl_price NUMERIC,
      status TEXT DEFAULT 'open',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS perps_trades_wallet_idx ON perps_trades (wallet_address);
    CREATE INDEX IF NOT EXISTS perps_user_trades_wallet_idx ON perps_user_trades (wallet_address);
    CREATE INDEX IF NOT EXISTS perps_positions_wallet_idx ON perps_positions (wallet_address);
    CREATE INDEX IF NOT EXISTS perps_positions_market_idx ON perps_positions (market);
    CREATE INDEX IF NOT EXISTS perps_orders_wallet_idx ON perps_orders (wallet_address);

    CREATE TABLE IF NOT EXISTS perps_orderbook_updates (
      id BIGSERIAL PRIMARY KEY,
      market TEXT,
      side TEXT,
      price NUMERIC,
      size NUMERIC,
      order_id BIGINT,
      status TEXT DEFAULT 'open',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS perps_orderbook_market_idx ON perps_orderbook_updates (market);
  `);
};

module.exports = { ensureSchema };
