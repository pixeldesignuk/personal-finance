import { Router } from "express";
import { randomUUID } from "node:crypto";
import { env } from "../env.ts";
import { db } from "../lib/db.ts";
import { isAllowed, normalizeParsed, confirmText } from "../lib/cashTxn.ts";
import { CATEGORIES, SPENDING_CATEGORIES } from "../lib/categorize.ts";
import { parseText, parseImage } from "../telegram/parse.ts";
import { sendMessage, editMessageText, answerCallbackQuery, downloadPhoto } from "../telegram/api.ts";
import { getOrCreateCashAccount } from "../telegram/cashAccount.ts";

export const telegramRouter = Router();

const configured = () =>
  !!(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_WEBHOOK_SECRET && env.TELEGRAM_ALLOWED_CHAT_ID && env.ANTHROPIC_API_KEY);

function categoryKeyboard(txId: string) {
  const spend = [...SPENDING_CATEGORIES];
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
        // Only ever delete manual transactions (never synced bank rows).
        const tx = await db.transaction.findUnique({ where: { id }, include: { account: true } });
        if (tx && tx.account.source === "MANUAL") await db.transaction.delete({ where: { id } });
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
    if (!msg) return;
    const chatId = msg.chat?.id;
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
