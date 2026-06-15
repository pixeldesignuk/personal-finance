// Seed the region-tenanted MerchantDirectory from the Name Suggestion Index
// (curated brand names) + Wikidata (official-website domains), then fetch & store
// each logo in the bucket via the existing logo pipeline. Idempotent + resumable
// — rows already carrying a logoKey are skipped.
//
//   export $(grep -E '^(DATABASE_URL|RAILWAY_BUCKET|BRANDFETCH|LOGODEV|APP_BASE_URL)=' .env | xargs)
//   pnpm tsx scripts/seed-merchant-directory.ts            # UK, all
//   pnpm tsx scripts/seed-merchant-directory.ts --limit 50 # a slice (testing)
import { db } from "../server/lib/db.ts";
import { storageEnabled } from "../server/lib/storage.ts";
import { ensureLogo } from "../server/lib/logos/index.ts";
import { slugify } from "../server/lib/merchantDirectory.ts";

const REGION = "UK";
const NSI_URL = "https://cdn.jsdelivr.net/npm/name-suggestion-index/dist/nsi.min.json";
const SPARQL = "https://query.wikidata.org/sparql";
const UA = "LedgerPersonalFinance/1.0 (merchant logo seeding)";
const LIMIT = (() => { const i = process.argv.indexOf("--limit"); return i >= 0 ? Number(process.argv[i + 1]) : Infinity; })();

interface Brand { name: string; brand: string; wikidata: string }

// Pull UK-relevant brands (locationSet includes "gb" or worldwide "001") with a
// Wikidata id, deduped by id.
async function loadBrands(): Promise<Brand[]> {
  const res = await fetch(NSI_URL);
  const data = (await res.json()) as { nsi: Record<string, { items: { tags: Record<string, string>; locationSet?: { include?: string[] } }[] }> };
  const byId = new Map<string, Brand>();
  for (const cat of Object.values(data.nsi)) {
    for (const it of cat.items) {
      const inc = it.locationSet?.include ?? [];
      if (!inc.includes("gb") && !inc.includes("001")) continue;
      const wikidata = it.tags["brand:wikidata"];
      const name = it.tags.name || it.tags.brand;
      if (!wikidata || !name || byId.has(wikidata)) continue;
      byId.set(wikidata, { name, brand: it.tags.brand || name, wikidata });
    }
  }
  return [...byId.values()];
}

// Resolve official-website domains for a batch of Wikidata ids (P856).
async function resolveDomains(ids: string[]): Promise<Map<string, string>> {
  const values = ids.map((q) => `wd:${q}`).join(" ");
  const query = `SELECT ?item ?site WHERE { VALUES ?item { ${values} } ?item wdt:P856 ?site. }`;
  const res = await fetch(SPARQL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/sparql-results+json", "User-Agent": UA },
    body: `query=${encodeURIComponent(query)}`,
  });
  if (!res.ok) { console.error(`  SPARQL ${res.status}`); return new Map(); }
  const json = (await res.json()) as { results: { bindings: { item: { value: string }; site: { value: string } }[] } };
  const out = new Map<string, string>();
  for (const b of json.results.bindings) {
    const id = b.item.value.split("/").pop()!;
    try { const host = new URL(b.site.value).hostname.replace(/^www\./, "").toLowerCase(); if (host.includes(".") && !out.has(id)) out.set(id, host); } catch { /* skip */ }
  }
  return out;
}

async function main() {
  if (!storageEnabled()) { console.error("Object storage not configured (RAILWAY_BUCKET_*). Aborting."); process.exit(1); }

  console.log("Fetching NSI…");
  const brands = (await loadBrands()).slice(0, LIMIT === Infinity ? undefined : LIMIT);
  console.log(`${brands.length} UK brands to consider.`);

  // Skip brands already fully seeded (have a logoKey).
  const done = new Set((await db.merchantDirectory.findMany({ where: { region: REGION, logoKey: { not: null } }, select: { wikidata: true } })).map((r) => r.wikidata).filter(Boolean) as string[]);
  const todo = brands.filter((b) => !done.has(b.wikidata));
  console.log(`${todo.length} remaining (${done.size} already have a logo).`);

  let withLogo = 0, noDomain = 0, noLogo = 0;
  for (let i = 0; i < todo.length; i += 150) {
    const chunk = todo.slice(i, i + 150);
    const domains = await resolveDomains(chunk.map((b) => b.wikidata));
    for (const b of chunk) {
      const domain = domains.get(b.wikidata) ?? null;
      const slug = slugify(b.name);
      if (!slug) continue;
      const aliases = slugify(b.brand) !== slug ? [slugify(b.brand)] : [];
      let logoKey: string | null = null, color: string | null = null;
      if (domain) {
        const hit = await ensureLogo(domain, b.name).catch(() => null);
        if (hit) { logoKey = hit.key; color = hit.color; withLogo++; } else noLogo++;
      } else noDomain++;
      await db.merchantDirectory.upsert({
        where: { region_slug: { region: REGION, slug } },
        create: { region: REGION, name: b.name, slug, aliases, domain, logoKey, color, wikidata: b.wikidata },
        update: { name: b.name, aliases, domain, logoKey, color, wikidata: b.wikidata, updatedAt: new Date() },
      });
    }
    console.log(`  …${Math.min(i + 150, todo.length)}/${todo.length} (logos ${withLogo}, no-domain ${noDomain}, no-logo ${noLogo})`);
  }
  console.log(`Done. ${withLogo} logos stored, ${noDomain} without a domain, ${noLogo} domain-but-no-logo.`);
  await db.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
