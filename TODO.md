# Ledger — backlog

> **Goal / north-star:** Ledger is a **budgeting app to save money and clear debts**, and to reassure me I'm **not spending more than I have**. Every screen should help answer: *What's my balance? What's my budget? What's going out? Am I on track this month?* Judge features against this — historical curiosities that don't drive saving, debt payoff, or spend-safety are low value.

Running todo of planned features. Newest ideas at the bottom; check off when shipped.

## Value-ranked roadmap (2026-06-12)

Single descending-value ordering from the competitive review (full analysis +
feature matrix + nav IA in [`docs/budget-app-research.md`](docs/budget-app-research.md)).
Value = impact on the north-star (save money, clear debts, spend-safety). Build
items marked `↓` are detailed in the P0/P1/P2 sections below; items marked `★` are
**new** from this review (not yet specified anywhere else).

**Tier 1 — core budgeting loop (highest value; this is the north-star).**

- [ ] **Month-specific budget allocations** `↓P0` — the headline gap; foundation for everything envelope-shaped.
- [ ] **Category rollover balances** `↓P0` — turns category budgeting into real envelope budgeting.
- [ ] **Variable spend in Upcoming (learned estimates)** `↓` — makes safe-to-spend honest, not just fixed-bill-aware.
- [ ] **In-app insights / review queue** `↓P1` — converts signals you already generate into spend-safety reassurance; cheapest high-leverage win.

**Tier 2 — "will I survive to payday" + saving.**

- [ ] **Category goals / target dates** `↓P1` — the saving half of the north-star.
- [ ] **Cash-flow forecast view** `↓P1` — answers the question Ubank/Origin answer and you don't.
- [ ] **Reviewed state + "Needs review" filter** `↓P1` — turns sync into a daily workflow.

**Tier 3 — trust, portability, IA polish.**

- [ ] **CSV export** `↓P1` — #1 "can I get my data out?" trust signal; trivial.
- [ ] **CSV import (manual accounts only)** `↓P1`.
- [ ] ★ **Promote Budget to a top-level nav link** — every tabbed competitor (Monarch/Copilot/YNAB/Origin) makes Budget top-level; "Spending ▾ → Budget" slightly demotes the north-star surface. Trial Budget as a bare `NavLink` (keep Recurring/Reports grouped). Low effort, in `App.tsx`/`MobileNav.tsx`.
- [ ] ★ **Recurring/Bills as a first-class surface** — once the Upcoming/forecast work lands, give it an IA home one level under Spending (Monarch has a Recurring tab; Ubank a Bills tab).

**Tier 4 — restraint: question over-built surfaces (value = reclaimed focus/cost).**

- [ ] ★ **Review person/people attribution** — household-split machinery wired through txns/budgets/reports/rules/merchants in a single-user, no-auth app. Decide: keep, or quietly retire to cut maintenance surface. No competitor needs this without real logins.
- [ ] ★ **Cap Gemini usage; keep receipts as the signature feature** — receipt/email parsing is your only 0/6-competitor differentiator but the heaviest consumer of the ~20 req/day budget. Add a guardrail/priority so receipts never starve categorisation; don't expand AI surfaces beyond it.
- [ ] ★ **Reconsider investment-provider integrations** — net-worth-grade investment tracking is wealth-app scope (Origin/Copilot/Monarch). Evaluate whether manual values cover ~80% at a fraction of the upkeep before extending provider support.

**Tier 5 — lower value / high effort / explicitly deferred.**

- [ ] **Debt payoff simulator** `↓P2` — already deeper than every competitor; low marginal value.
- [ ] **Advanced search + saved views** `↓P2`.
- [ ] **Split transactions** `↓P2` — after budget allocations.
- [ ] **FX conversion + home currency** `↓P2` — only if non-GBP holdings matter.
- [ ] **Notification channels** `↓P2` — after insights exist.
- [ ] **Local API + docs** `↓P2`.
- [ ] **Native mobile app** ★ — the only gap no competitor shares, but Telegram + responsive web soften it; high effort, deferred under the single-user constraint.

