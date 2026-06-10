# Ledger — backlog

Running todo of planned features. Newest ideas at the bottom; check off when shipped.

## Open

- [ ] **Realtime Gmail monitoring** — push-based order capture instead of manual "Sync now": Gmail API `users.watch` + Pub/Sub (or periodic background polling via cron) so new order emails are parsed and matched automatically as they arrive.
- [ ] **Scheduled sync jobs** — cron or Trigger.dev jobs that run all syncs (bank, investments, Gmail) on a schedule with a full audit trail, tied into the unified sync-log source of truth (below) so every run is recorded and incremental.
- [ ] **Unified sync-log table** — one table tracking every sync (plugin/Gmail, account/bank, investments): timestamps, scope, counts, status, and the audit inputs/responses (e.g. Gemini prompts + raw replies). Use it to optimise future syncs (incremental cursors, skip-unchanged, rate-limit awareness) and to review past runs. Replaces the per-feature `SyncLog`/`lastSyncAt` bits with a shared audit log.
- [ ] **Mobile-friendly layouts** — make every page responsive (tables, card grids, dialogs, the audit bottom sheet) so the app works well on a phone.
- [ ] **Mobile navigation** — a proper small-screen nav (hamburger / bottom bar) replacing the desktop top nav + dropdowns on mobile.
- [ ] **Dashboard refresh** — it was the first page built and is now outdated. Rework with better graphs/visualisations (trends, cashflow, category/merchant breakdowns) using the frontend-design skill.
- [ ] **Reports page redesign** — apply the frontend-design skill; it needs a proper visual treatment.
- [ ] **Accounts page redesign** (frontend-design skill) — remove the "Personal / Manual / linked" labels; move per-account actions behind a burger/cog menu; better placement & design for the "maintain ~£/mo" figure; move the balance-type (which value to use) dropdown into a context/cog menu like before; clearer distinction of account types.
- [ ] **Assets get their own space** — move assets out of the Accounts page into a dedicated area.
- [ ] **De-dupe investments vs accounts** — investments have their own space now; check whether keeping investments inside Accounts duplicates logic/data and consolidate the source of truth.
- [ ] **Actual merchant logos** — replace monogram avatars with real brand logos (logo provider / per-merchant domain, e.g. enriched from order emails or a brand API).
- [ ] **Email sync de-dupe via datetime** — track the last email datetime/historyId per sync to avoid re-fetching/parsing already-seen emails (incremental cursor instead of `newer_than:120d`).
- [ ] **Order tags** — add tags to parsed orders for better matching and search.
- [ ] **Email search + refund reconciliation** — search order emails, and detect refund/return emails and reconcile them against credit transactions.
- [ ] **Orders need their own space** — orders living under the Gmail/Plugins page doesn't scale; give Orders a dedicated section/page.

## Done

- [x] **Gmail order-tracking** (Plugins area) — OAuth connect, sync pulls order/receipt emails, Gemini extracts merchant/total/items, fuzzy-matched to transactions. Orders list on the Plugins page + a receipt tag (with items) on matched transactions.
- [x] **Savings / Pots** (Wealth menu) — YNAB-style envelopes that earmark existing liquid cash toward goals (emergency fund, school fees). Target + progress, add/take funds, "unallocated" figure; net worth unchanged (no double-counting).
- [x] **Merchant & account logos** — real GoCardless bank logos on account cards; deterministic monogram avatars for merchants (no domain data to source real brand logos yet — could enrich later via a logo provider / per-merchant domain).
- [x] Per-account recurring "maintain ~£/mo" figure on the Accounts page.
- [x] Accounts laid out as a grid of cards.
- [x] Budget / Wealth nav dropdowns; Accounts moved under Budget.
- [x] Incremental sync (date_from) + post-sync new-transaction report & balance-change flash.
