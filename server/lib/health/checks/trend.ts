import type { HealthCheck } from "../types.ts";
import { money, round2 } from "../recommend.ts";

const MONTHS = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

// At the recent drain rate, when does this account hit £0? Warns when that's near.
// Shares the cashflow net-flow figure; defers overdrawn accounts to the buffer check.
export const trendCheck: HealthCheck = (account, ctx) => {
  const net = ctx.netFlowByAccount.get(account.id);
  if (net == null || net >= 0) return null;
  if (account.balance <= 0) return null;
  const monthsToZero = account.balance / -net;
  if (monthsToZero >= 3) return null;
  const ahead = Math.max(1, Math.ceil(monthsToZero)); // you reach £0 *by* this month
  const when = MONTHS[new Date(ctx.today.getFullYear(), ctx.today.getMonth() + ahead, 1).getMonth()];
  return { key: "trend", severity: monthsToZero < 1 ? "urgent" : "attention", title: "Balance trend",
    why: `Declining ~£${money(round2(-net))}/mo — on track to reach £0 around ${when}`,
    recommendation: "Slow the drain or top this account up before then" };
};
