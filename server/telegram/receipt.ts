import { randomUUID } from "node:crypto";
import { db } from "../lib/db.ts";
import { merchantToken } from "../categorise/helpers.ts";
import { geminiExtractReceiptImage } from "../categorise/gemini.ts";
import { rematchOpenOrders } from "../plugins/gmailSync.ts";
import { applyRules, type Rule } from "../lib/rules.ts";
import { storageEnabled, putObject } from "../lib/storage.ts";
import { getOrCreateCashAccount } from "./cashAccount.ts";
import { getFilePath, downloadFile } from "./api.ts";

const extFor = (mime: string) => (mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : mime.includes("pdf") ? "pdf" : "jpg");

interface ExtractedItem { name: string; qty: number | null; price: number | null }
const sym = (c: string | null) => (c === "USD" ? "$" : c === "EUR" ? "€" : "£");

// Handle a receipt photo/PDF sent to the bot: download it, Gemini-extract the
// purchase, store it as an EmailOrder (source "telegram"), then run the shared
// order↔transaction matcher. Returns a human reply for Telegram.
export async function handleReceiptPhoto(fileId: string, fileUniqueId: string): Promise<string> {
  const path = await getFilePath(fileId);
  if (!path) return "Couldn't fetch that file from Telegram.";
  const { base64, mimeType } = await downloadFile(path);

  const raw = await geminiExtractReceiptImage(base64, mimeType);
  if (!raw) return "Receipt scanning needs GEMINI_API_KEY set.";
  let o: { merchant?: string | null; total?: number | null; currency?: string | null; orderNumber?: string | null; date?: string | null; items?: unknown; tags?: unknown };
  try { o = JSON.parse(raw); } catch { return "Couldn't read that receipt — try a clearer, well-lit photo."; }
  if (!o || o.total == null || !o.merchant) return "That doesn't look like a receipt I can read — try a clearer photo.";

  const messageId = `telegram-${fileUniqueId}`;
  if (await db.emailOrder.findUnique({ where: { messageId } })) return "Already saved that receipt.";

  const items: ExtractedItem[] = Array.isArray(o.items)
    ? (o.items as Record<string, unknown>[]).map((it) => ({
        name: String(it?.name ?? "").trim(),
        qty: typeof it?.qty === "number" ? it.qty : null,
        price: typeof it?.price === "number" ? it.price : null,
      })).filter((it) => it.name)
    : [];
  const tags = Array.isArray(o.tags) ? (o.tags as unknown[]).map((t) => String(t).toLowerCase().trim()).filter(Boolean).slice(0, 4) : [];
  const emailDate = o.date ? new Date(`${o.date}T12:00:00`) : new Date();

  // Keep the original document in object storage (best-effort).
  let attachmentKey: string | null = null;
  if (storageEnabled()) {
    try {
      const key = `receipts/${messageId}.${extFor(mimeType)}`;
      await putObject(key, Buffer.from(base64, "base64"), mimeType);
      attachmentKey = key;
    } catch (err) { console.error("receipt upload failed:", err instanceof Error ? err.message : err); }
  }

  await db.emailOrder.create({
    data: {
      messageId, source: "telegram", emailDate,
      merchantName: o.merchant, merchantToken: merchantToken(o.merchant),
      total: o.total, currency: o.currency ?? "GBP", orderNumber: o.orderNumber ?? null,
      items: items as unknown as object, tags: tags as unknown as object,
      subject: `Receipt — ${o.merchant}`, isRefund: false, matched: false, attachmentKey,
    },
  });

  // Link it to an existing bank transaction if one's already there.
  await rematchOpenOrders().catch(() => undefined);
  const saved = await db.emailOrder.findUnique({ where: { messageId }, select: { id: true, matched: true } });

  // No bank charge yet → record the spend now as a provisional cash transaction
  // (it moves to the bank charge later if one syncs — see reconcileReceiptProvisionals).
  let createdTxn = false;
  if (saved && !saved.matched) {
    const accountId = await getOrCreateCashAccount();
    const ruleRows = await db.rule.findMany();
    const ruled = applyRules(o.merchant ?? "", ruleRows.map((r) => ({ matchText: r.matchText, categoryKey: r.categoryKey, personKey: r.personKey, priority: r.priority }) as Rule));
    const txnId = `receipt-${randomUUID()}`;
    const note = items.length ? `🧾 ${items.slice(0, 3).map((i) => i.name).join(", ")}${items.length > 3 ? ` +${items.length - 3} more` : ""}`.slice(0, 140) : null;
    await db.transaction.create({
      data: {
        id: txnId, accountId, bookingDate: o.date ?? new Date().toISOString().slice(0, 10),
        amount: `-${Number(o.total)}`, currency: o.currency ?? "GBP", merchantName: o.merchant,
        category: ruled.categoryKey ?? "uncategorised", personKey: ruled.personKey ?? null,
        note, status: "booked", raw: { telegramReceipt: true, emailOrderId: saved.id },
      },
    });
    await db.emailOrder.update({ where: { id: saved.id }, data: { transactionId: txnId, matched: true } });
    createdTxn = true;
  }

  const head = `🧾 ${o.merchant} — ${sym(o.currency ?? "GBP")}${Number(o.total).toFixed(2)}${items.length ? ` · ${items.length} item${items.length === 1 ? "" : "s"}` : ""}`;
  const status = createdTxn
    ? "\n💸 added as a cash transaction (moves to your bank charge if one lands)"
    : "\n✓ matched to a transaction";
  const lines = items.length ? `\n${items.slice(0, 6).map((i) => `• ${i.name}`).join("\n")}${items.length > 6 ? `\n…+${items.length - 6} more` : ""}` : "";
  return `${head}${status}${lines}`;
}
