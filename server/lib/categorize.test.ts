import { test } from "node:test";
import assert from "node:assert/strict";
import { categorize } from "./categorize.ts";

test("positive amount with salary term is income", () => {
  assert.equal(categorize({ amount: 2500, text: "ACME LTD SALARY" }), "income");
});

test("groceries by merchant keyword", () => {
  assert.equal(categorize({ amount: -42.1, text: "TESCO STORES 1234" }), "groceries");
});

test("eating-out keyword", () => {
  assert.equal(categorize({ amount: -12, text: "PRET A MANGER" }), "eating-out");
});

test("transport keyword", () => {
  assert.equal(categorize({ amount: -3.5, text: "TFL TRAVEL CH" }), "transport");
});

test("bills keyword", () => {
  assert.equal(categorize({ amount: -60, text: "BRITISH GAS" }), "bills");
});

test("unknown debit falls back to other", () => {
  assert.equal(categorize({ amount: -9.99, text: "ZZZ UNKNOWN MERCH" }), "other");
});
