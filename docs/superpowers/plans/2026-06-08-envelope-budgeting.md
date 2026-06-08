# Envelope Budgeting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.

**Goal:** Replace the hardcoded 6-category system with the user's Aspire-style envelope budget — custom categories + groups, monthly allocations, optional goals, rolling available balances, and inter-category transfers — seeded from their spreadsheet.

**Architecture:** New Prisma tables (CategoryGroup, Category, Allocation, CategoryTransfer, Setting); a pure, unit-tested envelope engine; categories/envelopes routes; the Budgets page becomes an Envelope view + a Categories manager; transaction/telegram category pickers become data-driven. Old `Budget` table + route removed. Categories referenced by **name** string.

**Tech Stack:** Existing — Express+TS, Prisma(v6)/Postgres, Vite/React, zod, Node `node:test`, tsx, pnpm.

**Env prefix:** `eval "$(/opt/homebrew/bin/brew shellenv)"; eval "$(fnm env)";`

**Git:** commit straight to `main` from `/Users/mansoor/Developer/personal/finance` (the parent repo ignores `finance/`), explicit paths only, trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. `.ts` import extensions. No local Postgres — `prisma generate`/tests/build work without a DB; the controller applies schema+seed to Railway.

---

## File Structure
- `prisma/schema.prisma` (+ migration SQL) — new models, drop `Budget`.
- `server/lib/envelope.ts` (+ test) — pure compute.
- `shared/types.ts` — Category/Group/Envelope DTOs (drop BudgetDTO).
- `server/routes/categories.ts` — categories + groups CRUD + names.
- `server/routes/envelopes.ts` — envelopes view, allocations, transfers.
- Modify: `server/routes/sync.ts` (income/Uncategorised), `server/index.ts` (mount; drop budgets), `server/routes/telegram.ts` (DB category names).
- Remove: `server/routes/budgets.ts`.
- `web/src/api.ts` — new helpers; drop budgets/CATEGORY_OPTIONS static.
- `web/src/pages/Budgets.tsx` — rebuilt Envelope view.
- `web/src/pages/Categories.tsx` (new) + `web/src/App.tsx` nav/route.
- Modify dropdowns: `web/src/pages/Transactions.tsx`, `web/src/components/AddTransaction.tsx`.
- `scripts/migrations/2026-06-08-envelope.sql` — schema + seed + data migration (controller applies).

---

## Task 1: Schema

**Files:** `prisma/schema.prisma` (modify)

- [ ] **Step 1: Add models + remove `Budget`.** Delete the `model Budget { ... }` block and add:

```prisma
model CategoryGroup {
  id         Int        @id @default(autoincrement())
  name       String     @unique
  sortOrder  Int        @default(0)
  categories Category[]
}

model Category {
  id            Int           @id @default(autoincrement())
  name          String        @unique
  group         CategoryGroup @relation(fields: [groupId], references: [id])
  groupId       Int
  monthlyAmount Decimal       @default(0)
  goal          Decimal?
  sortOrder     Int           @default(0)
  archived      Boolean       @default(false)
  allocations   Allocation[]
}

model Allocation {
  id         Int      @id @default(autoincrement())
  category   Category @relation(fields: [categoryId], references: [id])
  categoryId Int
  month      String
  amount     Decimal
  @@unique([categoryId, month])
}

model CategoryTransfer {
  id        Int      @id @default(autoincrement())
  fromName  String
  toName    String
  month     String
  amount    Decimal
  note      String?
  createdAt DateTime @default(now())
}

model Setting {
  key   String @id
  value String
}
```

- [ ] **Step 2: Generate + validate**

Run: `eval "$(/opt/homebrew/bin/brew shellenv)"; eval "$(fnm env)"; cd /Users/mansoor/Developer/personal/finance; pnpm exec prisma generate && pnpm exec prisma validate`
Expected: generated; "schema is valid".

