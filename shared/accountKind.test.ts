import { test } from "node:test";
import assert from "node:assert/strict";
import { isCreditCard } from "./accountKind.ts";

test("isCreditCard: manual override wins over the bank type", () => {
  assert.equal(isCreditCard({ creditCard: true, cashAccountType: "CACC" }), true);
  assert.equal(isCreditCard({ creditCard: false, cashAccountType: "CARD" }), false);
});

test("isCreditCard: falls back to the bank-reported type", () => {
  assert.equal(isCreditCard({ creditCard: null, cashAccountType: "CARD" }), true);
  assert.equal(isCreditCard({ cashAccountType: "CACC" }), false);
  assert.equal(isCreditCard({}), false);
});
