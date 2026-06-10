# Ledger competitive product research

Research date: 2026-06-10. Scope: Ledger is a single-user web app in this repository, backed by Express, Prisma/Postgres, React, GoCardless open banking, Gemini, Gmail, and investment provider APIs.

## Current capabilities

### Dashboard and summary

- Dashboard route `/` shows account balances, spending by category, monthly income/spend totals, and top merchants, with an account selector and streamed "Sync now" audit sheet.
- Summary API `/api/summary` calculates current-month income, expenses, net, savings rate, available liquid cash, and configurable net worth composition: liquid cash plus optional investments/assets minus optional debts.
- Mobile navigation and responsive table/card layouts are shipped.

### Bank connectivity and sync

- GoCardless bank connection flow: institution search, connect redirect, callback finalization, requisitions, accounts, balances, and transactions.
- Bank sync supports streaming audit events, incremental account updates, new transaction summaries, balance-change events, and a unified `SyncRun` history.
- `POST /api/sync/all` exists for headless bank/Gmail/investment sync; cron/Trigger.dev wiring is still open.
- Bank removal deletes local transactions/balances and attempts remote requisition deletion.

### Accounts and manual accounts

- Accounts page separates bank/cash from wealth surfaces; bank accounts can be renamed, reconnected, removed, marked personal/business, and configured for preferred balance type.
- Manual cash accounts can be added, renamed, rebalanced, marked personal/business, and deleted.
- Per-account recurring outgoings are calculated from fixed recurring merchants and shown as "maintain ~GBP/month" guidance.
- Manual transactions can be added only to manual accounts, with date, sign, amount, category, and note.

### Transactions and categorisation

- Transactions page supports search, account filter, person filter, month filter, merchant filter, uncategorised filter, flagged-only filter, and bulk category assignment.
- Each transaction can be recategorised, assigned to a person, annotated, flagged red/orange/yellow for reduction, linked/unlinked as a debt repayment, or deleted if manual.
- "Apply to matching" learns/updates a merchant rule for category and/or person and applies it across matching transactions.
- Reconcile pipeline applies rules and Gemini categorisation, streams a detailed audit trail, learns merchant rules from LLM picks, and preserves manual category overrides.

### Budgeting

- Budget page is a monthly category budget view with category groups, monthly budget amounts, spent, left, percent used, trend from last month, hidden-empty toggle, person filter, and deep links into matching transactions.
- Categories can be created, edited, archived, grouped, sorted, and assigned flat monthly amounts.
- Budget summary shows available-to-budget as liquid bank/cash balance minus total monthly budgeted, plus current-month spend, last-month spend, income, and pending count.
- Per-category info shows current monthly amount, last month's budget/spend, and a calculated carry-forward, but budgets are not versioned by month and carry-forward/goals are not persisted or applied.

### Reports and analytics

- Reports page provides a selected-month income/expenses/net/savings-rate summary.
- Spending matrix groups spend by category and person, includes person totals and grand total, and uses visual bar lists.
- Dashboard adds monthly income/spend trend, category breakdown, and top merchant visuals.
- There is no long-range cash-flow forecast, configurable report builder, or alerting.

### Merchants, rules, and recurring spend

- Merchants page groups transactions by normalized merchant token, shows raw statement, friendly name, logo domain, owning account, order count, total spend, transaction count, months active, last date, category/person suggestion or rule, and monthly typical spend.
- Merchant recurrence is auto-classified as fixed, variable, or one-off using months active, frequency, and amount variance; user can override to fixed/variable/ignore.
- Fixed recurring total and variable monthly total are surfaced.
- Merchant edits can save name/domain, category/person rule, priority, and recurring override; auto-detected categories can be confirmed into rules in bulk.

### Orders, receipts, and Gmail plugin

- Gmail plugin supports OAuth connect/disconnect, sync status, parsed order counts, matched counts, last sync time, and recent sync-run history.
- Gmail sync fetches order/receipt emails incrementally, uses Gemini extraction, stores items/tags/refund status/order number/total/currency, and fuzzy-matches orders to transactions.
- Orders page supports search and tabs for all/matched/unmatched/refunds, with detail dialog.
- Matched orders appear on transactions and merchant detail; matching can add a short note to the transaction.
- Near-real-time Gmail polling is available through unified sync; true Gmail `users.watch` + Pub/Sub is still open.

### Savings / pots

- Savings page manages pots that earmark existing liquid cash without changing net worth.
- Pots have name, emoji, target, balance, note, sort order, add/take moves, edit, delete, and available-to-assign guardrails.
- Pots calculate liquid cash, allocated pot balances, total budgeted category money, available amount, and unallocated amount.
- Pots are not tied to recurring transfers, transaction rules, deadlines, or forecasted contributions.

