import { db } from "./db.ts";
import { rawMerchantName } from "../../shared/merchantName.ts";
import { merchantToken } from "../categorise/helpers.ts";
import { matchDirectory, slugify } from "./merchantDirectory.ts";
import { searchBrandDomain, resolveLogo } from "./logos/providers.ts";
import { ensureLogo } from "./logos/index.ts";
import type { AuditFn } from "../categorise/audit.ts";

// Resolve a brand domain for a (cleaned) merchant name: curated directory first
// (high precision), then a Brandfetch name search, then — for a single
// distinctive word like "Tesco" — the brand.com guess if a provider has it.
// Returns null for anything we can't confidently place (→ monogram).
async function resolveDomainForName(name: string): Promise<string | null> {
  const dir = (await matchDirectory(name)) ?? (await matchDirectory(name.split(/\s+/)[0]));
  if (dir?.domain) return dir.domain;

  const searched = await searchBrandDomain(name);
  if (searched) return searched;

  const words = name.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").trim().split(/\s+/).filter((w) => w.length >= 2);
  if (words.length === 1 && slugify(words[0]).length >= 2) {
    const guess = `${slugify(words[0])}.com`;
    if (await resolveLogo(guess)) return guess;
  }
  return null;
}

// Background, once-per-merchant logo resolution: walks the merchants derived from
// transactions, resolves a domain for each (skipping people/transfers), stores
// the logo in the bucket, and persists `Merchant.domain` so the DTO carries the
// logo URL directly. Idempotent — merchants already resolved/attempted are
// skipped (Merchant.domain set, or logoCheckedAt stamped).
export async function resolveMerchantLogos(audit?: AuditFn, limit = 250): Promise<{ set: number; checked: number }> {
  const txns = await db.transaction.findMany({ select: { merchantName: true, creditorName: true, debtorName: true, remittanceInfo: true, personKey: true, category: true } });

  // Group by merchant token: best raw name, and whether it's ever a person/transfer.
  const groups = new Map<string, { names: Map<string, number>; person: boolean; transfer: boolean }>();
  for (const t of txns) {
    const raw = rawMerchantName(t);
    const tok = merchantToken(raw);
    if (!tok || !raw) continue;
    const g = groups.get(tok) ?? { names: new Map(), person: false, transfer: false };
    g.names.set(raw, (g.names.get(raw) ?? 0) + 1);
    if (t.personKey) g.person = true;
    if (t.category === "transfer" || t.category === "income") g.transfer = true;
    groups.set(tok, g);
  }

  const existing = new Map((await db.merchant.findMany()).map((m) => [m.token, m] as const));

  let set = 0, checked = 0;
  for (const [tok, g] of groups) {
    const ex = existing.get(tok);
    if (ex?.domain || ex?.logoCheckedAt) continue; // already resolved or attempted
    if (checked >= limit) break;
    checked++;

    // Prefer a clean override name; else the token (already de-numbered/trimmed).
    const name = (ex?.name || tok).trim();
    let domain: string | null = null;
    if (!g.person && !g.transfer && name) {
      try { domain = await resolveDomainForName(name); } catch { /* leave null */ }
    }
    if (domain) await ensureLogo(domain, name).catch(() => {});

    await db.merchant.upsert({
      where: { token: tok },
      create: { token: tok, name: ex?.name ?? null, domain, logoCheckedAt: new Date() },
      update: { domain: domain ?? undefined, logoCheckedAt: new Date() },
    });
    if (domain) set++;
    audit?.({ kind: "log", text: `  ${name} → ${domain ?? "—"}`, tone: "dim" });
  }
  if (audit) audit({ kind: "log", text: `  logos: ${set} resolved of ${checked} checked`, tone: "dim" });
  return { set, checked };
}
