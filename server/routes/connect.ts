import { Router } from "express";
import { z } from "zod";
import { env } from "../env.ts";
import { db } from "../lib/db.ts";
import { GoCardlessClient } from "../gocardless/client.ts";
import { syncAccount } from "./sync.ts";

export const connectRouter = Router();
const gc = new GoCardlessClient();

connectRouter.post("/connect", async (req, res, next) => {
  try {
    const { institutionId } = z.object({ institutionId: z.string().min(1) }).parse(req.body);
    const institutions = await gc.getInstitutions("gb");
    const inst = institutions.find((i) => i.id === institutionId);
    const reference = `finance-${institutionId}-${Date.now()}`;
    // Request the deepest history the bank will give (default is only 90 days).
    // Cap at GoCardless's 730-day ceiling; fall back to 730 if the bank doesn't
    // advertise a limit. An agreement failure shouldn't block linking, so degrade
    // gracefully to the default-window requisition.
    let agreementId: string | undefined;
    try {
      const maxDays = Math.min(730, Number(inst?.transaction_total_days) || 730);
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
    for (const accountId of requisition.accounts) {
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
          iban: details.account?.iban,
          name: details.account?.name,
          currency: details.account?.currency,
          ownerName: details.account?.ownerName,
        },
      });
      await syncAccount(accountId);
    }
    res.json({ accounts: requisition.accounts.length });
  } catch (err) {
    next(err);
  }
});
