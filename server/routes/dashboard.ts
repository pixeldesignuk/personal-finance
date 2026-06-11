import { Router } from "express";
import { z } from "zod";
import { db } from "../lib/db.ts";
import { spendingByCategory, monthlyTotals, topMerchants, type AggTx } from "../lib/aggregate.ts";
import type { DashboardDTO, TransactionDTO } from "../../shared/types.ts";
import { accountScope } from "../lib/accountScope.ts";
import { effectiveCategory } from "../lib/effectiveCategory.ts";
import { displayName } from "../../shared/displayName.ts";
import { merchantToken } from "../categorise/helpers.ts";
import { rawMerchantName } from "../../shared/merchantName.ts";

export const dashboardRouter = Router();

dashboardRouter.get("/dashboard", async (req, res, next) => {
  try {
    const { accountId, person, month } = z
      .object({ accountId: z.string().optional(), person: z.string().optional(), month: z.string().regex(/^\d{4}-\d{2}$/).optional() })
      .parse(req.query);
    const scope = accountScope(accountId);
    const txns = await db.transaction.findMany({ where: { ...scope, ...(person && person !== "all" ? { personKey: person === "none" ? null : person } : {}) } });
    const agg: AggTx[] = txns
      .map((t) => ({
        amount: Number(t.amount),
        category: effectiveCategory(t),
        merchant: rawMerchantName(t),
        bookingDate: t.bookingDate,
      }))
      .filter((t) => t.category !== "transfer");
    // Category breakdown is scoped to the selected month (the dashboard is a
    // "this month" view); the monthly trend always spans the full history.
    const monthAgg = month ? agg.filter((t) => t.bookingDate?.slice(0, 7) === month) : agg;
    const balances = await db.balance.findMany({ where: scope });
    const dto: DashboardDTO = {
      balances: balances.map((b) => ({
        accountId: b.accountId,
        type: b.type,
        amount: b.amount.toString(),
        currency: b.currency,
      })),
      byCategory: spendingByCategory(monthAgg),
      monthly: monthlyTotals(agg),
      topMerchants: topMerchants(monthAgg, 10),
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
    // Friendly merchant names (Merchant table) override the raw statement line —
    // needed up front so search can match the name the user actually SEES
    // (e.g. "Council Tax") and not just the raw line ("OLDHAM MBC").
    const merchantNames = new Map((await db.merchant.findMany({ where: { NOT: { name: null } } })).map((m) => [m.token, m.name] as const));
    let txns = await db.transaction.findMany({
      where: {
        ...accountScope(q.accountId),
        ...(q.person ? { personKey: q.person === "none" ? null : q.person } : {}),
        ...(q.month ? { bookingDate: { startsWith: q.month } } : {}),
      },
      orderBy: [{ bookingDate: "desc" }, { id: "asc" }],
      // Search and the merchant filter are evaluated in-memory (the friendly name
      // and the merchant token are computed, not columns), so fetch wide for them.
      take: q.search || q.merchant ? 2000 : q.limit,
      include: { account: true },
    });
    // Search across the raw statement fields AND the friendly merchant name.
    if (q.search) {
      const term = q.search.toLowerCase();
      txns = txns.filter((t) => {
        const raw = `${t.merchantName ?? ""} ${t.creditorName ?? ""} ${t.debtorName ?? ""} ${t.remittanceInfo ?? ""}`.toLowerCase();
        if (raw.includes(term)) return true;
        const tok = merchantToken(rawMerchantName(t));
        const friendly = tok ? merchantNames.get(tok) : null;
        return !!friendly && friendly.toLowerCase().includes(term);
      });
    }
    // Filter to a specific merchant by its token (the merchant's stable id).
    if (q.merchant) txns = txns.filter((t) => merchantToken(rawMerchantName(t)) === q.merchant);
    txns = txns.slice(0, q.merchant ? 500 : q.limit);
    // Email orders (Gmail plugin) linked to these transactions → show what was bought.
    const txnIds = txns.map((t) => t.id);
    const orderRows = txnIds.length ? await db.emailOrder.findMany({ where: { transactionId: { in: txnIds } } }) : [];
    const orderByTxn = new Map(orderRows.map((o) => [o.transactionId as string, {
      id: o.id,
      hasAttachment: !!o.attachmentKey,
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
    // How the transaction got here (upload method), derived from its origin marker.
    const txnOrigin = (t: { raw: unknown; account: { source: string } }): TransactionDTO["origin"] => {
      const raw = t.raw as Record<string, unknown> | null;
      if (raw?.telegramReceipt) return "receipt";
      if (raw?.telegram) return "telegram";
      return t.account.source === "BANK" ? "bank" : "manual";
    };
    const friendlyName = (t: { merchantName: string | null; creditorName: string | null; debtorName: string | null; remittanceInfo: string | null }) => {
      const raw = rawMerchantName(t);
      const tok = merchantToken(rawMerchantName(t));
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
      origin: txnOrigin(t),
      status: t.status,
      order: orderByTxn.get(t.id) ?? null,
    }));
    res.json(dto);
  } catch (err) {
    next(err);
  }
});
