# Account Health — Design

**Date:** 2026-06-16
**Status:** Approved (design); ready for implementation plan.
**Supersedes:** the funding-rings feature (`2026-06-16-account-funding-rings-design.md`) — that work
(`computeFunding`, `/api/accounts/funding`, `FundingRing`) is uncommitted and gets folded into this
as the "runway" health check. No separate funding commit; it lands as part of health.

## Problem

The account chips show a balance and (now) a funding ring. We want to reframe this as **account
health**: each spendable account gets a verdict — healthy / needs attention / unhealthy — and when
it's unhealthy, the user can see **why** and **what to do about it**. Examples the user gave: "more
bills going out than income," or "more due before payday than there is money."

North-star: reassurance plus actionable guidance ("you're £120 short before payday — move £120 from
Savings").

## The model

Health is a set of independent **checks**. Each check is a pure function that, for one account,
returns a result (or `null` if it doesn't apply):

```
severity: "ok" | "attention" | "urgent"
title:    short label                       e.g. "Runway to payday"
why:      the diagnosis                      e.g. "£120 short before payday on 28 Jun"
recommendation: the fix (or null)            e.g. "Move £120 from Savings"
```

An account's **verdict = worst severity across its checks**, mapped to a ring color:
`ok → green`, `attention → amber`, `urgent → red`.

### The four checks (all computable from existing data)

1. **Runway to payday** — the funding logic already built. `committed` bills due before the next
   payday vs `balance + incoming income`. Shortfall → `urgent`; covered only by the incoming
   paycheck (rescued) or thin margin → `attention`; comfortably covered → `ok`.

2. **Structural cashflow** — average monthly **net flow** = `sum(credits) − sum(debits)` per
   account over the trailing 3 *complete* calendar months. Uses raw signed amounts (transfers
   included) so a sub-account funded by transfers from your main account is not falsely flagged as
   "all outflow." Fires when `netFlowMonthly < 0` ("£300/mo more goes out than comes in").

3. **Overdrawn / buffer** — `balance < 0` → `urgent`; `balance < cushion` → `attention`. Cushion is
   per-account, **default £0** in v1 (only true overdraft triggers); configurable later.

4. **Balance trend** — `monthsToZero = netFlowMonthly < 0 ? balance / −netFlowMonthly : ∞`. Projects
   "at this rate, £0 by [month]." Shares check 3's `netFlowMonthly`. `< 1 month → urgent`,
   `< 3 months → attention`, else suppressed.

Checks 2 and 4 share `netFlowMonthly` but say different things (rate vs deadline); both may appear as
separate rows when draining. A healthy-flow account (`netFlowMonthly ≥ 0`) shows neither.

## Cross-account recommendations

Recommendations are tailored per check. The prescriptive ones are the **liquidity** checks (runway,
overdraft): for a gap of £X on account A, the engine scans the user's *other* spendable accounts,
computes each one's **free cash** = `balance − its own committed bills before payday`, and recommends
the source with the most headroom: *"Move £X from Savings."* If no single account has £X free, it
proposes the largest partial move + tops up the remainder (*"Move £80 from Savings and top up £40"*).

Structural/trend issues are recurring drains a one-off transfer won't fix, so their recommendation is
different in shape: *"£300/mo more goes out than comes in — move the gym DD to [account with surplus],
or cut [largest discretionary category]."*

A `pickSource(context, accountId, amount)` helper centralises source selection (prefer
informational/savings accounts, then current accounts with the most free cash).

## Architecture

A composable check engine — each check is small, pure, and unit-tested; the runner aggregates and
resolves cross-account recommendations.

```
server/lib/health/
  types.ts          HealthCheck interface, HealthContext, result types
  context.ts        buildHealthContext(...) — precomputes shared inputs (balances, freeCash,
                    schedules, income, netFlowByAccount) so checks don't redo work
  source.ts         pickSource(context, accountId, amount) — cross-account source selection
  checks/runway.ts  wraps the existing computeFunding as a check (carries ring fractions)
  checks/cashflow.ts
  checks/buffer.ts
  checks/trend.ts
  index.ts          computeAccountHealth(context) → AccountHealthDTO[]; runs checks, aggregates
                    verdict, attaches recommendations
server/lib/funding.ts        kept — the runway check calls computeFunding; tallyIncomeByAccount stays
server/routes/accounts.ts    GET /api/accounts/health (replaces /api/accounts/funding)
shared/types.ts              AccountHealthDTO, HealthCheckResultDTO, HealthSeverity, HealthCheckKey
web/src/api.ts               accountsHealth()
web/src/components/HealthRing.tsx        renamed from FundingRing; color by verdict, arcs from ring{}
web/src/components/AccountHealthPanel.tsx  new drawer (portalled to document.body)
web/src/components/AccountsStrip.tsx     query health; ring color by verdict; tap → open panel
web/src/styles.css           ring color-by-verdict + panel styles
```

### DTO

```ts
export type HealthSeverity = "ok" | "attention" | "urgent";
export type HealthCheckKey = "runway" | "cashflow" | "buffer" | "trend";

export interface HealthCheckResultDTO {
  key: HealthCheckKey;
  severity: HealthSeverity;
  title: string;
  why: string;
  recommendation: string | null;
}

export interface AccountHealthDTO {
  accountId: string;
  verdict: HealthSeverity;            // worst across checks
  color: "green" | "amber" | "red";
  headline: string;                  // "Healthy" | "Needs attention" | "Unhealthy"
  checks: HealthCheckResultDTO[];    // triggered checks, plus ok ones for the positive panel
  ring: { solidFraction: number; dashedFraction: number }; // from runway, for arc geometry
}
```

The ring's geometry (arcs) still comes from the runway numbers; only its **color** now comes from the
overall `verdict`.

## UI surfacing

- The avatar ring is colored by `verdict` (green/amber/red); arc fill still reflects runway coverage.
- **Tap a chip → `AccountHealthPanel`** (a drawer, `createPortal` to `document.body` per the
  transformed-ancestor overlay gotcha). The panel shows:
  - headline (Healthy / Needs attention / Unhealthy) with the verdict color,
  - one row per check: title, `why`, and `recommendation` (recommendation styled as the action),
  - healthy accounts get a **positive panel** confirming why ("Covered until payday · £400 buffer"),
  - a **"View transactions"** action that applies `?account=<id>` (this absorbs the old tap-to-filter
    behavior, which is being replaced as the primary gesture).
- Net-worth and "Add account" chips: no ring, not a health target (unchanged).

## Open decisions (resolved with v1 defaults)

1. **Buffer cushion** = £0 (only overdraft triggers `buffer`); per-account configurable cushion is
   deferred.
2. **Net-flow window** = trailing 3 complete calendar months (ignores the current partial month).
3. **Structural vs trend overlap** — kept as two checks sharing `netFlowMonthly`; both rows can show
   (rate + deadline). Revisit if the panel feels redundant in practice.
4. **One-tap "move money" action** — deferred. Recommendations are textual in v1; the DTO leaves room
   to add a structured `action` later.
5. **Which accounts** — spendable bank + cash (same set the strip rings today); investments/assets/
   debts excluded.

## Testing

Per-check pure unit tests (`server/lib/health/checks/*.test.ts`):
- runway: reuse/extend existing funding cases (covered/short/rescued).
- cashflow: positive net flow → no result; negative → `attention`/`urgent` with correct `why`.
- buffer: balance < 0 → urgent; ≥ 0 → null (cushion 0).
- trend: months-to-zero thresholds; positive net flow → null.
- source picker: picks the account with most free cash; partial when no single source covers it.
- aggregation (`index.test.ts`): verdict = worst severity; color/headline mapping; positive panel
  includes ok checks.

Manual: panel renders on tap (desktop + mobile), ring colors match verdicts, "View transactions"
filters, no regression to the mobile alignment fix.

## Addendum (2026-06-16): Credit cards

GoCardless-linked credit cards arrive as `source=BANK` with a negative balance — indistinguishable
from an overdrawn current account, so the overdraft + runway checks misfire on them ("Overdrawn by
£1,121", "move from Savings"). Resolution:

**Detection — auto + manual override.** Two new `Account` columns (additive hand-applied SQL):
- `cashAccountType String?` — captured from GoCardless `/accounts/{id}/details` on link/sync
  (`"CARD"`, `"CACC"`, …). New connections get typed automatically.
- `creditCard Boolean?` — manual override; `null` defers to auto, so a sync never clobbers the user's
  choice.
- Effective, via a shared pure helper `isCreditCard({creditCard, cashAccountType})` =
  `creditCard ?? (cashAccountType === "CARD")`, used by both `toAccountDTO` and the health endpoint.
- Existing accounts (already-linked Amex): the manual toggle is the immediate fix; a backfill script
  re-fetches details to set `cashAccountType` going forward (PSD2 rate-limited, best-effort).

**Treatment.** `HealthAccount` gains `isCreditCard`. Credit cards **skip the runway and buffer
checks** (a negative card balance is debt, not an overdraft, and DDs aren't funded from it). The
**cashflow check still applies** and is the card's real signal — charges outpacing payments over
recent months = growing debt = `attention`; cleared monthly = green. Cards are already excluded as
recommendation *sources* (negative free-cash).

**Source-picker refinement (review follow-up).** `pickSource` prefers a source that can cover the
whole gap in one move; only when none can does it fall back to the most-free (informational-preferred)
source for a partial + top-up.

**Freshness (review follow-up).** Invalidate the `["accounts-health"]` query wherever transactions or
balances change (the existing `["accounts"]`/`["summary"]` invalidation sites).

**UI.** A "Credit card" toggle in account settings (`Accounts.tsx`, alongside the `informational`
toggle), wired through `patchAccount`. `AccountDTO` exposes `isCreditCard` for display + health.

## Out of scope (later)

- One-tap transfers from a recommendation.
- Configurable cushions / health thresholds in settings.
- Health for investment/asset/debt accounts.
- A dashboard-level "accounts needing attention" summary card.
- Full credit-card health (utilisation vs limit, statement/payment-due) — needs a stored credit limit.
