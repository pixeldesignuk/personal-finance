-- Wrapped in a transaction so a mid-script failure rolls back cleanly.
BEGIN;

-- 1. Category.key. Backfill from the name slug; if two names slug to the same
--    key, suffix the later ones with their id so the unique index can't abort.
ALTER TABLE "Category" ADD COLUMN IF NOT EXISTS "key" TEXT;
WITH ranked AS (
  SELECT id,
         regexp_replace(regexp_replace(lower(trim("name")), '[^a-z0-9]+', '-', 'g'), '(^-+|-+$)', '', 'g') AS s,
         row_number() OVER (
           PARTITION BY regexp_replace(regexp_replace(lower(trim("name")), '[^a-z0-9]+', '-', 'g'), '(^-+|-+$)', '', 'g')
           ORDER BY id
         ) AS rn
  FROM "Category" WHERE "key" IS NULL
)
UPDATE "Category" c SET "key" = CASE WHEN r.rn = 1 THEN r.s ELSE r.s || '-' || c.id END
  FROM ranked r WHERE c.id = r.id;
CREATE UNIQUE INDEX IF NOT EXISTS "Category_key_key" ON "Category"("key");

-- 2. Remap Transaction.category / categoryOverride name -> key (income/transfer pass through)
UPDATE "Transaction" t SET "category" = c."key" FROM "Category" c WHERE t."category" = c."name";
UPDATE "Transaction" t SET "categoryOverride" = c."key" FROM "Category" c WHERE t."categoryOverride" = c."name";

-- 3. CategoryTransfer name columns -> key columns (rename if present; convert values)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='CategoryTransfer' AND column_name='fromName') THEN
    ALTER TABLE "CategoryTransfer" RENAME COLUMN "fromName" TO "fromKey";
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='CategoryTransfer' AND column_name='toName') THEN
    ALTER TABLE "CategoryTransfer" RENAME COLUMN "toName" TO "toKey";
  END IF;
END $$;
UPDATE "CategoryTransfer" ct SET "fromKey" = c."key" FROM "Category" c WHERE ct."fromKey" = c."name";
UPDATE "CategoryTransfer" ct SET "toKey" = c."key" FROM "Category" c WHERE ct."toKey" = c."name";

-- 4. Transaction.personKey
ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "personKey" TEXT;

-- 5. Person table + seed
CREATE TABLE IF NOT EXISTS "Person" ("id" SERIAL PRIMARY KEY, "key" TEXT NOT NULL UNIQUE, "name" TEXT NOT NULL, "sortOrder" INTEGER NOT NULL DEFAULT 0, "archived" BOOLEAN NOT NULL DEFAULT false);
INSERT INTO "Person" ("key","name","sortOrder") VALUES
  ('you','You',1),('halima','Halima',2),('maryam','Maryam',3),('maariyah','Maariyah',4),('household','Household',5)
  ON CONFLICT ("key") DO NOTHING;

-- 6. Rule table
CREATE TABLE IF NOT EXISTS "Rule" ("id" SERIAL PRIMARY KEY, "matchText" TEXT NOT NULL, "categoryKey" TEXT, "personKey" TEXT, "priority" INTEGER NOT NULL DEFAULT 0, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now());

COMMIT;
