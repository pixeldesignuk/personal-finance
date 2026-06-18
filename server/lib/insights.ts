import type { InsightKind, InsightSeverity } from "../../shared/types.ts";
export type { InsightKind, InsightSeverity };

export interface InsightConditions {
  overspent: { summary: string; amount: number } | null;
  needs_category: { count: number } | null;
  new_subscription: { count: number } | null;
  surplus: { amount: number; hint: string } | null;
  new_transactions: { count: number } | null;
}

export interface UnresolvedInsight {
  id: string;
  kind: InsightKind;
  payload: Record<string, unknown>;
  dismissedAt: Date | null;
}

export type ReconcileAction =
  | { type: "create"; kind: InsightKind; payload: Record<string, unknown> }
  | { type: "refresh"; id: string; payload: Record<string, unknown> }
  | { type: "resolve"; id: string };

export interface RenderedInsight {
  title: string;
  detail: string | null;
  count: number | null;
  link: string;
  severity: InsightSeverity;
}

// Sort + severity precedence: problems → review → opportunity → digest.
export const KIND_ORDER: InsightKind[] = ["overspent", "needs_category", "new_subscription", "surplus", "new_transactions"];

const gbp = (n: number) => `£${Math.round(n)}`;
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
const shallowEqual = (a: Record<string, unknown>, b: Record<string, unknown>) => {
  const ak = Object.keys(a), bk = Object.keys(b);
  return ak.length === bk.length && ak.every((k) => a[k] === b[k]);
};

// Per-kind reconcile. `unresolved` holds rows with resolvedAt IS NULL (open OR
// dismissed-not-yet-resolved). Normally ≤1 per kind (singleton), but a race
// (a dashboard load reconciling while a sync reconciles) can leave duplicates —
// so we always collapse to one and resolve the rest (self-healing).
export function reconcileInsights(conditions: InsightConditions, unresolved: UnresolvedInsight[]): ReconcileAction[] {
  const actions: ReconcileAction[] = [];
  for (const kind of KIND_ORDER) {
    const cond = conditions[kind] as Record<string, unknown> | null;
    const rows = unresolved.filter((r) => r.kind === kind);
    if (!cond) {
      // Condition no longer true → resolve EVERY row of this kind (incl. dups).
      for (const r of rows) actions.push({ type: "resolve", id: r.id });
      continue;
    }
    const dismissed = rows.find((r) => r.dismissedAt);
    if (dismissed) {
      // Sticky dismissal — keep the dismissed row, resolve any other duplicates.
      for (const r of rows) if (r.id !== dismissed.id) actions.push({ type: "resolve", id: r.id });
    } else if (rows.length === 0) {
      actions.push({ type: "create", kind, payload: cond });
    } else {
      // Keep the first (rows arrive newest-first), refresh if changed, resolve rest.
      const [keep, ...extra] = rows;
      if (!shallowEqual(keep.payload, cond)) actions.push({ type: "refresh", id: keep.id, payload: cond });
      for (const r of extra) actions.push({ type: "resolve", id: r.id });
    }
  }
  return actions;
}

export function renderInsight(kind: InsightKind, payload: Record<string, unknown>): RenderedInsight {
  const n = Number(payload.count ?? 0);
  switch (kind) {
    case "needs_category":
      return { title: `${n} ${plural(n, "transaction needs", "transactions need")} a category`, detail: null, count: n, link: "/transactions?cat=uncategorised", severity: "review" };
    case "new_subscription":
      return { title: `${n} ${plural(n, "subscription", "subscriptions")} to confirm`, detail: null, count: n, link: "/recurring", severity: "review" };
    case "overspent":
      return { title: String(payload.summary ?? "Over budget"), detail: null, count: null, link: "/budgets", severity: "warn" };
    case "surplus":
      return { title: `${gbp(Number(payload.amount ?? 0))} spare`, detail: payload.hint ? String(payload.hint) : null, count: null, link: "/savings", severity: "opportunity" };
    case "new_transactions":
      return { title: `${n} new ${plural(n, "transaction", "transactions")}`, detail: null, count: n, link: "/transactions", severity: "digest" };
  }
}

export function sortInsights<T extends { kind: InsightKind }>(items: T[]): T[] {
  return [...items].sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
}
