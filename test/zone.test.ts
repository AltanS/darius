/**
 * `src/core/zone.ts`: wall time in an IANA zone with `Intl` only. The vectors
 * are the ones of docs/architecture/marker-v3.md, section 3.2.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { dateIn, isZone, offsetAt, zoned } from "../src/core/zone.ts";

const VECTORS: [string, string, string, string, string][] = [
  ["Europe/Berlin", "2026-07-01", "09:05", "2026-07-01T07:05:00.000Z", "summer, CEST"],
  ["Europe/Berlin", "2026-01-15", "09:05", "2026-01-15T08:05:00.000Z", "winter, CET"],
  ["Europe/Berlin", "2026-03-29", "02:30", "2026-03-29T01:30:00.000Z", "the gap shifts forward to 03:30 CEST"],
  ["Europe/Berlin", "2026-10-25", "02:30", "2026-10-25T00:30:00.000Z", "the first 02:30, CEST"],
  ["Europe/Berlin", "2026-10-25", "03:30", "2026-10-25T02:30:00.000Z", "after the fall back"],
  ["UTC", "2026-05-05", "00:00", "2026-05-05T00:00:00.000Z", "midnight UTC"],
  ["UTC", "2028-02-29", "00:00", "2028-02-29T00:00:00.000Z", "midnight UTC on a leap day"],
  ["America/New_York", "2026-03-08", "02:30", "2026-03-08T07:30:00.000Z", "the gap shifts forward to 03:30 EDT"],
  ["America/New_York", "2026-11-01", "01:30", "2026-11-01T05:30:00.000Z", "the first 01:30, EDT"],
  ["Asia/Kolkata", "2026-07-01", "09:05", "2026-07-01T03:35:00.000Z", "a half-hour offset"],
];

for (const [tz, date, hhmm, expected, why] of VECTORS) {
  test(`zoned ${date} ${hhmm} ${tz} is ${expected} (${why})`, () => {
    assert.equal(zoned(date, hhmm, tz).toISOString(), expected);
  });
}

test("offsetAt gives minutes east of UTC on both sides of a change", () => {
  assert.equal(offsetAt(new Date("2026-03-29T00:59:59Z"), "Europe/Berlin"), 60);
  assert.equal(offsetAt(new Date("2026-03-29T01:00:00Z"), "Europe/Berlin"), 120);
  assert.equal(offsetAt(new Date("2026-07-01T00:00:00.500Z"), "Europe/Berlin"), 120);
  assert.equal(offsetAt(new Date("2026-03-08T07:00:00Z"), "America/New_York"), -240);
  assert.equal(offsetAt(new Date("2026-03-08T06:59:00Z"), "America/New_York"), -300);
  assert.equal(offsetAt(new Date("2026-07-01T00:00:00Z"), "Asia/Kolkata"), 330);
  assert.equal(offsetAt(new Date("2026-07-01T00:00:00Z"), "UTC"), 0);
});

test("dateIn gives the calendar date in the zone, the host's local date without one", () => {
  const instant = new Date("2026-09-30T22:30:00Z");
  assert.equal(dateIn(instant, "Europe/Berlin"), "2026-10-01");
  assert.equal(dateIn(instant, "UTC"), "2026-09-30");
  assert.equal(dateIn(instant, "America/New_York"), "2026-09-30");
  const local = new Date(2026, 8, 30, 23, 59);
  assert.equal(dateIn(local), "2026-09-30");
});

test("isZone accepts IANA names and refuses anything else", () => {
  assert.equal(isZone("Europe/Berlin"), true);
  assert.equal(isZone("UTC"), true);
  assert.equal(isZone("Mars/Olympus"), false);
  assert.equal(isZone(""), false);
});

test("zoned refuses a malformed date, time or zone", () => {
  assert.throws(() => zoned("2026-02-30", "09:05", "UTC"), /invalid date/);
  assert.throws(() => zoned("2026-10-01", "9:05", "UTC"), /invalid time/);
  assert.throws(() => zoned("2026-10-01", "24:00", "UTC"), /invalid time/);
  assert.throws(() => zoned("2026-10-01", "09:05", "Mars/Olympus"), /invalid time zone/);
});

test("an invalid instant is an error", () => {
  assert.throws(() => dateIn(new Date(Number.NaN), "UTC"), /invalid instant/);
  assert.throws(() => offsetAt(new Date(Number.NaN), "UTC"), /invalid instant/);
});
