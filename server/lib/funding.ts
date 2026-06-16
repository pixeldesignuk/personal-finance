// Pure funding-gauge math for account chips — no I/O, unit-tested.
import { incomeOccurrences, occurrencesWithin } from "./recurring.ts";
import type { AccountFundingDTO } from "../../shared/types.ts";

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const r2 = (n: number) => Math.round(n * 100) / 100;

export interface IncomeReceived {
  byAccount: Map<string, { total: number; max: number }>;
  totalAll: number;
  maxAll: number;
}

// Tally this-month income credits into per-account {total, max} plus all-account
// totals. `max` (the single largest credit) lets callers tell a salary-sized
// payment from a small one-off. Mirrors the inline tally /upcoming used to do.
export function tallyIncomeByAccount(credits: { amount: number; accountId: string }[]): IncomeReceived {
  const byAccount = new Map<string, { total: number; max: number }>();
  let totalAll = 0;
  let maxAll = 0;
  for (const c of credits) {
    const e = byAccount.get(c.accountId) ?? { total: 0, max: 0 };
    e.total += c.amount;
    e.max = Math.max(e.max, c.amount);
    byAccount.set(c.accountId, e);
    totalAll += c.amount;
    maxAll = Math.max(maxAll, c.amount);
  }
  return { byAccount, totalAll, maxAll };
}

// A recurring payment has "arrived" if a salary-sized credit landed (>=60% of the
// typical amount) OR the source's month income already covers it. Matches the
// rule used in /upcoming so projection and funding agree.
const hasArrived = (amount: number, got: { total: number; max: number }) =>
  got.max >= 0.6 * amount || got.total >= amount - 0.005;

export interface FundingSchedule {
  accountId: string | null;
  direction: "in" | "out";
  amount: number;
  cadence: string;
  dayOfMonth: number | null;
  nextDue: Date | null;
}
export interface FundingAccount {
  id: string;
  currentBalance: number;
}

// One funding gauge per account. Window = today..nextPayday (earliest upcoming
// income occurrence across all income schedules; 30-day fallback if none).
export function computeFunding(
  accounts: FundingAccount[],
  schedules: FundingSchedule[],
  income: IncomeReceived,
  today: Date,
): AccountFundingDTO[] {
  const inScheds = schedules.filter((s) => s.direction === "in");
  const outScheds = schedules.filter((s) => s.direction === "out" && s.nextDue);

  // Resolve "has this paycheck arrived?" once per income schedule (reused for the
  // window and for each account's incoming amount).
  const inInfo = inScheds.map((s) => {
    const got = s.accountId
      ? income.byAccount.get(s.accountId) ?? { total: 0, max: 0 }
      : { total: income.totalAll, max: income.maxAll };
    return { s, arrived: hasArrived(s.amount, got) };
  });

  // The window runs to the next *upcoming* payday. incomeOccurrences surfaces an
  // overdue payday as "due now" (today); for a forward-looking window that would
  // collapse to zero, so take the earliest occurrence strictly after today — the
  // next real payday boundary you're funding toward. NOTE: once this month's
  // salary has `arrived`, that occurrence is skipped and nextPayday jumps to next
  // month — so on payday the window widens (~12d → ~42d) and committed picks up a
  // second month of bills. That's intentional ("covered until you're next paid").
  const todayStart = startOfDay(today);
  let nextPayday: Date | null = null;
  for (const { s, arrived } of inInfo) {
    const occ = incomeOccurrences(s.dayOfMonth ?? 28, arrived, today, 120).find((d) => d > todayStart);
    if (occ && (!nextPayday || occ < nextPayday)) nextPayday = occ;
  }
  const windowDays = nextPayday
    ? Math.max(0, Math.round((startOfDay(nextPayday).getTime() - startOfDay(today).getTime()) / 86_400_000))
    : 30;

  return accounts.map((a) => {
    let committed = 0;
    for (const s of outScheds) {
      if (s.accountId !== a.id) continue;
      committed += occurrencesWithin(s.nextDue as Date, s.cadence, today, windowDays).length * s.amount;
    }
    committed = r2(committed);
    const balance = r2(a.currentBalance);

    const myIn = inInfo.filter((i) => i.s.accountId === a.id);
    const isIncomeAccount = myIn.length > 0;
    const incomeIncoming = r2(myIn.reduce((sum, i) => sum + (i.arrived ? 0 : i.s.amount), 0));

    const solidFraction = committed > 0 ? clamp01(balance / committed) : 0;
    const shortfall = Math.max(0, committed - balance);
    const dashedCovers = Math.min(incomeIncoming, shortfall);
    const dashedFraction = committed > 0 ? clamp01(dashedCovers / committed) : 0;

    let state: AccountFundingDTO["state"];
    if (committed === 0) state = "none";
    else if (balance >= committed) state = "funded";
    else if (isIncomeAccount && incomeIncoming > 0) state = solidFraction + dashedFraction >= 1 - 1e-9 ? "rescued" : "short";
    else if (isIncomeAccount) state = "short";
    else state = balance > 0 ? "partial" : "short";

    return { accountId: a.id, committed, balance, solidFraction, dashedFraction, incomeIncoming, isIncomeAccount, state, windowDays };
  });
}
