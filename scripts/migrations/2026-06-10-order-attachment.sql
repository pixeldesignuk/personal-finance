-- Reference to the original document (receipt photo/PDF) stored in object storage.
ALTER TABLE "EmailOrder" ADD COLUMN IF NOT EXISTS "attachmentKey" TEXT;