- [ ] **Step 3: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat: schema for envelope budgeting (groups, categories, allocations, transfers, settings)"
```

---

## Task 2: envelope engine (TDD)

**Files:** `server/lib/envelope.ts`, `server/lib/envelope.test.ts`

- [ ] **Step 1: Write the failing test `server/lib/envelope.test.ts`**

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { monthsBetween, computeEnvelopes, type EnvCategory, type EnvTx } from "./envelope.ts";

test("monthsBetween is inclusive and ordered; empty when start > end", () => {
  assert.deepEqual(monthsBetween("2026-05", "2026-07"), ["2026-05", "2026-06", "2026-07"]);
  assert.deepEqual(monthsBetween("2026-07", "2026-07"), ["2026-07"]);
  assert.deepEqual(monthsBetween("2026-08", "2026-07"), []);
});

const cats: EnvCategory[] = [
  { name: "Groceries", monthlyAmount: 250, goal: null },
  { name: "Rent", monthlyAmount: 500, goal: null },
  { name: "Emergency Fund", monthlyAmount: 0, goal: 2000 },
];

test("available rolls over: allocation accumulates minus spend", () => {
  const txns: EnvTx[] = [
    { amount: -100, category: "Groceries", bookingDate: "2026-05-10" },
    { amount: -180, category: "Groceries", bookingDate: "2026-06-04" },
  ];
  const rows = computeEnvelopes(cats, {}, [], txns, "2026-05", "2026-06");
  const g = rows.find((r) => r.name === "Groceries")!;
  assert.equal(g.allocated, 250);          // this (asOf) month allocation
  assert.equal(g.spent, 180);              // this month spend
  assert.equal(g.available, 250 + 250 - 100 - 180); // 220
});

test("allocation override replaces monthlyAmount for that month", () => {
  const rows = computeEnvelopes(cats, { "Rent|2026-06": 450 }, [], [], "2026-06", "2026-06");
  const r = rows.find((x) => x.name === "Rent")!;
  assert.equal(r.allocated, 450);
  assert.equal(r.available, 450);
});

test("transfers move available between envelopes", () => {
  const rows = computeEnvelopes(cats, {}, [{ fromName: "Rent", toName: "Emergency Fund", amount: 100 }], [], "2026-06", "2026-06");
  assert.equal(rows.find((r) => r.name === "Rent")!.available, 500 - 100);
  assert.equal(rows.find((r) => r.name === "Emergency Fund")!.available, 0 + 100);
});

test("credits/other categories don't count as spend", () => {
  const txns: EnvTx[] = [
    { amount: 50, category: "Groceries", bookingDate: "2026-06-01" }, // credit, ignored
    { amount: -30, category: "Uncategorised", bookingDate: "2026-06-01" }, // diff category
  ];
  const rows = computeEnvelopes(cats, {}, [], txns, "2026-06", "2026-06");
  assert.equal(rows.find((r) => r.name === "Groceries")!.spent, 0);
});
```

- [ ] **Step 2: Run → fail**

Run: `node --import tsx --test server/lib/envelope.test.ts`

- [ ] **Step 3: Write `server/lib/envelope.ts`**

```typescript
export interface EnvCategory {
  name: string;
  monthlyAmount: number;
  goal: number | null;
}
export interface EnvTx {
  amount: number;
  category: string; // effective category, personal-only (filtered by caller)
  bookingDate: string | null;
}
export interface EnvTransfer {
  fromName: string;
  toName: string;
  amount: number; // month already filtered (<= asOf) by caller
}
export interface EnvelopeRow {
  name: string;
  allocated: number;
  spent: number;
  available: number;
  goal: number | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function monthsBetween(start: string, end: string): string[] {
  if (start > end) return [];
  const out: string[] = [];
  let [y, m] = start.split("-").map(Number);
  const [ey, em] = end.split("-").map(Number);
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

function monthOf(date: string | null): string | null {
  return date ? date.slice(0, 7) : null;
}

export function computeEnvelopes(
  categories: EnvCategory[],
  allocationOverrides: Record<string, number>, // key `${name}|${YYYY-MM}`
  transfers: EnvTransfer[],
  txns: EnvTx[],
  startMonth: string,
  asOfMonth: string,
): EnvelopeRow[] {
  const months = monthsBetween(startMonth, asOfMonth);
  return categories.map((cat) => {
    let available = 0;
    let allocatedThis = 0;
    let spentThis = 0;
    for (const m of months) {
      const allocated = allocationOverrides[`${cat.name}|${m}`] ?? cat.monthlyAmount;
      let spent = 0;
      for (const t of txns) {
        if (t.amount >= 0) continue;
        if (t.category !== cat.name) continue;
        if (monthOf(t.bookingDate) !== m) continue;
        spent += -t.amount;
      }
      available += allocated - spent;
      if (m === asOfMonth) { allocatedThis = allocated; spentThis = spent; }
    }
    for (const tr of transfers) {
      if (tr.toName === cat.name) available += tr.amount;
      if (tr.fromName === cat.name) available -= tr.amount;
    }
    return {
      name: cat.name,
      allocated: round2(allocatedThis),
      spent: round2(spentThis),
      available: round2(available),
      goal: cat.goal,
    };
  });
}
```

- [ ] **Step 4: Run → pass; commit**

Run: `node --import tsx --test server/lib/envelope.test.ts`
```bash
git add server/lib/envelope.ts server/lib/envelope.test.ts
git commit -m "feat: envelope budgeting compute engine"
```

