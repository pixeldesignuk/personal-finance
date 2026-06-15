// One-time (per merchant) background logo resolution: directory → Brandfetch →
// guess, persisted to Merchant.domain so the UI shows it. Idempotent/resumable.
//
//   export $(grep -E '^(DATABASE_URL|RAILWAY_BUCKET|RAILWAY_BUCKEY|BRANDFETCH|LOGODEV|APP_BASE_URL)=' .env | xargs)
//   pnpm tsx scripts/resolve-merchant-logos.ts            # all (250/run default raised below)
//   pnpm tsx scripts/resolve-merchant-logos.ts --limit 30 # a slice
import { db } from "../server/lib/db.ts";
import { resolveMerchantLogos } from "../server/lib/resolveMerchantLogos.ts";

const i = process.argv.indexOf("--limit");
const limit = i >= 0 ? Number(process.argv[i + 1]) : 100000;

async function main() {
  const audit = (e: { text?: string }) => { if (e.text) console.log(e.text); };
  const { set, checked } = await resolveMerchantLogos(audit, limit);
  console.log(`Done. ${set} domains resolved across ${checked} merchants.`);
  await db.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
