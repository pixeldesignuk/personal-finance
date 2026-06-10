# Ledger — backlog

Running todo of planned features. Newest ideas at the bottom; check off when shipped.

## Open

- [ ] **Realtime Gmail monitoring** — *code shipped* (Gmail `users.watch` + `POST /api/plugins/gmail/push` webhook + auto-renewal in `/sync/all` + bidirectional `rematchOpenOrders`). **Activation pending:** Google Cloud Pub/Sub setup + `GMAIL_PUBSUB_TOPIC`/`GMAIL_PUSH_TOKEN` env vars — see [`docs/gmail-realtime-setup.md`](docs/gmail-realtime-setup.md). Until configured, stays near-realtime via the cron.
- [ ] **Wire scheduled syncs** — point a cron / Trigger.dev job at `POST /api/sync/all` (endpoint + unified sync-log already built; also renews the Gmail watch). *Deploy-side config only.*

### Done

- [x] **Bidirectional, timing-resilient order matching** — `rematchOpenOrders` links orders↔transactions from both sides (email-arrives and bank-transaction-arrives), refund-aware; runs after every bank sync and Gmail sync. Handles bank data lagging email by hours/days.

## Next — from competitive research (2026-06-10)

Full analysis (parity matrix vs YNAB / Monarch / Copilot / Actual / Lunch Money / Rocket Money / PocketSmith / Emma, gap themes, rationale) in [`docs/budget-app-research.md`](docs/budget-app-research.md). Headline gap: budgets aren't month-versioned (single `Category.monthlyAmount`), so rollover/goals are only hints — fixing that unlocks real envelope budgeting.

### P0

- [ ] **Month-specific budget allocations** — add `BudgetAllocation(categoryId, month, amount)`, migrate `Category.monthlyAmount` into the current month; read the selected month in `/api/budget`, `/api/budget/category/:key`, `Budgets.tsx`, `Pots.tsx`. Foundation for rollover.
- [ ] **Category rollover balances** — `available = prior balance + allocated − spent`, persist/derive month opening balances, show rollover/overspend explicitly in `Budgets.tsx`. (Quick win: derive from history before manual money-moves.)
- [ ] **Recurring schedules from merchant detection** — `RecurringSchedule` (merchant token, accountId, expected amount, cadence, next due, confidence, ignored) seeded from fixed merchants; confirm/edit/ignore in `Merchants.tsx`.
- [ ] **Wire scheduled sync + visible health** — cron/Trigger.dev → `POST /api/sync/all`; show "last full / next sync" on Plugins or Dashboard. *(dupes the open item above — same work.)*
- [ ] **Upcoming panel** — `/api/upcoming` from confirmed schedules (+ paydays); next-30-days expected bills/income on Dashboard.

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
