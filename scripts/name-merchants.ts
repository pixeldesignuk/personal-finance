// One-off: derive clean merchant names for every merchant in the transaction
// history using Gemini, and store them on the Merchant table.
//   pnpm tsx scripts/name-merchants.ts
import { db } from "../server/lib/db.ts";
import { merchantToken } from "../server/categorise/helpers.ts";
import { nameMerchants } from "../server/categorise/gemini.ts";

const txns = await db.transaction.findMany({ select: { merchantName: true, creditorName: true, debtorName: true, remittanceInfo: true } });
const sample = new Map<string, Map<string, number>>(); // token -> raw line counts
for (const t of txns) {
  const token = merchantToken(t.merchantName ?? t.creditorName ?? t.debtorName ?? t.remittanceInfo ?? null);
  if (!token) continue;
  const raw = t.merchantName ?? t.creditorName ?? t.debtorName ?? t.remittanceInfo ?? token;
  const m = sample.get(token) ?? new Map();
  m.set(raw, (m.get(raw) ?? 0) + 1);
  sample.set(token, m);
}
// Only name merchants that don't already have one (idempotent — re-run to finish
// if the daily Gemini quota cut a run short).
const named = new Set((await db.merchant.findMany({ where: { NOT: { name: null } } })).map((m) => m.token));
const items = [...sample.entries()]
  .filter(([token]) => !named.has(token))
  .map(([token, raws]) => ({ ref: token, text: [...raws.entries()].sort((a, b) => b[1] - a[1])[0][0] }));
console.log(`naming ${items.length} un-named merchants (${named.size} already done)…`);

const names = await nameMerchants(items);
let n = 0;
for (const [token, name] of names) {
  await db.merchant.upsert({ where: { token }, create: { token, name }, update: { name } });
  n++;
}
console.log(`named ${n} merchants. Sample:`);
for (const it of items.slice(0, 12)) console.log(`  ${(names.get(it.ref) ?? "?").padEnd(22)} <- ${it.text.slice(0, 50)}`);
process.exit(0);
