-- Unified sync audit log.
CREATE TABLE IF NOT EXISTS "SyncRun" (
  "id"         TEXT PRIMARY KEY,
  "source"     TEXT NOT NULL,
  "status"     TEXT NOT NULL DEFAULT 'running',
  "startedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3),
  "summary"    JSONB,
  "error"      TEXT,
  "log"        JSONB
);
