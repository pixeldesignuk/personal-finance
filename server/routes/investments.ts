import { Router } from "express";
import { db } from "../lib/db.ts";
import { refreshInvestmentAccount, syncAllInvestments } from "../investments/sync.ts";
import { INVESTMENT_PROVIDER_FORMS } from "../../shared/investmentMeta.ts";
import type { InvestmentsDTO, InvestmentAccountDTO } from "../../shared/types.ts";

export const investmentsRouter = Router();

const dec = (v: { toString(): string } | null | undefined): number => (v == null ? 0 : Number(v.toString()));

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
    const connected = new Set(accounts.map((a) => a.provider));
    const dto: InvestmentsDTO = {
      providers: INVESTMENT_PROVIDER_FORMS.map((p) => ({ key: p.key, name: p.label, configured: connected.has(p.key) })),
      accounts,
      total: accounts.reduce((s, a) => s + a.total, 0),
    };
    res.json(dto);
  } catch (err) { next(err); }
});

// Sync every investment account (creds from each account's stored config / env).
investmentsRouter.post("/investments/sync", async (_req, res, next) => {
  try {
    res.json({ results: await syncAllInvestments() });
  } catch (err) { next(err); }
});

// Re-sync one investment account by id (multiple accounts can share a provider).
investmentsRouter.post("/investments/account/:id/sync", async (req, res, next) => {
  try {
    const account = await db.account.findUnique({
      where: { id: req.params.id },
      select: { id: true, source: true, provider: true, providerConfig: true, manualBalance: true },
    });
    if (!account || account.source !== "INVESTMENT") { res.status(404).json({ error: "Investment account not found" }); return; }
    res.json(await refreshInvestmentAccount(account));
  } catch (err) { next(err); }
});
