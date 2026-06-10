// Determine each named merchant's official website domain via Gemini, for logos.
// Idempotent: only fills merchants that have a name but no domain.
// Run: pnpm tsx scripts/name-merchant-domains.ts
import "dotenv/config";
import { db } from "../server/lib/db.ts";
import { geminiGenerateJson, geminiEnabled } from "../server/categorise/gemini.ts";

async function main() {
  if (!geminiEnabled()) { console.log("No GEMINI_API_KEY."); return; }
  const merchants = await db.merchant.findMany({ where: { NOT: { name: null }, domain: null } });
  if (!merchants.length) { console.log("Nothing to do."); return; }
  console.log(`Resolving domains for ${merchants.length} merchants…`);

  const BATCH = 40;
  let set = 0;
  for (let i = 0; i < merchants.length; i += BATCH) {
    const chunk = merchants.slice(i, i + BATCH);
    const prompt = `For each brand/merchant name, give its primary website domain (just the host, e.g. "tesco.com", "asos.com", "deliveroo.co.uk"). If you don't know, use null. Names:\n${chunk.map((m, j) => `- m${j} | ${m.name}`).join("\n")}\n\nRespond ONLY with a JSON array: [{"id":"m0","domain":"<host or null>"}]`;
    try {
      const raw = await geminiGenerateJson(prompt, undefined, i / BATCH + 1);
      const arr = JSON.parse(raw || "[]");
      for (const el of Array.isArray(arr) ? arr : []) {
        const idx = typeof el?.id === "string" ? Number(el.id.replace("m", "")) : NaN;
        const m = chunk[idx];
        const domain = typeof el?.domain === "string" ? el.domain.toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").trim() : null;
        if (m && domain && domain.includes(".")) {
          await db.merchant.update({ where: { token: m.token }, data: { domain } });
          console.log(`  ${m.name} → ${domain}`);
          set++;
        }
      }
    } catch (err) {
      console.error("batch failed:", err instanceof Error ? err.message : err);
    }
  }
  console.log(`Done. Set ${set} domains.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
