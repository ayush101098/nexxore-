-- Stats table: the single source of truth for brand stats (Prompt 03).
-- Later, performance keys are computed from the Proof Layer instead of stored.
CREATE TABLE IF NOT EXISTS stats (
  key          TEXT PRIMARY KEY,
  value        NUMERIC NOT NULL,
  unit         TEXT,
  label        TEXT NOT NULL,
  evidence_url TEXT NOT NULL,
  verified     BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
