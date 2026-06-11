import { SPENDING_CATEGORIES } from "./categorize.ts";

export interface BudgetTx {
  amount: number;
  category: string; // effective category
  bookingDate: string | null;
}

export const round2 = (n: number) => Math.round(n * 100) / 100;

export function monthOf(date: string | null): string | null {
  return date ? date.slice(0, 7) : null;
}

// Current YYYY-MM in UK local time, so month-boundary reporting matches the
// user's timezone regardless of the server's (Railway runs UTC).
export function currentMonth(now: Date = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: "Europe/London" }).slice(0, 7);
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

function median(nums: number[]): number {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// Suggest a monthly budget per category from spending history. For each expense
// category we take the MEDIAN of its monthly spend across the complete months in
// the data (the current, partial month is excluded), which is robust to one-off
// spikes. A category that only spends occasionally (median 0 but some spend)
// gets its average instead, so it isn't budgeted at zero. Amounts round to the
// nearest pound. Returns category key -> suggested monthly amount.
export function suggestBudgets(txns: BudgetTx[], currentMonthStr: string): Record<string, number> {
  const byCatMonth = new Map<string, Map<string, number>>();
  const months = new Set<string>();
  for (const t of txns) {
    if (t.category === "transfer" || t.category === "income") continue;
    if (t.amount >= 0) continue;
    const m = monthOf(t.bookingDate);
    if (!m || m === currentMonthStr) continue;
    months.add(m);
    const cm = byCatMonth.get(t.category) ?? new Map<string, number>();
    cm.set(m, round2((cm.get(m) ?? 0) + -t.amount));
    byCatMonth.set(t.category, cm);
  }
  const monthList = [...months];
  const out: Record<string, number> = {};
  if (!monthList.length) return out;
  for (const [cat, cm] of byCatMonth) {
    const sums = monthList.map((m) => cm.get(m) ?? 0);
    let v = median(sums);
    const total = sums.reduce((a, b) => a + b, 0);
    if (v === 0 && total > 0) v = total / monthList.length;
    out[cat] = Math.round(v);
  }
  return out;
}

// Number of complete (non-current) months of expense history available.
export function completeSpendMonths(txns: BudgetTx[], currentMonthStr: string): number {
  const months = new Set<string>();
  for (const t of txns) {
    if (t.amount >= 0 || t.category === "transfer" || t.category === "income") continue;
    const m = monthOf(t.bookingDate);
    if (m && m !== currentMonthStr) months.add(m);
  }
  return months.size;
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
