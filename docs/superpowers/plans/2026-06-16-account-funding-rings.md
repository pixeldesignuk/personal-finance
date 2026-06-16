# Account Funding Rings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the avatar ring on each dashboard account chip into a funding gauge — a jade arc for "balance covers committed bills before next payday," plus a translucent arc on the income-receiving account showing the paycheck closing any gap.

**Architecture:** A pure, unit-tested `computeFunding` (server/lib/funding.ts) takes account balances, recurring schedules, and this-month income-received, and returns one `AccountFundingDTO` per account. A new `GET /api/accounts/funding` endpoint does the DB I/O and calls it. The strip queries that endpoint and overlays a 2-arc SVG `FundingRing` on each account avatar.

**Tech Stack:** TypeScript, Express 5, Prisma v6, React 19, `@tanstack/react-query`, `node:test` + `tsx`. Spec: `docs/superpowers/specs/2026-06-16-account-funding-rings-design.md`.

**Conventions (read before starting):**
- Node env for every command: `eval "$(/opt/homebrew/bin/brew shellenv)"; eval "$(fnm env)"` then **pnpm** (never npm).
- After code changes run **`pnpm tsc --noEmit -p tsconfig.json`** and **`pnpm exec vite build`**. `tsconfig` has `noUnusedLocals` — remove unused imports/vars or tsc fails.
- Server tests: `node --test --import tsx server/lib/<file>.test.ts`.
- **This repo commits to `main` only when the user asks.** Do per-task verification (tsc/build/tests) but DO NOT commit after each task. There is a single commit task at the end, gated on the user's go-ahead.

---

## File Structure

| File | Responsibility | Change |
|------|----------------|--------|
| `shared/types.ts` | DTO shared by server + web | Add `FundingState`, `AccountFundingDTO` |
| `server/lib/funding.ts` | Pure funding math + income tally | **Create** |
| `server/lib/funding.test.ts` | Unit tests for the above | **Create** |
| `server/routes/recurring.ts` | `/upcoming` income logic | Refactor income tally to reuse `tallyIncomeByAccount` (DRY) |
| `server/routes/accounts.ts` | Account endpoints | Add `GET /api/accounts/funding` |
| `web/src/api.ts` | Typed API client | Add `accountsFunding()` |
| `web/src/components/FundingRing.tsx` | 2-arc SVG ring overlay | **Create** |
| `web/src/components/AccountsStrip.tsx` | Account chips | Query funding, overlay ring per chip |
| `web/src/styles.css` | Ring arc colors/positioning | Add `.funding-ring` rules |

---

## Task 1: Add the DTO types

**Files:**
- Modify: `shared/types.ts` (near the existing `AccountRecurringDTO`, around line 206–211)

- [ ] **Step 1: Add the types**

In `shared/types.ts`, add this block immediately after the `AccountRecurringDTO` interface (around line 211):

```ts
// Funding gauge for an account chip: is the balance covering the bills committed
// to this account before the next payday, and (for the income account) does the
// incoming paycheck close any gap. See docs/superpowers/specs/2026-06-16-account-funding-rings-design.md
export type FundingState = "none" | "funded" | "partial" | "short" | "rescued" | "overdue";

export interface AccountFundingDTO {
  accountId: string;
  committed: number;       // bills due in the window (today..nextPayday) attributed to this account
  balance: number;         // currentBalance snapshot used
  solidFraction: number;   // 0..1 — balance coverage (the solid arc)
  dashedFraction: number;  // 0..1 — incoming-income top-up (the translucent arc); 0 if not income account / no shortfall
  incomeIncoming: number;  // expected paycheck for this account at nextPayday (0 once it has landed)
  isIncomeAccount: boolean;
  state: FundingState;
  windowDays: number;      // days in the funding window (today..nextPayday), or 30 fallback
}
```

- [ ] **Step 2: Verify it compiles**

