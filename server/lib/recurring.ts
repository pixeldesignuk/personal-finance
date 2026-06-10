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
    else if (cadence === "monthly") d.setMonth(d.getMonth() + 1);
    else break; // irregular / one-off: only the single nextDue
  }
  return out;
}

// True if `date` falls within the calendar month of `ref`.
export function sameMonth(date: Date, ref: Date): boolean {
  return date.getFullYear() === ref.getFullYear() && date.getMonth() === ref.getMonth();
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
