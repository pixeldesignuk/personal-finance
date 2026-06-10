import { db } from "./db.ts";
import { merchantToken } from "../categorise/helpers.ts";
import { nameMerchants } from "../categorise/gemini.ts";
import type { AuditFn } from "../categorise/audit.ts";

const tokenOf = (t: { merchantName: string | null; creditorName: string | null; debtorName: string | null; remittanceInfo: string | null }) =>
  merchantToken(t.merchantName ?? t.creditorName ?? t.debtorName ?? t.remittanceInfo ?? null);

// Give every still-unnamed merchant a clean brand name via Gemini, derived from
// its raw statement line (e.g. "GREGGS PLC OLDHAM" -> "Greggs"). Only processes
// merchants without a name, so steady-state syncs only touch the few new ones.
// No-op without a Gemini key.
export async function autoNameMerchants(audit?: AuditFn, limit = 120): Promise<{ named: number }> {
  const named = new Set((await db.merchant.findMany({ where: { NOT: { name: null } }, select: { token: true } })).map((m) => m.token));
  const txns = await db.transaction.findMany({ select: { merchantName: true, creditorName: true, debtorName: true, remittanceInfo: true } });

  const byToken = new Map<string, string>(); // token -> representative statement line
  for (const t of txns) {
    const tok = tokenOf(t);
    if (!tok || named.has(tok) || byToken.has(tok)) continue;
    const raw = t.merchantName ?? t.creditorName ?? t.debtorName ?? t.remittanceInfo ?? "";
    if (raw.trim()) byToken.set(tok, raw);
  }
  const items = [...byToken.entries()].slice(0, limit).map(([ref, text]) => ({ ref, text }));
  if (!items.length) return { named: 0 };

  const names = await nameMerchants(items); // Map token -> clean name
  let count = 0;
  for (const [token, name] of names) {
    await db.merchant.upsert({ where: { token }, create: { token, name }, update: { name } });
    count++;
  }
  if (audit && count) audit({ kind: "log", text: `  ${count} merchant${count === 1 ? "" : "s"} named`, tone: "dim" });
  return { named: count };
}
