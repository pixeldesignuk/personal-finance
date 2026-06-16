// Average monthly net flow (signed credits − debits, transfers included) over the
// `months` complete calendar months immediately before the current month. Pure.
export function avgMonthlyNetFlow(
  txns: { amount: number; month: string | null }[],
  today: Date,
  months = 3,
): number {
  const target = new Set<string>();
  for (let i = 1; i <= months; i++) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    target.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  let sum = 0;
  for (const t of txns) if (t.month && target.has(t.month)) sum += t.amount;
  return Math.round((sum / months) * 100) / 100;
}
