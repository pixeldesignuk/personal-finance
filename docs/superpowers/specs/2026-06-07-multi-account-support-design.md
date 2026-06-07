# Multi-Account Support — Design

**Date:** 2026-06-07
**Status:** Approved (pending spec review)
**Builds on:** 2026-06-07-finance-web-app-design.md

## Goal

Let the finance app work with several connected banks/accounts: manage which
banks are connected, filter all views by account, see a per-account breakdown,
and show real bank/account names (with optional custom nicknames) instead of
GoCardless IDs.

## Context — what already exists

The backend is already relational and multi-account capable: many `Requisition`
(bank links) → many `Account` → each with `Balance`/`Transaction`/`SyncLog`.
`POST /api/connect` creates a fresh requisition per bank (unique reference), so
multiple banks can be linked. `sync` iterates all accounts; `dashboard`
aggregates across all; `GET /api/transactions` already accepts an `accountId`
filter. The gap is entirely UI/presentation plus a few endpoints — this feature
adds that layer without re-architecting the backend.

## Decisions (from brainstorming)

- Filtering is **per-account** (each account selectable, plus "All accounts").
  Banks are groupings shown on the manage page, not a separate filter axis.
- **Remove deletes stored data** for that bank (its accounts/balances/
  transactions/syncLogs) and deletes the requisition at GoCardless.
- Custom **nicknames** are stored per account.
- Reconnect re-runs the connect flow for a bank; new GoCardless account IDs may
  create fresh account rows (old ones removable via Remove). No dedup-across-
  relinks in v1 (YAGNI).

## Data model change

Add to `Account`:

```prisma
nickname String?
```

One Prisma migration (`add_account_nickname`). A pure helper resolves the label:

```
displayName(account) = account.nickname || account.name || `Account ••${id.slice(-4)}`
```

## Backend

New/changed routes (all under `/api`):

- `GET /api/accounts` — banks with nested accounts for the manage page + selector:
  ```
  [{ requisitionId, institutionId, institutionName, status, accounts:
     [{ id, name, nickname, displayName, iban, currency, balances:
        [{ type, amount, currency }] }] }]
  ```
- `PATCH /api/accounts/:id` — body `{ nickname: string | null }`; updates the
  nickname (empty/null clears it). zod-validated.
- `DELETE /api/banks/:requisitionId` — best-effort `DELETE /requisitions/{id}` at
  GoCardless, then cascade local delete of the requisition's accounts, balances,
  transactions, and syncLogs (in FK-safe order). Returns `{ deleted: true,
  remoteDeleted: boolean }`. If the GoCardless call fails (e.g. already expired),
  still cascade locally and report `remoteDeleted: false`.
- `GET /api/dashboard?accountId=` — add optional account filter. When present,
  aggregate only that account's transactions/balances; otherwise all (current
  behavior).
- `GET /api/transactions?accountId=` — already supported; unchanged.

Cascade delete order (Prisma, no `onDelete` cascade configured): syncLogs →
transactions → balances → accounts → requisition, scoped to the requisition's
account IDs.

## Account-filter mechanism

The selected account lives in the **URL query string** (`?account=<id>`), shared
by Dashboard and Transactions so it survives refresh and is bookmarkable. Absent
or `all` = all accounts. A reusable `AccountSelector` component reads/writes the
query param.

## Frontend

- **New `Accounts.tsx` page** (nav label "Manage"):
  - Lists each connected bank (institution name + status badge) with its accounts.
  - Per account: display name, balance(s), currency; inline nickname edit
    (`PATCH /api/accounts/:id`).
  - Per bank: **Reconnect** (runs the connect flow for that `institutionId`) and
    **Remove** (confirm dialog → `DELETE /api/banks/:requisitionId`).
  - **Add another bank** button → Connect page.
  - A note explaining Reconnect may add new account rows.
- **`AccountSelector` component** — dropdown: "All accounts" + each account by
  `displayName`; sets `?account=`. Used on Dashboard and Transactions.
- **`Dashboard.tsx`** — reads `?account=`, passes to `GET /api/dashboard`. Adds a
  **per-account balance breakdown** (balance cards grouped by bank) above the
  existing category/monthly/merchant charts, which now reflect the filter. Keeps
  the "Sync now" button.
- **`Transactions.tsx`** — adds `AccountSelector`, passes `accountId` to the API,
  and shows an account (display name) column.
- A shared `displayName` helper (in `shared/`) used by server DTO building and the
  frontend.

## Error handling

- Remove shows a confirm dialog (destroys stored history for that bank). On
  GoCardless delete failure, local cascade still proceeds; UI warns
  "removed locally; bank link may persist at GoCardless."
- Nickname PATCH on unknown account → 404.
- Dashboard/transactions with an `accountId` that doesn't exist → empty results
  (no error).

## Testing

- Unit-test `displayName` (nickname > name > id-suffix fallback).
- Unit-test dashboard account-filtering: extend the aggregate tests / add a small
  filter helper test ensuring a given `accountId` restricts the set and "all"
  includes everything.
- Manage-page actions (nickname edit, remove, reconnect) and the selector
  validated by running against the real account.

## Out of scope (YAGNI)

- Dedup of accounts across reconnects.
- Per-bank (as opposed to per-account) filtering.
- Reordering/hiding accounts; multi-currency conversion/normalization.
- Background re-link expiry notifications.
