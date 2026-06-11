import { Router } from "express";
import { z } from "zod";
import { env } from "../env.ts";
import { db } from "../lib/db.ts";
import { GoCardlessClient, GoCardlessError } from "../gocardless/client.ts";
import { syncAccount } from "./sync.ts";

export const connectRouter = Router();
const gc = new GoCardlessClient();

connectRouter.post("/connect", async (req, res, next) => {
  try {
    const { institutionId, maxHistoricalDays } = z
      .object({ institutionId: z.string().min(1), maxHistoricalDays: z.number().int().positive().optional() })
      .parse(req.body);
    const institutions = await gc.getInstitutions("gb");
    const inst = institutions.find((i) => i.id === institutionId);
    const reference = `finance-${institutionId}-${Date.now()}`;
    // Request transaction history: the user's chosen window, or (default) the
    // deepest the bank allows. Always capped at the bank's advertised maximum and
    // GoCardless's 730-day ceiling. An agreement failure shouldn't block linking,
    // so degrade gracefully to the default-window requisition.
    let agreementId: string | undefined;
    try {
      const bankMax = Math.min(730, Number(inst?.transaction_total_days) || 730);
      const maxDays = maxHistoricalDays ? Math.min(maxHistoricalDays, bankMax) : bankMax;
      const agreement = await gc.createAgreement(institutionId, maxDays);
      agreementId = agreement.id;
    } catch (e) {
      console.error("GoCardless agreement creation failed; using default 90-day window", e);
    }
    const requisition = await gc.createRequisition(
      institutionId,
      reference,
      `${env.APP_BASE_URL}/callback`,
      agreementId,
    );
    await db.requisition.create({
      data: {
        id: requisition.id,
        institutionId,
        institutionName: inst?.name ?? institutionId,
        institutionLogo: inst?.logo ?? null,
        reference,
        status: requisition.status,
      },
    });
    res.json({ id: requisition.id, link: requisition.link });
  } catch (err) {
    next(err);
  }
});

connectRouter.get("/connect/by-ref/:ref", async (req, res, next) => {
  try {
    const reqn = await db.requisition.findFirst({ where: { reference: req.params.ref } });
    if (!reqn) { res.status(404).json({ message: "Unknown reference" }); return; }
    res.json({ id: reqn.id });
  } catch (err) { next(err); }
});

connectRouter.post("/connect/:id/finalize", async (req, res, next) => {
  try {
    const id = req.params.id;
    const requisition = await gc.getRequisition(id);
    await db.requisition.update({ where: { id }, data: { status: requisition.status } });
    if (requisition.status !== "LN") {
      res.status(409).json({ status: requisition.status, message: "Bank link not completed yet." });
      return;
    }
    // Track requisitions these accounts previously belonged to, so a reconnect
    // (same bank, new consent) can clean up the now-orphaned old requisition.
    const movedFromReqs = new Set<string>();
    let rateLimited = false;
    for (const accountId of requisition.accounts) {
      const existing = await db.account.findUnique({ where: { id: accountId }, select: { requisitionId: true } });
      if (existing?.requisitionId && existing.requisitionId !== id) movedFromReqs.add(existing.requisitionId);
      const details = await gc.getAccountDetails(accountId);
      await db.account.upsert({
        where: { id: accountId },
        create: {
          id: accountId,
          requisitionId: id,
          iban: details.account?.iban,
          name: details.account?.name,
          currency: details.account?.currency,
          ownerName: details.account?.ownerName,
        },
        update: {
          requisitionId: id, // move the account onto the freshest consent
          iban: details.account?.iban,
          name: details.account?.name,
          currency: details.account?.currency,
          ownerName: details.account?.ownerName,
        },
      });
      // Reconnect intent is "give me more history", so always pull the full
      // window. If the bank's daily fetch limit (PSD2: ~4/day) is already spent,
      // don't fail the whole link — the account is connected, and because no
      // successful sync is recorded yet, the next sync still pulls full history.
      try {
        await syncAccount(accountId, undefined, { fullHistory: true });
      } catch (e) {
        if (e instanceof GoCardlessError && e.status === 429) { rateLimited = true; }
        else throw e;
      }
    }
    // Remove old requisitions left with no accounts after a reconnect, so the
    // bank doesn't appear twice on the accounts screen.
    for (const oldReq of movedFromReqs) {
      if ((await db.account.count({ where: { requisitionId: oldReq } })) > 0) continue;
      try { await gc.deleteRequisition(oldReq); } catch (e) { console.error("Old requisition delete (GoCardless) failed", e); }
      await db.requisition.delete({ where: { id: oldReq } }).catch(() => {});
    }
    res.json({ accounts: requisition.accounts.length, rateLimited });
  } catch (err) {
    next(err);
  }
});
