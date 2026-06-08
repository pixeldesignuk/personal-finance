-- Enums (idempotent)
DO $$ BEGIN
  CREATE TYPE "AccountType" AS ENUM ('PERSONAL', 'BUSINESS');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "AccountSource" AS ENUM ('BANK', 'MANUAL');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Account columns
ALTER TABLE "Account" ADD COLUMN IF NOT EXISTS "type"   "AccountType"   NOT NULL DEFAULT 'PERSONAL';
ALTER TABLE "Account" ADD COLUMN IF NOT EXISTS "source" "AccountSource" NOT NULL DEFAULT 'BANK';
ALTER TABLE "Account" ADD COLUMN IF NOT EXISTS "manualBalance" DECIMAL(65,30);
ALTER TABLE "Account" ALTER COLUMN "requisitionId" DROP NOT NULL;

-- Transaction override
ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "categoryOverride" TEXT;

-- Budget table
CREATE TABLE IF NOT EXISTS "Budget" (
  "category"     TEXT NOT NULL,
  "monthlyLimit" DECIMAL(65,30) NOT NULL,
  "updatedAt"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Budget_pkey" PRIMARY KEY ("category")
);
