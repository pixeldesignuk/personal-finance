import { test } from "node:test";
import assert from "node:assert/strict";
import { pickSource, recommendTransfer, freeCash } from "./recommend.ts";
import type { HealthContext, HealthAccount } from "./types.ts";
import type { AccountFundingDTO } from "../../../shared/types.ts";

const fund = (accountId: string, committed: number): AccountFundingDTO =>
  ({ accountId, committed, balance: 0, solidFraction: 0, dashedFraction: 0, incomeIncoming: 0, isIncomeAccount: false, state: "none", windowDays: 30 });

function ctxWith(accounts: HealthAccount[], committedByAcct: Record<string, number>): HealthContext {
  return {
    today: new Date(2026, 5, 16),
    accounts,
    schedules: [],
    income: { byAccount: new Map(), totalAll: 0, maxAll: 0 },
    netFlowByAccount: new Map(),
    fundingByAccount: new Map(accounts.map((a) => [a.id, fund(a.id, committedByAcct[a.id] ?? 0)])),
  };
}

test("freeCash: balance minus the account's own committed bills", () => {
  const ctx = ctxWith([{ id: "s", name: "Savings", balance: 500, informational: true }], { s: 0 });
  assert.equal(freeCash(ctx.accounts[0], ctx), 500);
});

test("pickSource: prefers an informational (savings) account, then most free cash", () => {
  const accounts: HealthAccount[] = [
    { id: "a", name: "Current", balance: 1000, informational: false }, // the account needing money
    { id: "b", name: "Spending", balance: 800, informational: false },
    { id: "s", name: "Savings", balance: 300, informational: true },
  ];
  const ctx = ctxWith(accounts, {});
  const src = pickSource(ctx, "a", 200);
  assert.equal(src?.id, "s"); // savings wins over the larger current account
});

test("recommendTransfer: names the source when it can cover the amount", () => {
  const accounts: HealthAccount[] = [
    { id: "a", name: "Current", balance: 0, informational: false },
    { id: "s", name: "Savings", balance: 300, informational: true },
  ];
  const ctx = ctxWith(accounts, {});
  assert.equal(recommendTransfer(ctx, "a", 120), "Move £120.00 from Savings");
});

test("recommendTransfer: partial move + top up when no single source covers it", () => {
  const accounts: HealthAccount[] = [
    { id: "a", name: "Current", balance: 0, informational: false },
    { id: "s", name: "Savings", balance: 50, informational: true },
  ];
  const ctx = ctxWith(accounts, {});
  assert.equal(recommendTransfer(ctx, "a", 120), "Move £50.00 from Savings and top up £70.00");
});

test("recommendTransfer: top up only when there is no source", () => {
  const accounts: HealthAccount[] = [{ id: "a", name: "Current", balance: 0, informational: false }];
  const ctx = ctxWith(accounts, {});
  assert.equal(recommendTransfer(ctx, "a", 120), "Top up £120.00 to cover it");
});

test("pickSource: prefers a source that covers the whole gap over a partial savings", () => {
  const accounts: HealthAccount[] = [
    { id: "a", name: "Current", balance: 0, informational: false },
    { id: "s", name: "Savings", balance: 50, informational: true },   // can't cover 120
    { id: "c", name: "Spending", balance: 300, informational: false }, // covers it
  ];
  const ctx = ctxWith(accounts, {});
  assert.equal(recommendTransfer(ctx, "a", 120), "Move £120.00 from Spending");
});
