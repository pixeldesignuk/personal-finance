import { db } from "../db.ts";
import { env } from "../../env.ts";
import { putObject, storageEnabled } from "../storage.ts";
import { resolveBest } from "./providers.ts";

export { PROVIDERS, resolveLogo, resolveBest } from "./providers.ts";

// Re-check a domain that previously yielded no logo after this long (brands add
// logos; our guess for the domain may also improve).
const STALE_MS = 30 * 86_400_000; // 30 days

const EXT: Record<string, string> = {
  "image/webp": "webp", "image/png": "png", "image/jpeg": "jpg", "image/svg+xml": "svg",
  "image/gif": "gif", "image/x-icon": "ico", "image/vnd.microsoft.icon": "ico",
};
const extFor = (contentType: string) => EXT[contentType] ?? "img";

// Normalise a domain to a safe cache key: lowercase host only, no scheme/path,
// must contain a dot. Returns null for anything that isn't a plausible domain.
export function normalizeDomain(raw: string): string | null {
  const d = raw.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/[^a-z0-9.-]/g, "");
  return d.includes(".") && d.length >= 4 && d.length <= 253 ? d : null;
}

export interface LogoHit { key: string; source: string; color: string | null }

// The repository entry point: return the cached bucket object for a domain,
// resolving + storing it on first request (and refreshing stale misses). Returns
// null when no provider has a logo. Requires object storage to be configured.
export async function ensureLogo(domain: string, name?: string | null, force = false): Promise<LogoHit | null> {
  if (!storageEnabled()) return null;

  const cached = await db.logoCache.findUnique({ where: { domain } });
  if (cached && !force) {
    if (cached.key) return { key: cached.key, source: cached.source ?? "cache", color: cached.color };
    if (Date.now() - cached.checkedAt.getTime() < STALE_MS) return null; // fresh negative cache
  }

  const resolved = await resolveBest(domain, name);
  if (!resolved) {
    await db.logoCache.upsert({
      where: { domain },
      create: { domain, checkedAt: new Date() },
      update: { key: null, source: null, checkedAt: new Date() },
    });
    return null;
  }

  const key = `merchant-logos/${domain}.${extFor(resolved.contentType)}`;
  await putObject(key, resolved.body, resolved.contentType);
  const row = await db.logoCache.upsert({
    where: { domain },
    create: { domain, key, source: resolved.source, checkedAt: new Date() },
    update: { key, source: resolved.source, checkedAt: new Date() },
  });
  return { key, source: resolved.source, color: row.color || null };
}

// ── Brand colour (Brandfetch Brand API) ─────────────────────────────────────
// Distinct from the logo CDN: the Brand API (Bearer key, smaller quota) returns
// official brand colours. We persist into LogoCache.color and use "" as a
// negative marker ("checked, none") so we don't re-spend quota; null = unchecked.

// Perceived luminance (0–255) from a #rrggbb hex.
function luminance(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

function pickBrandColor(colors: unknown): string | null {
  if (!Array.isArray(colors)) return null;
  const valid = colors.filter(
    (c): c is { hex: string; type?: string } =>
      typeof (c as { hex?: unknown })?.hex === "string" && /^#[0-9a-fA-F]{6}$/.test((c as { hex: string }).hex),
  );
  if (!valid.length) return null;
  // Skip near-black/near-white (computed from the hex — the API's brightness
  // field is unreliable) so the tint actually reads as a brand colour.
  const usable = valid.filter((c) => { const l = luminance(c.hex); return l > 26 && l < 226; });
  if (!usable.length) return null; // only black/white available → no usable tint
  const pick = usable.find((c) => c.type === "brand") ?? usable.find((c) => c.type === "accent") ?? usable[0];
  return pick.hex.toLowerCase();
}

// Fetch the brand colour for a domain. Returns a hex, or null for "no colour".
// Throws on rate-limit/transient error so the caller can avoid negative-caching.
async function fetchBrandColor(domain: string): Promise<string | null> {
  const res = await fetch(`https://api.brandfetch.io/v2/brands/${domain}`, {
    headers: { Authorization: `Bearer ${env.BRANDFETCH_API_KEY}` },
  });
  if (res.status === 429 || res.status >= 500) throw new Error(`brandfetch-api ${res.status}`);
  if (!res.ok) return null; // 404 (no brand) → cache as "none"
  const data = (await res.json()) as { colors?: unknown };
  return pickBrandColor(data.colors);
}

export async function ensureBrandColor(domain: string): Promise<string | null> {
  const row = await db.logoCache.findUnique({ where: { domain } });
  if (row && row.color !== null) return row.color || null; // "" = checked, no colour
  if (!env.BRANDFETCH_API_KEY) return null; // can't resolve; stay unchecked so we retry once configured

  let color: string | null;
  try {
    color = await fetchBrandColor(domain);
  } catch {
    return row?.color || null; // rate-limited/transient — don't negative-cache, retry later
  }
  await db.logoCache.upsert({
    where: { domain },
    create: { domain, color: color ?? "", checkedAt: new Date() },
    update: { color: color ?? "" },
  });
  return color;
}
