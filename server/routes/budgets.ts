import { Router } from "express";
import { z } from "zod";
import { db } from "../lib/db.ts";
import { SPENDING_CATEGORIES } from "../lib/categorize.ts";
import { effectiveCategory } from "../lib/effectiveCategory.ts";
import { personalSpendByCategory, buildBudgetRows, currentMonth, type BudgetTx } from "../lib/budget.ts";

export const budgetsRouter = Router();

budgetsRouter.get("/budgets", async (_req, res, next) => {
  try {
    const month = currentMonth();
    const budgets = await db.budget.findMany();
    const limits: Record<string, number> = {};
    for (const b of budgets) limits[b.category] = Number(b.monthlyLimit.toString());

    const personal = await db.account.findMany({ where: { type: "PERSONAL" }, select: { id: true } });
    const ids = personal.map((a) => a.id);
    const txns = await db.transaction.findMany({ where: { accountId: { in: ids } } });
    const budgetTxns: BudgetTx[] = txns.map((t) => ({
      amount: Number(t.amount),
      category: effectiveCategory(t),
      bookingDate: t.bookingDate,
    }));
    const spent = personalSpendByCategory(budgetTxns, month);
    res.json(buildBudgetRows(limits, spent));
  } catch (err) {
    next(err);
  }
});

budgetsRouter.put("/budgets/:category", async (req, res, next) => {
  try {
    const category = req.params.category;
    if (!SPENDING_CATEGORIES.includes(category as never)) {
      res.status(400).json({ error: "Unknown spending category" });
      return;
    }
    const { monthlyLimit } = z.object({ monthlyLimit: z.number().min(0) }).parse(req.body);
    await db.budget.upsert({
      where: { category },
      create: { category, monthlyLimit },
      update: { monthlyLimit },
    });
    res.json({ category, monthlyLimit });
  } catch (err) {
    next(err);
  }
});
