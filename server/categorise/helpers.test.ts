import { test } from "node:test";
import assert from "node:assert/strict";
import { merchantToken, parsePicks, mapPicks, chooseReceiptCategory } from "./helpers.ts";

test("chooseReceiptCategory: AI suggestion outranks the merchant rule", () => {
  // The TESCO-fuel bug: a "tesco → groceries" rule must not override the AI's
  // receipt-aware pick of transport.
  assert.equal(chooseReceiptCategory("transport", "groceries"), "transport");
});

test("chooseReceiptCategory: falls back to the rule when the AI is unsure", () => {
  assert.equal(chooseReceiptCategory(null, "groceries"), "groceries");
  assert.equal(chooseReceiptCategory(undefined, "groceries"), "groceries");
});

test("chooseReceiptCategory: uncategorised when neither has an opinion", () => {
  assert.equal(chooseReceiptCategory(null, null), "uncategorised");
});

test("merchantToken lowercases and drops store numbers", () => {
  assert.equal(merchantToken("Tesco Stores 2934"), "tesco stores");
  assert.equal(merchantToken("AMAZON"), "amazon");
});

test("merchantToken caps at three words", () => {
  assert.equal(merchantToken("The Coffee House On Main"), "the coffee house");
});

test("merchantToken returns null when there's nothing to learn", () => {
  assert.equal(merchantToken(null), null);
  assert.equal(merchantToken("   "), null);
  assert.equal(merchantToken("12345"), null);
  assert.equal(merchantToken("a"), null);
});

test("parsePicks reads a bare array", () => {
  assert.deepEqual(parsePicks('[{"id":"t0","categoryKey":"groceries"}]'), [
    { id: "t0", categoryKey: "groceries" },
  ]);
});

test("parsePicks reads an items-wrapped object", () => {
  assert.deepEqual(parsePicks('{"items":[{"id":"t1","categoryKey":"bills"}]}'), [
    { id: "t1", categoryKey: "bills" },
  ]);
});

test("parsePicks ignores malformed entries and bad json", () => {
  assert.deepEqual(parsePicks("not json"), []);
  assert.deepEqual(parsePicks('{"foo":1}'), []);
  assert.deepEqual(parsePicks('[{"id":"t0"},{"categoryKey":"x"}]'), []);
});

test("mapPicks keeps only valid keys", () => {
  const valid = new Set(["groceries", "bills"]);
  const m = mapPicks(
    [
      { id: "t0", categoryKey: "groceries" },
      { id: "t1", categoryKey: "nope" },
    ],
    valid,
  );
  assert.equal(m.get("t0"), "groceries");
  assert.equal(m.has("t1"), false);
  assert.equal(m.size, 1);
});
