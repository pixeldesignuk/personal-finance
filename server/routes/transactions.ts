import { Router } from "express";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { db } from "../lib/db.ts";
import { CATEGORIES } from "../lib/categorize.ts";

export const transactionsRouter = Router();
const isCategory = (c: string) => CATEGORIES.includes(c);

transactionsRouter.post("/transactions", async (req, res, next) => {
  try {
    const body = z
      .object({
        accountId: z.string().min(1),
        date: z.string().min(1),
        amount: z.string().regex(/^-?\d+(\.\d+)?$/, "amount must be a number"),
        category: z.string().refine(isCategory, "unknown category"),
      })
      .parse(req.body);
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
    const { category } = z
      .object({ category: z.string().refine(isCategory, "unknown category") })
      .parse(req.body);
    const tx = await db.transaction.findUnique({ where: { id: req.params.id } });
    if (!tx) {
      res.status(404).json({ error: "Transaction not found" });
      return;
    }
    await db.transaction.update({ where: { id: req.params.id }, data: { categoryOverride: category } });
    res.json({ id: req.params.id, category });
  } catch (err) {
    next(err);
  }
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
