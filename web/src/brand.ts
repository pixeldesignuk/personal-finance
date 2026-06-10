// Resolve a merchant logo URL. Prefer an explicit brand domain; otherwise guess
// one from the friendly name. The logo CDN 404s on a miss, so BrandLogo falls
// back to its monogram — no broken images.
export function merchantLogo(name: string | null, domain: string | null): string | null {
  const d = domain?.trim() || guessDomain(name);
  return d ? `https://logo.clearbit.com/${d}` : null;
}

function guessDomain(name: string | null): string | null {
  if (!name) return null;
  const slug = name.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]/g, "");
  return slug.length >= 2 ? `${slug}.com` : null;
}
