-- Row insert time, so we can find a just-logged transaction (e.g. to set its
-- category from a follow-up Telegram message).
ALTER TABLE "Transaction"
  ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP NOT NULL DEFAULT now();
