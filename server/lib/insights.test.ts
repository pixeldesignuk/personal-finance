import { test } from "node:test";
import assert from "node:assert/strict";
import { reconcileInsights, renderInsight, sortInsights, KIND_ORDER, type InsightConditions, type UnresolvedInsight } from "./insights.ts";

const EMPTY: InsightConditions = { overspent: null, needs_category: null, new_subscription: null, surplus: null, new_transactions: null };

test("creates an insight when a condition becomes true and none exists", () => {
  const actions = reconcileInsights({ ...EMPTY, needs_category: { count: 3 } }, []);
  assert.deepEqual(actions, [{ type: "create", kind: "needs_category", payload: { count: 3 } }]);
});

test("refreshes payload when the open insight's count changed", () => {
  const open: UnresolvedInsight[] = [{ id: "a", kind: "needs_category", payload: { count: 3 }, dismissedAt: null }];
  const actions = reconcileInsights({ ...EMPTY, needs_category: { count: 5 } }, open);
  assert.deepEqual(actions, [{ type: "refresh", id: "a", payload: { count: 5 } }]);
});

test("no action when open insight payload is unchanged", () => {
  const open: UnresolvedInsight[] = [{ id: "a", kind: "needs_category", payload: { count: 3 }, dismissedAt: null }];
  assert.deepEqual(reconcileInsights({ ...EMPTY, needs_category: { count: 3 } }, open), []);
});

test("auto-resolves an open insight when its condition goes false", () => {
  const open: UnresolvedInsight[] = [{ id: "a", kind: "needs_category", payload: { count: 3 }, dismissedAt: null }];
  assert.deepEqual(reconcileInsights(EMPTY, open), [{ type: "resolve", id: "a" }]);
});

test("dismissal is sticky: no recreate while condition still holds", () => {
  const open: UnresolvedInsight[] = [{ id: "a", kind: "needs_category", payload: { count: 3 }, dismissedAt: new Date() }];
  assert.deepEqual(reconcileInsights({ ...EMPTY, needs_category: { count: 3 } }, open), []);
});

test("dismissed row still resolves when condition goes false (so a future cycle starts fresh)", () => {
  const open: UnresolvedInsight[] = [{ id: "a", kind: "needs_category", payload: { count: 3 }, dismissedAt: new Date() }];
  assert.deepEqual(reconcileInsights(EMPTY, open), [{ type: "resolve", id: "a" }]);
});

test("collapses duplicate open rows of a kind: keeps the first, resolves the rest", () => {
  const open: UnresolvedInsight[] = [
    { id: "a", kind: "needs_category", payload: { count: 3 }, dismissedAt: null },
    { id: "b", kind: "needs_category", payload: { count: 3 }, dismissedAt: null },
  ];
  // payload unchanged on the keeper → only the extra is resolved
  assert.deepEqual(reconcileInsights({ ...EMPTY, needs_category: { count: 3 } }, open), [{ type: "resolve", id: "b" }]);
});

test("condition false resolves ALL duplicate rows of a kind", () => {
  const open: UnresolvedInsight[] = [
    { id: "a", kind: "needs_category", payload: { count: 3 }, dismissedAt: null },
    { id: "b", kind: "needs_category", payload: { count: 3 }, dismissedAt: null },
  ];
  assert.deepEqual(reconcileInsights(EMPTY, open), [{ type: "resolve", id: "a" }, { type: "resolve", id: "b" }]);
});

test("dismissed row is kept while duplicate open rows of the same kind are resolved", () => {
  const open: UnresolvedInsight[] = [
    { id: "a", kind: "needs_category", payload: { count: 3 }, dismissedAt: new Date() },
    { id: "b", kind: "needs_category", payload: { count: 3 }, dismissedAt: null },
  ];
  assert.deepEqual(reconcileInsights({ ...EMPTY, needs_category: { count: 3 } }, open), [{ type: "resolve", id: "b" }]);
});

test("renderInsight produces the documented text, link and severity per kind", () => {
  assert.deepEqual(renderInsight("needs_category", { count: 3 }), { title: "3 transactions need a category", detail: null, count: 3, link: "/transactions?cat=uncategorised", cta: "Categorise", severity: "review" });
  assert.deepEqual(renderInsight("needs_category", { count: 1 }).title, "1 transaction needs a category");
  assert.deepEqual(renderInsight("new_subscription", { count: 2 }), { title: "2 subscriptions to confirm", detail: null, count: 2, link: "/recurring", cta: "Confirm", severity: "review" });
  assert.deepEqual(renderInsight("overspent", { summary: "Groceries over by £42", amount: 42 }), { title: "Groceries over by £42", detail: null, count: null, link: "/budgets", cta: "Review budget", severity: "warn" });
  assert.deepEqual(renderInsight("surplus", { amount: 210, hint: "Move it to savings" }), { title: "£210 spare", detail: "Move it to savings", count: null, link: "/savings", cta: "Move money", severity: "opportunity" });
  assert.deepEqual(renderInsight("new_transactions", { count: 4 }), { title: "4 new transactions", detail: null, count: 4, link: "/transactions", cta: "Review", severity: "digest" });
});

test("sortInsights orders by KIND_ORDER", () => {
  const items = [{ kind: "new_transactions" as const }, { kind: "overspent" as const }, { kind: "surplus" as const }, { kind: "needs_category" as const }];
  assert.deepEqual(sortInsights(items).map((i) => i.kind), ["overspent", "needs_category", "surplus", "new_transactions"]);
  assert.deepEqual(KIND_ORDER, ["overspent", "needs_category", "new_subscription", "surplus", "new_transactions"]);
});
