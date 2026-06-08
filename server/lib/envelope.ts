export interface EnvCategory {
  key: string;
  monthlyAmount: number;
  goal: number | null;
}
export interface EnvTx {
  amount: number;
  category: string; // effective category, personal-only (filtered by caller)
  bookingDate: string | null;
}
export interface EnvTransfer {
  fromKey: string;
  toKey: string;
  amount: number; // month already filtered (<= asOf) by caller
}
export interface EnvelopeRow {
  key: string;
  allocated: number;
  spent: number;
  available: number;
  goal: number | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function monthsBetween(start: string, end: string): string[] {
  if (start > end) return [];
  const out: string[] = [];
  let [y, m] = start.split("-").map(Number);
  const [ey, em] = end.split("-").map(Number);
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

function monthOf(date: string | null): string | null {
  return date ? date.slice(0, 7) : null;
}

export function computeEnvelopes(
  categories: EnvCategory[],
  allocationOverrides: Record<string, number>, // key `${key}|${YYYY-MM}`
  transfers: EnvTransfer[],
  txns: EnvTx[],
  startMonth: string,
  asOfMonth: string,
): EnvelopeRow[] {
  const months = monthsBetween(startMonth, asOfMonth);
  return categories.map((cat) => {
    let available = 0;
    let allocatedThis = 0;
    let spentThis = 0;
    for (const m of months) {
      const allocated = allocationOverrides[`${cat.key}|${m}`] ?? cat.monthlyAmount;
      let spent = 0;
      for (const t of txns) {
        if (t.amount >= 0) continue;
        if (t.category !== cat.key) continue;
        if (monthOf(t.bookingDate) !== m) continue;
        spent += -t.amount;
      }
      available += allocated - spent;
      if (m === asOfMonth) { allocatedThis = allocated; spentThis = spent; }
    }
    for (const tr of transfers) {
      if (tr.toKey === cat.key) available += tr.amount;
      if (tr.fromKey === cat.key) available -= tr.amount;
    }
    return {
      key: cat.key,
      allocated: round2(allocatedThis),
      spent: round2(spentThis),
      available: round2(available),
      goal: cat.goal,
    };
  });
}
