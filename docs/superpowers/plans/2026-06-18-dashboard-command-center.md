# Dashboard Command Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the thin, conditional `SurplusNudge` band at the top of the dashboard with two always-present cards — a **PlanProgressCard** (where you are on budget→save→invest) and a **NeedsYou** persistent-insight inbox (review-needed, new transactions, subscriptions to confirm, overspend/low-balance, spare money to allocate).

**Architecture:** A new `Insight` table (hand-applied SQL) backs a per-kind-singleton inbox. A **pure reconcile engine** (`server/lib/insights.ts`) decides create/refresh/auto-resolve from live conditions; a DB layer (`server/lib/insightConditions.ts`) gathers conditions and applies the actions; routes (`server/routes/insights.ts`) expose `GET /api/insights` (reconcile + list) and `PATCH /api/insights/:id` (dismiss/snooze/read). The plan computation is extracted into `server/lib/planData.ts` so both `/api/plan` and the insight conditions share one source. Front-end adds `PlanProgressCard` + `NeedsYou` and deletes `SurplusNudge`.

**Tech Stack:** Express 5 + TypeScript (tsx, Zod), Prisma v6 / Postgres, React 19 / Vite 8, @tanstack/react-query, react-router-dom, lucide-react. Tests: `node --test --import tsx`.

## Global Constraints

- **Commit directly to `main`** — no feature branches. (Each task commits as it completes per the subagent-driven flow.)
- **Schema changes are hand-applied idempotent SQL** in `scripts/migrations/YYYY-MM-DD-name.sql` (`CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`), applied with `DATABASE_URL=… bash scripts/migrations/apply.sh <file>`, then mirror `prisma/schema.prisma` and run `pnpm prisma generate`. **Never `prisma migrate`.** There is no `prisma/migrations/` dir.
- **Node env for any command:** `eval "$(/opt/homebrew/bin/brew shellenv)"; eval "$(fnm env)"`, then **`pnpm`** (never npm). DB scripts: `export $(grep -E '^DATABASE_URL=' .env | xargs)` then `pnpm tsx <script>`.
- **Dialogs are always in-app** (no `window.prompt/confirm/alert`). The `⋮` action menu is a small in-component popover.
- **Transaction `note` is plain text — never emojis.** (Insight titles likewise: plain text; the only glyphs allowed are in JSX UI, e.g. a check mark in the empty state.)
- **`tsconfig` has `noUnusedLocals`** — remove the `SurplusNudge` import on deletion; no unused vars.
- **Money/date helpers:** server-side currency rendered as `£${Math.round(n)}` inside the engine (whole pounds); never `toISOString().slice(0,10)` for local dates (prod runs UTC so timestamps via `new Date().toISOString()` are fine for `createdAt`/markers).
- **Per-kind singleton:** at most one *open* (`resolvedAt IS NULL AND dismissedAt IS NULL`) insight per kind. **Visible** = open AND (`snoozedUntil IS NULL OR snoozedUntil <= now`).
- After each task: `pnpm tsc --noEmit -p tsconfig.json` and `pnpm exec vite build`. Server tests: `node --test --import tsx server/lib/*.test.ts server/categorise/*.test.ts`.
- Commit trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

**The five insight kinds and their deep-links / severities (verbatim — every task uses these):**

| kind | open while | link | severity |
|---|---|---|---|
| `overspent` | a budget category > 100% **or** `spendableNow + incomeIncoming < billsBeforePayday` | `/budgets` | `warn` |
| `needs_category` | uncategorised (non-refund, non-pending) txns > 0 | `/transactions?cat=uncategorised` | `review` |
| `new_subscription` | recurring schedules with `status === "auto"` > 0 | `/recurring` | `review` |
| `surplus` | `plan.surplus > 0` and the current step has an `actionHint` | `/savings` | `opportunity` |
| `new_transactions` | settled txns imported since `insights.txnsSeenAt` > 0; **resolves on read**, not condition | `/transactions` | `digest` |

**Sort order (top→bottom):** `overspent`, `needs_category`, `new_subscription`, `surplus`, `new_transactions`.

---

### Task 1: Insight schema + `insights.txnsSeenAt` setting

**Files:**
- Create: `scripts/migrations/2026-06-18-insights.sql`
- Modify: `prisma/schema.prisma` (add `Insight` model)
- Modify: `server/lib/settings.ts` (add the `insights.txnsSeenAt` string setting)
- Test: `server/lib/settings.insights.test.ts`

**Interfaces:**
- Produces: `Insight` Prisma model with fields `id, kind, payload (Json), createdAt, updatedAt, readAt, resolvedAt, dismissedAt, snoozedUntil`; a `getStringSettings()` key `"insights.txnsSeenAt"` (default `""`).

- [ ] **Step 1: Write the migration SQL**

Create `scripts/migrations/2026-06-18-insights.sql`:

```sql
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
```

- [ ] **Step 2: Apply the migration**

Run:
```bash
eval "$(/opt/homebrew/bin/brew shellenv)"; eval "$(fnm env)"
export $(grep -E '^DATABASE_URL=' .env | xargs)
bash scripts/migrations/apply.sh scripts/migrations/2026-06-18-insights.sql
```
Expected: applies without error (idempotent — safe to re-run).

- [ ] **Step 3: Mirror the model in `prisma/schema.prisma`**

Add after the `Setting` model:

```prisma
// Persistent dashboard "Needs you" inbox. One OPEN row per kind (singleton);
// the reconcile engine refreshes payload counts and auto-resolves closed ones.
model Insight {
  id           String    @id @default(cuid())
  kind         String    // overspent | needs_category | new_subscription | surplus | new_transactions
  payload      Json      @default("{}")
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @default(now())
  readAt       DateTime?
  resolvedAt   DateTime?
  dismissedAt  DateTime?
  snoozedUntil DateTime?

  @@index([kind])
  @@index([resolvedAt, dismissedAt])
}
```

Then run:
```bash
eval "$(/opt/homebrew/bin/brew shellenv)"; eval "$(fnm env)"; pnpm prisma generate
```
Expected: "Generated Prisma Client".

- [ ] **Step 4: Add the `insights.txnsSeenAt` string setting**

In `server/lib/settings.ts`, add to `STRING_SETTING_DEFS` (after the `plan.overrides` entry):

```ts
  // ISO timestamp of the last time the user "caught up" on new transactions.
  // Empty → treated as epoch so the first run reports recent imports.
  { key: "insights.txnsSeenAt", default: "", validate: (v) => v === "" || !Number.isNaN(Date.parse(v)) },
```

