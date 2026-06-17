# Savings UKPF-Flowchart Coach — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Savings page as a UK Personal Finance flowchart coach that maps the user's real financial position onto Steps 1/2/4/5 and feeds spare cash to the current step via a surplus nudge.

**Architecture:** A pure, unit-tested engine (`server/lib/plan.ts`) turns plain inputs (budget set?, essential monthly spend, emergency-fund balance, expensive debts, surplus) into an ordered list of steps with one "current" step. A thin route (`server/routes/plan.ts`) assembles those inputs from the DB by reusing existing helpers (`personalSpendByCategory`, `computeFunding`, `currentBalance`, settings). The web Savings page renders the flowchart above the existing pots; a dashboard card surfaces the surplus nudge.

**Tech Stack:** Express 5 + TypeScript (server), Vite 8 + React 19 (web), Prisma v6/Postgres, `node --test`/`tsx` for server tests.

## Global Constraints

- Commit directly to `main`; **do not push** unless the user asks. Commit message trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- Node env before any command: `eval "$(/opt/homebrew/bin/brew shellenv)"; eval "$(fnm env)"`, then **`pnpm`** (never npm).
- **No schema migration** in this feature — all new state via the existing `Setting` table; debt APR uses existing `Account.interestRate`.
- After any change: `pnpm tsc --noEmit -p tsconfig.json` and `pnpm exec vite build`.
- Server tests: `node --test --import tsx server/lib/*.test.ts server/categorise/*.test.ts`.
- `tsconfig` has `noUnusedLocals` — remove unused imports/vars.
- Use `formatGBP` for money in the UI; never `display:flex` on a `<td>`; full-page overlays portal to `document.body`.
- **Never re-implement spend aggregation with a naive per-row sum** (it counts transfers/refunds the budget engine excludes — caused a £3,716 false flag). Always go through `personalSpendByCategory`.

---

### Task 1: Shared category-class module

Move the needs/wants/savings class map to `shared/` so the server can size the emergency fund from `needs`-class spend (today it lives only in `web/src/categoryMeta.ts`).

**Files:**
- Create: `shared/categoryClass.ts`
- Create (test): `server/lib/categoryClass.test.ts`
- Modify: `web/src/categoryMeta.ts:62-71` (re-export from shared)

**Interfaces:**
- Produces: `type SpendClass = "needs" | "wants" | "savings"`; `categoryClass(key: string): SpendClass | null`; `CLASS_TARGET: Record<SpendClass, number>`; `NEEDS_KEYS: string[]`.

- [ ] **Step 1: Write the failing test**

```ts
// server/lib/categoryClass.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { categoryClass, NEEDS_KEYS } from "../../shared/categoryClass.ts";

test("groceries and housing are needs", () => {
  assert.equal(categoryClass("groceries"), "needs");
  assert.equal(categoryClass("housing"), "needs");
});
test("dining-out is wants, unknown is null", () => {
  assert.equal(categoryClass("dining-out"), "wants");
  assert.equal(categoryClass("nonsense"), null);
});
test("NEEDS_KEYS lists every needs category", () => {
  assert.ok(NEEDS_KEYS.includes("groceries"));
  assert.ok(!NEEDS_KEYS.includes("dining-out"));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `eval "$(/opt/homebrew/bin/brew shellenv)"; eval "$(fnm env)"; node --test --import tsx server/lib/categoryClass.test.ts`
Expected: FAIL — cannot find module `../../shared/categoryClass.ts`.

- [ ] **Step 3: Create the shared module**

```ts
// shared/categoryClass.ts
// Single source of truth for the needs/wants/savings dimension (separate from a
// category's functional group). Imported by both web and server.
export type SpendClass = "needs" | "wants" | "savings";

const CLASS: Record<string, SpendClass> = {
  housing: "needs", utilities: "needs", groceries: "needs", transport: "needs",
  "family-care": "needs", "health-fitness": "needs", education: "needs", fees: "needs",
  "dining-out": "wants", shopping: "wants", entertainment: "wants", subscriptions: "wants",
  "travel-holidays": "wants", pets: "wants", "gifts-charities": "wants",
  "savings-investments": "savings", "debt-payments": "savings",
};

export const categoryClass = (key: string): SpendClass | null => CLASS[key] ?? null;
export const CLASS_TARGET: Record<SpendClass, number> = { needs: 50, wants: 30, savings: 20 };
export const NEEDS_KEYS: string[] = Object.keys(CLASS).filter((k) => CLASS[k] === "needs");
```

- [ ] **Step 4: Re-export from `web/src/categoryMeta.ts` so existing imports keep working**

Replace the local `SpendClass`/`CLASS`/`categoryClass`/`CLASS_TARGET` block (lines ~62-71) with:

```ts
export { categoryClass, CLASS_TARGET, type SpendClass } from "../../../shared/categoryClass.ts";
```

(Keep every other export in `categoryMeta.ts` unchanged.)

- [ ] **Step 5: Run test + typecheck + build**

Run: `node --test --import tsx server/lib/categoryClass.test.ts && pnpm tsc --noEmit -p tsconfig.json && pnpm exec vite build`
Expected: test PASS, tsc clean, build OK.

- [ ] **Step 6: Commit**

```bash
git add shared/categoryClass.ts server/lib/categoryClass.test.ts web/src/categoryMeta.ts
git commit -m "refactor: move category-class map to shared for server reuse"
```

---

### Task 2: Savings settings (extend the string-settings layer)

Add three settings. `savings.emergencyAccountId` is a free string (an account id) and the months/cushion are numeric — the current `StringSettingDef` only supports an `allowed` allow-list, so add an optional `validate` predicate.

**Files:**
- Modify: `server/lib/settings.ts:49-69` (the string-settings layer)
- Test: `server/lib/settings.savings.test.ts`

**Interfaces:**
- Consumes: existing `getStringSettings()`, `setStringSetting(key, value)`.
- Produces: keys `savings.emergencyAccountId` (default `""`), `savings.efMonthsFull` (default `"3"`), `savings.cushion` (default `"100"`), each persisted via `setStringSetting`.

- [ ] **Step 1: Write the failing test**

```ts
// server/lib/settings.savings.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { STRING_SETTING_DEFS } from "./settings.ts";

