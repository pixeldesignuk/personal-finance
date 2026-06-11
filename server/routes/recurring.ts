import { Router } from "express";
import { z } from "zod";
import { db } from "../lib/db.ts";
import { detectSchedules } from "../lib/scheduleDetect.ts";
import { inferNextDue, occurrencesWithin, incomeOccurrences } from "../lib/recurring.ts";
import { effectiveCategory } from "../lib/effectiveCategory.ts";

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
      cadence: z.enum(["monthly", "weekly", "yearly", "irregular"]).default("monthly"),
    }).parse(req.body ?? {});
    const token = `manual:${slug(b.name)}`;
    const fields = { name: b.name.trim(), direction: b.direction, amount: b.amount, dayOfMonth: b.dayOfMonth, cadence: b.cadence, nextDue: inferNextDue(b.dayOfMonth, new Date()), status: "confirmed", accountId: null };
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
      cadence: z.enum(["monthly", "weekly", "yearly", "irregular"]).optional(),
      direction: z.enum(["out", "in"]).optional(),
      accountId: z.string().nullable().optional(),
    }).parse(req.body ?? {});
    const token = req.params.token;
    const current = await db.recurringSchedule.findUnique({ where: { merchantToken: token } });
    if (!current) { res.status(404).json({ error: "No such schedule" }); return; }
    // Recompute the next occurrence if the timing inputs changed.
    const day = patch.dayOfMonth ?? current.dayOfMonth ?? 1;
    const nextDue = (patch.dayOfMonth != null || patch.cadence != null) ? inferNextDue(day, new Date()) : current.nextDue;
    const updated = await db.recurringSchedule.update({ where: { merchantToken: token }, data: { ...patch, nextDue } });
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
    // Income already received this month, PER ACCOUNT — so each income stream's
    // projection is its own *remaining* expected amount (typical − received for
    // that source), regardless of pay date. Streams with no account (a manual
    // entry) fall back to the household total.
    const ym = today.toISOString().slice(0, 7);
    const monthCredits = (await db.transaction.findMany({ where: { amount: { gt: 0 }, bookingDate: { startsWith: ym } }, select: { amount: true, category: true, categoryOverride: true, accountId: true } }))
      .filter((t) => effectiveCategory(t) === "income");
    const incomeByAccount = new Map<string, number>();
    for (const t of monthCredits) incomeByAccount.set(t.accountId, (incomeByAccount.get(t.accountId) ?? 0) + num(t.amount));
    const incomeThisMonthTotal = monthCredits.reduce((sum, t) => sum + num(t.amount), 0);

    const items: UpcomingItemDTO[] = [];
    for (const s of schedules) {
      const status = (s.status as UpcomingItemDTO["status"]) ?? "auto";
      const kind = s.kind === "variable" ? "variable" : "fixed";
      const prevAmount = s.prevAmount != null ? num(s.prevAmount) : null;
      if (s.direction === "in") {
        const received = s.accountId ? incomeByAccount.get(s.accountId) ?? 0 : incomeThisMonthTotal;
        // For each expected occurrence: this-month = remaining (this stream's
        // typical − received so far), future months = the full typical amount.
        for (const d of incomeOccurrences(s.dayOfMonth ?? 28, false, today, days)) {
          const date = d.toISOString().slice(0, 10);
          const amount = date.slice(0, 7) === ym ? Math.max(0, num(s.amount) - received) : num(s.amount);
          if (amount >= 1) items.push({ token: s.merchantToken, name: s.name ?? s.merchantToken, amount, direction: "in", kind, prevAmount: null, date, status });
        }
      } else if (s.nextDue) {
        for (const d of occurrencesWithin(s.nextDue, s.cadence, today, days)) {
          items.push({ token: s.merchantToken, name: s.name ?? s.merchantToken, amount: num(s.amount), direction: "out", kind, prevAmount, date: d.toISOString().slice(0, 10), status });
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