- [ ] **Step 5: Write the failing test**

Create `server/lib/settings.insights.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { STRING_SETTING_DEFS } from "./settings.ts";

test("insights.txnsSeenAt is a known string setting, defaults empty", () => {
  const def = STRING_SETTING_DEFS.find((d) => d.key === "insights.txnsSeenAt");
  assert.ok(def, "setting def exists");
  assert.equal(def!.default, "");
});

test("insights.txnsSeenAt accepts empty + ISO, rejects junk", () => {
  const def = STRING_SETTING_DEFS.find((d) => d.key === "insights.txnsSeenAt")!;
  assert.equal(def.validate!(""), true);
  assert.equal(def.validate!("2026-06-18T10:00:00.000Z"), true);
  assert.equal(def.validate!("not-a-date"), false);
});
```

- [ ] **Step 6: Run the test**

Run: `eval "$(/opt/homebrew/bin/brew shellenv)"; eval "$(fnm env)"; node --test --import tsx server/lib/settings.insights.test.ts`
Expected: 2 tests pass (they pass once Step 4 is in place).

- [ ] **Step 7: Typecheck + commit**

Run: `pnpm tsc --noEmit -p tsconfig.json`
Expected: no errors.

```bash
git add scripts/migrations/2026-06-18-insights.sql prisma/schema.prisma server/lib/settings.ts server/lib/settings.insights.test.ts
git commit -m "feat(insights): Insight table + insights.txnsSeenAt setting"
```

---

### Task 2: Extract `buildPlanContext()` into `server/lib/planData.ts`

This is a refactor: move the body of the `GET /api/plan` handler into a reusable function so the insight conditions can share the surplus + funding figures without duplicating the funding math. Behaviour of `/api/plan` must be byte-for-byte identical.

**Files:**
- Create: `server/lib/planData.ts`
- Modify: `server/routes/plan.ts` (GET handler delegates to `buildPlanContext`)

**Interfaces:**
- Produces:
  ```ts
  export interface PlanContext {
    dto: PlanDTO;
    spendableNow: number;       // funding.reduce sum of balances (EF excluded)
    incomeIncoming: number;
    billsBeforePayday: number;
  }
  export async function buildPlanContext(): Promise<PlanContext>;
  ```
- Consumes (unchanged): `currentMonth, personalSpendByCategory, BudgetTx` (budget.ts); `NEEDS_KEYS` (categoryClass); `currentBalance` (balance.ts); `manualTxnSums` (manualBalance.ts); `effectiveCategory`; `displayName`; `computeFunding, tallyIncomeByAccount, FundingSchedule` (funding.ts); `getStringSettings` (settings.ts); `averageMonthly, computeSurplus, computePlanSteps` (plan.ts); `db`.

- [ ] **Step 1: Create `server/lib/planData.ts`**

Move the entire computation currently inside the `planRouter.get("/plan", …)` handler (everything between `const settings = await getStringSettings();` and building `const dto: PlanDTO = …`) into this file. Keep the local `prevMonth` and `parseOverrides` helpers here (the route keeps its own copy of `parseOverrides` only if still needed — see Step 3; otherwise move it). The function returns the `PlanContext`:

```ts
// server/lib/planData.ts
import { db } from "./db.ts";
import { currentMonth, personalSpendByCategory, type BudgetTx } from "./budget.ts";
import { NEEDS_KEYS } from "../../shared/categoryClass.ts";
import { currentBalance } from "./balance.ts";
import { manualTxnSums } from "./manualBalance.ts";
import { effectiveCategory } from "./effectiveCategory.ts";
import { displayName } from "../../shared/displayName.ts";
import { computeFunding, tallyIncomeByAccount, type FundingSchedule } from "./funding.ts";
import { getStringSettings } from "./settings.ts";
import { averageMonthly, computeSurplus, computePlanSteps } from "./plan.ts";
import type { PlanDTO, PlanOverride } from "../../shared/types.ts";

export interface PlanContext {
  dto: PlanDTO;
  spendableNow: number;
  incomeIncoming: number;
  billsBeforePayday: number;
}

function prevMonth(m: string): string {
  const [y, mo] = m.split("-").map(Number);
  return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, "0")}`;
}

function parseOverrides(raw: string | undefined): Record<string, PlanOverride> {
  try {
    const o = JSON.parse(raw || "{}");
    if (!o || typeof o !== "object") return {};
    const out: Record<string, PlanOverride> = {};
    for (const [k, v] of Object.entries(o)) if (v === "handled" || v === "na") out[k] = v;
    return out;
  } catch { return {}; }
}

