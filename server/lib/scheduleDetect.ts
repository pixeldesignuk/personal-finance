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

  // Income stream: aggregate everything categorised "income" into ONE recurring
  // income schedule. We key on the category (set by rules / the default that tags
  // positive transactions as income) rather than the merchant name, because the
  // payroll reference varies month to month. Learns the typical monthly amount
  // and pay day. Skipped if the user has added/confirmed their own income entry.
  const incomeToken = "income:stream";
  const manualIncome = await db.recurringSchedule.findFirst({ where: { direction: "in", status: { not: "ignored" }, NOT: { merchantToken: incomeToken } } });
  if (manualIncome) {
    await db.recurringSchedule.deleteMany({ where: { merchantToken: incomeToken, status: "auto" } });
  } else {
    const incomeCredits = txns.filter((t) => Number(t.amount) > 0 && t.bookingDate && effectiveCategory(t) === "income");
    const byMonth = new Map<string, { sum: number; main: { amount: number; date: string } }>();
    for (const t of incomeCredits) {
      const m = t.bookingDate!.slice(0, 7);
      const amt = Number(t.amount);
      const e = byMonth.get(m);
      if (!e) byMonth.set(m, { sum: amt, main: { amount: amt, date: t.bookingDate! } });
      else { e.sum += amt; if (amt > e.main.amount) e.main = { amount: amt, date: t.bookingDate! }; }
    }
    if (byMonth.size >= 2) {
      // Salary ≈ the typical *largest* monthly inflow (median across months), not
      // the sum of every income-tagged credit (which sweeps in refunds/transfers).
      const mains = [...byMonth.values()].map((v) => v.main);
      const day = typicalDayOfMonth(mains.map((m) => m.date)) ?? 28;
      const amount = median(mains.map((m) => m.amount));
      const lastSeenIso = incomeCredits.map((t) => t.bookingDate!).sort().slice(-1)[0] ?? null;
      const lastSeen = lastSeenIso ? new Date(`${lastSeenIso}T00:00:00`) : null;
      const existing = await db.recurringSchedule.findUnique({ where: { merchantToken: incomeToken } });
      const userSet = existing != null && existing.status !== "auto";
      await db.recurringSchedule.upsert({
        where: { merchantToken: incomeToken },
        create: { merchantToken: incomeToken, name: "Income", accountId: null, direction: "in", amount, cadence: "monthly", dayOfMonth: day, lastSeen, nextDue: inferNextDue(day, today), status: "auto" },
        // Once the user confirms/edits, keep their amount + day; only refresh timing.
        update: userSet
          ? { lastSeen, nextDue: inferNextDue(existing!.dayOfMonth ?? day, today) }
          : { name: "Income", accountId: null, direction: "in", amount, cadence: "monthly", dayOfMonth: day, lastSeen, nextDue: inferNextDue(day, today), status: "auto" },
      });
      qualifying.add(incomeToken);
    }
  }

  // Prune auto schedules whose merchant no longer qualifies (keep user-curated ones).
  await db.recurringSchedule.deleteMany({ where: { status: "auto", merchantToken: { notIn: [...qualifying] } } });
  return { detected: qualifying.size };
}
