import { db } from "./db.ts";
import { Prisma } from "@prisma/client";
import { buildPlanContext } from "./planData.ts";
import { reconcileInsights, type InsightConditions, type InsightKind, type UnresolvedInsight } from "./insights.ts";
import { currentMonth, personalSpendByCategory, type BudgetTx } from "./budget.ts";
import { effectiveCategory } from "./effectiveCategory.ts";
import { isRefundNote } from "../../shared/refund.ts";
import { getStringSettings } from "./settings.ts";

// Largest budget category over 100% this month, or null. Pure → unit tested.
// "Worst" = the category with the largest delta (spent − budget) among over-budget categories.
export function worstOverspend(
  cats: { key: string; name: string; budget: number }[],
  spent: Record<string, number>,
): { summary: string; amount: number } | null {
  let worst: { name: string; over: number } | null = null;
  for (const c of cats) {
    if (c.budget <= 0) continue;
    const over = (spent[c.key] ?? 0) - c.budget;
    if (over > 0 && (!worst || over > worst.over)) worst = { name: c.name, over };
  }
  if (!worst) return null;
  const amount = Math.round(worst.over);
  return { summary: `${worst.name} over by £${amount}`, amount };
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

  // overspent — worst budget category over, OR balance can't cover committed bills
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
  let overspent = worstOverspend(budgetCats, spent);
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

// Reconcile the Insight table against live conditions: create new, refresh
// counts, auto-resolve closed. Called on every GET /api/insights and post-sync.
export async function runReconcile(now: Date): Promise<void> {
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
