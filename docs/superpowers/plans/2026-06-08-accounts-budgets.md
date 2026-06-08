# Accounts, Manual Money & Budgets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add account type (personal/business) + manual/cash accounts, manual transactions, category override (with `transfer` exclusion), a net-worth total, per-category monthly budgets, and a monthly cash-flow/savings summary.

**Architecture:** Additive on the existing Express+TS / Prisma-Postgres / Vite-React app. New enums + columns + a `Budget` table; pure logic units (`categorize` exports, `effectiveCategory`, `currentBalance`, `budget.ts`) are unit-tested; new/extended routes; new Manage/Transactions/Budgets/Dashboard UI.

**Tech Stack:** Existing — Express, Prisma(v6)/Postgres, Vite/React/Router, zod, Recharts, Node `node:test`, tsx, pnpm.

**Env prefix (every node/pnpm/tsx/prisma cmd):** `eval "$(/opt/homebrew/bin/brew shellenv)"; eval "$(fnm env)";`

**Git:** work on `main` (no branches). Commit per task from `/Users/mansoor/Developer/personal/finance`, `git add` explicit paths only. Trailer each commit body with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

**DB:** No local Postgres. `prisma generate` (no DB) is enough for types/tests/build. Do NOT run `prisma migrate dev`. The migration SQL is hand-written + idempotent; the controller applies it to the live Railway DB separately.

**Imports use `.ts` extensions** (existing convention). Effective category = `categoryOverride ?? category` everywhere spending is computed; the `transfer` category is excluded from spending/budgets/cash-flow.

---

## Task 1: Schema — enums, account fields, Budget, category override

**Files:** `prisma/schema.prisma` (modify), `prisma/migrations/20260608000000_accounts_budgets/migration.sql` (create)

- [ ] **Step 1: Edit `prisma/schema.prisma`**

Add the two enums (anywhere top-level):
```prisma
enum AccountType {
  PERSONAL
  BUSINESS
}

enum AccountSource {
  BANK
  MANUAL
}
```

Change `model Account` to (note `requisition`/`requisitionId` optional, new fields):
```prisma
model Account {
  id            String         @id
  requisition   Requisition?   @relation(fields: [requisitionId], references: [id])
  requisitionId String?
  source        AccountSource  @default(BANK)
  type          AccountType    @default(PERSONAL)
  iban          String?
  name          String?
  nickname      String?
  currency      String?
  ownerName     String?
  manualBalance Decimal?
  createdAt     DateTime       @default(now())
  balances      Balance[]
  transactions  Transaction[]
  syncLogs      SyncLog[]
}
```

Add `categoryOverride` to `model Transaction` (after `category`):
```prisma
  category         String
  categoryOverride String?
```

Add the `Budget` model:
```prisma
model Budget {
  category     String   @id
  monthlyLimit Decimal
  updatedAt    DateTime @updatedAt
}
```

- [ ] **Step 2: Create `prisma/migrations/20260608000000_accounts_budgets/migration.sql`**

```sql
-- Enums (idempotent)
DO $$ BEGIN
  CREATE TYPE "AccountType" AS ENUM ('PERSONAL', 'BUSINESS');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "AccountSource" AS ENUM ('BANK', 'MANUAL');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Account columns
ALTER TABLE "Account" ADD COLUMN IF NOT EXISTS "type"   "AccountType"   NOT NULL DEFAULT 'PERSONAL';
ALTER TABLE "Account" ADD COLUMN IF NOT EXISTS "source" "AccountSource" NOT NULL DEFAULT 'BANK';
ALTER TABLE "Account" ADD COLUMN IF NOT EXISTS "manualBalance" DECIMAL(65,30);
ALTER TABLE "Account" ALTER COLUMN "requisitionId" DROP NOT NULL;

-- Transaction override
ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "categoryOverride" TEXT;

-- Budget table
CREATE TABLE IF NOT EXISTS "Budget" (
  "category"     TEXT NOT NULL,
  "monthlyLimit" DECIMAL(65,30) NOT NULL,
  "updatedAt"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Budget_pkey" PRIMARY KEY ("category")
);
```

- [ ] **Step 3: Regenerate the client**

Run: `eval "$(/opt/homebrew/bin/brew shellenv)"; eval "$(fnm env)"; cd /Users/mansoor/Developer/personal/finance; pnpm exec prisma generate && pnpm exec prisma validate`
Expected: generated + "schema is valid".

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260608000000_accounts_budgets/migration.sql
git commit -m "feat: schema for account type/source, manual balance, category override, budgets"
```

---

## Task 2: categorize exports (TDD)

**Files:** `server/lib/categorize.ts` (modify), `server/lib/categories.test.ts` (create)

- [ ] **Step 1: Write failing test `server/lib/categories.test.ts`**

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { SPENDING_CATEGORIES, CATEGORIES } from "./categorize.ts";

test("SPENDING_CATEGORIES excludes income and transfer", () => {
  assert.ok(!SPENDING_CATEGORIES.includes("income" as never));
  assert.ok(!SPENDING_CATEGORIES.includes("transfer" as never));
  assert.deepEqual([...SPENDING_CATEGORIES].sort(), ["bills", "eating-out", "groceries", "other", "shopping", "transport"]);
});

test("CATEGORIES adds income and transfer to spending set", () => {
  assert.ok(CATEGORIES.includes("income"));
  assert.ok(CATEGORIES.includes("transfer"));
  for (const c of SPENDING_CATEGORIES) assert.ok(CATEGORIES.includes(c));
});
```

- [ ] **Step 2: Run → fail**

Run: `node --import tsx --test server/lib/categories.test.ts`
Expected: FAIL (no such exports).

- [ ] **Step 3: Add exports to `server/lib/categorize.ts`**

At the end of the file add:
```typescript
export const SPENDING_CATEGORIES = [
  "groceries", "eating-out", "transport", "bills", "shopping", "other",
] as const;

export const CATEGORIES: string[] = [...SPENDING_CATEGORIES, "income", "transfer"];
```

- [ ] **Step 4: Run → pass**

Run: `node --import tsx --test server/lib/categories.test.ts`
Expected: PASS (2).

- [ ] **Step 5: Commit**

```bash
git add server/lib/categorize.ts server/lib/categories.test.ts
git commit -m "feat: export SPENDING_CATEGORIES and CATEGORIES"
```

---

