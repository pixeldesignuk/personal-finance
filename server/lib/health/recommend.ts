import type { HealthAccount, HealthContext, Source } from "./types.ts";

export const round2 = (n: number) => Math.round(n * 100) / 100;
export const money = (n: number) => n.toFixed(2);

// Cash an account could spare = its balance minus its own committed bills.
export function freeCash(account: HealthAccount, ctx: HealthContext): number {
  const committed = ctx.fundingByAccount.get(account.id)?.committed ?? 0;
  return round2(account.balance - committed);
}

// The best account to move money FROM to cover a gap on `accountId`. Prefer a
// source that can cover the whole amount in one move; among those (or, if none
// can, among all candidates) prefer savings-ish (informational), then most free cash.
export function pickSource(ctx: HealthContext, accountId: string, amount: number): Source | null {
  const candidates = ctx.accounts
    .filter((a) => a.id !== accountId)
    .map((a) => ({ id: a.id, name: a.name, informational: a.informational, available: freeCash(a, ctx) }))
    .filter((c) => c.available > 0);
  if (!candidates.length) return null;
  const covers = candidates.filter((c) => c.available >= amount);
  const pool = covers.length ? covers : candidates;
  pool.sort((x, y) => (Number(y.informational) - Number(x.informational)) || (y.available - x.available));
  const top = pool[0];
  return { id: top.id, name: top.name, available: top.available };
}

// A concrete recommendation string for covering `amount` on `accountId`.
export function recommendTransfer(ctx: HealthContext, accountId: string, amount: number): string {
  const src = pickSource(ctx, accountId, amount);
  if (!src) return `Top up £${money(amount)} to cover it`;
  if (src.available >= amount) return `Move £${money(amount)} from ${src.name}`;
  const rest = round2(amount - src.available);
  return `Move £${money(src.available)} from ${src.name} and top up £${money(rest)}`;
}
