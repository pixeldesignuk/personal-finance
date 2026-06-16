import { Router } from "express";
import { z } from "zod";
import { db } from "../lib/db.ts";
import { detectSchedules } from "../lib/scheduleDetect.ts";
import { inferNextDue, occurrencesWithin, incomeOccurrences } from "../lib/recurring.ts";
import { tallyIncomeByAccount } from "../lib/funding.ts";
import { effectiveCategory } from "../lib/effectiveCategory.ts";
import { merchantToken } from "../categorise/helpers.ts";
import { rawMerchantName } from "../../shared/merchantName.ts";

const slug = (s: string) => s.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "item";
import type { RecurringScheduleDTO, UpcomingDTO, UpcomingItemDTO } from "../../shared/types.ts";

export const recurringRouter = Router();

const num = (d: { toString(): string }) => Number(d.toString());
const isoDay = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

const toDTO = (s: {
  merchantToken: string; name: string | null; accountId: string | null; direction: string;
  amount: { toString(): string }; kind: string; prevAmount: { toString(): string } | null; cadence: string; dayOfMonth: number | null; lastSeen: Date | null; nextDue: Date | null; status: string;
}): RecurringScheduleDTO => ({
  token: s.merchantToken,
  name: s.name ?? s.merchantToken,
  accountId: s.accountId,
  direction: s.direction === "in" ? "in" : "out",
  amount: num(s.amount),
  kind: s.kind === "variable" ? "variable" : "fixed",
  prevAmount: s.prevAmount != null ? num(s.prevAmount) : null,
  cadence: s.cadence,
  dayOfMonth: s.dayOfMonth,
  lastSeen: isoDay(s.lastSeen),
  nextDue: isoDay(s.nextDue),
  status: (s.status as RecurringScheduleDTO["status"]) ?? "auto",
});

// All schedules, soonest-due first (ignored last).
recurringRouter.get("/recurring", async (_req, res, next) => {
  try {
    const rows = await db.recurringSchedule.findMany({ orderBy: [{ nextDue: "asc" }] });
    res.json(rows.map(toDTO));
  } catch (err) { next(err); }
});

// Re-detect schedules from current transaction patterns.
recurringRouter.post("/recurring/detect", async (_req, res, next) => {
  try { res.json(await detectSchedules()); }
  catch (err) { next(err); }
});

// Manually add a recurring bill or income (e.g. a salary detection missed).
// Stored as a confirmed schedule under a "manual:" token so re-detection won't
// touch it.
recurringRouter.post("/recurring", async (req, res, next) => {
  try {
    const b = z.object({
      name: z.string().min(1),
      direction: z.enum(["out", "in"]),
      amount: z.number().nonnegative(),
      dayOfMonth: z.number().int().min(1).max(31),
      cadence: z.enum(["monthly", "weekly", "quarterly", "yearly", "irregular"]).default("monthly"),
      // Quarterly/annual bills need a full next-due DATE (we need the month, not
      // just the day); monthly/weekly just need dayOfMonth.
      nextDue: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    }).parse(req.body ?? {});
    const token = `manual:${slug(b.name)}`;
    const dayOfMonth = b.nextDue ? Number(b.nextDue.slice(8, 10)) : b.dayOfMonth;
    const nextDue = b.nextDue ? new Date(`${b.nextDue}T00:00:00`) : inferNextDue(b.dayOfMonth, new Date());
    const fields = { name: b.name.trim(), direction: b.direction, amount: b.amount, dayOfMonth, cadence: b.cadence, nextDue, status: "confirmed", accountId: null };
    const row = await db.recurringSchedule.upsert({ where: { merchantToken: token }, create: { merchantToken: token, ...fields }, update: fields });
    res.json(toDTO(row));
  } catch (err) { next(err); }
});

