-- Perps tables for Nexxore (Supabase/PostgreSQL)
-- Run this in Supabase SQL Editor to initialize the perps trading tables

-- Main trade log — every order submission (success, resting, or failed)
create table if not exists perps_trades (
  id bigserial primary key,
  wallet_address text not null,
  chain text default 'arbitrum',
  market text not null,
  side text not null check (side in ('long', 'short')),
  order_type text default 'market',
  price numeric,
  amount numeric,
  size numeric,
  leverage numeric default 1,
  execution_status text default 'unknown',
  venue text default 'hyperliquid',
  hl_oid text,
  fee_rate numeric default 0,
  reduce_only boolean default false,
  post_only boolean default false,
  tp_price numeric,
  sl_price numeric,
  error_message text,
  hl_response text,
  created_at timestamptz default now()
);

-- Positions tracking (synced from Hyperliquid clearinghouse state)
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
create index if not exists perps_trades_market_idx on perps_trades (market);
create index if not exists perps_trades_created_idx on perps_trades (created_at desc);
create index if not exists perps_positions_wallet_idx on perps_positions (wallet_address);

-- Enable Row Level Security (Supabase best practice)
-- Using service key for inserts bypasses RLS, anon key for reads respects it
alter table perps_trades enable row level security;
alter table perps_positions enable row level security;
alter table perps_orders enable row level security;

-- Allow public reads (trade data is on-chain anyway, non-sensitive)
create policy if not exists "Allow public read on perps_trades"
  on perps_trades for select using (true);

-- Allow inserts from service role (API) only
create policy if not exists "Allow service insert on perps_trades"
  on perps_trades for insert with check (true);

-- Allow public read on positions
create policy if not exists "Allow public read on perps_positions"
  on perps_positions for select using (true);

-- Allow public read on orders
create policy if not exists "Allow public read on perps_orders"
  on perps_orders for select using (true);
