import { db } from "./db.ts";

// Sum of transaction amounts per MANUAL (cash) account. A cash account's current
// balance = the balance you set (its baseline) + this activity, so logged cash
// spends reduce it. Computed rather than mutated so it never drifts and a deleted
// transaction restores the balance automatically.
export async function manualTxnSums(): Promise<Map<string, number>> {
  const manualIds = (await db.account.findMany({ where: { source: "MANUAL" }, select: { id: true } })).map((a) => a.id);
  if (!manualIds.length) return new Map();
  const rows = await db.transaction.groupBy({ by: ["accountId"], where: { accountId: { in: manualIds } }, _sum: { amount: true } });
  return new Map(rows.map((r) => [r.accountId, r._sum.amount != null ? Number(r._sum.amount.toString()) : 0]));
}

// The transaction-activity sum for a single account (0 if none).
export async function accountTxnSum(accountId: string): Promise<number> {
  const r = await db.transaction.aggregate({ where: { accountId }, _sum: { amount: true } });
  return r._sum.amount != null ? Number(r._sum.amount.toString()) : 0;
}
