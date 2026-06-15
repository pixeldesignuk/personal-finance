// Merchant logos come from the server: either the DTO's `logoUrl` (a verified
// directory brand) or, for an explicitly-set domain, our /api/logo endpoint. We
// no longer GUESS a domain from a name — that mis-fired on people (a transfer to
// "Shaukat Ali" resolved to a same-named shop). Unknown names → monogram.
export function merchantLogo(_name: string | null, domain: string | null): string[] {
  const d = domain?.trim();
  return d ? [`/api/logo/${encodeURIComponent(d)}`] : [];
}
