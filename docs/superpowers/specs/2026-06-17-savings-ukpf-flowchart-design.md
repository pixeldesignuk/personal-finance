# Savings as a core feature — UKPF-flowchart coach

**Date:** 2026-06-17
**Status:** Design — awaiting review
**North-star fit:** Directly serves "save money, clear debts, reassure I'm not overspending."

## 1. Problem & intent

The Savings/Pots shell is **passive**: you create a pot, optionally set a target, and
**manually** Add/Take money. Nothing tracks whether you're saving, nudges you to, or
reacts when you do — there is **no active signal for saving**.

We want savings to be a core, *opinionated* feature. The anchor is the
**UK Personal Finance flowchart** (<https://ukpersonal.finance/flowchart/>): a trusted,
ordered "order of operations" for money. Ledger maps the user's **real** financial
position onto that flowchart, tells them the single **next action**, and directs spare
cash to it.

### Competitive rationale

Main competitors are **Emma, Snoop, LifeStage Money**; we can't beat Emma on breadth.
Emma/Snoop give pots and analytics; **nobody gives opinionated, ordered, UK-specific
guidance** grounded in a trusted community framework. And it turns our hard constraint —
**read-only open banking (GoCardless AIS), we cannot move money** — into a strength: we
are a **coach**, not a bank. We diagnose position and recommend; the user acts; we *see
the result on the next sync* and confirm it.

## 2. The flowchart (our subset)

Full UKPF order: 1 Budget → 2 Emergency fund (small) → 3 Pension match → 4 Expensive
debt → 5 Emergency fund (full) → 6 Goals → 7 Short-term (LISA) → 8 Long-term (S&S ISA /
invest).

**v1 measures Steps 1, 2, 4, 5** (the cash + debt core — our exact north-star). Step 3
(pension) and Steps 6–8 (LISA/investing) are shown as **locked "coming" rows** for
context — we hold no pension/ISA data, so measuring them would be dishonest.

The engine walks the steps in order; the **first incomplete step is "current"**, earlier
ones are ✓ done, later ones are locked.

| Step | Done when | Source |
|------|-----------|--------|
| 1 Budgeting | the user has set category budgets (≥1 category with `monthlyAmount > 0`) | auto |
| 2 Emergency fund (small) | tagged EF account balance ≥ **1×** essential monthly spend | auto |
| 3 Pension match | — (locked teaser in v1) | n/a |
| 4 Expensive debt | no non-mortgage debt with **APR > 10%** carrying a balance | auto (`Account.interestRate`), prompt for missing rates |
| 5 Emergency fund (full) | tagged EF account balance ≥ **N×** essential monthly spend (N default 3, configurable 3–12) | auto |

Because Step 3 is skipped, the effective v1 order is **1 → 2 → 4 → 5**.

## 3. Core numbers

### Essential monthly spend (`essentialMonthly`)

Trailing average (default **last 3 full months**) of spend in **`needs`-class** categories
(`categoryClass(key) === "needs"` — rent/mortgage, groceries, utilities, transport,
minimum debt payments). This is the basis for every EF target.

- Excludes the current partial month (avoids a low/early-month skew).
- Refunds netted per existing refund rules; transfers/excluded txns follow the same
  exclusions the budget engine uses (do **not** re-implement a naive per-row sum — see the
  £3,716 false-flag bug; anchor to the budget/needs aggregation that already excludes
  transfers & debt repayments).

### EF targets

- **Small EF target** = `essentialMonthly × 1`.
- **Full EF target** = `essentialMonthly × efMonthsFull` (default 3).

### EF balance

The balance of the **tagged emergency-fund account** (`savings.emergencyAccountId`), via
the existing `currentBalance` helper. Auto-updates on sync.

### Surplus ("spare to save")

```
spendableNow      = sum of spendable account balances, EXCLUDING the EF account
+ incomeIncoming  = expected pay before next payday (funding.ts)
− billsBeforePayday = bills committed today..nextPayday (funding.ts)
= projectedAtPayday
− operationalCushion (small current-account floor; see below)
= surplus           (clamped ≥ 0)
```

**Reconciliation note (flag for review):** the EF now lives in a *separate* savings
account, so the surplus "buffer" is **not** the emergency fund. It is a small
**operational cushion** on the *spending* account so the nudge never drains you to £0
before payday. Default: `savings.cushion` = a modest flat figure (proposed **£100**) or a
few days of essential spend; configurable; may be £0 for users who want the full surplus
surfaced. The EF account is **excluded** from `spendableNow` (it is already-saved money,
not to be re-counted as savable).

`nextPayday`, `incomeIncoming`, and `billsBeforePayday` reuse `server/lib/funding.ts`
verbatim — no new payday model.

## 4. The active signal: nudge + real-confirmation loop

The surplus nudge is the engine that **feeds the current step**:

- Current step **Small/Full EF** → *"£320 spare → move it to Marcus Savings."*
- Current step **Expensive debt** → *"£320 spare → overpay [Barclaycard] (24.9% APR)."*

Loop:

1. Nudge shows surplus + the current step's destination + `[Move it] [Choose amount] [Not now]`.
2. We **cannot transfer** — the user moves the money in their real banking app.
3. On the **next sync**, the EF/debt account balance changes; we detect the rise/fall and
   **confirm the save** ("✓ £320 landed in Marcus — Emergency fund 1 month reached"), and
   the step may advance.
4. "Not now" snoozes; the nudge re-surfaces next surplus window (payday / month-end).

No virtual fake-transfers; the signal is real because the bank data confirms it.

**v1 surface:** a dashboard card (reuses the surplus calc). A Telegram payday nudge is a
later add-on that reuses the same `/api/plan` surplus — out of scope for v1.

## 5. Page design — Savings rebuilt as "Plan"

The **Savings page becomes the Plan**: the flowchart on top (your position), your **pots
below as the vehicles** for goals.

```
SAVINGS  (Plan)
┌───────────────────────────────────────┐
│ Your plan · UK Personal Finance        │
│ ✓ 1 Budgeting            done          │
│ ● 2 Emergency fund       £600 to go    │  ← current (expanded)
│      £400 / £1,000  (1 month)          │
│      ▓▓▓▓▓░░░░░  + "£320 spare → add"   │
│   3 Pension match        coming 🔒     │
│   4 Expensive debt       locked 🔒     │
│   5 Full emergency fund  locked 🔒     │
│   … LISA / invest        coming        │
├───────────────────────────────────────┤
│ Your pots                              │
│ [Emergency fund 🏦] [Japan ✈] [+ New]  │  ← existing pots UI
└───────────────────────────────────────┘
```

- Only the **current** step is expanded (progress bar, the £-to-go, the inline surplus
  CTA). Done steps collapse to a ✓; locked steps are muted with a 🔒 and a one-line "why".
- The EF account is surfaced at the top of the current EF step ("🏦 Marcus Savings — your
  emergency fund").
- Pots remain for ad-hoc goals (holiday, car) — they are *vehicles*, not the spine.
- First-run setup (inline, not a wizard): "Which account is your emergency fund?" (tag) and
  the debt-APR prompt only appears when an un-rated debt with a balance exists.

## 6. Data model & API

**No schema migration for v1** — everything via the existing `Setting` table; debt APR
uses the existing `Account.interestRate`.

### Settings (string/bool, via existing settings layer)

- `savings.emergencyAccountId` — tagged EF account id (string).
- `savings.efMonthsFull` — full-EF months (default `"3"`).
- `savings.cushion` — operational current-account cushion (default `"100"`).
- (later) `plan.pensionMatch` — `full | improvable | na`.

### API

`GET /api/plan` → 
```ts
{
  essentialMonthly: number,
  efAccount: { id, name, balance } | null,   // null until tagged
  surplus: number,
  steps: Array<{
    key: "budget" | "ef_small" | "pension" | "debt" | "ef_full" | "invest",
    state: "done" | "current" | "locked" | "coming",
    title: string,
    progress?: { have: number, target: number, pct: number },
    toGo?: number,
    detail?: string,            // "1 month", "Barclaycard 24.9% APR", …
    actionHint?: string,        // where surplus should go on the current step
  }>,
  current: string | null,       // key of the current step
}
```

New `server/lib/plan.ts` composes: budget rows, `funding.ts` (payday/bills), debts
(`interestRate`), tagged EF account balance, `essentialMonthly`. Pure/unit-testable:
given fixtures, asserts the correct current step, targets, and surplus.

Endpoints to tag the EF account / set months / set cushion reuse the existing settings
PATCH (`savings.*` keys added to the allow-list).

## 7. Scope / YAGNI

**In v1:** Steps 1, 2, 4, 5; Plan page (Savings rebuilt); essential-spend + EF-target
math; surplus calc + dashboard nudge + real-confirmation on sync; EF-account tagging;
debt-APR prompt for missing rates; locked teasers for 3 and 6–8.

**Out (later, explicitly):** pension tracking (Step 3 measured); LISA/S&S ISA/investing
(Steps 6–8 measured); virtual round-ups; any automated/initiated transfers; Telegram
payday nudge; mortgage-overpayment guidance.

## 8. Edge cases & risks

- **No EF account tagged yet** → Step 2 shows "Tag your emergency-fund account to start";
  surplus still computes (destination = "your emergency fund" generic) but confirmation
  loop is disabled until tagged.
- **Thin history** (<3 months data) → `essentialMonthly` averages whatever months exist;
  show "estimate" qualifier.
- **No needs-class spend** (uncategorised) → essentials ≈ 0 → EF target ≈ 0 → Step 2 reads
  "done" misleadingly. Guard: if essentials can't be estimated, mark Step 2 "needs
  categorisation" rather than done.
- **Debt without APR** → cannot judge "expensive"; prompt for the rate; treat unknown-rate
  non-mortgage debt as *blocking* Step 4 until rated (conservative).
- **Surplus volatility** → compute against `nextPayday` (funding.ts) which widens after
  salary lands; acceptable, matches the funding-ring behaviour already shipped.
- **Don't double-count** the EF account in spendable/surplus (excluded) nor in net-worth
  changes.

## 9. Testing

- `server/lib/plan.test.ts` — fixtures for: budget set/unset; EF 0/partial/1mo/full;
  debt >10% vs ≤10% vs unrated; surplus = projectedAtPayday − cushion with EF excluded;
  step ordering 1→2→4→5; thin-history & no-essentials guards.
- Reuse `funding.test.ts` patterns for the payday window.

## 10. Open questions for review

1. Operational cushion default — flat **£100**, derived (few days of essentials), or £0?
2. Full-EF default months — **3** (configurable 3–12)? UKPF says 3–12 "by circumstance".
3. Step 2 small-EF target — **1 month** (UKPF says 1–3); keep 1 as the first milestone?
