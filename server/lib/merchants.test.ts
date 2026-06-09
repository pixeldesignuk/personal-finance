import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyMerchant, coefficientOfVariation, median } from "./merchants.ts";

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
