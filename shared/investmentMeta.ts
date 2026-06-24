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

// Credential fields a provider needs, driving BOTH the add-account form and the
// server's required-field validation (one source of truth). `secret` masks the
// input; `optional` fields may be left blank.
export interface CredentialField {
  key: string;
  label: string;
  secret?: boolean;
  optional?: boolean;
  placeholder?: string;
}

export interface InvestmentProviderForm {
  key: string;
  label: string;
  kind: InvestmentKind;
  credentialFields: CredentialField[];
}

export const INVESTMENT_PROVIDER_FORMS: InvestmentProviderForm[] = [
  {
    key: "trading212",
    label: "Trading 212",
    kind: "stocks",
    credentialFields: [
      { key: "keyId", label: "Key ID", placeholder: "API key id" },
      { key: "secret", label: "API key", secret: true },
      { key: "baseUrl", label: "Base URL", optional: true, placeholder: "https://live.trading212.com" },
    ],
  },
  {
    key: "bitget",
    label: "Bitget",
    kind: "crypto",
    credentialFields: [
      { key: "apiKey", label: "API key", secret: true },
      { key: "apiSecret", label: "API secret", secret: true },
      { key: "passphrase", label: "Passphrase", secret: true },
      { key: "usdGbp", label: "USD→GBP rate", optional: true, placeholder: "auto" },
    ],
  },
];

export function providerForm(key: string | null | undefined): InvestmentProviderForm | null {
  return key ? INVESTMENT_PROVIDER_FORMS.find((f) => f.key === key) ?? null : null;
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