export async function buildPlanContext(): Promise<PlanContext> {
  // ... move the existing /plan computation here verbatim, ending with:
  //   const { steps, current } = computePlanSteps({ ... });
  //   const dto: PlanDTO = { essentialMonthly, surplus, current, steps, efAccount: ... };
  //   return { dto, spendableNow, incomeIncoming, billsBeforePayday };
}
```

> Implementer: copy the existing handler body exactly — `efMonthsFull`, `cushion`, `efAccountId`, `overrides`, the budget check, `essentialMonthly`, EF balance, the `spendBalances`/`scheds`/`funding` block (which already defines `spendableNow`, `incomeIncoming`, `billsBeforePayday`, `surplus`), and the `dto`. Do not change any formula or rounding.

- [ ] **Step 2: Repoint the route**

In `server/routes/plan.ts`, replace the GET handler body with:

```ts
import { buildPlanContext } from "../lib/planData.ts";
// ...
planRouter.get("/plan", async (_req, res, next) => {
  try {
    const { dto } = await buildPlanContext();
    res.json(dto);
  } catch (e) { next(e); }
});
```

Remove now-unused imports from `plan.ts` (the funding/balance/budget imports moved to `planData.ts`). Keep the `PATCH /api/plan/override` handler and whatever imports it still needs (`z`, `db`, `setStringSetting`, `parseOverrides` — keep `prevMonth`/`parseOverrides` in `plan.ts` only if the PATCH handler uses them; otherwise delete them to satisfy `noUnusedLocals`).

- [ ] **Step 3: Typecheck, build, run existing plan tests**

Run:
```bash
pnpm tsc --noEmit -p tsconfig.json
pnpm exec vite build
node --test --import tsx server/lib/plan.test.ts
```
Expected: tsc clean, build clean, all `plan.test.ts` tests pass (they test `computePlanSteps`/`computeSurplus`/`averageMonthly`, which are untouched).

- [ ] **Step 4: Verify `/api/plan` parity (manual)**

Start the server if not running, then:
```bash
curl -s localhost:3000/api/plan | head -c 400
```
Expected: a `PlanDTO` JSON identical in shape to before (steps, current, surplus, efAccount). (Port: use the app's configured API port.)

- [ ] **Step 5: Commit**

```bash
git add server/lib/planData.ts server/routes/plan.ts
git commit -m "refactor(plan): extract buildPlanContext for reuse by insights"
```

---

### Task 3: Pure reconcile engine `server/lib/insights.ts`

**Files:**
- Modify: `shared/types.ts` (add `InsightKind`, `InsightSeverity`)
- Create: `server/lib/insights.ts`
- Test: `server/lib/insights.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // shared/types.ts
  export type InsightKind = "overspent" | "needs_category" | "new_subscription" | "surplus" | "new_transactions";
  export type InsightSeverity = "warn" | "review" | "opportunity" | "digest";

  // server/lib/insights.ts
  export interface InsightConditions {
    overspent: { summary: string; amount: number } | null;
    needs_category: { count: number } | null;
    new_subscription: { count: number } | null;
    surplus: { amount: number; hint: string } | null;
    new_transactions: { count: number } | null;
  }
  export interface UnresolvedInsight { id: string; kind: InsightKind; payload: Record<string, unknown>; dismissedAt: Date | null }
  export type ReconcileAction =
    | { type: "create"; kind: InsightKind; payload: Record<string, unknown> }
    | { type: "refresh"; id: string; payload: Record<string, unknown> }
    | { type: "resolve"; id: string };
  export interface RenderedInsight { title: string; detail: string | null; count: number | null; link: string; severity: InsightSeverity }
  export const KIND_ORDER: InsightKind[];
  export function reconcileInsights(conditions: InsightConditions, unresolved: UnresolvedInsight[]): ReconcileAction[];
  export function renderInsight(kind: InsightKind, payload: Record<string, unknown>): RenderedInsight;
  export function sortInsights<T extends { kind: InsightKind }>(items: T[]): T[];
  ```

- [ ] **Step 1: Add shared types**

In `shared/types.ts`, near the `PlanDTO` block, add:

```ts
export type InsightKind = "overspent" | "needs_category" | "new_subscription" | "surplus" | "new_transactions";
export type InsightSeverity = "warn" | "review" | "opportunity" | "digest";
```

- [ ] **Step 2: Write the failing tests**

Create `server/lib/insights.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { reconcileInsights, renderInsight, sortInsights, KIND_ORDER, type InsightConditions, type UnresolvedInsight } from "./insights.ts";

const EMPTY: InsightConditions = { overspent: null, needs_category: null, new_subscription: null, surplus: null, new_transactions: null };

test("creates an insight when a condition becomes true and none exists", () => {
  const actions = reconcileInsights({ ...EMPTY, needs_category: { count: 3 } }, []);
  assert.deepEqual(actions, [{ type: "create", kind: "needs_category", payload: { count: 3 } }]);
});

test("refreshes payload when the open insight's count changed", () => {
  const open: UnresolvedInsight[] = [{ id: "a", kind: "needs_category", payload: { count: 3 }, dismissedAt: null }];
  const actions = reconcileInsights({ ...EMPTY, needs_category: { count: 5 } }, open);
  assert.deepEqual(actions, [{ type: "refresh", id: "a", payload: { count: 5 } }]);
});

test("no action when open insight payload is unchanged", () => {
  const open: UnresolvedInsight[] = [{ id: "a", kind: "needs_category", payload: { count: 3 }, dismissedAt: null }];
  assert.deepEqual(reconcileInsights({ ...EMPTY, needs_category: { count: 3 } }, open), []);
});

test("auto-resolves an open insight when its condition goes false", () => {
  const open: UnresolvedInsight[] = [{ id: "a", kind: "needs_category", payload: { count: 3 }, dismissedAt: null }];
  assert.deepEqual(reconcileInsights(EMPTY, open), [{ type: "resolve", id: "a" }]);
});

test("dismissal is sticky: no recreate while condition still holds", () => {
  const open: UnresolvedInsight[] = [{ id: "a", kind: "needs_category", payload: { count: 3 }, dismissedAt: new Date() }];
  assert.deepEqual(reconcileInsights({ ...EMPTY, needs_category: { count: 3 } }, open), []);
});

test("dismissed row still resolves when condition goes false (so a future cycle starts fresh)", () => {
  const open: UnresolvedInsight[] = [{ id: "a", kind: "needs_category", payload: { count: 3 }, dismissedAt: new Date() }];
  assert.deepEqual(reconcileInsights(EMPTY, open), [{ type: "resolve", id: "a" }]);
});

test("renderInsight produces the documented text, link and severity per kind", () => {
  assert.deepEqual(renderInsight("needs_category", { count: 3 }), { title: "3 transactions need a category", detail: null, count: 3, link: "/transactions?cat=uncategorised", severity: "review" });
  assert.deepEqual(renderInsight("needs_category", { count: 1 }).title, "1 transaction needs a category");
  assert.deepEqual(renderInsight("new_subscription", { count: 2 }), { title: "2 subscriptions to confirm", detail: null, count: 2, link: "/recurring", severity: "review" });
  assert.deepEqual(renderInsight("overspent", { summary: "Groceries over by £42", amount: 42 }), { title: "Groceries over by £42", detail: null, count: null, link: "/budgets", severity: "warn" });
  assert.deepEqual(renderInsight("surplus", { amount: 210, hint: "Move it to savings" }), { title: "£210 spare", detail: "Move it to savings", count: null, link: "/savings", severity: "opportunity" });
  assert.deepEqual(renderInsight("new_transactions", { count: 4 }), { title: "4 new transactions", detail: null, count: 4, link: "/transactions", severity: "digest" });
});

test("sortInsights orders by KIND_ORDER", () => {
  const items = [{ kind: "new_transactions" as const }, { kind: "overspent" as const }, { kind: "surplus" as const }, { kind: "needs_category" as const }];
  assert.deepEqual(sortInsights(items).map((i) => i.kind), ["overspent", "needs_category", "surplus", "new_transactions"]);
  assert.deepEqual(KIND_ORDER, ["overspent", "needs_category", "new_subscription", "surplus", "new_transactions"]);
});
```

- [ ] **Step 3: Run the tests (expect failure)**

Run: `node --test --import tsx server/lib/insights.test.ts`
Expected: FAIL — `Cannot find module './insights.ts'`.

- [ ] **Step 4: Implement `server/lib/insights.ts`**

```ts
import type { InsightKind, InsightSeverity } from "../../shared/types.ts";
export type { InsightKind, InsightSeverity };

