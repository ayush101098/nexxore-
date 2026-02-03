-- Perps tables for Nexxore

create table if not exists perps_trades (
  id bigint primary key,
  wallet_address text,
  chain text,
  market text,
  side text,
  order_type text,
  price numeric,
  amount numeric,
  leverage numeric,
  execution_model text,
  execution_status text,
  execution_mode text,
  status text,
  route text,
  fee_rate numeric,
  fee_amount numeric,
  fee_role text,
  created_at timestamptz default now()
);

create table if not exists perps_user_trades (
  id bigint primary key,
  wallet_address text,
  chain text,
  market text,
  side text,
  order_type text,
  price numeric,
  amount numeric,
  leverage numeric,
  execution_model text,
  execution_status text,
  execution_mode text,
  status text,
  route text,
  fee_rate numeric,
  fee_amount numeric,
  fee_role text,
  created_at timestamptz default now()
);

create table if not exists perps_positions (
  id bigserial primary key,
  wallet_address text,
  chain text,
  market text,
  side text,
  size numeric,
  entry_price numeric,
  mark_price numeric,
  liq_price numeric,
  unrealized_pnl numeric,
  realized_pnl numeric,
  margin numeric,
  leverage numeric,
  tp_price numeric,
  sl_price numeric,
  status text default 'open',
  created_at timestamptz default now(),
  closed_at timestamptz
);

create table if not exists perps_alerts (
  id bigserial primary key,
  wallet_address text,
  market text,
  alert_type text,
  message text,
  status text default 'open',
  created_at timestamptz default now()
);

create table if not exists perps_liquidations (
  id bigserial primary key,
  wallet_address text,
  market text,
  position_id bigint,
  liq_price numeric,
  mark_price numeric,
  size numeric,
  created_at timestamptz default now()
);

create table if not exists perps_orders (
  id bigserial primary key,
  wallet_address text,
  chain text,
  market text,
  side text,
  order_type text,
  price numeric,
  amount numeric,
  leverage numeric,
  remaining_size numeric,
  reduce_only boolean default false,
  post_only boolean default false,
  tp_price numeric,
  sl_price numeric,
  status text default 'open',
  created_at timestamptz default now()
);

create index if not exists perps_orders_wallet_idx on perps_orders (wallet_address);

create table if not exists perps_orderbook_updates (
  id bigserial primary key,
  market text,
  side text,
  price numeric,
  size numeric,
  order_id bigint,
  status text default 'open',
  created_at timestamptz default now()
);

create index if not exists perps_orderbook_market_idx on perps_orderbook_updates (market);

create index if not exists perps_trades_wallet_idx on perps_trades (wallet_address);
create index if not exists perps_user_trades_wallet_idx on perps_user_trades (wallet_address);
create index if not exists perps_positions_wallet_idx on perps_positions (wallet_address);