---

## Task 3: shared DTOs

**Files:** `shared/types.ts` (modify)

- [ ] **Step 1: Remove `BudgetDTO`** (the `export interface BudgetDTO {...}` block) and **append**:

```typescript
export interface CategoryDTO {
  id: number;
  name: string;
  groupId: number;
  monthlyAmount: number;
  goal: number | null;
  sortOrder: number;
  archived: boolean;
}

export interface CategoryGroupDTO {
  id: number;
  name: string;
  sortOrder: number;
  categories: CategoryDTO[];
}

export interface EnvelopeRowDTO {
  name: string;
  allocated: number;
  spent: number;
  available: number;
  goal: number | null;
}

export interface EnvelopeGroupDTO {
  id: number;
  name: string;
  rows: EnvelopeRowDTO[];
}
```

- [ ] **Step 2: Commit** (compile verified in Task 8)

```bash
git add shared/types.ts
git commit -m "feat: category/group/envelope DTOs; drop BudgetDTO"
```

---

## Task 4: categories route

**Files:** `server/routes/categories.ts` (create)

- [ ] **Step 1: Write `server/routes/categories.ts`**

```typescript
import { Router } from "express";
import { z } from "zod";
import { db } from "../lib/db.ts";
import type { CategoryGroupDTO } from "../../shared/types.ts";

export const categoriesRouter = Router();

categoriesRouter.get("/categories", async (req, res, next) => {
  try {
    const all = req.query.all === "1";
    const groups = await db.categoryGroup.findMany({
      include: { categories: { orderBy: { sortOrder: "asc" } } },
      orderBy: { sortOrder: "asc" },
    });
    const dto: CategoryGroupDTO[] = groups.map((g) => ({
      id: g.id,
      name: g.name,
      sortOrder: g.sortOrder,
      categories: g.categories
        .filter((c) => all || !c.archived)
        .map((c) => ({
          id: c.id, name: c.name, groupId: c.groupId,
          monthlyAmount: Number(c.monthlyAmount.toString()),
          goal: c.goal != null ? Number(c.goal.toString()) : null,
          sortOrder: c.sortOrder, archived: c.archived,
        })),
    }));
    res.json(dto);
  } catch (err) { next(err); }
});

// Active category names + reserved values, for pickers.
categoriesRouter.get("/category-names", async (_req, res, next) => {
  try {
    const cats = await db.category.findMany({ where: { archived: false }, orderBy: { name: "asc" } });
    res.json([...cats.map((c) => c.name), "income", "transfer"]);
  } catch (err) { next(err); }
});

categoriesRouter.post("/categories", async (req, res, next) => {
  try {
    const b = z.object({
      name: z.string().min(1),
      groupId: z.number().int(),
      monthlyAmount: z.number().min(0).default(0),
      goal: z.number().min(0).nullable().optional(),
    }).parse(req.body);
    const c = await db.category.create({
      data: { name: b.name, groupId: b.groupId, monthlyAmount: b.monthlyAmount, goal: b.goal ?? null },
    });
    res.json({ id: c.id });
  } catch (err) { next(err); }
});

categoriesRouter.patch("/categories/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const b = z.object({
      name: z.string().min(1).optional(),
      groupId: z.number().int().optional(),
      monthlyAmount: z.number().min(0).optional(),
      goal: z.number().min(0).nullable().optional(),
      sortOrder: z.number().int().optional(),
      archived: z.boolean().optional(),
    }).parse(req.body);
    const existing = await db.category.findUnique({ where: { id } });
    if (!existing) { res.status(404).json({ error: "Category not found" }); return; }
    if (b.name && b.name !== existing.name) {
      await db.transaction.updateMany({ where: { category: existing.name }, data: { category: b.name } });
      await db.transaction.updateMany({ where: { categoryOverride: existing.name }, data: { categoryOverride: b.name } });
    }
    const updated = await db.category.update({ where: { id }, data: b });
    res.json({ id: updated.id });
  } catch (err) { next(err); }
});

categoriesRouter.delete("/categories/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const cat = await db.category.findUnique({ where: { id } });
    if (!cat) { res.status(404).json({ error: "Category not found" }); return; }
    const used = await db.transaction.count({ where: { OR: [{ category: cat.name }, { categoryOverride: cat.name }] } });
    if (used > 0) { res.status(409).json({ error: "Category has transactions — archive it instead." }); return; }
    await db.allocation.deleteMany({ where: { categoryId: id } });
    await db.category.delete({ where: { id } });
    res.json({ deleted: true });
  } catch (err) { next(err); }
});

categoriesRouter.post("/category-groups", async (req, res, next) => {
  try {
    const b = z.object({ name: z.string().min(1), sortOrder: z.number().int().default(0) }).parse(req.body);
    const g = await db.categoryGroup.create({ data: b });
    res.json({ id: g.id });
  } catch (err) { next(err); }
});

categoriesRouter.patch("/category-groups/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const b = z.object({ name: z.string().min(1).optional(), sortOrder: z.number().int().optional() }).parse(req.body);
    await db.categoryGroup.update({ where: { id }, data: b });
    res.json({ id });
  } catch (err) { next(err); }
});

categoriesRouter.delete("/category-groups/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const count = await db.category.count({ where: { groupId: id } });
    if (count > 0) { res.status(409).json({ error: "Group is not empty" }); return; }
    await db.categoryGroup.delete({ where: { id } });
    res.json({ deleted: true });
  } catch (err) { next(err); }
});
```

