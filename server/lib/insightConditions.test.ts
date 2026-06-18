import { test } from "node:test";
import assert from "node:assert/strict";
import { worstOverspend } from "./insightConditions.ts";

const cats = [
  { key: "groceries", name: "Groceries", budget: 400 },
  { key: "dining-out", name: "Dining out", budget: 100 },
  { key: "transport", name: "Transport", budget: 0 }, // no budget → ignored
];

test("worstOverspend returns null when nothing is over", () => {
  assert.equal(worstOverspend(cats, { groceries: 350, "dining-out": 90 }), null);
});

test("worstOverspend picks the category most over budget (delta), not the highest spend", () => {
  // Groceries spent more (442, £42 over) but Dining out is £50 over → Dining out wins.
  const r = worstOverspend(cats, { groceries: 442, "dining-out": 150 });
  assert.deepEqual(r, { summary: "Dining out over by £50", amount: 50 });
});

test("worstOverspend ignores categories with no budget even if spent", () => {
  assert.equal(worstOverspend(cats, { transport: 999 }), null);
});
