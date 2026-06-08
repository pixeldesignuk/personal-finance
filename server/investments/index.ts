import { trading212 } from "./trading212.ts";
import { bitget } from "./bitget.ts";
import type { InvestmentProvider } from "./types.ts";

// Registry of investment providers — each implements the same interface.
export const PROVIDERS: InvestmentProvider[] = [trading212, bitget];

export function getProvider(key: string): InvestmentProvider | undefined {
  return PROVIDERS.find((p) => p.key === key);
}

export type { InvestmentProvider } from "./types.ts";
