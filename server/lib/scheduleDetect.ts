import { db } from "./db.ts";
import { merchantToken } from "../categorise/helpers.ts";
import { effectiveCategory } from "./effectiveCategory.ts";
import { classifyMerchant, coefficientOfVariation, median } from "./merchants.ts";
import { inferNextDue, typicalDayOfMonth } from "./recurring.ts";

const tokenOf = (t: { merchantName: string | null; creditorName: string | null; debtorName: string | null; remittanceInfo: string | null }) =>
  merchantToken(t.merchantName ?? t.creditorName ?? t.debtorName ?? t.remittanceInfo ?? null);

interface Group { name: string | null; amounts: number[]; dates: string[]; months: Set<string>; accounts: Map<string, number>; last: string | null }

// Detect recurring bills (and income) from transaction patterns and upsert one
// RecurringSchedule per merchant. A merchant qualifies if it's a "fixed" pattern
// (≥3 months, ~once a month, consistent amount) or the user forced recurring=fixed;
// direction is by sign (out = bill, in = income). The user's confirmed/ignored
// status is preserved across re-detection; stale auto schedules are pruned.
export async function detectSchedules(today: Date = new Date()): Promise<{ detected: number }> {
  const txns = await db.transaction.findMany({
    select: { amount: true, bookingDate: true, merchantName: true, creditorName: true, debtorName: true, remittanceInfo: true, accountId: true, category: true, categoryOverride: true },
  });
  const overrides = new Map((await db.merchant.findMany()).map((m) => [m.token, m] as const));
  const named = new Map((await db.merchant.findMany({ where: { NOT: { name: null } } })).map((m) => [m.token, m.name] as const));

  const groups = new Map<string, Group>();
  for (const t of txns) {
    if (effectiveCategory(t) === "transfer") continue;
    const token = tokenOf(t);
    if (!token) continue;
    const g = groups.get(token) ?? { name: null, amounts: [], dates: [], months: new Set<string>(), accounts: new Map<string, number>(), last: null };
    g.amounts.push(Number(t.amount));
    if (t.bookingDate) { g.dates.push(t.bookingDate); g.months.add(t.bookingDate.slice(0, 7)); if (!g.last || t.bookingDate > g.last) g.last = t.bookingDate; }
    g.accounts.set(t.accountId, (g.accounts.get(t.accountId) ?? 0) + 1);
    if (!g.name) g.name = t.merchantName ?? t.creditorName ?? t.debtorName ?? null;
    groups.set(token, g);
  }

  const qualifying = new Set<string>();
  for (const [token, g] of groups) {
    const override = (overrides.get(token)?.recurring as string | undefined) ?? "auto";
    if (override === "ignore") continue;
    const monthsActive = g.months.size;
    const perMonth = g.amounts.length / Math.max(1, monthsActive);
    const cv = coefficientOfVariation(g.amounts.map(Math.abs));
    const med = median(g.amounts);
    const isFixed = override === "fixed" || (override === "auto" && classifyMerchant(monthsActive, perMonth, cv) === "fixed");
    // Per-merchant schedules are BILLS only. Recurring income (wages) has a
    // varying payroll reference, so it's handled by the income stream below
    // (keyed on the "income" category) rather than per-merchant grouping.
    if (!isFixed || med >= 0) continue;

    qualifying.add(token);
    const day = typicalDayOfMonth(g.dates) ?? 1;
    const topAccount = [...g.accounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    const existing = await db.recurringSchedule.findUnique({ where: { merchantToken: token } });
    const status = existing && (existing.status === "confirmed" || existing.status === "ignored") ? existing.status : "auto";
    const fields = {
      name: (named.get(token) as string | undefined) ?? g.name ?? token,
      accountId: topAccount,
      direction: "out",
      amount: Math.abs(med),
      cadence: "monthly",
      dayOfMonth: day,
      lastSeen: g.last ? new Date(`${g.last}T00:00:00`) : null,
      nextDue: inferNextDue(day, today),
      status,
    };
    await db.recurringSchedule.upsert({
      where: { merchantToken: token },
      create: { merchantToken: token, ...fields },
      update: fields,
    });
  }

  // Income stream: estimate the typical monthly household income and store it as
  // ONE recurring income schedule. We work PER ACCOUNT, off each account's
  // individual income-categorised deposits (not the per-month sum), then sum the
  // accounts. Working per-deposit means irregular pay *timing* — e.g. a late wage
  // landing in the next calendar month, so one month shows two paydays — doesn't
  // inflate the figure. Always recomputed from current data (never user-locked),
  // so newly categorised income (e.g. a partner's transfers) is reflected at once.
  const incomeToken = "income:stream";
  const manualIncome = await db.recurringSchedule.findFirst({ where: { direction: "in", status: { not: "ignored" }, NOT: { merchantToken: incomeToken } } });
  if (manualIncome) {
    // The user added their own explicit income entry — respect it, don't double-count.
    await db.recurringSchedule.deleteMany({ where: { merchantToken: incomeToken } });
  } else {
    const allIncome = txns.filter((t) => Number(t.amount) > 0 && t.bookingDate && effectiveCategory(t) === "income");
    // Prefer the last 6 complete months so a recent change (a partner starting to
    // contribute) is reflected; fall back to all complete months if that's empty.
    const ymNow = today.toISOString().slice(0, 7);
    const cutoff = new Date(today.getFullYear(), today.getMonth() - 6, 1).toISOString().slice(0, 10);
    const complete = allIncome.filter((t) => t.bookingDate!.slice(0, 7) !== ymNow);
    const windowed = complete.filter((t) => t.bookingDate! >= cutoff);
    const incomeCredits = windowed.length ? windowed : complete;

    // account -> month -> deposit amounts
    const perAccount = new Map<string, Map<string, number[]>>();
    for (const t of incomeCredits) {
      const m = t.bookingDate!.slice(0, 7);
      const months = perAccount.get(t.accountId) ?? new Map<string, number[]>();
      const arr = months.get(m) ?? [];
      arr.push(Number(t.amount));
      months.set(m, arr);
      perAccount.set(t.accountId, months);
    }

    let total = 0;
    let dominant: { accountId: string; monthly: number } | null = null;
    for (const [accountId, months] of perAccount) {
      // Count an account as recurring income only if it pays in >= 2 distinct
      // months (filters one-off credits, e.g. a refund miscategorised as income).
      if (months.size < 2) continue;
      const deposits = [...months.values()].flat();
      // Typical single deposit: fixed salary -> the amount; variable transfer ->
      // the central value. Multiply by the *minimum* deposits seen in any active
      // month, so a bunched single salary counts once while a genuine two-stream
      // account (every month has two) counts both.
      const typical = median(deposits);
      const minPerMonth = Math.min(...[...months.values()].map((a) => a.length));
      const monthly = typical * Math.max(1, minPerMonth);
      total += monthly;
      if (!dominant || monthly > dominant.monthly) dominant = { accountId, monthly };
    }

    if (total >= 1 && dominant) {
      // Pay day comes from the dominant (largest) income account, for display only.
      const domDates = incomeCredits.filter((t) => t.accountId === dominant!.accountId).map((t) => t.bookingDate!);
      const day = typicalDayOfMonth(domDates) ?? 28;
      const lastSeenIso = incomeCredits.map((t) => t.bookingDate!).sort().slice(-1)[0] ?? null;
      const lastSeen = lastSeenIso ? new Date(`${lastSeenIso}T00:00:00`) : null;
      const amount = Math.round(total * 100) / 100;
      const fields = { name: "Income", accountId: null, direction: "in", amount, cadence: "monthly", dayOfMonth: day, lastSeen, nextDue: inferNextDue(day, today), status: "auto" };
      await db.recurringSchedule.upsert({
        where: { merchantToken: incomeToken },
        create: { merchantToken: incomeToken, ...fields },
        update: fields,
      });
      qualifying.add(incomeToken);
    } else {
      await db.recurringSchedule.deleteMany({ where: { merchantToken: incomeToken } });
    }
  }

  // Prune auto schedules whose merchant no longer qualifies (keep user-curated ones).
  await db.recurringSchedule.deleteMany({ where: { status: "auto", merchantToken: { notIn: [...qualifying] } } });
  return { detected: qualifying.size };
}
