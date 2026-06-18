import { test } from "node:test";
import assert from "node:assert/strict";
import { budgetOverspend } from "./insightConditions.ts";

const cats = [
  { key: "groceries", name: "Groceries", budget: 400 },
  { key: "dining-out", name: "Dining out", budget: 100 },
  { key: "transport", name: "Transport", budget: 0 }, // no budget → ignored
];

test("budgetOverspend null when no category is over", () => {
  // 350 + 90, both under their budgets → nothing to flag
  assert.equal(budgetOverspend(cats, { groceries: 350, "dining-out": 90 }), null);
});

test("budgetOverspend: net over budget → positive net, gross, count + worst", () => {
  // 442 (+42) + 150 (+50) = 592 vs 500 → net +92, gross 92, 2 over, worst Dining out
  assert.deepEqual(budgetOverspend(cats, { groceries: 442, "dining-out": 150 }), { net: 92, gross: 92, count: 2, worst: "Dining out" });
});

test("budgetOverspend: a category over but total nets out → still fires, net ≤0, gross >0", () => {
  // 410 (+10 over) + 20 (under) = 430 vs 500 → net -70, gross 10, 1 category over
  assert.deepEqual(budgetOverspend(cats, { groceries: 410, "dining-out": 20 }), { net: -70, gross: 10, count: 1, worst: "Groceries" });
});

test("budgetOverspend ignores categories with no budget even if spent", () => {
  assert.equal(budgetOverspend(cats, { transport: 999 }), null);
});