Run: `eval "$(/opt/homebrew/bin/brew shellenv)"; eval "$(fnm env)"; pnpm tsc --noEmit -p tsconfig.json`
Expected: no errors (a type-only addition).

---

## Task 2: Income tally helper (`tallyIncomeByAccount`) + DRY the `/upcoming` route

This extracts the per-account income tally currently inline in `/upcoming` (recurring.ts:145–153) into a pure, tested helper reused by both routes.

**Files:**
- Create: `server/lib/funding.ts`
- Create: `server/lib/funding.test.ts`
- Modify: `server/routes/recurring.ts:145-153`

- [ ] **Step 1: Write the failing test**

Create `server/lib/funding.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { tallyIncomeByAccount } from "./funding.ts";

test("tallyIncomeByAccount: sums totals and tracks max per account", () => {
  const got = tallyIncomeByAccount([
    { amount: 1000, accountId: "a" },
    { amount: 50, accountId: "a" },
    { amount: 200, accountId: "b" },
  ]);
  assert.deepEqual(got.byAccount.get("a"), { total: 1050, max: 1000 });
  assert.deepEqual(got.byAccount.get("b"), { total: 200, max: 200 });
  assert.equal(got.totalAll, 1250);
  assert.equal(got.maxAll, 1000);
});

test("tallyIncomeByAccount: empty input", () => {
  const got = tallyIncomeByAccount([]);
  assert.equal(got.byAccount.size, 0);
  assert.equal(got.totalAll, 0);
  assert.equal(got.maxAll, 0);
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `eval "$(/opt/homebrew/bin/brew shellenv)"; eval "$(fnm env)"; node --test --import tsx server/lib/funding.test.ts`
Expected: FAIL — cannot find module `./funding.ts` (not created yet).

- [ ] **Step 3: Create `server/lib/funding.ts` with the helper**

Create `server/lib/funding.ts`:

```ts
// Pure funding-gauge math for account chips — no I/O, unit-tested.
import { incomeOccurrences, occurrencesWithin } from "./recurring.ts";
import type { AccountFundingDTO } from "../../shared/types.ts";

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const r2 = (n: number) => Math.round(n * 100) / 100;

export interface IncomeReceived {
  byAccount: Map<string, { total: number; max: number }>;
  totalAll: number;
  maxAll: number;
}

// Tally this-month income credits into per-account {total, max} plus all-account
// totals. `max` (the single largest credit) lets callers tell a salary-sized
// payment from a small one-off. Mirrors the inline tally /upcoming used to do.
export function tallyIncomeByAccount(credits: { amount: number; accountId: string }[]): IncomeReceived {
  const byAccount = new Map<string, { total: number; max: number }>();
  let totalAll = 0;
  let maxAll = 0;
  for (const c of credits) {
    const e = byAccount.get(c.accountId) ?? { total: 0, max: 0 };
    e.total += c.amount;
    e.max = Math.max(e.max, c.amount);
    byAccount.set(c.accountId, e);
    totalAll += c.amount;
    maxAll = Math.max(maxAll, c.amount);
  }
  return { byAccount, totalAll, maxAll };
}

// A recurring payment has "arrived" if a salary-sized credit landed (>=60% of the
// typical amount) OR the source's month income already covers it. Matches the
// rule used in /upcoming so projection and funding agree.
const hasArrived = (amount: number, got: { total: number; max: number }) =>
  got.max >= 0.6 * amount || got.total >= amount - 0.005;
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `eval "$(/opt/homebrew/bin/brew shellenv)"; eval "$(fnm env)"; node --test --import tsx server/lib/funding.test.ts`
Expected: PASS (2 tests). `hasArrived` is unused for now — it is used in Task 3; tsc isn't run yet so `noUnusedLocals` won't trip here, but DO NOT run `pnpm tsc` until after Task 3 adds its consumer.

- [ ] **Step 5: DRY `/upcoming` to use the helper**

In `server/routes/recurring.ts`:

Add to the import on line 9 (or a new import line near it):
```ts
import { tallyIncomeByAccount } from "../lib/funding.ts";
```