## Ideas under review (2026-06-13 — from a budgeting-app video, Caleb Hammer / DollarWise)

- [ ] **Relook at how we handle income.** Today income is *auto-detected* per account from income-categorised credits (median, outlier-resistant) with no way to just say "my income is £X/month". The video's app has a manual **Estimated Income** override (amount + frequency) that directly drives Safe-to-Spend. Consider: a user-set income baseline/override that takes precedence over (or seeds) detection, a clear "detected vs set" indicator, and frequency options (monthly/4-weekly/weekly). Ties into safe-to-spend accuracy — the north-star reassurance number.
- [ ] **50/30/20 Needs/Wants/Savings overlay.** A presentation layer over budgets: tag each category group as Needs / Wants / Savings, set target percentages (default 50/30/20), show Plan vs Actual % with a donut. Not a new budgeting engine — it rides on the existing category groups. The 50/30/20 rule is a mainstream framework (Elizabeth Warren & Amelia Warren Tyagi, *All Your Worth*, 2005), not unique to any app, so it's safe to adopt as an optional lens. Decide whether it complements or competes with envelope/rollover budgeting before building.

## Architecture / platform (2026-06-12)

Structural work to take Ledger from a single flat package to a proper monorepo
with a standalone API, a real job queue, and room for a native mobile client.
Lower direct north-star value than the budgeting loop above, but they're
**enablers** — the mobile app (Tier-5 gap) and reliable background sync depend on
them. Sequence matters: do them top-to-bottom (each builds on the last).

**Current state (baseline):** one root `package.json` (`type: module`,
pnpm@10.32.1) holds API + web + Prisma deps together; no `pnpm-workspace.yaml`;
`web/` has no own package (root `vite.config.ts` + root `tsconfig.json` `include`
web/src, shared, server); API runs via `tsx server/index.ts`; sync is an
in-process scheduler (`server/lib/scheduler.ts`) on a 60-min interval; one
`Dockerfile`; deployed on Railway.

### 1. Convert to a Turborepo (pnpm workspaces + Turbo)

- [ ] **Add workspaces + Turbo** — `pnpm-workspace.yaml` (`apps/*`, `packages/*`), root `turbo.json` with `build`/`dev`/`lint`/`test`/`typecheck` pipelines and proper `dependsOn`/`outputs` caching. Keep pnpm as the package manager.
- [ ] **Extract `packages/shared`** — move `shared/*` (DTOs `types.ts`, `merchantName.ts`, …) into a workspace package `@ledger/shared` with its own `tsconfig`/`exports`; replace the deep relative imports (`../../../shared/types.ts`) across web + server with the package specifier.
- [ ] **Extract `packages/db`** — move `prisma/` + the generated client into `@ledger/db` that owns the schema, `prisma generate`, the hand-applied SQL migrations (`scripts/migrations/*`), and exports a singleton `PrismaClient`. Both API and worker import from here.
- [ ] **Split root `tsconfig`** — replace the single root config that `include`s everything with per-package configs + a root solution config (project references). Preserve `noUnusedLocals`.
- [ ] **Per-package build/test** — each app/package gets its own `build`/`typecheck`/`test` scripts wired into Turbo; verify `pnpm turbo build` and `pnpm turbo typecheck` pass repo-wide.

### 2. Separate the API into a dedicated app

- [ ] **`apps/api`** — move `server/*` into `apps/api` with its own `package.json` (Express, Prisma client via `@ledger/db`, Gemini, GoCardless, S3, Telegram), own `tsconfig`, own `dev`/`build`/`start`. Strip API-only deps out of the root manifest.
- [ ] **`apps/web`** — move `web/` + root `vite.config.ts` into `apps/web` with its own `package.json` (React 19, Vite 8, router, query, nuqs, recharts) and `tsconfig`; web imports types only from `@ledger/shared`, never from the API package.
- [ ] **Split the Dockerfile** — separate API and web build/runtime images (or a multi-target Dockerfile); update Railway services so API and web (static) deploy independently. Document the env split.
- [ ] **CORS/proxy** — once API and web are separate origins, add CORS config on the API and a Vite dev proxy so local `pnpm dev` still works seamlessly.

