-- Flatten the budget model: categories are now a flat list (no groups), with a
-- fixed monthly amount and no goal/rollover. Drops the envelope machinery.
-- Idempotent; transaction-wrapped. Category keys + Person + Rule are kept.
BEGIN;

-- Category loses its group link and goal (the new code's INSERTs don't supply
-- groupId, which was NOT NULL — must drop it or inserts fail).
ALTER TABLE "Category" DROP COLUMN IF EXISTS "groupId";
ALTER TABLE "Category" DROP COLUMN IF EXISTS "goal";

-- Drop the now-unused envelope tables (Allocation/CategoryTransfer are empty;
-- CategoryGroup is just the old grouping). Order: dependents before CategoryGroup.
DROP TABLE IF EXISTS "Allocation";
DROP TABLE IF EXISTS "CategoryTransfer";
DROP TABLE IF EXISTS "CategoryGroup";

COMMIT;
