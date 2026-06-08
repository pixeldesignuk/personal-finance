import { Router } from "express";
import { z } from "zod";
import { db } from "../lib/db.ts";
import { effectiveCategory } from "../lib/effectiveCategory.ts";
import { currentMonth } from "../lib/budget.ts";
import { computeEnvelopes, type EnvCategory, type EnvTx, type EnvTransfer } from "../lib/envelope.ts";
import type { EnvelopeGroupDTO } from "../../shared/types.ts";

export const envelopesRouter = Router();

async function startMonth(): Promise<string> {
  const s = await db.setting.findUnique({ where: { key: "budgetStartMonth" } });
  return s?.value ?? currentMonth();
}

envelopesRouter.get("/envelopes", async (req, res, next) => {
  try {
    const asOf = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/).optional() }).parse(req.query).month ?? currentMonth();
    const start = await startMonth();

    const groups = await db.categoryGroup.findMany({
      include: { categories: { where: { archived: false }, orderBy: { sortOrder: "asc" } } },
      orderBy: { sortOrder: "asc" },
    });
    const allocations = await db.allocation.findMany();
    const overrides: Record<string, number> = {};
    // map categoryId -> name for override keys
    const idToName = new Map<number, string>();
    groups.forEach((g) => g.categories.forEach((c) => idToName.set(c.id, c.name)));
    for (const a of allocations) {
      const name = idToName.get(a.categoryId);
      if (name) overrides[`${name}|${a.month}`] = Number(a.amount.toString());
    }
    const transferRows = await db.categoryTransfer.findMany({ where: { month: { lte: asOf } } });
    const transfers: EnvTransfer[] = transferRows.map((t) => ({ fromName: t.fromName, toName: t.toName, amount: Number(t.amount.toString()) }));

    const personal = await db.account.findMany({ where: { type: "PERSONAL" }, select: { id: true } });
    const ids = personal.map((a) => a.id);
    const txns = await db.transaction.findMany({ where: { accountId: { in: ids } } });
    const envTxns: EnvTx[] = txns.map((t) => ({ amount: Number(t.amount), category: effectiveCategory(t), bookingDate: t.bookingDate }));

    const dto: EnvelopeGroupDTO[] = groups.map((g) => {
      const cats: EnvCategory[] = g.categories.map((c) => ({
        name: c.name,
        monthlyAmount: Number(c.monthlyAmount.toString()),
        goal: c.goal != null ? Number(c.goal.toString()) : null,
      }));
      return { id: g.id, name: g.name, rows: computeEnvelopes(cats, overrides, transfers, envTxns, start, asOf) };
    });
    res.json(dto);
  } catch (err) { next(err); }
});

envelopesRouter.put("/allocations/:categoryId/:month", async (req, res, next) => {
  try {
    const categoryId = Number(req.params.categoryId);
    const month = req.params.month;
    if (!/^\d{4}-\d{2}$/.test(month)) { res.status(400).json({ error: "month must be YYYY-MM" }); return; }
    const { amount } = z.object({ amount: z.number().min(0) }).parse(req.body);
    await db.allocation.upsert({
      where: { categoryId_month: { categoryId, month } },
      create: { categoryId, month, amount },
      update: { amount },
    });
    res.json({ categoryId, month, amount });
  } catch (err) { next(err); }
});

envelopesRouter.post("/category-transfers", async (req, res, next) => {
  try {
    const b = z.object({
      fromName: z.string().min(1),
      toName: z.string().min(1),
      month: z.string().regex(/^\d{4}-\d{2}$/),
      amount: z.number().min(0),
      note: z.string().optional(),
    }).parse(req.body);
    const [from, to] = await Promise.all([
      db.category.findFirst({ where: { name: b.fromName } }),
      db.category.findFirst({ where: { name: b.toName } }),
    ]);
    if (!from || !to) {
      res.status(400).json({ error: "Both from and to must be existing categories" });
      return;
    }
    await db.categoryTransfer.create({ data: { ...b, note: b.note ?? null } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});
