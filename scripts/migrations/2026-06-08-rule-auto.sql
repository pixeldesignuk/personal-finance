-- Add Rule.auto to mark rules the LLM (Gemini Flash) auto-categorisation
-- learned, so the UI can label them and the user can edit/delete them.
-- Idempotent.
ALTER TABLE "Rule" ADD COLUMN IF NOT EXISTS "auto" BOOLEAN NOT NULL DEFAULT false;
