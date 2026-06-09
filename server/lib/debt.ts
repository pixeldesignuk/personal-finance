// Pure debt analytics — unit-tested, no I/O.

// Average monthly repayment across the distinct calendar months that had
// payments (so a lumpy history still gives a sensible "per month" pace).
export function monthlyAverage(payments: { month: string; amount: number }[]): number {
  if (!payments.length) return 0;
  const byMonth = new Map<string, number>();
  for (const p of payments) byMonth.set(p.month, (byMonth.get(p.month) ?? 0) + p.amount);
  const total = [...byMonth.values()].reduce((s, v) => s + v, 0);
  return total / byMonth.size;
}

// Months to clear `balance` paying `monthly`, optionally with annual interest
// (APR %). Returns null if it never pays off (payment ≤ monthly interest) or
// there's no payment pace. Family/friends debts pass rate 0/undefined → simple
// division.
export function projectPayoff(balance: number, monthly: number, annualRatePct?: number | null): number | null {
  if (balance <= 0) return 0;
  if (monthly <= 0) return null;
  const rate = annualRatePct ?? 0;
  if (rate <= 0) return Math.ceil(balance / monthly);
  const i = rate / 100 / 12;
  if (monthly <= balance * i) return null; // interest outpaces payment
  return Math.ceil(-Math.log(1 - (i * balance) / monthly) / Math.log(1 + i));
}
