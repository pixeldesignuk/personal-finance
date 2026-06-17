import { test } from "node:test";
import assert from "node:assert/strict";
import { STRING_SETTING_DEFS } from "./settings.ts";

test("savings settings are registered with sane defaults", () => {
  const byKey = Object.fromEntries(STRING_SETTING_DEFS.map((d) => [d.key, d]));
  assert.equal(byKey["savings.efMonthsFull"].default, "3");
  assert.equal(byKey["savings.cushion"].default, "100");
  assert.ok("savings.emergencyAccountId" in byKey);
});
test("numeric setting validates", () => {
  const def = STRING_SETTING_DEFS.find((d) => d.key === "savings.efMonthsFull")!;
  assert.equal(def.validate!("6"), true);
  assert.equal(def.validate!("abc"), false);
});
