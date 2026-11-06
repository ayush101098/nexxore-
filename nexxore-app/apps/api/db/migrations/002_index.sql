-- Escalation Index (Prompt 05): components, readings, per-component readings,
-- and the ingestion events that drove each reading (Attribution Feed later).

CREATE TYPE regime AS ENUM ('risk_on', 'transition', 'risk_off');

CREATE TABLE IF NOT EXISTS index_components (
  id               SERIAL PRIMARY KEY,
  key              TEXT UNIQUE NOT NULL CHECK (key IN ('conflict','sanctions','energy','macro')),
  label            TEXT NOT NULL,
  weight           NUMERIC(4,3) NOT NULL CHECK (weight >= 0 AND weight <= 1),
  methodology_note TEXT
);

CREATE TABLE IF NOT EXISTS index_readings (
  id           BIGSERIAL PRIMARY KEY,
  ts           TIMESTAMPTZ NOT NULL UNIQUE,
  composite    NUMERIC(4,3) NOT NULL CHECK (composite >= 0 AND composite <= 1),
  regime       regime NOT NULL,
  content_hash CHAR(64) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_index_readings_ts ON index_readings (ts);

CREATE TABLE IF NOT EXISTS index_component_readings (
  reading_id      BIGINT NOT NULL REFERENCES index_readings(id) ON DELETE CASCADE,
  component_key   TEXT NOT NULL,
  value           NUMERIC(4,3) NOT NULL CHECK (value >= 0 AND value <= 1),
  top_driver_note TEXT,
  PRIMARY KEY (reading_id, component_key)
);

CREATE TABLE IF NOT EXISTS index_events (
  id              BIGSERIAL PRIMARY KEY,
  ts              TIMESTAMPTZ NOT NULL,
  component_key   TEXT NOT NULL,
  headline        TEXT NOT NULL,
  source_category TEXT NOT NULL,
  score_delta     NUMERIC(5,3) NOT NULL,
  reading_id      BIGINT REFERENCES index_readings(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_index_events_reading ON index_events (reading_id);

-- Regime thresholds are config, not constants (also overridable via env).
CREATE TABLE IF NOT EXISTS index_config (
  key   TEXT PRIMARY KEY,
  value NUMERIC NOT NULL
);
INSERT INTO index_config (key, value) VALUES
  ('threshold_risk_off', 0.70),
  ('threshold_risk_on_below', 0.45)
ON CONFLICT (key) DO NOTHING;

INSERT INTO index_components (key, label, weight, methodology_note) VALUES
  ('conflict',  'Conflict',  0.350, 'Armed-conflict and security escalation signals'),
  ('sanctions', 'Sanctions', 0.250, 'Sanctions, export controls, and financial restrictions'),
  ('energy',    'Energy',    0.200, 'Energy supply, chokepoints, and price shocks'),
  ('macro',     'Macro',     0.200, 'Rates, liquidity, and macro stress indicators')
ON CONFLICT (key) DO NOTHING;
