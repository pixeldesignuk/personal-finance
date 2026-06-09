-- Annual interest rate (APR %) on accounts, used for debt projections/avalanche.
ALTER TABLE "Account" ADD COLUMN IF NOT EXISTS "interestRate" DECIMAL;
