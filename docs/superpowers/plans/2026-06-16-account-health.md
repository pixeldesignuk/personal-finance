# Account Health Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reframe the account chip ring as an **account health** verdict (green/amber/red) backed by four composable checks, each yielding a *why* + a *recommendation*, surfaced via a tap-to-open health panel.

**Architecture:** A composable check engine under `server/lib/health/`: four pure, unit-tested checks (runway, cashflow, buffer, trend) run over each spendable account against a shared `HealthContext`; the runner aggregates to a worst-severity verdict and attaches cross-account recommendations. A new `GET /api/accounts/health` replaces `/api/accounts/funding`. The frontend recolors the ring by verdict and opens an `AccountHealthPanel` drawer on tap. The just-built funding code folds in as the runway check.

**Tech Stack:** TypeScript, Express 5, Prisma v6, React 19, react-router, `@tanstack/react-query`, `node:test` + `tsx`. Spec: `docs/superpowers/specs/2026-06-16-account-health-design.md`.

**Conventions (read before starting):**
- Node env for every command: `eval "$(/opt/homebrew/bin/brew shellenv)"; eval "$(fnm env)"` then **pnpm** (never npm).
- After code changes run **`pnpm tsc --noEmit -p tsconfig.json`** and **`pnpm exec vite build`**. `noUnusedLocals` is on — drop unused imports/vars.
- Run the full server suite with **`pnpm test`** (script is `node --import tsx --test server/**/*.test.ts` — it DOES pick up nested `server/lib/health/**/*.test.ts`). Target one file with `node --test --import tsx server/lib/health/<file>.test.ts`.
- **Commits to `main` only when the user asks.** Each task verifies (tsc/build/tests) but does NOT commit. A single gated commit task is at the end.
- The funding code (`server/lib/funding.ts`, `FundingRing.tsx`, `/api/accounts/funding`) is uncommitted; this plan supersedes parts of it. `server/lib/funding.ts` and `tallyIncomeByAccount` are KEPT and reused.

---

## File Structure

| File | Responsibility | Change |
|------|----------------|--------|
| `shared/types.ts` | DTOs | Add `HealthSeverity`, `HealthCheckKey`, `HealthCheckResultDTO`, `AccountHealthDTO` |
| `server/lib/health/netFlow.ts` | Avg monthly net flow (pure) | **Create** |
| `server/lib/health/types.ts` | `HealthAccount`, `HealthContext`, `HealthCheck`, `Source` | **Create** |
| `server/lib/health/recommend.ts` | `round2`, `money`, `freeCash`, `pickSource`, `recommendTransfer` | **Create** |
| `server/lib/health/checks/runway.ts` | Runway-to-payday check (wraps funding) | **Create** |
| `server/lib/health/checks/cashflow.ts` | Structural cashflow check | **Create** |
| `server/lib/health/checks/buffer.ts` | Overdraft check | **Create** |
| `server/lib/health/checks/trend.ts` | Balance-trend check | **Create** |
| `server/lib/health/index.ts` | `computeAccountHealth` runner + aggregation | **Create** |
| `server/lib/health/*.test.ts` | Unit tests | **Create** |
| `server/routes/accounts.ts` | `GET /api/accounts/health`; remove `/funding` | Modify |
| `web/src/api.ts` | `accountsHealth()`; remove `accountsFunding()` | Modify |
| `web/src/components/HealthRing.tsx` | Ring colored by verdict (was FundingRing) | **Create** (rename) |
| `web/src/components/FundingRing.tsx` | — | **Delete** |
| `web/src/components/AccountHealthPanel.tsx` | Tap-to-open health drawer | **Create** |
| `web/src/components/AccountsStrip.tsx` | Query health; ring by verdict; tap → panel | Modify |
| `web/src/styles.css` | Ring verdict colors + panel styles | Modify |

---

## Task 1: DTO types

**Files:**
- Modify: `shared/types.ts` (after the existing `AccountFundingDTO` block, ~line 213)

- [ ] **Step 1: Add the types**

In `shared/types.ts`, immediately after the `AccountFundingDTO` interface, add:

```ts
// Account health: a verdict per spendable account, backed by independent checks
// that each carry a reason and a recommendation. See
// docs/superpowers/specs/2026-06-16-account-health-design.md
export type HealthSeverity = "ok" | "attention" | "urgent";
export type HealthCheckKey = "runway" | "cashflow" | "buffer" | "trend";

export interface HealthCheckResultDTO {
  key: HealthCheckKey;
  severity: HealthSeverity;
  title: string;          // short label, e.g. "Runway to payday"
  why: string;            // the diagnosis
  recommendation: string | null; // the fix, or null
}

export interface AccountHealthDTO {
  accountId: string;
  verdict: HealthSeverity;        // worst severity across checks
  color: "green" | "amber" | "red";
  headline: string;              // "Healthy" | "Needs attention" | "Unhealthy"
  checks: HealthCheckResultDTO[]; // triggered checks, plus ok ones for the positive panel
  ring: { solidFraction: number; dashedFraction: number }; // runway arc geometry
}
```

- [ ] **Step 2: Verify it compiles**

Run: `eval "$(/opt/homebrew/bin/brew shellenv)"; eval "$(fnm env)"; pnpm tsc --noEmit -p tsconfig.json`
Expected: no errors.

---

## Task 2: Average monthly net flow (pure)

**Files:**
- Create: `server/lib/health/netFlow.ts`
- Create: `server/lib/health/netFlow.test.ts`

- [ ] **Step 1: Write the failing test**

