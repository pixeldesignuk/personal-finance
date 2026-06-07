import { Router } from "express";
import { z } from "zod";
import { db } from "../lib/db.ts";
import { GoCardlessClient } from "../gocardless/client.ts";
import { displayName } from "../../shared/displayName.ts";
import type { BankDTO } from "../../shared/types.ts";

export const accountsRouter = Router();
const gc = new GoCardlessClient();

accountsRouter.get("/accounts", async (_req, res, next) => {
  try {
    const reqs = await db.requisition.findMany({
      include: { accounts: { include: { balances: true } } },
      orderBy: { createdAt: "asc" },
    });
    const banks: BankDTO[] = reqs.map((r) => ({
      requisitionId: r.id,
      institutionId: r.institutionId,
      institutionName: r.institutionName,
      status: r.status,
      accounts: r.accounts.map((a) => ({
        id: a.id,
        name: a.name,
        nickname: a.nickname,
        displayName: displayName(a),
        iban: a.iban,
        currency: a.currency,
        balances: a.balances.map((b) => ({
          type: b.type,
          amount: b.amount.toString(),
          currency: b.currency,
        })),
      })),
    }));
    res.json(banks);
  } catch (err) {
    next(err);
  }
});

accountsRouter.patch("/accounts/:id", async (req, res, next) => {
  try {
    const { nickname } = z
      .object({ nickname: z.string().max(60).nullable() })
      .parse(req.body);
    const existing = await db.account.findUnique({ where: { id: req.params.id } });
    if (!existing) {
      res.status(404).json({ error: "Account not found" });
      return;
    }
    const updated = await db.account.update({
      where: { id: req.params.id },
      data: { nickname: nickname && nickname.trim() ? nickname.trim() : null },
    });
    res.json({ id: updated.id, displayName: displayName(updated) });
  } catch (err) {
    next(err);
  }
});

accountsRouter.delete("/banks/:requisitionId", async (req, res, next) => {
  try {
    const id = req.params.requisitionId;
    const reqn = await db.requisition.findUnique({
      where: { id },
      include: { accounts: true },
    });
    if (!reqn) {
      res.status(404).json({ error: "Bank connection not found" });
      return;
    }
    const accountIds = reqn.accounts.map((a) => a.id);

    let remoteDeleted = true;
    try {
      await gc.deleteRequisition(id);
    } catch {
      remoteDeleted = false;
    }

    // Cascade local delete in FK-safe order.
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
