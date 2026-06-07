# Personal Finance Web App — Design (v1)

**Date:** 2026-06-07
**Status:** Approved (pending spec review)
**Supersedes:** 2026-06-07-gocardless-transaction-puller-design.md (CLI approach, abandoned)

## Goal

A single-user personal finance web app that links a UK bank via the GoCardless
Bank Account Data API (formerly Nordigen, free Open Banking / PSD2), stores
transactions and balances in Postgres, and presents a spending dashboard
(charts + a searchable transactions table). Deployed as one Railway service.

## Decisions (from brainstorming)

- **Scope v1:** connect flow + spending dashboard (charts: spending by category,
  monthly totals, top merchants) + transactions table.
- **Hosting:** deployed on Railway, one service, built with **Docker**.
- **Stack:** Vite + React + TypeScript frontend; Express + TypeScript API in the
  same service; Postgres (Railway addon) via Prisma.
- **Datastore required:** GoCardless allows only ~4 transaction calls per account
  per day, so the dashboard reads from Postgres, never live from GoCardless.
- **Access:** no auth in v1 (obscure URL). Designed so a single-password
  middleware can be added later with minimal change. (Risk noted below.)

## Constraints / known limits

- **Transaction history:** free tier typically exposes ~90 days (bank-dependent).
- **Rate limit:** ~4 calls per account per day for transactions/balances/details.
  `sync` must be manual (button), throttled, and must not auto-retry on 429.
- **Interactive linking:** linking requires the user to authenticate at the bank
  in a browser and be redirected back to the app's `/callback`.
- **Ephemeral filesystem:** Railway disk does not persist across deploys — hence
  Postgres, not files.
- **Security risk (accepted):** a public URL with no auth exposes bank data to
  anyone with the link. v1 ships without auth per user decision; the URL must be
  kept secret. A password gate is a planned easy add (single Express middleware
  + one env var).

## Architecture

One Railway service. An Express server exposes `/api/*` and, in production,
serves the Vite-built static React bundle from `web/dist`. In development, Vite's
dev server runs separately and proxies `/api` to Express. Postgres via Prisma
holds all displayed data; GoCardless is called only during explicit **connect**
and **sync** actions.

## Repo layout

```
finance/
  package.json            # one package; scripts: dev, build, start, db:*, test
  tsconfig.json           # base
  tsconfig.server.json    # server build settings (if needed)
  Dockerfile              # multi-stage: build web + server, run node
  .dockerignore
  .gitignore
  .env                    # local secrets (gitignored)
  prisma/
    schema.prisma         # Requisition, Account, Balance, Transaction, SyncLog
  shared/
    types.ts              # types shared by server + web (DTOs)
  server/
    index.ts              # Express app: mounts /api, serves web/dist in prod
    env.ts                # load + validate env vars
    gocardless/
      token.ts            # token fetch + in-memory cache
      client.ts           # typed API wrapper
      types.ts            # GoCardless API response types
    lib/
      db.ts               # Prisma client singleton
      categorize.ts       # rules-based category from merchant/description
      aggregate.ts        # spending-by-category, monthly totals, top merchants
    routes/
      institutions.ts     # GET /api/institutions
      connect.ts          # POST /api/connect, POST /api/connect/:id/finalize
      sync.ts             # POST /api/sync
      dashboard.ts        # GET /api/dashboard, GET /api/transactions
  web/
    index.html
    vite.config.ts        # dev proxy /api -> http://localhost:3000
    src/
      main.tsx
      App.tsx             # router
      api.ts              # typed fetch helpers
      pages/
        Connect.tsx       # list banks, start link
        Callback.tsx      # handle redirect, call finalize, go to dashboard
        Dashboard.tsx     # charts + balances + Sync now
        Transactions.tsx  # searchable table
      components/
        charts/CategoryPie.tsx
        charts/MonthlyBar.tsx
        charts/TopMerchants.tsx
```

## Data model (Prisma / Postgres)

- **Requisition** — `id` (GoCardless requisition id, PK), `institutionId`,
  `institutionName`, `reference`, `status`, `createdAt`.
- **Account** — `id` (GoCardless account id, PK), `requisitionId` FK, `iban?`,
  `name?`, `currency`, `ownerName?`, `createdAt`.
- **Balance** — `id` PK, `accountId` FK, `type`, `amount` (Decimal), `currency`,
  `referenceDate`, `fetchedAt`. Latest snapshot per (account, type).
- **Transaction** — `id` PK (GoCardless `transactionId`, falling back to
  `internalTransactionId`; dedupe key), `accountId` FK, `bookingDate`,
  `valueDate?`, `amount` (Decimal), `currency`, `creditorName?`, `debtorName?`,
  `remittanceInfo?`, `merchantName?`, `category` (derived), `status`
  (booked|pending), `raw` (Json).
- **SyncLog** — `id` PK, `accountId` FK, `ranAt`, `added`, `status`. Used to
  throttle syncs against the 4/day cap.

