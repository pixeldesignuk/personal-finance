import type { TokenResponse } from "./types.ts";

const BASE = "https://bankaccountdata.gocardless.com";
const SKEW_MS = 60_000;

export interface Creds {
  secretId: string;
  secretKey: string;
}

export class TokenManager {
  private access: string | null = null;
  private expiresAt = 0;

  constructor(
    private creds: Creds,
    private fetchImpl: typeof fetch = fetch,
    private now: () => number = Date.now,
  ) {}

  async get(): Promise<string> {
    if (this.access && this.expiresAt - SKEW_MS > this.now()) return this.access;
    const res = await this.fetchImpl(`${BASE}/api/v2/token/new/`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ secret_id: this.creds.secretId, secret_key: this.creds.secretKey }),
    });
    if (!res.ok) throw new Error(`Token request failed (${res.status}): ${await res.text()}`);
    const body = (await res.json()) as TokenResponse;
    this.access = body.access;
    this.expiresAt = this.now() + body.access_expires * 1000;
    return this.access;
  }
}
