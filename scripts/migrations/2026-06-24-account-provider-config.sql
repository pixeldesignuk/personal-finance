-- Per-account provider credentials for direct-integration investment accounts
-- (Trading 212, Bitget). Plaintext JSON; server-only (never serialized to the
-- client). Idempotent.
ALTER TABLE "Account" ADD COLUMN IF NOT EXISTS "providerConfig" JSONB;
