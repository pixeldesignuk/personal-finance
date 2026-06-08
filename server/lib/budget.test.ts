import { test } from "node:test";
import assert from "node:assert/strict";
import { monthOf, personalSpendByCategory, buildBudgetRows, cashFlow, type BudgetTx } from "./budget.ts";

const txns: BudgetTx[] = [
  { amount: -10, category: "groceries", bookingDate: "2026-06-02" },
  { amount: -20, category: "groceries", bookingDate: "2026-06-10" },
  { amount: -5, category: "transport", bookingDate: "2026-06-11" },
  { amount: 2500, category: "income", bookingDate: "2026-06-01" },
  { amount: -100, category: "transfer", bookingDate: "2026-06-03" }, // excluded
  { amount: -30, category: "groceries", bookingDate: "2026-05-30" }, // other month
];

test("monthOf slices YYYY-MM", () => {
  assert.equal(monthOf("2026-06-02"), "2026-06");
  assert.equal(monthOf(null), null);
});

test("personalSpendByCategory: debits only, excludes income/transfer/other months", () => {
  const s = personalSpendByCategory(txns, "2026-06");
  assert.equal(s.groceries, 30);
  assert.equal(s.transport, 5);
  assert.equal(s.income, undefined);
  assert.equal(s.transfer, undefined);
});

test("buildBudgetRows yields a row per spending category with percent + remaining", () => {
  const rows = buildBudgetRows({ groceries: 100 }, { groceries: 30, transport: 5 });
  const g = rows.find((r) => r.category === "groceries")!;
  assert.deepEqual(g, { category: "groceries", monthlyLimit: 100, spent: 30, remaining: 70, percent: 30 });
  const t = rows.find((r) => r.category === "transport")!;
  assert.equal(t.monthlyLimit, 0);
  assert.equal(t.percent, 0); // unset limit -> percent 0
});

test("cashFlow excludes transfers, computes savings rate", () => {
  const cf = cashFlow(txns, "2026-06");
  assert.equal(cf.income, 2500);
  assert.equal(cf.expenses, 35); // 10+20+5, transfer excluded
  assert.equal(cf.net, 2465);
  assert.equal(cf.savingsRate, 99); // round(2465/2500*100)
});

test("cashFlow with zero income gives rate 0", () => {
  assert.equal(cashFlow([{ amount: -10, category: "groceries", bookingDate: "2026-06-01" }], "2026-06").savingsRate, 0);
});
