import { env } from "../env.ts";
import { TokenManager, type Creds } from "./token.ts";
import type {
  GcAccount,
  GcAccountDetails,
  GcAgreement,
  GcBalances,
  GcInstitution,
  GcRequisition,
  GcTransactions,
} from "./types.ts";

const BASE = "https://bankaccountdata.gocardless.com";

export class GoCardlessError extends Error {
  constructor(public status: number, public body: string, public retryAfter?: string) {
    super(`GoCardless API error ${status}: ${body}`);
  }
}

// A freshly-linked account returns 409 with `type: "AccountProcessing"` from
// details/balances/transactions until its status is READY. This is transient —
// poll the account endpoint and retry, don't treat it as a hard failure.
export function isAccountProcessing(err: unknown): boolean {
  return err instanceof GoCardlessError && err.status === 409 && /AccountProcessing/.test(err.body);
}

export class GoCardlessClient {
  private tokens: TokenManager;
  constructor(creds: Creds = { secretId: env.GOCARDLESS_SECRET_ID, secretKey: env.GOCARDLESS_SECRET_KEY }) {
    this.tokens = new TokenManager(creds);
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = await this.tokens.get();
    const res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });
    if (!res.ok) {
      throw new GoCardlessError(res.status, await res.text(), res.headers.get("Retry-After") ?? undefined);
    }
    return (await res.json()) as T;
  }

  getInstitutions(country: string): Promise<GcInstitution[]> {
    return this.request(`/api/v2/institutions/?country=${country}`);
  }

  // Create an end-user agreement that requests a longer transaction history than
  // the 90-day default. The bank caps this at its own maximum, so we request the
  // bank's advertised `transaction_total_days` (fallback 730). Pass the returned
  // agreement id into createRequisition so the consent covers that window.
  createAgreement(institutionId: string, maxHistoricalDays: number, accessValidForDays = 90): Promise<GcAgreement> {
    return this.request("/api/v2/agreements/enduser/", {
      method: "POST",
      body: JSON.stringify({
        institution_id: institutionId,
        max_historical_days: maxHistoricalDays,
        access_valid_for_days: accessValidForDays,
        access_scope: ["balances", "details", "transactions"],
      }),
    });
  }

  createRequisition(institutionId: string, reference: string, redirect: string, agreement?: string): Promise<GcRequisition> {
    return this.request("/api/v2/requisitions/", {
      method: "POST",
      body: JSON.stringify({ institution_id: institutionId, reference, redirect, ...(agreement ? { agreement } : {}) }),
    });
  }

  getRequisition(id: string): Promise<GcRequisition> {
    return this.request(`/api/v2/requisitions/${id}/`);
  }

  deleteRequisition(id: string): Promise<unknown> {
    return this.request(`/api/v2/requisitions/${id}/`, { method: "DELETE" });
  }

  // Account metadata, incl. `status` — used to wait for READY before fetching
  // details/balances/transactions on a freshly-linked account.
  getAccount(id: string): Promise<GcAccount> {
    return this.request(`/api/v2/accounts/${id}/`);
  }

  getAccountDetails(id: string): Promise<GcAccountDetails> {
    return this.request(`/api/v2/accounts/${id}/details/`);
  }

  getBalances(id: string): Promise<GcBalances> {
    return this.request(`/api/v2/accounts/${id}/balances/`);
  }

  // `dateFrom` (YYYY-MM-DD) narrows the window so we don't re-pull full history
  // on every sync. Omitting it returns the institution's full available range.
  getTransactions(id: string, dateFrom?: string): Promise<GcTransactions> {
    const qs = dateFrom ? `?date_from=${dateFrom}` : "";
    return this.request(`/api/v2/accounts/${id}/transactions/${qs}`);
  }
}
