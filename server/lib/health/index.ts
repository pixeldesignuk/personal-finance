import type { AccountHealthDTO, HealthSeverity } from "../../../shared/types.ts";
import type { HealthCheck, HealthContext } from "./types.ts";
import { runwayCheck } from "./checks/runway.ts";
import { cashflowCheck } from "./checks/cashflow.ts";
import { bufferCheck } from "./checks/buffer.ts";
import { trendCheck } from "./checks/trend.ts";

export { avgMonthlyNetFlow } from "./netFlow.ts";
export type { HealthAccount, HealthContext } from "./types.ts";

const CHECKS: HealthCheck[] = [runwayCheck, cashflowCheck, bufferCheck, trendCheck];
const SEV_ORDER: Record<HealthSeverity, number> = { ok: 0, attention: 1, urgent: 2 };
const COLOR: Record<HealthSeverity, AccountHealthDTO["color"]> = { ok: "green", attention: "amber", urgent: "red" };
const HEADLINE: Record<HealthSeverity, string> = { ok: "Healthy", attention: "Needs attention", urgent: "Unhealthy" };

// Run every check over every account; verdict = worst severity; attach ring geometry.
export function computeAccountHealth(ctx: HealthContext): AccountHealthDTO[] {
  return ctx.accounts.map((account) => {
    const checks = CHECKS.map((c) => c(account, ctx)).filter((r) => r != null);
    // Avoid double-counting a liquidity gap: when the account is overdrawn AND the
    // runway check already prescribes a transfer, that transfer covers clearing the
    // overdraft AND the upcoming bills (shortfall = committed − (balance + income),
    // and a negative balance inflates it). So keep the overdraft as a *reason* but
    // drop its duplicate transfer recommendation — one action, not two overlapping.
    if (checks.some((r) => r.key === "runway" && r.severity === "urgent" && r.recommendation)) {
      for (const r of checks) if (r.key === "buffer") r.recommendation = null;
    }
    const verdict = checks.reduce<HealthSeverity>(
      (worst, r) => (SEV_ORDER[r.severity] > SEV_ORDER[worst] ? r.severity : worst), "ok");
    const f = ctx.fundingByAccount.get(account.id);
    return {
      accountId: account.id,
      verdict,
      color: COLOR[verdict],
      headline: HEADLINE[verdict],
      checks,
      ring: { solidFraction: f?.solidFraction ?? 0, dashedFraction: f?.dashedFraction ?? 0 },
    };
  });
}
