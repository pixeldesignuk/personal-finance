import type { CategoryTotal, MerchantTotal, MonthlyTotal } from "../../shared/types.ts";

export interface AggTx {
  amount: number;
  category: string;
  merchant: string | null;
  bookingDate: string | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function spendingByCategory(txns: AggTx[]): CategoryTotal[] {
  const map = new Map<string, number>();
  for (const t of txns) {
    if (t.amount >= 0) continue;
    map.set(t.category, (map.get(t.category) ?? 0) + -t.amount);
  }
  return [...map.entries()]
    .map(([category, total]) => ({ category, total: round2(total) }))
    .sort((a, b) => b.total - a.total);
}

export function monthlyTotals(txns: AggTx[]): MonthlyTotal[] {
  const map = new Map<string, { spent: number; received: number }>();
  for (const t of txns) {
    if (!t.bookingDate) continue;
    const month = t.bookingDate.slice(0, 7);
    const e = map.get(month) ?? { spent: 0, received: 0 };
    if (t.amount < 0) e.spent += -t.amount;
    else e.received += t.amount;
    map.set(month, e);
  }
  return [...map.entries()]
    .map(([month, v]) => ({ month, spent: round2(v.spent), received: round2(v.received) }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

export function topMerchants(txns: AggTx[], n: number): MerchantTotal[] {
  const map = new Map<string, { total: number; count: number }>();
  for (const t of txns) {
    if (t.amount >= 0 || !t.merchant) continue;
    const e = map.get(t.merchant) ?? { total: 0, count: 0 };
    e.total += -t.amount;
    e.count += 1;
    map.set(t.merchant, e);
  }
  return [...map.entries()]
    .map(([merchant, v]) => ({ merchant, total: round2(v.total), count: v.count }))
    .sort((a, b) => b.total - a.total)
    .slice(0, n);
}
