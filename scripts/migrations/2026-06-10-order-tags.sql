-- Orders: tags (for matching/search), refund flag, and a Gmail incremental cursor.
ALTER TABLE "EmailOrder" ADD COLUMN IF NOT EXISTS "tags" JSONB;
ALTER TABLE "EmailOrder" ADD COLUMN IF NOT EXISTS "isRefund" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Plugin" ADD COLUMN IF NOT EXISTS "cursor" TEXT;
