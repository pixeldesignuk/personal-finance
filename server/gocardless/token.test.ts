import { test } from "node:test";
import assert from "node:assert/strict";
import { TokenManager } from "./token.ts";

const creds = { secretId: "id", secretKey: "key" };

test("fetches once then serves cached token", async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls++;
    return new Response(JSON.stringify({ access: "tok-A", access_expires: 3600 }), { status: 200 });
  }) as typeof fetch;
  const tm = new TokenManager(creds, fetchImpl, () => 1000);
  assert.equal(await tm.get(), "tok-A");
  assert.equal(await tm.get(), "tok-A");
  assert.equal(calls, 1);
});

test("re-fetches after expiry", async () => {
  let token = "tok-1";
  const fetchImpl = (async () => {
    const body = { access: token, access_expires: 100 };
    token = "tok-2";
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
  let now = 0;
  const tm = new TokenManager(creds, fetchImpl, () => now);
  assert.equal(await tm.get(), "tok-1");
  now = 200_000; // past 100s expiry (ms)
  assert.equal(await tm.get(), "tok-2");
});

test("throws on non-2xx", async () => {
  const fetchImpl = (async () => new Response("nope", { status: 401 })) as typeof fetch;
  const tm = new TokenManager(creds, fetchImpl, () => 0);
  await assert.rejects(() => tm.get(), /401/);
});
