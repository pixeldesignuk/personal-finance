# Fast Cash Entry: In-App Form + Telegram Bot — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.

**Goal:** (A) a proper Add-transaction form on the Transactions page; (B) a Telegram bot that logs cash expenses from text or a receipt photo via Claude Haiku, onto a "Cash" account, with inline category-fix + Undo.

**Architecture:** Additive on the existing Express+TS / Prisma / Vite-React app. New `@anthropic-ai/sdk` parses messages/receipts; a webhook on the existing server handles Telegram; pure normalisation logic is unit-tested. No schema change.

**Tech Stack:** Existing + `@anthropic-ai/sdk`, `claude-haiku-4-5`, built-in `fetch` for the Telegram Bot API.

**Env prefix:** `eval "$(/opt/homebrew/bin/brew shellenv)"; eval "$(fnm env)";`

**Git:** commit straight to `main`, explicit paths only, trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. `.ts` import extensions. No local Postgres needed for build/tests.

---

## Task 1: deps + optional env vars

**Files:** `package.json` (dep), `server/env.ts` (modify), `.env.example` (modify)

- [ ] **Step 1: Add the Anthropic SDK**

Run: `eval "$(/opt/homebrew/bin/brew shellenv)"; eval "$(fnm env)"; cd /Users/mansoor/Developer/personal/finance; pnpm add @anthropic-ai/sdk`

- [ ] **Step 2: Make new vars optional in `server/env.ts`**

Add these optional fields to the zod schema object (after `PORT`):
```typescript
  ANTHROPIC_API_KEY: z.string().optional(),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_WEBHOOK_SECRET: z.string().optional(),
  TELEGRAM_ALLOWED_CHAT_ID: z.string().optional(),
```

- [ ] **Step 3: Document them in `.env.example`** — append:
```
# Optional — enables the Telegram cash bot
ANTHROPIC_API_KEY=
TELEGRAM_BOT_TOKEN=
TELEGRAM_WEBHOOK_SECRET=
TELEGRAM_ALLOWED_CHAT_ID=
```

- [ ] **Step 4: Verify + commit**

Run: `pnpm exec prisma generate && pnpm exec tsc --noEmit && echo OK`
```bash
cd /Users/mansoor/Developer/personal
git add finance/package.json finance/pnpm-lock.yaml finance/server/env.ts finance/.env.example
git commit -m "chore: add anthropic sdk + optional telegram/anthropic env vars"
```

---

## Task 2: cashTxn pure logic (TDD)

**Files:** `server/lib/cashTxn.ts`, `server/lib/cashTxn.test.ts`

- [ ] **Step 1: Write failing test `server/lib/cashTxn.test.ts`**

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeParsed, isAllowed, confirmText } from "./cashTxn.ts";

test("spend is forced negative; non-income positive flips", () => {
  const r = normalizeParsed({ amount: 12.5, category: "eating-out", merchant: "Pret", date: "2026-06-08" }, "2026-06-08");
  assert.equal(r.amount, "-12.50");
  assert.equal(r.category, "eating-out");
  assert.equal(r.note, "Pret");
  assert.equal(r.date, "2026-06-08");
});

test("income keeps positive", () => {
  assert.equal(normalizeParsed({ amount: 50, category: "income", merchant: "x", date: "" }, "2026-06-08").amount, "50.00");
});

test("already-negative spend stays negative", () => {
  assert.equal(normalizeParsed({ amount: -8, category: "transport", merchant: "TfL", date: "2026-06-08" }, "2026-06-08").amount, "-8.00");
});

test("unknown category falls back to other; bad date -> today", () => {
  const r = normalizeParsed({ amount: -3, category: "weird", merchant: "", date: "nope" }, "2026-06-08");
  assert.equal(r.category, "other");
  assert.equal(r.date, "2026-06-08");
});

test("isAllowed compares chat id to the allowed id as strings", () => {
  assert.equal(isAllowed(12345, "12345"), true);
  assert.equal(isAllowed(999, "12345"), false);
  assert.equal(isAllowed(12345, undefined), false);
});

