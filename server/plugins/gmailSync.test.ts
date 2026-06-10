import { test } from "node:test";
import assert from "node:assert/strict";
import { matchTransaction } from "./gmailSync.ts";

// A spending transaction the matcher can consider.
const txn = (over: Partial<{ id: string; abs: number; date: string | null; token: string | null; friendly: string | null }> = {}) => ({
  id: "t1", abs: 24.99, date: "2026-06-08", token: "amazon", friendly: null, ...over,
});

test("matchTransaction: merchant must match — amount+date alone is not enough", () => {
  const order = { total: 24.99, date: "2026-06-08T10:00:00Z", token: "asos" };
  // Same amount + same day, but a different merchant token -> no match.
  assert.equal(matchTransaction(order, [txn({ token: "amazon", friendly: null })], new Set()), null);
});

test("matchTransaction: links when the merchant token matches and amount/date are close", () => {
  const order = { total: 24.99, date: "2026-06-08T10:00:00Z", token: "amazon" };
  const t = txn();
  assert.equal(matchTransaction(order, [t], new Set())?.id, "t1");
});

test("matchTransaction: matches via the friendly (merchant) name token", () => {
  const order = { total: 12.5, date: "2026-06-08T10:00:00Z", token: "tesco" };
  const t = txn({ id: "t2", abs: 12.5, token: "tescostoresxyz", friendly: "tesco" });
  assert.equal(matchTransaction(order, [t], new Set())?.id, "t2");
});

test("matchTransaction: rejects amounts beyond the 0.75 tolerance", () => {
  const order = { total: 24.99, date: "2026-06-08T10:00:00Z", token: "amazon" };
  assert.equal(matchTransaction(order, [txn({ abs: 26.0 })], new Set()), null);
});

test("matchTransaction: rejects transactions more than 14 days from the email", () => {
  const order = { total: 24.99, date: "2026-06-08T10:00:00Z", token: "amazon" };
  assert.equal(matchTransaction(order, [txn({ date: "2026-05-01" })], new Set()), null);
});

test("matchTransaction: skips transactions already taken by another order", () => {
  const order = { total: 24.99, date: "2026-06-08T10:00:00Z", token: "amazon" };
  assert.equal(matchTransaction(order, [txn()], new Set(["t1"])), null);
});

test("matchTransaction: among candidates, picks the closest amount", () => {
  const order = { total: 24.99, date: "2026-06-08T10:00:00Z", token: "amazon" };
  const far = txn({ id: "far", abs: 25.5 });
  const near = txn({ id: "near", abs: 24.99 });
  assert.equal(matchTransaction(order, [far, near], new Set())?.id, "near");
});
