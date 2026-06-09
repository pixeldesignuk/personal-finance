import { test } from "node:test";
import assert from "node:assert/strict";
import { monthlyAverage, projectPayoff } from "./debt.ts";

test("monthlyAverage averages over distinct months", () => {
  assert.equal(monthlyAverage([]), 0);
  assert.equal(monthlyAverage([{ month: "2026-01", amount: 100 }]), 100);
  // two payments same month → one month at £150
  assert.equal(monthlyAverage([{ month: "2026-01", amount: 100 }, { month: "2026-01", amount: 50 }]), 150);
  // two months → (100 + 200) / 2
  assert.equal(monthlyAverage([{ month: "2026-01", amount: 100 }, { month: "2026-02", amount: 200 }]), 150);
});

test("projectPayoff: interest-free is simple division (ceil)", () => {
  assert.equal(projectPayoff(1000, 100), 10);
  assert.equal(projectPayoff(1050, 100), 11);
  assert.equal(projectPayoff(0, 100), 0);
  assert.equal(projectPayoff(1000, 0), null);
});

test("projectPayoff: with interest, more months; never-pays-off → null", () => {
  const n = projectPayoff(1000, 100, 12);
  assert.ok(n !== null && n > 10); // interest pushes it past 10 months
  // £10/mo on £10,000 at 24% APR: monthly interest £200 > payment → never
  assert.equal(projectPayoff(10000, 10, 24), null);
});
