import { SPENDING_CATEGORIES } from "./categorize.ts";

export interface BudgetTx {
  amount: number;
  category: string; // effective category
  bookingDate: string | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function monthOf(date: string | null): string | null {
  return date ? date.slice(0, 7) : null;
}

export function personalSpendByCategory(txns: BudgetTx[], month: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of txns) {
    if (t.category === "transfer" || t.category === "income") continue;
    if (t.amount >= 0) continue;
    if (monthOf(t.bookingDate) !== month) continue;
    out[t.category] = round2((out[t.category] ?? 0) + -t.amount);
  }
  return out;
}

export interface BudgetRow {
  category: string;
  monthlyLimit: number;
  spent: number;
  remaining: number;
  percent: number;
}

export function buildBudgetRows(
  limits: Record<string, number>,
  spent: Record<string, number>,
): BudgetRow[] {
  return SPENDING_CATEGORIES.map((category) => {
    const monthlyLimit = limits[category] ?? 0;
    const s = round2(spent[category] ?? 0);
    return {
      category,
      monthlyLimit,
      spent: s,
      remaining: round2(monthlyLimit - s),
      percent: monthlyLimit > 0 ? Math.round((s / monthlyLimit) * 100) : 0,
    };
  });
}

export function cashFlow(txns: BudgetTx[], month: string): { income: number; expenses: number; net: number; savingsRate: number } {
  let income = 0;
  let expenses = 0;
  for (const t of txns) {
    if (t.category === "transfer") continue;
    if (monthOf(t.bookingDate) !== month) continue;
    if (t.amount > 0) income += t.amount;
    else expenses += -t.amount;
  }
  const net = round2(income - expenses);
  return {
    income: round2(income),
    expenses: round2(expenses),
    net,
    savingsRate: income > 0 ? Math.round((net / income) * 100) : 0,
  };
}
