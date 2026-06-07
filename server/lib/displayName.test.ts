import { test } from "node:test";
import assert from "node:assert/strict";
import { displayName } from "../../shared/displayName.ts";

test("nickname wins when set", () => {
  assert.equal(displayName({ id: "acc-1234", name: "Current", nickname: "Spending" }), "Spending");
});

test("falls back to name when no nickname", () => {
  assert.equal(displayName({ id: "acc-1234", name: "Current", nickname: null }), "Current");
});

test("falls back to id suffix when no name or nickname", () => {
  assert.equal(displayName({ id: "abcd1234", name: null, nickname: null }), "Account ••1234");
});

test("treats empty-string nickname/name as unset", () => {
  assert.equal(displayName({ id: "abcd1234", name: "", nickname: "" }), "Account ••1234");
});