## Task 3: effectiveCategory + currentBalance (TDD)

**Files:** `server/lib/effectiveCategory.ts` (create), `server/lib/balance.ts` (create), `server/lib/balance.test.ts` (create)

- [ ] **Step 1: Write failing test `server/lib/balance.test.ts`**

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { currentBalance } from "./balance.ts";
import { effectiveCategory } from "./effectiveCategory.ts";

test("manual account uses manualBalance", () => {
  assert.equal(currentBalance("MANUAL", 250.5, []), 250.5);
  assert.equal(currentBalance("MANUAL", null, []), 0);
});

test("bank account prefers interimAvailable, then expected, then closingBooked, then first", () => {
  const bals = [
    { type: "closingBooked", amount: 10 },
    { type: "expected", amount: 20 },
    { type: "interimAvailable", amount: 30 },
  ];
  assert.equal(currentBalance("BANK", null, bals), 30);
  assert.equal(currentBalance("BANK", null, [{ type: "expected", amount: 20 }, { type: "closingBooked", amount: 10 }]), 20);
  assert.equal(currentBalance("BANK", null, [{ type: "weird", amount: 7 }]), 7);
  assert.equal(currentBalance("BANK", null, []), 0);
});

test("effectiveCategory prefers override", () => {
  assert.equal(effectiveCategory({ category: "groceries", categoryOverride: "transfer" }), "transfer");
  assert.equal(effectiveCategory({ category: "groceries", categoryOverride: null }), "groceries");
});
```

- [ ] **Step 2: Run → fail**

Run: `node --import tsx --test server/lib/balance.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write `server/lib/effectiveCategory.ts`**

```typescript
export function effectiveCategory(tx: { category: string; categoryOverride?: string | null }): string {
  return tx.categoryOverride ?? tx.category;
}
```

- [ ] **Step 4: Write `server/lib/balance.ts`**

```typescript
export interface BalanceLike {
  type: string;
  amount: number;
}

const PREFERRED = ["interimAvailable", "expected", "closingBooked"];

export function currentBalance(
  source: "BANK" | "MANUAL",
  manualBalance: number | null,
  balances: BalanceLike[],
): number {
  if (source === "MANUAL") return manualBalance ?? 0;
  for (const t of PREFERRED) {
    const b = balances.find((x) => x.type === t);
    if (b) return b.amount;
  }
  return balances.length ? balances[0].amount : 0;
}
```

- [ ] **Step 5: Run → pass**

Run: `node --import tsx --test server/lib/balance.test.ts`
Expected: PASS (3).

- [ ] **Step 6: Commit**

```bash
git add server/lib/effectiveCategory.ts server/lib/balance.ts server/lib/balance.test.ts
git commit -m "feat: effectiveCategory + currentBalance resolvers"
```

---

## Task 4: budget.ts (TDD)

**Files:** `server/lib/budget.ts` (create), `server/lib/budget.test.ts` (create)

- [ ] **Step 1: Write failing test `server/lib/budget.test.ts`**

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { monthOf, personalSpendByCategory, buildBudgetRows, cashFlow, type BudgetTx } from "./budget.ts";

const txns: BudgetTx[] = [
  { amount: -10, category: "groceries", bookingDate: "2026-06-02" },
  { amount: -20, category: "groceries", bookingDate: "2026-06-10" },
  { amount: -5, category: "transport", bookingDate: "2026-06-11" },
  { amount: 2500, category: "income", bookingDate: "2026-06-01" },
  { amount: -100, category: "transfer", bookingDate: "2026-06-03" }, // excluded
  { amount: -30, category: "groceries", bookingDate: "2026-05-30" }, // other month
];

test("monthOf slices YYYY-MM", () => {
  assert.equal(monthOf("2026-06-02"), "2026-06");
  assert.equal(monthOf(null), null);
});

test("personalSpendByCategory: debits only, excludes income/transfer/other months", () => {
  const s = personalSpendByCategory(txns, "2026-06");
  assert.equal(s.groceries, 30);
  assert.equal(s.transport, 5);
  assert.equal(s.income, undefined);
  assert.equal(s.transfer, undefined);
});

test("buildBudgetRows yields a row per spending category with percent + remaining", () => {
  const rows = buildBudgetRows({ groceries: 100 }, { groceries: 30, transport: 5 });
  const g = rows.find((r) => r.category === "groceries")!;
  assert.deepEqual(g, { category: "groceries", monthlyLimit: 100, spent: 30, remaining: 70, percent: 30 });
  const t = rows.find((r) => r.category === "transport")!;
  assert.equal(t.monthlyLimit, 0);
  assert.equal(t.percent, 0); // unset limit -> percent 0
});

test("cashFlow excludes transfers, computes savings rate", () => {
  const cf = cashFlow(txns, "2026-06");
  assert.equal(cf.income, 2500);
  assert.equal(cf.expenses, 35); // 10+20+5, transfer excluded
  assert.equal(cf.net, 2465);
  assert.equal(cf.savingsRate, 99); // round(2465/2500*100)
});

test("cashFlow with zero income gives rate 0", () => {
  assert.equal(cashFlow([{ amount: -10, category: "groceries", bookingDate: "2026-06-01" }], "2026-06").savingsRate, 0);
});
```

- [ ] **Step 2: Run → fail**

Run: `node --import tsx --test server/lib/budget.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write `server/lib/budget.ts`**

```typescript
import { SPENDING_CATEGORIES } from "./categorize.ts";

export interface BudgetTx {
  amount: number;
  category: string; // effective category
  bookingDate: string | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function monthOf(date: string | null): string | null {
  return date ? date.slice(0, 7) : null;
}

export function personalSpendByCategory(txns: BudgetTx[], month: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of txns) {
    if (t.category === "transfer" || t.category === "income") continue;
    if (t.amount >= 0) continue;
    if (monthOf(t.bookingDate) !== month) continue;
    out[t.category] = round2((out[t.category] ?? 0) + -t.amount);
  }
  return out;
}

export interface BudgetRow {
  category: string;
  monthlyLimit: number;
  spent: number;
  remaining: number;
  percent: number;
}

export function buildBudgetRows(
  limits: Record<string, number>,
  spent: Record<string, number>,
): BudgetRow[] {
  return SPENDING_CATEGORIES.map((category) => {
    const monthlyLimit = limits[category] ?? 0;
    const s = round2(spent[category] ?? 0);
    return {
      category,
      monthlyLimit,
      spent: s,
      remaining: round2(monthlyLimit - s),
      percent: monthlyLimit > 0 ? Math.round((s / monthlyLimit) * 100) : 0,
    };
  });
}

export function cashFlow(txns: BudgetTx[], month: string): { income: number; expenses: number; net: number; savingsRate: number } {
  let income = 0;
  let expenses = 0;
  for (const t of txns) {
    if (t.category === "transfer") continue;
    if (monthOf(t.bookingDate) !== month) continue;
    if (t.amount > 0) income += t.amount;
    else expenses += -t.amount;
  }
  const net = round2(income - expenses);
  return {
    income: round2(income),
    expenses: round2(expenses),
    net,
    savingsRate: income > 0 ? Math.round((net / income) * 100) : 0,
  };
}
```

