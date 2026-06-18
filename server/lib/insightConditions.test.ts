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

test("worstOverspend picks the largest overspend and rounds the amount", () => {
  const r = worstOverspend(cats, { groceries: 442, "dining-out": 150 });
  assert.deepEqual(r, { summary: "Groceries over by £42", amount: 42 });
});

test("worstOverspend ignores categories with no budget even if spent", () => {
  assert.equal(worstOverspend(cats, { transport: 999 }), null);
});
