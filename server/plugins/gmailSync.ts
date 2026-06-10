import { db } from "../lib/db.ts";
import { merchantToken } from "../categorise/helpers.ts";
import { geminiGenerateJson, geminiEnabled } from "../categorise/gemini.ts";
import type { AuditFn } from "../categorise/audit.ts";
import * as gmail from "./gmail.ts";

// Ensure a valid Gmail access token, refreshing + persisting when expired.
async function ensureAccessToken(): Promise<string> {
  const p = await db.plugin.findUnique({ where: { id: "gmail" } });
  if (!p?.connected || !p.refreshToken) throw new Error("Gmail is not connected.");
  if (p.accessToken && p.tokenExpiry && p.tokenExpiry.getTime() > Date.now() + 60_000) return p.accessToken;
  const tok = await gmail.refreshAccessToken(p.refreshToken);
  await db.plugin.update({ where: { id: "gmail" }, data: { accessToken: tok.access_token, tokenExpiry: new Date(Date.now() + tok.expires_in * 1000) } });
  return tok.access_token;
}

interface ExtractedOrder {
  ref: string;
  isOrder: boolean;
  merchant: string | null;
  total: number | null;
  currency: string | null;
  orderNumber: string | null;
  items: { name: string; qty: number | null; price: number | null }[];
}

// Ask Gemini to extract structured order data from a batch of emails.
async function extractBatch(emails: gmail.GmailMessage[], batch: number, audit: AuditFn): Promise<ExtractedOrder[]> {
  const block = emails
    .map((e, i) => `--- ref t${i} ---\nFROM: ${e.from}\nSUBJECT: ${e.subject}\nBODY: ${e.body.slice(0, 1400)}`)
    .join("\n\n");
  const prompt = `You extract online purchase/order details from emails. For each email decide if it is a genuine purchase confirmation, order, or receipt (NOT marketing, NOT a wishlist, NOT a password reset, NOT a delivery-status notice without a price).

For each email return an object:
- "id": the ref (e.g. "t0")
- "isOrder": boolean
- "merchant": clean brand name (e.g. "Amazon", "ASOS", "Deliveroo") or null
- "total": the order TOTAL as a number with no currency symbol, or null
- "currency": ISO code like "GBP","USD","EUR" or null
- "orderNumber": string or null
- "items": array of {"name": string, "qty": number|null, "price": number|null}

Emails:
${block}

Respond with ONLY a JSON array, one object per email, nothing else.`;
  // Mirror the reconcile audit: show what was fed to the model and its raw reply.
  audit({ kind: "batch-request", batch, items: emails.map((e, i) => ({ ref: `t${i}`, id: e.id, text: `${e.subject || "(no subject)"} — ${e.from}` })) });
  try {
    const raw = await geminiGenerateJson(prompt, audit, batch);
    audit({ kind: "batch-raw", batch, text: raw });
    const arr = JSON.parse(raw || "[]");
    if (!Array.isArray(arr)) return [];
    return arr.map((o: Record<string, unknown>) => ({
      ref: String(o.id ?? ""),
      isOrder: Boolean(o.isOrder),
      merchant: typeof o.merchant === "string" && o.merchant.trim() ? o.merchant.trim() : null,
      total: typeof o.total === "number" ? o.total : null,
      currency: typeof o.currency === "string" ? o.currency : null,
      orderNumber: typeof o.orderNumber === "string" ? o.orderNumber : null,
      items: Array.isArray(o.items)
        ? o.items.map((it: Record<string, unknown>) => ({
            name: String(it.name ?? "").trim(),
            qty: typeof it.qty === "number" ? it.qty : null,
            price: typeof it.price === "number" ? it.price : null,
          })).filter((it: { name: string }) => it.name)
        : [],
    }));
  } catch (err) {
    audit({ kind: "log", text: `  ✗ extraction batch failed: ${err instanceof Error ? err.message : err}`, tone: "red" });
    return [];
  }
}

const tokenOf = (t: { merchantName: string | null; creditorName: string | null; debtorName: string | null; remittanceInfo: string | null }) =>
  merchantToken(t.merchantName ?? t.creditorName ?? t.debtorName ?? t.remittanceInfo ?? null);

// Token similarity: equal, or one contains the other (word-prefix style).
function tokensRelated(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  return a.includes(b) || b.includes(a);
}

interface TxnLite { id: string; abs: number; date: string | null; token: string | null; friendly: string | null }

