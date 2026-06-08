-- AlterTable
-- Idempotent so it is safe to re-run (e.g. after applying the column manually
-- to an existing populated database). Postgres 9.6+ supports IF NOT EXISTS.
ALTER TABLE "Account" ADD COLUMN IF NOT EXISTS "nickname" TEXT;