Create `server/lib/health/netFlow.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { avgMonthlyNetFlow } from "./netFlow.ts";

const TODAY = new Date(2026, 5, 16); // 16 Jun 2026 → complete months: Mar, Apr, May 2026

test("avgMonthlyNetFlow: averages signed flow over the 3 prior complete months", () => {
  const txns = [
    { amount: 1000, month: "2026-05" }, { amount: -700, month: "2026-05" }, // May net +300
    { amount: -300, month: "2026-04" },                                     // Apr net -300
    { amount: -600, month: "2026-03" },                                     // Mar net -600
  ];
  // total -600 over 3 months → -200/mo
  assert.equal(avgMonthlyNetFlow(txns, TODAY), -200);
});

test("avgMonthlyNetFlow: ignores the current (incomplete) month and older months", () => {
  const txns = [
    { amount: 5000, month: "2026-06" }, // current month — ignored
    { amount: -900, month: "2026-02" }, // 4 months back — outside window
    { amount: 300, month: "2026-05" },
  ];
  assert.equal(avgMonthlyNetFlow(txns, TODAY), 100); // 300 / 3
});

test("avgMonthlyNetFlow: null months and empty input", () => {
  assert.equal(avgMonthlyNetFlow([{ amount: 50, month: null }], TODAY), 0);
  assert.equal(avgMonthlyNetFlow([], TODAY), 0);
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `eval "$(/opt/homebrew/bin/brew shellenv)"; eval "$(fnm env)"; node --test --import tsx server/lib/health/netFlow.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `server/lib/health/netFlow.ts`:

```ts
// Average monthly net flow (signed credits − debits, transfers included) over the
// `months` complete calendar months immediately before the current month. Pure.
export function avgMonthlyNetFlow(
  txns: { amount: number; month: string | null }[],
  today: Date,
  months = 3,
): number {
  const target = new Set<string>();
  for (let i = 1; i <= months; i++) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    target.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  let sum = 0;
  for (const t of txns) if (t.month && target.has(t.month)) sum += t.amount;
  return Math.round((sum / months) * 100) / 100;
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `eval "$(/opt/homebrew/bin/brew shellenv)"; eval "$(fnm env)"; node --test --import tsx server/lib/health/netFlow.test.ts`
Expected: PASS (3 tests).

---

## Task 3: Health types + recommendation helpers

**Files:**
- Create: `server/lib/health/types.ts`
- Create: `server/lib/health/recommend.ts`
- Create: `server/lib/health/recommend.test.ts`

- [ ] **Step 1: Create the types module**

Create `server/lib/health/types.ts`:

```ts
import type { AccountFundingDTO, HealthCheckResultDTO } from "../../../shared/types.ts";
import type { FundingSchedule, IncomeReceived } from "../funding.ts";

// A spendable account as the health engine sees it.
export interface HealthAccount {
  id: string;
  name: string;          // display name, used in recommendations ("Savings")
  balance: number;
  informational: boolean; // not-for-spending (savings-ish) → preferred recommendation source
}

// Shared, precomputed inputs handed to every check so they don't redo work.
export interface HealthContext {
  today: Date;
  accounts: HealthAccount[];                       // spendable (BANK + MANUAL)
  schedules: FundingSchedule[];                    // recurring in + out
  income: IncomeReceived;
  netFlowByAccount: Map<string, number>;           // avg monthly net flow (signed)
  fundingByAccount: Map<string, AccountFundingDTO>; // runway numbers per account
}

export interface Source {
  id: string;
  name: string;
  available: number; // free cash
}

// A check inspects one account against the context, returning a result or null.
export type HealthCheck = (account: HealthAccount, ctx: HealthContext) => HealthCheckResultDTO | null;
```

- [ ] **Step 2: Write the failing test for the helpers**

Create `server/lib/health/recommend.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { pickSource, recommendTransfer, freeCash } from "./recommend.ts";
import type { HealthContext, HealthAccount } from "./types.ts";
import type { AccountFundingDTO } from "../../../shared/types.ts";

const fund = (accountId: string, committed: number): AccountFundingDTO =>
  ({ accountId, committed, balance: 0, solidFraction: 0, dashedFraction: 0, incomeIncoming: 0, isIncomeAccount: false, state: "none", windowDays: 30 });

function ctxWith(accounts: HealthAccount[], committedByAcct: Record<string, number>): HealthContext {
  return {
    today: new Date(2026, 5, 16),
    accounts,
    schedules: [],
    income: { byAccount: new Map(), totalAll: 0, maxAll: 0 },
    netFlowByAccount: new Map(),
    fundingByAccount: new Map(accounts.map((a) => [a.id, fund(a.id, committedByAcct[a.id] ?? 0)])),
  };
}

test("freeCash: balance minus the account's own committed bills", () => {
  const ctx = ctxWith([{ id: "s", name: "Savings", balance: 500, informational: true }], { s: 0 });
  assert.equal(freeCash(ctx.accounts[0], ctx), 500);
});

test("pickSource: prefers an informational (savings) account, then most free cash", () => {
  const accounts: HealthAccount[] = [
    { id: "a", name: "Current", balance: 1000, informational: false }, // the account needing money
    { id: "b", name: "Spending", balance: 800, informational: false },
    { id: "s", name: "Savings", balance: 300, informational: true },
  ];
  const ctx = ctxWith(accounts, {});
  const src = pickSource(ctx, "a", 200);
  assert.equal(src?.id, "s"); // savings wins over the larger current account
});

test("recommendTransfer: names the source when it can cover the amount", () => {
  const accounts: HealthAccount[] = [
    { id: "a", name: "Current", balance: 0, informational: false },
    { id: "s", name: "Savings", balance: 300, informational: true },
  ];
  const ctx = ctxWith(accounts, {});
  assert.equal(recommendTransfer(ctx, "a", 120), "Move £120.00 from Savings");
});

test("recommendTransfer: partial move + top up when no single source covers it", () => {
  const accounts: HealthAccount[] = [
    { id: "a", name: "Current", balance: 0, informational: false },
    { id: "s", name: "Savings", balance: 50, informational: true },
  ];
  const ctx = ctxWith(accounts, {});
  assert.equal(recommendTransfer(ctx, "a", 120), "Move £50.00 from Savings and top up £70.00");
});

test("recommendTransfer: top up only when there is no source", () => {
  const accounts: HealthAccount[] = [{ id: "a", name: "Current", balance: 0, informational: false }];
  const ctx = ctxWith(accounts, {});
  assert.equal(recommendTransfer(ctx, "a", 120), "Top up £120.00 to cover it");
});
```

- [ ] **Step 3: Run to confirm failure**

Run: `eval "$(/opt/homebrew/bin/brew shellenv)"; eval "$(fnm env)"; node --test --import tsx server/lib/health/recommend.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the helpers**

Create `server/lib/health/recommend.ts`:

