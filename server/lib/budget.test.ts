import { test } from "node:test";
import assert from "node:assert/strict";
import { monthOf, personalSpendByCategory, buildBudgetRows, cashFlow, suggestBudgets, completeSpendMonths, type BudgetTx } from "./budget.ts";

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

test("suggestBudgets: median of monthly spend, current month excluded", () => {
  const tx: BudgetTx[] = [
    { amount: -100, category: "groceries", bookingDate: "2026-03-10" },
    { amount: -120, category: "groceries", bookingDate: "2026-04-10" },
    { amount: -110, category: "groceries", bookingDate: "2026-05-10" },
    { amount: -999, category: "groceries", bookingDate: "2026-06-10" }, // current month — excluded
  ];
  const s = suggestBudgets(tx, "2026-06");
  assert.equal(s.groceries, 110); // median of 100,120,110
});

test("suggestBudgets: one-off spike doesn't inflate (median robust)", () => {
  const tx: BudgetTx[] = [
    { amount: -50, category: "shopping", bookingDate: "2026-03-01" },
    { amount: -50, category: "shopping", bookingDate: "2026-04-01" },
    { amount: -800, category: "shopping", bookingDate: "2026-05-01" }, // spike
  ];
  assert.equal(suggestBudgets(tx, "2026-06").shopping, 50);
});

test("suggestBudgets: occasional category gets its average, not zero", () => {
  const tx: BudgetTx[] = [
    { amount: -60, category: "gifts", bookingDate: "2026-03-01" },
    // no gifts in Apr or May, but groceries keep those months 'complete'
    { amount: -10, category: "groceries", bookingDate: "2026-04-01" },
    { amount: -10, category: "groceries", bookingDate: "2026-05-01" },
  ];
  // 3 complete months, gifts total 60 -> average 20
  assert.equal(suggestBudgets(tx, "2026-06").gifts, 20);
});

test("suggestBudgets: income and transfers are ignored", () => {
  const tx: BudgetTx[] = [
    { amount: 2000, category: "income", bookingDate: "2026-03-01" },
    { amount: -500, category: "transfer", bookingDate: "2026-03-01" },
  ];
  assert.deepEqual(suggestBudgets(tx, "2026-06"), {});
});

test("completeSpendMonths counts non-current months with spend", () => {
  const tx: BudgetTx[] = [
    { amount: -10, category: "groceries", bookingDate: "2026-03-01" },
    { amount: -10, category: "groceries", bookingDate: "2026-04-01" },
    { amount: -10, category: "groceries", bookingDate: "2026-06-01" }, // current
  ];
  assert.equal(completeSpendMonths(tx, "2026-06"), 2);
});
