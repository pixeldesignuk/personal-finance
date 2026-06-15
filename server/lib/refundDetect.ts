import { db } from "./db.ts";
import { effectiveCategory } from "./effectiveCategory.ts";
import { rawMerchantName } from "../../shared/merchantName.ts";
import { isRefundNote } from "../../shared/refund.ts";

// A refund is money returned by a merchant you also SPEND at — distinct from
// income (salary, interest) which comes from sources you don't buy from. We mark
// refunds with a "refund — …" note (the same marker Gmail order-matching uses) so
// they're excluded from every review/reconcile flow and counted on the budget's
// separate Refunds line — never as spend or income.
export { isRefundNote };

// Brand key for matching a credit back to where it was spent: the first
// alphabetic word (≥4 chars) of the merchant name, lowercased. "AMAZON* M312X…"
// and "AMAZON CO UK RETAIL" both → "amazon". Short/numeric tokens are ignored to
// avoid spurious matches.
export function brandKey(name: string | null): string | null {
  if (!name) return null;
  const first = name.toLowerCase().replace(/[^a-z ]+/g, " ").replace(/\s+/g, " ").trim().split(" ")[0];
  return first && first.length >= 4 ? first : null;
}

interface RefundCandidate {
  amount: number | string;
  note?: string | null;
  category?: string;
  categoryOverride?: string | null;
  merchantName?: string | null;
  creditorName?: string | null;
  debtorName?: string | null;
  remittanceInfo?: string | null;
}

// Finance lines that are never discretionary spend: a charge (negative) is a
// Fee; a credit (positive) is a refund of that fee. Keeps interest out of review.
export const FINANCE_CHARGE_RE = /\b(interest|finance charge|late (payment|fee)|over[- ]?limit)\b/i;
export function financeCharge(t: RefundCandidate): "fee" | "refund" | null {
  const text = `${rawMerchantName(t) ?? ""} ${t.remittanceInfo ?? ""}`;
  if (!FINANCE_CHARGE_RE.test(text)) return null;
  return Number(t.amount) > 0 ? "refund" : "fee";
}

// Decide whether a positive transaction is a refund, given the set of brands you
// spend at and whether it was matched to a refund email. Income-categorised
// credits are only reclassified by a definitive email match — never by the
// looser brand heuristic (which could misread salary/transfers from a brand you
// also buy from).
export function looksLikeRefund(t: RefundCandidate, spendBrands: Set<string>, emailMatched: boolean): boolean {
  if (Number(t.amount) <= 0) return false;
  if (isRefundNote(t.note)) return false; // already marked
  if (emailMatched) return true;
  if (effectiveCategory({ category: t.category ?? "uncategorised", categoryOverride: t.categoryOverride }) === "income") return false;
  const k = brandKey(rawMerchantName(t));
  return Boolean(k && spendBrands.has(k));
}

// Brands you spend at — from every debit (negative) transaction. Pass extra rows
// (e.g. a sync batch not yet persisted) to include them too.
export async function spendBrandSet(extra: RefundCandidate[] = []): Promise<Set<string>> {
  const debits = await db.transaction.findMany({ where: { amount: { lt: 0 } }, select: { merchantName: true, creditorName: true, debtorName: true, remittanceInfo: true } });
  const set = new Set<string>();
  for (const t of [...debits, ...extra.filter((e) => Number(e.amount) < 0)]) {
    const k = brandKey(rawMerchantName(t));
    if (k) set.add(k);
  }
  return set;
}

// Scan all transactions and mark newly-detected refunds. Idempotent — skips ones
// already noted. Returns the number newly marked.
export async function backfillRefunds(): Promise<number> {
  const txns = await db.transaction.findMany({
    select: { id: true, amount: true, note: true, category: true, categoryOverride: true, merchantName: true, creditorName: true, debtorName: true, remittanceInfo: true },
  });
  const spendBrands = await spendBrandSet();
  const er = await db.emailOrder.findMany({ where: { isRefund: true, transactionId: { not: null } }, select: { transactionId: true } });
  const emailRefund = new Set(er.map((o) => o.transactionId!));

  let marked = 0;
  for (const t of txns) {
    const cand = { ...t, amount: Number(t.amount) };
    const name = rawMerchantName(t) ?? "merchant";
    // Interest & finance charges first: a fee (debit) → Fees; a credit → refund.
    const fin = financeCharge(cand);
    if (fin === "fee") {
      if (effectiveCategory(cand) === "uncategorised") { await db.transaction.update({ where: { id: t.id }, data: { category: "fees" } }); marked++; }
      continue;
    }
    if (fin === "refund") {
      if (!isRefundNote(t.note)) { await db.transaction.update({ where: { id: t.id }, data: { note: `refund — ${name}`.slice(0, 140) } }); marked++; }
      continue;
    }
    if (!looksLikeRefund(cand, spendBrands, emailRefund.has(t.id))) continue;
    await db.transaction.update({ where: { id: t.id }, data: { note: `refund — ${name}`.slice(0, 140) } });
    marked++;
  }
  return marked;
}
