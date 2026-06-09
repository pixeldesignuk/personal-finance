-- Store the bank/institution logo URL (from GoCardless) on the requisition so
-- account cards can render it.
ALTER TABLE "Requisition" ADD COLUMN IF NOT EXISTS "institutionLogo" TEXT;
