-- Persistent insight inbox (per-kind singleton; auto-resolve + manual dismiss/snooze)
CREATE TABLE IF NOT EXISTS "Insight" (
  "id"           TEXT PRIMARY KEY,
  "kind"         TEXT NOT NULL,
  "payload"      JSONB NOT NULL DEFAULT '{}',
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT now(),
  "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT now(),
  "readAt"       TIMESTAMP(3),
  "resolvedAt"   TIMESTAMP(3),
  "dismissedAt"  TIMESTAMP(3),
  "snoozedUntil" TIMESTAMP(3)
);
CREATE INDEX IF NOT EXISTS "Insight_kind_idx" ON "Insight" ("kind");
CREATE INDEX IF NOT EXISTS "Insight_open_idx" ON "Insight" ("resolvedAt", "dismissedAt");
