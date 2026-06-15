-- Marks that we've attempted to resolve a merchant's logo domain (directory →
-- Brandfetch) so the background resolver runs once per merchant and doesn't
-- re-hit providers for ones that genuinely have no logo.
ALTER TABLE "Merchant"
  ADD COLUMN IF NOT EXISTS "logoCheckedAt" TIMESTAMP(3);
