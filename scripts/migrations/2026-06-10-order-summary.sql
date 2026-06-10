-- A short AI-generated summary of the purchase (used as the transaction note).
ALTER TABLE "EmailOrder" ADD COLUMN IF NOT EXISTS "summary" TEXT;