// Best transaction for an order. The merchant MUST match (raw statement token or
// the friendly name) — amount+date alone is not enough, or unrelated purchases of
// the same value would mis-match. Among merchant matches, pick closest amount/date.
export function matchTransaction(order: { total: number; date: string | null; token: string | null }, txns: TxnLite[], taken: Set<string>): TxnLite | null {
  const emailMs = order.date ? new Date(order.date).getTime() : null;
  let best: { t: TxnLite; score: number } | null = null;
  for (const t of txns) {
    if (taken.has(t.id)) continue;
    if (!tokensRelated(order.token, t.token) && !tokensRelated(order.token, t.friendly)) continue; // merchant must match
    const amtDiff = Math.abs(t.abs - order.total);
    if (amtDiff > 0.75) continue; // amount must essentially equal the order total
    let dayDiff = 0;
    if (emailMs && t.date) {
      dayDiff = Math.abs(new Date(`${t.date}T00:00:00`).getTime() - emailMs) / 86_400_000;
      if (dayDiff > 14) continue; // charged within a fortnight of the email
    }
    const score = amtDiff * 4 + dayDiff * 0.3;
    if (!best || score < best.score) best = { t, score };
  }
  return best?.t ?? null;
}

// Build the transaction lookup used for matching: raw token + friendly-name token.
export async function loadTxnLites(): Promise<TxnLite[]> {
  const txnRows = await db.transaction.findMany({
    where: { amount: { lt: 0 } },
    select: { id: true, amount: true, bookingDate: true, merchantName: true, creditorName: true, debtorName: true, remittanceInfo: true },
  });
  const named = await db.merchant.findMany({ where: { NOT: { name: null } }, select: { token: true, name: true } });
  const friendlyByToken = new Map(named.map((m) => [m.token, merchantToken(m.name)]));
  return txnRows.map((t) => {
    const token = tokenOf(t);
    return { id: t.id, abs: Math.abs(Number(t.amount)), date: t.bookingDate, token, friendly: token ? friendlyByToken.get(token) ?? null : null };
  });
}

const namesOf = (items: unknown): string[] =>
  Array.isArray(items) ? (items as { name?: string }[]).map((i) => i?.name).filter((n): n is string => Boolean(n)) : [];

// A short "what was bought" note, e.g. "🧾 Drill Brush, Sponges +2 more".
function orderNote(merchant: string | null, itemNames: string[]): string {
  const head = itemNames.slice(0, 3).join(", ");
  const more = itemNames.length > 3 ? ` +${itemNames.length - 3} more` : "";
  const body = head ? `${head}${more}` : merchant ?? "order";
  return `🧾 ${body}`.slice(0, 140);
}

// Write the note only when empty — never overwrite the user's own note.
async function maybeSetNote(txnId: string, note: string): Promise<void> {
  const t = await db.transaction.findUnique({ where: { id: txnId }, select: { note: true } });
  if (t && (t.note == null || t.note.trim() === "")) await db.transaction.update({ where: { id: txnId }, data: { note } });
}

export interface GmailSyncResult { scanned: number; parsed: number; matched: number }