### Investments, assets, debts, and net worth

- Investments page shows configured providers, sync action, investment accounts, cash/invested/total/P&L, holdings, symbols, prices, values, and currencies.
- Trading212-style and crypto provider support is modeled through provider keys and normalized holdings.
- Assets page manages manual asset accounts: add, rename, set value, delete; assets can be included in net worth via settings.
- Debts page manages liability accounts with balance owed, interest rate, priority, target payment, excluded flag, repayments, paid total, original amount, average monthly repayment, projected months, and custom/snowball/avalanche ordering.
- Debt repayments can be recorded from a manual cash account or linked from existing transactions; linking marks them as transfers and reduces the liability balance.

### People and shared expense attribution

- People page manages person records with key/name/sort order/archive.
- Transactions, budgets, reports, rules, and merchants can assign/filter/summarize by person.
- This is per-person split/attribution inside a single-user app, not household login/collaboration.

### Settings and automation

- Settings drawer exposes boolean feature flags, currently including net worth inclusion settings.
- Unified sync-log records source, status, timings, summary, error, and audit log.
- No first-party CSV import/export, public API, webhook system, push/email alerts, mobile apps, authentication, or multi-user account model by design.

## Competitive parity matrix

Legend: `✓` strong/native, `partial` meaningful but limited, `✗` absent/not core. Money Dashboard is treated as legacy UK context; the active UK comparator here is Emma, since Money Dashboard permanently closed on 2023-10-31.

| Capability | Ledger | YNAB | Monarch | Copilot | Actual | Lunch Money | Rocket Money | PocketSmith | Emma / Money Dashboard UK |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Envelope / zero-based budgeting | partial | ✓ | partial | partial | ✓ | partial | partial | partial | partial |
| Month-specific budgets and rollover | partial | ✓ | ✓ | ✓ | ✓ | ✓ | partial | ✓ | partial |
| Category goals / targets | partial | ✓ | ✓ | partial | partial | partial | partial | ✓ | ✓ |
| Rules / auto-categorisation | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | partial | ✓ | ✓ |
| AI categorisation | ✓ | partial | partial | ✓ | ✗ | ✗ | partial | ✗ | partial |
| Recurring bills / subscriptions | partial | partial | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Upcoming bills / calendar | ✗ | partial | ✓ | partial | ✓ | ✓ | ✓ | ✓ | ✓ |
| Cash-flow forecasting | ✗ | partial | partial | partial | partial | ✓ | partial | ✓ | partial |
| Net-worth tracking | ✓ | ✓ | ✓ | ✓ | partial | ✓ | ✓ | ✓ | ✓ |
| Investment tracking | partial | partial | ✓ | ✓ | ✗ | partial | ✓ | partial | ✓ |
| Assets and liabilities | ✓ | partial | ✓ | ✓ | partial | ✓ | ✓ | ✓ | ✓ |
| Debt payoff planning | ✓ | ✓ | partial | partial | partial | partial | partial | partial | partial |
| Savings goals / pots | ✓ | ✓ | ✓ | partial | ✓ | partial | ✓ | ✓ | ✓ |
| Multi-currency | partial | partial | partial | partial | ✓ | ✓ | partial | ✓ | partial |
| Shared household / collaboration | partial | ✓ | ✓ | partial | partial | ✓ | partial | ✓ | ✓ |
| Native mobile apps | ✗ | ✓ | ✓ | ✓ | partial | partial | ✓ | ✓ | ✓ |
| Reports / analytics | partial | ✓ | ✓ | ✓ | ✓ | ✓ | partial | ✓ | ✓ |
| Receipts / email order parsing | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | partial |
| Bank sync coverage | partial | ✓ | ✓ | ✓ | partial | ✓ | ✓ | ✓ | ✓ |
| Manual accounts / transactions | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | partial | ✓ | ✓ |
| Alerts / notifications | ✗ | partial | ✓ | ✓ | partial | partial | ✓ | ✓ | ✓ |
| CSV import/export | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | partial | ✓ | partial |
| API / automation | partial | ✓ | ✗ | ✗ | ✓ | ✓ | ✗ | ✓ | ✗ |
| Search | partial | ✓ | ✓ | ✓ | ✓ | ✓ | partial | ✓ | ✓ |
| Receipt item-aware categorisation | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |

## Gap analysis

### Forecasting and scheduled cash flow

