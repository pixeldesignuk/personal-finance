import { env } from "../../env.ts";

// A logo source. `url(domain)` is the candidate image URL; `serverHeaders()` are
// any headers we must send when fetching it server-side (Brandfetch's CDN gates
// non-browser hotlinks behind a Referer matching an allowed origin).
export interface LogoProvider {
  name: string;
  enabled(): boolean;
  url(domain: string): string;
  serverHeaders?(): Record<string, string>;
}

const brandfetch: LogoProvider = {
  name: "brandfetch",
  enabled: () => Boolean(env.BRANDFETCH_CLIENT_ID),
  // Square brand ICON, 128px, 404 on a miss (so we fall through to the next
  // provider instead of getting Brandfetch's house placeholder).
  url: (d) => `https://cdn.brandfetch.io/${d}/icon/w/128/h/128/fallback/404?c=${env.BRANDFETCH_CLIENT_ID}`,
  // The CDN gates non-browser hotlinks on BOTH a whitelisted Referer and a
  // browser User-Agent — without the UA it serves an HTML guidelines page.
  serverHeaders: () => ({
    Referer: `${env.APP_BASE_URL}/`,
    Origin: env.APP_BASE_URL,
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
  }),
};

const logodev: LogoProvider = {
  name: "logodev",
  enabled: () => Boolean(env.LOGODEV_TOKEN),
  url: (d) => `https://img.logo.dev/${d}?token=${env.LOGODEV_TOKEN}&size=128&format=png&retina=true`,
};

const duckduckgo: LogoProvider = {
  name: "duckduckgo",
  enabled: () => true, // keyless favicon fallback
  url: (d) => `https://icons.duckduckgo.com/ip3/${d}.ico`,
};

// Quality order: real brand icon → logo.dev → favicon.
export const PROVIDERS: LogoProvider[] = [brandfetch, logodev, duckduckgo];

export interface ResolvedLogo { body: Buffer; contentType: string; source: string }

// Walk the enabled providers for a domain; the first that returns a real image
// (image content-type, non-trivial size) wins. Returns null if none have it.
export async function resolveLogo(domain: string): Promise<ResolvedLogo | null> {
  for (const p of PROVIDERS) {
    if (!p.enabled()) continue;
    try {
      const res = await fetch(p.url(domain), { headers: p.serverHeaders?.(), redirect: "follow" });
      if (!res.ok) continue;
      const contentType = (res.headers.get("content-type") ?? "").split(";")[0].trim();
      if (!contentType.startsWith("image/")) continue; // e.g. a redirect to an HTML guidelines page
      const body = Buffer.from(await res.arrayBuffer());
      if (body.length < 100) continue; // reject 1px / empty placeholders
      return { body, contentType, source: p.name };
    } catch {
      // network/abort — try the next provider
    }
  }
  return null;
}

// ── Name → domain fallback (Brandfetch Search API) ──────────────────────────
// When the guessed domain misses (e.g. "Dodl by AJ Bell" → dodlbyajbell.com,
// which doesn't exist), resolve the brand by NAME and pick the result whose name
// best matches — Brandfetch indexes it under dodl.co.uk.
const STOPWORDS = new Set(["by", "the", "and", "ltd", "plc", "inc", "co", "uk", "limited", "llc", "group"]);
function nameTokens(s: string): string[] {
  return s.toLowerCase().replace(/&/g, " and ").split(/[^a-z0-9]+/).filter((t) => {
    if (t.length < 2 || STOPWORDS.has(t)) return false;
    // Drop reference-code-like tokens (e.g. "XB2QWFL", "FE6B68TR") — a digit plus
    // length ≥5. Keeps short alphanumerics like O2 / 3M.
    if (t.length >= 5 && /\d/.test(t)) return false;
    return true;
  });
}

async function searchBrandfetch(query: string): Promise<{ name: string; domain: string }[]> {
  if (!env.BRANDFETCH_CLIENT_ID) return [];
  try {
    const res = await fetch(`https://api.brandfetch.io/v2/search/${encodeURIComponent(query)}?c=${env.BRANDFETCH_CLIENT_ID}`);
    if (!res.ok) return [];
    const arr = (await res.json()) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((b): b is { name: string; domain: string } => typeof (b as { domain?: unknown })?.domain === "string" && typeof (b as { name?: unknown })?.name === "string")
      .map((b) => ({ name: b.name, domain: b.domain }));
  } catch {
    return [];
  }
}

// Resolve a merchant name to its brand domain via search, or null. Only attempts
// names with ≥2 meaningful tokens (single words like "amex" are too ambiguous),
// and requires a strong name match so we don't grab an unrelated brand.
export async function searchBrandDomain(name: string): Promise<string | null> {
  const qTokens = nameTokens(name);
  if (qTokens.length < 2) return null;
  const qSet = new Set(qTokens);

  // The full phrase often returns nothing; also probe the longest single token.
  const longest = [...qTokens].sort((a, b) => b.length - a.length)[0];
  const queries = [...new Set([qTokens.join(" "), longest])];

  const candidates: { name: string; domain: string }[] = [];
  for (const q of queries) {
    candidates.push(...(await searchBrandfetch(q)));
    if (candidates.length >= 12) break;
  }

  let best: { domain: string; score: number } | null = null;
  for (const c of candidates) {
    const cset = new Set(nameTokens(c.name));
    if (!cset.size) continue;
    let inter = 0;
    for (const t of cset) if (qSet.has(t)) inter++;
    const jaccard = inter / new Set([...cset, ...qSet]).size;
    const sharedStrong = [...cset].some((t) => qSet.has(t) && t.length >= 3);
    if (jaccard >= 0.5 && sharedStrong && (!best || jaccard > best.score)) best = { domain: c.domain.toLowerCase(), score: jaccard };
  }
  return best?.domain ?? null;
}

// Resolve the best logo for a (domain, name): try the domain's providers first;
// on a miss, fall back to a name search → the matched brand's domain.
export async function resolveBest(domain: string, name?: string | null): Promise<ResolvedLogo | null> {
  const direct = await resolveLogo(domain);
  if (direct) return direct;
  if (!name) return null;
  const searched = await searchBrandDomain(name);
  if (searched && searched !== domain) return resolveLogo(searched);
  return null;
}
