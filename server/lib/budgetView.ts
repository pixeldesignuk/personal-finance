import { round2 } from "./budget.ts";

export interface BudgetCategory {
  key: string;
  name: string;
  monthlyAmount: number;
}

export interface BudgetRow {
  key: string;
  name: string;
  budgeted: number;
  spent: number;
  left: number;
  percent: number;
}

// Flat monthly budget-vs-actual: budgeted is the fixed monthly amount, spent is
// this month's spend in that category (debits, computed by the caller). No
// rollover, goals, or transfers.
export function buildBudgetRows(categories: BudgetCategory[], spentByKey: Record<string, number>): BudgetRow[] {
  return categories.map((c) => {
    const budgeted = round2(c.monthlyAmount);
    const spent = round2(spentByKey[c.key] ?? 0);
    return {
      key: c.key,
      name: c.name,
      budgeted,
      spent,
      left: round2(budgeted - spent),
      percent: budgeted > 0 ? Math.round((spent / budgeted) * 100) : 0,
    };
  });
}
