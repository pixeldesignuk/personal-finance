import { Router } from "express";
import { db } from "../lib/db.ts";
import { GoCardlessClient, GoCardlessError } from "../gocardless/client.ts";
import { applyRules, type Rule } from "../lib/rules.ts";
import { reconcile } from "../categorise/reconcile.ts";
import type { SyncResult } from "../../shared/types.ts";

export const syncRouter = Router();
const gc = new GoCardlessClient();

const SYNC_COOLDOWN_MS = 6 * 60 * 60 * 1000;

export async function syncAccount(accountId: string): Promise<SyncResult> {
  // Manual/cash accounts aren't backed by GoCardless — nothing to fetch.
  const account = await db.account.findUnique({ where: { id: accountId } });
  if (!account || account.source !== "BANK") {
    return { accountId, added: 0, skipped: true, message: "Manual account — nothing to sync." };
  }

  const last = await db.syncLog.findFirst({
    where: { accountId, status: "ok" },
    orderBy: { ranAt: "desc" },
  });
  if (last && Date.now() - last.ranAt.getTime() < SYNC_COOLDOWN_MS) {
    return { accountId, added: 0, skipped: true, message: "Synced recently; try later (rate limit)." };
  }

  const balances = await gc.getBalances(accountId);
  for (const b of balances.balances) {
    await db.balance.upsert({
      where: { accountId_type: { accountId, type: b.balanceType } },
      create: {
        accountId,
        type: b.balanceType,
        amount: b.balanceAmount.amount,
        currency: b.balanceAmount.currency,
        referenceDate: b.referenceDate,
      },
      update: {
        amount: b.balanceAmount.amount,
        currency: b.balanceAmount.currency,
        referenceDate: b.referenceDate,
        fetchedAt: new Date(),
      },
    });
  }

  const txns = await gc.getTransactions(accountId);
  const booked = txns.transactions.booked ?? [];
  const pending = txns.transactions.pending ?? [];
  const rows = [
    ...booked.map((t) => ({ t, status: "booked" })),
    ...pending.map((t) => ({ t, status: "pending" })),
  ];
  await db.transaction.deleteMany({ where: { accountId, status: "pending" } });
  const ruleRows = await db.rule.findMany();
  const rules: Rule[] = ruleRows.map((r) => ({ matchText: r.matchText, categoryKey: r.categoryKey, personKey: r.personKey, priority: r.priority }));
  let added = 0;
  for (const { t, status } of rows) {
    const id = t.transactionId ?? t.internalTransactionId;
    if (!id) continue;
    const amount = Number(t.transactionAmount.amount);
    const text = [t.merchantName, t.creditorName, t.debtorName, t.remittanceInformationUnstructured].filter(Boolean).join(" ");
    const ruled = applyRules(text, rules);
    const category = ruled.categoryKey ?? (amount > 0 ? "income" : "uncategorised");
    await db.transaction.upsert({
      where: { id },
      create: {
        id,
        accountId,
        bookingDate: t.bookingDate,
        valueDate: t.valueDate,
        amount: t.transactionAmount.amount,
        currency: t.transactionAmount.currency,
        creditorName: t.creditorName,
        debtorName: t.debtorName,
        remittanceInfo: t.remittanceInformationUnstructured,
        merchantName: t.merchantName,
        category,
        personKey: ruled.personKey ?? null,
        status,
        raw: t as object,
      },
      update: { category, status },
    });
    added += 1; // counts processed rows (not strictly new)
  }

  await db.syncLog.create({ data: { accountId, added, status: "ok" } });
  // Auto-categorise anything the inline rules didn't catch (Gemini Flash).
  // Never let categorisation failure fail the sync itself.
  try {
    await reconcile({ accountId });
  } catch (err) {
    console.error("reconcile after sync failed:", err instanceof Error ? err.message : err);
  }
  return { accountId, added, skipped: false };
}

syncRouter.post("/sync", async (_req, res, next) => {
  try {
    const accounts = await db.account.findMany({ where: { source: "BANK" } });
    const results: SyncResult[] = [];
    for (const a of accounts) {
      try {
        results.push(await syncAccount(a.id));
      } catch (err) {
        if (err instanceof GoCardlessError && err.status === 429) {
          results.push({
            accountId: a.id,
            added: 0,
            skipped: true,
            message: `Rate limited. Retry after: ${err.retryAfter ?? "unknown"}.`,
          });
          continue;
        }
        throw err;
      }
    }
    res.json(results);
  } catch (err) {
    next(err);
  }
});
