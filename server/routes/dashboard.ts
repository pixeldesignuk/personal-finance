import { Router } from "express";
import { z } from "zod";
import { db } from "../lib/db.ts";
import { spendingByCategory, monthlyTotals, topMerchants, type AggTx } from "../lib/aggregate.ts";
import type { DashboardDTO, TransactionDTO } from "../../shared/types.ts";
import { accountScope } from "../lib/accountScope.ts";
import { effectiveCategory } from "../lib/effectiveCategory.ts";
import { displayName } from "../../shared/displayName.ts";
import { merchantToken } from "../categorise/helpers.ts";

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
      .object({ search: z.string().optional(), accountId: z.string().optional(), person: z.string().optional(), month: z.string().regex(/^\d{4}-\d{2}$/).optional(), merchant: z.string().optional(), limit: z.coerce.number().max(2000).default(200) })
      .parse(req.query);
    let txns = await db.transaction.findMany({
      where: {
        ...accountScope(q.accountId),
        ...(q.person ? { personKey: q.person === "none" ? null : q.person } : {}),
        ...(q.month ? { bookingDate: { startsWith: q.month } } : {}),
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
      take: q.merchant ? 2000 : q.limit, // merchant filter is by computed token → fetch wide, filter below
      include: { account: true },
    });
    // Filter to a specific merchant by its token (the merchant's stable id).
    if (q.merchant) txns = txns.filter((t) => merchantToken(t.merchantName ?? t.creditorName ?? t.debtorName ?? t.remittanceInfo ?? null) === q.merchant).slice(0, 500);
    // Email orders (Gmail plugin) linked to these transactions → show what was bought.
    const txnIds = txns.map((t) => t.id);
    const orderRows = txnIds.length ? await db.emailOrder.findMany({ where: { transactionId: { in: txnIds } } }) : [];
    const orderByTxn = new Map(orderRows.map((o) => [o.transactionId as string, {
      merchant: o.merchantName,
      total: o.total != null ? Number(o.total.toString()) : null,
      currency: o.currency,
      orderNumber: o.orderNumber,
      date: o.emailDate?.toISOString() ?? null,
      items: Array.isArray(o.items)
        ? (o.items as { name?: string; qty?: number | null; price?: number | null }[]).map((i) => ({
            name: String(i?.name ?? ""),
            qty: typeof i?.qty === "number" ? i.qty : null,
            price: typeof i?.price === "number" ? i.price : null,
          })).filter((i) => i.name)
        : [],
    }]));
    const people = await db.person.findMany();
    const personName = (k: string | null) => people.find((p) => p.key === k)?.name ?? null;
    // Friendly merchant names (Merchant table) override the raw statement line.
    const merchantNames = new Map((await db.merchant.findMany({ where: { NOT: { name: null } } })).map((m) => [m.token, m.name] as const));
    const friendlyName = (t: { merchantName: string | null; creditorName: string | null; debtorName: string | null; remittanceInfo: string | null }) => {
      const raw = t.merchantName ?? t.creditorName ?? t.debtorName ?? null;
      const tok = merchantToken(t.merchantName ?? t.creditorName ?? t.debtorName ?? t.remittanceInfo ?? null);
      return (tok && merchantNames.get(tok)) || raw;
    };
    const dto: TransactionDTO[] = txns.map((t) => ({
      id: t.id,
      accountId: t.accountId,
      accountName: displayName(t.account),
      bookingDate: t.bookingDate,
      amount: t.amount.toString(),
      currency: t.currency,
      name: friendlyName(t),
      remittanceInfo: t.remittanceInfo,
      category: effectiveCategory(t),
      autoCategory: t.category,
      personKey: t.personKey,
      personName: personName(t.personKey),
      note: t.note,
      flag: (t.flag as "red" | "orange" | "yellow" | null) ?? null,
      debtAccountId: t.debtAccountId,
      source: t.account.source,
      status: t.status,
      order: orderByTxn.get(t.id) ?? null,
    }));
    res.json(dto);
  } catch (err) {
    next(err);
  }
});