export interface InsightConditions {
  overspent: { summary: string; amount: number } | null;
  needs_category: { count: number } | null;
  new_subscription: { count: number } | null;
  surplus: { amount: number; hint: string } | null;
  new_transactions: { count: number } | null;
}

export interface UnresolvedInsight {
  id: string;
  kind: InsightKind;
  payload: Record<string, unknown>;
  dismissedAt: Date | null;
}

export type ReconcileAction =
  | { type: "create"; kind: InsightKind; payload: Record<string, unknown> }
  | { type: "refresh"; id: string; payload: Record<string, unknown> }
  | { type: "resolve"; id: string };

export interface RenderedInsight {
  title: string;
  detail: string | null;
  count: number | null;
  link: string;
  severity: InsightSeverity;
}

// Sort + severity precedence: problems → review → opportunity → digest.
export const KIND_ORDER: InsightKind[] = ["overspent", "needs_category", "new_subscription", "surplus", "new_transactions"];

const gbp = (n: number) => `£${Math.round(n)}`;
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
const shallowEqual = (a: Record<string, unknown>, b: Record<string, unknown>) => {
  const ak = Object.keys(a), bk = Object.keys(b);
  return ak.length === bk.length && ak.every((k) => a[k] === b[k]);
};

// Per-kind reconcile. `unresolved` holds rows with resolvedAt IS NULL (open OR
// dismissed-not-yet-resolved). At most one per kind (singleton).
export function reconcileInsights(conditions: InsightConditions, unresolved: UnresolvedInsight[]): ReconcileAction[] {
  const actions: ReconcileAction[] = [];
  for (const kind of KIND_ORDER) {
    const cond = conditions[kind] as Record<string, unknown> | null;
    const existing = unresolved.find((r) => r.kind === kind) ?? null;
    if (cond) {
      if (!existing) actions.push({ type: "create", kind, payload: cond });
      else if (existing.dismissedAt) { /* sticky dismissal — leave it */ }
      else if (!shallowEqual(existing.payload, cond)) actions.push({ type: "refresh", id: existing.id, payload: cond });
    } else if (existing) {
      actions.push({ type: "resolve", id: existing.id });
    }
  }
  return actions;
}

export function renderInsight(kind: InsightKind, payload: Record<string, unknown>): RenderedInsight {
  const n = Number(payload.count ?? 0);
  switch (kind) {
    case "needs_category":
      return { title: `${n} ${plural(n, "transaction needs", "transactions need")} a category`, detail: null, count: n, link: "/transactions?cat=uncategorised", severity: "review" };
    case "new_subscription":
      return { title: `${n} ${plural(n, "subscription", "subscriptions")} to confirm`, detail: null, count: n, link: "/recurring", severity: "review" };
    case "overspent":
      return { title: String(payload.summary ?? "Over budget"), detail: null, count: null, link: "/budgets", severity: "warn" };
    case "surplus":
      return { title: `${gbp(Number(payload.amount ?? 0))} spare`, detail: payload.hint ? String(payload.hint) : null, count: null, link: "/savings", severity: "opportunity" };
    case "new_transactions":
      return { title: `${n} new ${plural(n, "transaction", "transactions")}`, detail: null, count: n, link: "/transactions", severity: "digest" };
  }
}

export function sortInsights<T extends { kind: InsightKind }>(items: T[]): T[] {
  return [...items].sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
}
```

> Note the `needs_category` title: `"1 transaction needs a category"` / `"3 transactions need a category"` — matches the test (`plural` returns the verb-inclusive phrase).

- [ ] **Step 5: Run the tests (expect pass)**

Run: `node --test --import tsx server/lib/insights.test.ts`
Expected: all tests pass.

- [ ] **Step 6: Typecheck + commit**

Run: `pnpm tsc --noEmit -p tsconfig.json`
Expected: no errors.

```bash
git add shared/types.ts server/lib/insights.ts server/lib/insights.test.ts
git commit -m "feat(insights): pure reconcile engine + render + sort"
```

---

### Task 4: Condition gathering + reconcile runner `server/lib/insightConditions.ts`

**Files:**
- Create: `server/lib/insightConditions.ts`
- Test: `server/lib/insightConditions.test.ts` (covers the pure `worstOverspend` helper)

**Interfaces:**
- Consumes: `buildPlanContext` (planData.ts); `reconcileInsights, InsightConditions, InsightKind, UnresolvedInsight` (insights.ts); `personalSpendByCategory, currentMonth, BudgetTx` (budget.ts); `effectiveCategory`; `isRefundNote` (shared/refund.ts); `getStringSettings` (settings.ts); `db`.
- Produces:
  ```ts
  export function worstOverspend(cats: { key: string; name: string; budget: number }[], spent: Record<string, number>): { summary: string; amount: number } | null;
  export async function gatherConditions(): Promise<InsightConditions>;
  export async function runReconcile(now: Date): Promise<void>;
  ```

- [ ] **Step 1: Write the failing test for `worstOverspend`**

Create `server/lib/insightConditions.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { worstOverspend } from "./insightConditions.ts";

const cats = [
  { key: "groceries", name: "Groceries", budget: 400 },
  { key: "dining-out", name: "Dining out", budget: 100 },
  { key: "transport", name: "Transport", budget: 0 }, // no budget → ignored
];

test("worstOverspend returns null when nothing is over", () => {
  assert.equal(worstOverspend(cats, { groceries: 350, "dining-out": 90 }), null);
});

test("worstOverspend picks the largest overspend and rounds the amount", () => {
  const r = worstOverspend(cats, { groceries: 442, "dining-out": 150 });
  assert.deepEqual(r, { summary: "Groceries over by £42", amount: 42 });
});

test("worstOverspend ignores categories with no budget even if spent", () => {
  assert.equal(worstOverspend(cats, { transport: 999 }), null);
});
```

- [ ] **Step 2: Run the test (expect failure)**

Run: `node --test --import tsx server/lib/insightConditions.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `server/lib/insightConditions.ts`**

