import { test } from "node:test";
import assert from "node:assert/strict";
import { currentBalance } from "./balance.ts";
import { effectiveCategory } from "./effectiveCategory.ts";

test("manual account uses manualBalance", () => {
  assert.equal(currentBalance("MANUAL", 250.5, []), 250.5);
  assert.equal(currentBalance("MANUAL", null, []), 0);
});

test("bank account prefers interimAvailable, then expected, then closingBooked, then first", () => {
  const bals = [
    { type: "closingBooked", amount: 10 },
    { type: "expected", amount: 20 },
    { type: "interimAvailable", amount: 30 },
  ];
  assert.equal(currentBalance("BANK", null, bals), 30);
  assert.equal(currentBalance("BANK", null, [{ type: "expected", amount: 20 }, { type: "closingBooked", amount: 10 }]), 20);
  assert.equal(currentBalance("BANK", null, [{ type: "weird", amount: 7 }]), 7);
  assert.equal(currentBalance("BANK", null, []), 0);
});

test("effectiveCategory prefers override", () => {
  assert.equal(effectiveCategory({ category: "groceries", categoryOverride: "transfer" }), "transfer");
  assert.equal(effectiveCategory({ category: "groceries", categoryOverride: null }), "groceries");
});