test("confirmText summarises the logged expense", () => {
  const t = confirmText({ amount: "-12.50", category: "eating-out", note: "Pret", date: "2026-06-08" });
  assert.match(t, /-?£?12\.50/);
  assert.match(t, /eating-out/);
  assert.match(t, /Pret/);
});
```

- [ ] **Step 2: Run → fail**

Run: `node --import tsx --test server/lib/cashTxn.test.ts`

- [ ] **Step 3: Write `server/lib/cashTxn.ts`**

```typescript
import { CATEGORIES } from "./categorize.ts";

export interface ParsedExpense {
  amount: number;
  category: string;
  merchant: string;
  date: string;
}

export interface NormalizedTxn {
  amount: string;
  category: string;
  note: string;
  date: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function normalizeParsed(p: ParsedExpense, todayISO: string): NormalizedTxn {
  const category = CATEGORIES.includes(p.category) ? p.category : "other";
  let amount = Number.isFinite(p.amount) ? p.amount : 0;
  // Spends are negative; only income may be positive.
  if (category !== "income" && amount > 0) amount = -amount;
  const date = DATE_RE.test(p.date) ? p.date : todayISO;
  return { amount: amount.toFixed(2), category, note: (p.merchant ?? "").trim(), date };
}

export function isAllowed(chatId: number | undefined, allowed: string | undefined): boolean {
  return !!chatId && !!allowed && String(chatId) === allowed;
}

export function confirmText(t: NormalizedTxn): string {
  const n = Number(t.amount);
  const money = `${n < 0 ? "-" : ""}£${Math.abs(n).toFixed(2)}`;
  return `Logged ${money} · ${t.category}${t.note ? ` · ${t.note}` : ""} → Cash`;
}
```

- [ ] **Step 4: Run → pass; commit**

Run: `node --import tsx --test server/lib/cashTxn.test.ts`
```bash
cd /Users/mansoor/Developer/personal
git add finance/server/lib/cashTxn.ts finance/server/lib/cashTxn.test.ts
git commit -m "feat: cash transaction normalisation + allowlist + confirm text"
```

---

## Task 3: manual transactions accept a note

**Files:** `server/routes/transactions.ts` (modify), `shared/types.ts` (modify)

- [ ] **Step 1: Add `note` to the POST body + store as remittanceInfo**

In `server/routes/transactions.ts`, in the `POST /transactions` zod object add:
```typescript
        note: z.string().optional(),
```
and in the `db.transaction.create({ data: { ... } })` add:
```typescript
        remittanceInfo: body.note ?? null,
```

- [ ] **Step 2: Add `note?` to `ManualTxnInput` in `shared/types.ts`**

```typescript
export interface ManualTxnInput {
  accountId: string;
  date: string;
  amount: string;
  category: string;
  note?: string;
}
```

- [ ] **Step 3: Verify + commit**

Run: `pnpm exec tsc --noEmit && echo OK`
```bash
cd /Users/mansoor/Developer/personal
git add finance/server/routes/transactions.ts finance/shared/types.ts
git commit -m "feat: manual transactions accept an optional note"
```

---

## Task 4: Claude parser (text + receipt)

**Files:** `server/telegram/parse.ts`

No unit test (live API I/O). Uses `@anthropic-ai/sdk` structured output with Haiku.

- [ ] **Step 1: Write `server/telegram/parse.ts`**

```typescript
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { env } from "../env.ts";
import type { ParsedExpense } from "../lib/cashTxn.ts";

const ExpenseSchema = z.object({
  amount: z.number(),
  category: z.enum(["groceries", "eating-out", "transport", "bills", "shopping", "other", "income", "transfer"]),
  merchant: z.string(),
  date: z.string(),
});

const SYSTEM =
  "Extract a single cash expense from the user's message or receipt photo. " +
  "amount: the total as a number, NEGATIVE for spending and positive only for income. " +
  "category: best fit from the allowed set. merchant: short name/description. " +
  "date: YYYY-MM-DD if present, else empty string. Respond only via the schema.";

function client(): Anthropic {
  return new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
}

async function extract(content: Anthropic.MessageParam["content"]): Promise<ParsedExpense | null> {
  const res = await client().messages.parse({
    model: "claude-haiku-4-5",
    max_tokens: 512,
    system: SYSTEM,
    messages: [{ role: "user", content }],
    output_config: { format: zodOutputFormat(ExpenseSchema) },
  });
  return (res.parsed_output as ParsedExpense | null) ?? null;
}

export function parseText(text: string): Promise<ParsedExpense | null> {
  return extract([{ type: "text", text }]);
}

export function parseImage(base64: string, mediaType: string, caption?: string): Promise<ParsedExpense | null> {
  const media = (["image/jpeg", "image/png", "image/gif", "image/webp"].includes(mediaType)
    ? mediaType
    : "image/jpeg") as "image/jpeg" | "image/png" | "image/gif" | "image/webp";
  return extract([
    { type: "text", text: caption ? `Receipt. Note: ${caption}` : "Extract the expense from this receipt." },
    { type: "image", source: { type: "base64", media_type: media, data: base64 } },
  ]);
}
```

- [ ] **Step 2: Verify + commit**

Run: `pnpm exec tsc --noEmit && echo OK`
```bash
cd /Users/mansoor/Developer/personal
git add finance/server/telegram/parse.ts
git commit -m "feat: claude haiku expense parser (text + receipt photo)"
```

---

## Task 5: Telegram API helpers

**Files:** `server/telegram/api.ts`

- [ ] **Step 1: Write `server/telegram/api.ts`**

```typescript
import { env } from "../env.ts";

const base = () => `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}`;

async function call<T>(method: string, body: unknown): Promise<T> {
  const res = await fetch(`${base()}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await res.json()) as T;
}

export function sendMessage(chatId: number, text: string, replyMarkup?: unknown) {
  return call("sendMessage", { chat_id: chatId, text, reply_markup: replyMarkup });
}

export function editMessageText(chatId: number, messageId: number, text: string, replyMarkup?: unknown) {
  return call("editMessageText", { chat_id: chatId, message_id: messageId, text, reply_markup: replyMarkup });
}

export function answerCallbackQuery(id: string, text?: string) {
  return call("answerCallbackQuery", { callback_query_id: id, text });
}

export async function downloadPhoto(fileId: string): Promise<{ base64: string; mediaType: string }> {
  const meta = (await call<{ result?: { file_path?: string } }>("getFile", { file_id: fileId })).result;
  const path = meta?.file_path;
  if (!path) throw new Error("Telegram getFile returned no path");
  const res = await fetch(`https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${path}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const mediaType = path.endsWith(".png") ? "image/png" : path.endsWith(".webp") ? "image/webp" : "image/jpeg";
  return { base64: buf.toString("base64"), mediaType };
}
```

- [ ] **Step 2: Verify + commit**

Run: `pnpm exec tsc --noEmit && echo OK`
```bash
cd /Users/mansoor/Developer/personal
git add finance/server/telegram/api.ts
git commit -m "feat: telegram bot api helpers"
```

---

## Task 6: get-or-create Cash account

**Files:** `server/telegram/cashAccount.ts`

- [ ] **Step 1: Write `server/telegram/cashAccount.ts`**

```typescript
import { randomUUID } from "node:crypto";
import { db } from "../lib/db.ts";

export async function getOrCreateCashAccount(): Promise<string> {
  const existing = await db.account.findFirst({ where: { source: "MANUAL", name: "Cash" } });
  if (existing) return existing.id;
  const created = await db.account.create({
    data: { id: `manual-${randomUUID()}`, source: "MANUAL", type: "PERSONAL", name: "Cash", currency: "GBP", manualBalance: "0" },
  });
  return created.id;
}
```

- [ ] **Step 2: Verify + commit**

Run: `pnpm exec tsc --noEmit && echo OK`
```bash
cd /Users/mansoor/Developer/personal
git add finance/server/telegram/cashAccount.ts
git commit -m "feat: get-or-create Cash manual account"
```

---

## Task 7: Telegram webhook route

**Files:** `server/routes/telegram.ts`, `server/index.ts` (mount)

- [ ] **Step 1: Write `server/routes/telegram.ts`**

```typescript
import { Router } from "express";
import { randomUUID } from "node:crypto";
import { env } from "../env.ts";
import { db } from "../lib/db.ts";
import { isAllowed, normalizeParsed, confirmText } from "../lib/cashTxn.ts";
import { CATEGORIES } from "../lib/categorize.ts";
import { parseText, parseImage } from "../telegram/parse.ts";
import { sendMessage, editMessageText, answerCallbackQuery, downloadPhoto } from "../telegram/api.ts";
import { getOrCreateCashAccount } from "../telegram/cashAccount.ts";

export const telegramRouter = Router();

const configured = () =>
  !!(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_WEBHOOK_SECRET && env.TELEGRAM_ALLOWED_CHAT_ID && env.ANTHROPIC_API_KEY);

function categoryKeyboard(txId: string) {
  const spend = ["groceries", "eating-out", "transport", "bills", "shopping", "other"];
  const rows = [];
  for (let i = 0; i < spend.length; i += 3) {
    rows.push(spend.slice(i, i + 3).map((c) => ({ text: c, callback_data: `cat:${c}:${txId}` })));
  }
  rows.push([{ text: "↩︎ Undo", callback_data: `undo:${txId}` }]);
  return { inline_keyboard: rows };
}

telegramRouter.post("/telegram/webhook", async (req, res) => {
  // Always 200 quickly so Telegram doesn't retry; do work inline but guarded.
  try {
    if (req.header("X-Telegram-Bot-Api-Secret-Token") !== env.TELEGRAM_WEBHOOK_SECRET) {
      res.sendStatus(401);
      return;
    }
    res.sendStatus(200);
    if (!configured()) return;

    const update = req.body ?? {};

    // Inline button presses (category fix / undo)
    if (update.callback_query) {
      const cq = update.callback_query;
      if (!isAllowed(cq.from?.id, env.TELEGRAM_ALLOWED_CHAT_ID)) return;
      const data: string = cq.data ?? "";
      const chatId = cq.message?.chat?.id;
      const messageId = cq.message?.message_id;
      if (data.startsWith("undo:")) {
        const id = data.slice(5);
        await db.transaction.deleteMany({ where: { id } });
        await answerCallbackQuery(cq.id, "Removed");
        if (chatId && messageId) await editMessageText(chatId, messageId, "↩︎ Removed.");
      } else if (data.startsWith("cat:")) {
        const [, category, id] = data.split(":");
        if (CATEGORIES.includes(category)) {
          const tx = await db.transaction.findUnique({ where: { id } });
          if (tx) {
            await db.transaction.update({ where: { id }, data: { categoryOverride: category } });
            await answerCallbackQuery(cq.id, `→ ${category}`);
            if (chatId && messageId) {
              await editMessageText(chatId, messageId,
                confirmText({ amount: tx.amount.toString(), category, note: tx.remittanceInfo ?? "", date: tx.bookingDate ?? "" }),
                categoryKeyboard(id));
            }
          }
        }
      }
      return;
    }

    const msg = update.message;
    const chatId = msg?.chat?.id;
    if (!isAllowed(chatId, env.TELEGRAM_ALLOWED_CHAT_ID)) return;

    // Parse text or the largest photo.
    let parsed = null;
    if (msg.photo && msg.photo.length) {
      const fileId = msg.photo[msg.photo.length - 1].file_id;
      const { base64, mediaType } = await downloadPhoto(fileId);
      parsed = await parseImage(base64, mediaType, msg.caption);
    } else if (msg.text) {
      parsed = await parseText(msg.text);
    }

    if (!parsed || !Number.isFinite(parsed.amount) || parsed.amount === 0) {
      await sendMessage(chatId, "Couldn't read an amount — try e.g. '£12.50 lunch'.");
      return;
    }

    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });
    const n = normalizeParsed(parsed, today);
    const accountId = await getOrCreateCashAccount();
    const id = `manual-${randomUUID()}`;
    await db.transaction.create({
      data: {
        id, accountId, bookingDate: n.date, amount: n.amount, currency: "GBP",
        remittanceInfo: n.note || null, category: n.category, status: "booked", raw: { telegram: true },
      },
    });
    await sendMessage(chatId, confirmText(n), categoryKeyboard(id));
  } catch (err) {
    console.error("telegram webhook error", err);
  }
});
```

- [ ] **Step 2: Mount in `server/index.ts`**

Add import:
```typescript
import { telegramRouter } from "./routes/telegram.ts";
```
Mount (after the other routers):
```typescript
app.use("/api", telegramRouter);
```

- [ ] **Step 3: Verify + commit**

Run: `pnpm exec prisma generate && pnpm exec tsc --noEmit && echo OK`
```bash
cd /Users/mansoor/Developer/personal
git add finance/server/routes/telegram.ts finance/server/index.ts
git commit -m "feat: telegram webhook — log cash expenses from text/receipt with inline fix/undo"
```

---

## Task 8: webhook setup script

**Files:** `scripts/telegram-set-webhook.sh`

- [ ] **Step 1: Write `scripts/telegram-set-webhook.sh`**

```bash
#!/usr/bin/env bash
# Register the Telegram webhook to point at the deployed app.
# Requires TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, APP_BASE_URL in the env.
set -euo pipefail
: "${TELEGRAM_BOT_TOKEN:?}"; : "${TELEGRAM_WEBHOOK_SECRET:?}"; : "${APP_BASE_URL:?}"
curl -s "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
  -d "url=${APP_BASE_URL}/api/telegram/webhook" \
  -d "secret_token=${TELEGRAM_WEBHOOK_SECRET}" \
  -d "allowed_updates=[\"message\",\"callback_query\"]"
