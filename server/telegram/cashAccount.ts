import { randomUUID } from "node:crypto";
import { db } from "../lib/db.ts";

// The account that cash transactions (Telegram receipts / logged expenses) land
// in. Reuse the user's existing cash account rather than making a duplicate:
// prefer one literally named "Cash", otherwise the oldest manual account (their
// primary cash/wallet account). Only create a fresh "Cash" account if the user
// has no manual account at all.
export async function getOrCreateCashAccount(): Promise<string> {
  const existing =
    (await db.account.findFirst({ where: { source: "MANUAL", name: "Cash" } })) ??
    (await db.account.findFirst({ where: { source: "MANUAL" }, orderBy: { createdAt: "asc" } }));
  if (existing) return existing.id;
  const created = await db.account.create({
    data: { id: `manual-${randomUUID()}`, source: "MANUAL", type: "PERSONAL", name: "Cash", currency: "GBP", manualBalance: "0" },
  });
  return created.id;
}
