-- Canonical merchants (source of truth) + recurring classification override.
CREATE TABLE IF NOT EXISTS "Merchant" (
  "token"     TEXT PRIMARY KEY,
  "name"      TEXT,
  "recurring" TEXT NOT NULL DEFAULT 'auto'
);