### 3. Proper queue system (replace the in-process scheduler)

- [ ] **Pick the broker** — default **pg-boss** (Postgres-backed: no new infra, reuses the Railway DB, durable jobs/retries/cron); **BullMQ + Redis** as the alternative if/when throughput demands it. Decide and record in `docs/ARCHITECTURE.md`.
- [ ] **`apps/worker`** — a dedicated worker process (separate Railway service) that owns all background jobs; the API only *enqueues*. Jobs: per-account bank sync, Gmail sync, Gmail `users.watch` renewal, reconcile, `rematchOpenOrders`, AI categorisation, receipt parsing.
- [ ] **Migrate the scheduler** — replace `server/lib/scheduler.ts`'s interval loop with queue **cron/repeatable jobs**; keep the same cadence but gain retries, backoff, visibility, and crash-safety. Remove the in-process timer from the API.
- [ ] **Gemini rate-limit as a queue concern** — model the ~20 req/day free-tier limit as a **rate-limited queue** (concurrency 1 + a daily token/limiter) so AI jobs self-throttle and *resume across days* instead of ad-hoc guards in app code. This is the cleanest home for the systemic bottleneck.
- [ ] **Job observability** — persist job runs alongside the existing `SyncRun` audit log (or unify them); surface queue health (pending/failed/last-run/next-run) on the Plugins page.

### 4. Scaffold the mobile app repo (`apps/mobile`)

- [ ] **Scaffold Expo (React Native)** — `apps/mobile` as an Expo + TypeScript app inside the monorepo, consuming `@ledger/shared` types and the same API over HTTPS. Expo for fastest path to iOS/Android + OTA updates.
- [ ] **Auth/access decision** — the app is currently no-auth on a trusted network; a mobile client over the public internet needs at least a device token / shared secret. Decide the minimal access model before shipping anything that talks to the API remotely.
- [ ] **Thin first slice** — start read-only: Dashboard (safe-to-spend) + Transactions list + quick-add expense (the Telegram-bot capture flow, native). Prove the shared-types + API contract before porting more surfaces.
- [ ] **Reuse the API contract** — no GraphQL/BFF yet; the existing REST routes + `@ledger/shared` DTOs are the contract. Revisit a mobile-specific aggregation endpoint only if round-trips become a problem.

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

### Next up (requested 2026-06-10)

- [ ] **Variable spend in Upcoming (learned estimates)** — beyond fixed bills, project *variable* recurring spend (groceries, fuel, eating out) as **estimates** learned from the trailing monthly average per merchant/category. Model each as `estimated remaining this month = max(0, avgMonthly − spentSoFarThisMonth)`, dated ~month-end. Add an `estimated` flag on schedules + upcoming items; show with a "~" / distinct style; **include by default with a toggle to exclude estimated projections** from Upcoming + safe-to-spend. (Extends RecurringSchedule + `/api/upcoming`.)
- [x] **Receipts (Telegram + Gemini vision)** — snap a receipt to the Telegram bot → Gemini vision extracts it → stored as `EmailOrder` (`source:"telegram"`) → `rematchOpenOrders`. Orders space renamed **Receipts** (camera icon for snapped ones).
- [x] **Document storage (Railway bucket)** — original receipt photos/PDFs uploaded to S3-compatible object storage (`lib/storage.ts`); `EmailOrder.attachmentKey`; `GET /api/orders/:id/file` → signed URL; "View receipt ↗" in the detail. *(Next: also store statements/invoices; a general Documents space.)*
- [x] **Receipt → transaction (cash)** — a scanned receipt with no matching bank charge creates a provisional cash transaction so the spend shows now; `reconcileReceiptProvisionals` moves it onto the real bank charge (and deletes the provisional) when it syncs, so card purchases don't double-count.
- [x] **Telegram as a plugin** — Plugins page Telegram card (webhook status, receipts captured, Register-webhook action); `POST /api/plugins/telegram/register`. Code reads `TELEGRAM_BOT_KEY` as an alias for `TELEGRAM_BOT_TOKEN`.

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
