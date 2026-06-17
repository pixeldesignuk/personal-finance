import { test } from "node:test";
import assert from "node:assert/strict";
import { categoryClass, NEEDS_KEYS } from "../../shared/categoryClass.ts";

test("groceries and housing are needs", () => {
  assert.equal(categoryClass("groceries"), "needs");
  assert.equal(categoryClass("housing"), "needs");
});
test("dining-out is wants, unknown is null", () => {
  assert.equal(categoryClass("dining-out"), "wants");
  assert.equal(categoryClass("nonsense"), null);
});
test("NEEDS_KEYS lists every needs category", () => {
  assert.ok(NEEDS_KEYS.includes("groceries"));
  assert.ok(!NEEDS_KEYS.includes("dining-out"));
});
