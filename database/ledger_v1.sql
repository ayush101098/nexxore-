-- Edge Engine v1 migration. Run after database/ledger.sql.
-- Extends the public ledger (alerts) and adds the v1 tables. Times are UTC.

-- ── alerts: new columns ──────────────────────────────────────────────
alter table alerts add column if not exists market_id      text;
alter table alerts add column if not exists category       text;
alter table alerts add column if not exists end_date       timestamptz;
alter table alerts add column if not exists is_call        boolean not null default false;
alter table alerts add column if not exists status         text    not null default 'open'
  check (status in ('open', 'resolved', 'void'));
alter table alerts add column if not exists prompt_version text;
alter table alerts add column if not exists thesis         text check (char_length(thesis) <= 280);
alter table alerts add column if not exists invalidation   text check (char_length(invalidation) <= 140);

-- Required for every new forecast; existing rows (none in production) are left alone.
alter table alerts add constraint alerts_market_id_required      check (market_id is not null)      not valid;
alter table alerts add constraint alerts_prompt_version_required check (prompt_version is not null) not valid;

create index if not exists alerts_market_flagged_idx on alerts (market_id, flagged_at desc);

-- ── Ledger is append-only: only resolution fields may change ─────────
create or replace function alerts_block_edits() returns trigger
language plpgsql as $$
begin
  if (to_jsonb(new) - array['resolved_yes', 'resolved_at', 'status'])
     is distinct from
     (to_jsonb(old) - array['resolved_yes', 'resolved_at', 'status']) then
    raise exception 'ledger rows are immutable except resolved_yes, resolved_at and status';
  end if;
  return new;
end $$;

drop trigger if exists alerts_immutable on alerts;
create trigger alerts_immutable before update on alerts
  for each row execute function alerts_block_edits();

-- Deleting forecasts would also rewrite history.
create or replace function alerts_block_delete() returns trigger
language plpgsql as $$
begin
  raise exception 'ledger rows cannot be deleted';
end $$;

drop trigger if exists alerts_no_delete on alerts;
create trigger alerts_no_delete before delete on alerts
  for each row execute function alerts_block_delete();

-- ── forecast_reasoning: full bull / bear / judge output (public) ─────
create table if not exists forecast_reasoning (
  alert_id     text primary key references alerts (id),
  bull_case    text not null,
  bear_case    text not null,
  judge_output jsonb not null,
  model_ids    text[] not null
);
alter table forecast_reasoning enable row level security;
create policy "public read" on forecast_reasoning for select using (true);

-- ── markets: cached Polymarket data (public) ─────────────────────────
create table if not exists markets (
  market_id  text primary key,
  question   text not null,
  rules_text text,
  end_date   timestamptz,
  category   text,
  liquidity  numeric,
  volume_24h numeric,
  updated_at timestamptz not null default now()
);
alter table markets enable row level security;
create policy "public read" on markets for select using (true);

-- ── watch_rules: a user's alert rules (owner only) ───────────────────
create table if not exists watch_rules (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade,
  market_id      text not null,
  rule_type      text not null check (rule_type in ('edge', 'move')),
  threshold      numeric not null check (threshold > 0),
  baseline_price numeric,
  created_at     timestamptz not null default now()
);
create index if not exists watch_rules_user_idx on watch_rules (user_id);
alter table watch_rules enable row level security;
create policy "owner all" on watch_rules for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── alert_deliveries: sent alerts, for the 6-hour dedup (owner only) ─
create table if not exists alert_deliveries (
  id       bigint generated always as identity primary key,
  rule_id  uuid not null references watch_rules (id) on delete cascade,
  user_id  uuid not null references auth.users (id) on delete cascade,
  sent_at  timestamptz not null default now(),
  channel  text not null check (channel in ('browser', 'telegram')),
  payload  jsonb not null
);
create index if not exists alert_deliveries_rule_idx on alert_deliveries (rule_id, sent_at desc);
alter table alert_deliveries enable row level security;
create policy "owner read" on alert_deliveries for select using (auth.uid() = user_id);

-- ── telegram_links: user ↔ chat (service role only) ──────────────────
create table if not exists telegram_links (
  user_id   uuid primary key references auth.users (id) on delete cascade,
  chat_id   text not null,
  linked_at timestamptz not null default now()
);
alter table telegram_links enable row level security;   -- no policies: service role only

-- ── user_settings (owner only) ───────────────────────────────────────
create table if not exists user_settings (
  user_id          uuid primary key references auth.users (id) on delete cascade,
  bankroll_usd     numeric check (bankroll_usd > 0),
  default_min_edge numeric
);
alter table user_settings enable row level security;
create policy "owner all" on user_settings for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
