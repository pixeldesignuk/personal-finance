import { Router } from "express";
import { db } from "../lib/db.ts";
import { monthlyAverage, projectPayoff } from "../lib/debt.ts";
import { monthOf } from "../lib/budget.ts";
import type { DebtsDTO, DebtDTO } from "../../shared/types.ts";

export const debtsRouter = Router();

const dec = (v: { toString(): string } | null | undefined): number => (v == null ? 0 : Number(v.toString()));

debtsRouter.get("/debts", async (_req, res, next) => {
  try {
    const accounts = await db.account.findMany({ where: { source: "LIABILITY" }, orderBy: { createdAt: "asc" } });
    // Repayments are transactions linked to a debt.
    const linked = await db.transaction.findMany({
      where: { debtAccountId: { in: accounts.map((a) => a.id) } },
      select: { id: true, debtAccountId: true, bookingDate: true, amount: true, merchantName: true, creditorName: true, remittanceInfo: true },
      orderBy: { bookingDate: "desc" },
    });

    const debts: DebtDTO[] = accounts.map((a) => {
      const balance = dec(a.manualBalance);
      const rate = a.interestRate != null ? dec(a.interestRate) : null;
      const mine = linked.filter((t) => t.debtAccountId === a.id);
      const payments = mine.map((t) => ({
        id: t.id, date: t.bookingDate, amount: Math.abs(Number(t.amount)),
        name: t.merchantName ?? t.creditorName ?? t.remittanceInfo ?? null,
      }));
      const paidTotal = payments.reduce((s, p) => s + p.amount, 0);
      const months = payments
        .map((p) => ({ month: p.date ? monthOf(p.date) : null, amount: p.amount }))
        .filter((m): m is { month: string; amount: number } => m.month != null);
      const avgMonthly = monthlyAverage(months);
      return {
        id: a.id,
        name: a.nickname ?? a.name ?? "Debt",
        balance,
        interestRate: rate,
        paidTotal: Number(paidTotal.toFixed(2)),
        original: Number((balance + paidTotal).toFixed(2)),
        avgMonthly: Number(avgMonthly.toFixed(2)),
        lastPaymentDate: payments[0]?.date ?? null,
        projectedMonths: projectPayoff(balance, avgMonthly, rate),
        payments,
      };
    });

    const dto: DebtsDTO = {
      debts,
      totalOwed: Number(debts.reduce((s, d) => s + d.balance, 0).toFixed(2)),
      totalPaid: Number(debts.reduce((s, d) => s + d.paidTotal, 0).toFixed(2)),
      monthlyTotal: Number(debts.reduce((s, d) => s + d.avgMonthly, 0).toFixed(2)),
    };
    res.json(dto);
  } catch (err) { next(err); }
});
