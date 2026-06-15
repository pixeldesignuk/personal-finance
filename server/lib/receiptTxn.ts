import { randomUUID } from "node:crypto";
import { db } from "./db.ts";
import { getOrCreateCashAccount } from "../telegram/cashAccount.ts";
import { applyRules, type Rule } from "./rules.ts";

interface OrderLike {
  id: string;
  merchantName: string | null;
  total: number | { toString(): string } | null;
  currency: string | null;
  emailDate: Date | null;
  items: unknown;
  summary?: string | null;
  categoryKey?: string | null;
}

// Create a provisional cash transaction for a receipt with no bank charge yet,
// and link the order to it. The raw.telegramReceipt marker lets a later bank
// sync reconcile it (move to the real charge, delete the provisional).
export async function createReceiptTransaction(o: OrderLike): Promise<string> {
  const accountId = await getOrCreateCashAccount();
  const rules = (await db.rule.findMany()).map((r) => ({ matchText: r.matchText, categoryKey: r.categoryKey, personKey: r.personKey, priority: r.priority }) as Rule);
  const ruled = applyRules(o.merchantName ?? "", rules);
  // Short AI summary as the note (plain text, no item list / emojis).
  const note = (o.summary?.trim() || o.merchantName || null)?.slice(0, 140) ?? null;
  const txnId = `receipt-${randomUUID()}`;
  await db.transaction.create({
    data: {
      id: txnId, accountId,
      bookingDate: o.emailDate ? o.emailDate.toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
      amount: `-${Number(o.total!.toString())}`, currency: o.currency ?? "GBP", merchantName: o.merchantName,
      category: ruled.categoryKey ?? o.categoryKey ?? "uncategorised", personKey: ruled.personKey ?? null,
      note, status: "booked", raw: { telegramReceipt: true, emailOrderId: o.id },
    },
  });
  await db.emailOrder.update({ where: { id: o.id }, data: { transactionId: txnId, matched: true } });
  return txnId;
}

// Ensure every Telegram receipt without a transaction has a provisional cash one
// (backfills receipts captured before this behaviour). Idempotent.
export async function ensureReceiptTransactions(): Promise<{ created: number }> {
  const orders = await db.emailOrder.findMany({ where: { source: "telegram", transactionId: null, total: { not: null } } });
  for (const o of orders) await createReceiptTransaction(o);
  return { created: orders.length };
}