echo
```

- [ ] **Step 2: chmod + commit**

Run: `chmod +x scripts/telegram-set-webhook.sh`
```bash
cd /Users/mansoor/Developer/personal
git add finance/scripts/telegram-set-webhook.sh
git commit -m "chore: telegram setWebhook helper script"
```

---

## Task 9: in-app Add-transaction form

**Files:** `web/src/components/AddTransaction.tsx` (create), `web/src/pages/Transactions.tsx` (modify), `web/src/pages/Accounts.tsx` (remove Add txn)

- [ ] **Step 1: Create `web/src/components/AddTransaction.tsx`**

```typescript
import { useEffect, useState } from "react";
import { api, CATEGORY_OPTIONS } from "../api.ts";
import type { BankDTO, AccountDTO } from "../../../shared/types.ts";

export function AddTransaction({ onAdded }: { onAdded: () => void }) {
  const [manual, setManual] = useState<AccountDTO[]>([]);
  const [accountId, setAccountId] = useState("");
  const [date, setDate] = useState(new Date().toLocaleDateString("en-CA"));
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("other");
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    api.accounts().then((banks: BankDTO[]) => {
      const m = banks.flatMap((b) => b.accounts).filter((a) => a.source === "MANUAL");
      setManual(m);
      if (m[0]) setAccountId(m[0].id);
    }).catch(() => setManual([]));
  }, []);

  if (manual.length === 0) {
    return <div className="card"><span className="muted">Add a cash / manual account on <a href="/accounts">Manage</a> to log transactions here.</span></div>;
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^-?\d+(\.\d+)?$/.test(amount)) { setMsg("Enter a number (negative for spending)"); return; }
    try {
      await api.createTxn({ accountId, date, amount, category, note: note || undefined });
      setAmount(""); setNote(""); setMsg(null);
      onAdded();
    } catch (err) { setMsg((err as Error).message); }
  };

  return (
    <form className="card" onSubmit={submit} style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
      <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
        {manual.map((a) => <option key={a.id} value={a.id}>{a.displayName}</option>)}
      </select>
      <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ width: "auto" }} />
      <input placeholder="-12.50" value={amount} onChange={(e) => setAmount(e.target.value)} style={{ width: 110 }} />
      <select value={category} onChange={(e) => setCategory(e.target.value)}>
        {CATEGORY_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
      <input placeholder="note (optional)" value={note} onChange={(e) => setNote(e.target.value)} style={{ flex: 1, minWidth: 120 }} />
      <button className="btn-primary" type="submit">Add</button>
      {msg && <span className="neg" style={{ width: "100%" }}>{msg}</span>}
    </form>
  );
}
```

- [ ] **Step 2: Use it on `web/src/pages/Transactions.tsx`**

Add import:
```typescript
import { AddTransaction } from "../components/AddTransaction.tsx";
```
Render it directly under the `<h1>Transactions</h1>` header row (before the search input):
```tsx
      <AddTransaction onAdded={load} />