Dedupe on `Transaction.id` via upsert → re-syncs are idempotent. `category` is
computed at sync time and stored so dashboard reads are pure DB queries.

## GoCardless integration

Base URL `https://bankaccountdata.gocardless.com`. Endpoints used:

- `POST /api/v2/token/new/` — `{ secret_id, secret_key }` → `{ access,
  access_expires, refresh, refresh_expires }`. Cached in memory with expiry.
- `GET  /api/v2/institutions/?country=gb`
- `POST /api/v2/requisitions/` — `{ institution_id, redirect, reference }` →
  `{ id, link, ... }`. `redirect` = `${APP_BASE_URL}/callback`.
- `GET  /api/v2/requisitions/{id}/` → `{ status, accounts[] }`. Linked = `LN`.
- `GET  /api/v2/accounts/{id}/details/`
- `GET  /api/v2/accounts/{id}/balances/`
- `GET  /api/v2/accounts/{id}/transactions/` → `{ transactions: { booked[],
  pending[] } }`.

`client.ts` adds the bearer token, throws a typed `GoCardlessError`
(status, body, retryAfter) on non-2xx.

## API routes

- `GET  /api/institutions` → `[{ id, name, bic }]` (GB).
- `POST /api/connect` — body `{ institutionId }`. Creates a requisition with
  `redirect=${APP_BASE_URL}/callback`, persists it, returns `{ id, link }`.
- `POST /api/connect/:id/finalize` — re-fetches the requisition; if status `LN`,
  upserts accounts, triggers an initial sync, returns `{ accounts: n }`. If not
  linked, returns 409 with the status.
- `POST /api/sync` — for each account: if last `SyncLog` < 6h ago, skip with a
  message; else fetch balances + transactions, categorize, upsert, write
  `SyncLog`. Returns per-account `{ added, skipped }`. 429 → surface
  `Retry-After`, stop.
- `GET  /api/dashboard` → `{ balances[], byCategory[], monthly[], topMerchants[] }`
  computed by `aggregate.ts` from stored transactions.
- `GET  /api/transactions?search=&accountId=&limit=` → paged transaction rows.

All request bodies/queries validated with `zod`.

## Categorization (`categorize.ts`)

Pure function `categorize(tx) -> Category`. Keyword rules over
`merchantName`/`creditorName`/`remittanceInfo` (lowercased), mapping to a fixed
set: `groceries`, `eating-out`, `transport`, `bills`, `shopping`, `income`
(positive amount / known salary terms), `other` (fallback). Rules live in a
single ordered list; first match wins. Deterministic and unit-tested.

## Aggregation (`aggregate.ts`)

Pure functions over a list of stored transactions:

- `spendingByCategory(txns)` → `[{ category, total }]` (debits only).
- `monthlyTotals(txns)` → `[{ month: "YYYY-MM", spent, received }]`.
- `topMerchants(txns, n)` → `[{ merchant, total, count }]` (debits only).

Unit-tested with fixture transactions.

## Frontend

React Router pages. `api.ts` wraps `fetch` with typed responses (DTOs from
`shared/types.ts`).

- **Connect** — fetches institutions, renders a searchable bank list; on select,
  POSTs `/api/connect` and `window.location = link`.
- **Callback** — reads `?ref`/requisition id, POSTs finalize, shows progress,
  then navigates to Dashboard.
- **Dashboard** — balances cards, `CategoryPie`, `MonthlyBar`, `TopMerchants`
  (Recharts), and a "Sync now" button hitting `/api/sync`.
- **Transactions** — searchable/filterable table from `/api/transactions`.

## Deployment (Railway, Docker)

- Env vars: `GOCARDLESS_SECRET_ID`, `GOCARDLESS_SECRET_KEY`, `DATABASE_URL`
  (Railway Postgres), `APP_BASE_URL` (the public Railway URL; in dev
  `http://localhost:5173`), `PORT` (Railway-provided).
- **Dockerfile** (multi-stage): stage 1 installs deps + builds (`prisma generate`,
  `vite build`, server TS check); final stage runs `node` serving Express, which
  serves `web/dist` and `/api`. Container start runs `prisma migrate deploy`
  before boot.
- `env.ts` validates required vars at startup and fails fast with a clear error.

## Testing

Unit tests (Node `node:test`, mocked fetch / no real DB):

- `categorize.ts` — rule coverage incl. fallback and income detection.
- `aggregate.ts` — category totals, monthly grouping, top merchants, debit/credit
  handling.
- `token.ts` — cache reuse + expiry re-fetch + non-2xx error.

Route handlers and the connect/sync/dashboard end-to-end are validated by running
against the real account (manual). No e2e/browser tests in v1.

## Out of scope (v1, YAGNI)

Auth/login, budgets & goals, editable categories, scheduled background sync,
multi-country, multi-bank UX polish, mobile-native, transaction export.
