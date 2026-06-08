import { test } from "node:test";
import assert from "node:assert/strict";
import { monthsBetween, computeEnvelopes, type EnvCategory, type EnvTx } from "./envelope.ts";

test("monthsBetween is inclusive and ordered; empty when start > end", () => {
  assert.deepEqual(monthsBetween("2026-05", "2026-07"), ["2026-05", "2026-06", "2026-07"]);
  assert.deepEqual(monthsBetween("2026-07", "2026-07"), ["2026-07"]);
  assert.deepEqual(monthsBetween("2026-08", "2026-07"), []);
});

const cats: EnvCategory[] = [
  { key: "groceries", monthlyAmount: 250, goal: null },
  { key: "rent", monthlyAmount: 500, goal: null },
  { key: "emergency-fund", monthlyAmount: 0, goal: 2000 },
];

test("available rolls over: allocation accumulates minus spend", () => {
  const txns: EnvTx[] = [
    { amount: -100, category: "groceries", bookingDate: "2026-05-10" },
    { amount: -180, category: "groceries", bookingDate: "2026-06-04" },
  ];
  const rows = computeEnvelopes(cats, {}, [], txns, "2026-05", "2026-06");
  const g = rows.find((r) => r.key === "groceries")!;
  assert.equal(g.allocated, 250);          // this (asOf) month allocation
  assert.equal(g.spent, 180);              // this month spend
  assert.equal(g.available, 250 + 250 - 100 - 180); // 220
});

test("allocation override replaces monthlyAmount for that month", () => {
  const rows = computeEnvelopes(cats, { "rent|2026-06": 450 }, [], [], "2026-06", "2026-06");
  const r = rows.find((x) => x.key === "rent")!;
  assert.equal(r.allocated, 450);
  assert.equal(r.available, 450);
});

test("transfers move available between envelopes", () => {
  const rows = computeEnvelopes(cats, {}, [{ fromKey: "rent", toKey: "emergency-fund", amount: 100 }], [], "2026-06", "2026-06");
  assert.equal(rows.find((r) => r.key === "rent")!.available, 500 - 100);
  assert.equal(rows.find((r) => r.key === "emergency-fund")!.available, 0 + 100);
});

test("credits/other categories don't count as spend", () => {
  const txns: EnvTx[] = [
    { amount: 50, category: "groceries", bookingDate: "2026-06-01" }, // credit, ignored
    { amount: -30, category: "uncategorised", bookingDate: "2026-06-01" }, // diff category
  ];
  const rows = computeEnvelopes(cats, {}, [], txns, "2026-06", "2026-06");
  assert.equal(rows.find((r) => r.key === "groceries")!.spent, 0);
});