export async function syncGmail(audit: AuditFn): Promise<GmailSyncResult> {
  if (!geminiEnabled()) audit({ kind: "log", text: "⚠ No GEMINI_API_KEY — emails can't be parsed.", tone: "yellow" });
  const token = await ensureAccessToken();

  audit({ kind: "log", text: "● Searching Gmail for orders & receipts", tone: "bold" });
  const ids = await gmail.listMessages(token, "category:purchases newer_than:120d", 80);
  const seen = new Set((await db.emailOrder.findMany({ where: { messageId: { in: ids } }, select: { messageId: true } })).map((e) => e.messageId));
  const fresh = ids.filter((id) => !seen.has(id));
  audit({ kind: "log", text: `  ${ids.length} candidates · ${fresh.length} new · ${seen.size} already parsed`, tone: "dim" });

  if (!fresh.length) {
    await db.plugin.update({ where: { id: "gmail" }, data: { lastSyncAt: new Date() } });
    audit({ kind: "log", text: "Nothing new to parse.", tone: "green" });
    return { scanned: ids.length, parsed: 0, matched: 0 };
  }

  audit({ kind: "log", text: "● Fetching emails", tone: "bold" });
  const emails: gmail.GmailMessage[] = [];
  for (const id of fresh) {
    try { emails.push(await gmail.getMessage(token, id)); }
    catch (err) { audit({ kind: "log", text: `  ✗ ${id}: ${err instanceof Error ? err.message : err}`, tone: "red" }); }
  }

  // Matching context: recent spending transactions (raw + friendly tokens).
  const txns = await loadTxnLites();
  const taken = new Set((await db.emailOrder.findMany({ where: { transactionId: { not: null } }, select: { transactionId: true } })).map((e) => e.transactionId!).filter(Boolean));

  // Dedupe repeat emails for one purchase (order confirmation + dispatch/receipt).
  // Key on order number when present, else merchant+total+day.
  const orderSig = (token: string | null, total: number, orderNo: string | null, date: Date | null) =>
    orderNo ? `${token}|${total}|${orderNo.toLowerCase().replace(/\s+/g, "")}` : `${token}|${total}|${date ? date.toISOString().slice(0, 10) : ""}`;
  const existingSigs = await db.emailOrder.findMany({ where: { total: { not: null } }, select: { merchantToken: true, total: true, orderNumber: true, emailDate: true } });
  const seenSigs = new Set(existingSigs.map((o) => orderSig(o.merchantToken, Number(o.total!.toString()), o.orderNumber, o.emailDate)));

  audit({ kind: "log", text: "● Extracting order details (Gemini)", tone: "bold" });
  let parsed = 0, matched = 0, dupes = 0;
  const SIZE = 20;
  for (let i = 0; i < emails.length; i += SIZE) {
    const chunk = emails.slice(i, i + SIZE);
    const extracted = await extractBatch(chunk, i / SIZE + 1, audit);
    const byRef = new Map(extracted.map((e) => [e.ref, e]));
    for (let j = 0; j < chunk.length; j++) {
      const email = chunk[j];
      const o = byRef.get(`t${j}`);
      const emailDate = email.date ? new Date(email.date) : null;
      const parsedOk = Boolean(o?.isOrder && o.total != null && o.merchant);
      const oToken = parsedOk ? merchantToken(o!.merchant) : null;
      // A repeat email for an order we already captured: record the message (so
      // it isn't re-fetched) but null its total so it's hidden + not matched.
      let dup = false;
      if (parsedOk) {
        const sig = orderSig(oToken, o!.total!, o!.orderNumber, emailDate);
        if (seenSigs.has(sig)) dup = true; else seenSigs.add(sig);
      }
      const isOrder = parsedOk && !dup;
      let txn: TxnLite | null = null;
      if (isOrder) {
        parsed++;
        txn = matchTransaction({ total: o!.total!, date: email.date, token: oToken }, txns, taken);
        if (txn) { taken.add(txn.id); matched++; await maybeSetNote(txn.id, orderNote(o!.merchant, o!.items.map((it) => it.name))); }
      }
      if (dup) dupes++;
      await db.emailOrder.create({
        data: {
          messageId: email.id,
          emailDate,
          merchantName: parsedOk ? o!.merchant : null,
          merchantToken: oToken,
          total: isOrder ? o!.total : null,
          currency: o?.currency ?? null,
          orderNumber: o?.orderNumber ?? null,
          items: isOrder ? (o!.items as unknown as object) : undefined,
          subject: email.subject || null,
          transactionId: txn?.id ?? null,
          matched: Boolean(txn),
        },
      });
      if (isOrder) {
        const label = `${o!.merchant ?? "?"} · ${o!.currency ?? ""}${o!.total}`;
        if (txn) audit({ kind: "assign", id: email.id, name: label, to: `txn ${txn.date ?? ""}`, via: "llm" });
        else audit({ kind: "log", text: `  ai   ${label.length > 34 ? `${label.slice(0, 33)}…` : label.padEnd(34)} → no transaction match`, tone: "yellow" });
      } else if (dup) {
        audit({ kind: "log", text: `  ·    ${(o!.merchant ?? "").slice(0, 33).padEnd(34)} → duplicate, skipped`, tone: "dim" });
      }
    }
  }

  // Re-match previously-parsed orders that never linked (the transaction may have
  // landed later, or matching has since tightened/improved).
  const open = await db.emailOrder.findMany({ where: { total: { not: null }, transactionId: null } });
  let rematched = 0;
  if (open.length) {
    audit({ kind: "log", text: "● Re-matching open orders", tone: "bold" });
    for (const o of open) {
      const txn = matchTransaction({ total: Number(o.total!.toString()), date: o.emailDate?.toISOString() ?? null, token: o.merchantToken }, txns, taken);
      if (!txn) continue;
      taken.add(txn.id);
      await db.emailOrder.update({ where: { id: o.id }, data: { transactionId: txn.id, matched: true } });
      await maybeSetNote(txn.id, orderNote(o.merchantName, namesOf(o.items)));
      rematched++;
      audit({ kind: "assign", id: o.id, name: `${o.merchantName ?? "?"} · ${o.currency ?? ""}${o.total}`, to: `txn ${txn.date ?? ""}`, via: "llm" });
    }
    audit({ kind: "log", text: `  ${rematched} re-matched`, tone: rematched ? "green" : "dim" });
  }

  const totalMatched = matched + rematched;
  await db.plugin.update({ where: { id: "gmail" }, data: { lastSyncAt: new Date() } });
  audit({ kind: "log", text: "● Summary", tone: "bold" });
  audit({ kind: "log", text: `  ${parsed} new orders · ${totalMatched} matched${rematched ? ` (${rematched} re-matched)` : ""}${dupes ? ` · ${dupes} duplicates skipped` : ""}`, tone: totalMatched ? "green" : "dim" });
  audit({ kind: "log", text: "Sync complete.", tone: "green" });
  return { scanned: ids.length, parsed, matched: totalMatched };
}
