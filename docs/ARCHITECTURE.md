# Ledger — Architecture

A single-user personal-finance app (no auth, no multi-tenancy). This document is
the reference for how the system fits together and *why* the non-obvious
decisions were made, so a fresh session can change things without breaking them.
Pair it with `CLAUDE.md` (conventions + gotchas) and `TODO.md` (north-star + backlog).

## 1. Stack & layout

- **API:** Express 5 + TypeScript, run with `tsx` (`server/index.ts`). Routes in
  `server/routes/*`, pure/unit-tested logic in `server/lib/*` and
  `server/categorise/*` (tests are `*.test.ts`, `node --test --import tsx`).
- **Web:** Vite 8 + React 19 SPA in `web/src`, react-router-dom v7,
  @tanstack/react-query v5, `nuqs` for URL state. Built by the **root**
  `vite.config.ts` (no `web/tsconfig.json`; root `tsconfig.json` includes
  `web/src`, `shared`, `server`).
- **Shared types:** `shared/types.ts` (DTOs), plus small shared helpers
  (`shared/merchantName.ts`, `shared/displayName.ts`).
- **DB:** Prisma v6 → Postgres on Railway. Schema in `prisma/schema.prisma`.
  Migrations are hand-applied SQL (see CLAUDE.md), never `prisma migrate`.
- **Integrations:** GoCardless Bank Account Data (open banking), Gemini
  (`@google/genai`, model `gemini-flash-latest`), Telegram bot, Gmail (orders),
  S3-compatible Railway bucket (receipt/document storage).
- **Deploy:** Railway. Prod URL `personal-finance-production-18f8.up.railway.app`.
  Server runs UTC. In-process scheduler (`server/lib/scheduler.ts`) runs
  `runFullSync` every `SYNC_INTERVAL_MINUTES` (default 60); fires on the interval,
  not on boot.

## 2. Data model (Prisma)

- **Account** — `source` BANK|MANUAL|INVESTMENT|ASSET|LIABILITY, `type`
  PERSONAL|BUSINESS, `manualBalance`, `excludedBalance` (funds held for others —
  carved from net worth), `informational` (bool — excluded from BUDGETING but kept
  in net worth), `balanceType` (which bank balance figure to use), debt fields
  (`interestRate`, `priority`, `targetPayment`, `debtExcluded`), `provider`
  (investment key). Bank accounts belong to a `Requisition`.
- **Transaction** — `id` (bank id, or `tg-…` / `manual-…` / `receipt-…` for
  app-created), `bookingDate` (string `YYYY-MM-DD`), `amount` (Decimal, negative =
  spend), name fields (`merchantName`/`creditorName`/`debtorName`/`remittanceInfo`),
  `category` (auto) + `categoryOverride` (user) → **effective category** via
  `effectiveCategory(t) = categoryOverride ?? category` (positives default to
  "income"), `personKey`, `note`, `flag`, `debtAccountId` (links a repayment),
  `status`, `raw` (Json — markers `{telegram:true}` / `{telegramReceipt:true}`),
  `createdAt` (row insert time, for "most recent").
- **Merchant** — `token` (PK, the stable id), `name` (clean brand), `domain`
  (logo), `categoryKey`, `recurring` (auto|fixed|variable|**ignore**). The display
  name for a txn comes from this table keyed by token, falling back to the raw line.
- **RecurringSchedule** — `merchantToken` (unique key; `income:<accountId>` for
  income streams, `manual:<slug>` for user-added), `direction` out|in, `amount`,
  `kind` fixed|variable, `prevAmount` (set when a bill recently increased),
  `cadence` monthly|weekly|quarterly|yearly|irregular, `dayOfMonth`, `nextDue`,
  `lastSeen`, `status` auto|confirmed|ignored.
- **Category** — `key`, `name`, `group`, `monthlyAmount` (the budget), `archived`.
- **Pot** — earmarks liquid cash toward a goal (savings).
- **Plugin / Requisition / Balance / Rule / EmailOrder / Person / SyncLog / Setting** —
  supporting. `EmailOrder` (Gmail/Telegram receipts) has `attachmentKey`,
  `summary`, `items`, and links to a `transactionId`.

## 3. Merchant naming & tokens (read before touching names)

- **`rawMerchantName(t)` / `firstNonEmpty(...)`** (`shared/merchantName.ts`) pick
  the first NON-EMPTY name field, skipping `""`. Use everywhere — `??` chains
  break on empty strings (a real bug source; e.g. an "O2" bill whose name is only
  in `remittanceInfo`).
