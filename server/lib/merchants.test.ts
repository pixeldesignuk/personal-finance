import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyMerchant, coefficientOfVariation, median, analyzeRecurringAmounts } from "./merchants.ts";

test("median", () => {
  assert.equal(median([]), 0);
  assert.equal(median([5]), 5);
  assert.equal(median([1, 3]), 2);
  assert.equal(median([3, 1, 2]), 2);
});

test("coefficientOfVariation: 0 for identical, higher for varied", () => {
  assert.equal(coefficientOfVariation([10, 10, 10]), 0);
  assert.ok(coefficientOfVariation([10, 20, 5, 40]) > 0.3);
});

test("classifyMerchant", () => {
  // Netflix: 6 months, ~1/mo, consistent → fixed
  assert.equal(classifyMerchant(6, 1, 0.02), "fixed");
  // Groceries: 6 months but several times a month → variable
  assert.equal(classifyMerchant(6, 4, 0.3), "variable");
  // monthly but amount varies a lot → variable
  assert.equal(classifyMerchant(5, 1, 0.4), "variable");
  // only seen twice → one-off
  assert.equal(classifyMerchant(2, 1, 0), "oneoff");
});

test("analyzeRecurringAmounts: stable bill is fixed, no flag", () => {
  const r = analyzeRecurringAmounts([9.99, 9.99, 9.99]);
  assert.equal(r.kind, "fixed");
  assert.equal(r.amount, 9.99);
  assert.equal(r.prevAmount, null);
});

test("analyzeRecurringAmounts: O2 — recent months flat after a rise → fixed + increase flag", () => {
  // 7.80 then 10.30, 10.30 (last two months are the same price)
  const r = analyzeRecurringAmounts([7.8, 10.3, 10.3]);
  assert.equal(r.kind, "fixed");
  assert.equal(r.amount, 10.3);     // current price, not the median of all
  assert.equal(r.prevAmount, 7.8);  // flag the rise from £7.80
});

test("analyzeRecurringAmounts: genuinely variable bill → variable, no flag", () => {
  const r = analyzeRecurringAmounts([42, 65, 51, 73]);
  assert.equal(r.kind, "variable");
  assert.equal(r.prevAmount, null);
});

test("analyzeRecurringAmounts: old rise (stable for many months) is not flagged", () => {
  const r = analyzeRecurringAmounts([7.8, 10.3, 10.3, 10.3, 10.3]);
  assert.equal(r.kind, "fixed");
  assert.equal(r.prevAmount, null); // run length > 3 → not a recent change
});

test("analyzeRecurringAmounts: tiny rise below threshold is not flagged", () => {
  const r = analyzeRecurringAmounts([9.99, 10.0, 10.0]);
  assert.equal(r.prevAmount, null);
});
