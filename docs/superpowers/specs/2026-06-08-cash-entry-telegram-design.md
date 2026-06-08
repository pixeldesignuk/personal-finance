# Fast Cash Entry: In-App Form + Telegram Bot — Design

**Date:** 2026-06-08
**Status:** Approved (build in one pass)
**Builds on:** accounts/manual-money/budgets. Reuses `POST /api/transactions`.

## Goal

Make logging cash expenses fast, two ways: (A) a proper **Add-transaction form** on
the Transactions page (replacing the Manage prompt-chain), and (B) a **Telegram
bot** where the user messages a cash expense as text ("£12 lunch") or a **receipt
photo**, which Claude parses into a categorised transaction on a "Cash" account.

## Decisions (from brainstorming)

- Parsing: **Claude Haiku** reads both text and receipt photos → `{ amount,
  category, merchant, date }`. Needs `ANTHROPIC_API_KEY`.
- Bot hosting: a **webhook on the existing Railway Express server**
  (`POST /api/telegram/webhook`) — no new service.
- Security: only an allow-listed Telegram `chat_id`, plus Telegram's secret-token
  header. Both env vars.
- Posts to a single **"Cash" manual account**, auto-created on first use (no
  account-id config).
- Confirmation: bot replies with the logged line + **inline buttons to change
  category** and an **Undo** (delete) button.
- Telegram/Anthropic env vars are **optional** — the app boots without them; the
  webhook no-ops if unconfigured.

## Part A — In-app Add-transaction form

- New `web/src/components/AddTransaction.tsx` rendered at the top of the
  Transactions page: **account** (dropdown of MANUAL accounts only), **date**
  (default today), **amount**, **category** (dropdown), optional **note**.
- Submits via `POST /api/transactions`. The endpoint gains an optional `note`,
  stored on `Transaction.remittanceInfo` (shown in the list's Name column).
- If the user has no manual account, the form shows a hint linking to Manage.
- Remove the `Add txn` button + `addTxn` prompt handler from `Accounts.tsx`.

## Part B — Telegram bot

### Endpoints / flow
- `POST /api/telegram/webhook` (new `server/routes/telegram.ts`):
  1. Reject unless `X-Telegram-Bot-Api-Secret-Token` === `TELEGRAM_WEBHOOK_SECRET`.
  2. Parse the Telegram update. Ignore (200) if telegram/anthropic unconfigured.
  3. Allowlist: ignore unless `message.chat.id` (or `callback_query.from.id`)
     === `TELEGRAM_ALLOWED_CHAT_ID`.
  4. **Text message** → Claude parse → create cash txn → reply with confirmation +
     inline keyboard.
  5. **Photo message** → fetch largest photo via `getFile` + download → Claude
     vision parse → create cash txn → reply.
  6. **callback_query** (button press): a `cat:<category>:<txnId>` button sets the
     txn's `categoryOverride`; an `undo:<txnId>` button deletes it. Then
     `editMessageText` to reflect, and `answerCallbackQuery`.

### Parsing (Claude Haiku, `claude-haiku-4-5`)
Structured extraction → `{ amount: number (signed: negative = spend), category:
one of CATEGORIES, merchant: string, date: "YYYY-MM-DD" }`. Text and image use the
same schema (image as a base64 content block). Consult the `claude-api` skill for
exact request shape (tool/structured output, vision block, model id).

### Normalisation (pure, unit-tested) — `server/lib/cashTxn.ts`
- `normalizeParsed(parsed, todayISO)` →
  `{ amount: string, category: string, note: string, date: string }`:
  - amount coerced to a 2-dp string; if Claude returns a positive spend, force
    negative unless category is `income`.
  - category validated against `CATEGORIES`; fallback `other`.
  - date defaults to today if missing/invalid.
- `isAllowed(chatId, allowed)` → boolean.
- `confirmText(txn, account)` → the reply string.

### Cash account — `getOrCreateCashAccount()`
Find a MANUAL account named "Cash"; if none, create one (source MANUAL, type
PERSONAL, name "Cash", currency GBP, manualBalance 0). Returns its id.

### Telegram API helper — `server/telegram/api.ts`
Thin wrappers over `https://api.telegram.org/bot${token}/<method>`:
`sendMessage`, `editMessageText`, `answerCallbackQuery`, `getFile`,
`downloadFile`. Token from `TELEGRAM_BOT_TOKEN`.

### Setup (one-time, documented)
A `scripts/telegram-set-webhook.sh` that calls Telegram `setWebhook` with
`url=${APP_BASE_URL}/api/telegram/webhook` and `secret_token=${TELEGRAM_WEBHOOK_SECRET}`.
Note: the webhook must point at the **public Railway URL** (Telegram can't reach
localhost), so this is run after deploy.

## Environment

Add (all **optional** in `server/env.ts` — app boots without them):
`ANTHROPIC_API_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`,
`TELEGRAM_ALLOWED_CHAT_ID`. The telegram route checks they're present and no-ops
otherwise.

## Dependencies

Add `@anthropic-ai/sdk`. Telegram is plain `fetch` (no SDK).

## Data model

No schema change. Manual transactions reuse the `Transaction` table (note →
`remittanceInfo`). Cash account is an ordinary MANUAL `Account`.

## Error handling

- Bad secret token → 401. Unconfigured → 200 no-op. Non-allowlisted → 200 no-op
  (don't leak existence).
- Claude parse failure / no amount found → reply "Couldn't read an amount — try
  e.g. '£12.50 lunch'." (no txn created).
- Telegram send failures logged, not fatal.
- Webhook always returns 200 quickly on handled updates (Telegram retries on
  non-200); heavy work (Claude) is awaited but bounded.

## Testing

Unit tests (`node:test`, no network/DB): `normalizeParsed` (sign forcing,
category fallback, date default, amount formatting), `isAllowed`, `confirmText`.
Claude/Telegram I/O and the webhook end-to-end validated by messaging the real
bot after deploy.

## Out of scope (YAGNI)

Multi-user, receipt image storage, multiple cash accounts via the bot, natural-
language queries to the bot ("how much did I spend on food"), voice notes,
splitting one receipt into multiple line items, currency other than GBP.
