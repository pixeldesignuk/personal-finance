import { test } from "node:test";
import assert from "node:assert/strict";
import { accountScope } from "./accountScope.ts";

test("returns empty object for undefined (all accounts)", () => {
  assert.deepEqual(accountScope(undefined), {});
});

test("returns empty object for 'all'", () => {
  assert.deepEqual(accountScope("all"), {});
});

test("returns empty object for empty string", () => {
  assert.deepEqual(accountScope(""), {});
});

test("scopes to the given accountId", () => {
  assert.deepEqual(accountScope("acc-1"), { accountId: "acc-1" });
});
