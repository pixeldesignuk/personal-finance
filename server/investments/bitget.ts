import crypto from "node:crypto";
import type { InvestmentProvider, InvestmentSnapshot, NormalizedHolding, ProviderCreds } from "./types.ts";

// Bitget v2 (crypto). Signed requests: ACCESS-SIGN = base64(HMAC-SHA256(secret,
// timestamp + METHOD + requestPath + (?query) + body)). Coin balances are valued
// via public tickers (→ USDT) and converted to GBP, so they slot into net worth
// the same way as Trading 212 equities. Credentials are passed in (from
// Account.providerConfig or legacy env), not read from env here.
const BASE = "https://api.bitget.com";
const STABLE = new Set(["USDT", "USDC", "USD", "DAI", "TUSD", "FDUSD"]);

const num = (v: unknown): number => {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : 0;
};

function sign(secret: string, ts: string, method: string, path: string, body = ""): string {
  const prehash = ts + method.toUpperCase() + path + body;
  return crypto.createHmac("sha256", secret).update(prehash).digest("base64");
}

async function signedGet<T>(creds: ProviderCreds, path: string): Promise<T> {
  const ts = Date.now().toString();
  const res = await fetch(BASE + path, {
    headers: {
      "ACCESS-KEY": creds.apiKey ?? "",
      "ACCESS-SIGN": sign(creds.apiSecret ?? "", ts, "GET", path),
      "ACCESS-TIMESTAMP": ts,
      "ACCESS-PASSPHRASE": creds.passphrase ?? "",
      "Content-Type": "application/json",
      locale: "en-US",
    },
  });
  const json = (await res.json()) as { code?: string; msg?: string; data?: T };
  if (json.code !== "00000") throw new Error(`Bitget ${path} → ${json.code ?? res.status} ${json.msg ?? ""}`.trim());
  return json.data as T;
}

// USD≈USDT → GBP. Overridable via creds; otherwise a free FX lookup, with a fallback.
async function usdToGbp(creds: ProviderCreds): Promise<number> {
  if (creds.usdGbp) return num(creds.usdGbp) || 0.79;
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

  async fetchSnapshot(creds: ProviderCreds): Promise<InvestmentSnapshot> {
    const assets = await signedGet<{ coin: string; available: string; frozen: string; locked: string }[]>(creds, "/api/v2/spot/account/assets");
    const tickersRes = await fetch(`${BASE}/api/v2/spot/market/tickers`);
    const tickersJson = (await tickersRes.json()) as { data?: { symbol: string; lastPr: string }[] };
    const priceUsdt = new Map<string, number>();
    for (const t of tickersJson.data ?? []) priceUsdt.set(t.symbol, num(t.lastPr));
    const rate = await usdToGbp(creds);

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
      if (isStable) { cashUsd += usd; continue; } // stablecoins are the cash balance, not a position
      if (usd * rate < 0.1) continue; // skip dust positions in the displayed list
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
