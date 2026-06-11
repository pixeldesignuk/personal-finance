-- Mark an account as informational: tracked & visible, but excluded from all
-- totals (net worth, income, expense, budget, pots). For shared accounts that
-- mostly hold money / activity that isn't the user's.
ALTER TABLE "Account"
  ADD COLUMN IF NOT EXISTS "informational" BOOLEAN NOT NULL DEFAULT false;