- [ ] **Step 2: Commit** (compile verified in Task 8)

```bash
git add server/routes/categories.ts
git commit -m "feat: categories + groups CRUD + names endpoint"
```

---

## Task 5: envelopes route

**Files:** `server/routes/envelopes.ts` (create)

- [ ] **Step 1: Write `server/routes/envelopes.ts`**

```typescript
import { Router } from "express";
import { z } from "zod";
import { db } from "../lib/db.ts";
import { effectiveCategory } from "../lib/effectiveCategory.ts";
import { currentMonth } from "../lib/budget.ts";
import { computeEnvelopes, type EnvCategory, type EnvTx, type EnvTransfer } from "../lib/envelope.ts";
import type { EnvelopeGroupDTO } from "../../shared/types.ts";

export const envelopesRouter = Router();

async function startMonth(): Promise<string> {
  const s = await db.setting.findUnique({ where: { key: "budgetStartMonth" } });
  return s?.value ?? currentMonth();
}

envelopesRouter.get("/envelopes", async (req, res, next) => {
  try {
    const asOf = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/).optional() }).parse(req.query).month ?? currentMonth();
    const start = await startMonth();

    const groups = await db.categoryGroup.findMany({
      include: { categories: { where: { archived: false }, orderBy: { sortOrder: "asc" } } },
      orderBy: { sortOrder: "asc" },
    });
    const allocations = await db.allocation.findMany();
    const overrides: Record<string, number> = {};
    // map categoryId -> name for override keys
    const idToName = new Map<number, string>();
    groups.forEach((g) => g.categories.forEach((c) => idToName.set(c.id, c.name)));
    for (const a of allocations) {
      const name = idToName.get(a.categoryId);
      if (name) overrides[`${name}|${a.month}`] = Number(a.amount.toString());
    }
    const transferRows = await db.categoryTransfer.findMany({ where: { month: { lte: asOf } } });
    const transfers: EnvTransfer[] = transferRows.map((t) => ({ fromName: t.fromName, toName: t.toName, amount: Number(t.amount.toString()) }));

    const personal = await db.account.findMany({ where: { type: "PERSONAL" }, select: { id: true } });
    const ids = personal.map((a) => a.id);
    const txns = await db.transaction.findMany({ where: { accountId: { in: ids } } });
    const envTxns: EnvTx[] = txns.map((t) => ({ amount: Number(t.amount), category: effectiveCategory(t), bookingDate: t.bookingDate }));

    const dto: EnvelopeGroupDTO[] = groups.map((g) => {
      const cats: EnvCategory[] = g.categories.map((c) => ({
        name: c.name,
        monthlyAmount: Number(c.monthlyAmount.toString()),
        goal: c.goal != null ? Number(c.goal.toString()) : null,
      }));
      return { id: g.id, name: g.name, rows: computeEnvelopes(cats, overrides, transfers, envTxns, start, asOf) };
    });
    res.json(dto);
  } catch (err) { next(err); }
});

envelopesRouter.put("/allocations/:categoryId/:month", async (req, res, next) => {
  try {
    const categoryId = Number(req.params.categoryId);
    const month = req.params.month;
    if (!/^\d{4}-\d{2}$/.test(month)) { res.status(400).json({ error: "month must be YYYY-MM" }); return; }
    const { amount } = z.object({ amount: z.number().min(0) }).parse(req.body);
    await db.allocation.upsert({
      where: { categoryId_month: { categoryId, month } },
      create: { categoryId, month, amount },
      update: { amount },
    });
    res.json({ categoryId, month, amount });
  } catch (err) { next(err); }
});

envelopesRouter.post("/category-transfers", async (req, res, next) => {
  try {
    const b = z.object({
      fromName: z.string().min(1),
      toName: z.string().min(1),
      month: z.string().regex(/^\d{4}-\d{2}$/),
      amount: z.number().min(0),
      note: z.string().optional(),
    }).parse(req.body);
    await db.categoryTransfer.create({ data: { ...b, note: b.note ?? null } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});
```

