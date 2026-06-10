// Re-validate existing order↔transaction matches with the tightened rule
// (merchant must relate, amount within £0.75). Unmatches false positives so the
// next sync's re-match pass can re-link them correctly.
// Run: pnpm tsx scripts/fix-order-matches.ts
import "dotenv/config";
import { db } from "../server/lib/db.ts";
import { merchantToken } from "../server/categorise/helpers.ts";

const related = (a: string | null, b: string | null) => Boolean(a && b && (a === b || a.includes(b) || b.includes(a)));

async function main() {
  const orders = await db.emailOrder.findMany({ where: { transactionId: { not: null }, total: { not: null } } });
  const named = await db.merchant.findMany({ where: { NOT: { name: null } }, select: { token: true, name: true } });
  const friendly = new Map(named.map((m) => [m.token, merchantToken(m.name)]));
  let unmatched = 0;
  for (const o of orders) {
    const t = await db.transaction.findUnique({ where: { id: o.transactionId! }, select: { amount: true, merchantName: true, creditorName: true, debtorName: true, remittanceInfo: true } });
    const token = t ? merchantToken(t.merchantName ?? t.creditorName ?? t.debtorName ?? t.remittanceInfo ?? null) : null;
    const friendlyTok = token ? friendly.get(token) ?? null : null;
    const ok = t
      && Math.abs(Math.abs(Number(t.amount)) - Number(o.total!.toString())) <= 0.75
      && (related(o.merchantToken, token) || related(o.merchantToken, friendlyTok));
    if (!ok) {
      await db.emailOrder.update({ where: { id: o.id }, data: { transactionId: null, matched: false } });
      console.log(`✗ unmatched ${o.merchantName} £${o.total} (was on a transaction it doesn't relate to)`);
      unmatched++;
    }
  }
  console.log(`Done. Unmatched ${unmatched}/${orders.length} bad links.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
