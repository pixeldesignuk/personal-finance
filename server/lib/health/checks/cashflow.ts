import type { HealthCheck } from "../types.ts";
import { money, round2 } from "../recommend.ts";

// Over recent complete months, does more leave this account than arrives? A
// recurring drain — a one-off transfer won't fix it, so the advice is structural.
export const cashflowCheck: HealthCheck = (account, ctx) => {
  const net = ctx.netFlowByAccount.get(account.id);
  if (net == null || net >= 0) return null;
  const out = round2(-net);
  if (account.isCreditCard) {
    return { key: "cashflow", severity: "attention", title: "Card balance growing",
      why: `On average £${money(out)}/mo more is charged than paid off`,
      recommendation: "Pay off more than you spend on this card to stop the balance growing" };
  }
  return { key: "cashflow", severity: "attention", title: "Cashflow",
    why: `On average £${money(out)}/mo more goes out than comes in`,
    recommendation: "Move a recurring bill to an account with spare cash, or trim your biggest discretionary spend" };
};