- [ ] **Step 2: Commit** (compile verified in Task 8)

```bash
git add server/routes/envelopes.ts
git commit -m "feat: envelopes route (view, allocations, transfers)"
```

---

## Task 6: sync categorisation → income / Uncategorised

**Files:** `server/routes/sync.ts` (modify)

- [ ] **Step 1: Replace the keyword categorisation in `server/routes/sync.ts`.** Change the line:
```typescript
    const category = categorize({ amount, text });
```
to:
```typescript
    const category = amount > 0 ? "income" : "Uncategorised";
```
and remove the now-unused import `import { categorize } from "../lib/categorize.ts";` and the now-unused `text` variable construction if it becomes unused (keep if `text` is still referenced elsewhere; if not, delete its declaration).

- [ ] **Step 2: Verify compile**

Run: `eval "$(/opt/homebrew/bin/brew shellenv)"; eval "$(fnm env)"; cd /Users/mansoor/Developer/personal/finance; pnpm exec prisma generate && pnpm exec tsc --noEmit`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add server/routes/sync.ts
git commit -m "feat: sync leaves new transactions Uncategorised (credits=income); retire keyword categoriser"
```

---

## Task 7: telegram picker uses DB categories

**Files:** `server/routes/telegram.ts` (modify)

- [ ] **Step 1: Make the keyboard + validation use DB category names.**

Replace the import line `import { CATEGORIES, SPENDING_CATEGORIES } from "../lib/categorize.ts";` with:
```typescript
import { db } from "../lib/db.ts";
```
(if `db` is already imported, drop the duplicate.) Replace the `categoryKeyboard` function and make it async over fetched names:
```typescript
async function activeCategoryNames(): Promise<string[]> {
  const cats = await db.category.findMany({ where: { archived: false }, orderBy: { sortOrder: "asc" } });
  return cats.map((c) => c.name);
}

function categoryKeyboard(txId: string, names: string[]) {
  const rows = [];
  const top = names.slice(0, 9); // keep the keyboard small
  for (let i = 0; i < top.length; i += 3) {
    rows.push(top.slice(i, i + 3).map((c) => ({ text: c, callback_data: `cat:${c}:${txId}` })));
  }
  rows.push([{ text: "↩︎ Undo", callback_data: `undo:${txId}` }]);
  return { inline_keyboard: rows };
}
```
Update the two `categoryKeyboard(id)` call sites to `categoryKeyboard(id, await activeCategoryNames())`. In the `cat:` handler, replace `if (CATEGORIES.includes(category))` with `if ((await activeCategoryNames()).includes(category) || category === "income" || category === "transfer")`. The new-txn create still posts the keyboard via `categoryKeyboard(id, await activeCategoryNames())`.

- [ ] **Step 2: Verify compile**

Run: `pnpm exec tsc --noEmit`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add server/routes/telegram.ts
git commit -m "feat: telegram category buttons use DB categories"
```

---

## Task 8: mount routes, drop budgets, compile gate

**Files:** `server/index.ts` (modify), remove `server/routes/budgets.ts`

- [ ] **Step 1: In `server/index.ts`** remove the budgets import + `app.use("/api", budgetsRouter);`, and add:
```typescript
import { categoriesRouter } from "./routes/categories.ts";
import { envelopesRouter } from "./routes/envelopes.ts";
```
```typescript
app.use("/api", categoriesRouter);
app.use("/api", envelopesRouter);
```

- [ ] **Step 2: Delete the budgets route**

Run: `cd /Users/mansoor/Developer/personal/finance; rm server/routes/budgets.ts`

- [ ] **Step 3: Full backend compile + tests**

Run: `eval "$(/opt/homebrew/bin/brew shellenv)"; eval "$(fnm env)"; pnpm exec prisma generate && pnpm exec tsc --noEmit && pnpm test`
Expected: tsc 0; tests pass (existing minus the removed budget tests if any were tied to BudgetDTO — there are none; envelope adds 5). Net: prior 41 + 5 = 46.

- [ ] **Step 4: Commit**

```bash
git add server/index.ts server/routes/budgets.ts
git commit -m "feat: mount categories+envelopes routes; remove budgets route"
```

---

## Task 9: frontend api helpers

**Files:** `web/src/api.ts` (modify)

