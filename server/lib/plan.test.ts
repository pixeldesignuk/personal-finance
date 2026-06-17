import { test } from "node:test";
import assert from "node:assert/strict";
import { averageMonthly, computeSurplus, computePlanSteps } from "./plan.ts";

test("averageMonthly averages and guards empty", () => {
  assert.equal(averageMonthly([1000, 1100, 1200]), 1100);
  assert.equal(averageMonthly([]), 0);
});
test("computeSurplus subtracts bills + cushion, clamps at 0", () => {
  assert.equal(computeSurplus(1240, 0, 520, 100), 620);
  assert.equal(computeSurplus(300, 0, 500, 100), 0);
});

const base = {
  hasBudget: true, essentialMonthly: 1000, efTagged: true, efBalance: 0,
  efAccountName: "Marcus", efMonthsFull: 3, expensiveDebt: [], unratedDebt: false, surplus: 320,
};

test("no budget → budget is current, rest locked", () => {
  const { current, steps } = computePlanSteps({ ...base, hasBudget: false });
  assert.equal(current, "budget");
  assert.equal(steps.find((s) => s.key === "budget")!.state, "current");
  assert.equal(steps.find((s) => s.key === "ef_small")!.state, "locked");
});

test("budget done, EF empty → ef_small current with target = 1× essentials", () => {
  const { current, steps } = computePlanSteps(base);
  assert.equal(current, "ef_small");
  const s = steps.find((x) => x.key === "ef_small")!;
  assert.equal(s.state, "current");
  assert.deepEqual(s.progress, { have: 0, target: 1000, pct: 0 });
  assert.equal(s.toGo, 1000);
  assert.match(s.actionHint!, /Marcus/);
});

test("small EF met, expensive debt present → debt current", () => {
  const { current } = computePlanSteps({ ...base, efBalance: 1000, expensiveDebt: [{ name: "Barclaycard", apr: 24.9 }] });
  assert.equal(current, "debt");
});

test("small EF met, no expensive debt → ef_full current with target = 3× essentials", () => {
  const { current, steps } = computePlanSteps({ ...base, efBalance: 1000 });
  assert.equal(current, "ef_full");
  assert.equal(steps.find((s) => s.key === "ef_full")!.progress!.target, 3000);
});

test("all met → current null, all measured steps done", () => {
  const { current } = computePlanSteps({ ...base, efBalance: 3000 });
  assert.equal(current, null);
});

test("pension and invest always 'coming' in v1", () => {
  const { steps } = computePlanSteps(base);
  assert.equal(steps.find((s) => s.key === "pension")!.state, "coming");
  assert.equal(steps.find((s) => s.key === "invest")!.state, "coming");
});

test("no essentials estimate → ef_small needs-setup, not done", () => {
  const { current, steps } = computePlanSteps({ ...base, essentialMonthly: 0, efBalance: 5000 });
  assert.equal(current, "ef_small");
  assert.match(steps.find((s) => s.key === "ef_small")!.detail!, /categoris/i);
});

test("unrated debt blocks the debt step", () => {
  const { current } = computePlanSteps({ ...base, efBalance: 1000, unratedDebt: true });
  assert.equal(current, "debt");
});
