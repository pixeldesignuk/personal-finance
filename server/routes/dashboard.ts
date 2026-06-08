import { Router } from "express";
import { z } from "zod";
import { db } from "../lib/db.ts";
import { spendingByCategory, monthlyTotals, topMerchants, type AggTx } from "../lib/aggregate.ts";
import type { DashboardDTO, TransactionDTO } from "../../shared/types.ts";
import { accountScope } from "../lib/accountScope.ts";
import { effectiveCategory } from "../lib/effectiveCategory.ts";

export const dashboardRouter = Router();

dashboardRouter.get("/dashboard", async (req, res, next) => {
  try {
    const { accountId, person } = z
      .object({ accountId: z.string().optional(), person: z.string().optional() })
      .parse(req.query);
    const scope = accountScope(accountId);
    const txns = await db.transaction.findMany({ where: { ...scope, ...(person && person !== "all" ? { personKey: person === "none" ? null : person } : {}) } });
    const agg: AggTx[] = txns
      .map((t) => ({
        amount: Number(t.amount),
        category: effectiveCategory(t),
        merchant: t.merchantName ?? t.creditorName ?? t.debtorName ?? null,
        bookingDate: t.bookingDate,
      }))
      .filter((t) => t.category !== "transfer");
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
      .object({ search: z.string().optional(), accountId: z.string().optional(), person: z.string().optional(), limit: z.coerce.number().max(500).default(200) })
      .parse(req.query);
    const txns = await db.transaction.findMany({
      where: {
        ...accountScope(q.accountId),
        ...(q.person ? { personKey: q.person === "none" ? null : q.person } : {}),
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
      orderBy: [{ bookingDate: "desc" }, { id: "asc" }],
      take: q.limit,
      include: { account: true },
    });
    const people = await db.person.findMany();
    const personName = (k: string | null) => people.find((p) => p.key === k)?.name ?? null;
    const dto: TransactionDTO[] = txns.map((t) => ({
      id: t.id,
      accountId: t.accountId,
      bookingDate: t.bookingDate,
      amount: t.amount.toString(),
      currency: t.currency,
      name: t.merchantName ?? t.creditorName ?? t.debtorName ?? null,
      remittanceInfo: t.remittanceInfo,
      category: effectiveCategory(t),
      autoCategory: t.category,
      personKey: t.personKey,
      personName: personName(t.personKey),
      source: t.account.source,
      status: t.status,
    }));
    res.json(dto);
  } catch (err) {
    next(err);
  }
});
