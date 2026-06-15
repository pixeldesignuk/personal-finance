// One-off backfill: detect & mark existing refund transactions so they drop out
// of review and onto the budget's Refunds line. Idempotent — safe to re-run.
//   export $(grep -E '^DATABASE_URL=' .env | xargs) && pnpm tsx scripts/backfill-refunds.ts
import { backfillRefunds } from "../server/lib/refundDetect.ts";

const marked = await backfillRefunds();
console.log(`Marked ${marked} transaction(s) as refunds.`);
process.exit(0);
