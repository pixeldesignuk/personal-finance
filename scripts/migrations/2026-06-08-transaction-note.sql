-- Add a user-editable note/annotation to transactions (distinct from the bank's
-- remittanceInfo). Idempotent.
ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "note" TEXT;
