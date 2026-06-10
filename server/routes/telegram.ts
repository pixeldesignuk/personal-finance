import { Router } from "express";
import { randomUUID } from "node:crypto";
import { env } from "../env.ts";
import { db } from "../lib/db.ts";
import { isAllowed, normalizeParsed, confirmText, parseTextExpense } from "../lib/cashTxn.ts";
import { applyRules, type Rule } from "../lib/rules.ts";
import { sendMessage, editMessageText, answerCallbackQuery } from "../telegram/api.ts";
import { getOrCreateCashAccount } from "../telegram/cashAccount.ts";
import { handleReceiptPhoto } from "../telegram/receipt.ts";

export const telegramRouter = Router();

const configured = () =>
  !!(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_WEBHOOK_SECRET && env.TELEGRAM_ALLOWED_CHAT_ID);

async function activeCategories(): Promise<{ key: string; name: string }[]> {
  const cats = await db.category.findMany({ where: { archived: false }, orderBy: { sortOrder: "asc" } });
  return cats.map((c) => ({ key: c.key, name: c.name }));
}

function categoryKeyboard(txId: string, cats: { key: string; name: string }[]) {
  const rows = [];
  const top = cats.slice(0, 9); // keep the keyboard small
  for (let i = 0; i < top.length; i += 3) {
    rows.push(top.slice(i, i + 3).map((c) => ({ text: c.name, callback_data: `cat:${c.key}:${txId}` })));
  }
  rows.push([{ text: "↩︎ Undo", callback_data: `undo:${txId}` }]);
  return { inline_keyboard: rows };
}

// TEMP diagnostic: Telegram's view of the webhook (delivery errors, pending
// updates, allowed_updates). Remove once debugged.
telegramRouter.get("/telegram/webhook-info", async (_req, res) => {
  try {
    if (!env.TELEGRAM_BOT_TOKEN) { res.json({ error: "TELEGRAM_BOT_TOKEN not set" }); return; }
    const r = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getWebhookInfo`);
    res.json(await r.json());
  } catch (err) { res.json({ error: String(err) }); }
});

// TEMP setup: register the Telegram webhook from the server (which holds the
// token/secret) and report which env vars are present. Remove once working.
telegramRouter.get("/telegram/setup", async (_req, res) => {
  const have = {
    token: Boolean(env.TELEGRAM_BOT_TOKEN),
    secret: Boolean(env.TELEGRAM_WEBHOOK_SECRET),
    allowedChat: Boolean(env.TELEGRAM_ALLOWED_CHAT_ID),
    appBaseUrl: env.APP_BASE_URL,
  };
  if (!env.TELEGRAM_BOT_TOKEN) { res.json({ have, error: "TELEGRAM_BOT_TOKEN/KEY not set" }); return; }
  const url = `${env.APP_BASE_URL}/api/telegram/webhook`;
  try {
    const r = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/setWebhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url,
        secret_token: env.TELEGRAM_WEBHOOK_SECRET || undefined,
        allowed_updates: ["message", "callback_query"],
        drop_pending_updates: true,
      }),
    });
    res.json({ have, url, result: await r.json() });
  } catch (err) { res.json({ have, url, error: String(err) }); }
});

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
        // Only ever delete manual transactions (never synced bank rows).
        const tx = await db.transaction.findUnique({ where: { id }, include: { account: true } });
        if (tx && tx.account.source === "MANUAL") await db.transaction.delete({ where: { id } });
        await answerCallbackQuery(cq.id, "Removed");
        if (chatId && messageId) await editMessageText(chatId, messageId, "↩︎ Removed.");
      } else if (data.startsWith("cat:")) {
        const [, category, id] = data.split(":");
        const cats = await activeCategories();
        if (cats.some((c) => c.key === category) || category === "income" || category === "transfer") {
          const tx = await db.transaction.findUnique({ where: { id } });
          if (tx) {
            await db.transaction.update({ where: { id }, data: { categoryOverride: category } });
            await answerCallbackQuery(cq.id, `→ ${category}`);
            if (chatId && messageId) {
              await editMessageText(chatId, messageId,
                confirmText({ amount: tx.amount.toString(), category, note: tx.remittanceInfo ?? "", date: tx.bookingDate ?? "" }),
                categoryKeyboard(id, cats));
            }
          }
        }
      }
      return;
    }

    const msg = update.message;
    if (!msg) return;
    const chatId = msg.chat?.id;
    if (!isAllowed(chatId, env.TELEGRAM_ALLOWED_CHAT_ID)) return;

    // A photo (or image/PDF document) → treat as a receipt: scan with Gemini,
    // store it, match it to a transaction.
    const photo = Array.isArray(msg.photo) && msg.photo.length ? msg.photo[msg.photo.length - 1] : null;
    const doc = msg.document && /^(image\/|application\/pdf)/.test(String(msg.document.mime_type ?? "")) ? msg.document : null;
    const file = photo ?? doc;
    if (file?.file_id) {
      await sendMessage(chatId, "📸 Reading your receipt…");
      try {
        await sendMessage(chatId, await handleReceiptPhoto(file.file_id, file.file_unique_id ?? file.file_id));
      } catch (err) {
        console.error("telegram receipt error", err);
        await sendMessage(chatId, "Couldn't read that receipt — try a clearer, well-lit photo.");
      }
      return;
    }

    if (!msg.text) {
      await sendMessage(chatId, "Send a text expense like '£12.50 lunch', or a photo of a receipt.");
      return;
    }
    const parsed = parseTextExpense(msg.text);
    if (!parsed) {
      await sendMessage(chatId, "Couldn't read an amount — try e.g. '£12.50 lunch'.");
      return;
    }

    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });
    const n = normalizeParsed(parsed, today);
    const ruleRows = await db.rule.findMany();
    const ruled = applyRules(msg.text, ruleRows.map((r) => ({ matchText: r.matchText, categoryKey: r.categoryKey, personKey: r.personKey, priority: r.priority }) as Rule));
    const category = ruled.categoryKey ?? n.category; // n.category is "income"/"uncategorised"
    const personKey = ruled.personKey ?? null;
    const accountId = await getOrCreateCashAccount();
    const id = `manual-${randomUUID()}`;
    await db.transaction.create({
      data: {
        id, accountId, bookingDate: n.date, amount: n.amount, currency: "GBP",
        remittanceInfo: n.note || null, category, personKey, status: "booked", raw: { telegram: true },
      },
    });
    await sendMessage(chatId, confirmText({ ...n, category }), categoryKeyboard(id, await activeCategories()));
  } catch (err) {
    console.error("telegram webhook error", err);
  }
});
