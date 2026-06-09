import { Router } from "express";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { db } from "../lib/db.ts";
import { GoCardlessClient } from "../gocardless/client.ts";
import { displayName } from "../../shared/displayName.ts";
import { currentBalance } from "../lib/balance.ts";
import type { AccountDTO, BankDTO } from "../../shared/types.ts";

export const accountsRouter = Router();
const gc = new GoCardlessClient();

type AccountWithBalances = {
  id: string; name: string | null; nickname: string | null; iban: string | null;
  currency: string | null; type: "PERSONAL" | "BUSINESS"; source: "BANK" | "MANUAL" | "INVESTMENT";
  manualBalance: { toString(): string } | null;
  balanceType: string | null;
  balances: { type: string; amount: { toString(): string }; currency: string }[];
};

function toAccountDTO(a: AccountWithBalances): AccountDTO {
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
    ),
    balances: a.balances.map((b) => ({ type: b.type, amount: b.amount.toString(), currency: b.currency })),
  };
}

accountsRouter.get("/accounts", async (_req, res, next) => {
  try {
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
        status: r.status,
        accounts: r.accounts.map((a) => toAccountDTO(a as unknown as AccountWithBalances)),
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
        status: "MANUAL",
        accounts: manual.map((a) => toAccountDTO(a as unknown as AccountWithBalances)),
      });
    }
    for (const [source, label] of [["INVESTMENT", "Investments"], ["ASSET", "Assets"], ["LIABILITY", "Debts"]] as const) {
      const group = await db.account.findMany({ where: { source }, include: { balances: true }, orderBy: { createdAt: "asc" } });
      if (group.length) {
        banks.push({
          requisitionId: source.toLowerCase(),
          institutionId: source.toLowerCase(),
          institutionName: label,
          status: source,
          accounts: group.map((a) => toAccountDTO(a as unknown as AccountWithBalances)),
        });
      }
    }
    res.json(banks);
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
        balanceType: z.string().nullable().optional(),
        interestRate: z.string().regex(/^\d+(\.\d+)?$/).nullable().optional(),
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
    if (body.manualBalance !== undefined) data.manualBalance = body.manualBalance;
    if (body.balanceType !== undefined) data.balanceType = body.balanceType || null;
    if (body.interestRate !== undefined) data.interestRate = body.interestRate;
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
