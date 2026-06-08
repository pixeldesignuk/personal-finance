-- Investment accounts + normalised holdings (Trading 212 now, Bitget next).
-- Idempotent. Note: ALTER TYPE ... ADD VALUE must run outside a transaction.
ALTER TYPE "AccountSource" ADD VALUE IF NOT EXISTS 'INVESTMENT';

ALTER TABLE "Account" ADD COLUMN IF NOT EXISTS "provider" TEXT;

CREATE TABLE IF NOT EXISTS "Holding" (
  "id"        SERIAL PRIMARY KEY,
  "accountId" TEXT NOT NULL REFERENCES "Account"("id") ON DELETE CASCADE,
  "symbol"    TEXT NOT NULL,
  "name"      TEXT,
  "quantity"  DECIMAL NOT NULL,
  "price"     DECIMAL NOT NULL,
  "value"     DECIMAL NOT NULL,
  "cost"      DECIMAL,
  "pnl"       DECIMAL,
  "currency"  TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "Holding_accountId_idx" ON "Holding"("accountId");
