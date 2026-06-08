import { Router } from "express";
import { db } from "../lib/db.ts";
import { currentBalance } from "../lib/balance.ts";
import { effectiveCategory } from "../lib/effectiveCategory.ts";
import { cashFlow, type BudgetTx } from "../lib/budget.ts";
import type { SummaryDTO } from "../../shared/types.ts";

export const summaryRouter = Router();
const round2 = (n: number) => Math.round(n * 100) / 100;

summaryRouter.get("/summary", async (_req, res, next) => {
  try {
    const month = new Date().toISOString().slice(0, 7);
    const accounts = await db.account.findMany({ include: { balances: true } });
    let netWorth = 0;
    for (const a of accounts) {
      netWorth += currentBalance(
        a.source,
        a.manualBalance != null ? Number(a.manualBalance.toString()) : null,
        a.balances.map((b) => ({ type: b.type, amount: Number(b.amount.toString()) })),
      );
    }
    const personalIds = accounts.filter((a) => a.type === "PERSONAL").map((a) => a.id);
    const txns = await db.transaction.findMany({ where: { accountId: { in: personalIds } } });
    const cf = cashFlow(
      txns.map<BudgetTx>((t) => ({ amount: Number(t.amount), category: effectiveCategory(t), bookingDate: t.bookingDate })),
      month,
    );
    const dto: SummaryDTO = { month, netWorth: round2(netWorth), ...cf };
    res.json(dto);
  } catch (err) {
    next(err);
  }
});
