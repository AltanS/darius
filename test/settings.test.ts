/**
 * The settings cookie (web/app/lib/settings.ts): a value written by the
 * settings page reads back the same, and anything unknown, missing or
 * broken falls back to the defaults, so a bad cookie never breaks a page.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_SETTINGS, readSettings, SETTINGS_COOKIE, settingsValue, type Settings } from "../web/app/lib/settings.ts";

function header(value: string, others = ""): string {
  return `${others}${SETTINGS_COOKIE}=${value}`;
}

test("settings survive the cookie round trip", () => {
  const settings: Settings = { theme: "light", density: "compact", defaultWorkspace: "acme-web", showSelftest: true, motion: "reduce" };
  assert.deepEqual(readSettings(header(settingsValue(settings))), settings);
  assert.deepEqual(readSettings(header(settingsValue(DEFAULT_SETTINGS))), DEFAULT_SETTINGS);
  const system: Settings = { ...DEFAULT_SETTINGS, theme: "system" };
  assert.deepEqual(readSettings(header(settingsValue(system))), system);
});

test("the cookie is found among other cookies", () => {
  const settings: Settings = { ...DEFAULT_SETTINGS, theme: "light" };
  assert.equal(readSettings(header(settingsValue(settings), "a=1; other=x; ")).theme, "light");
  assert.equal(readSettings(`${header(settingsValue(settings))}; later=2`).theme, "light");
});

test("no cookie, or another cookie, gives the defaults", () => {
  assert.deepEqual(readSettings(null), DEFAULT_SETTINGS);
  assert.deepEqual(readSettings(""), DEFAULT_SETTINGS);
  assert.deepEqual(readSettings("theme=light; darius-settings-x=1"), DEFAULT_SETTINGS);
});

test("unknown values fall back one by one", () => {
  const read = readSettings(header(encodeURIComponent("theme=neon&density=compact&motion=warp&selftest=yes&ws=")));
  assert.equal(read.theme, DEFAULT_SETTINGS.theme);
  assert.equal(read.density, "compact");
  assert.equal(read.motion, DEFAULT_SETTINGS.motion);
  assert.equal(read.showSelftest, false);
  assert.equal(read.defaultWorkspace, null);
});

test("a workspace name that is not a plain name is dropped", () => {
  for (const bad of ["../etc", "a b", "<script>", "x".repeat(101)]) {
    assert.equal(readSettings(header(encodeURIComponent(`ws=${bad}`))).defaultWorkspace, null, bad);
  }
  assert.equal(readSettings(header(encodeURIComponent("ws=darius.test-1_x"))).defaultWorkspace, "darius.test-1_x");
});

test("a broken cookie is ignored", () => {
  for (const bad of ["%E0%A4%A", "%", "=&=&", "theme", "&&&&", "\u0000"]) {
    assert.deepEqual(readSettings(header(bad)), DEFAULT_SETTINGS, bad);
  }
});
