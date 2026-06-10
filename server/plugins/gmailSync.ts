import { db } from "../lib/db.ts";
import { env } from "../env.ts";
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
  isRefund: boolean;
  merchant: string | null;
  total: number | null;
  currency: string | null;
  orderNumber: string | null;
  items: { name: string; qty: number | null; price: number | null }[];
  tags: string[];
}

// Ask Gemini to extract structured order data from a batch of emails.
async function extractBatch(emails: gmail.GmailMessage[], batch: number, audit: AuditFn): Promise<ExtractedOrder[]> {
  const block = emails
    .map((e, i) => `--- ref t${i} ---\nFROM: ${e.from}\nSUBJECT: ${e.subject}\nBODY: ${e.body.slice(0, 1400)}`)
    .join("\n\n");
  const prompt = `You extract online purchase/order details from emails. For each email decide if it is a genuine purchase confirmation, order, or receipt (NOT marketing, NOT a wishlist, NOT a password reset, NOT a delivery-status notice without a price).

For each email return an object:
- "id": the ref (e.g. "t0")
- "isOrder": boolean (a purchase/order/receipt)
- "isRefund": boolean (a refund/return confirmation crediting money back)
- "merchant": clean brand name (e.g. "Amazon", "ASOS", "Deliveroo") or null
- "total": the TOTAL amount as a number with no currency symbol, or null
- "currency": ISO code like "GBP","USD","EUR" or null
- "orderNumber": string or null
- "items": array of {"name": string, "qty": number|null, "price": number|null}
- "tags": 1-4 short lowercase category tags describing it for search (e.g. ["groceries","household"], ["electronics"], ["takeaway"], ["clothing"])

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
      isRefund: Boolean(o.isRefund),
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
      tags: Array.isArray(o.tags) ? (o.tags as unknown[]).map((t) => String(t).toLowerCase().trim()).filter(Boolean).slice(0, 4) : [],
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
// `credits` flips to incoming money (for matching refunds); `bankOnly` restricts
// to synced bank transactions (used when reconciling provisional cash receipts).
export async function loadTxnLites(credits = false, bankOnly = false): Promise<TxnLite[]> {
  const txnRows = await db.transaction.findMany({
    where: {
      ...(credits ? { amount: { gt: 0 } } : { amount: { lt: 0 } }),
      ...(bankOnly ? { account: { source: "BANK" } } : {}),
    },
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
  return body.slice(0, 140);
}
const refundNote = (merchant: string | null) => `refund — ${merchant ?? "order"}`.slice(0, 140);

// Write the note only when empty — never overwrite the user's own note.
async function maybeSetNote(txnId: string, note: string): Promise<void> {
  const t = await db.transaction.findUnique({ where: { id: txnId }, select: { note: true } });
  if (t && (t.note == null || t.note.trim() === "")) await db.transaction.update({ where: { id: txnId }, data: { note } });
}

// Link every still-open order/refund to a transaction if one now exists. This is
// the bidirectional half of matching: it runs both at the end of a Gmail sync
// (a new email looking for its transaction) AND after a bank sync (a freshly
// posted transaction claiming an order that was parsed earlier — bank data lags
// email by hours/days, so the order often arrives first and waits here).
// Idempotent: a `taken` set built from already-linked orders prevents
// double-claiming, and notes are only written when blank.
export async function rematchOpenOrders(audit?: AuditFn): Promise<{ matched: number }> {
  const open = await db.emailOrder.findMany({ where: { total: { not: null }, transactionId: null } });
  if (!open.length) return { matched: 0 };

  // Orders match spending (debits); refunds match incoming money (credits).
  const debits = await loadTxnLites(false);
  const credits = await loadTxnLites(true);
  const taken = new Set(
    (await db.emailOrder.findMany({ where: { transactionId: { not: null } }, select: { transactionId: true } }))
      .map((e) => e.transactionId!).filter(Boolean),
  );

  audit?.({ kind: "log", text: `● Matching ${open.length} open order${open.length === 1 ? "" : "s"} to transactions`, tone: "bold" });
  let matched = 0;
  for (const o of open) {
    const pool = o.isRefund ? credits : debits;
    const txn = matchTransaction(
      { total: Number(o.total!.toString()), date: o.emailDate?.toISOString() ?? null, token: o.merchantToken },
      pool,
      taken,
    );
    if (!txn) continue;
    taken.add(txn.id);
    await db.emailOrder.update({ where: { id: o.id }, data: { transactionId: txn.id, matched: true } });
    await maybeSetNote(txn.id, o.isRefund ? refundNote(o.merchantName) : orderNote(o.merchantName, namesOf(o.items)));
    matched++;
    audit?.({ kind: "assign", id: o.id, name: `${o.isRefund ? "↩ " : ""}${o.merchantName ?? "?"} · ${o.currency ?? ""}${o.total}`, to: `txn ${txn.date ?? ""}`, via: "llm" });
  }
  audit?.({ kind: "log", text: `  ${matched} linked`, tone: matched ? "green" : "dim" });
  return { matched };
}

// A Telegram cash receipt creates a provisional manual transaction so the spend
// shows immediately. If the real bank charge later syncs, move the receipt onto
// it and delete the provisional (so card purchases don't double-count); genuine
// cash purchases keep their provisional transaction.
export async function reconcileReceiptProvisionals(audit?: AuditFn): Promise<{ moved: number }> {
  const provs = await db.transaction.findMany({ where: { raw: { path: ["telegramReceipt"], equals: true } }, select: { id: true } });
  if (!provs.length) return { moved: 0 };
  const bank = await loadTxnLites(false, true); // real bank debits only
  const taken = new Set(
    (await db.emailOrder.findMany({ where: { transactionId: { not: null } }, select: { transactionId: true } }))
      .map((e) => e.transactionId!).filter(Boolean),
  );
  let moved = 0;
  for (const p of provs) {
    const order = await db.emailOrder.findFirst({ where: { transactionId: p.id, total: { not: null } } });
    if (!order) continue;
    const txn = matchTransaction({ total: Number(order.total!.toString()), date: order.emailDate?.toISOString() ?? null, token: order.merchantToken }, bank, taken);
    if (!txn) continue;
    taken.add(txn.id);
    await db.emailOrder.update({ where: { id: order.id }, data: { transactionId: txn.id, matched: true } });
    await maybeSetNote(txn.id, orderNote(order.merchantName, namesOf(order.items)));
    await db.transaction.delete({ where: { id: p.id } });
    moved++;
  }
  if (audit && moved) audit({ kind: "log", text: `  ${moved} cash receipt${moved === 1 ? "" : "s"} reconciled to a bank charge`, tone: "green" });
  return { moved };
}

// Re-arm the Gmail push watch if it's missing or close to expiry. No-op unless a
// Pub/Sub topic is configured and Gmail is connected. Called on connect and from
// the sync cron (the watch lapses after ~7 days).
export async function ensureGmailWatch(force = false): Promise<{ armed: boolean; expiry?: Date }> {
  if (!env.GMAIL_PUBSUB_TOPIC) return { armed: false };
  const p = await db.plugin.findUnique({ where: { id: "gmail" } });
  if (!p?.connected || !p.refreshToken) return { armed: false };
  if (!force && p.watchExpiry && p.watchExpiry.getTime() > Date.now() + 24 * 3_600_000) return { armed: false, expiry: p.watchExpiry };
  const token = await ensureAccessToken();
  const r = await gmail.watch(token, env.GMAIL_PUBSUB_TOPIC);
  const expiry = new Date(Number(r.expiration));
  await db.plugin.update({ where: { id: "gmail" }, data: { watchExpiry: expiry } });
  return { armed: true, expiry };
}

export interface GmailSyncResult { scanned: number; parsed: number; matched: number }

export async function syncGmail(audit: AuditFn): Promise<GmailSyncResult> {
  if (!geminiEnabled()) audit({ kind: "log", text: "⚠ No GEMINI_API_KEY — emails can't be parsed.", tone: "yellow" });
  const token = await ensureAccessToken();

  const plugin = await db.plugin.findUnique({ where: { id: "gmail" } });
  audit({ kind: "log", text: "● Searching Gmail for orders & receipts", tone: "bold" });
  // Incremental: only fetch emails newer than the last processed one.
  const query = plugin?.cursor ? `category:purchases after:${plugin.cursor}` : "category:purchases newer_than:120d";
  const ids = await gmail.listMessages(token, query, 80);
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

  // Matching context: spending transactions (for orders) + credits (for refunds).
  const txns = await loadTxnLites();
  const creditTxns = await loadTxnLites(true);
  const taken = new Set((await db.emailOrder.findMany({ where: { transactionId: { not: null } }, select: { transactionId: true } })).map((e) => e.transactionId!).filter(Boolean));

  // Dedupe repeat emails for one purchase/refund (confirmation + dispatch/receipt).
  // Key on order number when present, else merchant+total+day (+ refund flag).
  const orderSig = (token: string | null, total: number, orderNo: string | null, date: Date | null, refund: boolean) =>
    `${refund ? "r" : "o"}|${orderNo ? `${token}|${total}|${orderNo.toLowerCase().replace(/\s+/g, "")}` : `${token}|${total}|${date ? date.toISOString().slice(0, 10) : ""}`}`;
  const existingSigs = await db.emailOrder.findMany({ where: { total: { not: null } }, select: { merchantToken: true, total: true, orderNumber: true, emailDate: true, isRefund: true } });
  const seenSigs = new Set(existingSigs.map((o) => orderSig(o.merchantToken, Number(o.total!.toString()), o.orderNumber, o.emailDate, o.isRefund)));

  audit({ kind: "log", text: "● Extracting order details (Gemini)", tone: "bold" });
  let parsed = 0, matched = 0, dupes = 0, refunds = 0;
  const SIZE = 20;
  for (let i = 0; i < emails.length; i += SIZE) {
    const chunk = emails.slice(i, i + SIZE);
    const extracted = await extractBatch(chunk, i / SIZE + 1, audit);
    const byRef = new Map(extracted.map((e) => [e.ref, e]));
    for (let j = 0; j < chunk.length; j++) {
      const email = chunk[j];
      const o = byRef.get(`t${j}`);
      const emailDate = email.date ? new Date(email.date) : null;
      const hasTotal = Boolean(o && o.total != null && o.merchant);
      const isRefund = hasTotal && Boolean(o!.isRefund);
      const parsedOk = hasTotal && (o!.isOrder || isRefund);
      const oToken = parsedOk ? merchantToken(o!.merchant) : null;
      // A repeat email for something we already captured: record the message (so
      // it isn't re-fetched) but null its total so it's hidden + not matched.
      let dup = false;
      if (parsedOk) {
        const sig = orderSig(oToken, o!.total!, o!.orderNumber, emailDate, isRefund);
        if (seenSigs.has(sig)) dup = true; else seenSigs.add(sig);
      }
      const record = parsedOk && !dup;
      let txn: TxnLite | null = null;
      if (record && isRefund) {
        txn = matchTransaction({ total: o!.total!, date: email.date, token: oToken }, creditTxns, taken);
        refunds++;
        if (txn) { taken.add(txn.id); matched++; await maybeSetNote(txn.id, refundNote(o!.merchant)); }
      } else if (record) {
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
          total: record ? o!.total : null,
          currency: o?.currency ?? null,
          orderNumber: o?.orderNumber ?? null,
          items: record && !isRefund ? (o!.items as unknown as object) : undefined,
          tags: record ? (o!.tags as unknown as object) : undefined,
          isRefund,
          subject: email.subject || null,
          transactionId: txn?.id ?? null,
          matched: Boolean(txn),
        },
      });
      if (record) {
        const label = `${isRefund ? "↩ " : ""}${o!.merchant ?? "?"} · ${o!.currency ?? ""}${o!.total}`;
        if (txn) audit({ kind: "assign", id: email.id, name: label, to: `txn ${txn.date ?? ""}`, via: "llm" });
        else audit({ kind: "log", text: `  ai   ${label.length > 34 ? `${label.slice(0, 33)}…` : label.padEnd(34)} → no transaction match`, tone: "yellow" });
      } else if (dup) {
        audit({ kind: "log", text: `  ·    ${(o!.merchant ?? "").slice(0, 33).padEnd(34)} → duplicate, skipped`, tone: "dim" });
      }
    }
  }

  // Re-match previously-parsed orders that never linked — the transaction may
  // have landed since, or matching has tightened. Now refund-aware and shared
  // with the post-bank-sync hook (see rematchOpenOrders).
  const { matched: rematched } = await rematchOpenOrders(audit);

  const totalMatched = matched + rematched;
  // Advance the cursor to the newest email seen (never backwards).
  const maxEpoch = emails.reduce((mx, e) => {
    const t = e.date ? Math.floor(new Date(e.date).getTime() / 1000) : 0;
    return t > mx ? t : mx;
  }, plugin?.cursor ? Number(plugin.cursor) : 0);
  await db.plugin.update({ where: { id: "gmail" }, data: { lastSyncAt: new Date(), ...(maxEpoch ? { cursor: String(maxEpoch) } : {}) } });
  audit({ kind: "log", text: "● Summary", tone: "bold" });
  audit({ kind: "log", text: `  ${parsed} new orders · ${refunds} refunds · ${totalMatched} matched${rematched ? ` (${rematched} re-matched)` : ""}${dupes ? ` · ${dupes} duplicates skipped` : ""}`, tone: totalMatched ? "green" : "dim" });
  audit({ kind: "log", text: "Sync complete.", tone: "green" });
  return { scanned: ids.length, parsed, matched: totalMatched };
}
