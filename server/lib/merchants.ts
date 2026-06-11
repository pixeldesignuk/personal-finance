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

export interface RecurAmount {
  amount: number;                  // the expected/current amount (positive)
  kind: "fixed" | "variable";      // is the amount stable or does it vary?
  prevAmount: number | null;       // prior amount, set only when it recently INCREASED
}

// Analyse a recurring bill's charge amounts (absolute values, OLDEST -> NEWEST)
// to decide its current expected amount, whether it's fixed or variable, and
// whether the price recently stepped UP (returning the previous level so the UI
// can flag the increase).
//
// "Fixed" means the most recent charges sit at one stable level (e.g. a £10.30
// phone bill that was £7.80 three months ago is still FIXED — the recent months
// are flat — and we flag the rise from £7.80). "Variable" means the amount keeps
// moving (e.g. a utility bill); we use the recent median and don't flag noise.
export function analyzeRecurringAmounts(amts: number[]): RecurAmount {
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const n = amts.length;
  if (!n) return { amount: 0, kind: "fixed", prevAmount: null };
  const last = amts[n - 1];
  // Two charges are "the same level" if within 2% (or 1p) of each other.
  const near = (a: number, b: number) => Math.abs(a - b) <= Math.max(0.02 * Math.max(a, b), 0.01);
  // Length of the stable run at the end (consecutive recent charges at one level).
  let runLen = 1;
  for (let i = n - 2; i >= 0; i--) {
    if (near(amts[i], last)) runLen++;
    else break;
  }
  const currentLevel = median(amts.slice(n - runLen));
  const priorLevel = runLen < n ? amts[n - runLen - 1] : null; // charge just before the current run
  // Fixed if the recent run is stable (>= 2 equal charges), or the whole series
  // is tight. Otherwise the amount genuinely varies month to month.
  const fixed = runLen >= 2 || coefficientOfVariation(amts) < 0.15;
  const kind: "fixed" | "variable" = fixed ? "fixed" : "variable";
  const amount = fixed ? currentLevel : median(amts.slice(-3));
  // Flag a recent INCREASE on a fixed bill: the current stable level stepped up
  // from the immediately-preceding level, recently (within the last ~3 cycles),
  // by a meaningful amount (> 5% and >= £1).
  let prevAmount: number | null = null;
  if (fixed && priorLevel != null && runLen <= 3 && currentLevel > priorLevel * 1.05 && currentLevel - priorLevel >= 1) {
    prevAmount = r2(priorLevel);
  }
  return { amount: r2(amount), kind, prevAmount };
}
