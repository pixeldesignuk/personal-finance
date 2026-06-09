-- Manual debt payoff order + planned (possibly partial) next payment.
ALTER TABLE "Account" ADD COLUMN IF NOT EXISTS "priority" INTEGER;
ALTER TABLE "Account" ADD COLUMN IF NOT EXISTS "targetPayment" DECIMAL;
