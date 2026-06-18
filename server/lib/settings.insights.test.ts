import { test } from "node:test";
import assert from "node:assert/strict";
import { STRING_SETTING_DEFS } from "./settings.ts";

test("insights.txnsSeenAt is a known string setting, defaults empty", () => {
  const def = STRING_SETTING_DEFS.find((d) => d.key === "insights.txnsSeenAt");
  assert.ok(def, "setting def exists");
  assert.equal(def!.default, "");
});

test("insights.txnsSeenAt accepts empty + ISO, rejects junk", () => {
  const def = STRING_SETTING_DEFS.find((d) => d.key === "insights.txnsSeenAt")!;
  assert.equal(def.validate!(""), true);
  assert.equal(def.validate!("2026-06-18T10:00:00.000Z"), true);
  assert.equal(def.validate!("not-a-date"), false);
});
