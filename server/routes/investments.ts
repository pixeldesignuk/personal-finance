import { Router } from "express";
import { db } from "../lib/db.ts";
import { PROVIDERS, getProvider } from "../investments/index.ts";
import type { InvestmentsDTO, InvestmentAccountDTO } from "../../shared/types.ts";

export const investmentsRouter = Router();

const dec = (v: { toString(): string } | null | undefined): number => (v == null ? 0 : Number(v.toString()));
const accountId = (providerKey: string) => `inv-${providerKey}`;

async function toDTO(): Promise<InvestmentAccountDTO[]> {
  const accounts = await db.account.findMany({ where: { source: "INVESTMENT" }, include: { holdings: { orderBy: { value: "desc" } } } });
  return accounts.map((a) => {
    const holdings = a.holdings.map((h) => ({
      symbol: h.symbol, name: h.name ?? h.symbol, quantity: dec(h.quantity),
      price: dec(h.price), value: dec(h.value), pnl: h.pnl == null ? null : dec(h.pnl), currency: h.currency,
    }));
    const invested = holdings.reduce((s, h) => s + h.value, 0);
    const total = dec(a.manualBalance);
    return {
      id: a.id,
      name: a.nickname ?? a.name ?? a.provider ?? "Investments",
      provider: a.provider ?? "",
      currency: a.currency ?? "GBP",
      total,
      cash: Number((total - invested).toFixed(2)),
      invested: Number(invested.toFixed(2)),
      pnl: holdings.reduce((s, h) => s + (h.pnl ?? 0), 0),
      holdings,
    };
  });
}

investmentsRouter.get("/investments", async (_req, res, next) => {
  try {
    const accounts = await toDTO();
    const dto: InvestmentsDTO = {
      providers: PROVIDERS.map((p) => ({ key: p.key, name: p.name, configured: p.configured() })),
      accounts,
      total: accounts.reduce((s, a) => s + a.total, 0),
    };
    res.json(dto);
  } catch (err) { next(err); }
});

// Pull the latest snapshot from a provider into an INVESTMENT account + holdings.
investmentsRouter.post("/investments/:provider/sync", async (req, res, next) => {
  try {
    const provider = getProvider(req.params.provider);
    if (!provider) { res.status(404).json({ error: "Unknown provider" }); return; }
    if (!provider.configured()) { res.status(400).json({ error: `${provider.name} not configured — set its API key.` }); return; }

    const snap = await provider.fetchSnapshot();
    const id = accountId(provider.key);
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
    res.json({ provider: provider.key, total: snap.totalValue, holdings: snap.holdings.length });
  } catch (err) { next(err); }
});