```ts
import { db } from "./db.ts";
import { buildPlanContext } from "./planData.ts";
import { reconcileInsights, type InsightConditions, type InsightKind, type UnresolvedInsight } from "./insights.ts";
import { currentMonth, personalSpendByCategory, type BudgetTx } from "./budget.ts";
import { effectiveCategory } from "./effectiveCategory.ts";
import { isRefundNote } from "../../shared/refund.ts";
import { getStringSettings } from "./settings.ts";

// Largest budget category over 100% this month, or null. Pure → unit tested.
export function worstOverspend(
  cats: { key: string; name: string; budget: number }[],
  spent: Record<string, number>,
): { summary: string; amount: number } | null {
  let worst: { summary: string; amount: number } | null = null;
  for (const c of cats) {
    if (c.budget <= 0) continue;
    const over = (spent[c.key] ?? 0) - c.budget;
    if (over > 0 && (!worst || over > worst.amount)) {
      worst = { summary: `${c.name} over by £${Math.round(over)}`, amount: over };
    }
  }
  return worst;
}

export async function gatherConditions(): Promise<InsightConditions> {
  // needs_category — uncategorised, settled, non-refund
  const uncats = await db.transaction.findMany({
    where: { category: "uncategorised", status: { not: "pending" } },
    select: { note: true },
  });
  const needsCount = uncats.filter((t) => !isRefundNote(t.note)).length;

  // new_subscription — auto-detected recurring awaiting confirmation
  const autoSubs = await db.recurringSchedule.count({ where: { status: "auto" } });

  // new_transactions — settled txns imported since the "caught up" marker
  const settings = await getStringSettings();
  const seen = settings["insights.txnsSeenAt"];
  const since = seen ? new Date(seen) : new Date(0);
  const newCount = await db.transaction.count({ where: { status: { not: "pending" }, createdAt: { gt: since } } });

  // overspent — worst budget category over, OR balance can't cover committed bills
  const ctx = await buildPlanContext();
  const cats = await db.category.findMany({ where: { archived: false } });
  const budgetCats = cats
    .map((c) => ({ key: c.key, name: c.name, budget: Number(c.monthlyAmount.toString()) }))
    .filter((c) => c.budget > 0);
  const accts = await db.account.findMany({ where: { informational: false }, select: { id: true } });
  const ids = accts.map((a) => a.id);
  const txns = await db.transaction.findMany({
    where: { accountId: { in: ids } },
    select: { amount: true, category: true, categoryOverride: true, bookingDate: true },
  });
  const budgetTxns: BudgetTx[] = txns.map((t) => ({ amount: Number(t.amount.toString()), category: effectiveCategory(t), bookingDate: t.bookingDate }));
  const spent = personalSpendByCategory(budgetTxns, currentMonth());
  let overspent = worstOverspend(budgetCats, spent);
  const shortfall = ctx.billsBeforePayday - ctx.spendableNow - ctx.incomeIncoming;
  if (!overspent && shortfall > 0) {
    overspent = { summary: "Balance won't cover upcoming bills", amount: shortfall };
  }

  // surplus — spare money to allocate on the current plan step
  const cur = ctx.dto.current ? ctx.dto.steps.find((s) => s.key === ctx.dto.current) : null;
  const surplus = ctx.dto.surplus > 0 && cur?.actionHint ? { amount: ctx.dto.surplus, hint: cur.actionHint } : null;

  return {
    overspent,
    needs_category: needsCount > 0 ? { count: needsCount } : null,
    new_subscription: autoSubs > 0 ? { count: autoSubs } : null,
    surplus,
    new_transactions: newCount > 0 ? { count: newCount } : null,
  };
}

// Reconcile the Insight table against live conditions: create new, refresh
// counts, auto-resolve closed. Called on every GET /api/insights and post-sync.
export async function runReconcile(now: Date): Promise<void> {
  const conditions = await gatherConditions();
  const rows = await db.insight.findMany({ where: { resolvedAt: null }, orderBy: { createdAt: "desc" } });
  const unresolved: UnresolvedInsight[] = rows.map((r) => ({
    id: r.id, kind: r.kind as InsightKind, payload: (r.payload ?? {}) as Record<string, unknown>, dismissedAt: r.dismissedAt,
  }));
  const actions = reconcileInsights(conditions, unresolved);
  for (const a of actions) {
    if (a.type === "create") await db.insight.create({ data: { kind: a.kind, payload: a.payload } });
    else if (a.type === "refresh") await db.insight.update({ where: { id: a.id }, data: { payload: a.payload, updatedAt: now } });
    else await db.insight.update({ where: { id: a.id }, data: { resolvedAt: now } });
  }
}
```

- [ ] **Step 4: Run the test (expect pass)**

Run: `node --test --import tsx server/lib/insightConditions.test.ts`
Expected: 3 tests pass.

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm tsc --noEmit -p tsconfig.json`
Expected: no errors.

```bash
git add server/lib/insightConditions.ts server/lib/insightConditions.test.ts
git commit -m "feat(insights): condition gathering + reconcile runner"
```

---

### Task 5: Routes + DTO + api client

**Files:**
- Modify: `shared/types.ts` (add `InsightDTO`, `InsightAction`)
- Create: `server/routes/insights.ts`
- Modify: `server/index.ts` (register the router)
- Modify: `web/src/api.ts` (add `insights`, `patchInsight`)

**Interfaces:**
- Consumes: `runReconcile` (insightConditions.ts); `renderInsight, sortInsights, InsightKind` (insights.ts); `setStringSetting` (settings.ts); `db`; `z`.
- Produces:
  ```ts
  // shared/types.ts
  export type InsightAction = "dismiss" | "snooze" | "read";
  export interface InsightDTO { id: string; kind: InsightKind; title: string; detail: string | null; count: number | null; link: string; severity: InsightSeverity; createdAt: string }
  // api.ts
  insights: () => Promise<InsightDTO[]>;
  patchInsight: (id: string, action: InsightAction, until?: string) => Promise<{ ok: boolean }>;
  ```

- [ ] **Step 1: Add DTO types**

In `shared/types.ts`, after the `InsightKind`/`InsightSeverity` added in Task 3:

```ts
export type InsightAction = "dismiss" | "snooze" | "read";
export interface InsightDTO {
  id: string;
  kind: InsightKind;
  title: string;
  detail: string | null;
  count: number | null;
  link: string;
  severity: InsightSeverity;
  createdAt: string; // ISO
}
```

- [ ] **Step 2: Create `server/routes/insights.ts`**

```ts
// server/routes/insights.ts
import { Router } from "express";
import { z } from "zod";
import { db } from "../lib/db.ts";
import { runReconcile } from "../lib/insightConditions.ts";
import { renderInsight, sortInsights, type InsightKind } from "../lib/insights.ts";
import { setStringSetting } from "../lib/settings.ts";
import type { InsightDTO } from "../../shared/types.ts";

