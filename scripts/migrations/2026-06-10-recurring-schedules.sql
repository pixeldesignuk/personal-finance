-- Recurring payment schedules detected from merchant spend patterns (and income).
-- One row per merchant token; status preserves the user's confirm/ignore choice
-- across re-detection.
CREATE TABLE IF NOT EXISTS "RecurringSchedule" (
  "id"            TEXT PRIMARY KEY,
  "merchantToken" TEXT NOT NULL UNIQUE,
  "name"          TEXT,
  "accountId"     TEXT,
  "direction"     TEXT NOT NULL DEFAULT 'out',     -- out (bill) | in (income)
  "amount"        DECIMAL(12,2) NOT NULL DEFAULT 0,
  "cadence"       TEXT NOT NULL DEFAULT 'monthly',  -- monthly | weekly | yearly | irregular
  "dayOfMonth"    INTEGER,
  "lastSeen"      TIMESTAMP(3),
  "nextDue"       TIMESTAMP(3),
  "status"        TEXT NOT NULL DEFAULT 'auto',     -- auto | confirmed | ignored
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
