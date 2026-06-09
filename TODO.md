# Ledger — backlog

Running todo of planned features. Newest ideas at the bottom; check off when shipped.

## Open

- [ ] **Gmail integration for online-order tracking** (under a new **Plugins** area) — link Gmail to pull order/shipping emails (e.g. Amazon) and reconcile/annotate matching transactions with what was actually bought. Keep this under a "Plugins" section so future integrations live there too. *Needs Google Cloud OAuth client credentials (like the Gemini key flow).*

## Done

- [x] **Savings / Pots** (Wealth menu) — YNAB-style envelopes that earmark existing liquid cash toward goals (emergency fund, school fees). Target + progress, add/take funds, "unallocated" figure; net worth unchanged (no double-counting).
- [x] **Merchant & account logos** — real GoCardless bank logos on account cards; deterministic monogram avatars for merchants (no domain data to source real brand logos yet — could enrich later via a logo provider / per-merchant domain).
- [x] Per-account recurring "maintain ~£/mo" figure on the Accounts page.
- [x] Accounts laid out as a grid of cards.
- [x] Budget / Wealth nav dropdowns; Accounts moved under Budget.
- [x] Incremental sync (date_from) + post-sync new-transaction report & balance-change flash.