export const insightsRouter = Router();

// Reconcile against live data, then return the VISIBLE inbox (open, not snoozed).
insightsRouter.get("/insights", async (_req, res, next) => {
  try {
    const now = new Date();
    await runReconcile(now);
    const rows = await db.insight.findMany({
      where: { resolvedAt: null, dismissedAt: null, OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: now } }] },
      orderBy: { createdAt: "desc" },
    });
    const dtos: InsightDTO[] = sortInsights(rows.map((r) => {
      const kind = r.kind as InsightKind;
      const rendered = renderInsight(kind, (r.payload ?? {}) as Record<string, unknown>);
      return { id: r.id, kind, ...rendered, createdAt: r.createdAt.toISOString() };
    }));
    res.json(dtos);
  } catch (e) { next(e); }
});

const patchSchema = z.object({ action: z.enum(["dismiss", "snooze", "read"]), until: z.string().optional() });

insightsRouter.patch("/insights/:id", async (req, res, next) => {
  try {
    const { action, until } = patchSchema.parse(req.body);
    const now = new Date();
    const row = await db.insight.findUnique({ where: { id: req.params.id } });
    if (!row) return res.status(404).json({ error: "not found" });

    if (action === "dismiss") {
      await db.insight.update({ where: { id: row.id }, data: { dismissedAt: now } });
    } else if (action === "snooze") {
      const until_ = until ? new Date(until) : null;
      if (!until_ || Number.isNaN(until_.getTime()) || until_ <= now) return res.status(400).json({ error: "invalid until" });
      await db.insight.update({ where: { id: row.id }, data: { snoozedUntil: until_ } });
    } else { // read — for the digest kind this is what resolves it
      const data: { readAt: Date; resolvedAt?: Date } = { readAt: now };
      if (row.kind === "new_transactions") {
        data.resolvedAt = now;
        await setStringSetting("insights.txnsSeenAt", now.toISOString());
      }
      await db.insight.update({ where: { id: row.id }, data });
    }
    res.json({ ok: true });
  } catch (e) { next(e); }
});
```

- [ ] **Step 3: Register the router**

In `server/index.ts`, add the import near the other route imports and register it alongside the others:

```ts
import { insightsRouter } from "./routes/insights.ts";
// ... with the other app.use("/api", …) lines:
app.use("/api", insightsRouter);
```

- [ ] **Step 4: Add the api client methods**

In `web/src/api.ts`, add `InsightDTO, InsightAction` to the type import block, and add to the `api` object (after the `plan`/`setPlanOverride` lines):

```ts
  insights: () => get<InsightDTO[]>("/api/insights"),
  patchInsight: (id: string, action: InsightAction, until?: string) =>
    send<{ ok: boolean }>("PATCH", `/api/insights/${id}`, { action, until }),
```

- [ ] **Step 5: Typecheck + build**

Run:
```bash
pnpm tsc --noEmit -p tsconfig.json
pnpm exec vite build
```
Expected: both clean.

- [ ] **Step 6: Smoke-test the endpoint (manual)**

```bash
curl -s localhost:3000/api/insights | head -c 400
```
Expected: a JSON array (possibly `[]`) of insight DTOs sorted by kind order.

- [ ] **Step 7: Commit**

```bash
git add shared/types.ts server/routes/insights.ts server/index.ts web/src/api.ts
git commit -m "feat(insights): GET/PATCH /api/insights routes + api client"
```

---

### Task 6: PlanProgressCard component

**Files:**
- Create: `web/src/components/PlanProgressCard.tsx`
- Modify: `web/src/styles.css` (stepper + card styles)

**Interfaces:**
- Consumes: `api.plan()` → `PlanDTO`; `PlanStepDTO` for the stepper. Renders a `<Link to="/savings">`.

- [ ] **Step 1: Implement `web/src/components/PlanProgressCard.tsx`**

```tsx
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../api.ts";
import { formatGBP } from "../format.ts";

