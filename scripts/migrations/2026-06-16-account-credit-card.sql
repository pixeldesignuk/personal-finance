-- Credit-card support for account health: capture the bank-reported account type
-- (ISO 20022 cashAccountType, e.g. "CARD") and allow a manual override, so a card's
-- negative balance is treated as debt rather than an overdraft.
ALTER TABLE "Account" ADD COLUMN IF NOT EXISTS "cashAccountType" TEXT;
ALTER TABLE "Account" ADD COLUMN IF NOT EXISTS "creditCard" BOOLEAN;
