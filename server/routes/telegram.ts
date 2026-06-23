import { Router } from "express";
import { randomUUID } from "node:crypto";
import { env } from "../env.ts";
import { db } from "../lib/db.ts";
import { isAllowed, confirmText, parseTextExpense } from "../lib/cashTxn.ts";
import { geminiParseExpense } from "../categorise/gemini.ts";
import { applyRules, type Rule } from "../lib/rules.ts";
import { sendMessage, editMessageText, answerCallbackQuery, deleteMessage, setMessageReaction } from "../telegram/api.ts";
import { getOrCreateCashAccount } from "../telegram/cashAccount.ts";
import { handleReceiptPhoto } from "../telegram/receipt.ts";

export const telegramRouter = Router();

const configured = () =>
  !!(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_WEBHOOK_SECRET && env.TELEGRAM_ALLOWED_CHAT_ID);

// Active categories, ordered by how often you actually use them, so the keyboard
// surfaces your real spending categories (groceries, eating out, pets…) rather
// than a fixed bill list.
async function spendingCategories(): Promise<{ key: string; name: string }[]> {
  const cats = await db.category.findMany({ where: { archived: false } });
  const counts = await db.transaction.groupBy({ by: ["category"], _count: { _all: true } });
  const cnt = new Map(counts.map((c) => [c.category, c._count._all]));
  return cats
    .sort((a, b) => (cnt.get(b.key) ?? 0) - (cnt.get(a.key) ?? 0))
    .map((c) => ({ key: c.key, name: c.name }));
}

const nameOf = (key: string, cats: { key: string; name: string }[]) =>
  cats.find((c) => c.key === key)?.name ?? key;

