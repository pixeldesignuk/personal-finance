import { test } from "node:test";
import assert from "node:assert/strict";
import { tallyIncomeByAccount } from "./funding.ts";

test("tallyIncomeByAccount: sums totals and tracks max per account", () => {
  const got = tallyIncomeByAccount([
    { amount: 1000, accountId: "a" },
    { amount: 50, accountId: "a" },
    { amount: 200, accountId: "b" },
  ]);
  assert.deepEqual(got.byAccount.get("a"), { total: 1050, max: 1000 });
  assert.deepEqual(got.byAccount.get("b"), { total: 200, max: 200 });
  assert.equal(got.totalAll, 1250);
  assert.equal(got.maxAll, 1000);
});

test("tallyIncomeByAccount: empty input", () => {
  const got = tallyIncomeByAccount([]);
  assert.equal(got.byAccount.size, 0);
  assert.equal(got.totalAll, 0);
  assert.equal(got.maxAll, 0);
});

import { computeFunding, type FundingSchedule } from "./funding.ts";

const TODAY = new Date(2026, 5, 16); // 16 Jun 2026 (local)
const noIncome = tallyIncomeByAccount([]);
// An unattributed paycheck on the 28th, not yet received → nextPayday = 28 Jun,
// so the funding window is 16→28 Jun (12 days). Used to pin the window in tests
// that aren't themselves about the income account.
const paydayAnchor: FundingSchedule = { accountId: null, direction: "in", amount: 1200, cadence: "monthly", dayOfMonth: 28, nextDue: null };
const billJun20 = (accountId: string, amount: number, cadence = "monthly"): FundingSchedule =>
  ({ accountId, direction: "out", amount, cadence, dayOfMonth: 20, nextDue: new Date(2026, 5, 20) });

test("computeFunding: no committed bills → state none", () => {
  const [f] = computeFunding([{ id: "a", currentBalance: 100 }], [paydayAnchor], noIncome, TODAY);
  assert.equal(f.state, "none");
  assert.equal(f.committed, 0);
  assert.equal(f.solidFraction, 0);
});

test("computeFunding: balance covers committed → funded", () => {
  const [f] = computeFunding([{ id: "a", currentBalance: 100 }], [paydayAnchor, billJun20("a", 50)], noIncome, TODAY);
  assert.equal(f.committed, 50);
  assert.equal(f.windowDays, 12);
  assert.equal(f.state, "funded");
  assert.equal(f.solidFraction, 1);
});

test("computeFunding: balance partially covers → partial", () => {
  const [f] = computeFunding([{ id: "a", currentBalance: 30 }], [paydayAnchor, billJun20("a", 50)], noIncome, TODAY);
  assert.equal(f.state, "partial");
  assert.equal(f.solidFraction, 0.6);
  assert.equal(f.dashedFraction, 0);
});

test("computeFunding: income account short now but payday closes the gap → rescued", () => {
  const inB: FundingSchedule = { accountId: "b", direction: "in", amount: 1200, cadence: "monthly", dayOfMonth: 28, nextDue: null };
  const [f] = computeFunding([{ id: "b", currentBalance: 200 }], [inB, billJun20("b", 800)], noIncome, TODAY);
  assert.equal(f.isIncomeAccount, true);
  assert.equal(f.committed, 800);
  assert.equal(f.solidFraction, 0.25);
  assert.equal(f.dashedFraction, 0.75);
  assert.equal(f.incomeIncoming, 1200);
  assert.equal(f.state, "rescued");
});

test("computeFunding: income account short even with payday → short", () => {
  const inB: FundingSchedule = { accountId: "b", direction: "in", amount: 500, cadence: "monthly", dayOfMonth: 28, nextDue: null };
  const [f] = computeFunding([{ id: "b", currentBalance: 100 }], [inB, billJun20("b", 800)], noIncome, TODAY);
  assert.equal(f.solidFraction, 0.125);
  assert.equal(f.dashedFraction, 0.625);
  assert.equal(f.state, "short");
});

test("computeFunding: income already arrived this month → no dashed arc, balance-only state", () => {
  const inB: FundingSchedule = { accountId: "b", direction: "in", amount: 1200, cadence: "monthly", dayOfMonth: 28, nextDue: null };
  const arrived = tallyIncomeByAccount([{ amount: 1200, accountId: "b" }]); // salary landed
  const [f] = computeFunding([{ id: "b", currentBalance: 200 }], [inB, billJun20("b", 800)], arrived, TODAY);
  assert.equal(f.incomeIncoming, 0);
  assert.equal(f.dashedFraction, 0);
  assert.equal(f.state, "short"); // 200 of 800, no pending paycheck
});

test("computeFunding: no income schedule → 30-day window, no dashed arc", () => {
  const [f] = computeFunding([{ id: "a", currentBalance: 100 }], [billJun20("a", 50)], noIncome, TODAY);
  assert.equal(f.windowDays, 30);
  assert.equal(f.isIncomeAccount, false);
  assert.equal(f.committed, 50); // only 20 Jun falls in 16 Jun + 30d
  assert.equal(f.state, "funded");
});

test("computeFunding: yearly bill outside the window is not counted", () => {
  const dec: FundingSchedule = { accountId: "a", direction: "out", amount: 600, cadence: "yearly", dayOfMonth: 20, nextDue: new Date(2026, 11, 20) };
  const [f] = computeFunding([{ id: "a", currentBalance: 100 }], [paydayAnchor, dec], noIncome, TODAY);
  assert.equal(f.committed, 0);
  assert.equal(f.state, "none");
});

test("computeFunding: once this month's salary arrives, the window widens to next payday", () => {
  // Salary of 1000 due on the 28th has already landed this month → this month's
  // occurrence is skipped, so the window runs to next month's 28th (28 Jul = 42d),
  // not 28 Jun. Pins the intentional post-payday window jump.
  const inB: FundingSchedule = { accountId: "b", direction: "in", amount: 1000, cadence: "monthly", dayOfMonth: 28, nextDue: null };
  const arrived = tallyIncomeByAccount([{ amount: 1000, accountId: "b" }]);
  const [f] = computeFunding([{ id: "b", currentBalance: 5000 }], [inB], arrived, TODAY);
  assert.equal(f.windowDays, 42); // 16 Jun → 28 Jul
});

test("computeFunding: an overdue payday rolls to the next one, not a zero window", () => {
  // Income due on the 9th, today is the 16th, not yet received → incomeOccurrences
  // surfaces it as "due now" (today). The window must roll to the next real payday
  // (9 Jul) rather than collapsing to 0 days (which would zero out every account).
  const overdueIn: FundingSchedule = { accountId: "b", direction: "in", amount: 1000, cadence: "monthly", dayOfMonth: 9, nextDue: null };
  const [f] = computeFunding([{ id: "b", currentBalance: 100 }], [overdueIn, billJun20("b", 50)], noIncome, TODAY);
  assert.equal(f.windowDays, 23); // 16 Jun → 9 Jul
  assert.equal(f.committed, 50);   // the 20 Jun bill now falls inside the window
});
