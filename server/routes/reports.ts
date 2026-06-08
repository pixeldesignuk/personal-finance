import { Router } from "express";
import { z } from "zod";
import { db } from "../lib/db.ts";
import { effectiveCategory } from "../lib/effectiveCategory.ts";
import { currentMonth, cashFlow, type BudgetTx } from "../lib/budget.ts";
import { spendingMatrix, type ReportTxn } from "../lib/reports.ts";
import type { ReportDTO, ReportRowDTO } from "../../shared/types.ts";

export const reportsRouter = Router();

reportsRouter.get("/reports", async (req, res, next) => {
  try {
    const q = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/).optional() }).parse(req.query);
    const month = q.month ?? currentMonth();

    const personal = await db.account.findMany({ where: { type: "PERSONAL" }, select: { id: true } });
    const ids = personal.map((a) => a.id);
    const txns = await db.transaction.findMany({ where: { accountId: { in: ids } } });
    const eff = txns.map((t) => ({ amount: Number(t.amount), category: effectiveCategory(t), personKey: t.personKey, bookingDate: t.bookingDate }));

    const matrix = spendingMatrix(eff as ReportTxn[], month);
    const cf = cashFlow(eff.map((t) => ({ amount: t.amount, category: t.category, bookingDate: t.bookingDate } as BudgetTx)), month);

    const [cats, people] = await Promise.all([db.category.findMany(), db.person.findMany()]);
    const keyToName = new Map(cats.map((c) => [c.key, c.name]));
    const rows: ReportRowDTO[] = matrix.rows.map((r) => ({
      categoryKey: r.categoryKey,
      name: keyToName.get(r.categoryKey) ?? r.categoryKey,
      total: r.total,
      byPerson: r.byPerson,
    }));

    const dto: ReportDTO = {
      month,
      summary: cf,
      rows,
      personTotals: matrix.personTotals,
      grandTotal: matrix.grandTotal,
      people: people.map((p) => ({ key: p.key, name: p.name })),
    };
    res.json(dto);
  } catch (err) { next(err); }
});