// The always-present "Your plan" anchor: where you are on budget → save → invest.
// Pure progress (no actions) — actions live in the NeedsYou inbox.
export function PlanProgressCard() {
  const { data } = useQuery({ queryKey: ["plan"], queryFn: () => api.plan() });
  if (!data) return null;

  const current = data.current ? data.steps.find((s) => s.key === data.current) : null;

  // Nothing set up yet → a slim set-up prompt instead of the stepper.
  if (!current) {
    return (
      <Link to="/savings" className="card plan-card plan-card-empty">
        <span className="plan-card-title">Set up your plan</span>
        <span className="plan-card-go">Start →</span>
      </Link>
    );
  }

  const pct = current.progress?.pct ?? 0;
  return (
    <Link to="/savings" className="card plan-card">
      <div className="plan-card-row">
        <span className="plan-card-title">{current.title}</span>
        {current.progress && <span className="plan-card-pct num">{pct}%</span>}
      </div>
      <div className="plan-steps" aria-hidden>
        {data.steps.map((s) => (
          <span key={s.key} className={`plan-step is-${s.key === data.current ? "current" : s.state}`} />
        ))}
      </div>
      {current.progress && (
        <span className="plan-card-sub muted">
          {formatGBP(current.progress.have)} of {formatGBP(current.progress.target)}
        </span>
      )}
    </Link>
  );
}
```

- [ ] **Step 2: Add styles**

Append to `web/src/styles.css`:

```css
/* ── Command center: plan progress card ───────────────────────────── */
.plan-card { display: flex; flex-direction: column; gap: 9px; text-decoration: none; color: var(--ink); }
.plan-card-row { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
.plan-card-title { font-size: 15px; font-weight: 640; letter-spacing: -0.01em; }
.plan-card-pct { font-size: 15px; font-weight: 680; color: var(--jade); }
.plan-card-sub { font-size: 12.5px; }
.plan-steps { display: flex; align-items: center; gap: 6px; }
.plan-step { flex: 1; height: 5px; border-radius: 99px; background: var(--line-strong); }
.plan-step.is-done { background: var(--jade); }
.plan-step.is-current { background: color-mix(in srgb, var(--jade) 60%, var(--bg)); box-shadow: 0 0 0 2px color-mix(in srgb, var(--jade) 30%, transparent); }
.plan-card-empty { flex-direction: row; align-items: center; justify-content: space-between; }
.plan-card-empty .plan-card-go { color: var(--jade); font-weight: 640; font-size: 14px; }
```

- [ ] **Step 3: Typecheck + build**

Run:
```bash
pnpm tsc --noEmit -p tsconfig.json
pnpm exec vite build
```
Expected: both clean.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/PlanProgressCard.tsx web/src/styles.css
git commit -m "feat(insights): PlanProgressCard (budget→save→invest stepper)"
```

---

### Task 7: NeedsYou inbox + DashboardHome wiring + delete SurplusNudge

**Files:**
- Create: `web/src/components/NeedsYou.tsx`
- Modify: `web/src/pages/DashboardHome.tsx`
- Delete: `web/src/components/SurplusNudge.tsx`
- Modify: `web/src/styles.css` (inbox row + menu styles)

**Interfaces:**
- Consumes: `api.insights()` → `InsightDTO[]`; `api.patchInsight(id, action, until?)`; `InsightDTO`, `InsightKind`. Renders `PlanProgressCard` + the inbox in `DashboardHome`.

- [ ] **Step 1: Implement `web/src/components/NeedsYou.tsx`**

```tsx
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  AlertTriangle, Tag, Repeat, PiggyBank, Sparkles, MoreVertical, ChevronRight, Check,
} from "lucide-react";
import { api } from "../api.ts";
import type { InsightDTO, InsightKind, InsightAction } from "../../../shared/types.ts";

const ICON: Record<InsightKind, typeof Tag> = {
  overspent: AlertTriangle,
  needs_category: Tag,
  new_subscription: Repeat,
  surplus: PiggyBank,
  new_transactions: Sparkles,
};

// ISO timestamp `days` from now, formatted from a Date (server validates future).
const inDays = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
};

export function NeedsYou() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["insights"], queryFn: () => api.insights() });
  const [menuId, setMenuId] = useState<string | null>(null);

  const act = useMutation({
    mutationFn: ({ id, action, until }: { id: string; action: InsightAction; until?: string }) =>
      api.patchInsight(id, action, until),
    onMutate: async ({ id, action }) => {
      setMenuId(null);
      if (action === "read") return; // read doesn't remove the row from the inbox
      await qc.cancelQueries({ queryKey: ["insights"] });
      const prev = qc.getQueryData<InsightDTO[]>(["insights"]);
      qc.setQueryData<InsightDTO[]>(["insights"], (old) => (old ?? []).filter((i) => i.id !== id));
      return { prev };
    },
    onError: (_e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(["insights"], ctx.prev); },
    onSettled: () => qc.invalidateQueries({ queryKey: ["insights"] }),
  });

  if (!data) return null;

  if (data.length === 0) {
    return (
      <div className="flat-list needs-you">
        <div className="flat-head"><div className="flat-head-titles"><h3>Needs you</h3></div></div>
        <p className="needs-clear muted"><Check size={15} strokeWidth={2.4} /> You&rsquo;re all caught up</p>
      </div>
    );
  }

  return (
    <div className="flat-list needs-you">
      <div className="flat-head"><div className="flat-head-titles"><h3>Needs you</h3></div></div>
      <div className="needs-list">
        {data.map((it) => {
          const Icon = ICON[it.kind];
          return (
            <div key={it.id} className={`needs-row sev-${it.severity}`}>
              <Link
                to={it.link}
                className="needs-row-main"
                onClick={() => act.mutate({ id: it.id, action: "read" })}
              >
                <span className="needs-ico"><Icon size={17} strokeWidth={2.1} /></span>
                <span className="needs-body">
                  <span className="needs-title">{it.title}</span>
                  {it.detail && <span className="needs-detail muted">{it.detail}</span>}
                </span>
                <ChevronRight size={16} strokeWidth={2.2} className="needs-chev" />
              </Link>
              <button type="button" className="needs-menu-btn" aria-label="More" onClick={() => setMenuId(menuId === it.id ? null : it.id)}>
                <MoreVertical size={16} strokeWidth={2.2} />
              </button>
              {menuId === it.id && (
                <>
                  <div className="needs-menu-scrim" onClick={() => setMenuId(null)} />
                  <div className="needs-menu" role="menu">
                    <button type="button" onClick={() => act.mutate({ id: it.id, action: "dismiss" })}>Dismiss</button>
                    <button type="button" onClick={() => act.mutate({ id: it.id, action: "snooze", until: inDays(1) })}>Snooze 1 day</button>
                    <button type="button" onClick={() => act.mutate({ id: it.id, action: "snooze", until: inDays(7) })}>Snooze 1 week</button>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire into `DashboardHome.tsx` and drop `SurplusNudge`**

Replace the contents of `web/src/pages/DashboardHome.tsx` with:

```tsx
import { useState } from "react";
import Dashboard from "./Dashboard.tsx";
import { AccountsStrip } from "../components/AccountsStrip.tsx";
import { PlanProgressCard } from "../components/PlanProgressCard.tsx";
import { NeedsYou } from "../components/NeedsYou.tsx";

// The primary dashboard: account strip on top, then the two command-center cards
// (plan progress + needs-you inbox), then the dashboard body. The Customize
// toggle is hoisted here so it can sit in the strip header.
export default function DashboardHome() {
  const [editing, setEditing] = useState(false);
  return (
    <div className="dash-home">
      <AccountsStrip editing={editing} onToggleEditing={() => setEditing((e) => !e)} />
      <PlanProgressCard />
      <NeedsYou />
      <Dashboard minimal editing={editing} onEditingChange={setEditing} />
    </div>
  );
}
```

- [ ] **Step 3: Delete `SurplusNudge.tsx`**

Run: `git rm web/src/components/SurplusNudge.tsx`
Then grep to confirm no other references remain:
`grep -rn "SurplusNudge\|surplus-nudge" web/src` → expect only the `.surplus-nudge` CSS (remove that block in Step 4).

- [ ] **Step 4: Add inbox styles, remove dead `.surplus-nudge` CSS**

In `web/src/styles.css`, delete the `.surplus-nudge` / `.surplus-ico` / `.surplus-body` / `.surplus-amt` / `.surplus-hint` / `.surplus-go` rules, and append:

```css
/* ── Command center: "Needs you" inbox ────────────────────────────── */
.needs-you { margin-bottom: 16px; }
.needs-clear { display: inline-flex; align-items: center; gap: 7px; font-size: 13px; padding: 4px 2px; }
.needs-clear svg { color: var(--jade); }
.needs-list { display: flex; flex-direction: column; }
.needs-row { position: relative; display: flex; align-items: stretch; border-bottom: 1px solid var(--line); }
.needs-row:last-child { border-bottom: none; }
.needs-row-main { flex: 1; min-width: 0; display: flex; align-items: center; gap: 12px; padding: 11px 4px; text-decoration: none; color: var(--ink); border-radius: 8px; transition: background 0.12s ease; }
.needs-row-main:hover { background: var(--surface-2); }
.needs-ico { flex: none; display: grid; place-items: center; width: 34px; height: 34px; border-radius: 9px; background: var(--surface-2); color: var(--ink-2); }
.needs-row.sev-warn .needs-ico { background: color-mix(in srgb, var(--coral) 18%, var(--bg)); color: var(--coral); }
.needs-row.sev-opportunity .needs-ico { background: color-mix(in srgb, var(--jade) 18%, var(--bg)); color: var(--jade); }
.needs-body { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.needs-title { font-size: 14px; font-weight: 600; letter-spacing: -0.01em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.needs-detail { font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.needs-chev { flex: none; color: var(--ink-3); margin-left: auto; }
.needs-menu-btn { flex: none; width: 36px; border: none; background: transparent; color: var(--ink-3); cursor: pointer; border-radius: 8px; }
.needs-menu-btn:hover { background: var(--surface-2); color: var(--ink); }
.needs-menu-scrim { position: fixed; inset: 0; z-index: 40; }
.needs-menu { position: absolute; right: 4px; top: calc(100% - 6px); z-index: 41; display: flex; flex-direction: column; min-width: 150px; padding: 5px; background: var(--surface); border: 1px solid var(--line-strong); border-radius: 10px; box-shadow: 0 18px 40px -16px rgba(0,0,0,0.7); }
.needs-menu button { text-align: left; padding: 8px 10px; border: none; background: transparent; color: var(--ink); font-size: 13px; border-radius: 7px; cursor: pointer; }
.needs-menu button:hover { background: var(--surface-2); }
```

> Note: the menu is positioned `absolute` within `.needs-row` (rows have no transformed ancestor inside `.dash-home`), so it is not subject to the portal rule. The scrim is `position: fixed` to catch outside clicks.

- [ ] **Step 5: Typecheck + build**

Run:
```bash
pnpm tsc --noEmit -p tsconfig.json
pnpm exec vite build
```
Expected: both clean (confirms the `SurplusNudge` import is fully gone — `noUnusedLocals` would otherwise fail).

- [ ] **Step 6: Commit**

```bash
git add web/src/components/NeedsYou.tsx web/src/pages/DashboardHome.tsx web/src/styles.css
git commit -m "feat(insights): NeedsYou inbox, wire command center, retire SurplusNudge"
```

---

### Task 8: Post-sync reconcile hook

So bank/Gmail/Telegram-driven changes surface in the inbox without waiting for a dashboard load.

**Files:**
- Modify: `server/routes/sync.ts` (call `runReconcile` at the end of `runFullSync`)

**Interfaces:**
- Consumes: `runReconcile` (insightConditions.ts).

- [ ] **Step 1: Add the import**

In `server/routes/sync.ts`, add near the other lib imports:

```ts
import { runReconcile } from "../lib/insightConditions.ts";
```

- [ ] **Step 2: Call reconcile after schedule detection**

In `runFullSync`, immediately after the `detectSchedules()` try/catch block (the last step before the function returns its summary), add:

```ts
    try { await runReconcile(new Date()); }
    catch (err) { audit({ kind: "log", text: `insights: ${err instanceof Error ? err.message : err}`, tone: "red" }); }
```

- [ ] **Step 3: Typecheck + build**

Run:
```bash
pnpm tsc --noEmit -p tsconfig.json
pnpm exec vite build
```
Expected: both clean.

- [ ] **Step 4: Full server test sweep**

Run: `node --test --import tsx server/lib/*.test.ts server/categorise/*.test.ts`
Expected: all tests pass (including the new `insights`, `insightConditions`, `settings.insights` suites).

- [ ] **Step 5: Commit**

```bash
git add server/routes/sync.ts
git commit -m "feat(insights): reconcile inbox at end of full sync"
```

---

## Final verification (after all tasks)

- `pnpm tsc --noEmit -p tsconfig.json` — clean.
- `pnpm exec vite build` — clean.
- `node --test --import tsx server/lib/*.test.ts server/categorise/*.test.ts` — all pass.
- Manual: load the dashboard — `PlanProgressCard` shows the current step + stepper; `NeedsYou` lists insights sorted overspent→needs_category→new_subscription→surplus→new_transactions; tapping a row navigates and (for `new_transactions`) clears it; `⋮` → Dismiss/Snooze removes the row optimistically; with no insights the card shows "You're all caught up".
- `curl -s localhost:3000/api/plan` and `…/api/insights` return well-formed payloads.

## Self-review notes (coverage)

- **Spec §Component 1 (PlanProgressCard):** Task 6 — stepper, current title + pct, set-up empty state, links to `/savings`. ✓
- **Spec §Component 2 data model (Insight table):** Task 1. ✓
- **Spec §reconcile engine (auto-resolve + sticky dismiss):** Task 3 (pure + tested), Task 4 (`runReconcile`). ✓
- **Spec §five kinds + resolution rules:** Task 4 `gatherConditions` (incl. low-balance via `buildPlanContext`), Task 5 PATCH `read` special-case for `new_transactions` (+ `txnsSeenAt` bump). ✓
- **Spec §DTO + routes + sort:** Task 5 (GET reconcile+list, PATCH dismiss/snooze/read), `sortInsights`. ✓
- **Spec §front-end + delete SurplusNudge + empty state:** Task 7. ✓
- **Spec §post-sync reconcile:** Task 8. ✓
- **Spec §testing:** engine kinds create/refresh/auto-resolve, dismiss sticky, `worstOverspend`, settings validation, sort order — Tasks 1/3/4. (The `new_transactions` read-resolution and snooze-hides-until are exercised at the route layer, verified manually; the pure-resolve-on-condition path is unit-tested.)
