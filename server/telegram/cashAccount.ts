import { randomUUID } from "node:crypto";
import { db } from "../lib/db.ts";

export async function getOrCreateCashAccount(): Promise<string> {
  const existing = await db.account.findFirst({ where: { source: "MANUAL", name: "Cash" } });
  if (existing) return existing.id;
  const created = await db.account.create({
    data: { id: `manual-${randomUUID()}`, source: "MANUAL", type: "PERSONAL", name: "Cash", currency: "GBP", manualBalance: "0" },
  });
  return created.id;
}
