import { round2, monthOf } from "./budget.ts";

export interface ReportTxn {
  amount: number;
  category: string; // effective category key
  personKey: string | null;
  bookingDate: string | null;
}

export interface MatrixRow {
  categoryKey: string;
  total: number;
  byPerson: Record<string, number>; // person key -> spend; null person bucketed as "none"
}

export interface SpendingMatrix {
  rows: MatrixRow[];
  personTotals: Record<string, number>;
  grandTotal: number;
}

const round = (m: Record<string, number>) =>
  Object.fromEntries(Object.entries(m).map(([k, v]) => [k, round2(v)]));

// Person × category spend breakdown (debits only; income/transfer excluded).
// `month` (YYYY-MM) filters; omit for all-time. Null person bucketed as "none".
export function spendingMatrix(txns: ReportTxn[], month?: string): SpendingMatrix {
  const byCat = new Map<string, { total: number; byPerson: Record<string, number> }>();
  const personTotals: Record<string, number> = {};
  let grand = 0;
  for (const t of txns) {
    if (t.amount >= 0) continue;
    if (t.category === "transfer" || t.category === "income") continue;
    if (month && monthOf(t.bookingDate) !== month) continue;
    const amt = -t.amount;
    const pk = t.personKey ?? "none";
    const c = byCat.get(t.category) ?? { total: 0, byPerson: {} };
    c.total += amt;
    c.byPerson[pk] = (c.byPerson[pk] ?? 0) + amt;
    byCat.set(t.category, c);
    personTotals[pk] = (personTotals[pk] ?? 0) + amt;
    grand += amt;
  }
  const rows: MatrixRow[] = [...byCat.entries()]
    .map(([categoryKey, v]) => ({ categoryKey, total: round2(v.total), byPerson: round(v.byPerson) }))
    .sort((a, b) => b.total - a.total);
  return { rows, personTotals: round(personTotals), grandTotal: round2(grand) };
}
