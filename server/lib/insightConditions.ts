import { db } from "./db.ts";
import { Prisma } from "@prisma/client";
import { buildPlanContext } from "./planData.ts";
import { reconcileInsights, type InsightConditions, type InsightKind, type UnresolvedInsight } from "./insights.ts";
import { currentMonth, personalSpendByCategory, type BudgetTx } from "./budget.ts";
import { effectiveCategory } from "./effectiveCategory.ts";
import { isRefundNote } from "../../shared/refund.ts";
import { getStringSettings } from "./settings.ts";

// Budget overspend this month. Fires whenever ANY budgeted category is over
// (envelope discipline), reporting how many are over, the worst one, and the
// NET position (total spend − total budget; can be ≤0 when under-spent
// categories offset the overspends). The renderer leads with the net amount
// when you're genuinely over overall, otherwise with the category count — so a
// single worst category never misleads, and the signal doesn't vanish just
// because the total nets out. Null only when nothing is over. Pure → unit tested.
export function budgetOverspend(
  cats: { key: string; name: string; budget: number }[],
  spent: Record<string, number>,
): { net: number; count: number; worst: string } | null {
  let totalBudget = 0, totalSpent = 0, count = 0;
  let worst: { name: string; over: number } | null = null;
  for (const c of cats) {
    if (c.budget <= 0) continue;
    const s = spent[c.key] ?? 0;
    totalBudget += c.budget;
    totalSpent += s;
    const over = s - c.budget;
    if (over > 0) { count++; if (!worst || over > worst.over) worst = { name: c.name, over }; }
  }
  if (count === 0 || !worst) return null; // no category over → nothing to flag
  return { net: Math.round(totalSpent - totalBudget), count, worst: worst.name };
}

export async function gatherConditions(): Promise<InsightConditions> {
  // needs_category — uncategorised, settled, non-refund
  const uncats = await db.transaction.findMany({
    where: { category: "uncategorised", status: { not: "pending" } },
    select: { note: true },
  });
  const needsCount = uncats.filter((t) => !isRefundNote(t.note)).length;

  // new_subscription — auto-detected recurring awaiting confirmation
  const autoSubs = await db.recurringSchedule.count({ where: { status: "auto" } });

  // new_transactions — settled txns imported since the "caught up" marker
  const settings = await getStringSettings();
  const seen = settings["insights.txnsSeenAt"];
  const since = seen ? new Date(seen) : new Date(0);
  const newCount = await db.transaction.count({ where: { status: { not: "pending" }, createdAt: { gt: since } } });

  // overspent — overall over budget (with category count), OR balance can't cover bills
  const ctx = await buildPlanContext();
  const cats = await db.category.findMany({ where: { archived: false } });
  const budgetCats = cats
    .map((c) => ({ key: c.key, name: c.name, budget: Number(c.monthlyAmount.toString()) }))
    .filter((c) => c.budget > 0);
  const accts = await db.account.findMany({ where: { informational: false }, select: { id: true } });
  const ids = accts.map((a) => a.id);
  const txns = await db.transaction.findMany({
    where: { accountId: { in: ids } },
    select: { amount: true, category: true, categoryOverride: true, bookingDate: true },
  });
  const budgetTxns: BudgetTx[] = txns.map((t) => ({ amount: Number(t.amount.toString()), category: effectiveCategory(t), bookingDate: t.bookingDate }));
  const spent = personalSpendByCategory(budgetTxns, currentMonth());
  let overspent: InsightConditions["overspent"] = budgetOverspend(budgetCats, spent);
  const shortfall = ctx.billsBeforePayday - ctx.spendableNow - ctx.incomeIncoming;
  if (!overspent && shortfall > 0) {
    overspent = { summary: "Balance won't cover upcoming bills", amount: shortfall };
  }

  // surplus — spare money to allocate on the current plan step
  const cur = ctx.dto.current ? ctx.dto.steps.find((s) => s.key === ctx.dto.current) : null;
  const surplus = ctx.dto.surplus > 0 && cur?.actionHint ? { amount: ctx.dto.surplus, hint: cur.actionHint } : null;

  return {
    overspent,
    needs_category: needsCount > 0 ? { count: needsCount } : null,
    new_subscription: autoSubs > 0 ? { count: autoSubs } : null,
    surplus,
    new_transactions: newCount > 0 ? { count: newCount } : null,
  };
}

async function doReconcile(now: Date): Promise<void> {
  const conditions = await gatherConditions();
  const rows = await db.insight.findMany({ where: { resolvedAt: null }, orderBy: { createdAt: "desc" } });
  const unresolved: UnresolvedInsight[] = rows.map((r) => ({
    id: r.id, kind: r.kind as InsightKind, payload: (r.payload ?? {}) as Record<string, unknown>, dismissedAt: r.dismissedAt,
  }));
  const actions = reconcileInsights(conditions, unresolved);
  for (const a of actions) {
    if (a.type === "create") await db.insight.create({ data: { kind: a.kind, payload: a.payload as Prisma.InputJsonValue } });
    else if (a.type === "refresh") await db.insight.update({ where: { id: a.id }, data: { payload: a.payload as Prisma.InputJsonValue, updatedAt: now } });
    else await db.insight.update({ where: { id: a.id }, data: { resolvedAt: now } });
  }
}

// Serialise reconciles within this process so a dashboard load and the post-sync
// hook can't both read "no existing row" and each create a duplicate. The pure
// engine self-heals any dups that slip through (e.g. a second process), but the
// lock avoids creating them in the first place.
let reconcileChain: Promise<void> = Promise.resolve();

// Reconcile the Insight table against live conditions: create new, refresh
// counts, auto-resolve closed. Called on every GET /api/insights and post-sync.
export function runReconcile(now: Date): Promise<void> {
  reconcileChain = reconcileChain.catch(() => {}).then(() => doReconcile(now));
  return reconcileChain;
}
