import { test } from "node:test";
import assert from "node:assert/strict";
import { slug, applyRules, type Rule } from "./rules.ts";

test("slug lowercases, hyphenates, strips punctuation", () => {
  assert.equal(slug("Electric & Gas"), "electric-gas");
  assert.equal(slug("  Maryam  Football "), "maryam-football");
  assert.equal(slug("M&S"), "m-s");
});

const rules: Rule[] = [
  { matchText: "tesco", categoryKey: "groceries", personKey: null, priority: 10 },
  { matchText: "football", categoryKey: null, personKey: "maryam", priority: 5 },
  { matchText: "british gas", categoryKey: "electric-gas", personKey: "household", priority: 1 },
];

test("applyRules sets category and person independently, case-insensitive", () => {
  assert.deepEqual(applyRules("TESCO STORES 1234", rules), { categoryKey: "groceries", personKey: undefined });
  assert.deepEqual(applyRules("Maryam Football club", rules), { categoryKey: undefined, personKey: "maryam" });
  assert.deepEqual(applyRules("BRITISH GAS", rules), { categoryKey: "electric-gas", personKey: "household" });
});

test("highest priority wins per field; no match -> empty", () => {
  const r: Rule[] = [
    { matchText: "amazon", categoryKey: "shopping", personKey: null, priority: 1 },
    { matchText: "amazon", categoryKey: "uncategorised", personKey: null, priority: 9 },
  ];
  assert.equal(applyRules("AMAZON UK", r).categoryKey, "uncategorised");
  assert.deepEqual(applyRules("nothing here", rules), { categoryKey: undefined, personKey: undefined });
});