- [ ] **Step 4: Run → pass**

Run: `node --import tsx --test server/lib/budget.test.ts`
Expected: PASS (5).

- [ ] **Step 5: Commit**

```bash
git add server/lib/budget.ts server/lib/budget.test.ts
git commit -m "feat: budget + cash-flow pure logic"
```

---

## Task 5: shared DTOs

**Files:** `shared/types.ts` (modify)

- [ ] **Step 1: Replace the existing `AccountDTO` interface** in `shared/types.ts` with:

```typescript
export type AccountType = "PERSONAL" | "BUSINESS";
export type AccountSource = "BANK" | "MANUAL";

export interface AccountDTO {
  id: string;
  name: string | null;
  nickname: string | null;
  displayName: string;
  iban: string | null;
  currency: string | null;
  type: AccountType;
  source: AccountSource;
  currentBalance: number;
  balances: AccountBalanceDTO[];
}
```

- [ ] **Step 2: Append new DTOs** at the end of `shared/types.ts`:

```typescript
export interface BudgetDTO {
  category: string;
  monthlyLimit: number;
  spent: number;
  remaining: number;
  percent: number;
}

export interface SummaryDTO {
  month: string;
  netWorth: number;
  income: number;
  expenses: number;
  net: number;
  savingsRate: number;
}

export interface ManualAccountInput {
  name: string;
  type: AccountType;
  currency?: string;
  manualBalance?: string;
}

export interface ManualTxnInput {
  accountId: string;
  date: string;
  amount: string;
  category: string;
}
```

- [ ] **Step 3: Extend `TransactionDTO`** — add `autoCategory` and `source` fields. Replace the `TransactionDTO` interface with:

```typescript
export interface TransactionDTO {
  id: string;
  accountId: string;
  bookingDate: string | null;
  amount: string;
  currency: string;
  name: string | null;
  remittanceInfo: string | null;
  category: string;      // effective
  autoCategory: string;  // auto-derived (before override)
  source: AccountSource;
  status: string;
}
```

- [ ] **Step 4: Verify compile**

