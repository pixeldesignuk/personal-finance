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

// Derive a human payer/employer name shared across a set of statement
// references — e.g. ["PIXEL DESIGN HOUSEMAY WAGE", "PIXEL DESIGN HOUSEMARCH
// WAGE", "PIXEL DESIGN HOUSEDIRECTORS LOAN"] -> "Pixel Design". Used to name an
// income stream after its source rather than the bank account. Returns null when
// the references share no meaningful leading name (e.g. noisy transfer refs with
// account numbers), so the caller can fall back to the account name.
export function derivePayerName(labels: string[]): string | null {
  const norm = labels.map((l) => l.replace(/\s+/g, " ").trim()).filter((l) => l.length > 1);
  if (norm.length < 2) return null;
  // Largest cluster of references sharing the same (non-numeric) first word.
  const byFirst = new Map<string, string[]>();
  for (const l of norm) {
    const w = l.split(" ")[0].toLowerCase();
    if (/^\d+$/.test(w)) continue;
    const arr = byFirst.get(w) ?? [];
    arr.push(l);
    byFirst.set(w, arr);
  }
  const cluster = [...byFirst.values()].sort((a, b) => b.length - a.length)[0];
  if (!cluster || cluster.length < 2 || cluster.length < Math.ceil(norm.length / 2)) return null;
  // Longest common character prefix across the cluster (case-insensitive).
  let prefix = cluster[0];
  for (const s of cluster.slice(1)) {
    let i = 0;
    while (i < prefix.length && i < s.length && prefix[i].toLowerCase() === s[i].toLowerCase()) i++;
    prefix = prefix.slice(0, i);
  }
  const end = prefix.replace(/\s+$/, "").length;
  const words = prefix.trim().split(" ").filter(Boolean);
  if (!words.length) return null;
  // If the prefix was cut mid-word (the originals continue without a space),
  // drop that trailing partial word.
  const lastComplete = cluster.every((s) => s.length === end || s[end] === " ");
  const finalWords = lastComplete ? words : words.slice(0, -1);
  const name = finalWords.join(" ");
  // Reject noise: too short/long, embedded account numbers, or generic
  // transfer/reference prefixes that aren't a real name.
  if (name.length < 3 || name.length > 24) return null;
  if (/\d{4,}/.test(name)) return null;
  if (/^(from|to|via|ref|fp|bgc|faster|payment|transfer|bank|credit)\b/i.test(name)) return null;
  return /[a-z]/.test(name) ? name : name.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
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
