import { test } from "node:test";
import assert from "node:assert/strict";
import { avgMonthlyNetFlow } from "./netFlow.ts";

const TODAY = new Date(2026, 5, 16); // 16 Jun 2026 → complete months: Mar, Apr, May 2026

test("avgMonthlyNetFlow: averages signed flow over the 3 prior complete months", () => {
  const txns = [
    { amount: 1000, month: "2026-05" }, { amount: -700, month: "2026-05" }, // May net +300
    { amount: -300, month: "2026-04" },                                     // Apr net -300
    { amount: -600, month: "2026-03" },                                     // Mar net -600
  ];
  // total -600 over 3 months → -200/mo
  assert.equal(avgMonthlyNetFlow(txns, TODAY), -200);
});

test("avgMonthlyNetFlow: ignores the current (incomplete) month and older months", () => {
  const txns = [
    { amount: 5000, month: "2026-06" }, // current month — ignored
    { amount: -900, month: "2026-02" }, // 4 months back — outside window
    { amount: 300, month: "2026-05" },
  ];
  assert.equal(avgMonthlyNetFlow(txns, TODAY), 100); // 300 / 3
});

test("avgMonthlyNetFlow: null months and empty input", () => {
  assert.equal(avgMonthlyNetFlow([{ amount: 50, month: null }], TODAY), 0);
  assert.equal(avgMonthlyNetFlow([], TODAY), 0);
});