Ledger is behind PocketSmith, Actual, Monarch, Lunch Money, and Emma on upcoming bills, budget calendar, and cash-flow projection. This matters because users do not only ask "what happened"; they ask "will this account survive rent, subscriptions, and payday?" Ledger already detects fixed merchants and per-account recurring commitments, so the missing piece is a persisted schedule/forecast model and a UI. Hardness: medium. Prisma models for `RecurringSchedule` and generated forecast rows, plus a `/api/forecast` route and a compact page or dashboard panel, fit the stack cleanly.

### Budget rollover, month-specific budgets, and goals

Ledger looks YNAB-like but currently stores one `Category.monthlyAmount`, so historical budgets mutate when a category changes and carry-forward is only a calculated hint. This is the biggest parity gap against YNAB, Actual, Copilot, and Lunch Money because rollover is what turns category budgeting into envelope budgeting. Hardness: medium-high. It needs new tables such as `BudgetMonth`, `BudgetAllocation`, and maybe `CategoryGoal`, plus migration logic from existing flat monthly amounts.

### Recurring/subscription workflow

Ledger can classify fixed/variable merchants and compute committed monthly totals, but it does not expose next due date, cadence, expected amount ranges, renewal warnings, cancellation status, or "review this subscription" actions. This matters because Rocket Money, Monarch, Copilot, PocketSmith, Lunch Money, and Emma all make recurring spend a front-door feature. Hardness: medium. Existing merchant aggregation supplies the seed data; add user-confirmed schedules, due-date inference, and a `Subscriptions`/`Upcoming` view under Merchants or Dashboard.

### Insights, alerts, and review loop

Ledger has useful raw signals: new transactions, pending count, balance changes, overspent budget categories, flags, sync logs, unmatched orders, and recurring merchant changes. It does not convert them into alerts, tasks, notifications, or a daily review queue. This matters because leading apps reduce attention cost by telling users what needs action. Hardness: low-medium for in-app alerts; medium if adding email/push. A local `Insight` table and deterministic generators run after sync would be enough for a single-user app.

### Import/export, portability, and automation

Ledger has headless sync endpoints and internal APIs, but no CSV import/export, backup/restore, or documented local API. Actual, Lunch Money, PocketSmith, YNAB, Monarch, and Copilot all provide stronger portability or integrations. This matters for trust: personal finance users need to know they can get data in and out. Hardness: low-medium. CSV export can be a simple server route over transactions/categories/accounts; import needs mapping UI and duplicate detection but can start narrow.

### Search and transaction workflow depth

Ledger transaction search is useful but limited to merchant/creditor/remittance text and separate filters. It lacks saved views, reviewed/cleared state, tags beyond order tags, advanced queries, split transactions, attachments, and cross-entity global search. This matters because transaction clean-up is the daily power-user workflow in YNAB, Monarch, Copilot, Actual, Lunch Money, and PocketSmith. Hardness: low for reviewed state and saved filters; medium for split transactions because it changes reporting, budgets, and reconciliation.

### Bank coverage and reliability

Ledger is intentionally UK/EU-centric through GoCardless read-only open banking. That is fine for the product, but it trails US-centric apps on institution coverage and trails mature apps on scheduled sync reliability, stale connection handling, and user-visible sync health. Hardness: low for scheduled sync wiring and connection-expiry alerts; high for additional aggregators because it adds vendor complexity and normalization.

### Mobile and collaboration

Ledger is responsive but has no native mobile app, push notifications, widgets, or offline mode. It has people attribution but no partner login, household permissions, or advisor workflows by design. This matters only if Ledger wants to compete outside the single-user/local-first niche. Hardness: high for native apps/auth/collaboration; low priority given the stated single-user constraint.

### Multi-currency

Ledger stores currency on accounts, balances, transactions, orders, and holdings, but summaries and budgets assume GBP-style presentation and do not apply FX conversion. PocketSmith and Lunch Money are much stronger here. This matters if the user has non-GBP accounts or investments. Hardness: medium: add FX rate table, home-currency setting, conversion helpers, and report toggles.

## Prioritised next-task backlog

### P0

1. **Persist month-specific budget allocations.** Add `BudgetAllocation(categoryId, month, amount)` and migrate current `Category.monthlyAmount` into the current month; update `/api/budget`, `/api/budget/category/:key`, `Budgets.tsx`, and `Pots.tsx` to read the selected month instead of the flat category amount. This unlocks historical accuracy and is the foundation for real rollover.

2. **Add category rollover balances.** Extend the budget API to calculate `available = prior balance + allocated - spent`, persist month opening balances or derive them deterministically, and show rollover/overspend explicitly in `Budgets.tsx`. Quick win: start with derived rollover from historical allocations before adding manual money moves.

