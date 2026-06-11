import { db } from "./db.ts";
import { merchantToken } from "../categorise/helpers.ts";
import { effectiveCategory } from "./effectiveCategory.ts";
import { analyzeRecurringAmounts, derivePayerName, median } from "./merchants.ts";
import { inferNextDue, typicalDayOfMonth } from "./recurring.ts";
import { displayName } from "../../shared/displayName.ts";
import { rawMerchantName } from "../../shared/merchantName.ts";

const tokenOf = (t: { merchantName: string | null; creditorName: string | null; debtorName: string | null; remittanceInfo: string | null }) =>
  merchantToken(rawMerchantName(t));

interface Group { name: string | null; amounts: number[]; entries: { amt: number; date: string }[]; dates: string[]; months: Set<string>; accounts: Map<string, number>; last: string | null }

// Detect recurring bills (and income) from transaction patterns and upsert one
// RecurringSchedule per merchant. A merchant qualifies as a bill if it recurs
// roughly once a month over ≥3 months (whether the amount is fixed or variable),
// or the user forced recurring=fixed; direction is by sign (out = bill, in =
// income). Each bill is tagged fixed/variable and flags a recent price increase.
// The user's confirmed/ignored status is preserved; stale auto schedules pruned.
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
    const g = groups.get(token) ?? { name: null, amounts: [], entries: [], dates: [], months: new Set<string>(), accounts: new Map<string, number>(), last: null };
    g.amounts.push(Number(t.amount));
    if (t.bookingDate) { g.entries.push({ amt: Number(t.amount), date: t.bookingDate }); g.dates.push(t.bookingDate); g.months.add(t.bookingDate.slice(0, 7)); if (!g.last || t.bookingDate > g.last) g.last = t.bookingDate; }
    g.accounts.set(t.accountId, (g.accounts.get(t.accountId) ?? 0) + 1);
    if (!g.name) g.name = rawMerchantName(t);
    groups.set(token, g);
  }

  const qualifying = new Set<string>();
  for (const [token, g] of groups) {
    const override = (overrides.get(token)?.recurring as string | undefined) ?? "auto";
    if (override === "ignore") continue;
    const monthsActive = g.months.size;
    const perMonth = g.amounts.length / Math.max(1, monthsActive);
    const med = median(g.amounts);
    // A BILL recurs about once a month over ≥3 months — whether the amount is
    // fixed (subscriptions) or variable (utilities, phone). The ~once-a-month
    // gate (perMonth ≤ 1.5) keeps high-frequency spend (groceries) out. The user
    // can force a merchant on via recurring=fixed. Recurring income (wages) has a
    // varying payroll reference, so it's handled by the income streams below.
    const isMonthly = monthsActive >= 3 && perMonth <= 1.5;
    const qualifies = override === "fixed" || (override === "auto" && isMonthly);
    if (!qualifies || med >= 0) continue;

    qualifying.add(token);
    const day = typicalDayOfMonth(g.dates) ?? 1;
    const topAccount = [...g.accounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    // Current amount / fixed-vs-variable / recent-increase flag, from charges
    // oldest -> newest.
    const chargesAsc = [...g.entries].sort((a, b) => a.date.localeCompare(b.date)).map((e) => Math.abs(e.amt));
    const { amount, kind, prevAmount } = analyzeRecurringAmounts(chargesAsc.length ? chargesAsc : [Math.abs(med)]);
    const existing = await db.recurringSchedule.findUnique({ where: { merchantToken: token } });
    const status = existing && (existing.status === "confirmed" || existing.status === "ignored") ? existing.status : "auto";
    const fields = {
      name: (named.get(token) as string | undefined) ?? g.name ?? token,
      accountId: topAccount,
      direction: "out",
      amount,
      kind,
      prevAmount,
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

  // Income streams: one recurring schedule PER income source (per account), so
  // each stream shows its own amount and when it lands — multiple earners /
  // sources are kept separate rather than lumped together. Each stream is
  // estimated from that account's individual income-categorised deposits (not the
  // per-month sum), so irregular pay *timing* — e.g. a late wage landing in the
  // next calendar month, making one month show two paydays — doesn't inflate it.
  // Always recomputed from current data (never user-locked), so newly categorised
  // income (e.g. a partner's transfers) is reflected immediately. Token per
  // account: `income:<accountId>`.
  const incomePrefix = "income:";
  const manualIncome = await db.recurringSchedule.findFirst({ where: { direction: "in", status: { not: "ignored" }, NOT: { merchantToken: { startsWith: incomePrefix } } } });
  if (manualIncome) {
    // The user added their own explicit income entry — respect it, don't double-count.
    await db.recurringSchedule.deleteMany({ where: { merchantToken: { startsWith: incomePrefix } } });
  } else {
    const allIncome = txns.filter((t) => Number(t.amount) > 0 && t.bookingDate && effectiveCategory(t) === "income");
    // Prefer the last 6 complete months so a recent change (a partner starting to
    // contribute) is reflected; fall back to all complete months if that's empty.
    const ymNow = today.toISOString().slice(0, 7);
    const cutoff = new Date(today.getFullYear(), today.getMonth() - 6, 1).toISOString().slice(0, 10);
    const complete = allIncome.filter((t) => t.bookingDate!.slice(0, 7) !== ymNow);
    const windowed = complete.filter((t) => t.bookingDate! >= cutoff);
    const incomeCredits = windowed.length ? windowed : complete;

    // account -> { month -> deposit amounts, dates, payer references }
    interface Acc { months: Map<string, number[]>; dates: string[]; labels: string[] }
    const perAccount = new Map<string, Acc>();
    for (const t of incomeCredits) {
      const m = t.bookingDate!.slice(0, 7);
      const e = perAccount.get(t.accountId) ?? { months: new Map<string, number[]>(), dates: [], labels: [] };
      const arr = e.months.get(m) ?? [];
      arr.push(Number(t.amount));
      e.months.set(m, arr);
      e.dates.push(t.bookingDate!);
      const label = rawMerchantName(t);
      if (label) e.labels.push(label);
      perAccount.set(t.accountId, e);
    }

    const accountsById = new Map((await db.account.findMany()).map((a) => [a.id, a] as const));
    for (const [accountId, e] of perAccount) {
      // Count an account as recurring income only if it pays in >= 2 distinct
      // months (filters one-off credits, e.g. a refund miscategorised as income).
      if (e.months.size < 2) continue;
      const deposits = [...e.months.values()].flat();
      // Typical single deposit: fixed salary -> the amount; variable transfer ->
      // the central value. Multiply by the *minimum* deposits seen in any active
      // month, so a bunched single salary counts once while a genuine two-stream
      // account (every month has two) counts both.
      const typical = median(deposits);
      const minPerMonth = Math.min(...[...e.months.values()].map((a) => a.length));
      const amount = Math.round(typical * Math.max(1, minPerMonth) * 100) / 100;
      if (amount < 1) continue;
      const day = typicalDayOfMonth(e.dates) ?? 28;
      const lastSeenIso = [...e.dates].sort().slice(-1)[0] ?? null;
      const lastSeen = lastSeenIso ? new Date(`${lastSeenIso}T00:00:00`) : null;
      // Name the stream after the payer/employer shared across its references
      // (e.g. "PIXEL DESIGN HOUSE…MAY WAGE" -> "Pixel Design"); fall back to the
      // account name when the references are noise (e.g. bank-transfer refs with
      // account numbers).
      const acc = accountsById.get(accountId);
      const name = derivePayerName(e.labels) ?? (acc ? displayName(acc) : "Income");
      const token = `${incomePrefix}${accountId}`;
      const fields = { name, accountId, direction: "in", amount, cadence: "monthly", dayOfMonth: day, lastSeen, nextDue: inferNextDue(day, today), status: "auto" };
      await db.recurringSchedule.upsert({
        where: { merchantToken: token },
        create: { merchantToken: token, ...fields },
        update: fields,
      });
      qualifying.add(token);
    }
  }

  // Prune auto schedules whose merchant no longer qualifies (keep user-curated ones).
  await db.recurringSchedule.deleteMany({ where: { status: "auto", merchantToken: { notIn: [...qualifying] } } });
  return { detected: qualifying.size };
}
