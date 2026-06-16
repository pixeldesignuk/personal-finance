import { test } from "node:test";
import assert from "node:assert/strict";
import { slug, applyRules, ruleMatchText, type Rule } from "./rules.ts";

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

test("matching is whitespace-insensitive (bank data pads names with spaces)", () => {
  const r: Rule[] = [{ matchText: "hasan khan mujahid", categoryKey: "transfer", personKey: "you", priority: 1 }];
  assert.deepEqual(applyRules("Hasan Khan      Mujahid", r), { categoryKey: "transfer", personKey: "you" });
});

test("matching is punctuation-insensitive (tokens drop punctuation, so matching must too)", () => {
  // A token learned from "OBSIDIAN.MD" is "obsidian md"; it must still match the
  // raw statement line that kept the dot. Tokenisation and matching have to use
  // the same normalisation or a rule silently never fires.
  const r: Rule[] = [{ matchText: "obsidian md", categoryKey: "subscriptions", personKey: null, priority: 1 }];
  assert.equal(applyRules("INT'L 1840317619 OBSIDIAN.MD OAKVILLE", r).categoryKey, "subscriptions");
});

test("ruleMatchText strips the international-card marker so the rule actually matches", () => {
  // "INT'L" cleans to "int l"; the reference number is already dropped from the
  // token. Without stripping, matchText "int l obsidian" never matches the live
  // "INT'L 2081438168 OBSIDIAN" line (the reference splits the two).
  assert.equal(ruleMatchText("int l obsidian"), "obsidian");
  // "INTL CARD <ref>" form, where an alphanumeric reference survived into token.
  assert.equal(ruleMatchText("intl card rqba96bi obsidian"), "obsidian");
  // A clean token is returned unchanged.
  assert.equal(ruleMatchText("tesco stores"), "tesco stores");
  // A real merchant that merely starts with "intl" is left alone (no reference).
  assert.equal(ruleMatchText("intl foods market"), "intl foods market");

  // The stripped matchText is a substring of the live statement line, so a rule
  // built from a polluted token now fires:
  const r: Rule[] = [{ matchText: ruleMatchText("int l obsidian"), categoryKey: "subscriptions", personKey: null, priority: 1 }];
  assert.equal(applyRules("INT'L 2081438168 OBSIDIAN OAKVILLE", r).categoryKey, "subscriptions");
});

test("highest priority wins per field; no match -> empty", () => {
  const r: Rule[] = [
    { matchText: "amazon", categoryKey: "shopping", personKey: null, priority: 1 },
    { matchText: "amazon", categoryKey: "uncategorised", personKey: null, priority: 9 },
  ];
  assert.equal(applyRules("AMAZON UK", r).categoryKey, "uncategorised");
  assert.deepEqual(applyRules("nothing here", rules), { categoryKey: undefined, personKey: undefined });
});