3. **Create recurring schedule records from merchant detection.** Add a `RecurringSchedule` model seeded from fixed merchants, with merchant token, accountId, expected amount, cadence, next due date, confidence, and ignored flag. Use existing `/api/merchants` classification and expose confirm/edit/ignore controls in `Merchants.tsx`.

4. **Wire scheduled sync in deployment.** Point cron/Trigger.dev at `POST /api/sync/all` and add a visible "last full sync / next sync" status on `Plugins.tsx` or Dashboard. This is already called out in `TODO.md` and is a high-confidence reliability win.

5. **Build an Upcoming panel.** Add `/api/upcoming` from confirmed recurring schedules plus forecasted paydays if available, then show next 30 days of expected bills/income on Dashboard and Merchants. This directly competes with Monarch/PocketSmith/Actual without a large new app surface.

### P1

1. **Cash-flow forecast view.** Add a Reports tab or `/forecast` page that projects account balances using current balances, recurring schedules, confirmed income schedules, and manual one-off forecast items. Use the existing monthly chart components first; daily calendar can follow.

2. **Category goals and target dates.** Add `CategoryGoal` or fields on category/allocation for monthly target, target balance, due date, and needed-per-month; surface progress in `Budgets.tsx` and optionally link pots to category goals. This closes the YNAB/Monarch/Copilot savings-target gap.

3. **In-app insights queue.** Generate deterministic insights after sync: new uncategorised transactions, overspent categories, low balances versus recurring commitments, unmatched high-value orders, new subscriptions, large merchant changes, and failed syncs. Store them in an `Insight` table and add a Dashboard review widget.

4. **CSV export for transactions/accounts/categories/orders.** Add `/api/export/transactions.csv` and adjacent exports with current filters from `Transactions.tsx`; include effective category, person, notes, flags, order fields, and account display name. This is a quick trust win and makes Ledger safer to rely on.

5. **CSV import for manual/offline accounts.** Add a small import page under Accounts or Transactions with column mapping, preview, duplicate detection by date/amount/description, and import into a selected manual account. Start with manual accounts only to avoid corrupting bank-synced data.

6. **Reviewed state and review filters.** Add `reviewedAt` or `reviewed` to transactions, default bank-synced transactions to unreviewed, and add a "Needs review" filter/action in `Transactions.tsx`. This turns sync into a daily workflow instead of a passive feed.

7. **True Gmail push monitoring.** Implement Gmail `users.watch`, Pub/Sub webhook, renewal job, and webhook-to-sync-run logging. The parsing/matching engine already exists, so this mainly improves freshness and removes polling dependency.

### P2

1. **Advanced search and saved views.** Extend `/api/transactions` with amount ranges, categories, flags, reviewed state, notes, order tags, and split person filters; save query presets in settings or a `SavedView` table. This improves power-user cleanup without changing financial logic.

2. **Split transactions.** Add transaction split rows with category/person/amount/note, update effective-category reporting and budget math, and provide a split editor in `Transactions.tsx`. This is high value but touches many aggregates, so it should follow budget allocation work.

3. **FX conversion and home currency.** Add a home-currency setting, `FxRate` table, conversion helper, and report/budget summaries in home currency while preserving original transaction currencies. This matters for multi-currency investments/accounts but is not urgent for a GBP-first app.

4. **Debt payoff simulator.** Extend `Debts.tsx` beyond current projected months with extra-payment scenarios, interest saved, payoff date comparison, and schedule export. Existing snowball/avalanche ordering and APR fields make this tractable.

5. **Notification channels.** After the insights queue exists, add email/Telegram notifications for failed syncs, low balances, upcoming bills, and unusual spend. Keep notification preferences in `Setting` rows.

6. **Local API/docs page.** Document existing API endpoints and add token-based local access only if needed. Useful for automation-minded users, but lower priority than CSV export because the app is single-user.

## Source notes

- Repo files inspected: `TODO.md`, `web/src/App.tsx`, `shared/types.ts`, `web/src/pages/*.tsx`, `web/src/api.ts`, `server/routes/*.ts`, and `prisma/schema.prisma`.
- Competitive references checked: [YNAB features](https://www.ynab.com/features), [Monarch](https://www.monarch.com/), [Copilot](https://www.copilot.money), [Actual Budget docs](https://actualbudget.org/docs/), [Lunch Money features](https://lunchmoney.app/features), [Rocket Money](https://www.rocketmoney.com/), [PocketSmith features](https://www.pocketsmith.com/features/), [Emma](https://emma-app.com/), and [Money Dashboard closure context](https://en.wikipedia.org/wiki/Money_Dashboard).
