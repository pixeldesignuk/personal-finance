import { test } from "node:test";
import assert from "node:assert/strict";
import { spendingByCategory, monthlyTotals, topMerchants, type AggTx } from "./aggregate.ts";

const txns: AggTx[] = [
  { amount: -10, category: "groceries", merchant: "Tesco", bookingDate: "2026-05-02" },
  { amount: -20, category: "groceries", merchant: "Tesco", bookingDate: "2026-05-10" },
  { amount: -5, category: "transport", merchant: "TfL", bookingDate: "2026-05-11" },
  { amount: 2500, category: "income", merchant: "Acme", bookingDate: "2026-05-01" },
  { amount: -30, category: "groceries", merchant: "Aldi", bookingDate: "2026-06-01" },
];

test("spendingByCategory sums debits only, descending", () => {
  const r = spendingByCategory(txns);
  assert.deepEqual(r[0], { category: "groceries", total: 60 });
  assert.deepEqual(r[1], { category: "transport", total: 5 });
  assert.ok(!r.some((c) => c.category === "income"));
});

test("monthlyTotals groups by month", () => {
  const r = monthlyTotals(txns);
  const may = r.find((m) => m.month === "2026-05")!;
  assert.equal(may.spent, 35);
  assert.equal(may.received, 2500);
  const jun = r.find((m) => m.month === "2026-06")!;
  assert.equal(jun.spent, 30);
});

test("topMerchants ranks debit spend", () => {
  const r = topMerchants(txns, 2);
  assert.deepEqual(r[0], { merchant: "Tesco", total: 30, count: 2 });
  assert.equal(r.length, 2);
});
