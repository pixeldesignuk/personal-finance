import { db } from "./db.ts";

// Normalise a name to a match key: lowercase, alphanumeric only (so "Uber Eats",
// "uber-eats" and "UBER  EATS" all collapse to "ubereats").
export function slugify(name: string | null | undefined): string {
  return (name ?? "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "");
}

export interface DirEntry { name: string; domain: string | null; logoKey: string | null; color: string | null }

// In-memory directory index per region (a few thousand rows — cheap to hold).
// Re-read periodically so a running server picks up newly-seeded brands.
const TTL_MS = 5 * 60_000;
let cache: { region: string; at: number; bySlug: Map<string, DirEntry> } | null = null;

async function index(region: string): Promise<Map<string, DirEntry>> {
  if (cache && cache.region === region && Date.now() - cache.at < TTL_MS) return cache.bySlug;
  const rows = await db.merchantDirectory.findMany({ where: { region } });
  const bySlug = new Map<string, DirEntry>();
  for (const r of rows) {
    const e: DirEntry = { name: r.name, domain: r.domain, logoKey: r.logoKey, color: r.color };
    bySlug.set(r.slug, e);
    for (const a of r.aliases) if (!bySlug.has(a)) bySlug.set(a, e);
  }
  cache = { region, at: Date.now(), bySlug };
  return bySlug;
}

export function invalidateDirectory(): void { cache = null; }

// Match a (cleaned) merchant name against the index: exact whole-name slug first,
// then the first 1–2 words (so "Tesco Stores"/"Tesco Express" → "tesco", "Amazon
// UK" → "amazon"). First-word match requires ≥3 chars to avoid stray hits.
function lookup(bySlug: Map<string, DirEntry>, name: string | null): DirEntry | null {
  const whole = slugify(name);
  if (whole.length < 2) return null;
  const exact = bySlug.get(whole);
  if (exact) return exact;
  const words = (name ?? "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (words.length >= 2) {
    const two = bySlug.get(slugify(words.slice(0, 2).join("")));
    if (two) return two;
    const one = words[0].length >= 3 ? bySlug.get(slugify(words[0])) : null;
    if (one) return one;
  }
  return null;
}

// Match a (cleaned) merchant name to a directory brand, or null. High precision —
// a person's name resolves to nothing.
export async function matchDirectory(name: string | null, region = "UK"): Promise<DirEntry | null> {
  return lookup(await index(region), name);
}

// The stable logo URL for a name (our own endpoint, served from the bucket-cached
// object), or null when the merchant isn't a known brand. No provider call or
// domain guess happens at render time.
export async function directoryLogoUrl(name: string | null, region = "UK"): Promise<string | null> {
  const e = await matchDirectory(name, region);
  return e?.domain && e.logoKey ? `/api/logo/${encodeURIComponent(e.domain)}` : null;
}

// Batch helper for DTO lists: returns a name→logoUrl resolver over one index load.
export async function logoUrlResolver(region = "UK"): Promise<(name: string | null) => string | null> {
  const bySlug = await index(region);
  return (name) => {
    const e = lookup(bySlug, name);
    return e?.domain && e.logoKey ? `/api/logo/${encodeURIComponent(e.domain)}` : null;
  };
}
