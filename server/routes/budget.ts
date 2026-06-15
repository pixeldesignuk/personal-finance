import { Router } from "express";
import { z } from "zod";
import { db } from "../lib/db.ts";
import { effectiveCategory } from "../lib/effectiveCategory.ts";
import { currentMonth, monthOf, round2, personalSpendByCategory, suggestBudgets, completeSpendMonths, type BudgetTx } from "../lib/budget.ts";
import { currentBalance, excludedBalance } from "../lib/balance.ts";
import { manualTxnSums } from "../lib/manualBalance.ts";
import { buildBudgetRows, type BudgetCategory } from "../lib/budgetView.ts";
import { billTarget } from "../lib/recurring.ts";
import { isRefundNote } from "../../shared/refund.ts";
import type { BudgetResponseDTO, BillTargetDTO, CategoryInfoDTO, CategoryHistoryDTO } from "../../shared/types.ts";

function prevMonth(m: string): string {
  const [y, mo] = m.split("-").map(Number);
  return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, "0")}`;
}

export const budgetRouter = Router();

budgetRouter.get("/budget", async (req, res, next) => {
  try {
    const q = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/).optional(), person: z.string().optional() }).parse(req.query);
    const month = q.month ?? currentMonth();

    const personal = await db.account.findMany({ where: { type: "PERSONAL", informational: false }, include: { balances: true } });
    const ids = personal.map((a) => a.id);
    const txns = await db.transaction.findMany({ where: { accountId: { in: ids } } });
    const filtered = q.person ? txns.filter((t) => (q.person === "none" ? t.personKey == null : t.personKey === q.person)) : txns;
    const budgetTxns: BudgetTx[] = filtered.map((t) => ({ amount: Number(t.amount), category: effectiveCategory(t), bookingDate: t.bookingDate }));
    const spent = personalSpendByCategory(budgetTxns, month);

    const cats = await db.category.findMany({ where: { archived: false, key: { not: "uncategorised" } }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
    const categories: BudgetCategory[] = cats.map((c) => ({ id: c.id, key: c.key, name: c.name, group: c.group, monthlyAmount: Number(c.monthlyAmount.toString()) }));
    const rows = buildBudgetRows(categories, spent);

    // Top-of-page summary. Refunds (credits noted "refund …") are counted on
    // their own line, not as income.
    const isRefundTxn = (t: { amount: unknown; note: string | null }) => Number(t.amount) > 0 && isRefundNote(t.note);
    let income = 0;
    let refunded = 0;
    for (const t of filtered) {
      if (!t.bookingDate || monthOf(t.bookingDate) !== month) continue;
      const amt = Number(t.amount);
      if (amt <= 0) continue;
      if (isRefundTxn(t)) refunded += amt;
      else if (effectiveCategory(t) !== "transfer") income += amt;
    }
    const budgeted = categories.reduce((s, c) => s + c.monthlyAmount, 0);

    // Non-monthly (quarterly/annual) bills, smoothed into monthly "set aside"
    // targets so you save for them all year and they never spike one month.
    const isoOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const now = new Date();
    const nonMonthly = await db.recurringSchedule.findMany({ where: { direction: "out", status: { not: "ignored" }, cadence: { in: ["quarterly", "yearly"] } } });
    const billTargets: BillTargetDTO[] = [];
    for (const s of nonMonthly) {
      if (!s.nextDue) continue;
      const calc = billTarget(Number(s.amount.toString()), s.cadence, isoOf(s.nextDue), now);
      if (!calc) continue;
      billTargets.push({ token: s.merchantToken, name: s.name ?? s.merchantToken, amount: Number(s.amount.toString()), cadence: s.cadence, ...calc });
    }
    billTargets.sort((a, b) => (a.nextDue ?? "").localeCompare(b.nextDue ?? ""));
    const setAside = billTargets.reduce((acc, b) => acc + b.monthlyAmount, 0);

    const spentTotal = Object.values(spent).reduce((s, v) => s + v, 0);
    const lastMonthSpend = personalSpendByCategory(budgetTxns, prevMonth(month));
    const spentLastMonth = Object.values(lastMonthSpend).reduce((s, v) => s + v, 0);
    const pendingCount = filtered.filter((t) => t.status === "pending").length;

    // "Available to budget" = liquid money you actually hold (current + cash −
    // card debt) minus this month's budget. Excludes investments/assets/debts.
    const sums = await manualTxnSums();
    let balance = 0;
    for (const a of personal) {
      if (a.source !== "BANK" && a.source !== "MANUAL") continue;
      balance += currentBalance(
        a.source,
        a.manualBalance != null ? Number(a.manualBalance.toString()) : null,
        a.balances.map((b) => ({ type: b.type, amount: Number(b.amount.toString()) })),
        a.balanceType,
        sums.get(a.id) ?? 0,
      ) - excludedBalance(a.excludedBalance);
    }

    const response: BudgetResponseDTO = {
      rows,
      billTargets,
      summary: {
        available: round2(balance - budgeted - setAside),
        spent: round2(spentTotal),
        spentLastMonth: round2(spentLastMonth),
        budgeted: round2(budgeted),
        setAside: round2(setAside),
        income: round2(income),
        refunded: round2(refunded),
        pendingCount,
      },
    };
    res.json(response);
  } catch (err) { next(err); }
});

// Auto-populate every expense category's monthly budget from spending history
// (median monthly spend over complete months). Overwrites existing amounts for
// categories that have history; categories with no spend are left untouched.
budgetRouter.post("/budget/auto-populate", async (_req, res, next) => {
  try {
    const month = currentMonth();
    const personal = await db.account.findMany({ where: { type: "PERSONAL", informational: false }, select: { id: true } });
    const ids = personal.map((a) => a.id);
    const txns = await db.transaction.findMany({ where: { accountId: { in: ids } } });
    const budgetTxns: BudgetTx[] = txns.map((t) => ({ amount: Number(t.amount), category: effectiveCategory(t), bookingDate: t.bookingDate }));
    const months = completeSpendMonths(budgetTxns, month);
    if (months === 0) { res.json({ updated: 0, months: 0, total: 0 }); return; }
    const suggestions = suggestBudgets(budgetTxns, month);
    let updated = 0;
    let total = 0;
    for (const [key, amount] of Object.entries(suggestions)) {
      const r = await db.category.updateMany({ where: { key, archived: false }, data: { monthlyAmount: amount } });
      if (r.count) { updated += r.count; total += amount; }
    }
    res.json({ updated, months, total: round2(total) });
  } catch (err) { next(err); }
});

// Per-category detail for the Budget edit panel.
budgetRouter.get("/budget/category/:key", async (req, res, next) => {
  try {
    const q = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/).optional(), person: z.string().optional() }).parse(req.query);
    const month = q.month ?? currentMonth();
    const last = prevMonth(month);

    const cat = await db.category.findUnique({ where: { key: req.params.key } });
    if (!cat) { res.status(404).json({ error: "Category not found" }); return; }
    const monthlyAmount = Number(cat.monthlyAmount.toString());

    const personal = await db.account.findMany({ where: { type: "PERSONAL", informational: false }, select: { id: true } });
    const ids = personal.map((a) => a.id);
    const txns = await db.transaction.findMany({ where: { accountId: { in: ids } } });
    const filtered = q.person ? txns.filter((t) => (q.person === "none" ? t.personKey == null : t.personKey === q.person)) : txns;
    const lastMonthSpend = personalSpendByCategory(
      filtered.map<BudgetTx>((t) => ({ amount: Number(t.amount), category: effectiveCategory(t), bookingDate: t.bookingDate })),
      last,
    );
    const spentLastMonth = round2(lastMonthSpend[req.params.key] ?? 0);

    const dto: CategoryInfoDTO = {
      key: req.params.key,
      monthlyAmount,
      budgetedLastMonth: monthlyAmount, // budgets aren't versioned by month
      spentLastMonth,
      carriedForward: round2(monthlyAmount - spentLastMonth),
      goalAmount: null,
    };
    res.json(dto);
  } catch (err) { next(err); }
});

// Per-category monthly spend history (for the budget detail sheet bar chart).
// Returns a chronological window of the last `months` months ending at `month`.
budgetRouter.get("/budget/category/:key/history", async (req, res, next) => {
  try {
    const q = z.object({
      month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
      person: z.string().optional(),
      months: z.coerce.number().int().min(1).max(24).optional(),
    }).parse(req.query);
    const anchor = q.month ?? currentMonth();
    const count = q.months ?? 7;

    const cat = await db.category.findUnique({ where: { key: req.params.key } });
    if (!cat) { res.status(404).json({ error: "Category not found" }); return; }

    const personal = await db.account.findMany({ where: { type: "PERSONAL", informational: false }, select: { id: true } });
    const ids = personal.map((a) => a.id);
    const txns = await db.transaction.findMany({ where: { accountId: { in: ids } } });
    const filtered = q.person ? txns.filter((t) => (q.person === "none" ? t.personKey == null : t.personKey === q.person)) : txns;
    const budgetTxns: BudgetTx[] = filtered.map((t) => ({ amount: Number(t.amount), category: effectiveCategory(t), bookingDate: t.bookingDate }));

    // Window of months [anchor-(count-1) … anchor], chronological.
    const window: string[] = [];
    let m = anchor;
    for (let i = 0; i < count; i++) { window.unshift(m); m = prevMonth(m); }
    const months = window.map((mo) => ({ month: mo, spent: round2(personalSpendByCategory(budgetTxns, mo)[req.params.key] ?? 0) }));

    const dto: CategoryHistoryDTO = {
      key: req.params.key,
      categoryId: cat.id,
      name: cat.name,
      group: cat.group,
      monthlyAmount: Number(cat.monthlyAmount.toString()),
      months,
    };
    res.json(dto);
  } catch (err) { next(err); }
});
