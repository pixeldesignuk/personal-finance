import { Router } from "express";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { db } from "../lib/db.ts";
import { GoCardlessClient } from "../gocardless/client.ts";
import { displayName } from "../../shared/displayName.ts";
import { isCreditCard } from "../../shared/accountKind.ts";
import { currentBalance } from "../lib/balance.ts";
import { manualTxnSums, accountTxnSum } from "../lib/manualBalance.ts";
import { effectiveCategory } from "../lib/effectiveCategory.ts";
import { merchantToken } from "../categorise/helpers.ts";
import { monthOf } from "../lib/budget.ts";
import { classifyMerchant, coefficientOfVariation, median, type RecurType } from "../lib/merchants.ts";
import { rawMerchantName } from "../../shared/merchantName.ts";
import type { AccountDTO, BankDTO, AccountRecurringDTO, AccountHealthDTO } from "../../shared/types.ts";
import { computeFunding, tallyIncomeByAccount } from "../lib/funding.ts";
import { computeAccountHealth, avgMonthlyNetFlow } from "../lib/health/index.ts";

export const accountsRouter = Router();
const gc = new GoCardlessClient();

type AccountWithBalances = {
  id: string; name: string | null; nickname: string | null; iban: string | null;
  currency: string | null; type: "PERSONAL" | "BUSINESS"; source: "BANK" | "MANUAL" | "INVESTMENT";
  manualBalance: { toString(): string } | null;
  excludedBalance: { toString(): string } | null;
  informational: boolean;
  balanceType: string | null;
  cashAccountType: string | null;
  creditCard: boolean | null;
  balances: { type: string; amount: { toString(): string }; currency: string }[];
};

function toAccountDTO(a: AccountWithBalances, txnSum = 0): AccountDTO {
  return {
    id: a.id,
    name: a.name,
    nickname: a.nickname,
    displayName: displayName(a),
    iban: a.iban,
    currency: a.currency,
    type: a.type,
    source: a.source,
    balanceType: a.balanceType,
    currentBalance: currentBalance(
      a.source,
      a.manualBalance != null ? Number(a.manualBalance.toString()) : null,
      a.balances.map((b) => ({ type: b.type, amount: Number(b.amount.toString()) })),
      a.balanceType,
      txnSum,
    ),
    excludedBalance: a.excludedBalance != null ? Number(a.excludedBalance.toString()) : null,
    informational: a.informational,
    isCreditCard: isCreditCard({ creditCard: a.creditCard, cashAccountType: a.cashAccountType }),
    balances: a.balances.map((b) => ({ type: b.type, amount: b.amount.toString(), currency: b.currency })),
  };
}

accountsRouter.get("/accounts", async (_req, res, next) => {
  try {
    const sums = await manualTxnSums(); // cash accounts: balance = baseline + activity
    const reqs = await db.requisition.findMany({
      include: { accounts: { include: { balances: true } } },
      orderBy: { createdAt: "asc" },
    });
    const banks: BankDTO[] = reqs
      // Hide incomplete/abandoned connection attempts: a requisition that never
      // finished linking (status !== "LN") and has no accounts is clutter.
      .filter((r) => r.status === "LN" || r.accounts.length > 0)
      .map((r) => ({
        requisitionId: r.id,
        institutionId: r.institutionId,
        institutionName: r.institutionName,
        institutionLogo: r.institutionLogo ?? null,
        status: r.status,
        accounts: r.accounts.map((a) => toAccountDTO(a as unknown as AccountWithBalances, sums.get(a.id) ?? 0)),
      }));
    const manual = await db.account.findMany({
      where: { source: "MANUAL" },
      include: { balances: true },
      orderBy: { createdAt: "asc" },
    });
    if (manual.length) {
      banks.push({
        requisitionId: "manual",
        institutionId: "manual",
        institutionName: "Manual / Cash",
        institutionLogo: null,
        status: "MANUAL",
        accounts: manual.map((a) => toAccountDTO(a as unknown as AccountWithBalances, sums.get(a.id) ?? 0)),
      });
    }
    for (const [source, label] of [["INVESTMENT", "Investments"], ["ASSET", "Assets"], ["LIABILITY", "Debts"]] as const) {
      const group = await db.account.findMany({ where: { source }, include: { balances: true }, orderBy: { createdAt: "asc" } });
      if (group.length) {
        banks.push({
          requisitionId: source.toLowerCase(),
          institutionId: source.toLowerCase(),
          institutionName: label,
          institutionLogo: null,
          status: source,
          accounts: group.map((a) => toAccountDTO(a as unknown as AccountWithBalances, sums.get(a.id) ?? 0)),
        });
      }
    }
    res.json(banks);
  } catch (err) {
    next(err);
  }
});