// Confirm / ignore / edit a schedule.
recurringRouter.patch("/recurring/:token", async (req, res, next) => {
  try {
    const patch = z.object({
      status: z.enum(["auto", "confirmed", "ignored"]).optional(),
      amount: z.number().nonnegative().optional(),
      dayOfMonth: z.number().int().min(1).max(31).optional(),
      cadence: z.enum(["monthly", "weekly", "quarterly", "yearly", "irregular"]).optional(),
      direction: z.enum(["out", "in"]).optional(),
      accountId: z.string().nullable().optional(),
      nextDue: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), // full date for quarterly/annual bills
      name: z.string().min(1).optional(),
    }).parse(req.body ?? {});
    const token = req.params.token;
    const current = await db.recurringSchedule.findUnique({ where: { merchantToken: token } });
    if (!current) { res.status(404).json({ error: "No such schedule" }); return; }
    const { nextDue: nextDueStr, name: nameRaw, ...rest } = patch;
    const name = nameRaw?.trim();
    // Renaming a detected bill renames the underlying merchant too, so it sticks
    // through re-detection AND renames it everywhere (transactions, budget). For
    // income/manual schedules there is no merchant — just set the schedule name.
    if (name && !token.startsWith("income:") && !token.startsWith("manual:")) {
      await db.merchant.upsert({ where: { token }, create: { token, name }, update: { name } });
    }
    // An explicit next-due date wins; otherwise recompute from dayOfMonth when the
    // timing inputs changed; otherwise keep the existing one.
    const day = patch.dayOfMonth ?? current.dayOfMonth ?? 1;
    const nextDue = nextDueStr
      ? new Date(`${nextDueStr}T00:00:00`)
      : (patch.dayOfMonth != null || patch.cadence != null) ? inferNextDue(day, new Date()) : current.nextDue;
    const data = { ...rest, nextDue, ...(name ? { name } : {}), ...(nextDueStr ? { dayOfMonth: Number(nextDueStr.slice(8, 10)) } : {}) };
    const updated = await db.recurringSchedule.update({ where: { merchantToken: token }, data });
    res.json(toDTO(updated));
  } catch (err) { next(err); }
});

