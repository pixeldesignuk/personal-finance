import { test } from "node:test";
import assert from "node:assert/strict";
import { budgetOverspend } from "./insightConditions.ts";

const cats = [
  { key: "groceries", name: "Groceries", budget: 400 },
  { key: "dining-out", name: "Dining out", budget: 100 },
  { key: "transport", name: "Transport", budget: 0 }, // no budget → ignored
];

test("budgetOverspend null when overall within budget (under-spend offsets)", () => {
  // 350 + 90 = 440 spent vs 500 budget → within budget overall
  assert.equal(budgetOverspend(cats, { groceries: 350, "dining-out": 90 }), null);
});

test("budgetOverspend reports overall over + count of categories over + worst", () => {
  // 442 (+42) + 150 (+50) = 592 vs 500 → £92 over, 2 categories over, worst = Dining out
  assert.deepEqual(budgetOverspend(cats, { groceries: 442, "dining-out": 150 }), { amount: 92, count: 2, worst: "Dining out" });
});

test("budgetOverspend nets under-spend into the total and counts only over categories", () => {
  // 450 (+50 over) + 80 (−20 under) = 530 vs 500 → £30 over overall, 1 category over
  assert.deepEqual(budgetOverspend(cats, { groceries: 450, "dining-out": 80 }), { amount: 30, count: 1, worst: "Groceries" });
});

test("budgetOverspend ignores categories with no budget even if spent", () => {
  assert.equal(budgetOverspend(cats, { transport: 999 }), null);
});
