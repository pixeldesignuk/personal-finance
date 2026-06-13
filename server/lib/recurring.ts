// Pure date inference for recurring schedules — no I/O, unit-tested.

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const daysInMonth = (year: number, monthIdx: number) => new Date(year, monthIdx + 1, 0).getDate();
const onDay = (year: number, monthIdx: number, day: number) =>
  new Date(year, monthIdx, Math.min(Math.max(1, day), daysInMonth(year, monthIdx)));

// The next occurrence on `dayOfMonth` that is today or later. If this month's day
// has already passed, roll to next month. Day is clamped to the month length
// (e.g. a "31st" bill falls on the 28th/30th in shorter months).
export function inferNextDue(dayOfMonth: number, today: Date): Date {
  const t = startOfDay(today);
  let cand = onDay(t.getFullYear(), t.getMonth(), dayOfMonth);
  if (cand < t) {
    const m = t.getMonth() + 1;
    cand = onDay(t.getFullYear() + Math.floor(m / 12), m % 12, dayOfMonth);
  }
  return cand;
}

// All occurrences of a schedule within [from, from + days], starting at nextDue.
export function occurrencesWithin(nextDue: Date, cadence: string, from: Date, days: number): Date[] {
  const start = startOfDay(from);
  const end = new Date(start);
  end.setDate(end.getDate() + days);
  const out: Date[] = [];
  const d = new Date(nextDue);
  for (let guard = 0; d <= end && guard < 200; guard++) {
    if (d >= start) out.push(new Date(d));
    if (cadence === "weekly") d.setDate(d.getDate() + 7);
    else if (cadence === "yearly") d.setFullYear(d.getFullYear() + 1);
    else if (cadence === "quarterly") d.setMonth(d.getMonth() + 3);
    else if (cadence === "monthly") d.setMonth(d.getMonth() + 1);
    else break; // irregular / one-off: only the single nextDue
  }
  return out;
}

// How many months one cadence period spans (0 for sub-monthly cadences, which
// aren't "save up for it" bills).
export function periodMonths(cadence: string): number {
  return cadence === "yearly" ? 12 : cadence === "quarterly" ? 3 : cadence === "monthly" ? 1 : 0;
}

export interface BillTargetCalc {
  periodMonths: number;
  monthlyAmount: number;
  monthsElapsed: number;
  setAside: number;
  nextDue: string;
}

