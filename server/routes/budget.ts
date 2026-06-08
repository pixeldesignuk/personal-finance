import { Router } from "express";
import { z } from "zod";
import { db } from "../lib/db.ts";
import { effectiveCategory } from "../lib/effectiveCategory.ts";
import { currentMonth, monthOf, round2, personalSpendByCategory, type BudgetTx } from "../lib/budget.ts";
import { currentBalance } from "../lib/balance.ts";
import { buildBudgetRows, type BudgetCategory } from "../lib/budgetView.ts";
import type { BudgetResponseDTO } from "../../shared/types.ts";

export const budgetRouter = Router();

budgetRouter.get("/budget", async (req, res, next) => {
  try {
    const q = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/).optional(), person: z.string().optional() }).parse(req.query);
    const month = q.month ?? currentMonth();

    const personal = await db.account.findMany({ where: { type: "PERSONAL" }, include: { balances: true } });
    const ids = personal.map((a) => a.id);
    const txns = await db.transaction.findMany({ where: { accountId: { in: ids } } });
    const filtered = q.person ? txns.filter((t) => (q.person === "none" ? t.personKey == null : t.personKey === q.person)) : txns;
    const budgetTxns: BudgetTx[] = filtered.map((t) => ({ amount: Number(t.amount), category: effectiveCategory(t), bookingDate: t.bookingDate }));
    const spent = personalSpendByCategory(budgetTxns, month);

    const cats = await db.category.findMany({ where: { archived: false, key: { not: "uncategorised" } }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
    const categories: BudgetCategory[] = cats.map((c) => ({ id: c.id, key: c.key, name: c.name, group: c.group, monthlyAmount: Number(c.monthlyAmount.toString()) }));
    const rows = buildBudgetRows(categories, spent);

    // Top-of-page summary.
    let income = 0;
    for (const t of filtered) {
      if (!t.bookingDate || monthOf(t.bookingDate) !== month) continue;
      const amt = Number(t.amount);
      if (amt > 0 && effectiveCategory(t) !== "transfer") income += amt;
    }
    const budgeted = categories.reduce((s, c) => s + c.monthlyAmount, 0);
    const spentTotal = Object.values(spent).reduce((s, v) => s + v, 0);
    const pendingCount = filtered.filter((t) => t.status === "pending").length;

    // Balance-based "available to budget": the money you actually hold across
    // personal accounts (cash + current − card debt) minus this month's budget.
    let balance = 0;
    for (const a of personal) {
      balance += currentBalance(
        a.source,
        a.manualBalance != null ? Number(a.manualBalance.toString()) : null,
        a.balances.map((b) => ({ type: b.type, amount: Number(b.amount.toString()) })),
        a.balanceType,
      );
    }

    const response: BudgetResponseDTO = {
      rows,
      summary: {
        available: round2(balance - budgeted),
        spent: round2(spentTotal),
        budgeted: round2(budgeted),
        income: round2(income),
        pendingCount,
      },
    };
    res.json(response);
  } catch (err) { next(err); }
});