// The inline category keyboard. The AI-suggested category is pinned first, then
// your most-used categories; "Uncategorised" is always offered.
function categoryKeyboard(txId: string, cats: { key: string; name: string }[], suggested?: string | null) {
  let ordered = cats;
  if (suggested) ordered = [...cats.filter((c) => c.key === suggested), ...cats.filter((c) => c.key !== suggested)];
  let top = ordered.filter((c) => c.key !== "uncategorised").slice(0, 8);
  top = [...top, { key: "uncategorised", name: "Uncategorised" }];
  const rows: { text: string; callback_data: string }[][] = [];
  for (let i = 0; i < top.length; i += 3) {
    rows.push(top.slice(i, i + 3).map((c) => ({ text: c.name, callback_data: `cat:${c.key}:${txId}` })));
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
        const cats = await spendingCategories();
        if (cats.some((c) => c.key === category) || category === "income" || category === "transfer") {
          const tx = await db.transaction.findUnique({ where: { id } });
          if (tx) {
            await db.transaction.update({ where: { id }, data: { categoryOverride: category } });
            await answerCallbackQuery(cq.id, `→ ${nameOf(category, cats)}`);
            if (chatId && messageId) {
              await editMessageText(chatId, messageId,
                confirmText({ amount: tx.amount.toString(), category: nameOf(category, cats), note: tx.note ?? tx.merchantName ?? "", date: tx.bookingDate ?? "" }),
                categoryKeyboard(id, cats, category));
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
      const userMsgId: number | undefined = msg.message_id;
      // React 👀 on the photo while we read it; the interim "reading…" note is
      // deleted once the result lands, and the reaction flips to reflect the outcome.
      if (userMsgId) await setMessageReaction(chatId, userMsgId, "👀").catch(() => undefined);
      const reading = await sendMessage(chatId, "📸 Reading your receipt…");
      const readingId = reading?.result?.message_id;
      try {
        const result = await handleReceiptPhoto(file.file_id, file.file_unique_id ?? file.file_id);
        if (readingId) await deleteMessage(chatId, readingId).catch(() => undefined);
        const ok = result.startsWith("🧾");
        if (userMsgId) await setMessageReaction(chatId, userMsgId, ok ? "🎉" : "🤔").catch(() => undefined);
        // Reply onto the user's photo so the receipt info reads as its caption.
        await sendMessage(chatId, result, undefined, userMsgId);
      } catch (err) {
        console.error("telegram receipt error", err);
        if (readingId) await deleteMessage(chatId, readingId).catch(() => undefined);
        if (userMsgId) await setMessageReaction(chatId, userMsgId, "🤔").catch(() => undefined);
        await sendMessage(chatId, "Couldn't read that receipt — try a clearer, well-lit photo.", undefined, userMsgId);
      }
      return;
    }

    if (!msg.text) {
      await sendMessage(chatId, "Send a text expense like '£12.50 lunch', or a photo of a receipt.");
      return;
    }
    try {
      const cats = await spendingCategories();
      // A bare word with no amount → treat it as setting the category of the most
      // recent cash expense (so you can just reply "Pets" to fix it).
      if (!/\d/.test(msg.text)) {
        const wanted = msg.text.trim().toLowerCase();
        const matched = cats.find((c) => c.name.toLowerCase() === wanted || c.key === wanted);
        const recent = await db.transaction.findFirst({
          where: { account: { source: "MANUAL" }, createdAt: { gt: new Date(Date.now() - 15 * 60 * 1000) } },
          orderBy: { createdAt: "desc" },
        });
        if (matched && recent) {
          await db.transaction.update({ where: { id: recent.id }, data: { categoryOverride: matched.key } });
          await sendMessage(chatId, `Updated to ${matched.name}.`);
        } else {
          await sendMessage(chatId, "Send an expense like '£12.50 lunch', or tap a category on your last one.");
        }
        return;
      }
      const today = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });
      // Prefer AI parsing (clean merchant + summary + suggested category); fall
      // back to the free regex parser if no key / no parse.
      const ai = await geminiParseExpense(msg.text, cats).catch(() => null);
      let amount: number, merchant: string | null, summary: string | null, income: boolean, aiCategory: string | null;
      if (ai) {
        income = ai.isIncome;
        amount = income ? Math.abs(ai.amount) : -Math.abs(ai.amount);
        merchant = ai.merchant;
        summary = ai.summary || null;
        aiCategory = ai.categoryKey;
      } else {
        const parsed = parseTextExpense(msg.text);
        if (!parsed) { await sendMessage(chatId, "Couldn't read an amount — try e.g. '£12.50 lunch'."); return; }
        income = parsed.amount > 0;
        amount = parsed.amount;
        merchant = parsed.merchant || null;
        summary = null;
        aiCategory = null;
      }
      const ruleRows = await db.rule.findMany();
      const ruled = applyRules(msg.text, ruleRows.map((r) => ({ matchText: r.matchText, categoryKey: r.categoryKey, personKey: r.personKey, priority: r.priority }) as Rule));
      // Priority: a learned rule, then the AI's suggestion, then income/uncategorised.
      const category = ruled.categoryKey ?? (aiCategory && aiCategory !== "uncategorised" ? aiCategory : (income ? "income" : "uncategorised"));
      const personKey = ruled.personKey ?? null;
      const accountId = await getOrCreateCashAccount();
      // Short id keeps the inline-button callback_data within Telegram's 64-byte limit.
      const id = `tg-${randomUUID().slice(0, 18)}`;
      await db.transaction.create({
        data: {
          id, accountId, bookingDate: today, amount: amount.toFixed(2), currency: "GBP",
          merchantName: merchant, remittanceInfo: merchant ?? msg.text.slice(0, 80), note: summary,
          category, personKey, status: "booked", raw: { telegram: true },
        },
      });
      await sendMessage(chatId, confirmText({ amount: amount.toFixed(2), category: nameOf(category, cats), note: summary ?? merchant ?? "", date: today }), categoryKeyboard(id, cats, category));
    } catch (err) {
      console.error("telegram text error", err);
      await sendMessage(chatId, `⚠️ Couldn't log that: ${err instanceof Error ? err.message.slice(0, 150) : String(err)}`);
    }
  } catch (err) {
    console.error("telegram webhook error", err);
  }
});
