import { test } from "node:test";
import assert from "node:assert/strict";
import { computeAccountHealth } from "./index.ts";
import type { HealthContext } from "./types.ts";
import type { AccountFundingDTO } from "../../../shared/types.ts";

const fund = (accountId: string, over: Partial<AccountFundingDTO> = {}): AccountFundingDTO =>
  ({ accountId, committed: 0, balance: 0, solidFraction: 0, dashedFraction: 0, incomeIncoming: 0, isIncomeAccount: false, state: "none", windowDays: 12, ...over });

function ctx(over: Partial<HealthContext> = {}): HealthContext {
  return {
    today: new Date(2026, 5, 16),
    accounts: [{ id: "a", name: "Current", balance: 100, informational: false }],
    schedules: [],
    income: { byAccount: new Map(), totalAll: 0, maxAll: 0 },
    netFlowByAccount: new Map(),
    fundingByAccount: new Map([["a", fund("a", { balance: 100 })]]),
    ...over,
  };
}

test("computeAccountHealth: healthy account → green, positive panel has the runway ok row", () => {
  const [h] = computeAccountHealth(ctx());
  assert.equal(h.verdict, "ok");
  assert.equal(h.color, "green");
  assert.equal(h.headline, "Healthy");
  assert.ok(h.checks.some((c) => c.key === "runway" && c.severity === "ok"));
});

test("computeAccountHealth: verdict is the worst severity across checks", () => {
  // overdrawn (urgent) + draining (attention) → urgent overall
  const [h] = computeAccountHealth(ctx({
    accounts: [{ id: "a", name: "Current", balance: -50, informational: false }],
    netFlowByAccount: new Map([["a", -100]]),
    fundingByAccount: new Map([["a", fund("a", { balance: -50 })]]),
  }));
  assert.equal(h.verdict, "urgent");
  assert.equal(h.color, "red");
  assert.equal(h.headline, "Unhealthy");
  assert.ok(h.checks.some((c) => c.key === "buffer" && c.severity === "urgent"));
});

test("computeAccountHealth: ring fractions come from funding", () => {
  const [h] = computeAccountHealth(ctx({
    fundingByAccount: new Map([["a", fund("a", { balance: 30, committed: 100, solidFraction: 0.3, dashedFraction: 0.5 })]]),
  }));
  assert.deepEqual(h.ring, { solidFraction: 0.3, dashedFraction: 0.5 });
});

test("computeAccountHealth: overdrawn + runway-short → one transfer rec, not two", () => {
  // Overdrawn account with committed bills: runway prescribes the full transfer
  // (covers clearing the overdraft AND the bills); buffer keeps its 'Overdrawn'
  // reason but drops its duplicate transfer recommendation.
  const accounts = [
    { id: "a", name: "Current", balance: -50, informational: false },
    { id: "s", name: "Savings", balance: 500, informational: true },
  ];
  const [h] = computeAccountHealth(ctx({
    accounts,
    fundingByAccount: new Map([
      ["a", fund("a", { balance: -50, committed: 100 })],
      ["s", fund("s", { balance: 500 })],
    ]),
  }));
  const runway = h.checks.find((c) => c.key === "runway");
  const buffer = h.checks.find((c) => c.key === "buffer");
  assert.equal(runway?.severity, "urgent");
  assert.equal(runway?.recommendation, "Move £150.00 from Savings"); // 100 − (−50)
  assert.equal(buffer?.why, "Overdrawn by £50.00"); // reason kept
  assert.equal(buffer?.recommendation, null);       // duplicate transfer dropped
});
