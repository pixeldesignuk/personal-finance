import { env } from "../env.ts";
import type { InvestmentProvider, InvestmentSnapshot, NormalizedHolding } from "./types.ts";

// Trading 212 public API (https://docs.trading212.com/api). Auth is the raw API
// key in the Authorization header. We parse defensively so both the current
// (account/summary, positions) and legacy (account/cash, portfolio) shapes work.
const num = (v: unknown): number => {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : 0;
};

function base(): string {
  return (env.TRADING212_BASE_URL ?? "https://live.trading212.com").replace(/\/$/, "");
}

async function t212<T>(path: string): Promise<T> {
  const res = await fetch(`${base()}/api/v0${path}`, {
    headers: { Authorization: env.TRADING212_API_KEY ?? "" },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Trading 212 ${path} → ${res.status} ${res.statusText}${body ? `: ${body.slice(0, 200)}` : ""}`);
  }
  return res.json() as Promise<T>;
}

function friendlyName(ticker: string): string {
  return ticker.split("_")[0] || ticker;
}

export const trading212: InvestmentProvider = {
  key: "trading212",
  name: "Trading 212",
  configured: () => Boolean(env.TRADING212_API_KEY),

  async fetchSnapshot(): Promise<InvestmentSnapshot> {
    const summary = await t212<Record<string, any>>("/equity/account/summary").catch(() => null)
      ?? await t212<Record<string, any>>("/equity/account/cash"); // legacy fallback
    const cashObj = summary.cash ?? {};
    const inv = summary.investments ?? {};
    const cash = typeof cashObj === "object"
      ? num(cashObj.availableToTrade) + num(cashObj.inPies) + num(cashObj.reservedForOrders)
      : num(summary.free) + num(summary.inPies);
    const invested = num(inv.currentValue ?? summary.invested);
    const pnl = num(inv.unrealizedProfitLoss ?? summary.ppl);
    const totalValue = num(summary.totalValue ?? summary.total ?? cash + invested);
    const currency = summary.currency ?? "GBP";

    // 1 req/s rate limit — these two calls are sequential.
    const positions = await t212<any[]>("/equity/positions").catch(() => t212<any[]>("/equity/portfolio"));
    const holdings: NormalizedHolding[] = (positions ?? []).map((p) => {
      const ticker: string = p.instrument?.ticker ?? p.ticker ?? "?";
      const quantity = num(p.quantity);
      const price = num(p.currentPrice);
      const value = num(p.walletImpact?.currentValue ?? quantity * price);
      return {
        symbol: ticker,
        name: friendlyName(ticker),
        quantity,
        price,
        value,
        cost: num(p.averagePricePaid ?? p.averagePrice) * quantity || undefined,
        pnl: num(p.walletImpact?.unrealizedProfitLoss ?? p.ppl) || undefined,
        currency: p.instrument?.currency ?? p.currencyCode ?? currency,
      };
    });

    return { totalValue, currency, cash, invested, pnl, holdings };
  },
};
