-- Assets (house, car) and liabilities (mortgage, loans, friends/family) as
-- normalised accounts, + a link from a repayment transaction to a debt.
-- Idempotent. ALTER TYPE ADD VALUE must run outside a transaction.
ALTER TYPE "AccountSource" ADD VALUE IF NOT EXISTS 'ASSET';
ALTER TYPE "AccountSource" ADD VALUE IF NOT EXISTS 'LIABILITY';

ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "debtAccountId" TEXT;