```
(`load` is the existing fetch function in that component.)

- [ ] **Step 3: Remove the prompt-based Add txn from `web/src/pages/Accounts.tsx`**

Delete the `addTxn` function and the `{a.source === "MANUAL" && <button className="btn-sm" onClick={() => addTxn(a.id)}>Add txn</button>}` line.

- [ ] **Step 4: Verify + commit**

Run: `pnpm exec vite build 2>&1 | grep -E "built in|error"`
```bash
cd /Users/mansoor/Developer/personal
git add finance/web/src/components/AddTransaction.tsx finance/web/src/pages/Transactions.tsx finance/web/src/pages/Accounts.tsx
git commit -m "feat: in-app Add-transaction form on Transactions; drop Manage prompt"
```

---

## Task 10: full verification

- [ ] **Step 1:** `eval "$(/opt/homebrew/bin/brew shellenv)"; eval "$(fnm env)"; cd /Users/mansoor/Developer/personal/finance; pnpm test && pnpm exec tsc --noEmit && pnpm exec vite build`
Expected: tests **37 pass** (31 prior + 6 cashTxn), tsc 0, build OK.

---

## Task 11 (MANUAL — human): bot setup + live test

Not for the implementer subagent.

- [ ] Create a bot with @BotFather → `TELEGRAM_BOT_TOKEN`; pick a random `TELEGRAM_WEBHOOK_SECRET`; get your `chat_id` (message the bot, then `getUpdates`) → `TELEGRAM_ALLOWED_CHAT_ID`; add `ANTHROPIC_API_KEY`. Set all four in Railway.
- [ ] After deploy, run `scripts/telegram-set-webhook.sh` (with `APP_BASE_URL`=Railway URL).
- [ ] Message the bot "£12.50 lunch" and send a receipt photo; confirm a Cash transaction appears, the inline category buttons re-categorise, and Undo deletes.

---

## Self-Review

- **Spec coverage:** in-app form (Task 9), note support (Task 3), Claude parse text+photo (Task 4), telegram helpers (Task 5), cash account (Task 6), webhook with allowlist+secret+inline fix/undo (Task 7), setup script (Task 8), optional env (Task 1), normalisation logic + tests (Task 2). All mapped.
- **Placeholder scan:** none.
- **Type consistency:** `ParsedExpense`/`NormalizedTxn` (Task 2) used by parser (Task 4) + webhook (Task 7); `api.createTxn` accepts `note` via `ManualTxnInput` (Task 3); `CATEGORIES` reused; `claude-haiku-4-5` + `messages.parse` + `zodOutputFormat` per the claude-api reference; webhook returns 200 fast then works guarded; UK-local date via `toLocaleDateString("en-CA", {timeZone})` consistent with the budgets month logic.
- **Security:** secret-token check + chat-id allowlist on every update; keys only from env; non-allowlisted updates silently no-op.