Run: `eval "$(/opt/homebrew/bin/brew shellenv)"; eval "$(fnm env)"; cd /Users/mansoor/Developer/personal/finance; pnpm exec prisma generate && pnpm exec tsc --noEmit`
Expected: tsc exits 0. (Routes not yet updated may error — if so, that's expected until later tasks; note it and continue. Prefer to run tsc after Task 10.)

- [ ] **Step 5: Commit**

```bash
git add shared/types.ts
git commit -m "feat: DTOs for account type/source, budgets, summary, manual inputs"
```

---

## Task 6: accounts route — type/source/balance, manual create, extended patch, manual delete

**Files:** `server/routes/accounts.ts` (replace whole file)

- [ ] **Step 1: Replace `server/routes/accounts.ts` with:**

```typescript
import { Router } from "express";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { db } from "../lib/db.ts";
import { GoCardlessClient } from "../gocardless/client.ts";
import { displayName } from "../../shared/displayName.ts";
import { currentBalance } from "../lib/balance.ts";
import type { AccountDTO, BankDTO } from "../../shared/types.ts";

export const accountsRouter = Router();
const gc = new GoCardlessClient();

type AccountWithBalances = {
  id: string; name: string | null; nickname: string | null; iban: string | null;
  currency: string | null; type: "PERSONAL" | "BUSINESS"; source: "BANK" | "MANUAL";
  manualBalance: { toString(): string } | null;
  balances: { type: string; amount: { toString(): string }; currency: string }[];
};

function toAccountDTO(a: AccountWithBalances): AccountDTO {
  return {
    id: a.id,
    name: a.name,
    nickname: a.nickname,
    displayName: displayName(a),
    iban: a.iban,
    currency: a.currency,
    type: a.type,
    source: a.source,
    currentBalance: currentBalance(
      a.source,
      a.manualBalance != null ? Number(a.manualBalance.toString()) : null,
      a.balances.map((b) => ({ type: b.type, amount: Number(b.amount.toString()) })),
    ),
    balances: a.balances.map((b) => ({ type: b.type, amount: b.amount.toString(), currency: b.currency })),
  };
}

accountsRouter.get("/accounts", async (_req, res, next) => {
  try {
    const reqs = await db.requisition.findMany({
      include: { accounts: { include: { balances: true } } },
      orderBy: { createdAt: "asc" },
    });
    const banks: BankDTO[] = reqs.map((r) => ({
      requisitionId: r.id,
      institutionId: r.institutionId,
      institutionName: r.institutionName,
      status: r.status,
      accounts: r.accounts.map((a) => toAccountDTO(a as unknown as AccountWithBalances)),
    }));
    const manual = await db.account.findMany({
      where: { source: "MANUAL" },
      include: { balances: true },
      orderBy: { createdAt: "asc" },
    });
    if (manual.length) {
      banks.push({
        requisitionId: "manual",
        institutionId: "manual",
        institutionName: "Manual / Cash",
        status: "MANUAL",
        accounts: manual.map((a) => toAccountDTO(a as unknown as AccountWithBalances)),
      });
    }
    res.json(banks);
  } catch (err) {
    next(err);
  }
});

accountsRouter.post("/accounts/manual", async (req, res, next) => {
  try {
    const body = z
      .object({
        name: z.string().min(1),
        type: z.enum(["PERSONAL", "BUSINESS"]),
        currency: z.string().optional(),
        manualBalance: z.string().optional(),
      })
      .parse(req.body);
    const account = await db.account.create({
      data: {
        id: `manual-${randomUUID()}`,
        source: "MANUAL",
        type: body.type,
        name: body.name,
        currency: body.currency ?? "GBP",
        manualBalance: body.manualBalance ?? "0",
      },
    });
    res.json({ id: account.id });
  } catch (err) {
    next(err);
  }
});

accountsRouter.patch("/accounts/:id", async (req, res, next) => {
  try {
    const body = z
      .object({
        nickname: z.string().max(60).nullable().optional(),
        type: z.enum(["PERSONAL", "BUSINESS"]).optional(),
        name: z.string().optional(),
        manualBalance: z.string().optional(),
      })
      .parse(req.body);
    const account = await db.account.findUnique({ where: { id: req.params.id } });
    if (!account) {
      res.status(404).json({ error: "Account not found" });
      return;
    }
    if (body.manualBalance !== undefined && account.source !== "MANUAL") {
      res.status(400).json({ error: "manualBalance is only valid for manual accounts" });
      return;
    }
    const data: Record<string, unknown> = {};
    if (body.nickname !== undefined) data.nickname = body.nickname && body.nickname.trim() ? body.nickname.trim() : null;
    if (body.type !== undefined) data.type = body.type;
    if (body.name !== undefined) data.name = body.name;
    if (body.manualBalance !== undefined) data.manualBalance = body.manualBalance;
    const updated = await db.account.update({ where: { id: req.params.id }, data });
    res.json({ id: updated.id, displayName: displayName(updated) });
  } catch (err) {
    next(err);
  }
});

accountsRouter.delete("/accounts/:id", async (req, res, next) => {
  try {
    const account = await db.account.findUnique({ where: { id: req.params.id } });
    if (!account) {
      res.status(404).json({ error: "Account not found" });
      return;
    }
    if (account.source !== "MANUAL") {
      res.status(400).json({ error: "Use DELETE /api/banks/:requisitionId for bank accounts" });
      return;
    }
    await db.syncLog.deleteMany({ where: { accountId: account.id } });
    await db.transaction.deleteMany({ where: { accountId: account.id } });
    await db.balance.deleteMany({ where: { accountId: account.id } });
    await db.account.delete({ where: { id: account.id } });
    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
});

accountsRouter.delete("/banks/:requisitionId", async (req, res, next) => {
  try {
    const id = req.params.requisitionId;
    const reqn = await db.requisition.findUnique({ where: { id }, include: { accounts: true } });
    if (!reqn) {
      res.status(404).json({ error: "Bank connection not found" });
      return;
    }
    const accountIds = reqn.accounts.map((a) => a.id);
    let remoteDeleted = true;
    try {
      await gc.deleteRequisition(id);
    } catch (e) {
      console.error("GoCardless requisition delete failed", e);
      remoteDeleted = false;
    }
    await db.syncLog.deleteMany({ where: { accountId: { in: accountIds } } });
    await db.transaction.deleteMany({ where: { accountId: { in: accountIds } } });
    await db.balance.deleteMany({ where: { accountId: { in: accountIds } } });
    await db.account.deleteMany({ where: { requisitionId: id } });
    await db.requisition.delete({ where: { id } });
    res.json({ deleted: true, remoteDeleted });
  } catch (err) {
    next(err);
  }
});
```

- [ ] **Step 2: Commit** (compile verified in Task 10)

```bash
git add server/routes/accounts.ts
git commit -m "feat: accounts route — type/source/balance, manual create/delete, extended patch"
```

---

## Task 7: transactions route + dashboard effective-category/transfer handling

**Files:** `server/routes/transactions.ts` (create), `server/routes/dashboard.ts` (modify)

- [ ] **Step 1: Create `server/routes/transactions.ts`**

```typescript
import { Router } from "express";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { db } from "../lib/db.ts";
import { CATEGORIES } from "../lib/categorize.ts";

export const transactionsRouter = Router();
const isCategory = (c: string) => CATEGORIES.includes(c);

transactionsRouter.post("/transactions", async (req, res, next) => {
  try {
    const body = z
      .object({
        accountId: z.string().min(1),
        date: z.string().min(1),
        amount: z.string().min(1),
        category: z.string().refine(isCategory, "unknown category"),
      })
      .parse(req.body);
    const account = await db.account.findUnique({ where: { id: body.accountId } });
    if (!account) {
      res.status(404).json({ error: "Account not found" });
      return;
    }
    if (account.source !== "MANUAL") {
      res.status(400).json({ error: "Manual transactions can only be added to manual accounts" });
      return;
    }
    const tx = await db.transaction.create({
      data: {
        id: `manual-${randomUUID()}`,
        accountId: body.accountId,
        bookingDate: body.date,
        amount: body.amount,
        currency: account.currency ?? "GBP",
        category: body.category,
        status: "booked",
        raw: { manual: true },
      },
    });
    res.json({ id: tx.id });
  } catch (err) {
    next(err);
  }
});

transactionsRouter.patch("/transactions/:id", async (req, res, next) => {
  try {
    const { category } = z
      .object({ category: z.string().refine(isCategory, "unknown category") })
      .parse(req.body);
    const tx = await db.transaction.findUnique({ where: { id: req.params.id } });
    if (!tx) {
      res.status(404).json({ error: "Transaction not found" });
      return;
    }
    await db.transaction.update({ where: { id: req.params.id }, data: { categoryOverride: category } });
    res.json({ id: req.params.id, category });
  } catch (err) {
    next(err);
  }
});

transactionsRouter.delete("/transactions/:id", async (req, res, next) => {
  try {
    const tx = await db.transaction.findUnique({ where: { id: req.params.id }, include: { account: true } });
    if (!tx) {
      res.status(404).json({ error: "Transaction not found" });
      return;
    }
    if (tx.account.source !== "MANUAL") {
      res.status(400).json({ error: "Only manual transactions can be deleted" });
      return;
    }
    await db.transaction.delete({ where: { id: req.params.id } });
    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
});
```

- [ ] **Step 2: Update `server/routes/dashboard.ts`** — use effective category, exclude transfer, and return `autoCategory`/`source` on transactions.

Add imports at the top:
```typescript
import { effectiveCategory } from "../lib/effectiveCategory.ts";
```

In the `/dashboard` handler, replace the `agg` mapping so it uses effective category and drops transfers:
```typescript
    const agg: AggTx[] = txns
      .map((t) => ({
        amount: Number(t.amount),
        category: effectiveCategory(t),
        merchant: t.merchantName ?? t.creditorName ?? t.debtorName ?? null,
        bookingDate: t.bookingDate,
      }))
      .filter((t) => t.category !== "transfer");
```

In the `/transactions` handler, change the query to include the account and the DTO mapping to return effective category, autoCategory, and source. Replace the `db.transaction.findMany({...})` call's options to add `include: { account: true }` (keep the existing `where`, `orderBy`, `take`), and replace the DTO map with:
```typescript
    const dto: TransactionDTO[] = txns.map((t) => ({
      id: t.id,
      accountId: t.accountId,
      bookingDate: t.bookingDate,
      amount: t.amount.toString(),
      currency: t.currency,
      name: t.merchantName ?? t.creditorName ?? t.debtorName ?? null,
      remittanceInfo: t.remittanceInfo,
      category: effectiveCategory(t),
      autoCategory: t.category,
      source: t.account.source,
      status: t.status,
    }));
```

- [ ] **Step 3: Commit** (compile verified in Task 10)

```bash
git add server/routes/transactions.ts server/routes/dashboard.ts
git commit -m "feat: manual transactions + category override; effective-category aware dashboard"
```

---

## Task 8: budgets route

**Files:** `server/routes/budgets.ts` (create)

- [ ] **Step 1: Create `server/routes/budgets.ts`**

```typescript
import { Router } from "express";
import { z } from "zod";
import { db } from "../lib/db.ts";
import { SPENDING_CATEGORIES } from "../lib/categorize.ts";
import { effectiveCategory } from "../lib/effectiveCategory.ts";
import { personalSpendByCategory, buildBudgetRows, type BudgetTx } from "../lib/budget.ts";

export const budgetsRouter = Router();

budgetsRouter.get("/budgets", async (_req, res, next) => {
  try {
    const month = new Date().toISOString().slice(0, 7);
    const budgets = await db.budget.findMany();
    const limits: Record<string, number> = {};
    for (const b of budgets) limits[b.category] = Number(b.monthlyLimit.toString());

    const personal = await db.account.findMany({ where: { type: "PERSONAL" }, select: { id: true } });
    const ids = personal.map((a) => a.id);
    const txns = await db.transaction.findMany({ where: { accountId: { in: ids } } });
    const budgetTxns: BudgetTx[] = txns.map((t) => ({
      amount: Number(t.amount),
      category: effectiveCategory(t),
      bookingDate: t.bookingDate,
    }));
    const spent = personalSpendByCategory(budgetTxns, month);
    res.json(buildBudgetRows(limits, spent));
  } catch (err) {
    next(err);
  }
});

budgetsRouter.put("/budgets/:category", async (req, res, next) => {
  try {
    const category = req.params.category;
    if (!SPENDING_CATEGORIES.includes(category as never)) {
      res.status(400).json({ error: "Unknown spending category" });
      return;
    }
    const { monthlyLimit } = z.object({ monthlyLimit: z.number().min(0) }).parse(req.body);
    await db.budget.upsert({
      where: { category },
      create: { category, monthlyLimit },
      update: { monthlyLimit },
    });
    res.json({ category, monthlyLimit });
  } catch (err) {
    next(err);
  }
});
```

- [ ] **Step 2: Commit** (compile verified in Task 10)

```bash
git add server/routes/budgets.ts
git commit -m "feat: budgets route (list with progress, upsert limit)"
```

---

## Task 9: summary route (net worth + cash flow)

**Files:** `server/routes/summary.ts` (create)

- [ ] **Step 1: Create `server/routes/summary.ts`**

```typescript
import { Router } from "express";
import { db } from "../lib/db.ts";
import { currentBalance } from "../lib/balance.ts";
import { effectiveCategory } from "../lib/effectiveCategory.ts";
import { cashFlow, type BudgetTx } from "../lib/budget.ts";
import type { SummaryDTO } from "../../shared/types.ts";

export const summaryRouter = Router();
const round2 = (n: number) => Math.round(n * 100) / 100;

summaryRouter.get("/summary", async (_req, res, next) => {
  try {
    const month = new Date().toISOString().slice(0, 7);
    const accounts = await db.account.findMany({ include: { balances: true } });
    let netWorth = 0;
    for (const a of accounts) {
      netWorth += currentBalance(
        a.source,
        a.manualBalance != null ? Number(a.manualBalance.toString()) : null,
        a.balances.map((b) => ({ type: b.type, amount: Number(b.amount.toString()) })),
      );
    }
    const personalIds = accounts.filter((a) => a.type === "PERSONAL").map((a) => a.id);
    const txns = await db.transaction.findMany({ where: { accountId: { in: personalIds } } });
    const cf = cashFlow(
      txns.map<BudgetTx>((t) => ({ amount: Number(t.amount), category: effectiveCategory(t), bookingDate: t.bookingDate })),
      month,
    );
    const dto: SummaryDTO = { month, netWorth: round2(netWorth), ...cf };
    res.json(dto);
  } catch (err) {
    next(err);
  }
});
```

- [ ] **Step 2: Commit** (compile verified in Task 10)

```bash
git add server/routes/summary.ts
git commit -m "feat: summary route (net worth + monthly cash flow/savings)"
```

---

## Task 10: mount routes + compile gate

**Files:** `server/index.ts` (modify)

- [ ] **Step 1: Add imports + mounts in `server/index.ts`**

Add imports near the other route imports:
```typescript
import { transactionsRouter } from "./routes/transactions.ts";
import { budgetsRouter } from "./routes/budgets.ts";
import { summaryRouter } from "./routes/summary.ts";
```
Mount them with the others (after `accountsRouter`):
```typescript
app.use("/api", transactionsRouter);
app.use("/api", budgetsRouter);
app.use("/api", summaryRouter);
```

- [ ] **Step 2: Full backend compile + tests**

Run: `eval "$(/opt/homebrew/bin/brew shellenv)"; eval "$(fnm env)"; cd /Users/mansoor/Developer/personal/finance; pnpm exec prisma generate && pnpm exec tsc --noEmit && pnpm test`
Expected: tsc exits 0; tests pass (previous 20 + categories 2 + balance 3 + budget 5 = 30).

- [ ] **Step 3: Commit**

```bash
git add server/index.ts
git commit -m "feat: mount transactions, budgets, summary routes"
```

---

## Task 11: frontend api helpers

**Files:** `web/src/api.ts` (replace whole file)

- [ ] **Step 1: Replace `web/src/api.ts` with:**

```typescript
import type {
  InstitutionDTO, ConnectResponse, FinalizeResponse,
  SyncResult, DashboardDTO, TransactionDTO,
  BankDTO, RemoveBankResult, NicknameResult,
  BudgetDTO, SummaryDTO, ManualAccountInput, ManualTxnInput,
} from "../../shared/types.ts";

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? res.statusText);
  return res.json();
}
async function send<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? res.statusText);
  return res.json();
}
const acctQuery = (accountId?: string) =>
  accountId && accountId !== "all" ? `accountId=${encodeURIComponent(accountId)}` : "";

export const api = {
  institutions: () => get<InstitutionDTO[]>("/api/institutions"),
  connect: (institutionId: string) => send<ConnectResponse>("POST", "/api/connect", { institutionId }),
  finalize: (id: string) => send<FinalizeResponse>("POST", `/api/connect/${id}/finalize`),
  sync: () => send<SyncResult[]>("POST", "/api/sync"),
  accounts: () => get<BankDTO[]>("/api/accounts"),
  createManualAccount: (input: ManualAccountInput) => send<{ id: string }>("POST", "/api/accounts/manual", input),
  patchAccount: (id: string, patch: { nickname?: string | null; type?: string; name?: string; manualBalance?: string }) =>
    send<NicknameResult>("PATCH", `/api/accounts/${id}`, patch),
  deleteManualAccount: (id: string) => send<{ deleted: boolean }>("DELETE", `/api/accounts/${id}`),
  removeBank: (requisitionId: string) => send<RemoveBankResult>("DELETE", `/api/banks/${requisitionId}`),
  createTxn: (input: ManualTxnInput) => send<{ id: string }>("POST", "/api/transactions", input),
  setTxnCategory: (id: string, category: string) => send<{ id: string; category: string }>("PATCH", `/api/transactions/${id}`, { category }),
  deleteTxn: (id: string) => send<{ deleted: boolean }>("DELETE", `/api/transactions/${id}`),
  budgets: () => get<BudgetDTO[]>("/api/budgets"),
  setBudget: (category: string, monthlyLimit: number) => send<unknown>("PUT", `/api/budgets/${category}`, { monthlyLimit }),
  summary: () => get<SummaryDTO>("/api/summary"),
  dashboard: (accountId?: string) => { const q = acctQuery(accountId); return get<DashboardDTO>(`/api/dashboard${q ? `?${q}` : ""}`); },
  transactions: (search = "", accountId?: string) => {
    const parts = [`search=${encodeURIComponent(search)}`, acctQuery(accountId)].filter(Boolean);
    return get<TransactionDTO[]>(`/api/transactions?${parts.join("&")}`);
  },
};

export const CATEGORY_OPTIONS = ["groceries", "eating-out", "transport", "bills", "shopping", "other", "income", "transfer"];
```

- [ ] **Step 2: Verify build**

Run: `eval "$(/opt/homebrew/bin/brew shellenv)"; eval "$(fnm env)"; cd /Users/mansoor/Developer/personal/finance; pnpm exec vite build`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add web/src/api.ts
git commit -m "feat: api helpers for manual accounts/txns, budgets, summary"
```

---

## Task 12: Manage page — type toggle, manual accounts & transactions

**Files:** `web/src/pages/Accounts.tsx` (replace whole file)

- [ ] **Step 1: Replace `web/src/pages/Accounts.tsx` with:**

```typescript
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, CATEGORY_OPTIONS } from "../api.ts";
import type { BankDTO } from "../../../shared/types.ts";

