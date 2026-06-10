import { db } from "../lib/db.ts";
import { merchantToken } from "../categorise/helpers.ts";
import { geminiExtractReceiptImage } from "../categorise/gemini.ts";
import { rematchOpenOrders } from "../plugins/gmailSync.ts";
import { createReceiptTransaction } from "../lib/receiptTxn.ts";
import { storageEnabled, putObject } from "../lib/storage.ts";
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

  let raw: string;
  try { raw = await geminiExtractReceiptImage(base64, mimeType); }
  catch (err) { return `⚠️ Scan failed: ${err instanceof Error ? err.message.slice(0, 200) : String(err)}`; }
  if (!raw) return "Receipt scanning needs GEMINI_API_KEY set.";
  // Defensive: strip ```json fences the model sometimes adds.
  const clean = raw.replace(/^\s*```(?:json)?/i, "").replace(/```\s*$/i, "").trim();
  let o: { merchant?: string | null; total?: number | null; currency?: string | null; orderNumber?: string | null; date?: string | null; items?: unknown; tags?: unknown; summary?: string | null };
  try { o = JSON.parse(clean); } catch { return `⚠️ Couldn't parse the scan output: ${clean.slice(0, 180) || "(empty)"}`; }
  if (Array.isArray(o)) o = o[0] ?? {};
  if (!o || o.total == null || !o.merchant) return `⚠️ Not recognised as a receipt — model returned: ${JSON.stringify(o).slice(0, 180)}`;

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
  const summary = typeof o.summary === "string" && o.summary.trim() ? o.summary.trim() : null;
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
      items: items as unknown as object, tags: tags as unknown as object, summary,
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
    await createReceiptTransaction({ id: saved.id, merchantName: o.merchant ?? null, total: o.total, currency: o.currency ?? "GBP", emailDate, items, summary });
    createdTxn = true;
  }

  const head = `🧾 ${o.merchant} — ${sym(o.currency ?? "GBP")}${Number(o.total).toFixed(2)}${items.length ? ` · ${items.length} item${items.length === 1 ? "" : "s"}` : ""}`;
  const status = createdTxn
    ? "\n💸 added as a cash transaction (moves to your bank charge if one lands)"
    : "\n✓ matched to a transaction";
  const lines = items.length ? `\n${items.slice(0, 6).map((i) => `• ${i.name}`).join("\n")}${items.length > 6 ? `\n…+${items.length - 6} more` : ""}` : "";
  return `${head}${status}${lines}`;
}