// Feedback: this detected schedule is NOT actually recurring (the detector got
// it wrong). Distinct from "stop tracking" (status=ignored), which keeps a
// genuinely-recurring item but hides it. Here we TRAIN the detector to never
// re-add it — set the merchant's recurring override to "ignore" — and remove the
// schedule. Income streams / manual entries have no merchant row, so we just
// delete them (income won't be re-derived once there's nothing to learn from).
recurringRouter.post("/recurring/:token/not-recurring", async (req, res, next) => {
  try {
    const token = req.params.token;
    const current = await db.recurringSchedule.findUnique({ where: { merchantToken: token } });
    if (!current) { res.status(404).json({ error: "No such schedule" }); return; }
    if (!token.startsWith("income:") && !token.startsWith("manual:")) {
      await db.merchant.upsert({ where: { token }, create: { token, recurring: "ignore" }, update: { recurring: "ignore" } });
    }
    await db.recurringSchedule.delete({ where: { merchantToken: token } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// Expected bills + income in the next `days` (default 30), plus this-month totals.
recurringRouter.get("/upcoming", async (req, res, next) => {
  try {
    const days = Math.min(120, Math.max(1, Number(req.query.days) || 30));
    const today = new Date();
    const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().slice(0, 10);
    const next30 = new Date(today); next30.setDate(next30.getDate() + 30);
    const next30Iso = next30.toISOString().slice(0, 10);

    const schedules = await db.recurringSchedule.findMany({ where: { status: { not: "ignored" } } });
    // Income received this month, PER ACCOUNT — tracked as the running total AND
    // the single largest credit. We use these to decide whether a stream's
    // *recurring* payment has actually landed, rather than subtracting every
    // credit (a one-off like a friend paying you back must NOT reduce the
    // projection).
    const ym = today.toISOString().slice(0, 7);
    const monthCredits = (await db.transaction.findMany({ where: { amount: { gt: 0 }, bookingDate: { startsWith: ym } }, select: { amount: true, category: true, categoryOverride: true, accountId: true } }))
      .filter((t) => effectiveCategory(t) === "income");
    const { byAccount: incomeByAccount, totalAll, maxAll } = tallyIncomeByAccount(
      monthCredits.map((t) => ({ amount: num(t.amount), accountId: t.accountId })),
    );

    // Recurring schedules carry only a merchant token, not a category. Derive each
    // token's category from its transactions (the modal effective category) so the
    // budget sheet can show a category's upcoming bills. One scan, built into a map.
    const catTxns = await db.transaction.findMany({ select: { merchantName: true, creditorName: true, debtorName: true, remittanceInfo: true, category: true, categoryOverride: true } });
    const tokenCatCounts = new Map<string, Map<string, number>>();
    for (const t of catTxns) {
      const tok = merchantToken(rawMerchantName(t));
      if (!tok) continue;
      const cat = effectiveCategory(t);
      if (cat === "transfer" || cat === "uncategorised") continue;
      let m = tokenCatCounts.get(tok);
      if (!m) { m = new Map(); tokenCatCounts.set(tok, m); }
      m.set(cat, (m.get(cat) ?? 0) + 1);
    }
    const categoryForToken = (token: string): string | null => {
      const m = tokenCatCounts.get(token);
      if (!m) return null;
      let best: string | null = null, bestN = -1;
      for (const [cat, n] of m) if (n > bestN) { best = cat; bestN = n; }
      return best;
    };

    const items: UpcomingItemDTO[] = [];
    for (const s of schedules) {
      const status = (s.status as UpcomingItemDTO["status"]) ?? "auto";
      const kind = s.kind === "variable" ? "variable" : "fixed";
      const prevAmount = s.prevAmount != null ? num(s.prevAmount) : null;
      const category = categoryForToken(s.merchantToken);
      if (s.direction === "in") {
        const amt = num(s.amount);
        const got = s.accountId ? incomeByAccount.get(s.accountId) ?? { total: 0, max: 0 } : { total: totalAll, max: maxAll };
        // The recurring payment has arrived if a salary-sized credit landed
        // (≥60% of the typical amount) OR the month's income for this source
        // already covers it. A small one-off below that bar is ignored, so the
        // projection stays at the full expected amount.
        const arrived = got.max >= 0.6 * amt || got.total >= amt - 0.005;
        // Project the FULL typical amount for each future occurrence; this month's
        // occurrence is dropped only once the payment has actually arrived.
        for (const d of incomeOccurrences(s.dayOfMonth ?? 28, arrived, today, days)) {
          if (amt >= 1) items.push({ token: s.merchantToken, name: s.name ?? s.merchantToken, amount: amt, direction: "in", kind, prevAmount: null, date: d.toISOString().slice(0, 10), status, category });
        }
      } else if (s.nextDue) {
        for (const d of occurrencesWithin(s.nextDue, s.cadence, today, days)) {
          items.push({ token: s.merchantToken, name: s.name ?? s.merchantToken, amount: num(s.amount), direction: "out", kind, prevAmount, date: d.toISOString().slice(0, 10), status, category });
        }
      }
    }
    items.sort((a, b) => a.date.localeCompare(b.date));

    let billsDueThisMonth = 0, incomeDueThisMonth = 0, billsNext30 = 0, incomeNext30 = 0;
    for (const it of items) {
      const out = it.direction === "out";
      if (it.date <= monthEnd) { if (out) billsDueThisMonth += it.amount; else incomeDueThisMonth += it.amount; }
      if (it.date <= next30Iso) { if (out) billsNext30 += it.amount; else incomeNext30 += it.amount; }
    }
    const r2 = (n: number) => Math.round(n * 100) / 100;
    const dto: UpcomingDTO = {
      items, windowDays: days,
      billsDueThisMonth: r2(billsDueThisMonth), incomeDueThisMonth: r2(incomeDueThisMonth),
      billsNext30: r2(billsNext30), incomeNext30: r2(incomeNext30),
    };
    res.json(dto);
  } catch (err) { next(err); }
});