- **`merchantToken(name)`** (`server/categorise/helpers.ts`) → lowercased, ≤3
  words, drops pure-number tokens, **min 2 chars** (so O2/EE/BP survive).
- **Display name** (transactions DTO `friendlyName`): `merchantTable.name(token)
  || rawMerchantName(t)`. So renaming the Merchant row renames everywhere; setting
  a txn's `merchantName` renames just that row (no merchant row).
- **AI cleanup:** `autoNameMerchants` (statement line → brand) and
  `autoMerchantDomains` (name → domain for logos) run after sync; gated by Gemini
  quota, idempotent. **Known issue:** some merchant rows have malformed `" | "`
  tokens from an older path.

## 4. Recurring detection (`server/lib/scheduleDetect.ts`)

Runs after every sync. Groups txns by merchant token.

- **Bills:** a merchant qualifies if it recurs ~once a month over ≥3 months
  (`perMonth ≤ 1.5`), fixed OR variable amount (the per-month gate keeps groceries
  out). `analyzeRecurringAmounts(chargesOldestToNewest)` (`server/lib/merchants.ts`)
  returns `{amount, kind, prevAmount}`: current stable level, fixed vs variable,
  and a recent price **increase** flag (`prevAmount`) when the level stepped up in
  the last ~3 cycles (>5%, ≥£1).
- **Income:** one stream **per account** (`income:<accountId>`), derived from
  income-categorised credits. Amount = `median(individual deposits) × min
  deposits-per-month` (robust to irregular pay *timing* that bunches two wages into
  one calendar month; min-per-month lets a genuine two-stream account count both).
  Always recomputed (never user-locked). Named via `derivePayerName(labels)` (common
  leading words of the references → "Pixel Design"), falling back to the account
  name when the references are noise. Requires ≥2 active months.
- **Non-monthly bills → "bill targets" (sinking funds):** see Budget.
- **Feedback:** `POST /recurring/:token/not-recurring` sets the merchant's
  `recurring=ignore` (trains the detector) and deletes the schedule — distinct
  from "stop tracking" (`status=ignored`, hidden but kept).

## 5. Income projection (`/upcoming`, in `server/routes/recurring.ts`)

The dashboard's "expected income" comes from here. Key rule: **a one-off credit
must not reduce the projection.** Per income stream:

- Compute this-month income for that account as `{total, max}`.
- The recurring payment has **arrived** iff `max ≥ 0.6 × amount` (a salary-sized
  credit landed) OR `total ≥ amount` (split payments already cover it). A small
  payback is below the bar and ignored.
- Project the **full** typical amount for each upcoming occurrence; drop this
  month's occurrence only once arrived. (No subtracting arbitrary credits.)
- The dashboard labels the expected sum with **"by <last pay date>"** when income
  spans multiple dates (partner mid-month + wage month-end), "~<date>" for a single
  payment — never the soonest date for the whole sum.

## 6. Net worth, available, and balances (`server/routes/summary.ts`)

Two distinct liquid totals — don't conflate:

- **`liquid`** = bank + cash for **net worth**: includes `informational`
  accounts, minus each account's `excludedBalance` (funds not yours).
- **`available`** = **spendable** (safe-to-spend, dashboard "in the bank"):
  same, but **excludes `informational`** accounts.
- **Net worth** = `liquid` (+ investments / assets − debts, per the
  `networth.include*` settings flags).
- **Cash account balance** = `manualBalance` (baseline) **+** `sum(transactions)`
  via `manualTxnSums()`, applied wherever a BANK/MANUAL balance is summed
  (accounts DTO, summary, budget, pots). Setting the balance stores
  `entered − activity` so the figure shown is exactly what was typed. If a shared
  account's balance falls below `excludedBalance`, the "yours" share goes negative
  (correct — you owe it) and the UI flags it.
- **`informational` ("Exclude from budget")**: drops the account's transactions
  from income/expense (summary `personalIds`, budget queries, dashboard charts,
  pots) and its balance from `available` — but keeps it in `liquid`/net worth.

## 7. Budget (`server/routes/budget.ts`)

- Budget = sum of `Category.monthlyAmount` over personal, **non-informational**
  accounts. `available = balance − budgeted − setAside`.
