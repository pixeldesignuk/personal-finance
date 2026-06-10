# Ledger — backlog

Running todo of planned features. Newest ideas at the bottom; check off when shipped.

## Open

- [ ] **Unified sync-log table** — one table tracking every sync (plugin/Gmail, account/bank, investments): timestamps, scope, counts, status, and the audit inputs/responses (e.g. Gemini prompts + raw replies). Use it to optimise future syncs (incremental cursors, skip-unchanged, rate-limit awareness) and to review past runs. Replaces the per-feature `SyncLog`/`lastSyncAt` bits with a shared audit log.

## Done

- [x] **Gmail order-tracking** (Plugins area) — OAuth connect, sync pulls order/receipt emails, Gemini extracts merchant/total/items, fuzzy-matched to transactions. Orders list on the Plugins page + a receipt tag (with items) on matched transactions.
- [x] **Savings / Pots** (Wealth menu) — YNAB-style envelopes that earmark existing liquid cash toward goals (emergency fund, school fees). Target + progress, add/take funds, "unallocated" figure; net worth unchanged (no double-counting).
- [x] **Merchant & account logos** — real GoCardless bank logos on account cards; deterministic monogram avatars for merchants (no domain data to source real brand logos yet — could enrich later via a logo provider / per-merchant domain).
- [x] Per-account recurring "maintain ~£/mo" figure on the Accounts page.
- [x] Accounts laid out as a grid of cards.
- [x] Budget / Wealth nav dropdowns; Accounts moved under Budget.
- [x] Incremental sync (date_from) + post-sync new-transaction report & balance-change flash.
