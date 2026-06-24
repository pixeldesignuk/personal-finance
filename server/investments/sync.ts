import { randomUUID } from "node:crypto";
import { db } from "../lib/db.ts";
import { getProvider } from "./index.ts";
import { resolveCreds } from "./creds.ts";
import type { InvestmentSnapshot, ProviderCreds } from "./types.ts";
import type { AuditFn } from "../categorise/audit.ts";

export interface ProviderSyncResult {
  provider: string;
  total: number;
  holdings: number;
}

const num = (v: { toString(): string } | null | undefined): number => (v == null ? 0 : Number(v.toString()));

// Replace an account's holdings with a fresh snapshot's positions.
export async function writeHoldings(accountId: string, snap: InvestmentSnapshot): Promise<void> {
  await db.holding.deleteMany({ where: { accountId } });
  if (snap.holdings.length) {
    await db.holding.createMany({
      data: snap.holdings.map((h) => ({
        accountId, symbol: h.symbol, name: h.name ?? null, quantity: h.quantity,
        price: h.price, value: h.value, cost: h.cost ?? null, pnl: h.pnl ?? null, currency: h.currency ?? null,
      })),
    });
  }
}

// Fetch a provider snapshot for an investment account (creds = its stored config
// or legacy env) and write the total + holdings back. The account must exist.
export async function refreshInvestmentAccount(
  account: { id: string; provider: string | null; providerConfig: unknown; manualBalance?: { toString(): string } | null },
  audit?: AuditFn,
): Promise<ProviderSyncResult> {
  const driver = account.provider ? getProvider(account.provider) : undefined;
  if (!driver) throw new Error(`Unknown investment provider: ${account.provider ?? "(none)"}`);
  const creds = resolveCreds(driver.key, account.providerConfig);
  if (!creds) throw new Error(`${driver.name} has no credentials`);
  audit?.({ kind: "log", text: `● ${driver.name}`, tone: "bold" });
  const snap = await driver.fetchSnapshot(creds);
  const before = num(account.manualBalance);
  // Don't touch name — it may be a user label distinguishing sibling accounts.
  await db.account.update({
    where: { id: account.id },
    data: { manualBalance: snap.totalValue, currency: snap.currency, provider: driver.key },
  });
  audit?.({ kind: "balance-change", accountId: account.id, name: driver.name, before, after: snap.totalValue, currency: snap.currency });
  await writeHoldings(account.id, snap);
  audit?.({ kind: "log", text: `  ${snap.currency} ${snap.totalValue.toFixed(2)} · ${snap.holdings.length} holdings`, tone: "dim" });
  return { provider: driver.key, total: snap.totalValue, holdings: snap.holdings.length };
}

// Connect a new investment account using a snapshot already pulled during
// validation, then write holdings. No second fetch. Always creates a fresh row
// (unique id) so a user can hold MULTIPLE accounts per provider (e.g. two Trading
// 212 logins) — each with its own credentials. `name` labels it (defaults to the
// provider name; rename later to tell siblings apart).
export async function createInvestmentAccount(provider: string, creds: ProviderCreds, snap: InvestmentSnapshot, name?: string): Promise<string> {
  const driver = getProvider(provider);
  if (!driver) throw new Error(`Unknown investment provider: ${provider}`);
  const id = `inv-${provider}-${randomUUID()}`;
  await db.account.create({
    data: { id, source: "INVESTMENT", type: "PERSONAL", provider, name: name?.trim() || driver.name, currency: snap.currency, manualBalance: snap.totalValue, providerConfig: creds },
  });
  await writeHoldings(id, snap);
  return id;
}

// Sync every investment account in the DB. Per-account failures are reported but
// don't abort the rest.
export async function syncAllInvestments(audit?: AuditFn): Promise<ProviderSyncResult[]> {
  const accounts = await db.account.findMany({
    where: { source: "INVESTMENT" },
    select: { id: true, provider: true, providerConfig: true, manualBalance: true },
  });
  const results: ProviderSyncResult[] = [];
  for (const a of accounts) {
    try {
      results.push(await refreshInvestmentAccount(a, audit));
    } catch (err) {
      audit?.({ kind: "log", text: `  ✗ ${a.provider ?? a.id}: ${err instanceof Error ? err.message : String(err)}`, tone: "red" });
    }
  }
  return results;
}
