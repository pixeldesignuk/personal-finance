import { test } from "node:test";
import assert from "node:assert/strict";
import { buildBudgetRows } from "./budgetView.ts";

test("buildBudgetRows computes budgeted/spent/left/percent", () => {
  const rows = buildBudgetRows(
    [
      { key: "groceries", name: "Groceries", monthlyAmount: 250 },
      { key: "fuel", name: "Fuel", monthlyAmount: 50 },
      { key: "clothing", name: "Clothing", monthlyAmount: 0 },
    ],
    { groceries: 180, fuel: 60 },
  );
  assert.deepEqual(rows[0], { key: "groceries", name: "Groceries", budgeted: 250, spent: 180, left: 70, percent: 72 });
  assert.deepEqual(rows[1], { key: "fuel", name: "Fuel", budgeted: 50, spent: 60, left: -10, percent: 120 });
  // zero budget -> percent 0, no spend
  assert.deepEqual(rows[2], { key: "clothing", name: "Clothing", budgeted: 0, spent: 0, left: 0, percent: 0 });
});