// Smooth a non-monthly bill into a monthly "set aside" target (sinking fund).
// Given the full per-occurrence amount, cadence and the bill's next due date,
// work out the monthly contribution (amount ÷ period), the next actual due date
// (rolled forward to today or later), how many months into the current cycle we
// are (the "X of N"), and how much should have been set aside by now. Returns
// null for monthly/weekly/irregular (nothing to spread).
export function billTarget(amount: number, cadence: string, nextDueISO: string, today: Date): BillTargetCalc | null {
  const period = periodMonths(cadence);
  if (period <= 1) return null;
  const t = startOfDay(today);
  const next = new Date(`${nextDueISO}T00:00:00`);
  for (let guard = 0; next < t && guard < 400; guard++) next.setMonth(next.getMonth() + period);
  const last = new Date(next);
  last.setMonth(last.getMonth() - period);
  const monthsElapsed = Math.max(0, Math.min(period, (t.getFullYear() - last.getFullYear()) * 12 + (t.getMonth() - last.getMonth())));
  const monthlyAmount = Math.round((amount / period) * 100) / 100;
  const setAside = Math.round(Math.min(amount, monthlyAmount * monthsElapsed) * 100) / 100;
  const iso = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-${String(next.getDate()).padStart(2, "0")}`;
  return { periodMonths: period, monthlyAmount, monthsElapsed, setAside, nextDue: iso };
}

// True if `date` falls within the calendar month of `ref`.
export function sameMonth(date: Date, ref: Date): boolean {
  return date.getFullYear() === ref.getFullYear() && date.getMonth() === ref.getMonth();
}

// Income (wages) is fuzzier than bills: the exact pay day drifts and the amount
// varies. So we project income from the *typical* pay day with a "have I been
// paid this month?" check rather than a rigid schedule:
//   - If salary hasn't landed this month, this month's pay is still expected —
//     and if its typical day has already slipped past, we surface it as due now
//     (covers a late/variable payday) rather than dropping it.
//   - If it HAS landed, skip to next month.
// `receivedThisMonth` should reflect a *salary-sized* credit, not any income, so
// a small early-month inflow doesn't suppress the real pay projection.
export function incomeOccurrences(dayOfMonth: number, receivedThisMonth: boolean, today: Date, days: number): Date[] {
  const start = startOfDay(today);
  const end = new Date(start); end.setDate(end.getDate() + days);
  const received = receivedThisMonth;
  const out: Date[] = [];
  if (!received) {
    let d = onDay(start.getFullYear(), start.getMonth(), dayOfMonth);
    if (d < start) d = start; // expected day passed but not yet received → due now
    if (d <= end) out.push(d);
  }
  let m = start.getMonth() + 1;
  for (let i = 0; i < 4; i++, m++) {
    const d = onDay(start.getFullYear() + Math.floor(m / 12), ((m % 12) + 12) % 12, dayOfMonth);
    if (d > end) break;
    if (d >= start) out.push(d);
  }
  const seen = new Set<string>();
  return out
    .filter((d) => { const k = d.toISOString().slice(0, 10); if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => a.getTime() - b.getTime());
}

// Inclusive count of calendar months from the earliest to the latest "YYYY-MM"
// in a set (e.g. {2026-03, 2026-05} spans 3 months: Mar, Apr, May).
export function monthSpan(months: string[]): number {
  if (!months.length) return 1;
  const idx = months.map((m) => { const [y, mo] = m.split("-").map(Number); return y * 12 + (mo - 1); });
  return Math.max(...idx) - Math.min(...idx) + 1;
}

// Does a merchant's debits look like a genuine monthly *bill* rather than just
// frequent/occasional spend at a merchant you happen to use across months?
// Frequency alone is not enough — buying from Amazon or a takeaway once in each
// of three scattered months is NOT a bill, and a subscription you cancelled a
// year ago is no longer one. A bill is REGULAR and CURRENT.
//
// Judged over a trailing `windowMonths` window (default 6) so a bill that ran,
// paused, and *resumed* is assessed on its present regularity — not penalised for
// ancient history (e.g. a utility that lapsed in 2024 and restarted this spring).
// Within that window, all four must hold:
//   1. >= 3 active months    — enough recent history to call it recurring
//   2. perMonth <= 1.5        — ~once a month (keeps groceries / heavy merchants out)
//   3. coverage >= 0.7        — present in most months of its recent span (regular,
//                               not sporadic: 3 consecutive = 1.0; every-other = ~0.5)
//   4. last charge <= 45 days — still live
// `dates` are the YYYY-MM-DD charge dates (duplicates fine). The user can force a
// merchant on via recurring=fixed (caller) or off via "not recurring".
export function isMonthlyBill(dates: string[], today: Date, windowMonths = 6): boolean {
  const startIdx = today.getFullYear() * 12 + today.getMonth() - (windowMonths - 1);
  const monthIdx = (ym: string) => { const [y, mo] = ym.split("-").map(Number); return y * 12 + (mo - 1); };
  const recent = dates.filter((d) => d && monthIdx(d.slice(0, 7)) >= startIdx);
  if (!recent.length) return false;
  const months = new Set(recent.map((d) => d.slice(0, 7)));
  const monthsActive = months.size;
  if (monthsActive < 3) return false;
  if (recent.length / monthsActive > 1.5) return false;
  if (monthsActive / monthSpan([...months]) < 0.7) return false;
  const last = recent.reduce((a, b) => (a > b ? a : b));
  const days = (startOfDay(today).getTime() - new Date(`${last}T00:00:00`).getTime()) / 86_400_000;
  return days <= 45;
}

// The most common day-of-month across a set of transaction dates (the typical
// charge day), or null if none.
export function typicalDayOfMonth(isoDates: (string | null)[]): number | null {
  const counts = new Map<number, number>();
  for (const iso of isoDates) {
    if (!iso) continue;
    const day = Number(iso.slice(8, 10));
    if (day >= 1 && day <= 31) counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  let best: number | null = null;
  let bestN = 0;
  for (const [day, n] of counts) if (n > bestN) { best = day; bestN = n; }
  return best;
}
