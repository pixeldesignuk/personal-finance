export interface Rule {
  matchText: string;
  categoryKey: string | null;
  personKey: string | null;
  priority: number;
}

export function slug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Fold to lowercase and turn every run of non-alphanumerics into a single
// space. This MUST mirror how merchantToken builds tokens (which also maps
// punctuation to spaces): a rule's matchText is compared as a substring here,
// so if matching kept punctuation that tokenisation dropped, a token like
// "obsidian md" (from "OBSIDIAN.MD") would never match the raw "OBSIDIAN.MD"
// line. Also makes matching robust to bank data that pads names with spaces.
export function normalizeText(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

// Derive the matchText for a rule built from a merchant identity token.
//
// Some banks prefix foreign card payments with an international-card processor
// marker and a per-payment reference: "INT'L <ref> <MERCHANT> …" or
// "INTL CARD <ref> <MERCHANT> …". The merchant's IDENTITY token keeps that
// marker (it's a stable grouping key — the reference, being a number, is
// already dropped), but a rule must MATCH on a substring of the live statement
// line, where the reference still sits between the marker and the merchant.
// So "int l obsidian" as matchText never matches "INT'L 2081438168 OBSIDIAN".
// Strip the marker (and any reference that survived into the token) so the
// matchText starts at the real merchant name.
//
// "INT'L" loses its apostrophe to a space during token cleaning, so the marker
// appears as the two-word "int l" — distinctive enough to strip unconditionally.
// Bare "intl" (no space) is ambiguous with real names ("Intl Foods"), so it is
// only stripped when followed by "card" or a digit-bearing reference.
export function ruleMatchText(token: string): string {
  const stripped = token
    .replace(/^int l(?: +[a-z0-9]*\d[a-z0-9]*)? +/, "")
    .replace(/^intl(?: card)? +[a-z0-9]*\d[a-z0-9]* +/, "");
  return stripped || token;
}

export function applyRules(text: string, rules: Rule[]): { categoryKey?: string; personKey?: string } {
  const hay = normalizeText(text);
  const ordered = [...rules].sort((a, b) => b.priority - a.priority);
  let categoryKey: string | undefined;
  let personKey: string | undefined;
  for (const r of ordered) {
    if (!r.matchText || !hay.includes(normalizeText(r.matchText))) continue;
    if (categoryKey === undefined && r.categoryKey) categoryKey = r.categoryKey;
    if (personKey === undefined && r.personKey) personKey = r.personKey;
    if (categoryKey !== undefined && personKey !== undefined) break;
  }
  return { categoryKey, personKey };
}