Replace lines 145–153 (the block that starts `const incomeByAccount = new Map<...` and ends with the `maxAll` reduce) with:

```ts
    const { byAccount: incomeByAccount, totalAll, maxAll } = tallyIncomeByAccount(
      monthCredits.map((t) => ({ amount: num(t.amount), accountId: t.accountId })),
    );
```

Leave lines 143–144 (`const monthCredits = ...filter(income)`) and the rest of the loop (which reads `incomeByAccount`, `totalAll`, `maxAll`) unchanged.

- [ ] **Step 6: Verify the refactor compiles and tests still pass**

Run: `eval "$(/opt/homebrew/bin/brew shellenv)"; eval "$(fnm env)"; pnpm tsc --noEmit -p tsconfig.json && node --test --import tsx server/lib/recurring.test.ts`
Expected: tsc clean; recurring tests PASS (the refactor is behavior-preserving).

---

## Task 3: Core funding math (`computeFunding`)

**Files:**
- Modify: `server/lib/funding.ts`
- Modify: `server/lib/funding.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `server/lib/funding.test.ts`:

```ts
import { computeFunding, type FundingSchedule } from "./funding.ts";

const TODAY = new Date(2026, 5, 16); // 16 Jun 2026 (local)
const noIncome = tallyIncomeByAccount([]);
// An unattributed paycheck on the 28th, not yet received → nextPayday = 28 Jun,
// so the funding window is 16→28 Jun (12 days). Used to pin the window in tests
// that aren't themselves about the income account.
const paydayAnchor: FundingSchedule = { accountId: null, direction: "in", amount: 1200, cadence: "monthly", dayOfMonth: 28, nextDue: null };
const billJun20 = (accountId: string, amount: number, cadence = "monthly"): FundingSchedule =>
  ({ accountId, direction: "out", amount, cadence, dayOfMonth: 20, nextDue: new Date(2026, 5, 20) });

test("computeFunding: no committed bills → state none", () => {
  const [f] = computeFunding([{ id: "a", currentBalance: 100 }], [paydayAnchor], noIncome, TODAY);
  assert.equal(f.state, "none");
  assert.equal(f.committed, 0);
  assert.equal(f.solidFraction, 0);
});

test("computeFunding: balance covers committed → funded", () => {
  const [f] = computeFunding([{ id: "a", currentBalance: 100 }], [paydayAnchor, billJun20("a", 50)], noIncome, TODAY);
  assert.equal(f.committed, 50);
  assert.equal(f.windowDays, 12);
  assert.equal(f.state, "funded");
  assert.equal(f.solidFraction, 1);
});

test("computeFunding: balance partially covers → partial", () => {
  const [f] = computeFunding([{ id: "a", currentBalance: 30 }], [paydayAnchor, billJun20("a", 50)], noIncome, TODAY);
  assert.equal(f.state, "partial");
  assert.equal(f.solidFraction, 0.6);
  assert.equal(f.dashedFraction, 0);
});

test("computeFunding: income account short now but payday closes the gap → rescued", () => {
  const inB: FundingSchedule = { accountId: "b", direction: "in", amount: 1200, cadence: "monthly", dayOfMonth: 28, nextDue: null };
  const [f] = computeFunding([{ id: "b", currentBalance: 200 }], [inB, billJun20("b", 800)], noIncome, TODAY);
  assert.equal(f.isIncomeAccount, true);
  assert.equal(f.committed, 800);
  assert.equal(f.solidFraction, 0.25);
  assert.equal(f.dashedFraction, 0.75);
  assert.equal(f.incomeIncoming, 1200);
  assert.equal(f.state, "rescued");
});

test("computeFunding: income account short even with payday → short", () => {
  const inB: FundingSchedule = { accountId: "b", direction: "in", amount: 500, cadence: "monthly", dayOfMonth: 28, nextDue: null };
  const [f] = computeFunding([{ id: "b", currentBalance: 100 }], [inB, billJun20("b", 800)], noIncome, TODAY);
  assert.equal(f.solidFraction, 0.125);
  assert.equal(f.dashedFraction, 0.625);
  assert.equal(f.state, "short");
});