```ts
import type { HealthAccount, HealthContext, Source } from "./types.ts";

export const round2 = (n: number) => Math.round(n * 100) / 100;
export const money = (n: number) => n.toFixed(2);

// Cash an account could spare = its balance minus its own committed bills.
export function freeCash(account: HealthAccount, ctx: HealthContext): number {
  const committed = ctx.fundingByAccount.get(account.id)?.committed ?? 0;
  return round2(account.balance - committed);
}

// The best account to move money FROM to cover a gap on `accountId`: any other
// spendable account with spare cash, preferring savings-ish (informational)
// accounts, then the most free cash.
export function pickSource(ctx: HealthContext, accountId: string, _amount: number): Source | null {
  const candidates = ctx.accounts
    .filter((a) => a.id !== accountId)
    .map((a) => ({ id: a.id, name: a.name, informational: a.informational, available: freeCash(a, ctx) }))
    .filter((c) => c.available > 0)
    .sort((x, y) => (Number(y.informational) - Number(x.informational)) || (y.available - x.available));
  const top = candidates[0];
  return top ? { id: top.id, name: top.name, available: top.available } : null;
}

// A concrete recommendation string for covering `amount` on `accountId`.
export function recommendTransfer(ctx: HealthContext, accountId: string, amount: number): string {
  const src = pickSource(ctx, accountId, amount);
  if (!src) return `Top up £${money(amount)} to cover it`;
  if (src.available >= amount) return `Move £${money(amount)} from ${src.name}`;
  const rest = round2(amount - src.available);
  return `Move £${money(src.available)} from ${src.name} and top up £${money(rest)}`;
}
```

- [ ] **Step 5: Run to confirm pass + tsc**

Run: `eval "$(/opt/homebrew/bin/brew shellenv)"; eval "$(fnm env)"; node --test --import tsx server/lib/health/recommend.test.ts && pnpm tsc --noEmit -p tsconfig.json`
Expected: PASS (5 tests), tsc clean.

---

## Task 4: The four checks

**Files:**
- Create: `server/lib/health/checks/runway.ts`
- Create: `server/lib/health/checks/cashflow.ts`
- Create: `server/lib/health/checks/buffer.ts`
- Create: `server/lib/health/checks/trend.ts`
- Create: `server/lib/health/checks.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `server/lib/health/checks.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { runwayCheck } from "./checks/runway.ts";
import { cashflowCheck } from "./checks/cashflow.ts";
import { bufferCheck } from "./checks/buffer.ts";
import { trendCheck } from "./checks/trend.ts";
import type { HealthAccount, HealthContext } from "./types.ts";
import type { AccountFundingDTO } from "../../../shared/types.ts";

const A: HealthAccount = { id: "a", name: "Current", balance: 100, informational: false };
const baseFund = (over: Partial<AccountFundingDTO> = {}): AccountFundingDTO =>
  ({ accountId: "a", committed: 0, balance: 100, solidFraction: 0, dashedFraction: 0, incomeIncoming: 0, isIncomeAccount: false, state: "none", windowDays: 12, ...over });

function ctx(over: Partial<HealthContext> = {}, fund = baseFund()): HealthContext {
  return {
    today: new Date(2026, 5, 16),
    accounts: [A],
    schedules: [],
    income: { byAccount: new Map(), totalAll: 0, maxAll: 0 },
    netFlowByAccount: new Map(),
    fundingByAccount: new Map([["a", fund]]),
    ...over,
  };
}

// ---- runway ----
test("runway: nothing committed → ok, reassuring", () => {
  const r = runwayCheck(A, ctx());
  assert.equal(r?.severity, "ok");
  assert.match(r!.why, /Nothing due/);
});

test("runway: balance covers committed → ok", () => {
  const r = runwayCheck({ ...A, balance: 200 }, ctx({}, baseFund({ committed: 50, balance: 200 })));
  assert.equal(r?.severity, "ok");
});

test("runway: shortfall even with incoming pay → urgent with transfer rec", () => {
  const account: HealthAccount = { ...A, balance: 30 };
  const accounts = [account, { id: "s", name: "Savings", balance: 500, informational: true }];
  const fund = baseFund({ committed: 100, balance: 30, incomeIncoming: 0 });
  const c = ctx({ accounts, fundingByAccount: new Map([["a", fund], ["s", baseFund({ accountId: "s", committed: 0, balance: 500 })]]) }, fund);
  const r = runwayCheck(account, c);
  assert.equal(r?.severity, "urgent");
  assert.match(r!.why, /70\.00 short/);
  assert.equal(r!.recommendation, "Move £70.00 from Savings");
});

test("runway: balance short but incoming pay covers it → attention, no transfer", () => {
  const fund = baseFund({ committed: 100, balance: 30, incomeIncoming: 100, isIncomeAccount: true });
  const r = runwayCheck({ ...A, balance: 30 }, ctx({}, fund));
  assert.equal(r?.severity, "attention");
  assert.equal(r!.recommendation, null);
});

// ---- cashflow ----
test("cashflow: positive net flow → no result", () => {
  assert.equal(cashflowCheck(A, ctx({ netFlowByAccount: new Map([["a", 200]]) })), null);
});

test("cashflow: negative net flow → attention", () => {
  const r = cashflowCheck(A, ctx({ netFlowByAccount: new Map([["a", -300]]) }));
  assert.equal(r?.severity, "attention");
  assert.match(r!.why, /300\.00\/mo more goes out/);
});

// ---- buffer ----
test("buffer: positive balance → no result", () => {
  assert.equal(bufferCheck(A, ctx()), null);
});

test("buffer: overdrawn → urgent with transfer rec", () => {
  const account: HealthAccount = { ...A, balance: -45 };
  const accounts = [account, { id: "s", name: "Savings", balance: 500, informational: true }];
  const c = ctx({ accounts, fundingByAccount: new Map([["a", baseFund({ balance: -45 })], ["s", baseFund({ accountId: "s", balance: 500 })]]) });
  const r = bufferCheck(account, c);
  assert.equal(r?.severity, "urgent");
  assert.match(r!.why, /Overdrawn by £45\.00/);
  assert.equal(r!.recommendation, "Move £45.00 from Savings");
});

// ---- trend ----
test("trend: draining toward zero soon → attention with projected month", () => {
  // balance 600, draining 300/mo → 2 months → ~August
  const r = trendCheck({ ...A, balance: 600 }, ctx({ netFlowByAccount: new Map([["a", -300]]) }));
  assert.equal(r?.severity, "attention");
  assert.match(r!.why, /August/);
});

