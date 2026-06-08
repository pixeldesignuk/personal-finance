import { test } from "node:test";
import assert from "node:assert/strict";
import { buildBudgetRows } from "./budgetView.ts";

test("buildBudgetRows computes budgeted/spent/left/percent", () => {
  const rows = buildBudgetRows(
    [
      { id: 1, key: "groceries", name: "Groceries", group: "Frequent", monthlyAmount: 250 },
      { id: 2, key: "fuel", name: "Fuel", group: "Transport", monthlyAmount: 50 },
      { id: 3, key: "clothing", name: "Clothing", group: null, monthlyAmount: 0 },
    ],
    { groceries: 180, fuel: 60 },
  );
  assert.deepEqual(rows[0], { id: 1, key: "groceries", name: "Groceries", group: "Frequent", budgeted: 250, spent: 180, left: 70, percent: 72 });
  assert.deepEqual(rows[1], { id: 2, key: "fuel", name: "Fuel", group: "Transport", budgeted: 50, spent: 60, left: -10, percent: 120 });
  // zero budget -> percent 0, no spend
  assert.deepEqual(rows[2], { id: 3, key: "clothing", name: "Clothing", group: null, budgeted: 0, spent: 0, left: 0, percent: 0 });
});
