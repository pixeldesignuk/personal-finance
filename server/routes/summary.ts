import { Router } from "express";
import { db } from "../lib/db.ts";
import { currentBalance, excludedBalance } from "../lib/balance.ts";
import { manualTxnSums } from "../lib/manualBalance.ts";
import { effectiveCategory } from "../lib/effectiveCategory.ts";
import { cashFlow, round2, currentMonth, type BudgetTx } from "../lib/budget.ts";
import { getSettings } from "../lib/settings.ts";
import type { SummaryDTO } from "../../shared/types.ts";

export const summaryRouter = Router();

summaryRouter.get("/summary", async (_req, res, next) => {
  try {
    const month = currentMonth();
    const accounts = await db.account.findMany({ include: { balances: true } });
    const sums = await manualTxnSums();
    let investments = 0;
    let assets = 0;
    let debts = 0;
    let liquid = 0;
    for (const a of accounts) {
      if (a.informational) continue; // tracked but excluded from all totals
      const bal = currentBalance(
        a.source,
        a.manualBalance != null ? Number(a.manualBalance.toString()) : null,
        a.balances.map((b) => ({ type: b.type, amount: Number(b.amount.toString()) })),
        a.balanceType,
        sums.get(a.id) ?? 0,
      );
      if (a.source === "INVESTMENT") investments += bal;
      else if (a.source === "ASSET") assets += bal;
      else if (a.source === "LIABILITY") debts += -bal; // bal is negative; owed is positive
      else liquid += bal - excludedBalance(a.excludedBalance); // BANK + MANUAL, minus funds that aren't yours
    }

    // Net worth composition is configurable via settings (feature flags).
    const s = await getSettings();
    let netWorth = liquid;
    if (s["networth.includeInvestments"]) netWorth += investments;
    if (s["networth.includeAssets"]) netWorth += assets;
    if (s["networth.includeDebts"]) netWorth -= debts;
    const personalIds = accounts.filter((a) => a.type === "PERSONAL" && !a.informational).map((a) => a.id);
    const txns = await db.transaction.findMany({ where: { accountId: { in: personalIds } } });
    const cf = cashFlow(
      txns.map<BudgetTx>((t) => ({ amount: Number(t.amount), category: effectiveCategory(t), bookingDate: t.bookingDate })),
      month,
    );
    const dto: SummaryDTO = {
      month,
      netWorth: round2(netWorth),
      investments: round2(investments),
      assets: round2(assets),
      debts: round2(debts),
      available: round2(liquid), // immediately available (banks + cash)
      included: {
        investments: s["networth.includeInvestments"],
        assets: s["networth.includeAssets"],
        debts: s["networth.includeDebts"],
      },
      ...cf,
    };
    res.json(dto);
  } catch (err) {
    next(err);
  }
});
