import { db } from "../lib/db.ts";
import { PROVIDERS } from "./index.ts";
import type { InvestmentProvider } from "./types.ts";
import type { AuditFn } from "../categorise/audit.ts";

export interface ProviderSyncResult {
  provider: string;
  total: number;
  holdings: number;
}

// Pull a provider's snapshot into its INVESTMENT account + holdings.
export async function syncProvider(provider: InvestmentProvider, audit?: AuditFn): Promise<ProviderSyncResult> {
  audit?.({ kind: "log", text: `● ${provider.name}`, tone: "bold" });
  const snap = await provider.fetchSnapshot();
  const id = `inv-${provider.key}`;
  await db.account.upsert({
    where: { id },
    create: { id, source: "INVESTMENT", type: "PERSONAL", provider: provider.key, name: provider.name, currency: snap.currency, manualBalance: snap.totalValue },
    update: { manualBalance: snap.totalValue, currency: snap.currency, provider: provider.key, name: provider.name },
  });
  await db.holding.deleteMany({ where: { accountId: id } });
  if (snap.holdings.length) {
    await db.holding.createMany({
      data: snap.holdings.map((h) => ({
        accountId: id, symbol: h.symbol, name: h.name ?? null, quantity: h.quantity,
        price: h.price, value: h.value, cost: h.cost ?? null, pnl: h.pnl ?? null, currency: h.currency ?? null,
      })),
    });
  }
  audit?.({ kind: "log", text: `  ${snap.currency} ${snap.totalValue.toFixed(2)} · ${snap.holdings.length} holdings`, tone: "dim" });
  return { provider: provider.key, total: snap.totalValue, holdings: snap.holdings.length };
}

// Sync every configured provider. Failures are reported but don't abort the rest.
export async function syncAllInvestments(audit?: AuditFn): Promise<ProviderSyncResult[]> {
  const results: ProviderSyncResult[] = [];
  for (const p of PROVIDERS) {
    if (!p.configured()) continue;
    try {
      results.push(await syncProvider(p, audit));
    } catch (err) {
      audit?.({ kind: "log", text: `  ✗ ${p.name}: ${err instanceof Error ? err.message : String(err)}`, tone: "red" });
    }
  }
  return results;
}
