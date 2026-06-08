import { test } from "node:test";
import assert from "node:assert/strict";
import { spendingMatrix, type ReportTxn } from "./reports.ts";

const txns: ReportTxn[] = [
  { amount: -100, category: "groceries", personKey: "you", bookingDate: "2026-06-02" },
  { amount: -50, category: "groceries", personKey: "halima", bookingDate: "2026-06-10" },
  { amount: -22, category: "maryam-football", personKey: "maryam", bookingDate: "2026-06-11" },
  { amount: 2500, category: "income", personKey: "you", bookingDate: "2026-06-01" }, // credit, ignored
  { amount: -30, category: "transfer", personKey: null, bookingDate: "2026-06-03" }, // transfer, ignored
  { amount: -40, category: "groceries", personKey: null, bookingDate: "2026-05-30" }, // other month
];

test("spendingMatrix groups by category x person, excludes income/transfer/credits", () => {
  const m = spendingMatrix(txns, "2026-06");
  const g = m.rows.find((r) => r.categoryKey === "groceries")!;
  assert.equal(g.total, 150);
  assert.deepEqual(g.byPerson, { you: 100, halima: 50 });
  assert.equal(m.personTotals.you, 100);
  assert.equal(m.personTotals.maryam, 22);
  assert.equal(m.grandTotal, 172);
  assert.ok(!m.rows.some((r) => r.categoryKey === "income" || r.categoryKey === "transfer"));
});

test("all-time (no month) includes the other month; rows sorted desc by total", () => {
  const m = spendingMatrix(txns);
  assert.equal(m.grandTotal, 212); // 150 + 22 + 40
  assert.equal(m.rows[0].categoryKey, "groceries"); // 190 is largest
  assert.equal(m.rows.find((r) => r.categoryKey === "groceries")!.byPerson.none, 40);
});