- [ ] **Step 1: Update imports** — replace `BudgetDTO` with the new DTOs in the type import:
```typescript
import type {
  InstitutionDTO, ConnectResponse, FinalizeResponse,
  SyncResult, DashboardDTO, TransactionDTO,
  BankDTO, RemoveBankResult, NicknameResult,
  SummaryDTO, ManualAccountInput, ManualTxnInput,
  CategoryGroupDTO, EnvelopeGroupDTO,
} from "../../shared/types.ts";
```

- [ ] **Step 2: Replace the `budgets`/`setBudget` lines** in the `api` object with:
```typescript
  categories: () => get<CategoryGroupDTO[]>("/api/categories"),
  categoryNames: () => get<string[]>("/api/category-names"),
  createCategory: (input: { name: string; groupId: number; monthlyAmount?: number; goal?: number | null }) =>
    send<{ id: number }>("POST", "/api/categories", input),
  patchCategory: (id: number, patch: { name?: string; groupId?: number; monthlyAmount?: number; goal?: number | null; sortOrder?: number; archived?: boolean }) =>
    send<{ id: number }>("PATCH", `/api/categories/${id}`, patch),
  deleteCategory: (id: number) => send<{ deleted: boolean }>("DELETE", `/api/categories/${id}`),
  createGroup: (name: string) => send<{ id: number }>("POST", "/api/category-groups", { name }),
  patchGroup: (id: number, patch: { name?: string; sortOrder?: number }) => send<{ id: number }>("PATCH", `/api/category-groups/${id}`, patch),
  deleteGroup: (id: number) => send<{ deleted: boolean }>("DELETE", `/api/category-groups/${id}`),
  envelopes: (month?: string) => get<EnvelopeGroupDTO[]>(`/api/envelopes${month ? `?month=${month}` : ""}`),
  setAllocation: (categoryId: number, month: string, amount: number) => send<unknown>("PUT", `/api/allocations/${categoryId}/${month}`, { amount }),
  categoryTransfer: (input: { fromName: string; toName: string; month: string; amount: number; note?: string }) =>
    send<unknown>("POST", "/api/category-transfers", input),
```

- [ ] **Step 3: Remove the `export const CATEGORY_OPTIONS = [...]` line** at the bottom of the file.

- [ ] **Step 4: Verify build deferred to Task 13** (dropdowns still reference CATEGORY_OPTIONS until Task 12). Commit:

```bash
git add web/src/api.ts
git commit -m "feat: api helpers for categories, groups, envelopes, allocations, transfers"
```

---

## Task 10: Envelope view (rebuild Budgets page)

**Files:** `web/src/pages/Budgets.tsx` (replace whole file)

- [ ] **Step 1: Replace `web/src/pages/Budgets.tsx` with:**

```typescript
import { useEffect, useState } from "react";
import { api } from "../api.ts";
import type { EnvelopeGroupDTO } from "../../../shared/types.ts";
import { formatMoney } from "../format.ts";

function nowMonth(): string {
  return new Date().toLocaleDateString("en-CA").slice(0, 7);
}

export default function Budgets() {
  const [month, setMonth] = useState(nowMonth());
  const [groups, setGroups] = useState<EnvelopeGroupDTO[]>([]);
  const [msg, setMsg] = useState<string | null>(null);

  const load = () => api.envelopes(month).then(setGroups).catch((e) => setMsg(e.message));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [month]);

  const transfer = async () => {
    const fromName = window.prompt("Move money FROM category:");
    if (!fromName) return;
    const toName = window.prompt("TO category:");
    if (!toName) return;
    const amt = Number(window.prompt("Amount (£):", "0"));
    if (Number.isNaN(amt) || amt <= 0) return;
    try { await api.categoryTransfer({ fromName, toName, month, amount: amt }); await load(); } catch (e) { setMsg((e as Error).message); }
  };

  return (
    <div>
      <div className="row-between">
        <h1>Budget <span className="muted" style={{ fontSize: 14, fontFamily: "var(--font-text)" }}>· envelopes</span></h1>
        <div className="toolbar">
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} style={{ width: "auto" }} />
          <button onClick={transfer}>Move money</button>
        </div>
      </div>
      {msg && <p className="muted">{msg}</p>}
      {groups.length === 0 && <p className="muted">No categories yet — add some on the Categories page.</p>}
      {groups.map((g) => (
        <div className="card" key={g.id}>
          <h3 style={{ marginTop: 0 }}>{g.name}</h3>
          <table>
            <thead><tr><th>Category</th><th>Allocated</th><th>Spent</th><th>Available</th></tr></thead>
            <tbody>
              {g.rows.map((r) => {
                const avail = r.available;
                const cls = avail < 0 ? "neg" : "pos";
                return (
                  <tr key={r.name}>
                    <td>{r.name}{r.goal ? <span className="muted"> · goal £{formatMoney(r.goal)}</span> : null}</td>
                    <td className="num">£{formatMoney(r.allocated)}</td>
                    <td className="num">£{formatMoney(r.spent)}</td>
                    <td className={`num ${cls}`}>£{formatMoney(avail)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Verify build deferred to Task 13.** Commit:

```bash
git add web/src/pages/Budgets.tsx
git commit -m "feat: rebuild Budgets page as envelope view"
```

---

## Task 11: Categories manager page + nav

**Files:** `web/src/pages/Categories.tsx` (create), `web/src/App.tsx` (modify)

- [ ] **Step 1: Create `web/src/pages/Categories.tsx`**

```typescript
import { useEffect, useState } from "react";
import { api } from "../api.ts";
import type { CategoryGroupDTO } from "../../../shared/types.ts";
import { formatMoney } from "../format.ts";

