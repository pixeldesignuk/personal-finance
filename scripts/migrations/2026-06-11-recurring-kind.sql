-- Recurring schedules: classify each as fixed or variable amount, and remember
-- the previous amount when a price recently changed (to flag increases).
ALTER TABLE "RecurringSchedule"
  ADD COLUMN IF NOT EXISTS "kind" TEXT NOT NULL DEFAULT 'fixed';

ALTER TABLE "RecurringSchedule"
  ADD COLUMN IF NOT EXISTS "prevAmount" DECIMAL;
