# Ledger — backlog

> **Goal / north-star:** Ledger is a **budgeting app to save money and clear debts**, and to reassure me I'm **not spending more than I have**. Every screen should help answer: *What's my balance? What's my budget? What's going out? Am I on track this month?* Judge features against this — historical curiosities that don't drive saving, debt payoff, or spend-safety are low value.

Running todo of planned features. Newest ideas at the bottom; check off when shipped.

## Painful things — daily-friction UX debt (2026-06-15)

Bugs/gaps that bite on real use. High value (they block the core daily loop of
reviewing + tidying transactions), so these jump the queue.

- [ ] **Can't edit a merchant from the transaction list.** Renaming/recategorising the merchant of a row should be possible inline (or via the row's menu/drawer) without leaving the list. Today there's no path from a transaction to "fix this merchant". (See `Transactions.tsx`, `TxnDrawer.tsx`, merchant rename flow in `Merchants.tsx`.)
- [ ] **Bank-app-style transaction feed (Emma-like).** Make the recent-transactions list closely resemble a polished banking/budgeting app feed like **Emma**: clean date-grouped rows, prominent merchant logo, merchant name + category/subtitle, right-aligned amount (red out / green in), subtle dividers, day subtotals, and tap-through to detail. Apply to both the Transactions page and the dashboard **Recent activity** card so they share one refined row component. Reference Emma's transaction list for spacing, hierarchy, and logo treatment. (See `web/src/pages/TransactionsHome.tsx`, `web/src/components/RecentActivity.tsx`, the `lrow`/`txnv2` styles.)
- [ ] **Transaction list is unusable on mobile.** The table doesn't reflow for small screens — columns overflow / get cut off. Needs a proper mobile layout (card/stacked rows, not a wide table), touch-friendly row actions, and the drawer/menu working at phone widths. Highest-traffic page, so this is the priority mobile fix. (See `Transactions.tsx` + responsive table CSS in `styles.css`.)
- [ ] 🐞 **Switching months on the Budgets page is very buggy.** Changing the selected month (`BudgetsHome.tsx` month strip → `useQueryState("month")`) misbehaves — investigate stale/optimistic data, the `["budget", month]` query keying, the fan/list/overspend memos recomputing, and the upcoming query (only enabled for the current month). Reproduce, then fix so month navigation is smooth and always shows that month's spend/budget/overspend correctly. (See `BudgetsHome.tsx`, `api.budget(month)`, `/api/budget` in `server/routes/budget.ts`.)
- [ ] **Annual budgets missing from the primary Budgets view.** The new Budgets page (`BudgetsHome.tsx`, now at `/budgets`) appears to list only categories with *spend*, dropping budgets that have an allocation but no/low monthly spend — notably **annual / non-monthly budgets** that showed in the v1 view (`Budgets.tsx`, `/budgets/v1`). Verify against v1, then ensure every budgeted category surfaces (incl. annual/quarterly cadences and zero-spend allocations), not just ones with transactions this month. (Compare the category list source in `BudgetsHome.tsx` vs `Budgets.tsx`; likely a filter that requires `spent > 0`.)
- [ ] 🔴 **URGENT — merchant matching/tokenisation is too fragile (foundational).** `merchantToken()` fragments one real merchant into many tokens because it doesn't strip card-payment references / PANs / dates — e.g. American Express becomes `american exp pb5284`, `american exp pb8439`, `american express first`, plus malformed `" | "` tokens (`american exp pb5284 | AMERICAN EXP 3773 PB5284******54630`). Because **token is the join key for everything** — merchant identity/name, logo domain, category rules, person attribution, recurring/bill detection, merchant grouping — fragmentation silently breaks all of them: the same merchant shows a logo on one row and a monogram on another, a category/rule learned on one token doesn't apply to the sibling tokens, and recurring detection misses bills split across tokens. Today's transactions logo resolver papers over it with a name→domain fallback; that's a band-aid. **Fix the root:** make tokenisation canonicalise a merchant robustly — strip reference codes (`PB####`, `3773`, masked PANs `******#####`), the `INT'L <ref>` markers (see the new `ruleMatchText`), trailing payment words, and the legacy `" | "` malformed tokens; consider a merchant-alias/canonical-id layer so variants map to ONE merchant. Backfill/re-key existing `Merchant` rows + rules. This underpins logos, budgeting accuracy, recurring detection, and safe-to-spend — high blast radius, so treat as foundational. (See `server/categorise/helpers.ts` `merchantToken`, `shared/merchantName.ts`, `server/lib/rules.ts` `ruleMatchText`/`normalizeText`, the `Merchant` model, and the pre-existing `" | "` malformed-token note in `CLAUDE.md`.)

  **Recommended approach (from 2026-06-16 statement-line-cleaner research).** Headline: there is **no drop-in library** that turns bank descriptors into clean merchant names, and commercial enrichment APIs (Ntropy, Plaid Enrich, MX, Heron, Yodlee…) are all enterprise per-transaction pricing with no real free tier — and **Plaid Enrich is US/CA only, not UK** — plus GDPR cost of shipping descriptors out. So **build a deterministic local cleaner; don't buy.** This also directly eases the Gemini ~20/day bottleneck by demoting AI naming to a *fallback*. Build a pure `cleanDescriptor(raw)` (fed via `rawMerchantName()`, respecting the empty-string gotcha) implementing the standard staged pipeline every engine converges on:
    1. **Normalise** — lowercase, NFKC, strip diacritics/non-printables, collapse whitespace, standardise separators; keep the raw string alongside (reversible mapping).
    2. **Regex-strip structured noise** (extract into fields, don't just delete): masked/partial PANs `\*{0,4}\d{4}`, sort codes `\d{2}-\d{2}-\d{2}`, UK acct `\d{8}` (near REF/PAYMENT), `ref/auth` codes `\b(?:ref|auth)[:\s]*[A-Z0-9-]{4,}`, dates, store IDs `#\d{3,}`/`store \d+`, phones, currency/country markers (`GBP/USD/EUR`, `GB/IE/US…`, `INT'L`), and split on Visa's `*`-suffix (tail = order/installment junk, not the name).
    3. **Strip noise tokens** (positional stop-list): `VISA, VISA DEBIT/CREDIT, MASTERCARD, MC, POS, PURCHASE, CARD PAYMENT, CONTACTLESS, ATM, CASH WITHDRAWAL, DIRECT DEBIT, DD, STANDING ORDER, SO, FPS, BGC, ONLINE, ECOM, MOTO, REF, AUTH, SEQ`. Keep the merchant token *after* gateway prefixes (`PAYPAL *`, `SQ *`, `STRIPE`, `SUMUP` → keep "netflix" etc.).
    4. **Canonicalise + brand dictionary** — strip legal suffixes with a ~15-entry regex (`/\b(ltd|plc|limited|inc|co|company|uk)\b\.?$/i`; replaces the Python `cleanco` lib), then match a small **UK brand alias→{canonical, category} map** (Tesco/Sainsbury's/Aldi/Lidl/Asda/M&S, Shell/BP/Esso, Greggs, Amazon/AMZN, Netflix/Spotify, O2/EE/Vodafone, British Gas/Octopus, TfL, Uber/Bolt…). This alone resolves the bulk of volume instantly and doubles as a categorisation source. Keep it as config/data (auditable-rules pattern), not hard-coded logic.
    5. **Fuzzy-cluster the tail** — ONE lightweight TS lib (`fastest-levenshtein`, MIT, tiny; or `fuse.js`), `token_set_ratio`-style at ~0.9 threshold, to map a new candidate onto an existing canonical merchant and stop near-duplicate proliferation. No ML.
    6. **User-override dictionary** — persist manual corrections and replay them on future transactions (the single-user superpower).
  Demote `autoNameMerchants()` (Gemini, `server/lib/merchantNaming.ts`) to the fallback for candidates that survive cleaning but miss the dictionary and have no fuzzy neighbour. Free data worth vendoring: **`mcc-codes`** (public-domain JSON) if the GoCardless feed carries an MCC (free categorisation); reference repos: `tx-normalizer` (TS), `ynab-israel-consolidator` (auditable rule pattern). Build it deterministic + offline so it degrades gracefully without the Gemini key.
- [ ] 🔴 **URGENT — complete refactor of the merchants + logos subsystem (holistic).** The tokenisation fix above is the root cause; this is the wider mandate to redesign **merchant identity + logo resolution as one coherent subsystem**, end-to-end, rather than patching symptoms. Today logo resolution is duplicated and inconsistent across surfaces (Merchants page, `/transactions`, dashboard) — each does its own directory/token/domain/name-fallback dance, which is why a brand can show a logo in one place and a monogram in another. Target: (1) a canonical merchant id / alias layer so all variants resolve to ONE merchant record; (2) a **single shared logo-resolution path** (one helper/service) consumed identically by every surface — no per-route reimplementations, no name→domain band-aid; (3) merchant `domain` resolution + brand-colour as part of that one pipeline; (4) backfill existing rows and delete the divergent inline resolvers. Pairs with the tokenisation item — do them together. (See `server/routes/merchants.ts`, `server/routes/dashboard.ts` logo block, `server/lib/merchantDirectory.ts`, `web/src/components/BrandLogo.tsx`, the `Merchant`/`LogoCache` models.)

  **Receipt / manual-entry path must canonicalise + fuzzy-match to an EXISTING merchant before creating a new one (2026-06-16 — concrete failure).** A Telegram receipt for **Chaiiwala** created a brand-new merchant because: (a) Gemini vision OCR'd the wordmark as **"chaiiwalala"** (extra letters — vision isn't perfect on stylised logos), and (b) `createReceiptTransaction` stores the raw extracted name verbatim with **no step that matches it to your existing merchants**. Even a perfect read wouldn't fully help — "Chaiiwala" is already fragmented into **5 records** (`chaiiwala`, `chaiiwala oldham oldham`, `chaiiwala rochdale ol11`, `chaiiwala traffomanchester`, plus an unrelated online `https order chai…` named "Chai") because `merchantToken` keeps branch/town words. **Fix:** run every incoming merchant name — from receipts (`geminiExtractReceiptImage`), text expenses (`geminiParseExpense`), AND bank lines — through the deterministic cleaner, then **fuzzy-match (e.g. `fastest-levenshtein`/`token_set_ratio` ≥ ~0.9) against the existing canonical merchant set and reuse it** instead of minting a new token. So "chaiiwalala" and "chaiiwala oldham oldham" both snap onto the one "Chaiiwala". This makes Gemini OCR slips self-correcting and is the missing link between the cleaner (above) and the merchant table. (See `server/lib/receiptTxn.ts` `createReceiptTransaction`, `server/categorise/gemini.ts`, and the merchant-token join key.)

## Overspending — clear, red, actionable (2026-06-16)

High north-star value (the "am I spending more than I have?" reassurance). Inspiration:
**YNAB** and **Snoop** both nail overspending — it's *unmissable* and *immediately
actionable*. YNAB surfaces a top-level "**1 Overspent category · Cover**" banner and
shows the category as bold red ("−£0.50", red-tinted bar) with a one-tap **Cover** to
move money and fix it. Snoop shows "**£1.71 over** / £33" in bold red with a fully
filled red progress bar and "Spent: £34.71". Adopt that clarity everywhere we show a
budget: bold red amount + filled red bar + a clear next action — never a quiet neutral bar.

- [ ] **Auto-flag a transaction that overspends its category.** When a transaction pushes its category over the month's budget, automatically set a flag (red/orange) on it so it stands out in the transaction list and lands in the review queue. The flag should clear if the budget is later raised or the spend drops back under. Make the *tipping* transaction (the one that crossed the line) identifiable. (See `flag` on transactions, `effectiveCategory`, budget math in `server/routes/budget.ts`, and the review queue in `TransactionReview.tsx`.)
- [ ] **Main dashboard budget card warns when overspending.** On the v2 dashboard, the budget / budget-by-group card should switch to a clear warning state (red, "£X over", red-filled bar) whenever any category or group is over budget — not just render a neutral progress bar. Summarise it ("1 category over by £1.71") and link through to the offending category. (See `DashboardHome.tsx`, the budget-by-group widget, `SpendBars`.)
- [ ] **Overspending treatment + action across all budget surfaces.** Make over-budget unmissable and actionable consistently across Budgets (`BudgetsHome.tsx`), the dashboard card, and category bar lists: bold red amount, filled red bar, "£X over / £Y", and pair it with an action à la YNAB's **Cover** — move money from another category / adjust the budget — so the user can *fix* the overspend, not just see it. Depends on month-specific allocations + rollover (Tier 1) to do "cover" properly, but the red-and-clear presentation can land first.

## Capture & Telegram UX (2026-06-16)

- [ ] **Richer "Add transaction" entry.** The add-transaction flow should offer three capture modes: (1) a **free-text prompt** ("£12 lunch at greggs") parsed by the existing Gemini cash-expense extractor (`geminiParseExpense`); (2) **capture receipt** (open camera) and (3) **upload receipt** (file picker) — both feeding the same receipt vision pipeline as the Telegram bot (`geminiExtractReceiptImage` → `createReceiptTransaction`). The form should also let you pick **income vs expense via a toggle switch** (currently expense-biased), flipping the amount sign and default category set. (See `web/src/components/AddTransaction.tsx`, the receipt pipeline in `server/telegram/receipt.ts` / `server/lib/receiptTxn.ts`, and `geminiParseExpense`/`geminiExtractReceiptImage` in `server/categorise/gemini.ts`.)
- [ ] **Telegram bot: stateful message feedback.** Use the Telegram Bot API to make the bot feel responsive while it processes a receipt/expense: add an emoji **reaction to the user's image/message reflecting state** (e.g. 👀 received/reading → ✅ saved, or ⚠️ couldn't read), and **delete its own interim "reading receipt…" progress messages** once the final result is posted (like a read-receipt). Needs `setMessageReaction` and `deleteMessage` calls; the bot currently only replies with text. (See `server/routes/telegram.ts` webhook handler and `server/telegram/`.)

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
- [ ] **50/30/20 Needs/Wants/Savings overlay.** A presentation layer that rolls *transactions* up into Needs / Wants / Savings via each category's class (`categoryClass` in `categoryMeta.ts` — a dimension SEPARATE from the category's functional group), set target percentages (default 50/30/20), show Plan vs Actual % with a donut. Not a new budgeting engine — it rides on the existing category groups. The 50/30/20 rule is a mainstream framework (Elizabeth Warren & Amelia Warren Tyagi, *All Your Worth*, 2005), not unique to any app, so it's safe to adopt as an optional lens. Decide whether it complements or competes with envelope/rollover budgeting before building.
- [ ] **Smart insights — gamified spending facts.** Bite-size, fun "did you know" cards that surface deep patterns from the data: *your #1 merchant*, *your go-to place to eat out*, *biggest spend day/week*, *most-improved category vs last month*, *longest no-spend streak*, *"you've spent £X at Greggs this year (≈N sausage rolls)"*, *spending personality/archetype*. Gamified + shareable (streaks, badges, monthly "wrapped" recap à la Spotify). All computable from existing transactions/merchants — no new data. Decide surfacing: a dashboard "Insights" strip, a dedicated page, and/or a monthly recap. Lean into delight; keep each fact a single glanceable stat with a playful line.
- [ ] **Intent-based dashboards (Budgeting | Wealth | Saving).** Let the dashboard adapt to the user's primary goal rather than one fixed layout — picks up the earlier net-worth-hero vs safe-to-spend tension. Three modes: **Budgeting** = safe-to-spend hero, budget-by-group, upcoming bills (don't-overspend reassurance); **Wealth** = net-worth hero, accounts/investments/debts trend (feel-good growth); **Saving** = pots/goals progress, savings rate, target dates. Same data, reordered emphasis. Decide: a per-user setting (one chosen intent), a switchable view, or an onboarding question that sets the default. Cheapest version reuses existing widgets behind a layout toggle.
- [ ] **Unrealized P&L card on the dashboard.** A glanceable card showing open investment gains/losses — current market value − cost basis, as both £ and %, with a since-purchase (and ideally day/month) delta, green/red toned. Answers "how are my investments doing?" without opening the Investments page. Needs a **cost-basis** notion per holding (amount invested / average buy price) which isn't fully modelled yet — scope that first (manual entry at minimum), then surface the aggregate on the dashboard as an orderable card (`Dashboard.tsx` blocks + `Customizable`). Wealth-leaning, so gate it behind the Wealth intent if intent-based dashboards land. (See `Investments.tsx`, the investment account model, and the net-worth summary.)
- [ ] **Platform stance — save vs invest guidance (no current direction).** Today the platform shows net worth but takes no *position* on what the user should do — it's nice to see the number, but there's no signal balancing **saving** (cash buffer, emergency fund, debt clearance) against **investing** (growing wealth). Give the platform a point of view: surface balanced, opinionated signals — e.g. "you have £X idle cash beyond your buffer — consider investing £Y" or conversely "buffer is thin, prioritise saving before investing" — so the user knows which direction to lean rather than eyeballing a static net-worth figure. Needs a notion of a target cash buffer / emergency-fund threshold, surplus detection, and a save-vs-invest recommendation. Relates to the intent-based-dashboards idea above (the Wealth/Saving tension) and to the account-health work (surplus/free-cash detection already computed there). Decide surfacing: a dashboard signal/card vs folding into account-health recommendations.

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

### 0. Authentication & onboarding (2026-06-16)

- [ ] **Add authentication.** The app is currently **no-auth, single-user** on a trusted network (see `CLAUDE.md`). Introduce real auth so it can run on the public internet / go multi-user: a login (email+password or magic-link/OAuth), sessions/JWT, a `User` model, and per-user scoping of every data read/write (accounts, transactions, budgets, settings, recurring, merchants — currently all global). Gate the API (middleware) and the Telegram/Gmail webhooks (already shared-secret) consistently. This is a prerequisite for the mobile app's "Auth/access decision" (§4) and for any hosted deployment. Big blast radius — every query gains a user scope — so plan a migration (single existing user → seed account).
- [ ] **Onboarding flow.** A first-run experience for a new user: connect a bank (GoCardless link), or add a manual/cash account; set income (ties into the manual income-override idea); seed budgets (the auto-populate-from-history exists); optionally connect Telegram/Gmail. A guided, skippable wizard that gets someone from zero to a useful dashboard. Depends on auth (a user to onboard).

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

### 5. Reliable background sync — connection expiry, cron visibility & failovers (2026-06-15)

Hardening the background layer so syncs don't silently rot. Can land incrementally
on the current in-process scheduler, or fold into the queue work in §3.

- [ ] **Fair bank-connection expiry** — GoCardless EUAs are created with `access_valid_for_days = 90` but expiry is never tracked (`Requisition` has no `expiresAt`). Add `expiresAt` (+ `agreementId`, `accessValidForDays`) to `Requisition` (hand-applied SQL), computed from the agreement's `accepted` time at finalize. Derive a health state (`active` / `expiring <7d` / `expired`), expose it on `BankDTO`, and show "Expires in N days · Reconnect" / "Expired" badges on the Accounts cards **and** the v2 dashboard account strip. Fail-fast: flip a requisition to expired the moment a sync hits a GoCardless expired/403, not just on the daily check.
- [ ] **Proactive expiry alerts** — a daily check that Telegram-alerts connections expiring within 7 days (and already-expired), with a `lastNotifiedAt` guard so it doesn't spam. Reuses the existing `sendMessage` infra (currently only used for receipt capture).
- [ ] **Make crons visible** — a named **job registry** (full-sync, gmail-watch-renew, expiry-check, recurring-detect) recording schedule / last run / status / next-due, backed by the existing `SyncRun` table; surface an in-app **Jobs & Health view** (Settings or Plugins): each job's last outcome, recent `SyncRun`s, and per-account sync health (last synced, cooldown, last error). (Overlaps §3 "Job observability".)
- [ ] **Failovers** — retry-with-backoff on transient sync errors; a heartbeat / dead-man's-switch (no successful sync in X hours → Telegram alert); lean on the existing idempotent/resumable sync.
- [ ] **Durable trigger** — externalize the scheduler trigger so jobs fire reliably across dyno restarts (the in-process `setInterval` resets and waits a full interval on restart). Default: **Railway Cron** hitting an authed endpoint — minimal, no new platform. **Evaluate trigger.dev** here too (durable jobs + a hosted dashboard + retries), but it's likely overkill for this single-user, PSD2-rate-limited (~4 pulls/day/account) workload and adds a hosted dependency + second deploy target; the natural moment to adopt it (or pg-boss per §3) is when the API becomes its own app.

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
- [x] **Merchant-logo repository + bucket cache** — server-side `GET /api/logo/:domain` resolves through a provider repository (Brandfetch → logo.dev → DuckDuckGo, `server/lib/logos/`), caches hits to the bucket (`LogoCache` table + `merchant-logos/` objects), negative-caches misses, and redirects to a presigned URL. Web `brand.ts` now points at `/api/logo/{domain}`; provider keys are server-side only. `scripts/warm-logos.ts` pre-warms. Degrades to a direct provider redirect when no bucket is configured (dev).
- [~] **Brand-colour avatars** — data layer DONE: `ensureBrandColor` fetches real colours via the Brandfetch **Brand API** (`BRANDFETCH_API_KEY`), caches the hex in `LogoCache.color` (luminance-filtered, negative-cached), served at `GET /api/logo/:domain/meta`. The avatar *tint* was tried (ring/wash, then solid fill) and **reverted** — full-colour logos clash with a coloured plate. To revisit properly: fetch Brandfetch's mono/white logo variant (`/icon/theme/dark`) to sit on a solid brand-colour fill, white-plate fallback for brands without one. (`BrandLogo` currently just fills the circle with the logo, `object-fit: cover`.)
- [ ] **Light mode** — the app is dark-only (near-black + jade). Add a light theme: lift the colour tokens in `web/src/styles.css` (`--bg`, `--surface`, `--ink*`, `--line*`, jade/coral/amber accents) into a `[data-theme="light"]` override on `:root`, a theme toggle (persisted in `localStorage` + `Setting`, default system via `prefers-color-scheme`), and audit hard-coded `rgba`/`color-mix` values + chart colours (Recharts/SpendBars) for contrast in both themes.

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
