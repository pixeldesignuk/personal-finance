import { test } from "node:test";
import assert from "node:assert/strict";
import { runwayCheck } from "./checks/runway.ts";
import { cashflowCheck } from "./checks/cashflow.ts";
import { bufferCheck } from "./checks/buffer.ts";
import { trendCheck } from "./checks/trend.ts";
import type { HealthAccount, HealthContext } from "./types.ts";
import type { AccountFundingDTO } from "../../../shared/types.ts";

const A: HealthAccount = { id: "a", name: "Current", balance: 100, informational: false };
const baseFund = (over: Partial<AccountFundingDTO> = {}): AccountFundingDTO =>
  ({ accountId: "a", committed: 0, balance: 100, solidFraction: 0, dashedFraction: 0, incomeIncoming: 0, isIncomeAccount: false, state: "none", windowDays: 12, ...over });

function ctx(over: Partial<HealthContext> = {}, fund = baseFund()): HealthContext {
  return {
    today: new Date(2026, 5, 16),
    accounts: [A],
    schedules: [],
    income: { byAccount: new Map(), totalAll: 0, maxAll: 0 },
    netFlowByAccount: new Map(),
    fundingByAccount: new Map([["a", fund]]),
    ...over,
  };
}

// ---- runway ----
test("runway: nothing committed → ok, reassuring", () => {
  const r = runwayCheck(A, ctx());
  assert.equal(r?.severity, "ok");
  assert.match(r!.why, /Nothing due/);
});

test("runway: balance covers committed → ok", () => {
  const r = runwayCheck({ ...A, balance: 200 }, ctx({}, baseFund({ committed: 50, balance: 200 })));
  assert.equal(r?.severity, "ok");
});

test("runway: shortfall even with incoming pay → urgent with transfer rec", () => {
  const account: HealthAccount = { ...A, balance: 30 };
  const accounts = [account, { id: "s", name: "Savings", balance: 500, informational: true }];
  const fund = baseFund({ committed: 100, balance: 30, incomeIncoming: 0 });
  const c = ctx({ accounts, fundingByAccount: new Map([["a", fund], ["s", baseFund({ accountId: "s", committed: 0, balance: 500 })]]) }, fund);
  const r = runwayCheck(account, c);
  assert.equal(r?.severity, "urgent");
  assert.match(r!.why, /70\.00 short/);
  assert.equal(r!.recommendation, "Move £70.00 from Savings");
});

test("runway: balance short but incoming pay covers it → attention, no transfer", () => {
  const fund = baseFund({ committed: 100, balance: 30, incomeIncoming: 100, isIncomeAccount: true });
  const r = runwayCheck({ ...A, balance: 30 }, ctx({}, fund));
  assert.equal(r?.severity, "attention");
  assert.equal(r!.recommendation, null);
});

// ---- cashflow ----
test("cashflow: positive net flow → no result", () => {
  assert.equal(cashflowCheck(A, ctx({ netFlowByAccount: new Map([["a", 200]]) })), null);
});

test("cashflow: negative net flow → attention", () => {
  const r = cashflowCheck(A, ctx({ netFlowByAccount: new Map([["a", -300]]) }));
  assert.equal(r?.severity, "attention");
  assert.match(r!.why, /300\.00\/mo more goes out/);
});

// ---- buffer ----
test("buffer: positive balance → no result", () => {
  assert.equal(bufferCheck(A, ctx()), null);
});

test("buffer: overdrawn → urgent with transfer rec", () => {
  const account: HealthAccount = { ...A, balance: -45 };
  const accounts = [account, { id: "s", name: "Savings", balance: 500, informational: true }];
  const c = ctx({ accounts, fundingByAccount: new Map([["a", baseFund({ balance: -45 })], ["s", baseFund({ accountId: "s", balance: 500 })]]) });
  const r = bufferCheck(account, c);
  assert.equal(r?.severity, "urgent");
  assert.match(r!.why, /Overdrawn by £45\.00/);
  assert.equal(r!.recommendation, "Move £45.00 from Savings");
});

// ---- trend ----
test("trend: draining toward zero soon → attention with projected month", () => {
  // balance 600, draining 300/mo → 2 months → ~August
  const r = trendCheck({ ...A, balance: 600 }, ctx({ netFlowByAccount: new Map([["a", -300]]) }));
  assert.equal(r?.severity, "attention");
  assert.match(r!.why, /August/);
});

test("trend: positive flow or far-off zero → no result", () => {
  assert.equal(trendCheck({ ...A, balance: 600 }, ctx({ netFlowByAccount: new Map([["a", 100]]) })), null);
  assert.equal(trendCheck({ ...A, balance: 6000 }, ctx({ netFlowByAccount: new Map([["a", -100]]) })), null); // 60 months out
});

test("trend: overdrawn already → no result (buffer owns it)", () => {
  assert.equal(trendCheck({ ...A, balance: -10 }, ctx({ netFlowByAccount: new Map([["a", -300]]) })), null);
});

test("runway: credit card → skipped (no overdraft/runway semantics)", () => {
  const card = { ...A, balance: -500, isCreditCard: true };
  assert.equal(runwayCheck(card, ctx({}, baseFund({ committed: 100, balance: -500 }))), null);
});

test("buffer: credit card with negative balance → skipped (debt, not overdraft)", () => {
  const card = { ...A, balance: -500, isCreditCard: true };
  assert.equal(bufferCheck(card, ctx()), null);
});

test("cashflow: credit card draining → card-specific copy", () => {
  const card = { ...A, isCreditCard: true };
  const r = cashflowCheck(card, ctx({ netFlowByAccount: new Map([["a", -200]]) }));
  assert.equal(r?.severity, "attention");
  assert.equal(r?.title, "Card balance growing");
  assert.match(r!.why, /more is charged than paid off/);
});
