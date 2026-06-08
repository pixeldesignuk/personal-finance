import { test } from "node:test";
import assert from "node:assert/strict";
import { SPENDING_CATEGORIES, CATEGORIES } from "./categorize.ts";

test("SPENDING_CATEGORIES excludes income and transfer", () => {
  assert.ok(!SPENDING_CATEGORIES.includes("income" as never));
  assert.ok(!SPENDING_CATEGORIES.includes("transfer" as never));
  assert.deepEqual([...SPENDING_CATEGORIES].sort(), ["bills", "eating-out", "groceries", "other", "shopping", "transport"]);
});

test("CATEGORIES adds income and transfer to spending set", () => {
  assert.ok(CATEGORIES.includes("income"));
  assert.ok(CATEGORIES.includes("transfer"));
  for (const c of SPENDING_CATEGORIES) assert.ok(CATEGORIES.includes(c));
});
