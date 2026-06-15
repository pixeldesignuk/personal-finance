// Pre-resolve + cache merchant logos so they're already in the bucket before
// anyone views them. Walks every distinct merchant domain (explicit domains
// first, then a guess from the name) and primes the LogoCache.
//
//   export $(grep -E '^(DATABASE_URL|RAILWAY_BUCKET|BRANDFETCH|LOGODEV|APP_BASE_URL)' .env | xargs)
//   pnpm tsx scripts/warm-logos.ts
//
// Idempotent — cached hits and fresh misses are skipped.
import { db } from "../server/lib/db.ts";
import { ensureLogo, normalizeDomain } from "../server/lib/logos/index.ts";
import { storageEnabled } from "../server/lib/storage.ts";

function guessDomain(name: string | null): string | null {
  if (!name) return null;
  const slug = name.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]/g, "");
  return slug.length >= 2 ? `${slug}.com` : null;
}

async function main() {
  if (!storageEnabled()) { console.error("Object storage not configured (RAILWAY_BUCKET_*). Aborting."); process.exit(1); }

  const merchants = await db.merchant.findMany({ select: { name: true, domain: true } });
  const domains = new Set<string>();
  for (const m of merchants) {
    const d = normalizeDomain(m.domain || guessDomain(m.name) || "");
    if (d) domains.add(d);
  }

  console.log(`Warming ${domains.size} domains…`);
  let hit = 0, miss = 0;
  for (const d of domains) {
    const r = await ensureLogo(d);
    if (r) { hit++; console.log(`  ✓ ${d}  (${r.source})`); }
    else { miss++; console.log(`  · ${d}  (no logo)`); }
  }
  console.log(`Done. ${hit} cached, ${miss} without a logo.`);
  await db.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