test("savings settings are registered with sane defaults", () => {
  const byKey = Object.fromEntries(STRING_SETTING_DEFS.map((d) => [d.key, d]));
  assert.equal(byKey["savings.efMonthsFull"].default, "3");
  assert.equal(byKey["savings.cushion"].default, "100");
  assert.ok("savings.emergencyAccountId" in byKey);
});
test("numeric setting validates", () => {
  const def = STRING_SETTING_DEFS.find((d) => d.key === "savings.efMonthsFull")!;
  assert.equal(def.validate!("6"), true);
  assert.equal(def.validate!("abc"), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --import tsx server/lib/settings.savings.test.ts`
Expected: FAIL — `savings.efMonthsFull` not found / `validate` undefined.

- [ ] **Step 3: Extend `StringSettingDef` and `setStringSetting`, add the defs**

In `server/lib/settings.ts`, change the interface and validation:

```ts
export interface StringSettingDef { key: string; default: string; allowed?: string[]; validate?: (v: string) => boolean }
export const STRING_SETTING_DEFS: StringSettingDef[] = [
  { key: "dashboard.hero.figure", default: "left", allowed: ["left", "spent", "networth", "net"] },
  { key: "savings.emergencyAccountId", default: "", validate: (v) => v === "" || v.length <= 64 },
  { key: "savings.efMonthsFull", default: "3", validate: (v) => { const n = Number(v); return Number.isFinite(n) && n >= 1 && n <= 12; } },
  { key: "savings.cushion", default: "100", validate: (v) => { const n = Number(v); return Number.isFinite(n) && n >= 0 && n <= 100000; } },
];
```

And in `setStringSetting`, replace the allow-list-only check:

```ts
export async function setStringSetting(key: string, value: string): Promise<boolean> {
  const def = STRING_SETTING_DEFS.find((d) => d.key === key);
  if (!def) return false;
  if (def.allowed && !def.allowed.includes(value)) return false;
  if (def.validate && !def.validate(value)) return false;
  await db.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
  return true;
}
```

- [ ] **Step 4: Run test + typecheck**

Run: `node --test --import tsx server/lib/settings.savings.test.ts && pnpm tsc --noEmit -p tsconfig.json`
Expected: PASS + clean. (The settings PATCH route already accepts string keys via `setStringSetting`; these new keys now flow through. Confirm `server/routes/settings.ts` calls `setStringSetting` for unknown-boolean keys — it does.)

- [ ] **Step 5: Commit**

```bash
git add server/lib/settings.ts server/lib/settings.savings.test.ts
git commit -m "feat: add savings.* settings (EF account, full-EF months, cushion)"
```

---

### Task 3: Plan engine — essentials, EF targets, surplus (pure)

**Files:**
- Create: `server/lib/plan.ts`
- Test: `server/lib/plan.test.ts`

**Interfaces:**
- Produces:
  - `averageMonthly(values: number[]): number` — mean of provided monthly essentials, 0 if empty.
  - `computeSurplus(spendableExEf: number, incomeIncoming: number, billsBeforePayday: number, cushion: number): number` — `max(0, round2(spendableExEf + incomeIncoming − billsBeforePayday − cushion))`.

- [ ] **Step 1: Write the failing test**

```ts
// server/lib/plan.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { averageMonthly, computeSurplus } from "./plan.ts";

test("averageMonthly averages and guards empty", () => {
  assert.equal(averageMonthly([1000, 1100, 1200]), 1100);
  assert.equal(averageMonthly([]), 0);
});
test("computeSurplus subtracts bills + cushion, clamps at 0", () => {
  assert.equal(computeSurplus(1240, 0, 520, 100), 620);
  assert.equal(computeSurplus(300, 0, 500, 100), 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --import tsx server/lib/plan.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the two pure helpers**

```ts
// server/lib/plan.ts
const round2 = (n: number) => Math.round(n * 100) / 100;

export function averageMonthly(values: number[]): number {
  if (values.length === 0) return 0;
  return round2(values.reduce((s, v) => s + v, 0) / values.length);
}

export function computeSurplus(spendableExEf: number, incomeIncoming: number, billsBeforePayday: number, cushion: number): number {
  return Math.max(0, round2(spendableExEf + incomeIncoming - billsBeforePayday - cushion));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test --import tsx server/lib/plan.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/lib/plan.ts server/lib/plan.test.ts
git commit -m "feat: plan engine — averageMonthly + computeSurplus"
```

---

### Task 4: Plan engine — step determination

**Files:**
- Modify: `server/lib/plan.ts`
- Modify: `server/lib/plan.test.ts`
- Modify: `shared/types.ts` (add the DTOs below, near the other DTOs ~line 200)

**Interfaces:**
- Produces (in `shared/types.ts`):

```ts
export type PlanStepKey = "budget" | "ef_small" | "pension" | "debt" | "ef_full" | "invest";
export type PlanStepState = "done" | "current" | "locked" | "coming";
export interface PlanStepDTO {
  key: PlanStepKey;
  state: PlanStepState;
  title: string;
  detail: string | null;            // "1 month", "Barclaycard 24.9% APR", setup hints
  progress: { have: number; target: number; pct: number } | null;
  toGo: number | null;
  actionHint: string | null;        // where surplus should go on the current step
}
export interface PlanDTO {
  essentialMonthly: number;
  efAccount: { id: string; name: string; balance: number } | null;
  surplus: number;
  current: PlanStepKey | null;
  steps: PlanStepDTO[];
}
```

- Produces (in `server/lib/plan.ts`):

```ts
export interface PlanInputs {
  hasBudget: boolean;
  essentialMonthly: number;
  efTagged: boolean;
  efBalance: number;
  efAccountName: string | null;
  efMonthsFull: number;
  expensiveDebt: { name: string; apr: number }[];
  unratedDebt: boolean;
  surplus: number;
}
export function computePlanSteps(i: PlanInputs): { steps: PlanStepDTO[]; current: PlanStepKey | null };
```

- [ ] **Step 1: Write the failing tests**

```ts
// append to server/lib/plan.test.ts
import { computePlanSteps } from "./plan.ts";

const base = {
  hasBudget: true, essentialMonthly: 1000, efTagged: true, efBalance: 0,
  efAccountName: "Marcus", efMonthsFull: 3, expensiveDebt: [], unratedDebt: false, surplus: 320,
};

test("no budget → budget is current, rest locked", () => {
  const { current, steps } = computePlanSteps({ ...base, hasBudget: false });
  assert.equal(current, "budget");
  assert.equal(steps.find((s) => s.key === "budget")!.state, "current");
  assert.equal(steps.find((s) => s.key === "ef_small")!.state, "locked");
});

test("budget done, EF empty → ef_small current with target = 1× essentials", () => {
  const { current, steps } = computePlanSteps(base);
  assert.equal(current, "ef_small");
  const s = steps.find((x) => x.key === "ef_small")!;
  assert.equal(s.state, "current");
  assert.deepEqual(s.progress, { have: 0, target: 1000, pct: 0 });
  assert.equal(s.toGo, 1000);
  assert.match(s.actionHint!, /Marcus/);
});

test("small EF met, expensive debt present → debt current", () => {
  const { current } = computePlanSteps({ ...base, efBalance: 1000, expensiveDebt: [{ name: "Barclaycard", apr: 24.9 }] });
  assert.equal(current, "debt");
});

test("small EF met, no expensive debt → ef_full current with target = 3× essentials", () => {
  const { current, steps } = computePlanSteps({ ...base, efBalance: 1000 });
  assert.equal(current, "ef_full");
  assert.equal(steps.find((s) => s.key === "ef_full")!.progress!.target, 3000);
});

test("all met → current null, all measured steps done", () => {
  const { current } = computePlanSteps({ ...base, efBalance: 3000 });
  assert.equal(current, null);
});

test("pension and invest always 'coming' in v1", () => {
  const { steps } = computePlanSteps(base);
  assert.equal(steps.find((s) => s.key === "pension")!.state, "coming");
  assert.equal(steps.find((s) => s.key === "invest")!.state, "coming");
});

test("no essentials estimate → ef_small needs-setup, not done", () => {
  const { current, steps } = computePlanSteps({ ...base, essentialMonthly: 0, efBalance: 5000 });
  assert.equal(current, "ef_small");
  assert.match(steps.find((s) => s.key === "ef_small")!.detail!, /categoris/i);
});

test("unrated debt blocks the debt step", () => {
  const { current } = computePlanSteps({ ...base, efBalance: 1000, unratedDebt: true });
  assert.equal(current, "debt");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test --import tsx server/lib/plan.test.ts`
Expected: FAIL — `computePlanSteps` not exported.

- [ ] **Step 3: Implement `computePlanSteps`**

```ts
// add to server/lib/plan.ts
import type { PlanStepDTO, PlanStepKey } from "../../shared/types.ts";

const pct = (have: number, target: number) => (target > 0 ? Math.min(100, Math.round((have / target) * 100)) : 0);

export interface PlanInputs {
  hasBudget: boolean;
  essentialMonthly: number;
  efTagged: boolean;
  efBalance: number;
  efAccountName: string | null;
  efMonthsFull: number;
  expensiveDebt: { name: string; apr: number }[];
  unratedDebt: boolean;
  surplus: number;
}

export function computePlanSteps(i: PlanInputs): { steps: PlanStepDTO[]; current: PlanStepKey | null } {
  const canSizeEf = i.essentialMonthly > 0;
  const efDest = i.efTagged && i.efAccountName ? i.efAccountName : "your emergency fund";
  const efHint = (toGo: number) => `Move ${gbp(Math.min(i.surplus, toGo) || i.surplus)} to ${efDest}`;

  // Measured steps in UKPF order (pension omitted from measurement — see below).
  const smallTarget = i.essentialMonthly;        // 1× essentials
  const fullTarget = i.essentialMonthly * i.efMonthsFull;

  const measured: { key: PlanStepKey; done: boolean; build: (state: PlanStepDTO["state"]) => PlanStepDTO }[] = [
    {
      key: "budget", done: i.hasBudget,
      build: (state) => ({ key: "budget", state, title: "Budgeting", detail: i.hasBudget ? "Budgets set" : "Set your category budgets",
        progress: null, toGo: null, actionHint: state === "current" ? "Set a monthly amount on your categories" : null }),
    },
    {
      key: "ef_small", done: canSizeEf && i.efBalance >= smallTarget - 0.005,
      build: (state) => {
        const toGo = Math.max(0, round2(smallTarget - i.efBalance));
        return {
          key: "ef_small", state, title: "Emergency fund (1 month)",
          detail: !canSizeEf ? "Categorise your spending to size this" : !i.efTagged ? "Tag your emergency-fund account" : "1 month of essentials",
          progress: canSizeEf ? { have: round2(i.efBalance), target: round2(smallTarget), pct: pct(i.efBalance, smallTarget) } : null,
          toGo: canSizeEf ? toGo : null,
          actionHint: state === "current" && canSizeEf ? efHint(toGo) : null,
        };
      },
    },
    {
      key: "debt", done: i.expensiveDebt.length === 0 && !i.unratedDebt,
      build: (state) => ({
        key: "debt", state, title: "Clear expensive debt",
        detail: i.unratedDebt ? "Set the APR on your debts to check" : i.expensiveDebt.length ? i.expensiveDebt.map((d) => `${d.name} ${d.apr}% APR`).join(", ") : "No debt over 10% APR",
        progress: null, toGo: null,
        actionHint: state === "current" ? (i.unratedDebt ? "Add the interest rate to your debts" : i.expensiveDebt.length ? `Overpay ${i.expensiveDebt[0].name} (${i.expensiveDebt[0].apr}% APR)` : null) : null,
      }),
    },
    {
      key: "ef_full", done: canSizeEf && i.efBalance >= fullTarget - 0.005,
      build: (state) => {
        const toGo = Math.max(0, round2(fullTarget - i.efBalance));
        return {
          key: "ef_full", state, title: `Emergency fund (${i.efMonthsFull} months)`,
          detail: !canSizeEf ? "Categorise your spending to size this" : !i.efTagged ? "Tag your emergency-fund account" : `${i.efMonthsFull} months of essentials`,
          progress: canSizeEf ? { have: round2(i.efBalance), target: round2(fullTarget), pct: pct(i.efBalance, fullTarget) } : null,
          toGo: canSizeEf ? toGo : null,
          actionHint: state === "current" && canSizeEf ? efHint(toGo) : null,
        };
      },
    },
  ];

  const firstIncomplete = measured.findIndex((m) => !m.done);
  const current: PlanStepKey | null = firstIncomplete === -1 ? null : measured[firstIncomplete].key;

  const measuredSteps = measured.map((m, idx) => {
    const state: PlanStepDTO["state"] = m.done ? "done" : idx === firstIncomplete ? "current" : "locked";
    return m.build(state);
  });

  // pension sits between ef_small and debt; invest after ef_full. Both are non-blocking "coming" teasers in v1.
  const pension: PlanStepDTO = { key: "pension", state: "coming", title: "Get your pension match", detail: "Free money from your employer — coming soon", progress: null, toGo: null, actionHint: null };
  const invest: PlanStepDTO = { key: "invest", state: "coming", title: "Invest for the long term", detail: "LISA / S&S ISA — coming soon", progress: null, toGo: null, actionHint: null };

  const order: PlanStepKey[] = ["budget", "ef_small", "pension", "debt", "ef_full", "invest"];
  const byKey = new Map<PlanStepKey, PlanStepDTO>([...measuredSteps, pension, invest].map((s) => [s.key, s]));
  const steps = order.map((k) => byKey.get(k)!);
  return { steps, current };
}
```

Add the small `gbp` helper at the top of `plan.ts` (server-side £ formatter, no dependency on the web `format.ts`):

```ts
const gbp = (n: number) => `£${(Math.round(n * 100) / 100).toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test --import tsx server/lib/plan.test.ts && pnpm tsc --noEmit -p tsconfig.json`
Expected: PASS + clean.

- [ ] **Step 5: Commit**

```bash
git add server/lib/plan.ts server/lib/plan.test.ts shared/types.ts
git commit -m "feat: plan engine — step determination (budget/EF/debt order)"
```

---

### Task 5: `GET /api/plan` route

Assembles the engine inputs from the DB by reusing existing helpers, then returns `PlanDTO`.

**Files:**
- Create: `server/routes/plan.ts`
- Modify: `server/index.ts:33-42` (mount the router)

**Interfaces:**
- Consumes: `computePlanSteps`, `averageMonthly`, `computeSurplus` (Task 3/4); `personalSpendByCategory`, `currentMonth`, `prevMonth`, `type BudgetTx` (`server/lib/budget.ts`); `NEEDS_KEYS` (`shared/categoryClass.ts`); `currentBalance` (`server/lib/balance.ts`); `manualTxnSums` (`server/lib/manualBalance.ts`); `effectiveCategory` (`server/lib/effectiveCategory.ts`); `displayName` (`shared/displayName.ts`); `computeFunding`, `tallyIncomeByAccount`, `type FundingSchedule` (`server/lib/funding.ts`); `getStringSettings` (`server/lib/settings.ts`).
- Produces: `GET /api/plan` → `PlanDTO`.

Exact shapes confirmed from the codebase:
- `interface BudgetTx { amount: number; category: string /* effective */; bookingDate: string | null }`
- `personalSpendByCategory(txns: BudgetTx[], month: string): Record<string, number>` (already excludes transfers/income/positive amounts)
- `effectiveCategory(tx: { category: string; categoryOverride?: string | null }): string`
- `currentBalance(source, manualBalance, balances, preferredType?, txnSum=0)` — pass `manualTxnSums().get(id) ?? 0` as `txnSum` for MANUAL accounts (cash baseline + activity)
- `FundingSchedule { accountId: string | null; direction: "in"|"out"; amount: number; cadence: string; dayOfMonth: number | null; nextDue: Date | null }` — `nextDue: s.nextDue` is already a `Date | null` from Prisma; do **not** re-wrap.

- [ ] **Step 1: Write the route**

```ts
// server/routes/plan.ts
import { Router } from "express";
import { db } from "../lib/db.ts";
import { currentMonth, prevMonth, personalSpendByCategory, type BudgetTx } from "../lib/budget.ts";
import { NEEDS_KEYS } from "../../shared/categoryClass.ts";
import { currentBalance } from "../lib/balance.ts";
import { manualTxnSums } from "../lib/manualBalance.ts";
import { effectiveCategory } from "../lib/effectiveCategory.ts";
import { displayName } from "../../shared/displayName.ts";
import { computeFunding, tallyIncomeByAccount, type FundingSchedule } from "../lib/funding.ts";
import { getStringSettings } from "../lib/settings.ts";
import { averageMonthly, computeSurplus, computePlanSteps } from "../lib/plan.ts";
import type { PlanDTO } from "../../shared/types.ts";

export const planRouter = Router();

planRouter.get("/plan", async (_req, res, next) => {
  try {
    const settings = await getStringSettings();
    const efMonthsFull = Math.max(1, Math.min(12, Number(settings["savings.efMonthsFull"]) || 3));
    const cushion = Math.max(0, Number(settings["savings.cushion"]) || 0);
    const efAccountId = settings["savings.emergencyAccountId"] || "";

    // ── budget set? ─────────────────────────────────────────────────────────
    const cats = await db.category.findMany({ where: { archived: false } });
    const hasBudget = cats.some((c) => Number(c.monthlyAmount.toString()) > 0);

    // ── essential monthly spend: avg of needs-class spend over the last 3 complete months ──
    const budgetAccts = await db.account.findMany({ where: { informational: false } });
    const ids = budgetAccts.map((a) => a.id);
    const txns = await db.transaction.findMany({
      where: { accountId: { in: ids } },
      select: { amount: true, category: true, categoryOverride: true, bookingDate: true },
    });
    const budgetTxns: BudgetTx[] = txns.map((t) => ({
      amount: Number(t.amount.toString()),
      category: effectiveCategory(t),         // effective category, per BudgetTx contract
      bookingDate: t.bookingDate,
    }));
    const needs = new Set(NEEDS_KEYS);
    const months: string[] = [];
    let mm = prevMonth(currentMonth());
    for (let k = 0; k < 3; k++) { months.push(mm); mm = prevMonth(mm); }
    const monthlyEssentials = months.map((month) => {
      const byCat = personalSpendByCategory(budgetTxns, month);
      return Object.entries(byCat).filter(([key]) => needs.has(key)).reduce((s, [, v]) => s + v, 0);
    }).filter((v) => v > 0);
    const essentialMonthly = averageMonthly(monthlyEssentials);

    // ── emergency-fund account balance ──────────────────────────────────────
    const sums = await manualTxnSums();
    const efAcct = efAccountId ? await db.account.findUnique({ where: { id: efAccountId }, include: { balances: true } }) : null;
    const efBalance = efAcct
      ? currentBalance(efAcct.source, efAcct.manualBalance != null ? Number(efAcct.manualBalance.toString()) : null,
          efAcct.balances.map((b) => ({ type: b.type, amount: Number(b.amount.toString()) })), efAcct.balanceType, sums.get(efAcct.id) ?? 0)
      : 0;

    // ── expensive / unrated debt (non-mortgage) ─────────────────────────────
    const debts = await db.account.findMany({ where: { source: "LIABILITY", debtExcluded: false } });
    const expensiveDebt: { name: string; apr: number }[] = [];
    let unratedDebt = false;
    for (const d of debts) {
      const owed = Number(d.manualBalance?.toString() ?? "0");
      if (owed <= 0) continue;
      const apr = d.interestRate != null ? Number(d.interestRate.toString()) : null;
      if (apr == null) { unratedDebt = true; continue; }
      if (apr > 10) expensiveDebt.push({ name: displayName(d), apr: Math.round(apr * 10) / 10 });
    }

    // ── surplus (safe-to-payday − cushion); EF account excluded from spendable ──
    const spendRows = await db.account.findMany({
      where: { source: { in: ["BANK", "MANUAL"] }, informational: false },
      include: { balances: true },
    });
    const spendBalances = spendRows
      .filter((a) => a.id !== efAccountId)
      .map((a) => ({
        id: a.id,
        currentBalance: currentBalance(a.source, a.manualBalance != null ? Number(a.manualBalance.toString()) : null,
          a.balances.map((b) => ({ type: b.type, amount: Number(b.amount.toString()) })), a.balanceType, sums.get(a.id) ?? 0),
      }));
    const scheds = await db.recurringSchedule.findMany({ where: { status: { not: "ignored" } } });
    const fundingSchedules: FundingSchedule[] = scheds.map((s) => ({
      accountId: s.accountId, direction: s.direction === "in" ? ("in" as const) : ("out" as const),
      amount: Number(s.amount.toString()), cadence: s.cadence, dayOfMonth: s.dayOfMonth, nextDue: s.nextDue,
    }));
    const ym = new Date().toISOString().slice(0, 7); // matches accounts.ts /upcoming income tally (prod runs UTC)
    const credits = (await db.transaction.findMany({
      where: { amount: { gt: 0 }, bookingDate: { startsWith: ym } },
      select: { amount: true, category: true, categoryOverride: true, accountId: true },
    }))
      .filter((t) => effectiveCategory(t) === "income")
      .map((t) => ({ amount: Number(t.amount.toString()), accountId: t.accountId }));
    const income = tallyIncomeByAccount(credits);
    const funding = computeFunding(spendBalances, fundingSchedules, income, new Date());
    const spendableNow = funding.reduce((s, f) => s + f.balance, 0);
    const incomeIncoming = funding.reduce((s, f) => s + f.incomeIncoming, 0);
    const billsBeforePayday = funding.reduce((s, f) => s + f.committed, 0);
    const surplus = computeSurplus(spendableNow, incomeIncoming, billsBeforePayday, cushion);

    const efName = efAcct ? displayName(efAcct) : null;
    const { steps, current } = computePlanSteps({
      hasBudget, essentialMonthly, efTagged: !!efAcct, efBalance, efAccountName: efName,
      efMonthsFull, expensiveDebt, unratedDebt, surplus,
    });

    const dto: PlanDTO = {
      essentialMonthly, surplus, current, steps,
      efAccount: efAcct ? { id: efAcct.id, name: efName!, balance: Math.round(efBalance * 100) / 100 } : null,
    };
    res.json(dto);
  } catch (e) { next(e); }
});
```

> **Implementer note:** `displayName` takes the raw Prisma account row (it reads `nickname`/`name`/`ownerName`) — pass `d`/`efAcct` directly, as `accounts.ts` does. If `tsc` complains that the `select`ed transaction shape doesn't satisfy `effectiveCategory`'s parameter, widen the `select` to include the two fields it reads (`category`, `categoryOverride`) — already included above.

- [ ] **Step 2: Mount the router**

In `server/index.ts`, after the other `app.use("/api", …)` lines:

```ts
import { planRouter } from "./routes/plan.ts";
// …
app.use("/api", planRouter);
```

- [ ] **Step 3: Typecheck, then smoke-test against the running dev server**

Run: `pnpm tsc --noEmit -p tsconfig.json`
Then: `curl -s http://localhost:3000/api/plan | head -c 800`
Expected: JSON with `steps`, `current`, `surplus`, `essentialMonthly`, `efAccount` (efAccount null until tagged). Sanity-check `essentialMonthly` ≈ your real needs spend and `surplus` ≥ 0.

- [ ] **Step 4: Commit**

```bash
git add server/routes/plan.ts server/index.ts
git commit -m "feat: GET /api/plan — assemble flowchart position + surplus"
```

---

### Task 6: Client API + types wiring

**Files:**
- Modify: `web/src/api.ts` (add `plan()` and `setSavingsSetting` helper near the existing `patchSettings`)

**Interfaces:**
- Consumes: `PlanDTO` (`shared/types.ts`).
- Produces: `api.plan(): Promise<PlanDTO>`; reuses `api.patchSettings` for `savings.*` keys.

- [ ] **Step 1: Add the API method**

In `web/src/api.ts`, add `PlanDTO` to the type import from `shared/types.ts`, then:

```ts
plan: () => get<PlanDTO>("/api/plan"),
```

(`patchSettings` already sends string keys, so tagging the EF account is `api.patchSettings({ "savings.emergencyAccountId": accountId })`.)

- [ ] **Step 2: Typecheck + build**

Run: `pnpm tsc --noEmit -p tsconfig.json && pnpm exec vite build`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add web/src/api.ts
git commit -m "feat: web api.plan()"
```

---

### Task 7: `PlanFlowchart` component

**Files:**
- Create: `web/src/components/PlanFlowchart.tsx`
- Modify: `web/src/styles.css` (append the `.plan-*` block at the end)

**Interfaces:**
- Consumes: `api.plan()`, `PlanDTO`, `formatGBP`.
- Produces: `<PlanFlowchart efAccountPicker={<…>} />` — renders the ordered steps; the current step is expanded with its progress bar + surplus action hint; done steps collapse to a ✓; locked/coming steps are muted.

- [ ] **Step 1: Write the component**

```tsx
// web/src/components/PlanFlowchart.tsx
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Lock } from "lucide-react";
import { api } from "../api.ts";
import { formatGBP } from "../format.ts";

export function PlanFlowchart({ efAccountPicker }: { efAccountPicker?: ReactNode }) {
  const { data, isLoading } = useQuery({ queryKey: ["plan"], queryFn: () => api.plan() });
  if (isLoading || !data) return <div className="card"><p className="empty">Loading your plan…</p></div>;

  return (
    <div className="card plan-card">
      <div className="card-head"><h3>Your plan</h3><span className="muted plan-src">UK Personal Finance flowchart</span></div>
      <ol className="plan-steps">
        {data.steps.map((s, i) => (
          <li key={s.key} className={`plan-step is-${s.state}`}>
            <span className="plan-bullet">
              {s.state === "done" ? <Check size={14} strokeWidth={2.6} />
                : s.state === "current" ? <span className="plan-dot" />
                : s.state === "coming" ? <span className="plan-idx">{i + 1}</span>
                : <Lock size={12} strokeWidth={2.2} />}
            </span>
            <div className="plan-body">
              <div className="plan-row">
                <span className="plan-title">{s.title}</span>
                {s.state === "done" && <span className="plan-tag pos">Done</span>}
                {s.toGo != null && s.state === "current" && <span className="num plan-togo">{formatGBP(s.toGo)} to go</span>}
              </div>
              {s.detail && <div className="plan-detail muted">{s.detail}</div>}
              {s.state === "current" && s.progress && (
                <>
                  <div className="progress plan-bar"><i className="ok" style={{ width: `${s.progress.pct}%` }} /></div>
                  <div className="plan-meta">
                    <span className="muted">{formatGBP(s.progress.have)} / {formatGBP(s.progress.target)}</span>
                    {data.surplus > 0 && s.actionHint && <span className="plan-hint pos">{s.actionHint}</span>}
                  </div>
                </>
              )}
              {s.state === "current" && s.key.startsWith("ef_") && !data.efAccount && efAccountPicker && (
                <div className="plan-picker">{efAccountPicker}</div>
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
```

- [ ] **Step 2: Add styles**

Append to `web/src/styles.css`:

```css
/* ── Plan flowchart ───────────────────────────────────────────────────────── */
.plan-card .plan-src { font-size: 12px; }
.plan-steps { list-style: none; margin: 6px 0 0; padding: 0; }
.plan-step { display: grid; grid-template-columns: 26px 1fr; gap: 12px; padding: 12px 0; border-bottom: 1px solid var(--line); }
.plan-step:last-child { border-bottom: none; }
.plan-step.is-locked, .plan-step.is-coming { opacity: 0.55; }
.plan-bullet { display: grid; place-items: center; width: 26px; height: 26px; border-radius: 50%; border: 1px solid var(--line-strong); color: var(--ink-3); }
.plan-step.is-done .plan-bullet { color: var(--jade); border-color: color-mix(in srgb, var(--jade) 45%, var(--line)); }
.plan-step.is-current .plan-bullet { border-color: var(--jade); }
.plan-dot { width: 9px; height: 9px; border-radius: 50%; background: var(--jade); }
.plan-idx { font-size: 12px; font-weight: 600; }
.plan-body { min-width: 0; }
.plan-row { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
.plan-title { font-weight: 600; }
.plan-togo { font-size: 13px; color: var(--ink-2); }
.plan-detail { font-size: 12.5px; margin-top: 2px; }
.plan-bar { margin-top: 9px; }
.plan-meta { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; margin-top: 7px; font-size: 12px; }
.plan-hint { font-weight: 600; }
.plan-tag { font-size: 11px; font-weight: 640; }
.plan-picker { margin-top: 10px; }
```

- [ ] **Step 3: Typecheck + build**

Run: `pnpm tsc --noEmit -p tsconfig.json && pnpm exec vite build`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/PlanFlowchart.tsx web/src/styles.css
git commit -m "feat: PlanFlowchart component"
```

---

### Task 8: Rebuild Savings page — flowchart above pots + EF-account tagging

**Files:**
- Modify: `web/src/pages/Savings.tsx`

**Interfaces:**
- Consumes: `PlanFlowchart`, `api.accounts()`, `api.patchSettings`, existing pots UI (unchanged).
- Produces: Savings page rendering `<PlanFlowchart efAccountPicker={…} />` above the existing pots grid; the picker tags `savings.emergencyAccountId` and invalidates `["plan"]`.

- [ ] **Step 1: Add the flowchart + EF picker, keep pots**

At the top of the Savings component body, add the account list + tag mutation:

```tsx
import { PlanFlowchart } from "../components/PlanFlowchart.tsx";
// inside the component:
const accountsQ = useQuery({ queryKey: ["accounts"], queryFn: () => api.accounts(), staleTime: 5 * 60_000 });
const savingsAccounts = (accountsQ.data ?? []).flatMap((b) => b.accounts).filter((a) => a.source === "BANK" || a.source === "MANUAL");
const tagEf = useMutation({
  mutationFn: (id: string) => api.patchSettings({ "savings.emergencyAccountId": id }),
  onSuccess: () => qc.invalidateQueries({ queryKey: ["plan"] }),
});
const efPicker = (
  <label className="plan-ef-picker">
    <span className="eyebrow">Which account is your emergency fund?</span>
    <select defaultValue="" onChange={(e) => e.target.value && tagEf.mutate(e.target.value)}>
      <option value="" disabled>Choose an account…</option>
      {savingsAccounts.map((a) => <option key={a.id} value={a.id}>{a.displayName}</option>)}
    </select>
  </label>
);
```

Then render the flowchart directly under `<PageHeader …>` and above the `<div className="grid">` stat row:

```tsx
<PlanFlowchart efAccountPicker={efPicker} />
```

Keep the entire existing pots section (stats, `pot-cards`, modals) exactly as-is below it. Update the `PageHeader` subtitle to: `"Your saving plan, then the pots you're filling toward it."`.

- [ ] **Step 2: Verify in the browser**

Run: `pnpm tsc --noEmit -p tsconfig.json && pnpm exec vite build`
Then open `http://localhost:5173/savings`: the flowchart shows with the current step expanded; if no EF account is tagged, the picker appears under the EF step; selecting one tags it and the step's progress/balance updates.

- [ ] **Step 3: Commit**

```bash
git add web/src/pages/Savings.tsx
git commit -m "feat: Savings page rebuilt as UKPF plan + pots as vehicles"
```

---

### Task 9: Dashboard surplus nudge

Surface the "£X spare → current step" nudge on the dashboard, reusing `/api/plan`.

**Files:**
- Create: `web/src/components/SurplusNudge.tsx`
- Modify: `web/src/pages/DashboardHome.tsx` (render the nudge near the top, after the hero)
- Modify: `web/src/styles.css` (append `.surplus-nudge` block)

**Interfaces:**
- Consumes: `api.plan()`, `formatGBP`, `Link` to `/savings`.
- Produces: `<SurplusNudge />` — renders only when `surplus > 0` and there's a `current` step; shows the amount + the current step's `actionHint`, linking to Savings.

- [ ] **Step 1: Write the component**

```tsx
// web/src/components/SurplusNudge.tsx
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { PiggyBank } from "lucide-react";
import { api } from "../api.ts";
import { formatGBP } from "../format.ts";

export function SurplusNudge() {
  const { data } = useQuery({ queryKey: ["plan"], queryFn: () => api.plan() });
  if (!data || data.surplus <= 0 || !data.current) return null;
  const step = data.steps.find((s) => s.key === data.current);
  const hint = step?.actionHint;
  if (!hint) return null;
  return (
    <Link to="/savings" className="card surplus-nudge">
      <span className="surplus-ico"><PiggyBank size={20} strokeWidth={2} /></span>
      <span className="surplus-body">
        <span className="surplus-amt num">{formatGBP(data.surplus)} spare</span>
        <span className="surplus-hint muted">{hint}</span>
      </span>
      <span className="surplus-go">Review →</span>
    </Link>
  );
}
```

- [ ] **Step 2: Render it on the dashboard**

In `web/src/pages/DashboardHome.tsx`, import and place `<SurplusNudge />` immediately after the hero card block (before the stat row). Match the existing card ordering pattern; it self-hides when there's no surplus.

- [ ] **Step 3: Add styles**

Append to `web/src/styles.css`:

```css
/* ── Surplus nudge ────────────────────────────────────────────────────────── */
.surplus-nudge { display: flex; align-items: center; gap: 14px; text-decoration: none; color: var(--ink); border: 1px solid color-mix(in srgb, var(--jade) 40%, var(--line)); background: color-mix(in srgb, var(--jade) 7%, var(--surface-2)); }
.surplus-nudge:hover { border-color: var(--jade); }
.surplus-ico { display: grid; place-items: center; width: 40px; height: 40px; border-radius: 50%; flex: none; color: var(--jade); background: color-mix(in srgb, var(--jade) 14%, transparent); }
.surplus-body { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
.surplus-amt { font-size: 16px; font-weight: 660; }
.surplus-hint { font-size: 12.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.surplus-go { flex: none; font-size: 13px; font-weight: 600; color: var(--jade); }
```

- [ ] **Step 4: Verify + commit**

Run: `pnpm tsc --noEmit -p tsconfig.json && pnpm exec vite build`
Open `http://localhost:5173/` — the nudge appears under the hero when there's a surplus and a current step, linking to Savings.

```bash
git add web/src/components/SurplusNudge.tsx web/src/pages/DashboardHome.tsx web/src/styles.css
git commit -m "feat: dashboard surplus nudge feeding the current plan step"
```

---

### Task 10: Full verification pass

- [ ] **Step 1: Run everything**

Run:
```bash
eval "$(/opt/homebrew/bin/brew shellenv)"; eval "$(fnm env)"
node --test --import tsx server/lib/*.test.ts server/categorise/*.test.ts
pnpm tsc --noEmit -p tsconfig.json
pnpm exec vite build
```
Expected: all server tests pass, tsc clean, build OK.

- [ ] **Step 2: Manual end-to-end check**

1. `/savings`: flowchart renders; tag a real savings account as EF; the EF step shows balance vs target.
2. `/api/plan`: `essentialMonthly` matches your real needs spend; `surplus` ≥ 0 and excludes the EF account; `current` is the first unmet step.
3. `/` dashboard: surplus nudge shows the current step's action.
4. Confirmation loop (manual): note the EF step's `have`; after a real transfer + next sync, reload — `have` rises and the step advances/marks done.

- [ ] **Step 3: Final commit (if any tidy-ups)**

```bash
git add -A && git commit -m "chore: savings plan — verification tidy-ups"
```

---

## Notes carried from the spec (review items)

- **Operational cushion** default = £100 (`savings.cushion`), distinct from the EF (the EF lives in its tagged account and is excluded from spendable). Adjustable.
- **Full-EF months** default = 3 (`savings.efMonthsFull`, range 1–12).
- **Real-confirmation loop** in v1 is implicit: the plan recomputes from real balances each load, so a real transfer into the tagged EF account advances the step on next sync. A "you just saved £X 🎉" celebration (diffing a stored last-seen EF balance) and a Telegram payday nudge are explicit follow-ups, not in this plan.
- **Steps 3 (pension) and 6–8 (LISA/investing)** are non-blocking "coming" teasers; measuring them is future work.
