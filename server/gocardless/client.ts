import { env } from "../env.ts";
import { TokenManager, type Creds } from "./token.ts";
import type {
  GcAccountDetails,
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

  createRequisition(institutionId: string, reference: string, redirect: string): Promise<GcRequisition> {
    return this.request("/api/v2/requisitions/", {
      method: "POST",
      body: JSON.stringify({ institution_id: institutionId, reference, redirect }),
    });
  }

  getRequisition(id: string): Promise<GcRequisition> {
    return this.request(`/api/v2/requisitions/${id}/`);
  }

  getAccountDetails(id: string): Promise<GcAccountDetails> {
    return this.request(`/api/v2/accounts/${id}/details/`);
  }

  getBalances(id: string): Promise<GcBalances> {
    return this.request(`/api/v2/accounts/${id}/balances/`);
  }

  getTransactions(id: string): Promise<GcTransactions> {
    return this.request(`/api/v2/accounts/${id}/transactions/`);
  }
}