test("computeFunding: income already arrived this month → no dashed arc, balance-only state", () => {
  const inB: FundingSchedule = { accountId: "b", direction: "in", amount: 1200, cadence: "monthly", dayOfMonth: 28, nextDue: null };
  const arrived = tallyIncomeByAccount([{ amount: 1200, accountId: "b" }]); // salary landed
  const [f] = computeFunding([{ id: "b", currentBalance: 200 }], [inB, billJun20("b", 800)], arrived, TODAY);
  assert.equal(f.incomeIncoming, 0);
  assert.equal(f.dashedFraction, 0);
  assert.equal(f.state, "short"); // 200 of 800, no pending paycheck
});

test("computeFunding: no income schedule → 30-day window, no dashed arc", () => {
  const [f] = computeFunding([{ id: "a", currentBalance: 100 }], [billJun20("a", 50)], noIncome, TODAY);
  assert.equal(f.windowDays, 30);
  assert.equal(f.isIncomeAccount, false);
  assert.equal(f.committed, 50); // only 20 Jun falls in 16 Jun + 30d
  assert.equal(f.state, "funded");
});

test("computeFunding: yearly bill outside the window is not counted", () => {
  const dec: FundingSchedule = { accountId: "a", direction: "out", amount: 600, cadence: "yearly", dayOfMonth: 20, nextDue: new Date(2026, 11, 20) };
  const [f] = computeFunding([{ id: "a", currentBalance: 100 }], [paydayAnchor, dec], noIncome, TODAY);
  assert.equal(f.committed, 0);
  assert.equal(f.state, "none");
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `eval "$(/opt/homebrew/bin/brew shellenv)"; eval "$(fnm env)"; node --test --import tsx server/lib/funding.test.ts`
Expected: FAIL — `computeFunding` / `FundingSchedule` not exported.

- [ ] **Step 3: Implement `computeFunding`**

Append to `server/lib/funding.ts`:

```ts
export interface FundingSchedule {
  accountId: string | null;
  direction: "in" | "out";
  amount: number;
  cadence: string;
  dayOfMonth: number | null;
  nextDue: Date | null;
}
export interface FundingAccount {
  id: string;
  currentBalance: number;
}

// One funding gauge per account. Window = today..nextPayday (earliest upcoming
// income occurrence across all income schedules; 30-day fallback if none).
export function computeFunding(
  accounts: FundingAccount[],
  schedules: FundingSchedule[],
  income: IncomeReceived,
  today: Date,
): AccountFundingDTO[] {
  const inScheds = schedules.filter((s) => s.direction === "in");
  const outScheds = schedules.filter((s) => s.direction === "out" && s.nextDue);

  // Resolve "has this paycheck arrived?" once per income schedule (reused for the
  // window and for each account's incoming amount).
  const inInfo = inScheds.map((s) => {
    const got = s.accountId
      ? income.byAccount.get(s.accountId) ?? { total: 0, max: 0 }
      : { total: income.totalAll, max: income.maxAll };
    return { s, arrived: hasArrived(s.amount, got) };
  });

  let nextPayday: Date | null = null;
  for (const { s, arrived } of inInfo) {
    const occ = incomeOccurrences(s.dayOfMonth ?? 28, arrived, today, 120)[0];
    if (occ && (!nextPayday || occ < nextPayday)) nextPayday = occ;
  }
  const windowDays = nextPayday
    ? Math.max(0, Math.round((startOfDay(nextPayday).getTime() - startOfDay(today).getTime()) / 86_400_000))
    : 30;

  return accounts.map((a) => {
    let committed = 0;
    for (const s of outScheds) {
      if (s.accountId !== a.id) continue;
      committed += occurrencesWithin(s.nextDue as Date, s.cadence, today, windowDays).length * s.amount;
    }
    committed = r2(committed);
    const balance = r2(a.currentBalance);

    const myIn = inInfo.filter((i) => i.s.accountId === a.id);
    const isIncomeAccount = myIn.length > 0;
    const incomeIncoming = r2(myIn.reduce((sum, i) => sum + (i.arrived ? 0 : i.s.amount), 0));

    const solidFraction = committed > 0 ? clamp01(balance / committed) : 0;
    const shortfall = Math.max(0, committed - balance);
    const dashedCovers = Math.min(incomeIncoming, shortfall);
    const dashedFraction = committed > 0 ? clamp01(dashedCovers / committed) : 0;

    let state: AccountFundingDTO["state"];
    if (committed === 0) state = "none";
    else if (balance >= committed) state = "funded";
    else if (isIncomeAccount && incomeIncoming > 0) state = solidFraction + dashedFraction >= 1 - 1e-9 ? "rescued" : "short";
    else state = balance > 0 ? "partial" : "short";

    return { accountId: a.id, committed, balance, solidFraction, dashedFraction, incomeIncoming, isIncomeAccount, state, windowDays };
  });
}
```

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `eval "$(/opt/homebrew/bin/brew shellenv)"; eval "$(fnm env)"; node --test --import tsx server/lib/funding.test.ts`
Expected: PASS (all 10 tests).

- [ ] **Step 5: Verify tsc is clean (now that `hasArrived` has a consumer)**

Run: `eval "$(/opt/homebrew/bin/brew shellenv)"; eval "$(fnm env)"; pnpm tsc --noEmit -p tsconfig.json`
Expected: no errors.

---

## Task 4: `GET /api/accounts/funding` endpoint

**Files:**
- Modify: `server/routes/accounts.ts` (imports at top; new handler after the `/accounts/recurring` handler ~line 173)

- [ ] **Step 1: Add imports**

In `server/routes/accounts.ts`, extend the type import on line 14 to include the funding DTO:
```ts
import type { AccountDTO, BankDTO, AccountRecurringDTO, AccountFundingDTO } from "../../shared/types.ts";
```
Add a new import line after line 14:
```ts
import { computeFunding, tallyIncomeByAccount } from "../lib/funding.ts";
```

- [ ] **Step 2: Add the handler**

Insert after the `/accounts/recurring` handler closes (after line 173, before `accountsRouter.post("/accounts/manual" ...)`):

```ts
// Per-account funding gauge: balance vs bills committed to the account before the
// next payday, plus the incoming paycheck for the income account. Powers the ring
// on each dashboard account chip. Computation lives in server/lib/funding.ts.
accountsRouter.get("/accounts/funding", async (_req, res, next) => {
  try {
    const today = new Date();
    const sums = await manualTxnSums();
    // Same set the strip rings: spendable bank + cash accounts (not investments/assets/debts).
    const rows = await db.account.findMany({ where: { source: { in: ["BANK", "MANUAL"] } }, include: { balances: true } });
    const accounts = rows.map((a) => ({
      id: a.id,
      currentBalance: currentBalance(
        a.source,
        a.manualBalance != null ? Number(a.manualBalance.toString()) : null,
        a.balances.map((b) => ({ type: b.type, amount: Number(b.amount.toString()) })),
        a.balanceType,
        sums.get(a.id) ?? 0,
      ),
    }));

    const scheds = await db.recurringSchedule.findMany({ where: { status: { not: "ignored" } } });
    const ym = today.toISOString().slice(0, 7); // matches /upcoming; prod runs UTC
    const credits = (await db.transaction.findMany({
      where: { amount: { gt: 0 }, bookingDate: { startsWith: ym } },
      select: { amount: true, category: true, categoryOverride: true, accountId: true },
    }))
      .filter((t) => effectiveCategory(t) === "income")
      .map((t) => ({ amount: Number(t.amount.toString()), accountId: t.accountId }));
    const income = tallyIncomeByAccount(credits);

    const funding: AccountFundingDTO[] = computeFunding(
      accounts,
      scheds.map((s) => ({
        accountId: s.accountId,
        direction: s.direction === "in" ? "in" : "out",
        amount: Number(s.amount.toString()),
        cadence: s.cadence,
        dayOfMonth: s.dayOfMonth,
        nextDue: s.nextDue,
      })),
      income,
      today,
    );
    res.json(funding);
  } catch (err) {
    next(err);
  }
});
```

Note: `db`, `currentBalance`, `manualTxnSums`, `effectiveCategory` are already imported at the top of this file — do not re-import them.

- [ ] **Step 3: Verify it compiles**

Run: `eval "$(/opt/homebrew/bin/brew shellenv)"; eval "$(fnm env)"; pnpm tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 4: Smoke-test the endpoint**

With the dev server running (`pnpm dev` or whatever is already up on :5173 / the API port), run:
`curl -s localhost:5173/api/accounts/funding | head -c 400`
Expected: a JSON array of objects with `accountId`, `state`, `solidFraction`, `windowDays`. (No new route registration is needed — `accountsRouter` is already mounted in `server/index.ts:37`.)

---

## Task 5: Web API client method

**Files:**
- Modify: `web/src/api.ts` (import line 7; method near `accountsRecurring` line 59)

- [ ] **Step 1: Add the type import**

In `web/src/api.ts`, add `AccountFundingDTO` to the type import block (line 7 lists `AccountRecurringDTO` — add `AccountFundingDTO` alongside it):
```ts
  PersonDTO, RuleDTO, CategoryNameDTO, ReconcileResult, AuditEvent, InvestmentsDTO, SettingsDTO, DebtsDTO, MerchantsDTO, AccountRecurringDTO, AccountFundingDTO, PotsDTO, PluginsDTO, EmailOrderDTO,
```

- [ ] **Step 2: Add the method**

After line 59 (`accountsRecurring: () => get<AccountRecurringDTO[]>("/api/accounts/recurring"),`) add:
```ts
  accountsFunding: () => get<AccountFundingDTO[]>("/api/accounts/funding"),
```

- [ ] **Step 3: Verify it compiles**

Run: `eval "$(/opt/homebrew/bin/brew shellenv)"; eval "$(fnm env)"; pnpm tsc --noEmit -p tsconfig.json`
Expected: no errors.

---

## Task 6: `FundingRing` SVG component + styles

**Files:**
- Create: `web/src/components/FundingRing.tsx`
- Modify: `web/src/styles.css` (after the `.acct-chip` rules, around line 535)

- [ ] **Step 1: Create the component**

Create `web/src/components/FundingRing.tsx`:

```tsx
import type { AccountFundingDTO } from "../../shared/types.ts";

// Two concentric SVG arcs overlaid on an account avatar. The solid arc is the
// balance's coverage of committed bills (color by state); the translucent arc is
// the incoming paycheck filling the remaining gap on the income account. Rendered
// inside .acct-chip-ico (position: relative); pointer-events disabled.
export function FundingRing({ funding, size = 56 }: { funding?: AccountFundingDTO; size?: number }) {
  if (!funding || funding.state === "none") return null;
  const stroke = 2.5;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const solid = Math.max(0, Math.min(1, funding.solidFraction));
  const dashed = Math.max(0, Math.min(1, funding.dashedFraction));
  const center = size / 2;
  const rot = `rotate(-90 ${center} ${center})`;
  return (
    <svg className={`funding-ring ${funding.state}`} width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <circle className="track" cx={center} cy={center} r={r} fill="none" strokeWidth={stroke} />
      {dashed > 0 && (
        <circle
          className="incoming"
          cx={center} cy={center} r={r} fill="none" strokeWidth={stroke}
          strokeDasharray={`${dashed * c} ${c}`} strokeDashoffset={-solid * c}
          transform={rot} strokeLinecap="round"
        />
      )}
      {solid > 0 && (
        <circle
          className="solid"
          cx={center} cy={center} r={r} fill="none" strokeWidth={stroke}
          strokeDasharray={`${solid * c} ${c}`}
          transform={rot} strokeLinecap="round"
        />
      )}
    </svg>
  );
}
```

- [ ] **Step 2: Add the styles**

In `web/src/styles.css`, after the `@media (max-width: 640px)` strip block (the one ending around line 545 after Task's earlier alignment fix), add:

```css
/* Funding ring overlaid on an account avatar (see FundingRing.tsx) */
.funding-ring { position: absolute; inset: 0; pointer-events: none; }
.funding-ring .track { stroke: color-mix(in srgb, var(--line-strong) 70%, transparent); }
.funding-ring .solid { stroke: var(--jade); transition: stroke-dasharray 0.45s cubic-bezier(0.2, 0.8, 0.2, 1); }
.funding-ring .incoming { stroke: var(--jade); opacity: 0.4; }
.funding-ring.partial .solid, .funding-ring.overdue .solid { stroke: var(--gold); }
.funding-ring.short .solid { stroke: var(--coral); }
.funding-ring.funded .solid, .funding-ring.rescued .solid { stroke: var(--jade); }
```

- [ ] **Step 3: Verify it compiles/builds**

Run: `eval "$(/opt/homebrew/bin/brew shellenv)"; eval "$(fnm env)"; pnpm tsc --noEmit -p tsconfig.json`
Expected: no errors. (`FundingRing` is unused until Task 7 — tsc does not flag unused exports, only unused locals/imports, so this passes.)

---

## Task 7: Wire the ring into `AccountsStrip`

**Files:**
- Modify: `web/src/components/AccountsStrip.tsx`

- [ ] **Step 1: Import the component and add the query**

In `web/src/components/AccountsStrip.tsx`:

Add to the imports (after line 7, `import { BrandLogo } ...`):
```ts
import { FundingRing } from "./FundingRing.tsx";
```

After the `banks` query (line 21), add a funding query and a lookup map. Replace lines 20–32 (the two `useQuery` calls + the `accounts` useMemo) with:

```tsx
  const { data: summary } = useQuery({ queryKey: ["summary"], queryFn: () => api.summary() });
  const { data: banks } = useQuery({ queryKey: ["accounts"], queryFn: () => api.accounts() });
  const { data: funding } = useQuery({ queryKey: ["accounts-funding"], queryFn: () => api.accountsFunding() });

  const fundingByAcct = useMemo(
    () => new Map((funding ?? []).map((f) => [f.accountId, f])),
    [funding],
  );

  const accounts = useMemo(
    () =>
      (banks ?? [])
        .filter((b) => !["INVESTMENT", "ASSET", "LIABILITY"].includes(b.status))
        .flatMap((bank) => bank.accounts.map((a) => ({ bank, a })))
        // Biggest balance by magnitude first — a sizeable credit-card debt is more
        // relevant than a near-zero account, so rank on |balance|, not signed value.
        .sort((x, y) => Math.abs(y.a.currentBalance) - Math.abs(x.a.currentBalance)),
    [banks],
  );
```

- [ ] **Step 2: Render the ring inside each account chip's avatar**

Replace the `<span className="acct-chip-ico">…</span>` block (lines 72–76) with:

```tsx
            <span className="acct-chip-ico">
              {isCash
                ? <span className="acct-chip-cash"><Wallet size={18} strokeWidth={2} /></span>
                : <BrandLogo name={bank.institutionName} src={bank.institutionLogo} size={44} />}
              <FundingRing funding={fundingByAcct.get(a.id)} />
            </span>
```

(Only account chips get a ring; the net-worth lead chip and the "Add account" chip are left untouched.)

- [ ] **Step 3: Verify it compiles and builds**

Run: `eval "$(/opt/homebrew/bin/brew shellenv)"; eval "$(fnm env)"; pnpm tsc --noEmit -p tsconfig.json && pnpm exec vite build`
Expected: tsc clean, build succeeds.

- [ ] **Step 4: Visual check (manual)**

With the dev server up, open `/` and confirm: account avatars now carry a jade/gold/coral arc; an income account with a pending paycheck shows a fainter second arc continuing past the solid one; net-worth and "Add account" chips have no ring. Check both desktop and a 390px-wide mobile viewport — confirm the Task-0 alignment fix still holds (first chip on the gutter, no spill) and the ring sits cleanly on the avatar edge at 56px.

---

## Task 8: Full verification + commit (gated on user go-ahead)

**Files:** none (verification + commit)

- [ ] **Step 1: Run the whole server test suite**

Run: `eval "$(/opt/homebrew/bin/brew shellenv)"; eval "$(fnm env)"; node --test --import tsx server/lib/*.test.ts server/categorise/*.test.ts`
Expected: all PASS (funding + recurring + everything else).

- [ ] **Step 2: Final type + build check**

Run: `eval "$(/opt/homebrew/bin/brew shellenv)"; eval "$(fnm env)"; pnpm tsc --noEmit -p tsconfig.json && pnpm exec vite build`
Expected: clean tsc, successful build.

- [ ] **Step 3: Commit — ONLY after the user says to**

This repo commits to `main` only when asked. Confirm with the user, then:
```bash
git add shared/types.ts server/lib/funding.ts server/lib/funding.test.ts \
  server/routes/recurring.ts server/routes/accounts.ts \
  web/src/api.ts web/src/components/FundingRing.tsx web/src/components/AccountsStrip.tsx web/src/styles.css
git commit -m "Account chips: funding rings (balance vs committed bills before payday, income top-up arc)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```
Push only if the user asks, over SSH port 443:
`git push ssh://git@ssh.github.com:443/pixeldesignuk/personal-finance.git main`

---

## Self-Review

**Spec coverage:**
- Unified "covered until next payday" metaphor → `computeFunding` window + state logic (Task 3). ✓
- Funding window = today→nextPayday, 30-day fallback → Task 3 `windowDays`. ✓
- Per-account committed from account-attributed out-schedules within window → Task 3. ✓
- Current-account single arc (funded/partial/short) → Task 3 state + Task 6 colors. ✓
- Income two-segment ring, "payday rescues the shortfall" → Task 3 `dashedFraction`/`rescued` + Task 6 `.incoming` arc. ✓
- Income never red on its own; arrived → no dashed arc → Task 3 (`incomeIncoming` = 0 when arrived; income branch only yields rescued/short, falls through to balance state otherwise). ✓
- Net worth chip: no gauge → Task 7 (ring only on account chips). ✓
- DTO `AccountFundingDTO` → Task 1. ✓
- Pure, unit-tested `computeFunding`; income tally extracted + reused (DRY) → Tasks 2–3. ✓
- New `GET /api/accounts/funding` → Task 4. ✓
- SVG 2-arc `FundingRing` over the avatar → Tasks 6–7. ✓
- Open decisions honored: null-account bills excluded (Task 3 skips `s.accountId !== a.id`, and null never equals an id); multi-income earliest payday (Task 3 loop); no-income 30-day fallback (Task 3); credit cards as BANK get the standard ring (Task 4 includes BANK); overdue = declared P2 state, not emitted. ✓

**Placeholder scan:** none — every code step shows complete code; every command is concrete with expected output.

**Type consistency:** `AccountFundingDTO` (Task 1) is the single source of truth; `computeFunding` returns `AccountFundingDTO[]` (Task 3) and the route types its result as `AccountFundingDTO[]` (Task 4); `api.accountsFunding()` returns the same (Task 5); `FundingRing` consumes it (Task 6). `FundingSchedule`/`FundingAccount`/`IncomeReceived` are defined in Task 2/3 and used consistently. State strings (`none/funded/partial/short/rescued/overdue`) match across DTO, math, and CSS class selectors.
