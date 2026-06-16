import { Router } from "express";
import { z } from "zod";
import { env } from "../env.ts";
import { db } from "../lib/db.ts";
import { GoCardlessClient, GoCardlessError, isAccountProcessing } from "../gocardless/client.ts";
import { syncAccount } from "./sync.ts";
import { recordSyncRun } from "../lib/syncRun.ts";
import type { AuditFn } from "../categorise/audit.ts";

export const connectRouter = Router();
const gc = new GoCardlessClient();

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// After linking, GoCardless pulls the account from the bank (PROCESSING) before
// details/balances/transactions are available (READY). Poll the account-status
// endpoint, surfacing progress, until it's READY or a budget/terminal state is
// reached. Returns the final status. Up to ~20 × 3s ≈ 1min — fine inside a
// streamed response; callers that must stay fast should not use this.
async function waitForAccountReady(accountId: string, audit: AuditFn, tries = 20, delayMs = 3000): Promise<string> {
  let status = "PROCESSING";
  for (let i = 0; i < tries; i++) {
    try {
      status = (await gc.getAccount(accountId)).status;
    } catch (e) {
      // Some banks 409 the metadata endpoint too while processing; keep waiting.
      if (!isAccountProcessing(e)) throw e;
      status = "PROCESSING";
    }
    if (status === "READY") return status;
    if (["ERROR", "EXPIRED", "SUSPENDED"].includes(status)) return status;
    if (i === 0) audit({ kind: "log", text: "  waiting for the bank to finish preparing the account…", tone: "dim" });
    await sleep(delayMs);
  }
  return status; // still PROCESSING after the budget — let the next sync resume
}

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

// Finalize is *link only* and must stay fast: it attaches the accounts to the
// fresh consent and cleans up orphaned requisitions, then returns immediately.
// The actual transaction import — which for a reconnect pulls up to 730 days and
// can take minutes — is NOT done here. Doing it inline used to overrun the
// proxy/edge request timeout and surface as a 502 even though work continued
// server-side. The client streams the import via `/connect/:id/sync/stream`.
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
    for (const accountId of requisition.accounts) {
      const existing = await db.account.findUnique({ where: { id: accountId }, select: { requisitionId: true } });
      if (existing?.requisitionId && existing.requisitionId !== id) movedFromReqs.add(existing.requisitionId);
      // A just-linked account is usually still PROCESSING, so details 409. Don't
      // block finalize on it — create the row now; the streamed import refreshes
      // name/iban/currency once the account reaches READY.
      let details;
      try {
        details = await gc.getAccountDetails(accountId);
      } catch (e) {
        if (!isAccountProcessing(e)) throw e;
      }
      await db.account.upsert({
        where: { id: accountId },
        create: {
          id: accountId,
          requisitionId: id,
          iban: details?.account?.iban,
          name: details?.account?.name,
          currency: details?.account?.currency,
          ownerName: details?.account?.ownerName,
          cashAccountType: details?.account?.cashAccountType,
        },
        update: {
          requisitionId: id, // move the account onto the freshest consent
          iban: details?.account?.iban,
          name: details?.account?.name,
          currency: details?.account?.currency,
          ownerName: details?.account?.ownerName,
          cashAccountType: details?.account?.cashAccountType,
        },
      });
    }
    // Remove old requisitions left with no accounts after a reconnect, so the
    // bank doesn't appear twice on the accounts screen.
    for (const oldReq of movedFromReqs) {
      if ((await db.account.count({ where: { requisitionId: oldReq } })) > 0) continue;
      try { await gc.deleteRequisition(oldReq); } catch (e) { console.error("Old requisition delete (GoCardless) failed", e); }
      await db.requisition.delete({ where: { id: oldReq } }).catch(() => {});
    }
    res.json({ accounts: requisition.accounts.length, accountIds: requisition.accounts });
  } catch (err) {
    next(err);
  }
});

// Stream the full-history import for a just-linked requisition. Reconnect intent
// is "give me more history", so each account is pulled with `fullHistory: true`.
// NDJSON keeps the connection alive with incremental writes, so the long pull
// never trips a proxy/edge timeout (the failure mode that produced 502s when the
// import ran inside finalize). A spent daily fetch limit (PSD2 ~4/day) degrades
// gracefully — the account stays linked and the next sync resumes the history.
connectRouter.post("/connect/:id/sync/stream", async (req, res) => {
  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();
  const stream: AuditFn = (e) => res.write(`${JSON.stringify(e)}\n`);
  try {
    await recordSyncRun("bank", stream, async (audit) => {
      const id = req.params.id;
      const requisition = await gc.getRequisition(id);
      let totalNew = 0;
      let rateLimited = false;
      let processing = false;
      for (const accountId of requisition.accounts) {
        // Don't fetch until the bank has finished preparing the account, else
        // details/balances/transactions 409 ("AccountProcessing").
        const status = await waitForAccountReady(accountId, audit);
        if (status !== "READY") {
          processing = status === "PROCESSING";
          audit({
            kind: "log",
            text: processing
              ? "  still preparing at the bank — history fills in on the next sync"
              : `  account ${status.toLowerCase()} — skipped`,
            tone: "yellow",
          });
          continue;
        }
        // Details are available now; backfill any the (fast) finalize couldn't get.
        try {
          const d = (await gc.getAccountDetails(accountId)).account;
          await db.account.update({
            where: { id: accountId },
            data: { iban: d?.iban, name: d?.name, currency: d?.currency, ownerName: d?.ownerName, cashAccountType: d?.cashAccountType },
          });
        } catch (e) {
          if (!isAccountProcessing(e)) audit({ kind: "log", text: `  details: ${e instanceof Error ? e.message : String(e)}`, tone: "dim" });
        }
        try {
          const r = await syncAccount(accountId, audit, { fullHistory: true });
          totalNew += r.newCount ?? 0;
        } catch (err) {
          if (err instanceof GoCardlessError && err.status === 429) {
            rateLimited = true;
            audit({ kind: "log", text: `  rate limited (retry after ${err.retryAfter ?? "unknown"}) — history fills in on the next sync`, tone: "red" });
            continue;
          }
          audit({ kind: "log", text: `  ✗ ${err instanceof Error ? err.message : String(err)}`, tone: "red" });
        }
      }
      const incomplete = rateLimited || processing;
      audit({
        kind: "log",
        text: incomplete
          ? `Imported ${totalNew} transaction${totalNew === 1 ? "" : "s"} so far — the rest fills in on the next sync.`
          : `History imported — ${totalNew} transaction${totalNew === 1 ? "" : "s"}.`,
        tone: incomplete ? "yellow" : "green",
      });
      return { accounts: requisition.accounts.length, newTransactions: totalNew, rateLimited, processing };
    });
  } catch {
    // already streamed + recorded
  } finally {
    res.end();
  }
});
