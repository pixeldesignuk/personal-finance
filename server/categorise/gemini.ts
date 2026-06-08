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

function buildPrompt(items: { ref: string; text: string }[], categories: CategoryOption[]): string {
  const cats = categories.map((c) => `- ${c.key}: ${c.name}`).join("\n");
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
