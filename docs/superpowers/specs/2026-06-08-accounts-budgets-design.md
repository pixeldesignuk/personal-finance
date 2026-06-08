# Accounts, Manual Money & Budgets — Design

**Date:** 2026-06-08
**Status:** Approved (build in one pass)
**Builds on:** finance web app + multi-account support.

## Goal

Track spending and make personalised budgets across all the money the user
holds — bank accounts (GoCardless), plus cash and other manual accounts
(e.g. Trading 212) — with personal/business separation, accurate categories,
a net-worth total, per-category monthly budgets, and a monthly cash-flow /
savings-rate summary.

## Decisions (from brainstorming)

- **One combined build** (not split into sub-projects).
- **Two account axes:** `type` PERSONAL|BUSINESS (default PERSONAL) and `source`
  BANK|MANUAL (default BANK). `requisitionId` becomes optional.
- **Manual accounts** (cash, Trading 212): created by hand with a name, type, and
  a manually-set balance. Balance is an **independent snapshot** the user edits;
  logging a manual transaction does NOT auto-adjust it (same model as the bank
  side — balance and transactions are separate).
- **Manual transactions** on manual accounts: date, amount (+income / −expense),
  category. Stored in the existing `Transaction` table; feed budgets and the
  cash-flow summary.
- **Category override** on ANY transaction, preserved across bank syncs. The
  override set includes a special **`transfer`** category that is excluded from
  all spending, budget, and cash-flow math (handles inter-account moves / ATM
  withdrawals).
- **Budgets:** one recurring monthly limit per spending category, manual entry,
  computed against the **current calendar month**, over **PERSONAL accounts only**.
  Business accounts are visible/tracked but excluded from budgets.
- **Cash-flow / savings-rate summary:** monthly income vs expenses, net, and
  savings rate %, PERSONAL accounts only, transfers excluded.
- **Net-worth total:** sum of each account's current balance (bank: preferred
  GoCardless balance; manual: manualBalance) across all accounts.

## Categories

Effective category of a transaction = `categoryOverride ?? category`.

- **Spending categories** (budgetable): `groceries`, `eating-out`, `transport`,
  `bills`, `shopping`, `other`.
- **`income`**: credits (treated as income; not budgeted).
- **`transfer`**: excluded from spending, budgets, and cash-flow (neither income
  nor expense).

`SPENDING_CATEGORIES` and the full `CATEGORIES` list are exported from
`server/lib/categorize.ts` and reused by routes + frontend.

## Data model (Prisma / Postgres)

New enums:
```prisma
enum AccountType   { PERSONAL  BUSINESS }
enum AccountSource { BANK      MANUAL   }
```

`Account` (changed):
- `requisitionId String?` (now optional) + relation optional.
- `source   AccountSource @default(BANK)`
- `type     AccountType   @default(PERSONAL)`
- `manualBalance Decimal?` (set for MANUAL accounts; null for bank).

`Transaction` (changed):
- `categoryOverride String?` (effective category = override ?? category).

New `Budget`:
```prisma
model Budget {
  category     String   @id   // one of SPENDING_CATEGORIES
  monthlyLimit Decimal
  updatedAt    DateTime @updatedAt
}
```

Migration applied to the live Railway DB via SQL (idempotent: `CREATE TYPE`
guarded by a `DO` block, `ADD COLUMN IF NOT EXISTS`, `CREATE TABLE IF NOT
EXISTS`). Prisma migration kept in sync and made idempotent.

## Balance / net-worth resolution

`currentBalance(account)`:
- MANUAL → `manualBalance ?? 0`.
- BANK → the `Balance` row of a preferred type, in order:
  `interimAvailable` → `expected` → `closingBooked` → first available → 0.

Net worth = Σ `currentBalance` over all accounts (single-currency, GBP assumed).

## Backend

New/changed routes (all `/api`):

- `GET /api/accounts` — extend each account DTO with `type`, `source`,
  `currentBalance`, plus existing fields. Banks still grouped by requisition;
  manual accounts grouped under a synthetic "Manual / Cash" group.
- `POST /api/accounts/manual` — `{ name, type, currency?, manualBalance? }` →
  creates a MANUAL account (id `manual-${randomUUID}`), no requisition.