- **Auto-populate** (`POST /budget/auto-populate`): sets each category's budget to
  its **median monthly spend** over complete months (robust to spikes; occasional
  categories get their average). Overwrites categories with history.
- **Bill targets (sinking funds):** quarterly/annual bills are spread into a
  monthly "set aside" (`billTarget` in `server/lib/recurring.ts`,
  `amount ÷ periodMonths`), shown in a "Bills you're saving for" section with an
  "X of N" progress bar, and reserved from `available` (`setAside`). The Recurring
  view still shows the whole bill; non-monthly bills are added with a full **next
  due date** (need the month, not just day-of-month).
- Budgets are **not month-versioned** yet (single `monthlyAmount`) — the main gap.

## 8. Bank sync & GoCardless (`server/routes/sync.ts`, `connect.ts`, `gocardless/`)

- **Rate limit:** banks allow ~**4 unattended data pulls/day/account** (a PSD2
  cap — NOT a GoCardless setting, can't be raised). Background sync cooldown is
  **12h** (≈2/day) to leave headroom for manual syncs / reconnects. 429s are
  handled gracefully.
- **History depth** is fixed at consent time. On connect we create an end-user
  **agreement** with `max_historical_days` = the bank's advertised max (capped at
  GoCardless's 730). Only takes effect on the next link/re-consent.
- **Reconnect for more history:** re-runs connect; `finalize` reuses existing
  account rows (matched by GoCardless account id — nothing lost), moves them onto
  the new requisition, runs a **full-history** sync (`syncAccount(..., {fullHistory})`
  bypasses the incremental window + cooldown), and deletes the orphaned old
  requisition. Users pick the window (default Maximum).
- **Cash account:** `getOrCreateCashAccount()` reuses a "Cash"-named manual
  account, else the oldest manual account — it must never silently create a second
  cash account.

## 9. Telegram bot (`server/routes/telegram.ts`, `server/telegram/`)

- Webhook (secret-token auth, allowed chat id). Photos/PDFs → receipt scan
  (Gemini vision) → `EmailOrder` (source telegram) → bucket → match to a txn → cash
  txn if unmatched. Text → expense.
- **Text expense:** `geminiParseExpense(text, categories)` returns
  `{amount, isIncome, merchant (clean store name only), summary, categoryKey}`.
  The AI category becomes the default; the inline keyboard is ordered by how often
  you use each category with the AI suggestion pinned first; "Uncategorised" always
  offered. A bare word (no amount) that matches a category name sets the category
  of your **most recent** cash expense (uses `Transaction.createdAt`). Callback
  `data` must stay <64 bytes (short ids).

## 10. Frontend patterns

- **Combobox** (`web/src/components/Combobox.tsx`): inline-looking searchable
  select, **portalled to body** (z-index 90), `allowCustom` to type a new value.
- **TxnDrawer** (`web/src/components/TxnDrawer.tsx`): right sidebar with full
  transaction detail + edit (merchant picker, category/person, note, flag, line
  items, receipt image, statement line, delete). **Portalled to body** so it
  covers the whole page incl. header. Opened by clicking a row OR the row kebab's
  "Edit details…".
- **RowMenu** (`web/src/components/RowMenu.tsx`): vertical kebab (⋮), popover
  portalled to body (escapes table overflow). Interactive cells in a clickable row
  must `stopPropagation`.
- **Drawer/sheet pattern:** `.drawer-backdrop` (fixed, inset 0, z 60) + `.drawer`.
  Reuse it; portal it.
- **Transactions table:** inline category/person `<select>` per row for quick
  edits; name is a merchant Combobox; the kebab/drawer hold the rest. Don't put
  `display:flex` on a `<td>` (border-seam bug — use `.cell-actions-row` wrapper).

## 11. Testing & verification

- Pure logic is unit-tested (`server/lib/*.test.ts`, `server/categorise/*.test.ts`)
  — `merchants` (median/CV/classify/analyzeRecurringAmounts/derivePayerName),
  `recurring` (date inference, occurrences, billTarget), `budget`
  (spend/suggest/cashFlow), `cashTxn`, `helpers`, etc. Run them after logic changes.
- For UI/layout, render against the built CSS in an isolated snapshot
  (`vite build`, serve `web/dist/assets/*.css` + minimal HTML, Playwright
  screenshot) — avoids booting the server (which could trip the bank rate limit).
  To exercise live React behaviour, `pnpm dev` is safe (scheduler only fires on
  the 60-min interval).
