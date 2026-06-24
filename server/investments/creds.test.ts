import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveCreds, validateCreds } from "./creds.ts";

test("resolveCreds: stored providerConfig wins over env", () => {
  const cfg = { keyId: "a", secret: "b" };
  assert.deepEqual(resolveCreds("trading212", cfg), cfg);
});

test("resolveCreds: unknown provider has no env fallback → null", () => {
  // Env-independent: there are no legacy env creds for an unknown provider.
  assert.equal(resolveCreds("unknown", null), null);
  assert.equal(resolveCreds("unknown", {}), null);
});

test("validateCreds: trims and keeps known fields, drops unknown", () => {
  const r = validateCreds("trading212", { keyId: " k ", secret: "s", junk: "x" });
  assert.equal(r.ok, true);
  assert.deepEqual(r.ok && r.creds, { keyId: "k", secret: "s" });
});

test("validateCreds: rejects a missing required field", () => {
  const r = validateCreds("trading212", { keyId: "k" });
  assert.equal(r.ok, false);
  assert.match((r as { error: string }).error, /API key/);
});

test("validateCreds: optional field may be blank", () => {
  const r = validateCreds("bitget", { apiKey: "a", apiSecret: "b", passphrase: "c" });
  assert.equal(r.ok, true);
  assert.deepEqual(r.ok && r.creds, { apiKey: "a", apiSecret: "b", passphrase: "c" });
});

test("validateCreds: unknown provider", () => {
  const r = validateCreds("nope", { x: "y" });
  assert.equal(r.ok, false);
});
