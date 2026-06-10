import { db } from "./db.ts";
import { geminiGenerateJson } from "../categorise/gemini.ts";
import type { AuditFn } from "../categorise/audit.ts";

// Resolve each named merchant's primary website domain via Gemini, for logos
// (e.g. "Greggs" -> "greggs.co.uk"). Only fills merchants that have a name but
// no domain. No-op without a Gemini key.
export async function autoMerchantDomains(audit?: AuditFn, limit = 120): Promise<{ set: number }> {
  const merchants = (await db.merchant.findMany({ where: { NOT: { name: null }, domain: null } })).slice(0, limit);
  if (!merchants.length) return { set: 0 };

  const BATCH = 40;
  let set = 0;
  for (let i = 0; i < merchants.length; i += BATCH) {
    const chunk = merchants.slice(i, i + BATCH);
    const prompt = `For each brand/merchant name, give its primary website domain (just the host, e.g. "tesco.com", "asos.com", "deliveroo.co.uk"). If you don't know, use null. Names:\n${chunk.map((m, j) => `- m${j} | ${m.name}`).join("\n")}\n\nRespond ONLY with a JSON array: [{"id":"m0","domain":"<host or null>"}]`;
    try {
      const raw = await geminiGenerateJson(prompt, audit, i / BATCH + 1);
      const arr = JSON.parse(raw || "[]");
      for (const el of Array.isArray(arr) ? arr : []) {
        const idx = typeof el?.id === "string" ? Number(String(el.id).replace("m", "")) : NaN;
        const m = chunk[idx];
        const domain = typeof el?.domain === "string" ? el.domain.toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").trim() : null;
        if (m && domain && domain.includes(".")) { await db.merchant.update({ where: { token: m.token }, data: { domain } }); set++; }
      }
    } catch (err) {
      audit?.({ kind: "log", text: `  domain batch failed: ${err instanceof Error ? err.message : err}`, tone: "red" });
    }
  }
  if (audit && set) audit({ kind: "log", text: `  ${set} domain${set === 1 ? "" : "s"} set`, tone: "dim" });
  return { set };
}