// Per-account recurring outgoings: how much you should keep in each account to
// cover its committed (fixed) monthly payments. Merchants link to accounts via
// the account their transactions belong to.
accountsRouter.get("/accounts/recurring", async (_req, res, next) => {
  try {
    const txns = await db.transaction.findMany({
      select: { accountId: true, merchantName: true, creditorName: true, debtorName: true, remittanceInfo: true, amount: true, bookingDate: true, category: true, categoryOverride: true },
    });
    const overrides = new Map((await db.merchant.findMany()).map((m) => [m.token, m]));
    const tokenOf = (t: { merchantName: string | null; creditorName: string | null; debtorName: string | null; remittanceInfo: string | null }) =>
      merchantToken(rawMerchantName(t));

    interface Agg { amounts: number[]; months: Set<string>; names: Map<string, number>; }
    const fresh = (): Agg => ({ amounts: [], months: new Set(), names: new Map() });
    const global = new Map<string, Agg>();                    // token → spend pattern (for classification)
    const perAccount = new Map<string, Map<string, Agg>>();   // accountId → token → spend pattern

    for (const t of txns) {
      const amt = Number(t.amount);
      const eff = effectiveCategory(t);
      if (amt >= 0 || eff === "transfer" || eff === "income") continue; // outgoings only
      const token = tokenOf(t);
      if (!token) continue;
      const name = rawMerchantName(t) ?? token;
      const mo = t.bookingDate ? monthOf(t.bookingDate) : null;

      const g = global.get(token) ?? fresh();
      g.amounts.push(Math.abs(amt));
      if (mo) g.months.add(mo);
      g.names.set(name, (g.names.get(name) ?? 0) + 1);
      global.set(token, g);

      const byToken = perAccount.get(t.accountId) ?? new Map<string, Agg>();
      const a = byToken.get(token) ?? fresh();
      a.amounts.push(Math.abs(amt));
      if (mo) a.months.add(mo);
      a.names.set(name, (a.names.get(name) ?? 0) + 1);
      byToken.set(token, a);
      perAccount.set(t.accountId, byToken);
    }

    const topName = (m: Map<string, number>) => [...m.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? "";
    // Effective recurring type per merchant (auto-detected unless overridden).
    const typeOf = new Map<string, RecurType | "ignore">();
    for (const [token, g] of global) {
      const detected = classifyMerchant(g.months.size, g.amounts.length / Math.max(1, g.months.size), coefficientOfVariation(g.amounts));
      const ov = (overrides.get(token)?.recurring as RecurType | "ignore" | "auto" | undefined) ?? "auto";
      typeOf.set(token, ov === "auto" ? detected : ov);
    }

    const result: AccountRecurringDTO[] = [];
    for (const [accountId, byToken] of perAccount) {
      const items: { name: string; monthly: number }[] = [];
      for (const [token, a] of byToken) {
        if (typeOf.get(token) !== "fixed") continue; // committed monthly payments only
        const monthly = Number(median(a.amounts).toFixed(2));
        if (monthly <= 0) continue;
        items.push({ name: overrides.get(token)?.name ?? topName(a.names), monthly });
      }
      if (!items.length) continue;
      items.sort((x, y) => y.monthly - x.monthly);
      result.push({ accountId, recurringMonthly: Number(items.reduce((s, i) => s + i.monthly, 0).toFixed(2)), items });
    }
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Per-account health: a verdict (green/amber/red) backed by composable checks
// (runway, cashflow, overdraft, trend), each with a reason + recommendation.
// Computation lives in server/lib/health/. Powers the chip ring + health panel.
accountsRouter.get("/accounts/health", async (_req, res, next) => {
  try {
    const today = new Date();
    const sums = await manualTxnSums();
    const rows = await db.account.findMany({ where: { source: { in: ["BANK", "MANUAL"] } }, include: { balances: true } });
    const accounts = rows.map((a) => ({
      id: a.id,
      name: displayName(a),
      informational: a.informational,
      isCreditCard: isCreditCard({ creditCard: a.creditCard, cashAccountType: a.cashAccountType }),
      balance: currentBalance(
        a.source,
        a.manualBalance != null ? Number(a.manualBalance.toString()) : null,
        a.balances.map((b) => ({ type: b.type, amount: Number(b.amount.toString()) })),
        a.balanceType,
        sums.get(a.id) ?? 0,
      ),
    }));

    const scheds = await db.recurringSchedule.findMany({ where: { status: { not: "ignored" } } });
    const fundingSchedules = scheds.map((s) => ({
      accountId: s.accountId,
      direction: s.direction === "in" ? ("in" as const) : ("out" as const),
      amount: Number(s.amount.toString()),
      cadence: s.cadence,
      dayOfMonth: s.dayOfMonth,
      nextDue: s.nextDue,
    }));

    const ym = today.toISOString().slice(0, 7); // matches /upcoming; prod runs UTC
    const credits = (await db.transaction.findMany({
      where: { amount: { gt: 0 }, bookingDate: { startsWith: ym } },
      select: { amount: true, category: true, categoryOverride: true, accountId: true },
    }))
      .filter((t) => effectiveCategory(t) === "income")
      .map((t) => ({ amount: Number(t.amount.toString()), accountId: t.accountId }));
    const income = tallyIncomeByAccount(credits);

    // Trailing 3 complete months of signed flow per account (transfers included).
    const cutoff = new Date(today.getFullYear(), today.getMonth() - 3, 1).toISOString().slice(0, 10);
    const flowTxns = await db.transaction.findMany({
      where: { bookingDate: { gte: cutoff } },
      select: { accountId: true, amount: true, bookingDate: true },
    });
    const byAccount = new Map<string, { amount: number; month: string | null }[]>();
    for (const t of flowTxns) {
      const arr = byAccount.get(t.accountId) ?? [];
      arr.push({ amount: Number(t.amount.toString()), month: monthOf(t.bookingDate) });
      byAccount.set(t.accountId, arr);
    }
    const netFlowByAccount = new Map(accounts.map((a) => [a.id, avgMonthlyNetFlow(byAccount.get(a.id) ?? [], today)]));

    const fundingByAccount = new Map(
      computeFunding(accounts.map((a) => ({ id: a.id, currentBalance: a.balance })), fundingSchedules, income, today)
        .map((f) => [f.accountId, f]),
    );

    const health: AccountHealthDTO[] = computeAccountHealth({
      today, accounts, schedules: fundingSchedules, income, netFlowByAccount, fundingByAccount,
    });
    res.json(health);
  } catch (err) {
    next(err);
  }
});

accountsRouter.post("/accounts/manual", async (req, res, next) => {
  try {
    const body = z
      .object({
        name: z.string().min(1),
        type: z.enum(["PERSONAL", "BUSINESS"]),
        source: z.enum(["MANUAL", "ASSET", "LIABILITY"]).default("MANUAL"),
        currency: z.string().optional(),
        manualBalance: z.string().regex(/^-?\d+(\.\d+)?$/, "manualBalance must be a number").optional(),
        interestRate: z.string().regex(/^\d+(\.\d+)?$/).optional(),
      })
      .parse(req.body);
    const prefix = body.source === "ASSET" ? "asset" : body.source === "LIABILITY" ? "debt" : "manual";
    const account = await db.account.create({
      data: {
        id: `${prefix}-${randomUUID()}`,
        source: body.source,
        type: body.type,
        name: body.name,
        currency: body.currency ?? "GBP",
        manualBalance: body.manualBalance ?? "0",
        interestRate: body.interestRate ?? null,
      },
    });
    res.json({ id: account.id });
  } catch (err) {
    next(err);
  }
});

accountsRouter.patch("/accounts/:id", async (req, res, next) => {
  try {
    const body = z
      .object({
        nickname: z.string().max(60).nullable().optional(),
        type: z.enum(["PERSONAL", "BUSINESS"]).optional(),
        name: z.string().optional(),
        manualBalance: z.string().regex(/^-?\d+(\.\d+)?$/, "manualBalance must be a number").optional(),
        excludedBalance: z.string().regex(/^\d+(\.\d+)?$/, "excludedBalance must be a number").nullable().optional(),
        informational: z.boolean().optional(),
        balanceType: z.string().nullable().optional(),
        interestRate: z.string().regex(/^\d+(\.\d+)?$/).nullable().optional(),
        priority: z.number().int().nullable().optional(),
        targetPayment: z.string().regex(/^\d+(\.\d+)?$/).nullable().optional(),
        debtExcluded: z.boolean().optional(),
        creditCard: z.boolean().nullable().optional(),
      })
      .parse(req.body);
    const account = await db.account.findUnique({ where: { id: req.params.id } });
    if (!account) {
      res.status(404).json({ error: "Account not found" });
      return;
    }
    const MANUALISH = ["MANUAL", "ASSET", "LIABILITY"];
    if (body.manualBalance !== undefined && !MANUALISH.includes(account.source)) {
      res.status(400).json({ error: "manualBalance is only valid for manual/asset/debt accounts" });
      return;
    }
    const data: Record<string, unknown> = {};
    if (body.nickname !== undefined) data.nickname = body.nickname && body.nickname.trim() ? body.nickname.trim() : null;
    if (body.type !== undefined) data.type = body.type;
    if (body.name !== undefined) data.name = body.name;
    if (body.manualBalance !== undefined) {
      // For a cash account the displayed balance is baseline + activity, so when
      // the user sets the balance to X we store the baseline (X − activity) so the
      // figure they typed is exactly what shows.
      if (account.source === "MANUAL") {
        const sum = await accountTxnSum(account.id);
        data.manualBalance = (Number(body.manualBalance) - sum).toFixed(2);
      } else {
        data.manualBalance = body.manualBalance;
      }
    }
    if (body.excludedBalance !== undefined) data.excludedBalance = body.excludedBalance && Number(body.excludedBalance) > 0 ? body.excludedBalance : null;
    if (body.informational !== undefined) data.informational = body.informational;
    if (body.balanceType !== undefined) data.balanceType = body.balanceType || null;
    if (body.interestRate !== undefined) data.interestRate = body.interestRate;
    if (body.priority !== undefined) data.priority = body.priority;
    if (body.targetPayment !== undefined) data.targetPayment = body.targetPayment;
    if (body.debtExcluded !== undefined) data.debtExcluded = body.debtExcluded;
    if (body.creditCard !== undefined) data.creditCard = body.creditCard;
    const updated = await db.account.update({ where: { id: req.params.id }, data });
    res.json({ id: updated.id, displayName: displayName(updated) });
  } catch (err) {
    next(err);
  }
});

accountsRouter.delete("/accounts/:id", async (req, res, next) => {
  try {
    const account = await db.account.findUnique({ where: { id: req.params.id } });
    if (!account) {
      res.status(404).json({ error: "Account not found" });
      return;
    }
    if (!["MANUAL", "ASSET", "LIABILITY"].includes(account.source)) {
      res.status(400).json({ error: "Use DELETE /api/banks/:requisitionId for bank accounts" });
      return;
    }
    await db.syncLog.deleteMany({ where: { accountId: account.id } });
    await db.transaction.deleteMany({ where: { accountId: account.id } });
    await db.balance.deleteMany({ where: { accountId: account.id } });
    await db.holding.deleteMany({ where: { accountId: account.id } });
    await db.transaction.updateMany({ where: { debtAccountId: account.id }, data: { debtAccountId: null } });
    await db.account.delete({ where: { id: account.id } });
    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
});

accountsRouter.delete("/banks/:requisitionId", async (req, res, next) => {
  try {
    const id = req.params.requisitionId;
    const reqn = await db.requisition.findUnique({ where: { id }, include: { accounts: true } });
    if (!reqn) {
      res.status(404).json({ error: "Bank connection not found" });
      return;
    }
    const accountIds = reqn.accounts.map((a) => a.id);
    let remoteDeleted = true;
    try {
      await gc.deleteRequisition(id);
    } catch (e) {
      console.error("GoCardless requisition delete failed", e);
      remoteDeleted = false;
    }
    await db.syncLog.deleteMany({ where: { accountId: { in: accountIds } } });
    await db.transaction.deleteMany({ where: { accountId: { in: accountIds } } });
    await db.balance.deleteMany({ where: { accountId: { in: accountIds } } });
    await db.account.deleteMany({ where: { requisitionId: id } });
    await db.requisition.delete({ where: { id } });
    res.json({ deleted: true, remoteDeleted });
  } catch (err) {
    next(err);
  }
});
