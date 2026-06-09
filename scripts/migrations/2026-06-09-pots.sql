-- Savings pots: virtual envelopes earmarking existing liquid cash toward goals.
CREATE TABLE IF NOT EXISTS "Pot" (
  "id"        SERIAL PRIMARY KEY,
  "name"      TEXT NOT NULL,
  "target"    DECIMAL,
  "balance"   DECIMAL NOT NULL DEFAULT 0,
  "emoji"     TEXT,
  "note"      TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "archived"  BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
