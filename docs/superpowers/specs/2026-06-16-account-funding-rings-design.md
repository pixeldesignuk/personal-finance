# Account Funding Rings — Design

**Date:** 2026-06-16
**Status:** Approved (design); ready for implementation plan.

## Problem

The account chips along the top of the dashboard (`AccountsStrip`) show a balance
and a static avatar ring. The ring is decorative. We want it to *mean* something:
at a glance, is this account on track for what's committed against it before the
next paycheck — and, for the account that receives income, will that paycheck
cover any gap?

North-star alignment: this is a reassurance signal ("am I okay until I'm next
paid?"), the same job the Budget card does for the month.

## The unifying metaphor

Every ring answers **one** question so that *fuller is always better*, regardless
of account type:

> "Are you covered for what's committed to this account between now and your next
> payday?"

Income is **not** a competing meaning with its own chip — it becomes part of the
answer on the account it lands in, drawn as a second (dashed) arc.

### Funding window

`W = [today, nextPayday]`, where `nextPayday` is the earliest upcoming income
occurrence across the user's income schedules (`RecurringScheduleDTO` with
`direction: "in"`, `status != "ignored"`), computed with the existing
`incomeOccurrences` / `inferNextDue` helpers in `server/lib/recurring.ts`.

If no income schedule exists, fall back to a rolling 30-day window and render no
income arc (graceful degradation).

### Per-account committed bills

For account `A`:

```
committed_A = Σ amount over out-schedules where
  accountId == A AND status != "ignored" AND direction == "out",
  counting each occurrence that falls within W
  (via occurrencesWithin(nextDue, cadence, today, windowDays))
```

Schedules with `accountId == null` cannot be attributed and are excluded in v1
(see Open Decisions).

### Current / spending account ring (single arc)

```
coveredFraction = clamp(balance / committed_A, 0, 1)

state:
  committed_A == 0          → "none"     (no gauge; keep neutral identity ring)
  balance >= committed_A    → "funded"   (full jade arc)
  0 < balance < committed_A → "partial"  (amber arc at coveredFraction)
  balance <= 0              → "short"    (red arc, ~empty)
```

### Income-receiving account ring (two segments)

The account that receives income (`isIncomeAccount`: has an in-schedule with
`accountId == A`, or income landed in `A` this month) gets a second arc.

Because payday lands at the *end* of `W`, today's balance must carry the
in-window bills on its own; the paycheck's honest role is **"you dip below your
committed bills now, but payday closes the gap."** So the dashed arc fills the
shortfall:

```
shortfall      = max(0, committed_A - balance)
incomeIncoming = expected income landing for A at nextPayday   (typical amount)
dashedCovers   = min(incomeIncoming, shortfall)

solidFraction  = clamp(balance / committed_A, 0, 1)            // jade, today's balance
dashedFraction = dashedCovers / committed_A                    // translucent jade, the paycheck

state:
  solidFraction + dashedFraction >= 1 → "rescued"  (balance + payday cover bills)
  else                                → "short"     (a red gap remains even with payday)
```

When `balance >= committed_A` the account is fine without needing payday → no
dashed arc (solid jade is already full).

Income color rule is gentler than spending accounts: an income arc never turns
**red** on its own (awaiting pay is not a problem). Optional `"overdue"` amber
state: an income schedule's expected date for this month has passed and nothing
≥60% of typical has landed (reuses the existing arrived-detection). Marked P2.

### Net worth chip

No gauge. Keep its existing jade halo as identity, not data.

## Architecture

A new pure server module computes funding; a thin endpoint exposes it; the strip
consumes it as a third query and renders an SVG ring layer over the existing
avatar.

```
server/lib/funding.ts          (new)  computeFunding(accounts, schedules, incomeByAccount, today)
server/routes/accountsFunding  (new)  GET /api/accounts/funding -> AccountFundingDTO[]
shared/types.ts                (edit) AccountFundingDTO
web/src/api.ts                 (edit) api.accountsFunding()
web/src/components/FundingRing.tsx  (new)  SVG two-arc ring
web/src/components/AccountsStrip.tsx (edit) query funding, wrap avatar in FundingRing
web/src/styles.css             (edit) ring arc styles / colors
```

`computeFunding` is pure and unit-testable: given the accounts, the recurring
schedules, the per-account income-received map, and `today`, it returns one
`AccountFundingDTO` per account. The income-received-per-account computation
(currently inline in `/upcoming`, recurring.ts:143–151) is extracted into a small
helper reused by both `/upcoming` and `/accounts/funding` (DRY).

### DTO

```ts
export interface AccountFundingDTO {
  accountId: string;
  committed: number;        // bills due in W attributed to this account
  balance: number;          // currentBalance snapshot used
  solidFraction: number;    // 0..1 — balance coverage (jade arc)
  dashedFraction: number;   // 0..1 — incoming-income top-up (translucent arc); 0 if not income account / no shortfall
  incomeIncoming: number;   // expected paycheck for this account at nextPayday (0 if none)
  isIncomeAccount: boolean;
  state: "none" | "funded" | "partial" | "short" | "rescued" | "overdue";
  windowDays: number;       // days in W (today..nextPayday), or 30 fallback
}
```

### Rendering

`FundingRing` wraps the 44/56px avatar. Two concentric SVG `<circle>` arcs on a
shared track, drawn with `stroke-dasharray` / `stroke-dashoffset` and rotated
-90° so they start at 12 o'clock:

- track: faint `--line-strong`
- solid arc: `solidFraction` of circumference, color by `state`
  (jade funded/rescued, amber partial/overdue, red short)
- dashed arc: `dashedFraction`, translucent jade, offset to begin where the solid
  arc ends (so it visually "continues" filling toward full)

The precise number (e.g. "£1,210 of £1,540 committed · payday +£1,200") shows on
tap/hover, not inline — the ring is one-glance.

## Open decisions (resolved with v1 defaults)

1. **Null-account schedules** — bills not attributable to an account are excluded
   from per-account `committed`. (Alt: attribute to a designated primary account —
   deferred.)
2. **Multiple income accounts** — each income-receiving account gets its own
   dashed arc against its own income; `nextPayday` for `W` is the earliest income
   occurrence across all streams.
3. **No income detected** — 30-day fallback window, no dashed arcs anywhere.
4. **Credit cards / debt accounts** — out of scope for the ring in v1 (already
   filtered from the strip's INVESTMENT/ASSET/LIABILITY set; credit cards that
   appear as BANK accounts get the standard coverage ring, which is acceptable —
   "funded" reads as "you can pay it down" — but flagged for review).
5. **Overdue income amber** — P2, behind the core arcs.

## Testing

`server/lib/funding.test.ts` (node --test) covers `computeFunding`:
- account with no committed bills → `state: "none"`, fractions 0
- balance fully covers committed → `funded`, solid 1
- balance partially covers → `partial`, solid = balance/committed
- income account, balance short but paycheck covers gap → `rescued`,
  solid+dashed = 1
- income account, short even with paycheck → `short`, dashed = income/committed
- no income schedule → 30-day window, dashed 0
- yearly/quarterly bill occurrences counted correctly within W

Manual: mobile + desktop AccountsStrip visual check (ring legibility at 56px,
two-arc separation, color states), confirm no regression to the alignment fix.

## Out of scope (later)

- Savings-goal rings, debt-payoff rings.
- Per-account budget-burn.
- Configurable window in settings.
