import { test } from "node:test";
import assert from "node:assert/strict";
import { inferNextDue, occurrencesWithin, sameMonth, typicalDayOfMonth, incomeOccurrences, periodMonths, billTarget } from "./recurring.ts";

test("inferNextDue: this month when the day hasn't passed", () => {
  const due = inferNextDue(15, new Date(2026, 5, 10)); // 10 Jun
  assert.equal(due.getFullYear(), 2026);
  assert.equal(due.getMonth(), 5); // June
  assert.equal(due.getDate(), 15);
});

test("inferNextDue: rolls to next month when the day has passed", () => {
  const due = inferNextDue(5, new Date(2026, 5, 10)); // 10 Jun, 5th passed
  assert.equal(due.getMonth(), 6); // July
  assert.equal(due.getDate(), 5);
});

test("inferNextDue: today counts as due (>=)", () => {
  const due = inferNextDue(10, new Date(2026, 5, 10));
  assert.equal(due.getMonth(), 5);
  assert.equal(due.getDate(), 10);
});

test("inferNextDue: clamps a 31st to a short month", () => {
  const due = inferNextDue(31, new Date(2026, 1, 1)); // Feb 2026 (28 days)
  assert.equal(due.getMonth(), 1);
  assert.equal(due.getDate(), 28);
});

test("inferNextDue: December rolls into next January", () => {
  const due = inferNextDue(5, new Date(2026, 11, 10)); // 10 Dec
  assert.equal(due.getFullYear(), 2027);
  assert.equal(due.getMonth(), 0);
  assert.equal(due.getDate(), 5);
});

test("occurrencesWithin: monthly returns one per month in the window", () => {
  const occ = occurrencesWithin(new Date(2026, 5, 15), "monthly", new Date(2026, 5, 1), 30);
  assert.equal(occ.length, 1); // only 15 Jun within Jun 1 + 30d
});

test("occurrencesWithin: weekly steps every 7 days", () => {
  const occ = occurrencesWithin(new Date(2026, 5, 2), "weekly", new Date(2026, 5, 1), 30);
  assert.equal(occ.length, 5); // 2, 9, 16, 23, 30
});

test("occurrencesWithin: excludes dates before the window start", () => {
  const occ = occurrencesWithin(new Date(2026, 5, 1), "monthly", new Date(2026, 5, 10), 30);
  assert.equal(occ[0].getDate(), 1);
  assert.equal(occ[0].getMonth(), 6); // the 1 Jun occurrence is before the start → first kept is 1 Jul
});

test("sameMonth", () => {
  assert.equal(sameMonth(new Date(2026, 5, 30), new Date(2026, 5, 1)), true);
  assert.equal(sameMonth(new Date(2026, 6, 1), new Date(2026, 5, 30)), false);
});

test("typicalDayOfMonth: picks the modal day", () => {
  assert.equal(typicalDayOfMonth(["2026-04-15", "2026-05-15", "2026-06-16"]), 15);
  assert.equal(typicalDayOfMonth([null, "2026-06-03"]), 3);
  assert.equal(typicalDayOfMonth([]), null);
});

test("incomeOccurrences: not paid yet this month → expected this month", () => {
  const occ = incomeOccurrences(28, false, new Date(2026, 5, 10), 30); // payday 28th, today 10 Jun
  assert.equal(occ[0].getMonth(), 5);
  assert.equal(occ[0].getDate(), 28);
});

test("incomeOccurrences: already paid this month → skip to next month", () => {
  const occ = incomeOccurrences(1, true, new Date(2026, 5, 10), 40); // paid this month, today 10 Jun
  assert.equal(occ.length, 1);
  assert.equal(occ[0].getMonth(), 6); // 1 Jul
  assert.equal(occ[0].getDate(), 1);
});

test("incomeOccurrences: payday passed but not received → surfaced as due now", () => {
  const occ = incomeOccurrences(5, false, new Date(2026, 5, 10), 30); // payday 5th passed, not paid
  assert.equal(occ[0].getMonth(), 5);
  assert.equal(occ[0].getDate(), 10); // clamped to today (overdue income)
});

test("occurrencesWithin: quarterly steps every 3 months", () => {
  const occ = occurrencesWithin(new Date(2026, 0, 1), "quarterly", new Date(2026, 0, 1), 200);
  // Jan, Apr, Jul (month indexes 0, 3, 6) within ~200 days; compare local parts
  assert.deepEqual(occ.map((d) => d.getMonth()), [0, 3, 6]);
  assert.ok(occ.every((d) => d.getDate() === 1));
});

test("periodMonths maps cadences", () => {
  assert.equal(periodMonths("yearly"), 12);
  assert.equal(periodMonths("quarterly"), 3);
  assert.equal(periodMonths("monthly"), 1);
  assert.equal(periodMonths("weekly"), 0);
});

test("billTarget: annual bill smoothed, 3 months into the cycle", () => {
  // £600/yr last due 12 Mar; today 11 Jun -> 3 months in, £50/mo, £150 set aside
  const t = billTarget(600, "yearly", "2026-03-12", new Date(2026, 5, 11));
  assert.ok(t);
  assert.equal(t!.periodMonths, 12);
  assert.equal(t!.monthlyAmount, 50);
  assert.equal(t!.monthsElapsed, 3);
  assert.equal(t!.setAside, 150);
  assert.equal(t!.nextDue, "2027-03-12");
});

test("billTarget: quarterly bill, 1 month into the cycle", () => {
  const t = billTarget(90, "quarterly", "2026-05-01", new Date(2026, 5, 11));
  assert.equal(t!.monthlyAmount, 30);
  assert.equal(t!.monthsElapsed, 1);
  assert.equal(t!.setAside, 30);
  assert.equal(t!.nextDue, "2026-08-01");
});

test("billTarget: monthly/weekly return null (nothing to spread)", () => {
  assert.equal(billTarget(50, "monthly", "2026-06-01", new Date(2026, 5, 11)), null);
  assert.equal(billTarget(20, "weekly", "2026-06-01", new Date(2026, 5, 11)), null);
});