export default function Accounts() {
  const [banks, setBanks] = useState<BankDTO[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const navigate = useNavigate();

  const load = () => api.accounts().then(setBanks).catch((e) => setMsg(e.message));
  useEffect(() => { load(); }, []);

  const wrap = async (fn: () => Promise<unknown>) => {
    try { await fn(); await load(); } catch (e) { setMsg((e as Error).message); }
  };

  const addManual = () => {
    const name = window.prompt("Account name (e.g. Cash, Trading 212):");
    if (!name) return;
    const isBiz = window.confirm("Is this a BUSINESS account? OK = business, Cancel = personal.");
    const bal = window.prompt("Current balance (£):", "0") ?? "0";
    wrap(() => api.createManualAccount({ name, type: isBiz ? "BUSINESS" : "PERSONAL", manualBalance: bal }));
  };

  const editBalance = (id: string, current: number) => {
    const bal = window.prompt("New balance (£):", String(current));
    if (bal === null) return;
    wrap(() => api.patchAccount(id, { manualBalance: bal }));
  };

  const rename = (id: string, current: string) => {
    const nickname = window.prompt("Nickname (blank to clear):", current);
    if (nickname === null) return;
    wrap(() => api.patchAccount(id, { nickname: nickname.trim() || null }));
  };

  const toggleType = (id: string, type: string) =>
    wrap(() => api.patchAccount(id, { type: type === "PERSONAL" ? "BUSINESS" : "PERSONAL" }));

  const addTxn = (accountId: string) => {
    const date = window.prompt("Date (YYYY-MM-DD):", new Date().toISOString().slice(0, 10));
    if (!date) return;
    const amount = window.prompt("Amount (negative for spending, e.g. -12.50):");
    if (!amount) return;
    const category = window.prompt(`Category (${CATEGORY_OPTIONS.join(", ")}):`, "other") ?? "other";
    wrap(() => api.createTxn({ accountId, date, amount, category }));
  };

  const removeManual = (id: string, name: string) => {
    if (!window.confirm(`Delete ${name} and its manual transactions?`)) return;
    wrap(() => api.deleteManualAccount(id));
  };

  const removeBank = (requisitionId: string, name: string) => {
    if (!window.confirm(`Remove ${name}? Deletes its stored transactions/balances.`)) return;
    wrap(() => api.removeBank(requisitionId));
  };

  const reconnect = (institutionId: string) =>
    api.connect(institutionId).then(({ link }) => { window.location.href = link; }).catch((e) => setMsg(e.message));

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1>Manage accounts</h1>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={addManual}>Add cash / manual</button>
          <button onClick={() => navigate("/connect")}>Add bank</button>
        </div>
      </div>
      {msg && <p>{msg}</p>}
      {banks.map((bank) => (
        <div className="card" key={bank.requisitionId}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h3 style={{ margin: 0 }}>
              {bank.institutionName}{" "}
              <span style={{ fontSize: 12, color: bank.status === "LN" ? "#16a34a" : "#6b7280" }}>({bank.status})</span>
            </h3>
            {bank.requisitionId !== "manual" && (
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => reconnect(bank.institutionId)}>Reconnect</button>
                <button style={{ background: "#dc2626" }} onClick={() => removeBank(bank.requisitionId, bank.institutionName)}>Remove</button>
              </div>
            )}
          </div>
          <table style={{ marginTop: 8 }}>
            <thead><tr><th>Account</th><th>Type</th><th>Balance</th><th></th></tr></thead>
            <tbody>
              {bank.accounts.map((a) => (
                <tr key={a.id}>
                  <td>{a.displayName}</td>
                  <td>
                    <button onClick={() => toggleType(a.id, a.type)}>{a.type}</button>
                  </td>
                  <td>{a.currency ?? "GBP"} {a.currentBalance.toFixed(2)}</td>
                  <td style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <button onClick={() => rename(a.id, a.nickname ?? "")}>Rename</button>
                    {a.source === "MANUAL" && <button onClick={() => editBalance(a.id, a.currentBalance)}>Set balance</button>}
                    {a.source === "MANUAL" && <button onClick={() => addTxn(a.id)}>Add txn</button>}
                    {a.source === "MANUAL" && <button style={{ background: "#dc2626" }} onClick={() => removeManual(a.id, a.displayName)}>Delete</button>}
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

- [ ] **Step 2: Verify build**

Run: `eval "$(/opt/homebrew/bin/brew shellenv)"; eval "$(fnm env)"; cd /Users/mansoor/Developer/personal/finance; pnpm exec vite build`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add web/src/pages/Accounts.tsx
git commit -m "feat: manage page — account type, manual accounts + transactions"
```

---

## Task 13: Transactions page — category override + delete manual

**Files:** `web/src/pages/Transactions.tsx` (replace whole file)

- [ ] **Step 1: Replace `web/src/pages/Transactions.tsx` with:**

```typescript
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, CATEGORY_OPTIONS } from "../api.ts";
import type { TransactionDTO, BankDTO } from "../../../shared/types.ts";
import { AccountSelector } from "../components/AccountSelector.tsx";

export default function Transactions() {
  const [params] = useSearchParams();
  const accountId = params.get("account") ?? undefined;
  const [rows, setRows] = useState<TransactionDTO[]>([]);
  const [banks, setBanks] = useState<BankDTO[]>([]);
  const [q, setQ] = useState("");

  const loadBanks = () => api.accounts().then(setBanks).catch(() => setBanks([]));
  useEffect(() => { loadBanks(); }, []);

  const load = () => api.transactions(q, accountId).then(setRows).catch(() => setRows([]));
  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line
  }, [q, accountId]);

  const nameById = useMemo(() => {
    const m = new Map<string, string>();
    banks.forEach((b) => b.accounts.forEach((a) => m.set(a.id, a.displayName)));
    return m;
  }, [banks]);

  const setCategory = async (id: string, category: string) => {
    try { await api.setTxnCategory(id, category); await load(); } catch { /* ignore */ }
  };
  const del = async (id: string) => {
    if (!window.confirm("Delete this manual transaction?")) return;
    try { await api.deleteTxn(id); await load(); } catch { /* ignore */ }
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1>Transactions</h1>
        <AccountSelector />
      </div>
      <input placeholder="Search..." value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="card" style={{ marginTop: 16 }}>
        <table>
          <thead><tr><th>Date</th><th>Account</th><th>Name</th><th>Category</th><th>Amount</th><th></th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.bookingDate ?? ""}</td>
                <td>{nameById.get(r.accountId) ?? r.accountId.slice(-4)}</td>
                <td>{r.name ?? r.remittanceInfo ?? ""}</td>
                <td>
                  <select value={r.category} onChange={(e) => setCategory(r.id, e.target.value)}>
                    {CATEGORY_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </td>
                <td style={{ color: Number(r.amount) < 0 ? "#dc2626" : "#16a34a" }}>{r.currency} {r.amount}</td>
                <td>{r.source === "MANUAL" && <button style={{ background: "#dc2626" }} onClick={() => del(r.id)}>✕</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `eval "$(/opt/homebrew/bin/brew shellenv)"; eval "$(fnm env)"; cd /Users/mansoor/Developer/personal/finance; pnpm exec vite build`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add web/src/pages/Transactions.tsx
git commit -m "feat: transactions category override + manual delete"
```

---

## Task 14: Budgets page + nav

**Files:** `web/src/pages/Budgets.tsx` (create), `web/src/App.tsx` (modify)

- [ ] **Step 1: Create `web/src/pages/Budgets.tsx`**

```typescript
import { useEffect, useState } from "react";
import { api } from "../api.ts";
import type { BudgetDTO } from "../../../shared/types.ts";

function barColor(percent: number): string {
  if (percent > 100) return "#dc2626";
  if (percent >= 80) return "#f59e0b";
  return "#16a34a";
}

export default function Budgets() {
  const [rows, setRows] = useState<BudgetDTO[]>([]);
  const [msg, setMsg] = useState<string | null>(null);

  const load = () => api.budgets().then(setRows).catch((e) => setMsg(e.message));
  useEffect(() => { load(); }, []);

  const edit = async (category: string, current: number) => {
    const v = window.prompt(`Monthly limit for ${category} (£):`, String(current));
    if (v === null) return;
    const n = Number(v);
    if (Number.isNaN(n) || n < 0) { setMsg("Enter a number ≥ 0"); return; }
    try { await api.setBudget(category, n); await load(); } catch (e) { setMsg((e as Error).message); }
  };

  return (
    <div>
      <h1>Budgets <span style={{ fontSize: 13, color: "#6b7280" }}>(personal accounts, this month)</span></h1>
      {msg && <p>{msg}</p>}
      {rows.map((r) => (
        <div className="card" key={r.category}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <strong>{r.category}</strong>
            <span>
              £{r.spent.toFixed(2)} / £{r.monthlyLimit.toFixed(2)}{" "}
              <button onClick={() => edit(r.category, r.monthlyLimit)}>Set</button>
            </span>
          </div>
          <div style={{ background: "#eee", borderRadius: 6, height: 10, marginTop: 8, overflow: "hidden" }}>
            <div style={{ width: `${Math.min(r.percent, 100)}%`, height: "100%", background: barColor(r.percent) }} />
          </div>
          <div style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>
            {r.monthlyLimit > 0 ? `${r.percent}% used · £${r.remaining.toFixed(2)} remaining` : "no limit set"}
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Add nav link + route in `web/src/App.tsx`** — replace the whole file with:

```typescript
import { Link, Route, Routes } from "react-router-dom";
import Connect from "./pages/Connect.tsx";
import Callback from "./pages/Callback.tsx";
import Dashboard from "./pages/Dashboard.tsx";
import Transactions from "./pages/Transactions.tsx";
import Accounts from "./pages/Accounts.tsx";
import Budgets from "./pages/Budgets.tsx";

export default function App() {
  return (
    <>
      <nav>
        <Link to="/">Dashboard</Link>
        <Link to="/transactions">Transactions</Link>
        <Link to="/budgets">Budgets</Link>
        <Link to="/accounts">Manage</Link>
        <Link to="/connect">Connect bank</Link>
      </nav>
      <div className="container">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/transactions" element={<Transactions />} />
          <Route path="/budgets" element={<Budgets />} />
          <Route path="/accounts" element={<Accounts />} />
          <Route path="/connect" element={<Connect />} />
          <Route path="/callback" element={<Callback />} />
        </Routes>
      </div>
    </>
  );
}
```

- [ ] **Step 3: Verify build**

Run: `eval "$(/opt/homebrew/bin/brew shellenv)"; eval "$(fnm env)"; cd /Users/mansoor/Developer/personal/finance; pnpm exec vite build`
Expected: succeeds.

- [ ] **Step 4: Commit**

```bash
git add web/src/pages/Budgets.tsx web/src/App.tsx
git commit -m "feat: budgets page + nav"
```

---

## Task 15: Dashboard — net worth + monthly cash-flow strip

**Files:** `web/src/pages/Dashboard.tsx` (modify)

- [ ] **Step 1: Add the summary strip to `web/src/pages/Dashboard.tsx`.**

Add imports:
```typescript
import type { SummaryDTO } from "../../../shared/types.ts";
```
Add state + load in the component (next to the existing `data`/`banks` state):
```typescript
  const [summary, setSummary] = useState<SummaryDTO | null>(null);
```
In the existing `load` function, add:
```typescript
    api.summary().then(setSummary).catch(() => setSummary(null));
```
Render the strip just below `<h1>Dashboard</h1>`'s containing header block and before the "Balances by account" card:
```tsx
      {summary && (
        <div className="grid" style={{ marginBottom: 16 }}>
          <div className="card"><div style={{ fontSize: 12, color: "#6b7280" }}>Net worth</div><div style={{ fontSize: 22 }}>£{summary.netWorth.toFixed(2)}</div></div>
          <div className="card"><div style={{ fontSize: 12, color: "#6b7280" }}>Income ({summary.month})</div><div style={{ fontSize: 22, color: "#16a34a" }}>£{summary.income.toFixed(2)}</div></div>
          <div className="card"><div style={{ fontSize: 12, color: "#6b7280" }}>Expenses</div><div style={{ fontSize: 22, color: "#dc2626" }}>£{summary.expenses.toFixed(2)}</div></div>
          <div className="card"><div style={{ fontSize: 12, color: "#6b7280" }}>Net · savings rate</div><div style={{ fontSize: 22 }}>£{summary.net.toFixed(2)} · {summary.savingsRate}%</div></div>
        </div>
      )}
```

- [ ] **Step 2: Verify build**

Run: `eval "$(/opt/homebrew/bin/brew shellenv)"; eval "$(fnm env)"; cd /Users/mansoor/Developer/personal/finance; pnpm exec vite build`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add web/src/pages/Dashboard.tsx
git commit -m "feat: dashboard net-worth + cash-flow/savings strip"
```

---

## Task 16: Full verification

- [ ] **Step 1: Tests + typecheck + build**

Run: `eval "$(/opt/homebrew/bin/brew shellenv)"; eval "$(fnm env)"; cd /Users/mansoor/Developer/personal/finance; pnpm test && pnpm exec tsc --noEmit && pnpm exec vite build`
Expected: tests **30 pass** (20 prior + 2 categories + 3 balance/effective + 5 budget), tsc 0, build OK.

---

## Task 17 (CONTROLLER / live): apply migration to Railway + verify

Not for implementer subagents — the controller applies the migration SQL to the live Railway DB (idempotent), then the human connects Amex/Trading-212/cash and checks budgets.

- [ ] Apply `prisma/migrations/20260608000000_accounts_budgets/migration.sql` to Railway via `psql "$DATABASE_URL" -f ...` (before/after column checks).
- [ ] Human: add a cash account + manual txns; set a budget; tag an account business; verify dashboard net-worth/savings + budgets reflect personal-only.

---

## Self-Review

- **Spec coverage:** enums+fields+Budget+override (Task 1), category lists (Task 2), effective/balance (Task 3), budget+cashflow logic (Task 4), DTOs (Task 5), accounts incl. manual create/delete + type (Task 6), manual txns + override + effective-category dashboard (Task 7), budgets route (Task 8), summary/net-worth (Task 9), mounts (Task 10), api (Task 11), Manage UI (Task 12), Transactions override/delete (Task 13), Budgets page (Task 14), Dashboard strip (Task 15). All spec sections mapped.
- **Placeholder scan:** none; every code step complete.
- **Type consistency:** `AccountDTO`/`AccountType`/`AccountSource`/`BudgetDTO`/`SummaryDTO`/`Manual*Input` (Task 5) consumed identically in routes (6–9) and `api.ts`/pages (11–15). `effectiveCategory`, `currentBalance(source,manualBalance,balances)`, `BudgetTx`, `personalSpendByCategory`/`buildBudgetRows`/`cashFlow` signatures consistent across Tasks 3/4/7/8/9. `CATEGORIES`/`SPENDING_CATEGORIES` (Task 2) used in validation + UI. Sync's `update:{category,status}` leaves `categoryOverride` intact (preserves overrides).
- **Known acceptance:** net-worth is point-in-time (no history); transfers excluded everywhere via effective category.
