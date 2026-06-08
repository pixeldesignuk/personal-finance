import { trading212 } from "./trading212.ts";
import type { InvestmentProvider } from "./types.ts";

// Registry of investment providers. Add Bitget (crypto) here next — it just has
// to implement the same InvestmentProvider interface.
export const PROVIDERS: InvestmentProvider[] = [trading212];

export function getProvider(key: string): InvestmentProvider | undefined {
  return PROVIDERS.find((p) => p.key === key);
}

export type { InvestmentProvider } from "./types.ts";