- `PATCH /api/accounts/:id` — extend to accept any of `{ nickname?, type?,
  name?, manualBalance? }`. `manualBalance` only valid for MANUAL accounts.
- `DELETE /api/accounts/:id` — delete a MANUAL account + cascade its
  transactions (rejects bank accounts; banks use `DELETE /api/banks/:reqId`).
- `POST /api/transactions` — create a manual transaction `{ accountId, date,
  amount, category }` (account must be MANUAL). id `manual-${randomUUID}`,
  status `booked`, raw `{ manual: true }`.
- `PATCH /api/transactions/:id` — `{ category }` sets `categoryOverride`
  (validated against `CATEGORIES`).
- `DELETE /api/transactions/:id` — delete a MANUAL transaction (rejects bank
  transactions — those come back on next sync).
- `GET /api/budgets` — `[{ category, monthlyLimit, spent, remaining, percent }]`
  for every spending category (limit 0 if unset), `spent` = current-month
  personal debits in that effective category (transfers excluded).
- `PUT /api/budgets/:category` — `{ monthlyLimit }` upsert (category in
  `SPENDING_CATEGORIES`, limit ≥ 0).
- `GET /api/summary` — `{ month, netWorth, income, expenses, net, savingsRate }`
  for the current month, personal-only, transfers excluded.
- `GET /api/dashboard?accountId=` and `GET /api/transactions` — use **effective
  category** and exclude `transfer` from spending aggregates; transactions DTO
  gains `source` and effective `category` (+ keep raw auto category as
  `autoCategory` for reference).

Sync change: `syncAccount` upsert must NOT overwrite `categoryOverride`
(it only writes auto `category`).

## Pure logic (unit-tested)

- `categorize.ts` — export `SPENDING_CATEGORIES`, `CATEGORIES`.
- `effectiveCategory(tx)` helper.
- `currentBalance(account, balances)` resolver (preferred-type order).
- `budget.ts`:
  - `monthOf(dateStr)` → `YYYY-MM`.
  - `personalSpendByCategory(txns, month)` → map category→spent (debits,
    transfers & income excluded, current month).
  - `buildBudgetRows(limits, spentByCategory)` → rows with remaining/percent.
  - `cashFlow(txns, month)` → `{ income, expenses, net, savingsRate }`.
  All operate on already-filtered personal transactions; pure and tested.

## Frontend

- **Manage page** (`Accounts.tsx`): per account show type toggle
  (Personal/Business), source, balance; for manual accounts edit `manualBalance`
  and `name`, and "Add transaction" (date/amount/category) + delete account.
  "Add bank" and new "Add cash / manual account" buttons.
- **Transactions page**: per-row **category dropdown** (override → PATCH),
  account column already present; manual rows get a delete action; a "transfer"
  option is in the dropdown.
- **Budgets page** (`Budgets.tsx`, new nav "Budgets"): list each spending
  category with an editable monthly limit, spent-this-month, remaining, and a
  progress bar (green < 80%, amber 80–100%, red > 100%).
- **Dashboard**: add a top strip — **Net worth** + **this month**: income,
  expenses, net, savings rate %. Existing charts unchanged (now transfer-aware).

## Error handling

- Manual-only guards: `manualBalance`/manual-txn/delete reject bank accounts &
  bank transactions with 400.
- Budget/category validation against the canonical lists (400 on unknown).
- Savings rate guards divide-by-zero (income 0 → rate 0).
- Manual account delete cascades its transactions; confirm dialog in UI.

## Testing

Unit tests (Node `node:test`, no DB): `categorize` exports, `effectiveCategory`,
`currentBalance` preferred-type resolution, `budget.ts` (month filter, transfer/
income exclusion, budget rows incl. over-budget & unset limit, cash-flow +
savings-rate incl. zero-income). Routes/UI validated by running against the live
account.

## Out of scope (YAGNI)

Net-worth-over-time history (needs balance snapshots — noted future add),
50/30/20 needs/wants mapping, subscription/anomaly detection, multi-currency
conversion, debt-to-income / emergency-fund metrics, PDF/CSV import (we have the
live feed + manual entry), custom user-defined categories.
