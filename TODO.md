# Ledger — backlog

Running todo of planned features. Newest ideas at the bottom; check off when shipped.

## Open

- [ ] **Realtime Gmail monitoring** — push-based order capture: Gmail API `users.watch` + Google Cloud Pub/Sub + a webhook endpoint so new order emails parse automatically as they arrive. *Needs Pub/Sub infra setup. (Near-realtime polling is already available via `POST /api/sync/all` + a cron.)*
- [ ] **Wire scheduled syncs** — point a cron / Trigger.dev job at `POST /api/sync/all` (endpoint + unified sync-log already built). *Deploy-side config only.*

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
