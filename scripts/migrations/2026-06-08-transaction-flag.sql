-- Add a spend-reduction flag to transactions: 'red' | 'orange' | 'yellow' | null.
-- Idempotent.
ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "flag" TEXT;
