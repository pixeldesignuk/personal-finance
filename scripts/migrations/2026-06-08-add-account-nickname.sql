-- Standalone, idempotent migration: add Account.nickname to an EXISTING
-- populated database (e.g. your Railway Postgres that already has a connected
-- bank's data). Additive and non-destructive — adds one nullable column, does
-- NOT touch any existing rows.
--
-- Safe to run more than once (IF NOT EXISTS). After running this, the repo's
-- Prisma migration (20260607230000_add_account_nickname) is also idempotent, so
-- the next `prisma migrate deploy` on container start will no-op rather than
-- error on "column already exists".
--
-- How to run against Railway — pick one:
--   1) Railway dashboard → your Postgres service → "Query" tab → paste & run.
--   2) Railway CLI:   railway run --service <pg-service> psql -f scripts/migrations/2026-06-08-add-account-nickname.sql
--   3) Direct psql:   psql "$DATABASE_URL" -f scripts/migrations/2026-06-08-add-account-nickname.sql
--      (use the PUBLIC connection string from Railway → Postgres → Connect)

BEGIN;

ALTER TABLE "Account" ADD COLUMN IF NOT EXISTS "nickname" TEXT;

COMMIT;

-- Verify (optional): the column should now exist.
-- SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'Account' AND column_name = 'nickname';
