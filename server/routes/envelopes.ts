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
    const query = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/).optional(), person: z.string().optional() }).parse(req.query);
    const asOf = query.month ?? currentMonth();
    const person = query.person;
    const start = await startMonth();

    const groups = await db.categoryGroup.findMany({
      include: { categories: { where: { archived: false }, orderBy: { sortOrder: "asc" } } },
      orderBy: { sortOrder: "asc" },
    });
    const allocations = await db.allocation.findMany();
    const overrides: Record<string, number> = {};
    // map categoryId -> key for override keys
    const idToKey = new Map<number, string>();
    groups.forEach((g) => g.categories.forEach((c) => idToKey.set(c.id, c.key)));
    for (const a of allocations) {
      const key = idToKey.get(a.categoryId);
      if (key) overrides[`${key}|${a.month}`] = Number(a.amount.toString());
    }
    const transferRows = await db.categoryTransfer.findMany({ where: { month: { lte: asOf } } });
    const transfers: EnvTransfer[] = transferRows.map((t) => ({ fromKey: t.fromKey, toKey: t.toKey, amount: Number(t.amount.toString()) }));

    const personal = await db.account.findMany({ where: { type: "PERSONAL" }, select: { id: true } });
    const ids = personal.map((a) => a.id);
    const txns = await db.transaction.findMany({ where: { accountId: { in: ids } } });
    const filtered = person ? txns.filter((t) => (person === "none" ? t.personKey == null : t.personKey === person)) : txns;
    const envTxns: EnvTx[] = filtered.map((t) => ({ amount: Number(t.amount), category: effectiveCategory(t), bookingDate: t.bookingDate }));

    const dto: EnvelopeGroupDTO[] = groups.map((g) => {
      const cats: EnvCategory[] = g.categories.map((c) => ({
        key: c.key,
        monthlyAmount: Number(c.monthlyAmount.toString()),
        goal: c.goal != null ? Number(c.goal.toString()) : null,
      }));
      const keyToName = new Map(g.categories.map((c) => [c.key, c.name]));
      return { id: g.id, name: g.name, rows: computeEnvelopes(cats, overrides, transfers, envTxns, start, asOf).map((r) => ({ ...r, name: keyToName.get(r.key) ?? r.key })) };
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
      fromKey: z.string().min(1),
      toKey: z.string().min(1),
      month: z.string().regex(/^\d{4}-\d{2}$/),
      amount: z.number().min(0),
      note: z.string().optional(),
    }).parse(req.body);
    const [from, to] = await Promise.all([
      db.category.findFirst({ where: { key: b.fromKey } }),
      db.category.findFirst({ where: { key: b.toKey } }),
    ]);
    if (!from || !to) {
      res.status(400).json({ error: "Both from and to must be existing categories" });
      return;
    }
    await db.categoryTransfer.create({ data: { ...b, note: b.note ?? null } });
    res.json({ ok: true });
  } catch (err) { next(err); }
});
