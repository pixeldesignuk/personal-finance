import { Router } from "express";
import { z } from "zod";
import { db } from "../lib/db.ts";
import { effectiveCategory } from "../lib/effectiveCategory.ts";
import { currentMonth, personalSpendByCategory, type BudgetTx } from "../lib/budget.ts";
import { buildBudgetRows, type BudgetCategory } from "../lib/budgetView.ts";
import type { BudgetRowDTO } from "../../shared/types.ts";

export const budgetRouter = Router();

budgetRouter.get("/budget", async (req, res, next) => {
  try {
    const q = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/).optional(), person: z.string().optional() }).parse(req.query);
    const month = q.month ?? currentMonth();

    const personal = await db.account.findMany({ where: { type: "PERSONAL" }, select: { id: true } });
    const ids = personal.map((a) => a.id);
    const txns = await db.transaction.findMany({ where: { accountId: { in: ids } } });
    const filtered = q.person ? txns.filter((t) => (q.person === "none" ? t.personKey == null : t.personKey === q.person)) : txns;
    const budgetTxns: BudgetTx[] = filtered.map((t) => ({ amount: Number(t.amount), category: effectiveCategory(t), bookingDate: t.bookingDate }));
    const spent = personalSpendByCategory(budgetTxns, month);

    const cats = await db.category.findMany({ where: { archived: false }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
    const categories: BudgetCategory[] = cats.map((c) => ({ key: c.key, name: c.name, monthlyAmount: Number(c.monthlyAmount.toString()) }));
    const rows: BudgetRowDTO[] = buildBudgetRows(categories, spent);
    res.json(rows);
  } catch (err) { next(err); }
});
