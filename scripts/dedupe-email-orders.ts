// Collapse duplicate EmailOrders left by repeat emails (order confirmation +
// dispatch/receipt for the same purchase). Keeps one canonical row per
// signature (prefer a matched one); the rest get total nulled so they're hidden
// from the Orders list and won't be matched — but stay recorded by messageId.
// Run: pnpm tsx scripts/dedupe-email-orders.ts
import "dotenv/config";
import { db } from "../server/lib/db.ts";

const sig = (token: string | null, total: number, orderNo: string | null, date: Date | null) =>
  orderNo ? `${token}|${total}|${orderNo.toLowerCase().replace(/\s+/g, "")}` : `${token}|${total}|${date ? date.toISOString().slice(0, 10) : ""}`;

async function main() {
  const rows = await db.emailOrder.findMany({ where: { total: { not: null } }, orderBy: { createdAt: "asc" } });
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const k = sig(r.merchantToken, Number(r.total!.toString()), r.orderNumber, r.emailDate);
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(r);
  }
  let collapsed = 0;
  for (const [, grp] of groups) {
    if (grp.length < 2) continue;
    const keep = grp.find((r) => r.matched) ?? grp[0];
    for (const r of grp) {
      if (r.id === keep.id) continue;
      await db.emailOrder.update({ where: { id: r.id }, data: { total: null, matched: false, transactionId: null } });
      collapsed++;
    }
    console.log(`· ${keep.merchantName ?? keep.merchantToken} £${keep.total} — kept 1, hid ${grp.length - 1}`);
  }
  console.log(`Done. Hid ${collapsed} duplicate order rows.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
