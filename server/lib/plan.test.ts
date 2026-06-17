import { test } from "node:test";
import assert from "node:assert/strict";
import { averageMonthly, computeSurplus } from "./plan.ts";

test("averageMonthly averages and guards empty", () => {
  assert.equal(averageMonthly([1000, 1100, 1200]), 1100);
  assert.equal(averageMonthly([]), 0);
});
test("computeSurplus subtracts bills + cushion, clamps at 0", () => {
  assert.equal(computeSurplus(1240, 0, 520, 100), 620);
  assert.equal(computeSurplus(300, 0, 500, 100), 0);
});
