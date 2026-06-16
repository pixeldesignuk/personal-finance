// Best-effort: fetch GoCardless account details for BANK accounts that have no
// cashAccountType yet and store it. PSD2-rate-limited, so it skips accounts already
// typed and tolerates per-account failures. Run:
//   export $(grep -E '^(DATABASE_URL|GOCARDLESS)' .env | xargs) && pnpm tsx scripts/backfill-account-types.ts
import { db } from "../server/lib/db.ts";
import { GoCardlessClient } from "../server/gocardless/client.ts";

async function main() {
  const gc = new GoCardlessClient();
  const accounts = await db.account.findMany({ where: { source: "BANK", cashAccountType: null } });
  console.log(`Backfilling cashAccountType for ${accounts.length} account(s)…`);
  for (const a of accounts) {
    try {
      const type = (await gc.getAccountDetails(a.id)).account?.cashAccountType;
      if (type) {
        await db.account.update({ where: { id: a.id }, data: { cashAccountType: type } });
        console.log(`  ${a.id}: ${type}`);
      } else {
        console.log(`  ${a.id}: (no type returned)`);
      }
    } catch (e) {
      console.log(`  ${a.id}: failed — ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  await db.$disconnect();
}

main();
