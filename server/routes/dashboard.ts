import { Router } from "express";
import { z } from "zod";
import { db } from "../lib/db.ts";
import { spendingByCategory, monthlyTotals, topMerchants, type AggTx } from "../lib/aggregate.ts";
import type { DashboardDTO, TransactionDTO } from "../../shared/types.ts";
import { accountScope } from "../lib/accountScope.ts";

export const dashboardRouter = Router();

dashboardRouter.get("/dashboard", async (req, res, next) => {
  try {
    const { accountId } = z
      .object({ accountId: z.string().optional() })
      .parse(req.query);
    const scope = accountScope(accountId);
    const txns = await db.transaction.findMany({ where: scope });
    const agg: AggTx[] = txns.map((t) => ({
      amount: Number(t.amount),
      category: t.category,
      merchant: t.merchantName ?? t.creditorName ?? t.debtorName ?? null,
      bookingDate: t.bookingDate,
    }));
    const balances = await db.balance.findMany({ where: scope });
    const dto: DashboardDTO = {
      balances: balances.map((b) => ({
        accountId: b.accountId,
        type: b.type,
        amount: b.amount.toString(),
        currency: b.currency,
      })),
      byCategory: spendingByCategory(agg),
      monthly: monthlyTotals(agg),
      topMerchants: topMerchants(agg, 10),
    };
    res.json(dto);
  } catch (err) {
    next(err);
  }
});

dashboardRouter.get("/transactions", async (req, res, next) => {
  try {
    const q = z
      .object({ search: z.string().optional(), accountId: z.string().optional(), limit: z.coerce.number().max(500).default(200) })
      .parse(req.query);
    const txns = await db.transaction.findMany({
      where: {
        accountId: q.accountId,
        ...(q.search
          ? {
              OR: [
                { merchantName: { contains: q.search, mode: "insensitive" } },
                { creditorName: { contains: q.search, mode: "insensitive" } },
                { remittanceInfo: { contains: q.search, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      orderBy: { bookingDate: "desc" },
      take: q.limit,
    });
    const dto: TransactionDTO[] = txns.map((t) => ({
      id: t.id,
      accountId: t.accountId,
      bookingDate: t.bookingDate,
      amount: t.amount.toString(),
      currency: t.currency,
      name: t.merchantName ?? t.creditorName ?? t.debtorName ?? null,
      remittanceInfo: t.remittanceInfo,
      category: t.category,
      status: t.status,
    }));
    res.json(dto);
  } catch (err) {
    next(err);
  }
});
