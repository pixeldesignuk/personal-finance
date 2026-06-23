// Presentation metadata for direct-integration investment providers: a brand
// domain (for logo resolution) and the asset kind (so the UI can badge crypto vs
// stocks). Keyed by Account.provider / InvestmentAccountDTO.provider.

export type InvestmentKind = "stocks" | "crypto";

export interface InvestmentProviderMeta {
  label: string;
  domain: string;
  kind: InvestmentKind;
}

export const INVESTMENT_PROVIDERS: Record<string, InvestmentProviderMeta> = {
  trading212: { label: "Trading 212", domain: "trading212.com", kind: "stocks" },
  bitget: { label: "Bitget", domain: "bitget.com", kind: "crypto" },
};

export function providerMeta(key: string | null | undefined): InvestmentProviderMeta | null {
  return key ? INVESTMENT_PROVIDERS[key] ?? null : null;
}

// Ordered logo candidates for a brand domain — BrandLogo tries each, then a
// monogram. unavatar returns the crispest mark; the favicon services are
// reliable fallbacks.
export function providerLogoCandidates(domain: string): string[] {
  return [
    `https://unavatar.io/${domain}`,
    `https://icons.duckduckgo.com/ip3/${domain}.ico`,
    `https://www.google.com/s2/favicons?sz=64&domain=${domain}`,
  ];
}

export const KIND_LABEL: Record<InvestmentKind, string> = { stocks: "Stocks", crypto: "Crypto" };
