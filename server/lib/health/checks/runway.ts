import type { HealthCheck } from "../types.ts";
import { money, round2, recommendTransfer } from "../recommend.ts";

// Will the balance (plus any incoming pay) cover the bills committed to this
// account before the next payday? Wraps the funding numbers.
export const runwayCheck: HealthCheck = (account, ctx) => {
  if (account.isCreditCard) return null; // a card isn't funded from its own balance
  const f = ctx.fundingByAccount.get(account.id);
  if (!f || f.committed === 0) {
    return { key: "runway", severity: "ok", title: "Runway to payday",
      why: "Nothing due before your next payday", recommendation: null };
  }
  if (f.balance >= f.committed) {
    return { key: "runway", severity: "ok", title: "Runway to payday",
      why: `Covered for the £${money(round2(f.committed))} of bills due before payday`, recommendation: null };
  }
  const reachable = round2(f.balance + f.incomeIncoming);
  const shortfall = round2(f.committed - reachable);
  if (shortfall > 0) {
    return { key: "runway", severity: "urgent", title: "Runway to payday",
      why: `£${money(shortfall)} short for bills due before payday`,
      recommendation: recommendTransfer(ctx, account.id, shortfall) };
  }
  // Today's balance doesn't cover it, but the incoming paycheck does.
  return { key: "runway", severity: "attention", title: "Runway to payday",
    why: `Bills before payday exceed your balance by £${money(round2(f.committed - f.balance))}, but your incoming pay covers it`,
    recommendation: null };
};
