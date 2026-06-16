import { GoogleGenAI } from "@google/genai";
import { env } from "../env.ts";
import { parsePicks, mapPicks } from "./helpers.ts";
import type { AuditFn } from "./audit.ts";

export interface ClassifyItem {
  id: string;
  text: string;
}
export interface CategoryOption {
  key: string;
  name: string;
  group?: string | null;
}

const BATCH = 40;
const MAX_RETRIES = 4;
const RETRYABLE = new Set([429, 500, 502, 503, 504]);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Pull the HTTP status out of a @google/genai error (it lives on .status or is
// embedded in the JSON message). Returns null when it's not an API status
// (e.g. a network blip), which we also treat as retryable.
function errorStatus(err: unknown): number | null {
  const e = err as { status?: number; message?: string };
  if (typeof e.status === "number") return e.status;
  const m = typeof e.message === "string" ? e.message.match(/"code":\s*(\d+)/) : null;
  return m ? Number(m[1]) : null;
}

export function geminiEnabled(): boolean {
  return Boolean(env.GEMINI_API_KEY);
}

// Turn raw bank-statement merchant strings into clean, human-friendly names.
// Returns a Map of ref -> name. No-ops without a key.
export async function nameMerchants(items: { ref: string; text: string }[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!env.GEMINI_API_KEY || !items.length) return out;
  const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  for (let i = 0; i < items.length; i += BATCH) {
    const chunk = items.slice(i, i + BATCH);
    const prompt = `These are raw bank-statement merchant strings. For each, give a short, clean, human-friendly merchant/brand name. Strip store/branch numbers, locations, card references and FX text. Examples: "TESCO STORES 2992 OLDHAM" -> "Tesco"; "INT'L 2097401784 MIDJOURNEY INC. SOUTH SAN FRA USD 12.00" -> "Midjourney"; "UBER *EATS HELP.UBER.COM" -> "Uber Eats".

${chunk.map((c) => `- ${c.ref} | ${c.text}`).join("\n")}

Respond with ONLY a JSON array, one object per line: [{"id":"<ref>","name":"<clean name>"}]`;
    try {
      const raw = await generateWithRetry(ai, prompt, i / BATCH + 1);
      const arr = JSON.parse(raw || "[]");
      for (const el of Array.isArray(arr) ? arr : []) {
        if (el && typeof el.id === "string" && typeof el.name === "string" && el.name.trim()) out.set(el.id, el.name.trim());
      }
    } catch (err) {
      console.error("nameMerchants batch failed:", err instanceof Error ? err.message : err);
    }
  }
  return out;
}

function buildPrompt(items: { ref: string; text: string }[], categories: CategoryOption[]): string {
  const cats = categories.map((c) => `- ${c.key}: ${c.name}${c.group ? ` (${c.group})` : ""}`).join("\n");
  const txns = items.map((it) => `- ${it.ref} | ${it.text}`).join("\n");
  return `You categorise personal bank transactions. For each transaction below, choose exactly ONE category KEY from the list, based on the merchant/description. If it is genuinely unclear, use "uncategorised".

Categories (key: name):
${cats}

Transactions (ref | description):
${txns}

Respond with ONLY a JSON array — one object per transaction — and nothing else:
[{"id":"<ref>","categoryKey":"<one key from the list above>"}]`;
}

// Call the model with exponential backoff on transient errors (429/5xx, e.g.
// the "high demand" 503). Emits a batch-error audit line per retry so the
// stream shows what's happening. Throws if all attempts fail.
async function generateWithRetry(
  ai: GoogleGenAI,
  contents: string,
  batch: number,
  audit?: AuditFn,
): Promise<string> {
  for (let attempt = 1; ; attempt++) {
    try {
      const resp = await ai.models.generateContent({
        model: env.GEMINI_MODEL,
        contents,
        config: { responseMimeType: "application/json", maxOutputTokens: 8192 },
      });
      return resp.text ?? "";
    } catch (err) {
      const status = errorStatus(err);
      const retryable = status === null || RETRYABLE.has(status);
      if (attempt > MAX_RETRIES || !retryable) throw err;
      const delay = 800 * 2 ** (attempt - 1); // 0.8s, 1.6s, 3.2s, 6.4s
      audit?.({ kind: "batch-error", batch, error: `${status ?? "network"} — retry ${attempt}/${MAX_RETRIES} in ${(delay / 1000).toFixed(1)}s…` });
      await sleep(delay);
    }
  }
}

// Generic JSON generation with the shared retry/backoff. Returns "" when no key
// is configured. Callers parse the JSON themselves.
export async function geminiGenerateJson(prompt: string, audit?: AuditFn, batch = 1): Promise<string> {
  if (!env.GEMINI_API_KEY) return "";
  const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  return generateWithRetry(ai, prompt, batch, audit);
}

// Parse a free-text cash expense/income message (e.g. "Spent £18 cash on Rajas
// fast food for the office today") into structured fields. Returns null without
// a key or if no amount is found.
export async function geminiParseExpense(
  text: string,
  categories: { key: string; name: string }[] = [],
): Promise<{ amount: number; isIncome: boolean; merchant: string | null; summary: string; categoryKey: string | null } | null> {
  if (!env.GEMINI_API_KEY) return null;
  const catList = categories.map((c) => `${c.key} (${c.name})`).join(", ");
  const prompt = `Extract a single personal cash transaction from this message. Respond with ONLY a JSON object:
{"amount": the total money amount as a positive number with no symbol (or null if there is no amount), "isIncome": true if money was received, false if spent, "merchant": the SHOP or PAYEE name only — a clean brand/store name (e.g. "Tesco", "Greggs"). NOT the items bought, NOT payment-method words like "cash". null if none, "summary": a short 3-6 word plain-text description of what was bought (e.g. "cat food & milk"), no emojis, "categoryKey": the single best-matching category key from the list below for what was bought, or "uncategorised" if genuinely unclear}
Categories: ${catList || "(none provided — use \"uncategorised\")"}
Message: ${JSON.stringify(text)}`;
  let raw: string;
  try { raw = await geminiGenerateJson(prompt); } catch { return null; }
  try {
    const o = JSON.parse(raw.replace(/^\s*```(?:json)?/i, "").replace(/```\s*$/i, "").trim());
    if (o == null || o.amount == null || !Number.isFinite(Number(o.amount)) || Number(o.amount) === 0) return null;
    const validKeys = new Set([...categories.map((c) => c.key), "income", "transfer", "uncategorised"]);
    const categoryKey = typeof o.categoryKey === "string" && validKeys.has(o.categoryKey) ? o.categoryKey : null;
    return {
      amount: Math.abs(Number(o.amount)),
      isIncome: Boolean(o.isIncome),
      merchant: typeof o.merchant === "string" && o.merchant.trim() ? o.merchant.trim() : null,
      summary: typeof o.summary === "string" ? o.summary.trim() : "",
      categoryKey,
    };
  } catch { return null; }
}

// Extract a purchase from a receipt photo (Gemini vision). Returns the raw JSON
// string (same shape as the email order extractor) or "" without a key.
export async function geminiExtractReceiptImage(base64: string, mimeType: string, categories: { key: string; name: string }[] = []): Promise<string> {
  if (!env.GEMINI_API_KEY) return "";
  const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  const catList = categories.map((c) => `${c.key} (${c.name})`).join(", ");
  const prompt = `This is a photo of a purchase receipt. Extract it and respond with ONLY a JSON object:
{"merchant": clean brand/store name or null, "total": grand total paid as a number with no currency symbol or null, "currency": "GBP"|"USD"|"EUR"|null, "orderNumber": string or null, "date": the printed purchase date as "YYYY-MM-DD" or null — receipts are UK so dates are DAY/MONTH/YEAR (DD/MM/YY or DD/MM/YYYY); a 2-digit year YY means 20YY, never the day. Example: "16/06/26" is 16 June 2026 -> "2026-06-16", "items": [{"name": string, "qty": number|null, "price": number|null}], "tags": 1-4 short lowercase category tags (e.g. ["groceries"],["fuel"],["clothing"]), "summary": a short 3-6 word plain-text description of the purchase (e.g. "weekly grocery shop", "takeaway dinner", "kids clothes & toiletries") — no emojis, "categoryKey": the single best-matching category key from the list below for what was bought, or "uncategorised" if genuinely unclear}
Categories: ${catList || "(none provided — use \"uncategorised\")"}
If it is not a legible purchase receipt, return {"merchant": null, "total": null}.`;
  for (let attempt = 1; ; attempt++) {
    try {
      const resp = await ai.models.generateContent({
        model: env.GEMINI_MODEL,
        contents: [{ role: "user", parts: [{ inlineData: { mimeType, data: base64 } }, { text: prompt }] }],
        config: { responseMimeType: "application/json", maxOutputTokens: 16384 },
      });
      return resp.text ?? "";
    } catch (err) {
      const status = errorStatus(err);
      const retryable = status === null || RETRYABLE.has(status);
      if (attempt > MAX_RETRIES || !retryable) throw err;
      await sleep(800 * 2 ** (attempt - 1));
    }
  }
}

// Classify transactions with Gemini Flash. Returns a Map of real transaction
// id -> categoryKey, validated against the allowed category keys. Returns an
// empty map (a no-op) when no API key is configured. Batched; a failed batch
// is skipped rather than aborting the whole run.
export async function classifyBatch(
  items: ClassifyItem[],
  categories: CategoryOption[],
  audit?: AuditFn,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!env.GEMINI_API_KEY || items.length === 0 || categories.length === 0) return out;

  const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  const validKeys = new Set(categories.map((c) => c.key));

  let batch = 0;
  for (let i = 0; i < items.length; i += BATCH) {
    batch++;
    const chunk = items.slice(i, i + BATCH);
    // Use short opaque refs in the prompt so long ids can't be mangled and to
    // keep token use down; map back to the real id afterwards.
    const refToId = new Map<string, string>();
    const refItems = chunk.map((it, idx) => {
      const ref = `t${idx}`;
      refToId.set(ref, it.id);
      return { ref, text: it.text };
    });
    audit?.({ kind: "batch-request", batch, items: refItems.map((r) => ({ ref: r.ref, id: refToId.get(r.ref)!, text: r.text })) });

    try {
      const raw = await generateWithRetry(ai, buildPrompt(refItems, categories), batch, audit);
      audit?.({ kind: "batch-raw", batch, text: raw });
      const picks = parsePicks(raw);
      const valid = mapPicks(picks, validKeys);
      audit?.({ kind: "batch-parsed", batch, returned: picks.length, valid: valid.size, dropped: picks.filter((p) => !validKeys.has(p.categoryKey)) });
      for (const [ref, key] of valid) {
        const id = refToId.get(ref);
        if (id) out.set(id, key);
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      console.error("Gemini classify batch failed:", error);
      audit?.({ kind: "batch-error", batch, error });
    }
  }
  return out;
}
