import type { HealthCheck } from "../types.ts";
import { money, round2, recommendTransfer } from "../recommend.ts";

// Is the account overdrawn? (A configurable cushion above £0 is deferred — v1
// flags only a genuine negative balance.)
export const bufferCheck: HealthCheck = (account, ctx) => {
  if (account.isCreditCard) return null; // a negative card balance is debt, not an overdraft
  if (account.balance >= 0) return null;
  const amount = round2(-account.balance);
  return { key: "buffer", severity: "urgent", title: "Overdrawn",
    why: `Overdrawn by £${money(amount)}`,
    recommendation: recommendTransfer(ctx, account.id, amount) };
};
