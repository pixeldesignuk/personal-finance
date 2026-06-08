import crypto from "node:crypto";
import { env } from "../env.ts";
import type { InvestmentProvider, InvestmentSnapshot, NormalizedHolding } from "./types.ts";

// Bitget v2 (crypto). Signed requests: ACCESS-SIGN = base64(HMAC-SHA256(secret,
// timestamp + METHOD + requestPath + (?query) + body)). Coin balances are valued
// via public tickers (→ USDT) and converted to GBP, so they slot into net worth
// the same way as Trading 212 equities.
const BASE = "https://api.bitget.com";
const STABLE = new Set(["USDT", "USDC", "USD", "DAI", "TUSD", "FDUSD"]);

const num = (v: unknown): number => {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : 0;
};

function sign(ts: string, method: string, path: string, body = ""): string {
  const prehash = ts + method.toUpperCase() + path + body;
  return crypto.createHmac("sha256", env.BITGET_API_SECRET ?? "").update(prehash).digest("base64");
}

async function signedGet<T>(path: string): Promise<T> {
  const ts = Date.now().toString();
  const res = await fetch(BASE + path, {
    headers: {
      "ACCESS-KEY": env.BITGET_API_KEY ?? "",
      "ACCESS-SIGN": sign(ts, "GET", path),
      "ACCESS-TIMESTAMP": ts,
      "ACCESS-PASSPHRASE": env.BITGET_PASSPHRASE ?? "",
      "Content-Type": "application/json",
      locale: "en-US",
    },
  });
  const json = (await res.json()) as { code?: string; msg?: string; data?: T };
  if (json.code !== "00000") throw new Error(`Bitget ${path} → ${json.code ?? res.status} ${json.msg ?? ""}`.trim());
  return json.data as T;
}

// USD≈USDT → GBP. Overridable via env; otherwise a free FX lookup, with a fallback.
async function usdToGbp(): Promise<number> {
  if (env.BITGET_USD_GBP) return num(env.BITGET_USD_GBP) || 0.79;
  try {
    const r = await fetch("https://api.frankfurter.app/latest?from=USD&to=GBP");
    const j = (await r.json()) as { rates?: { GBP?: number } };
    return num(j.rates?.GBP) || 0.79;
  } catch {
    return 0.79;
  }
}

export const bitget: InvestmentProvider = {
  key: "bitget",
  name: "Bitget",
  configured: () => Boolean(env.BITGET_API_KEY && env.BITGET_API_SECRET && env.BITGET_PASSPHRASE),

  async fetchSnapshot(): Promise<InvestmentSnapshot> {
    const assets = await signedGet<{ coin: string; available: string; frozen: string; locked: string }[]>("/api/v2/spot/account/assets");
    const tickersRes = await fetch(`${BASE}/api/v2/spot/market/tickers`);
    const tickersJson = (await tickersRes.json()) as { data?: { symbol: string; lastPr: string }[] };
    const priceUsdt = new Map<string, number>();
    for (const t of tickersJson.data ?? []) priceUsdt.set(t.symbol, num(t.lastPr));
    const rate = await usdToGbp();

    let totalUsd = 0;
    let cashUsd = 0;
    const holdings: NormalizedHolding[] = [];
    for (const a of assets ?? []) {
      const quantity = num(a.available) + num(a.frozen) + num(a.locked);
      if (quantity <= 0) continue;
      const isStable = STABLE.has(a.coin);
      const unitUsd = isStable ? 1 : priceUsdt.get(`${a.coin}USDT`) ?? 0;
      const usd = quantity * unitUsd;
      if (usd <= 0) continue;
      totalUsd += usd;
      if (isStable) cashUsd += usd;
      holdings.push({ symbol: a.coin, name: a.coin, quantity, price: unitUsd * rate, value: usd * rate, currency: "GBP" });
    }

    return {
      totalValue: Number((totalUsd * rate).toFixed(2)),
      currency: "GBP",
      cash: Number((cashUsd * rate).toFixed(2)),
      invested: Number(((totalUsd - cashUsd) * rate).toFixed(2)),
      pnl: 0,
      holdings,
    };
  },
};