test("trend: positive flow or far-off zero → no result", () => {
  assert.equal(trendCheck({ ...A, balance: 600 }, ctx({ netFlowByAccount: new Map([["a", 100]]) })), null);
  assert.equal(trendCheck({ ...A, balance: 6000 }, ctx({ netFlowByAccount: new Map([["a", -100]]) })), null); // 60 months out
});

test("trend: overdrawn already → no result (buffer owns it)", () => {
  assert.equal(trendCheck({ ...A, balance: -10 }, ctx({ netFlowByAccount: new Map([["a", -300]]) })), null);
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `eval "$(/opt/homebrew/bin/brew shellenv)"; eval "$(fnm env)"; node --test --import tsx server/lib/health/checks.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement the runway check**

Create `server/lib/health/checks/runway.ts`:

```ts
import type { HealthCheck } from "../types.ts";
import { money, round2, recommendTransfer } from "../recommend.ts";

// Will the balance (plus any incoming pay) cover the bills committed to this
// account before the next payday? Wraps the funding numbers.
export const runwayCheck: HealthCheck = (account, ctx) => {
  const f = ctx.fundingByAccount.get(account.id);
  if (!f || f.committed === 0) {
    return { key: "runway", severity: "ok", title: "Runway to payday",
      why: "Nothing due before your next payday", recommendation: null };
  }
  if (f.balance >= f.committed) {
    return { key: "runway", severity: "ok", title: "Runway to payday",
      why: `Covered for the £${money(round2(f.committed))} of bills due before payday`, recommendation: null };
  }
  const reachable = round2(f.balance + f.incomeIncoming);
  const shortfall = round2(f.committed - reachable);
  if (shortfall > 0) {
    return { key: "runway", severity: "urgent", title: "Runway to payday",
      why: `£${money(shortfall)} short for bills due before payday`,
      recommendation: recommendTransfer(ctx, account.id, shortfall) };
  }
  // Today's balance doesn't cover it, but the incoming paycheck does.
  return { key: "runway", severity: "attention", title: "Runway to payday",
    why: `Bills before payday exceed your balance by £${money(round2(f.committed - f.balance))}, but your incoming pay covers it`,
    recommendation: null };
};
```

- [ ] **Step 4: Implement the cashflow check**

Create `server/lib/health/checks/cashflow.ts`:

```ts
import type { HealthCheck } from "../types.ts";
import { money, round2 } from "../recommend.ts";

// Over recent complete months, does more leave this account than arrives? A
// recurring drain — a one-off transfer won't fix it, so the advice is structural.
export const cashflowCheck: HealthCheck = (account, ctx) => {
  const net = ctx.netFlowByAccount.get(account.id);
  if (net == null || net >= 0) return null;
  const out = round2(-net);
  return { key: "cashflow", severity: "attention", title: "Cashflow",
    why: `On average £${money(out)}/mo more goes out than comes in`,
    recommendation: "Move a recurring bill to an account with spare cash, or trim your biggest discretionary spend" };
};
```

- [ ] **Step 5: Implement the buffer check**

Create `server/lib/health/checks/buffer.ts`:

```ts
import type { HealthCheck } from "../types.ts";
import { money, round2, recommendTransfer } from "../recommend.ts";

// Is the account overdrawn? (A configurable cushion above £0 is deferred — v1
// flags only a genuine negative balance.)
export const bufferCheck: HealthCheck = (account, ctx) => {
  if (account.balance >= 0) return null;
  const amount = round2(-account.balance);
  return { key: "buffer", severity: "urgent", title: "Overdrawn",
    why: `Overdrawn by £${money(amount)}`,
    recommendation: recommendTransfer(ctx, account.id, amount) };
};
```

- [ ] **Step 6: Implement the trend check**

Create `server/lib/health/checks/trend.ts`:

```ts
import type { HealthCheck } from "../types.ts";
import { money, round2 } from "../recommend.ts";

const MONTHS = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

// At the recent drain rate, when does this account hit £0? Warns when that's near.
// Shares the cashflow net-flow figure; defers overdrawn accounts to the buffer check.
export const trendCheck: HealthCheck = (account, ctx) => {
  const net = ctx.netFlowByAccount.get(account.id);
  if (net == null || net >= 0) return null;
  if (account.balance <= 0) return null;
  const monthsToZero = account.balance / -net;
  if (monthsToZero >= 3) return null;
  const ahead = Math.round(monthsToZero);
  const when = MONTHS[new Date(ctx.today.getFullYear(), ctx.today.getMonth() + ahead, 1).getMonth()];
  return { key: "trend", severity: monthsToZero < 1 ? "urgent" : "attention", title: "Balance trend",
    why: `Declining ~£${money(round2(-net))}/mo — on track to reach £0 around ${when}`,
    recommendation: "Slow the drain or top this account up before then" };
};
```

- [ ] **Step 7: Run the tests to confirm they pass**

Run: `eval "$(/opt/homebrew/bin/brew shellenv)"; eval "$(fnm env)"; node --test --import tsx server/lib/health/checks.test.ts`
Expected: PASS (all checks tests).

---

## Task 5: The health engine (aggregation)

**Files:**
- Create: `server/lib/health/index.ts`
- Create: `server/lib/health/index.test.ts`

- [ ] **Step 1: Write the failing test**

Create `server/lib/health/index.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeAccountHealth } from "./index.ts";
import type { HealthContext } from "./types.ts";
import type { AccountFundingDTO } from "../../../shared/types.ts";

const fund = (accountId: string, over: Partial<AccountFundingDTO> = {}): AccountFundingDTO =>
  ({ accountId, committed: 0, balance: 0, solidFraction: 0, dashedFraction: 0, incomeIncoming: 0, isIncomeAccount: false, state: "none", windowDays: 12, ...over });

function ctx(over: Partial<HealthContext> = {}): HealthContext {
  return {
    today: new Date(2026, 5, 16),
    accounts: [{ id: "a", name: "Current", balance: 100, informational: false }],
    schedules: [],
    income: { byAccount: new Map(), totalAll: 0, maxAll: 0 },
    netFlowByAccount: new Map(),
    fundingByAccount: new Map([["a", fund("a", { balance: 100 })]]),
    ...over,
  };
}

test("computeAccountHealth: healthy account → green, positive panel has the runway ok row", () => {
  const [h] = computeAccountHealth(ctx());
  assert.equal(h.verdict, "ok");
  assert.equal(h.color, "green");
  assert.equal(h.headline, "Healthy");
  assert.ok(h.checks.some((c) => c.key === "runway" && c.severity === "ok"));
});

test("computeAccountHealth: verdict is the worst severity across checks", () => {
  // overdrawn (urgent) + draining (attention) → urgent overall
  const [h] = computeAccountHealth(ctx({
    accounts: [{ id: "a", name: "Current", balance: -50, informational: false }],
    netFlowByAccount: new Map([["a", -100]]),
    fundingByAccount: new Map([["a", fund("a", { balance: -50 })]]),
  }));
  assert.equal(h.verdict, "urgent");
  assert.equal(h.color, "red");
  assert.equal(h.headline, "Unhealthy");
  assert.ok(h.checks.some((c) => c.key === "buffer" && c.severity === "urgent"));
});

test("computeAccountHealth: ring fractions come from funding", () => {
  const [h] = computeAccountHealth(ctx({
    fundingByAccount: new Map([["a", fund("a", { balance: 30, committed: 100, solidFraction: 0.3, dashedFraction: 0.5 })]]),
  }));
  assert.deepEqual(h.ring, { solidFraction: 0.3, dashedFraction: 0.5 });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `eval "$(/opt/homebrew/bin/brew shellenv)"; eval "$(fnm env)"; node --test --import tsx server/lib/health/index.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the engine**

Create `server/lib/health/index.ts`:

```ts
import type { AccountHealthDTO, HealthSeverity } from "../../../shared/types.ts";
import type { HealthCheck, HealthContext } from "./types.ts";
import { runwayCheck } from "./checks/runway.ts";
import { cashflowCheck } from "./checks/cashflow.ts";
import { bufferCheck } from "./checks/buffer.ts";
import { trendCheck } from "./checks/trend.ts";

export { avgMonthlyNetFlow } from "./netFlow.ts";
export type { HealthAccount, HealthContext } from "./types.ts";

const CHECKS: HealthCheck[] = [runwayCheck, cashflowCheck, bufferCheck, trendCheck];
const SEV_ORDER: Record<HealthSeverity, number> = { ok: 0, attention: 1, urgent: 2 };
const COLOR: Record<HealthSeverity, AccountHealthDTO["color"]> = { ok: "green", attention: "amber", urgent: "red" };
const HEADLINE: Record<HealthSeverity, string> = { ok: "Healthy", attention: "Needs attention", urgent: "Unhealthy" };

// Run every check over every account; verdict = worst severity; attach ring geometry.
export function computeAccountHealth(ctx: HealthContext): AccountHealthDTO[] {
  return ctx.accounts.map((account) => {
    const checks = CHECKS.map((c) => c(account, ctx)).filter((r) => r != null);
    const verdict = checks.reduce<HealthSeverity>(
      (worst, r) => (SEV_ORDER[r.severity] > SEV_ORDER[worst] ? r.severity : worst), "ok");
    const f = ctx.fundingByAccount.get(account.id);
    return {
      accountId: account.id,
      verdict,
      color: COLOR[verdict],
      headline: HEADLINE[verdict],
      checks,
      ring: { solidFraction: f?.solidFraction ?? 0, dashedFraction: f?.dashedFraction ?? 0 },
    };
  });
}
```

- [ ] **Step 4: Run to confirm pass + full suite + tsc**

Run: `eval "$(/opt/homebrew/bin/brew shellenv)"; eval "$(fnm env)"; node --test --import tsx server/lib/health/index.test.ts && pnpm test && pnpm tsc --noEmit -p tsconfig.json`
Expected: index tests PASS; full suite PASS; tsc clean.

---

## Task 6: `GET /api/accounts/health` (replaces `/funding`)

**Files:**
- Modify: `server/routes/accounts.ts` (imports ~line 14; replace the `/accounts/funding` handler)

- [ ] **Step 1: Update imports**

In `server/routes/accounts.ts`, change the type import on line 14 to drop `AccountFundingDTO` and add the health DTO:
```ts
import type { AccountDTO, BankDTO, AccountRecurringDTO, AccountHealthDTO } from "../../shared/types.ts";
```
Replace the funding import line (`import { computeFunding, tallyIncomeByAccount } ...`) with:
```ts
import { computeFunding, tallyIncomeByAccount } from "../lib/funding.ts";
import { computeAccountHealth, avgMonthlyNetFlow } from "../lib/health/index.ts";
import { monthOf } from "../lib/budget.ts";
```
(If `monthOf` is already imported in this file, don't duplicate it.)

- [ ] **Step 2: Replace the `/accounts/funding` handler with `/accounts/health`**

Find the `accountsRouter.get("/accounts/funding", ...)` handler and replace the whole handler with:

```ts
// Per-account health: a verdict (green/amber/red) backed by composable checks
// (runway, cashflow, overdraft, trend), each with a reason + recommendation.
// Computation lives in server/lib/health/. Powers the chip ring + health panel.
accountsRouter.get("/accounts/health", async (_req, res, next) => {
  try {
    const today = new Date();
    const sums = await manualTxnSums();
    const rows = await db.account.findMany({ where: { source: { in: ["BANK", "MANUAL"] } }, include: { balances: true } });
    const accounts = rows.map((a) => ({
      id: a.id,
      name: displayName(a),
      informational: a.informational,
      balance: currentBalance(
        a.source,
        a.manualBalance != null ? Number(a.manualBalance.toString()) : null,
        a.balances.map((b) => ({ type: b.type, amount: Number(b.amount.toString()) })),
        a.balanceType,
        sums.get(a.id) ?? 0,
      ),
    }));

    const scheds = await db.recurringSchedule.findMany({ where: { status: { not: "ignored" } } });
    const fundingSchedules = scheds.map((s) => ({
      accountId: s.accountId,
      direction: s.direction === "in" ? ("in" as const) : ("out" as const),
      amount: Number(s.amount.toString()),
      cadence: s.cadence,
      dayOfMonth: s.dayOfMonth,
      nextDue: s.nextDue,
    }));

    const ym = today.toISOString().slice(0, 7); // matches /upcoming; prod runs UTC
    const credits = (await db.transaction.findMany({
      where: { amount: { gt: 0 }, bookingDate: { startsWith: ym } },
      select: { amount: true, category: true, categoryOverride: true, accountId: true },
    }))
      .filter((t) => effectiveCategory(t) === "income")
      .map((t) => ({ amount: Number(t.amount.toString()), accountId: t.accountId }));
    const income = tallyIncomeByAccount(credits);

    // Trailing 3 complete months of signed flow per account (transfers included).
    const cutoff = new Date(today.getFullYear(), today.getMonth() - 3, 1).toISOString().slice(0, 10);
    const flowTxns = await db.transaction.findMany({
      where: { bookingDate: { gte: cutoff } },
      select: { accountId: true, amount: true, bookingDate: true },
    });
    const byAccount = new Map<string, { amount: number; month: string | null }[]>();
    for (const t of flowTxns) {
      const arr = byAccount.get(t.accountId) ?? [];
      arr.push({ amount: Number(t.amount.toString()), month: monthOf(t.bookingDate) });
      byAccount.set(t.accountId, arr);
    }
    const netFlowByAccount = new Map(accounts.map((a) => [a.id, avgMonthlyNetFlow(byAccount.get(a.id) ?? [], today)]));

    const fundingByAccount = new Map(
      computeFunding(accounts.map((a) => ({ id: a.id, currentBalance: a.balance })), fundingSchedules, income, today)
        .map((f) => [f.accountId, f]),
    );

    const health: AccountHealthDTO[] = computeAccountHealth({
      today, accounts, schedules: fundingSchedules, income, netFlowByAccount, fundingByAccount,
    });
    res.json(health);
  } catch (err) {
    next(err);
  }
});
```

Note: `db`, `displayName`, `currentBalance`, `manualTxnSums`, `effectiveCategory` are already imported at the top of this file. `monthOf` is added in Step 1.

- [ ] **Step 3: Verify it compiles + endpoint responds**

Run: `eval "$(/opt/homebrew/bin/brew shellenv)"; eval "$(fnm env)"; pnpm tsc --noEmit -p tsconfig.json`
Expected: no errors.
Then, if a dev server is up: `curl -s localhost:5173/api/accounts/health | head -c 500` → a JSON array of `{accountId, verdict, color, headline, checks, ring}`. If the server isn't running, rely on tsc.

---

## Task 7: Web API method

**Files:**
- Modify: `web/src/api.ts` (type import line 7; replace `accountsFunding`)

- [ ] **Step 1: Swap the type import**

In `web/src/api.ts` line 7, replace `AccountFundingDTO` with `AccountHealthDTO` in the import list.

- [ ] **Step 2: Replace the method**

Replace the `accountsFunding: () => get<AccountFundingDTO[]>("/api/accounts/funding"),` line with:
```ts
  accountsHealth: () => get<AccountHealthDTO[]>("/api/accounts/health"),
```

- [ ] **Step 3: Verify**

Run: `eval "$(/opt/homebrew/bin/brew shellenv)"; eval "$(fnm env)"; pnpm tsc --noEmit -p tsconfig.json`
Expected: no errors. (If tsc flags `AccountFundingDTO` still imported anywhere, it's the strip — fixed in Task 10. Proceed; tsc may error until Task 10. If so, note it and continue — the final build in Task 10 must be clean.)

---

## Task 8: `HealthRing` (ring colored by verdict)

**Files:**
- Create: `web/src/components/HealthRing.tsx`
- Delete: `web/src/components/FundingRing.tsx`
- Modify: `web/src/styles.css` (replace the `.funding-ring` block)

- [ ] **Step 1: Create `HealthRing.tsx`**

Create `web/src/components/HealthRing.tsx`:

```tsx
import type { AccountHealthDTO } from "../../../shared/types.ts";

// Health ring overlaid on an account avatar. Color = verdict (green/amber/red).
// A healthy account shows a full ring; amber/red fill to the runway coverage so
// the unfilled remainder reads as the gap. The incoming arc continues from the
// solid one (the paycheck closing a shortfall).
export function HealthRing({ health, size = 56 }: { health?: AccountHealthDTO; size?: number }) {
  if (!health) return null;
  const stroke = 2.5;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const solid = health.verdict === "ok" ? 1 : Math.max(0, Math.min(1, health.ring.solidFraction));
  const dashed = Math.max(0, Math.min(1 - solid, health.ring.dashedFraction));
  const center = size / 2;
  const rot = `rotate(-90 ${center} ${center})`;
  return (
    <svg className={`health-ring ${health.color}`} width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <circle className="track" cx={center} cy={center} r={r} fill="none" strokeWidth={stroke} />
      {dashed > 0 && (
        <circle className="incoming" cx={center} cy={center} r={r} fill="none" strokeWidth={stroke}
          strokeDasharray={`${dashed * c} ${c}`} strokeDashoffset={-solid * c} transform={rot} strokeLinecap="round" />
      )}
      {solid > 0 && (
        <circle className="solid" cx={center} cy={center} r={r} fill="none" strokeWidth={stroke}
          strokeDasharray={`${solid * c} ${c}`} transform={rot} strokeLinecap="round" />
      )}
    </svg>
  );
}
```

- [ ] **Step 2: Delete the old component**

Run: `rm web/src/components/FundingRing.tsx`

- [ ] **Step 3: Replace the CSS**

In `web/src/styles.css`, replace the entire `.funding-ring` block (the comment line `/* Funding ring overlaid ... */` through the `.funding-ring.short .track` rule) with:

```css
/* Health ring overlaid on an account avatar (see HealthRing.tsx). Color by verdict. */
.health-ring { position: absolute; inset: 0; pointer-events: none; }
.health-ring .track { stroke: color-mix(in srgb, var(--line-strong) 70%, transparent); }
.health-ring .solid { transition: stroke-dasharray 0.45s cubic-bezier(0.2, 0.8, 0.2, 1); }
.health-ring.green .solid, .health-ring.green .incoming { stroke: var(--jade); }
.health-ring.amber .solid, .health-ring.amber .incoming { stroke: var(--gold); }
.health-ring.red .solid, .health-ring.red .incoming { stroke: var(--coral); }
.health-ring .incoming { opacity: 0.4; }
/* Tint the track by verdict so an empty arc (e.g. overdrawn, 0 coverage) still reads. */
.health-ring.amber .track { stroke: color-mix(in srgb, var(--gold) 35%, transparent); }
.health-ring.red .track { stroke: color-mix(in srgb, var(--coral) 45%, transparent); }
```

- [ ] **Step 4: Verify build (note: AccountsStrip still references FundingRing until Task 10)**

Run: `eval "$(/opt/homebrew/bin/brew shellenv)"; eval "$(fnm env)"; pnpm tsc --noEmit -p tsconfig.json`
Expected: tsc errors ONLY about `FundingRing`/`accountsFunding` in `AccountsStrip.tsx` (fixed next task). No other errors. If errors mention other files, fix them before proceeding.

---

## Task 9: `AccountHealthPanel` drawer

**Files:**
- Create: `web/src/components/AccountHealthPanel.tsx`
- Modify: `web/src/styles.css` (add panel styles after the health-ring block)

- [ ] **Step 1: Create the panel**

Create `web/src/components/AccountHealthPanel.tsx`:

```tsx
import { useEffect } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import type { AccountHealthDTO } from "../../../shared/types.ts";

// A drawer (portalled to document.body, per the transformed-ancestor overlay
// gotcha) showing an account's health verdict, the reasons, and recommendations.
export function AccountHealthPanel({ name, health, viewTxnsTo, onClose }: {
  name: string;
  health: AccountHealthDTO;
  viewTxnsTo: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer health-panel" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <span className="sheet-title">{name}</span>
          <button className="btn-sm" onClick={onClose}>Close</button>
        </div>
        <div className="drawer-body">
          <div className={`health-verdict ${health.color}`}>
            <span className="health-dot" />
            {health.headline}
          </div>
          <ul className="health-checks">
            {health.checks.map((c) => (
              <li key={c.key} className={`health-check ${c.severity}`}>
                <span className="health-check-title">{c.title}</span>
                <span className="health-check-why">{c.why}</span>
                {c.recommendation && <span className="health-check-rec">{c.recommendation}</span>}
              </li>
            ))}
          </ul>
          <Link className="btn-sm health-view-txns" to={viewTxnsTo} onClick={onClose}>View transactions</Link>
        </div>
      </aside>
    </div>,
    document.body,
  );
}
```

- [ ] **Step 2: Add panel styles**

In `web/src/styles.css`, after the health-ring block, add:

```css
/* Account health panel (drawer) */
.health-verdict { display: flex; align-items: center; gap: 8px; font-size: 18px; font-weight: 680; margin-bottom: 16px; }
.health-verdict .health-dot { width: 10px; height: 10px; border-radius: 50%; }
.health-verdict.green { color: var(--jade); } .health-verdict.green .health-dot { background: var(--jade); }
.health-verdict.amber { color: var(--gold); } .health-verdict.amber .health-dot { background: var(--gold); }
.health-verdict.red { color: var(--coral); } .health-verdict.red .health-dot { background: var(--coral); }
.health-checks { list-style: none; padding: 0; margin: 0 0 18px; display: flex; flex-direction: column; gap: 12px; }
.health-check { display: flex; flex-direction: column; gap: 3px; padding: 12px 14px; border-radius: 12px; background: var(--surface-2); border: 1px solid var(--line); border-left: 3px solid var(--line-strong); }
.health-check.attention { border-left-color: var(--gold); }
.health-check.urgent { border-left-color: var(--coral); }
.health-check.ok { border-left-color: var(--jade); }
.health-check-title { font-size: 11px; font-weight: 640; text-transform: uppercase; letter-spacing: 0.08em; color: var(--ink-3); }
.health-check-why { font-size: 14px; color: var(--ink); }
.health-check-rec { font-size: 13px; color: var(--jade); font-weight: 560; }
.health-view-txns { align-self: flex-start; }
```

- [ ] **Step 3: Verify it compiles**

Run: `eval "$(/opt/homebrew/bin/brew shellenv)"; eval "$(fnm env)"; pnpm tsc --noEmit -p tsconfig.json`
Expected: same FundingRing/accountsFunding errors in AccountsStrip only (fixed next task); no errors in the new panel.

---

## Task 10: Wire `AccountsStrip` — ring by verdict + tap-to-panel

**Files:**
- Modify: `web/src/components/AccountsStrip.tsx`

- [ ] **Step 1: Update imports + state + query**

In `web/src/components/AccountsStrip.tsx`:

Replace the `FundingRing` import with the new components and add `useState`:
```ts
import { useMemo, useState } from "react";
import { HealthRing } from "./HealthRing.tsx";
import { AccountHealthPanel } from "./AccountHealthPanel.tsx";
```
(Keep the existing react-router and other imports. `useMemo` is already imported — merge, don't duplicate.)

Replace the funding query + `fundingByAcct` map with a health query + map, and add panel state. Where the component currently has:
```tsx
  const { data: funding } = useQuery({ queryKey: ["accounts-funding"], queryFn: () => api.accountsFunding() });
  const fundingByAcct = useMemo(
    () => new Map((funding ?? []).map((f) => [f.accountId, f])),
    [funding],
  );
```
replace with:
```tsx
  const { data: health } = useQuery({ queryKey: ["accounts-health"], queryFn: () => api.accountsHealth() });
  const healthByAcct = useMemo(
    () => new Map((health ?? []).map((h) => [h.accountId, h])),
    [health],
  );
  const [openId, setOpenId] = useState<string | null>(null);
```

- [ ] **Step 2: Make account chips open the panel instead of navigating**

Replace the per-account `<Link to={to(a.id)} ...>` element (the `accounts.map(...)` chip) with a `<button>` that opens the panel, and render the `HealthRing`:

```tsx
      {accounts.map(({ bank, a }) => {
        const isCash = a.source === "MANUAL";
        const name = isCash ? a.displayName : bank.institutionName;
        return (
          <button
            key={a.id}
            type="button"
            onClick={() => setOpenId(a.id)}
            className={`acct-chip${activeId === a.id ? " active" : ""}`}
            role="listitem"
          >
            <span className="acct-chip-ico">
              {isCash
                ? <span className="acct-chip-cash"><Wallet size={18} strokeWidth={2} /></span>
                : <BrandLogo name={bank.institutionName} src={bank.institutionLogo} size={44} />}
              <HealthRing health={healthByAcct.get(a.id)} />
            </span>
            <span className={`acct-chip-val num${a.currentBalance < 0 ? " neg" : ""}`}>{formatCcy(a.currentBalance, a.currency)}</span>
            <span className="acct-chip-name" title={name}>{name}</span>
          </button>
        );
      })}
```

The net-worth chip and "Add account" chip stay as `<Link>` (unchanged). Keep the existing `to()` helper — it's still used by the net-worth chip and now by the panel's "View transactions" link.

- [ ] **Step 3: Render the panel**

Just before the final closing `</div>` of the strip wrapper (after the `</div>` that closes `.acct-strip`, inside `.acct-strip-wrap`), add:

```tsx
      {openId && healthByAcct.get(openId) && (() => {
        const found = accounts.find(({ a }) => a.id === openId);
        const acct = found?.a;
        const label = acct ? (acct.source === "MANUAL" ? acct.displayName : found!.bank.institutionName) : "";
        return (
          <AccountHealthPanel
            name={label}
            health={healthByAcct.get(openId)!}
            viewTxnsTo={`/transactions${to(openId)}`}
            onClose={() => setOpenId(null)}
          />
        );
      })()}
```

- [ ] **Step 4: Make the chip button look like the old link**

Account chips are now `<button>` not `<a>`. In `web/src/styles.css`, find the `.acct-chip` rule and ensure it resets button styling. Add these declarations to the existing `.acct-chip` selector (or add a new rule immediately after it):
```css
.acct-chip { background: none; border: none; font: inherit; cursor: pointer; }
```
(Append to the existing `.acct-chip { ... }` block — do not remove its current flex/width/color declarations.)

- [ ] **Step 5: Full verification**

Run: `eval "$(/opt/homebrew/bin/brew shellenv)"; eval "$(fnm env)"; pnpm tsc --noEmit -p tsconfig.json && pnpm exec vite build`
Expected: tsc clean (the FundingRing/accountsFunding references are now gone), build succeeds.

- [ ] **Step 6: Visual check (manual)**

With the dev server up, open `/`: account avatars show a green/amber/red ring by verdict (healthy = full green); tapping a chip opens the health panel with verdict, reason rows, and recommendations; "View transactions" navigates to `/transactions?account=…`. Check mobile (390px) — panel is full-height and the earlier strip alignment still holds.

---

## Task 11: Final verification + commit (gated on user go-ahead)

**Files:** none

- [ ] **Step 1: Full server suite**

Run: `eval "$(/opt/homebrew/bin/brew shellenv)"; eval "$(fnm env)"; pnpm test`
Expected: all PASS (health + funding + everything).

- [ ] **Step 2: Final type + build check**

Run: `eval "$(/opt/homebrew/bin/brew shellenv)"; eval "$(fnm env)"; pnpm tsc --noEmit -p tsconfig.json && pnpm exec vite build`
Expected: clean tsc, successful build.

- [ ] **Step 3: Commit — ONLY after the user says to**

Confirm with the user, then stage the health files plus the folded-in funding files:
```bash
git add shared/types.ts server/lib/funding.ts server/lib/funding.test.ts server/lib/health \
  server/routes/recurring.ts server/routes/accounts.ts web/src/api.ts \
  web/src/components/HealthRing.tsx web/src/components/AccountHealthPanel.tsx \
  web/src/components/AccountsStrip.tsx web/src/styles.css \
  docs/superpowers/specs/2026-06-16-account-funding-rings-design.md \
  docs/superpowers/specs/2026-06-16-account-health-design.md \
  docs/superpowers/plans/2026-06-16-account-funding-rings.md \
  docs/superpowers/plans/2026-06-16-account-health.md
git rm web/src/components/FundingRing.tsx
git commit -m "Account health: per-account verdict + checks (runway/cashflow/overdraft/trend) with cross-account recommendations and a tap-to-open health panel

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```
Push only if the user asks, over SSH port 443:
`git push ssh://git@ssh.github.com:443/pixeldesignuk/personal-finance.git main`

---

## Self-Review

**Spec coverage:**
- Health = set of checks, each `severity + why + recommendation` → Task 1 DTO + Tasks 4–5. ✓
- Verdict = worst severity → color/headline → Task 5 aggregation. ✓
- Runway check (reuses funding) → Task 4 `runway.ts`. ✓
- Structural cashflow (net flow incl. transfers, trailing 3 complete months) → Task 2 `avgMonthlyNetFlow` + Task 4 `cashflow.ts`. ✓
- Overdraft/buffer (default £0 cushion = overdraft only) → Task 4 `buffer.ts`. ✓
- Balance trend (months-to-zero from net flow, shares computation) → Task 4 `trend.ts`. ✓
- Cross-account recommendations via free-cash source picker → Task 3 `recommend.ts`. ✓
- `GET /api/accounts/health` replaces `/funding` → Task 6. ✓
- Ring colored by verdict, healthy = full → Task 8 `HealthRing`. ✓
- Tap → health panel (portalled), positive panel for healthy, "View transactions" absorbs old filter → Tasks 9–10. ✓
- Funding folds in (kept as runway), no separate funding commit → Task 11 stages both. ✓
- Spec open-decisions honored: cushion £0 (buffer deferred branch omitted, YAGNI), net-flow 3 complete months, structural+trend share `netFlowByAccount` and can both surface, one-tap action deferred (recommendations textual), spendable = BANK+MANUAL. ✓

**Placeholder scan:** none — every code step is complete; commands have expected output.

**Type consistency:** `AccountHealthDTO`/`HealthCheckResultDTO`/`HealthSeverity`/`HealthCheckKey` defined in Task 1 and used identically across the engine (Tasks 4–5), route (Task 6), API (Task 7), and components (Tasks 8–10). `HealthContext`/`HealthAccount`/`HealthCheck`/`Source` defined in Task 3 and consumed consistently. `computeAccountHealth` returns `AccountHealthDTO[]` everywhere. `avgMonthlyNetFlow` signature matches between Task 2 and its use in Task 6. The runway check reads `committed/balance/incomeIncoming/solidFraction/dashedFraction` from `AccountFundingDTO` (the existing, unchanged shape returned by `computeFunding`).
