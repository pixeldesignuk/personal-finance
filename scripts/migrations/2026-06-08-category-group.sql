-- Add a display-only group label to Category (e.g. "Monthly Bills",
-- "Subscriptions"). Not the old envelope groups — purely for organising the
-- Categories page and Reports. Idempotent.
ALTER TABLE "Category" ADD COLUMN IF NOT EXISTS "group" TEXT;
