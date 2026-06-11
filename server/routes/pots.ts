import { Router } from "express";
import { z } from "zod";
import { db } from "../lib/db.ts";
import { currentBalance, excludedBalance } from "../lib/balance.ts";
import { manualTxnSums } from "../lib/manualBalance.ts";
import type { PotDTO, PotsDTO } from "../../shared/types.ts";

export const potsRouter = Router();

const dec = (v: { toString(): string } | null | undefined): number | null =>
  v == null ? null : Number(v.toString());

// Liquid cash you actually hold (current accounts + cash). Pots earmark this.
async function liquidCash(): Promise<number> {
  const accounts = await db.account.findMany({
    where: { source: { in: ["BANK", "MANUAL"] }, informational: false },
    include: { balances: true },
  });
  const sums = await manualTxnSums();
  let total = 0;
  for (const a of accounts) {
    total += currentBalance(
      a.source,
      a.manualBalance != null ? Number(a.manualBalance.toString()) : null,
      a.balances.map((b) => ({ type: b.type, amount: Number(b.amount.toString()) })),
      a.balanceType,
      sums.get(a.id) ?? 0,
    ) - excludedBalance(a.excludedBalance);
  }
  return total;
}

const toDTO = (p: { id: number; name: string; target: unknown; balance: unknown; emoji: string | null; note: string | null; sortOrder: number }): PotDTO => ({
  id: p.id,
  name: p.name,
  target: dec(p.target as { toString(): string } | null),
  balance: dec(p.balance as { toString(): string }) ?? 0,
  emoji: p.emoji,
  note: p.note,
  sortOrder: p.sortOrder,
});

potsRouter.get("/pots", async (_req, res, next) => {
  try {
    const rows = await db.pot.findMany({ where: { archived: false }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }] });
    const pots = rows.map(toDTO);
    const liquid = Number((await liquidCash()).toFixed(2));
    const allocated = Number(pots.reduce((s, p) => s + p.balance, 0).toFixed(2));
    // Cash already earmarked for monthly spending — pots can only claim what's left.
    const cats = await db.category.findMany({ where: { archived: false, key: { not: "uncategorised" } }, select: { monthlyAmount: true } });
    const budgeted = Number(cats.reduce((s, c) => s + Number(c.monthlyAmount.toString()), 0).toFixed(2));
    const dto: PotsDTO = {
      pots, liquid, allocated, budgeted,
      available: Number((liquid - budgeted - allocated).toFixed(2)),
      unallocated: Number((liquid - allocated).toFixed(2)),
    };
    res.json(dto);
  } catch (err) { next(err); }
});

potsRouter.post("/pots", async (req, res, next) => {
  try {
    const b = z.object({
      name: z.string().min(1),
      target: z.number().nonnegative().nullable().optional(),
      balance: z.number().nonnegative().optional(),
      emoji: z.string().max(8).nullable().optional(),
      note: z.string().max(280).nullable().optional(),
    }).parse(req.body);
    const max = await db.pot.aggregate({ _max: { sortOrder: true } });
    const pot = await db.pot.create({
      data: {
        name: b.name.trim(),
        target: b.target ?? null,
        balance: b.balance ?? 0,
        emoji: b.emoji ?? null,
        note: b.note ?? null,
        sortOrder: (max._max.sortOrder ?? 0) + 1,
      },
    });
    res.json({ id: pot.id });
  } catch (err) { next(err); }
});

potsRouter.patch("/pots/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const b = z.object({
      name: z.string().min(1).optional(),
      target: z.number().nonnegative().nullable().optional(),
      balance: z.number().nonnegative().optional(),
      emoji: z.string().max(8).nullable().optional(),
      note: z.string().max(280).nullable().optional(),
      sortOrder: z.number().int().optional(),
      archived: z.boolean().optional(),
    }).parse(req.body);
    const data: Record<string, unknown> = {};
    if (b.name !== undefined) data.name = b.name.trim();
    if (b.target !== undefined) data.target = b.target;
    if (b.balance !== undefined) data.balance = b.balance;
    if (b.emoji !== undefined) data.emoji = b.emoji;
    if (b.note !== undefined) data.note = b.note;
    if (b.sortOrder !== undefined) data.sortOrder = b.sortOrder;
    if (b.archived !== undefined) data.archived = b.archived;
    await db.pot.update({ where: { id }, data });
    res.json({ id });
  } catch (err) { next(err); }
});

// Move money into (+) or out of (−) a pot. Clamps the balance at zero.
potsRouter.post("/pots/:id/move", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { amount } = z.object({ amount: z.number() }).parse(req.body);
    const pot = await db.pot.findUnique({ where: { id } });
    if (!pot) { res.status(404).json({ error: "Pot not found" }); return; }
    const next = Math.max(0, Number(pot.balance.toString()) + amount);
    await db.pot.update({ where: { id }, data: { balance: next } });
    res.json({ id, balance: Number(next.toFixed(2)) });
  } catch (err) { next(err); }
});

potsRouter.delete("/pots/:id", async (req, res, next) => {
  try {
    await db.pot.delete({ where: { id: Number(req.params.id) } });
    res.json({ deleted: true });
  } catch (err) { next(err); }
});
