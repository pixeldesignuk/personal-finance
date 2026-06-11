-- Portion of an account's balance that isn't the user's (held for someone else).
-- Carved out of net worth, available, and safe-to-spend; the account still syncs.
ALTER TABLE "Account"
  ADD COLUMN IF NOT EXISTS "excludedBalance" DECIMAL;
