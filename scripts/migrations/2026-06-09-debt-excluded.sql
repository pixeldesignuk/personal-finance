-- Exclude a debt from the Debt management screen focus (still counts in net worth).
ALTER TABLE "Account" ADD COLUMN IF NOT EXISTS "debtExcluded" BOOLEAN NOT NULL DEFAULT false;
