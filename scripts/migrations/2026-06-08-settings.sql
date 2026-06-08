-- App settings / feature flags (key/value). Idempotent.
CREATE TABLE IF NOT EXISTS "Setting" (
  "key"   TEXT PRIMARY KEY,
  "value" TEXT NOT NULL
);
