// Pure merchant/recurring analytics — unit-tested, no I/O.

export type RecurType = "fixed" | "variable" | "oneoff";

export function median(nums: number[]): number {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// Coefficient of variation (stddev / mean) — low means consistent amounts.
export function coefficientOfVariation(amounts: number[]): number {
  if (amounts.length < 2) return 0;
  const mean = amounts.reduce((a, b) => a + b, 0) / amounts.length;
  if (mean === 0) return 0;
  const variance = amounts.reduce((a, b) => a + (b - mean) ** 2, 0) / amounts.length;
  return Math.sqrt(variance) / Math.abs(mean);
}

// Classify a merchant from its spend pattern:
//  - fixed: shows up ~once a month in ≥3 months with a consistent amount
//    (rent, subscriptions, bills),
//  - variable: recurs but the amount/frequency varies (groceries),
//  - oneoff: too infrequent to be a regular payment.
export function classifyMerchant(monthsActive: number, perMonthCount: number, amountCv: number): RecurType {
  if (monthsActive < 3) return "oneoff";
  if (perMonthCount <= 1.6 && amountCv < 0.15) return "fixed";
  return "variable";
}
