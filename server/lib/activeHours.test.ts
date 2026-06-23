import { test } from "node:test";
import assert from "node:assert/strict";
import { isWithinActiveHours, hourInZone } from "./activeHours.ts";

const within = (iso: string) => isWithinActiveHours(new Date(iso), 7, 23);

test("daytime hours (7..23) are active in London local time", () => {
  // BST (summer): offsets are +01:00.
  assert.equal(within("2026-06-21T07:30:00+01:00"), true);
  assert.equal(within("2026-06-21T22:30:00+01:00"), true);
  assert.equal(within("2026-06-21T06:30:00+01:00"), false); // before 7am
  assert.equal(within("2026-06-21T23:30:00+01:00"), false); // 11pm onward
});

test("derives the hour from London, NOT the UTC server clock (BST gotcha)", () => {
  // 06:30 UTC in summer is 07:30 BST — must be ACTIVE (would be skipped if we
  // wrongly read UTC).
  assert.equal(within("2026-06-21T06:30:00Z"), true);
  // 23:30 UTC in summer is 00:30 BST next day — must be INACTIVE.
  assert.equal(within("2026-06-21T23:30:00Z"), false);
});

test("works in winter (GMT, offset 0)", () => {
  assert.equal(within("2026-01-15T08:00:00Z"), true);
  assert.equal(within("2026-01-15T05:00:00Z"), false);
});

test("boundaries: start inclusive, end exclusive", () => {
  assert.equal(within("2026-01-15T07:00:00Z"), true);  // exactly 7am
  assert.equal(within("2026-01-15T23:00:00Z"), false); // exactly 11pm
});

test("wrapping window (e.g. 22..6 overnight) and always-on", () => {
  assert.equal(isWithinActiveHours(new Date("2026-01-15T23:00:00Z"), 22, 6), true);
  assert.equal(isWithinActiveHours(new Date("2026-01-15T12:00:00Z"), 22, 6), false);
  assert.equal(isWithinActiveHours(new Date("2026-01-15T12:00:00Z"), 9, 9), true); // start===end
});

test("hourInZone reads the zone hour", () => {
  assert.equal(hourInZone(new Date("2026-06-21T06:30:00Z"), "Europe/London"), 7); // BST
  assert.equal(hourInZone(new Date("2026-01-15T06:30:00Z"), "Europe/London"), 6); // GMT
});
