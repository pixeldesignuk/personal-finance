import { env } from "../env.ts";
import { INVESTMENT_PROVIDER_FORMS } from "../../shared/investmentMeta.ts";
import type { ProviderCreds } from "./types.ts";

// Legacy env credentials for a provider — the fallback so accounts configured
// before the UI-add flow (and dev .env setups) keep syncing with no migration.
export function legacyEnvCreds(provider: string): ProviderCreds | null {
  if (provider === "trading212") {
    if (env.TRADING_212_KEY_ID && env.TRADING_212_SECRET) {
      const c: ProviderCreds = { keyId: env.TRADING_212_KEY_ID, secret: env.TRADING_212_SECRET };
      if (env.TRADING212_BASE_URL) c.baseUrl = env.TRADING212_BASE_URL;
      return c;
    }
    return null;
  }
  if (provider === "bitget") {
    if (env.BITGET_API_KEY && env.BITGET_API_SECRET && env.BITGET_PASSPHRASE) {
      const c: ProviderCreds = { apiKey: env.BITGET_API_KEY, apiSecret: env.BITGET_API_SECRET, passphrase: env.BITGET_PASSPHRASE };
      if (env.BITGET_USD_GBP) c.usdGbp = env.BITGET_USD_GBP;
      return c;
    }
    return null;
  }
  return null;
}

// Credentials for an account: the per-account stored config wins; otherwise fall
// back to legacy env. Returns null when neither has usable creds.
export function resolveCreds(provider: string, providerConfig: unknown): ProviderCreds | null {
  if (providerConfig && typeof providerConfig === "object" && Object.keys(providerConfig as object).length > 0) {
    return providerConfig as ProviderCreds;
  }
  return legacyEnvCreds(provider);
}

// Validate a submitted credential payload against the provider's field
// descriptor (one source of truth with the form). Trims values; rejects missing
// required fields; ignores unknown keys.
export function validateCreds(
  provider: string,
  config: unknown,
): { ok: true; creds: ProviderCreds } | { ok: false; error: string } {
  const form = INVESTMENT_PROVIDER_FORMS.find((f) => f.key === provider);
  if (!form) return { ok: false, error: "Unknown provider" };
  const obj = (config && typeof config === "object" ? config : {}) as Record<string, unknown>;
  const creds: ProviderCreds = {};
  for (const f of form.credentialFields) {
    const raw = obj[f.key];
    const val = raw == null ? "" : String(raw).trim();
    if (!val) {
      if (!f.optional) return { ok: false, error: `Missing ${f.label}` };
      continue;
    }
    creds[f.key] = val;
  }
  return { ok: true, creds };
}
