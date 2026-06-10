# Ledger — backlog

> **Goal / north-star:** Ledger is a **budgeting app to save money and clear debts**, and to reassure me I'm **not spending more than I have**. Every screen should help answer: *What's my balance? What's my budget? What's going out? Am I on track this month?* Judge features against this — historical curiosities that don't drive saving, debt payoff, or spend-safety are low value.

Running todo of planned features. Newest ideas at the bottom; check off when shipped.

## Open

### Done

- [x] **Realtime Gmail monitoring** — Gmail `users.watch` + `POST /api/plugins/gmail/push` webhook (shared-secret) + bidirectional `rematchOpenOrders`. Live in production (topic `gmail-order`, watch armed). Setup steps: [`docs/gmail-realtime-setup.md`](docs/gmail-realtime-setup.md).
- [x] **Scheduled syncs** — in-process scheduler (`server/lib/scheduler.ts`) runs `runFullSync` every `SYNC_INTERVAL_MINUTES` (default 60), tagged `cron` in the sync log; renews the Gmail watch and re-matches open orders. No external cron needed.
- [x] **Bidirectional, timing-resilient order matching** — `rematchOpenOrders` links orders↔transactions from both sides (email-arrives and bank-transaction-arrives), refund-aware; runs after every bank sync and Gmail sync. Handles bank data lagging email by hours/days.

## Next — from competitive research (2026-06-10)

Full analysis (parity matrix vs YNAB / Monarch / Copilot / Actual / Lunch Money / Rocket Money / PocketSmith / Emma, gap themes, rationale) in [`docs/budget-app-research.md`](docs/budget-app-research.md). Headline gap: budgets aren't month-versioned (single `Category.monthlyAmount`), so rollover/goals are only hints — fixing that unlocks real envelope budgeting.

### P0

- [ ] **Month-specific budget allocations** — add `BudgetAllocation(categoryId, month, amount)`, migrate `Category.monthlyAmount` into the current month; read the selected month in `/api/budget`, `/api/budget/category/:key`, `Budgets.tsx`, `Pots.tsx`. Foundation for rollover.
- [ ] **Category rollover balances** — `available = prior balance + allocated − spent`, persist/derive month opening balances, show rollover/overspend explicitly in `Budgets.tsx`. (Quick win: derive from history before manual money-moves.)
- [x] **Recurring schedules from merchant detection** — `RecurringSchedule` model + `detectSchedules()` (bills + income, refund-aware) + `/recurring` page (confirm/ignore/edit/re-detect). Re-detected on every full sync.
- [x] **Wire scheduled sync** — in-process scheduler (`SYNC_INTERVAL_MINUTES`); also renews Gmail watch.
- [x] **Upcoming panel** — `/api/upcoming` (next-30-days bills + income, this-month totals) + reusable `Upcoming` component on Dashboard and `/recurring`.
- [x] **Dashboard redesign (safe-to-spend)** — month-scoped; safe-to-spend hero (`in bank − bills due − pots`), projected income + payday + projected month-end balance, stat row, debt/savings goal cards, month-scoped category bar list (donut + top-merchants removed), budget-by-group, cash-flow trend, balances.

### P1

- [ ] **Cash-flow forecast view** — `/forecast` projecting balances from current balances + recurring + income + one-offs (reuse monthly chart first; daily calendar later).
- [ ] **Category goals / target dates** — monthly target, target balance, due date, needed-per-month; progress in `Budgets.tsx`; optionally link pots to goals.
- [ ] **In-app insights queue** — deterministic post-sync `Insight` rows (new uncategorised, overspent, low balance vs commitments, unmatched high-value orders, new subscriptions, failed syncs) + Dashboard review widget.
- [ ] **CSV export** — `/api/export/transactions.csv` (+ accounts/categories/orders) honouring current `Transactions.tsx` filters; effective category/person/notes/flags/order fields.
- [ ] **CSV import (manual accounts only)** — mapping + preview + duplicate detection by date/amount/description; import into a chosen manual account.
- [ ] **Reviewed state** — `reviewed`/`reviewedAt` on transactions, bank-synced default to unreviewed, "Needs review" filter/action in `Transactions.tsx`.

### P2

- [ ] **Advanced search + saved views** — amount ranges, categories, flags, reviewed, notes, order tags in `/api/transactions`; `SavedView` presets.
- [ ] **Split transactions** — split rows (category/person/amount/note); update effective-category reporting + budget math. *(Do after budget allocations.)*
- [ ] **FX conversion + home currency** — `FxRate` table, home-currency setting, conversion helpers, report/budget summaries in home currency (keep original txn currency).
- [ ] **Debt payoff simulator** — extra-payment scenarios, interest saved, payoff-date comparison in `Debts.tsx` (builds on existing snowball/avalanche + APR).
- [ ] **Notification channels** — after insights exist: email/Telegram for failed syncs, low balances, upcoming bills, unusual spend; prefs in `Setting`.
- [ ] **Local API + docs** — document existing endpoints; optional token auth. *(Lower priority — single-user.)*

## Done

- [x] **Unified sync-log** — `SyncRun` table records every sync (bank/gmail/all): timings, status, summary, and the full audit trail incl. Gemini inputs + raw responses. `GET /sync/runs` history + "Recent syncs" on Plugins. `POST /sync/all` headless run.
- [x] **Mobile** — hamburger nav drawer below 760px; responsive padding, wrapping toolbars, scrollable table cards.
- [x] **Dashboard + Reports refresh** — BarList visuals; top merchants as a logo'd bar list; Reports top-categories/by-person bars + cleaner matrix.
- [x] **Accounts/Wealth IA** — Accounts = bank+cash only (labels dropped, actions in a kebab menu, dialogs not prompts); Assets get their own `/assets`; investments de-duped (own space only).
- [x] **Actual merchant logos** — per-merchant `domain` (editable + Gemini-populatable) → real brand logo with monogram fallback.
- [x] **Orders as first-class** — dedicated `/orders` page with search + filter tabs; order tags; refund detection & credit matching; incremental Gmail cursor (`after:`); order detail dialog; match writes a short note.
- [x] **Gmail order-tracking** (Plugins) — OAuth, Gemini extraction, fuzzy match to transactions (merchant-relation gated), receipt tag + items on transactions, item-aware categorisation, merchant order history.
- [x] **Savings / Pots** (Wealth) — YNAB-style envelopes earmarking liquid cash; available-to-assign after budgets.
- [x] Per-account recurring "maintain ~£/mo"; account grid of cards; Budget/Wealth nav dropdowns; incremental bank sync + balance-change flash.

## Notes / awaiting quota

- `pnpm tsx scripts/name-merchants.ts` and `scripts/name-merchant-domains.ts` finish merchant names + logo domains, but Gemini's free-tier (20 req/day) was exhausted — re-run when it resets.
