import { round2 } from "./budget.ts";

export interface BudgetCategory {
  id: number;
  key: string;
  name: string;
  group: string | null;
  monthlyAmount: number;
}

export interface BudgetRow {
  id: number;
  key: string;
  name: string;
  group: string | null;
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
      id: c.id,
      key: c.key,
      name: c.name,
      group: c.group,
      budgeted,
      spent,
      left: round2(budgeted - spent),
      percent: budgeted > 0 ? Math.round((spent / budgeted) * 100) : 0,
    };
  });
}
