import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeParsed, isAllowed, confirmText, parseTextExpense } from "./cashTxn.ts";

test("parseTextExpense: spend default negative, uncategorised, note", () => {
  const r = parseTextExpense("-20 tesco")!;
  assert.equal(r.amount, -20);
  assert.equal(r.category, "uncategorised");
  assert.equal(r.merchant, "tesco");
});

test("parseTextExpense: £ amount defaults to spend", () => {
  const r = parseTextExpense("£12.50 lunch")!;
  assert.equal(r.amount, -12.5);
  assert.equal(r.merchant, "lunch");
});

test("parseTextExpense: leading + marks income", () => {
  const r = parseTextExpense("+2500 salary")!;
  assert.equal(r.amount, 2500);
  assert.equal(r.category, "income");
});

test("parseTextExpense: no number -> null", () => {
  assert.equal(parseTextExpense("no amount here"), null);
  assert.equal(parseTextExpense("£0 nope"), null);
});

test("spend is forced negative; non-income positive flips", () => {
  const r = normalizeParsed({ amount: 12.5, category: "eating-out", merchant: "Pret", date: "2026-06-08" }, "2026-06-08");
  assert.equal(r.amount, "-12.50");
  assert.equal(r.category, "eating-out");
  assert.equal(r.note, "Pret");
  assert.equal(r.date, "2026-06-08");
});

test("income keeps positive", () => {
  assert.equal(normalizeParsed({ amount: 50, category: "income", merchant: "x", date: "" }, "2026-06-08").amount, "50.00");
});

test("already-negative spend stays negative", () => {
  assert.equal(normalizeParsed({ amount: -8, category: "transport", merchant: "TfL", date: "2026-06-08" }, "2026-06-08").amount, "-8.00");
});

test("blank category falls back to uncategorised; bad date -> today", () => {
  const r = normalizeParsed({ amount: -3, category: "", merchant: "", date: "nope" }, "2026-06-08");
  assert.equal(r.category, "uncategorised");
  assert.equal(r.date, "2026-06-08");
});

test("isAllowed compares chat id to the allowed id as strings", () => {
  assert.equal(isAllowed(12345, "12345"), true);
  assert.equal(isAllowed(999, "12345"), false);
  assert.equal(isAllowed(12345, undefined), false);
});

test("confirmText summarises the logged expense", () => {
  const t = confirmText({ amount: "-12.50", category: "eating-out", note: "Pret", date: "2026-06-08" });
  assert.match(t, /-?£?12\.50/);
  assert.match(t, /eating-out/);
  assert.match(t, /Pret/);
});
