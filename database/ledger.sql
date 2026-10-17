-- Nexxore public ledger: one row per model forecast, written at call time
-- and updated once the market resolves. Read by /api/track-record.
create table if not exists alerts (
  id            text primary key,
  market_url    text not null,
  market_name   text not null,
  flagged_at    timestamptz not null default now(),
  side          text not null check (side in ('YES', 'NO')),
  model_prob    numeric not null check (model_prob between 0 and 1),   -- model P(YES) at flagged_at
  market_prob   numeric not null check (market_prob between 0 and 1),  -- market midpoint at flagged_at
  entry_price   numeric not null check (entry_price between 0 and 1),  -- ask for the chosen side at flagged_at
  fee_bps       numeric not null default 0,
  resolved_yes  smallint check (resolved_yes in (0, 1)),               -- null while open
  resolved_at   timestamptz
);

create index if not exists alerts_flagged_at_idx on alerts (flagged_at desc);

-- Rows are append-only from the forecaster; the public API key can only read.
alter table alerts enable row level security;
create policy "public read" on alerts for select using (true);
