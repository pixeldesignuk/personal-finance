import { Router } from "express";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { db } from "../lib/db.ts";

export const transactionsRouter = Router();

const RESERVED = new Set(["income", "transfer"]);
async function categoryExists(key: string): Promise<boolean> {
  if (RESERVED.has(key)) return true;
  return !!(await db.category.findFirst({ where: { key } }));
}
async function personExists(key: string): Promise<boolean> {
  return !!(await db.person.findFirst({ where: { key } }));
}

transactionsRouter.post("/transactions", async (req, res, next) => {
  try {
    const body = z
      .object({
        accountId: z.string().min(1),
        date: z.string().min(1),
        amount: z.string().regex(/^-?\d+(\.\d+)?$/, "amount must be a number"),
        category: z.string().min(1),
        note: z.string().optional(),
      })
      .parse(req.body);
    if (!(await categoryExists(body.category))) {
      res.status(400).json({ error: "Unknown category" });
      return;
    }
    const account = await db.account.findUnique({ where: { id: body.accountId } });
    if (!account) {
      res.status(404).json({ error: "Account not found" });
      return;
    }
    if (account.source !== "MANUAL") {
      res.status(400).json({ error: "Manual transactions can only be added to manual accounts" });
      return;
    }
    const tx = await db.transaction.create({
      data: {
        id: `manual-${randomUUID()}`,
        accountId: body.accountId,
        bookingDate: body.date,
        amount: body.amount,
        currency: account.currency ?? "GBP",
        category: body.category,
        remittanceInfo: body.note ?? null,
        status: "booked",
        raw: { manual: true },
      },
    });
    res.json({ id: tx.id });
  } catch (err) {
    next(err);
  }
});

transactionsRouter.patch("/transactions/:id", async (req, res, next) => {
  try {
    const b = z.object({
      category: z.string().min(1).optional(),
      personKey: z.string().nullable().optional(),
    }).parse(req.body);
    const tx = await db.transaction.findUnique({ where: { id: req.params.id } });
    if (!tx) { res.status(404).json({ error: "Transaction not found" }); return; }
    if (b.category !== undefined && !(await categoryExists(b.category))) { res.status(400).json({ error: "Unknown category" }); return; }
    if (b.personKey != null && !(await personExists(b.personKey))) { res.status(400).json({ error: "Unknown person" }); return; }
    const data: { categoryOverride?: string; personKey?: string | null } = {};
    if (b.category !== undefined) data.categoryOverride = b.category;
    if (b.personKey !== undefined) data.personKey = b.personKey;
    await db.transaction.update({ where: { id: req.params.id }, data });
    res.json({ id: req.params.id });
  } catch (err) { next(err); }
});

transactionsRouter.delete("/transactions/:id", async (req, res, next) => {
  try {
    const tx = await db.transaction.findUnique({ where: { id: req.params.id }, include: { account: true } });
    if (!tx) {
      res.status(404).json({ error: "Transaction not found" });
      return;
    }
    if (tx.account.source !== "MANUAL") {
      res.status(400).json({ error: "Only manual transactions can be deleted" });
      return;
    }
    await db.transaction.delete({ where: { id: req.params.id } });
    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
});
