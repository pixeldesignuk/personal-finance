# Investments as accounts — unified add flow + per-account credentials

**Date:** 2026-06-24
**Scope:** Fold investments into the accounts model and let Trading 212 / Bitget be
added through the same account-management UI as banks/cash (today they're
env-configured singletons on a separate `/investments` page).

## Decisions (locked)

- **Credentials:** stored **plaintext in the DB** on the account row (consistent
  with the existing Gmail OAuth tokens in `Plugin`). Single-user, no-auth app.
- **IA:** **retire the `/investments` page + nav item**; investments live in
  Accounts (page + strip). Holdings/P-L stay in the existing `InvestmentHoldingsPanel`.
- **Add scope:** **Trading 212 + Bitget connect only** (one synced account per
  provider). No manual investment accounts yet (schema leaves room); no encryption;
  one account per provider.
- **Add-account chooser:** a **modal** (Bank / Cash / Investment), opened by both
  the strip `+` and the Accounts page Add button.
- **Disconnect:** lives in the account **kebab** (Accounts card) and the holdings
  panel — no dedicated settings screen.

## 1. Data model

- Add `providerConfig Json?` to `Account` — holds the provider's plaintext
  credential set (shape differs per provider).
- Migration: `scripts/migrations/2026-06-24-account-provider-config.sql` with
  `ALTER TABLE "Account" ADD COLUMN IF NOT EXISTS "providerConfig" JSONB;`, applied
  via `scripts/migrations/apply.sh`, then mirror in `prisma/schema.prisma` and
  `pnpm prisma generate` (per CLAUDE.md — no `prisma migrate`).
- `providerConfig` is **server-only**: never added to `AccountDTO`/`InvestmentsDTO`
  or any client payload.

## 2. Provider refactor (credential-driven)

`server/investments/types.ts`:

- `fetchSnapshot(creds: ProviderCreds): Promise<InvestmentSnapshot>` — now takes
  credentials instead of reading `env`.
- Add `credentialFields: CredentialField[]` per provider, where
  `CredentialField = { key: string; label: string; secret?: boolean; optional?: boolean; placeholder?: string }`.
  This descriptor drives both the UI form and server-side required-field validation.
- Drop `configured()`.

Per-provider creds:
- **trading212:** `{ keyId, secret, baseUrl? }` (baseUrl defaults to
  `https://live.trading212.com`).
- **bitget:** `{ apiKey, apiSecret, passphrase, usdGbp? }`.

`trading212.ts` / `bitget.ts`: thread creds through `base()`/`authHeader()`/`sign()`/
`signedGet()`/`usdToGbp()` — no `env` reads inside the request path.

**Credential resolution** (`server/investments/creds.ts`, pure + unit-tested):
`resolveCreds(provider, account)` = `account.providerConfig` if present, else the
legacy env values for that provider (`legacyEnvCreds(key)`), else `null`. This keeps
the existing `inv-trading212` / `inv-bitget` accounts syncing from `.env` with no
secret migration, while UI-entered creds take precedence.

## 3. Sync refactor

`server/investments/sync.ts`:

- `syncProvider(account)` — resolve creds for the account, get the provider driver
  by `account.provider`, `fetchSnapshot(creds)`, then the existing upsert-balance +
  delete/recreate-holdings logic (unchanged), with audit events.
- `syncAllInvestments()` — query DB `INVESTMENT` accounts and sync each
  (skip those whose creds resolve to `null`); per-account failures are logged and
  don't abort the rest. Used by the global sync + scheduler. (No longer loops the
  env-`PROVIDERS` registry; the registry stays as the driver lookup.)

## 4. Server endpoints (`server/routes/accounts.ts` / `investments.ts`)

- `POST /api/accounts/investment { provider, config }`:
  1. Validate `provider` is known and required `credentialFields` are present.
  2. **Test the creds** by calling `fetchSnapshot(config)`.
  3. On success: upsert account (`id: inv-<provider>`, `source:INVESTMENT`,
     `type:PERSONAL`, `provider`, `name`, `providerConfig:config`, `currency`,
     `manualBalance:totalValue`) and replace holdings (reuse `syncProvider`).
  4. On failure: `400` with the provider error; **persist nothing**.
- `DELETE /api/accounts/investment/:id`: delete holdings + the account.
- Keep `GET /api/investments` (feeds the holdings panel) and a per-account
  re-sync (`POST /api/investments/:provider/sync`, now creds-from-DB).
- No provider-metadata endpoint: the form's field descriptor comes from the shared
  module (§5); the server validates the POST body against that same descriptor.

## 5. UI

- **Provider descriptor source:** put `credentialFields` (+ label) in a shared
  module the web app can import directly (extends `shared/investmentMeta.ts`), so
  the form needs no extra round-trip. Server validates against the same descriptor.
- **Unified Add-account chooser** (`web/src/components/AddAccountModal.tsx`, new):
  a modal with three choices — **Bank** (`navigate("/connect")`), **Cash** (the
  existing manual form, moved/lifted here), **Investment** (provider pick → API-key
  form). Opened by the AccountsStrip `+` and the Accounts page Add button.
- **Investment add form:** pick Trading 212 / Bitget, render `credentialFields`
  (secret fields use `type=password`), helper text "use a read-only API key",
  submit → `POST /api/accounts/investment`; inline error on 400; on success close +
  invalidate `["accounts"]`, `["summary"]`, `["investments"]`.
- **Accounts page:** remove the `INVESTMENT` filter so investment accounts render as
  cards (provider logo + stocks/crypto badge via `investmentMeta`, value as the
  figure). Kebab: **Sync now** (`api.syncInvestment(provider)`), **Disconnect**
  (`DELETE`). Update the page subtitle (no longer "investments live under Wealth").
- **Holdings panel:** add **Sync now** + **Disconnect** actions.
- **Retire `/investments`:** remove the page component usage + the "Investments"
  nav item (`App.tsx`); add a redirect route `/investments → /accounts`.

## 6. DTO / security

- `AccountDTO` already carries `provider` (for badges). **Do not** add
  `providerConfig`. No credential ever reaches the client.
- Plaintext at rest; recommend read-only keys in the form hint. Bad creds rejected
  before persistence; per-account sync failures isolated.

## 7. Out of scope

- No encryption-at-rest (plaintext, by decision).
- No multiple accounts per provider.
- No manual (non-synced) investment accounts yet — schema (`providerConfig` nullable,
  `source:INVESTMENT`) leaves room to add them later.
- Assets/debts spaces untouched. Net-worth math unchanged (investments already in
  net worth via `networth.includeInvestments`).

## 8. Verification

- Migration applied; `pnpm prisma generate`; `tsc --noEmit` + `vite build` pass.
- Unit tests: `resolveCreds` precedence (providerConfig over env, null when neither);
  required-field validation against `credentialFields`.
- Manual: the two existing env-configured accounts still sync (proves the
  creds-from-DB-with-env-fallback refactor). Screenshot the Add-account chooser, the
  investment add form, and the Accounts page showing investment cards. Confirm
  `/investments` redirects to `/accounts` and the nav item is gone.
- Confirm no credential field appears in any `/api/accounts` or `/api/investments`
  response (grep the payloads).
