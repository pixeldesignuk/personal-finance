// Backfill institutionLogo on existing requisitions by matching their
// institutionId against the live GoCardless institutions list.
// Run: pnpm tsx scripts/backfill-institution-logos.ts
import "dotenv/config";
import { db } from "../server/lib/db.ts";
import { GoCardlessClient } from "../server/gocardless/client.ts";

const gc = new GoCardlessClient();

async function main() {
  const reqs = await db.requisition.findMany();
  if (!reqs.length) { console.log("No requisitions to backfill."); return; }
  const institutions = await gc.getInstitutions("gb");
  const logoById = new Map(institutions.map((i) => [i.id, i.logo ?? null]));

  let updated = 0;
  for (const r of reqs) {
    const logo = logoById.get(r.institutionId) ?? null;
    if (!logo || r.institutionLogo === logo) continue;
    await db.requisition.update({ where: { id: r.id }, data: { institutionLogo: logo } });
    console.log(`✓ ${r.institutionName} → ${logo}`);
    updated++;
  }
  console.log(`Done. Updated ${updated}/${reqs.length} requisitions.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
