// Low-level Gmail OAuth + REST. No DB here — token persistence lives in the
// plugins route. Single-user read-only access.
import { env } from "../env.ts";

const SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";

export const redirectUri = () => `${env.APP_BASE_URL}/api/plugins/gmail/callback`;
export const gmailConfigured = () => Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);

export function authUrl(state: string): string {
  const p = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID ?? "",
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

export interface TokenResp { access_token: string; refresh_token?: string; expires_in: number; }

async function tokenRequest(body: Record<string, string>): Promise<TokenResp> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID ?? "", client_secret: env.GOOGLE_CLIENT_SECRET ?? "", ...body }),
  });
  if (!res.ok) throw new Error(`Google token error ${res.status}: ${await res.text()}`);
  return res.json() as Promise<TokenResp>;
}

export const exchangeCode = (code: string) =>
  tokenRequest({ code, redirect_uri: redirectUri(), grant_type: "authorization_code" });
export const refreshAccessToken = (refreshToken: string) =>
  tokenRequest({ refresh_token: refreshToken, grant_type: "refresh_token" });

export async function getProfile(accessToken: string): Promise<{ emailAddress: string }> {
  const res = await fetch(`${GMAIL}/profile`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`Gmail profile error ${res.status}: ${await res.text()}`);
  return res.json() as Promise<{ emailAddress: string }>;
}

// Register a push notification watch on the INBOX. Google publishes to the given
// Pub/Sub topic when mail arrives; the watch lapses after ~7 days so it must be
// re-armed. Returns the new `expiration` (ms epoch as a string).
export async function watch(accessToken: string, topicName: string): Promise<{ historyId: string; expiration: string }> {
  const res = await fetch(`${GMAIL}/watch`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ topicName, labelIds: ["INBOX"], labelFilterBehavior: "INCLUDE" }),
  });
  if (!res.ok) throw new Error(`Gmail watch error ${res.status}: ${await res.text()}`);
  return res.json() as Promise<{ historyId: string; expiration: string }>;
}

// Cancel any active watch (idempotent — a missing watch is not an error).
export async function stopWatch(accessToken: string): Promise<void> {
  const res = await fetch(`${GMAIL}/stop`, { method: "POST", headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok && res.status !== 404) throw new Error(`Gmail stop error ${res.status}: ${await res.text()}`);
}

// List message IDs matching a Gmail search query, up to `max`.
export async function listMessages(accessToken: string, q: string, max = 60): Promise<string[]> {
  const ids: string[] = [];
  let pageToken: string | undefined;
  do {
    const p = new URLSearchParams({ q, maxResults: String(Math.min(100, max - ids.length)) });
    if (pageToken) p.set("pageToken", pageToken);
    const res = await fetch(`${GMAIL}/messages?${p}`, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) throw new Error(`Gmail list error ${res.status}: ${await res.text()}`);
    const j = (await res.json()) as { messages?: { id: string }[]; nextPageToken?: string };
    for (const m of j.messages ?? []) ids.push(m.id);
    pageToken = j.nextPageToken;
  } while (pageToken && ids.length < max);
  return ids.slice(0, max);
}

export interface GmailMessage { id: string; subject: string; from: string; date: string | null; snippet: string; body: string; }

interface Part { mimeType?: string; body?: { data?: string }; parts?: Part[] }
const b64url = (s: string) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
const stripHtml = (h: string) => h.replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

// Prefer text/plain; fall back to stripped text/html. Walks nested MIME parts.
function extractBody(payload: Part): string {
  const plain: string[] = [];
  const html: string[] = [];
  const walk = (p: Part) => {
    if (p.body?.data) {
      if (p.mimeType === "text/plain") plain.push(b64url(p.body.data));
      else if (p.mimeType === "text/html") html.push(b64url(p.body.data));
    }
    for (const c of p.parts ?? []) walk(c);
  };
  walk(payload);
  if (plain.length) return plain.join("\n").replace(/\s+\n/g, "\n").trim();
  if (html.length) return stripHtml(html.join("\n"));
  return "";
}

export async function getMessage(accessToken: string, id: string): Promise<GmailMessage> {
  const res = await fetch(`${GMAIL}/messages/${id}?format=full`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`Gmail get error ${res.status}: ${await res.text()}`);
  const j = (await res.json()) as { snippet?: string; payload?: Part & { headers?: { name: string; value: string }[] }; internalDate?: string };
  const headers = j.payload?.headers ?? [];
  const h = (n: string) => headers.find((x) => x.name.toLowerCase() === n.toLowerCase())?.value ?? "";
  return {
    id,
    subject: h("subject"),
    from: h("from"),
    date: j.internalDate ? new Date(Number(j.internalDate)).toISOString() : null,
    snippet: j.snippet ?? "",
    body: j.payload ? extractBody(j.payload) : "",
  };
}
