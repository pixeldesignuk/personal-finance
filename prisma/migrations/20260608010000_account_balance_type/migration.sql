-- Per-account chosen GoCardless balanceType (e.g. "expected", "forwardAvailable").
-- Null = use the default preference order. Idempotent.
ALTER TABLE "Account" ADD COLUMN IF NOT EXISTS "balanceType" TEXT;
