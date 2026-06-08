-- Tables (Prisma-shaped; idempotent)
CREATE TABLE IF NOT EXISTS "CategoryGroup" ("id" SERIAL PRIMARY KEY, "name" TEXT NOT NULL UNIQUE, "sortOrder" INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS "Category" (
  "id" SERIAL PRIMARY KEY, "name" TEXT NOT NULL UNIQUE, "groupId" INTEGER NOT NULL REFERENCES "CategoryGroup"("id"),
  "monthlyAmount" DECIMAL(65,30) NOT NULL DEFAULT 0, "goal" DECIMAL(65,30), "sortOrder" INTEGER NOT NULL DEFAULT 0, "archived" BOOLEAN NOT NULL DEFAULT false);
CREATE TABLE IF NOT EXISTS "Allocation" (
  "id" SERIAL PRIMARY KEY, "categoryId" INTEGER NOT NULL REFERENCES "Category"("id"), "month" TEXT NOT NULL, "amount" DECIMAL(65,30) NOT NULL,
  CONSTRAINT "Allocation_categoryId_month_key" UNIQUE ("categoryId","month"));
CREATE TABLE IF NOT EXISTS "CategoryTransfer" (
  "id" SERIAL PRIMARY KEY, "fromName" TEXT NOT NULL, "toName" TEXT NOT NULL, "month" TEXT NOT NULL, "amount" DECIMAL(65,30) NOT NULL, "note" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS "Setting" ("key" TEXT PRIMARY KEY, "value" TEXT NOT NULL);

-- budgetStartMonth = current UK month (computed at apply time)
INSERT INTO "Setting" ("key","value")
  VALUES ('budgetStartMonth', to_char((now() AT TIME ZONE 'Europe/London'), 'YYYY-MM'))
  ON CONFLICT ("key") DO NOTHING;

-- Groups
INSERT INTO "CategoryGroup" ("name","sortOrder") VALUES
  ('Halima Expenses',1),('Mansoor Expenses',2),('Household',3),('Monthly Bills',4),
  ('Yearly Bills',5),('Long-term Funds',6),('System',7)
  ON CONFLICT ("name") DO NOTHING;

-- Categories (idempotent upsert by name). gid() resolves the group id.
DO $$
DECLARE gid INT;
BEGIN
  PERFORM 1;
END $$;

-- helper inserts per group
INSERT INTO "Category" ("name","groupId","monthlyAmount","goal","sortOrder")
SELECT v.name, g.id, v.amt, v.goal, v.ord FROM (VALUES
  ('Halima expenses','Halima Expenses',200,NULL,1),
  ('Arabic Intensive Fees','Halima Expenses',60,540,2),
  ('Cloud Services','Mansoor Expenses',11,NULL,1),
  ('Mobile Phone','Mansoor Expenses',29,NULL,2),
  ('Mansoor expenses','Mansoor Expenses',50,NULL,3),
  ('Mobile Phone Contract','Mansoor Expenses',16,192,4),
  ('Fuel','Mansoor Expenses',50,NULL,5),
  ('Groceries','Household',250,NULL,1),
  ('Water','Monthly Bills',25.14,251.13,1),
  ('Electric & Gas','Monthly Bills',121.70,NULL,2),
  ('Car Finance','Monthly Bills',116.63,2099.54,3),
  ('Car Insurance','Monthly Bills',70.56,281.84,4),
  ('Broadband','Monthly Bills',23.99,191.92,5),
  ('Council Tax','Monthly Bills',135,NULL,6),
  ('Rent','Monthly Bills',500,NULL,7),
  ('Kendamil','Monthly Bills',22,NULL,8),
  ('Maryam Football','Monthly Bills',22,NULL,9),
  ('Meow Meow','Monthly Bills',50,NULL,10),
  ('Car Maintenance fund','Yearly Bills',40,480,1),
  ('Amazon Prime','Yearly Bills',10,95,2),
  ('Clothing','Long-term Funds',0,NULL,1),
  ('Home Maintenance','Long-term Funds',0,NULL,2),
  ('Emergency Fund','Long-term Funds',0,2000,3),
  ('Uncategorised','System',0,NULL,1)
) AS v(name,grp,amt,goal,ord)
JOIN "CategoryGroup" g ON g.name = v.grp
ON CONFLICT ("name") DO NOTHING;

-- Migrate old Budget.monthlyLimit into matching category monthlyAmount (by name, case-insensitive 'groceries')
UPDATE "Category" c SET "monthlyAmount" = b."monthlyLimit"
  FROM "Budget" b WHERE lower(b."category") = lower(c."name") AND b."monthlyLimit" > 0;

-- Map old transaction categories -> new
UPDATE "Transaction" SET "category"='Groceries' WHERE "category"='groceries';
UPDATE "Transaction" SET "categoryOverride"='Groceries' WHERE "categoryOverride"='groceries';
UPDATE "Transaction" SET "category"='Uncategorised' WHERE "category" IN ('eating-out','transport','bills','shopping','other');
UPDATE "Transaction" SET "categoryOverride"='Uncategorised' WHERE "categoryOverride" IN ('eating-out','transport','bills','shopping','other');

-- Drop the old Budget table
DROP TABLE IF EXISTS "Budget";