export default function Categories() {
  const [groups, setGroups] = useState<CategoryGroupDTO[]>([]);
  const [msg, setMsg] = useState<string | null>(null);

  const load = () => api.categories().then(setGroups).catch((e) => setMsg(e.message));
  useEffect(() => { load(); }, []);
  const wrap = async (fn: () => Promise<unknown>) => { try { await fn(); await load(); } catch (e) { setMsg((e as Error).message); } };

  const addGroup = () => { const n = window.prompt("New group name:"); if (n) wrap(() => api.createGroup(n)); };
  const addCat = (groupId: number) => {
    const name = window.prompt("Category name:"); if (!name) return;
    const amt = Number(window.prompt("Monthly amount (£):", "0")) || 0;
    const goalRaw = window.prompt("Goal (£, blank for none):", "");
    const goal = goalRaw && !Number.isNaN(Number(goalRaw)) ? Number(goalRaw) : null;
    wrap(() => api.createCategory({ name, groupId, monthlyAmount: amt, goal }));
  };
  const editAmount = (id: number, current: number) => {
    const v = window.prompt("Monthly amount (£):", String(current)); if (v === null) return;
    const n = Number(v); if (Number.isNaN(n) || n < 0) return;
    wrap(() => api.patchCategory(id, { monthlyAmount: n }));
  };
  const editGoal = (id: number, current: number | null) => {
    const v = window.prompt("Goal (£, blank for none):", current != null ? String(current) : ""); if (v === null) return;
    const goal = v.trim() === "" ? null : Number(v);
    if (goal != null && Number.isNaN(goal)) return;
    wrap(() => api.patchCategory(id, { goal }));
  };
  const rename = (id: number, current: string) => { const n = window.prompt("Rename category:", current); if (n && n !== current) wrap(() => api.patchCategory(id, { name: n })); };
  const archive = (id: number) => { if (window.confirm("Archive this category?")) wrap(() => api.patchCategory(id, { archived: true })); };

  return (
    <div>
      <div className="row-between">
        <h1>Categories</h1>
        <button className="btn-primary" onClick={addGroup}>Add group</button>
      </div>
      {msg && <p className="muted">{msg}</p>}
      {groups.map((g) => (
        <div className="card" key={g.id}>
          <div className="row-between">
            <h3 style={{ margin: 0 }}>{g.name}</h3>
            <button className="btn-sm" onClick={() => addCat(g.id)}>Add category</button>
          </div>
          <table style={{ marginTop: 10 }}>
            <thead><tr><th>Name</th><th>Monthly</th><th>Goal</th><th></th></tr></thead>
            <tbody>
              {g.categories.map((c) => (
                <tr key={c.id}>
                  <td>{c.name}</td>
                  <td className="num">£{formatMoney(c.monthlyAmount)}</td>
                  <td className="num">{c.goal != null ? `£${formatMoney(c.goal)}` : "—"}</td>
                  <td style={{ display: "flex", gap: 6, justifyContent: "flex-end", flexWrap: "wrap" }}>
                    <button className="btn-sm" onClick={() => editAmount(c.id, c.monthlyAmount)}>Amount</button>
                    <button className="btn-sm" onClick={() => editGoal(c.id, c.goal)}>Goal</button>
                    <button className="btn-sm" onClick={() => rename(c.id, c.name)}>Rename</button>
                    <button className="btn-danger btn-sm" onClick={() => archive(c.id)}>Archive</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Add nav link + route in `web/src/App.tsx`.** Add the import `import Categories from "./pages/Categories.tsx";`, a nav link `<NavLink to="/categories">Categories</NavLink>` (after Budgets), and a route `<Route path="/categories" element={<Categories />} />`.

- [ ] **Step 3: Verify build deferred to Task 13.** Commit:

```bash
git add web/src/pages/Categories.tsx web/src/App.tsx
git commit -m "feat: categories manager page + nav"
```

---

## Task 12: data-driven category dropdowns

**Files:** `web/src/pages/Transactions.tsx`, `web/src/components/AddTransaction.tsx` (modify)

- [ ] **Step 1: In `web/src/pages/Transactions.tsx`** stop importing `CATEGORY_OPTIONS`; fetch names. Change the import `import { api, CATEGORY_OPTIONS } from "../api.ts";` to `import { api } from "../api.ts";`. Add state + load near the other hooks:
```typescript
  const [catNames, setCatNames] = useState<string[]>([]);
  useEffect(() => { api.categoryNames().then(setCatNames).catch(() => setCatNames([])); }, []);
```
and in the per-row category `<select>`, replace `{CATEGORY_OPTIONS.map(...)}` with `{catNames.map((c) => <option key={c} value={c}>{c}</option>)}`.

- [ ] **Step 2: In `web/src/components/AddTransaction.tsx`** do the same: change import to `import { api } from "../api.ts";`, add:
```typescript
  const [catNames, setCatNames] = useState<string[]>([]);
  useEffect(() => { api.categoryNames().then(setCatNames).catch(() => setCatNames([])); }, []);
```
set the default category to the first fetched name (fallback "Uncategorised") and render `{catNames.map((c) => <option key={c} value={c}>{c}</option>)}` in the category select. Initialise `const [category, setCategory] = useState("Uncategorised");` and add `useEffect(() => { if (catNames[0]) setCategory((p) => p === "Uncategorised" ? catNames[0] : p); }, [catNames]);`.

- [ ] **Step 3: Verify** — `pnpm exec vite build`. Commit:

```bash
git add web/src/pages/Transactions.tsx web/src/components/AddTransaction.tsx
git commit -m "feat: category dropdowns load names from the DB"
```

---

## Task 13: full verification

- [ ] **Step 1:** `eval "$(/opt/homebrew/bin/brew shellenv)"; eval "$(fnm env)"; cd /Users/mansoor/Developer/personal/finance; pnpm test && pnpm exec tsc --noEmit && pnpm exec vite build`
Expected: tests **46 pass** (41 prior + 5 envelope), tsc 0, build OK.

---

## Task 14: migration + seed SQL (controller-applied to Railway)

**Files:** `scripts/migrations/2026-06-08-envelope.sql` (create)

- [ ] **Step 1: Write the idempotent SQL** (creates tables, seeds groups/categories/start month, migrates old data, drops Budget). Note: amounts use the Aspire values from the spec.

```sql
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
```

- [ ] **Step 2: Commit** (apply is the controller's Task 15)

```bash
git add scripts/migrations/2026-06-08-envelope.sql
git commit -m "chore: envelope schema + Aspire seed + data migration SQL"
```

---

## Task 15 (CONTROLLER / live): apply schema + seed to Railway

Not for the implementer subagent.

- [ ] Apply `scripts/migrations/2026-06-08-envelope.sql` to Railway via `psql "$DATABASE_URL" -f ...` (with before/after checks: group/category counts, Setting row, Budget table gone, transaction category remap).
- [ ] Confirm `GET /api/envelopes` and `GET /api/categories` return the seeded data on the deployed app.

---

## Self-Review

- **Spec coverage:** schema incl. all 5 models + drop Budget (Task 1/8/14), envelope engine with rollover/override/transfers/goals (Task 2), DTOs (Task 3), categories+groups CRUD + rename-updates-transactions + names endpoint (Task 4), envelopes view + allocations + transfers, personal-only + effective category (Task 5), sync→Uncategorised/income (Task 6), telegram DB categories (Task 7), Envelope UI (Task 10), Categories manager (Task 11), data-driven dropdowns (Task 12), seed from Aspire + old→new mapping + start month (Task 14). All spec sections mapped.
- **Placeholder scan:** the stray `DO $$ ... END $$;` no-op block in the SQL is harmless; every other step is complete code. (Remove that block when implementing if preferred.)
- **Type consistency:** `EnvCategory`/`EnvTx`/`EnvTransfer`/`EnvelopeRow` (Task 2) consumed by the envelopes route (Task 5); `CategoryGroupDTO`/`EnvelopeGroupDTO` (Task 3) used by routes (4/5) and `api.ts`/pages (9–12); `computeEnvelopes` signature consistent; category names referenced by string throughout; `currentMonth`/`effectiveCategory` reused from existing libs. `api.envelopes/categories/categoryNames/...` names consistent across 9–12.
- **Known acceptance:** auto-categorisation deferred (new txns Uncategorised); credit-card-payment envelopes out of scope; budgetStartMonth = current month.
