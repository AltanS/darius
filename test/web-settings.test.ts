/**
 * The settings cookie drives the page frame: the root loader reads it and
 * puts data-theme, data-density and data-motion on <html>, and the PWA
 * theme-color follows the theme. Renders through the committed build like
 * test/web-app.test.ts does.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { HostStatus, WebContext, WebHandler } from "../src/web/api.ts";
import { DEFAULT_SETTINGS, SETTINGS_COOKIE, settingsValue, type Settings } from "../web/app/lib/settings.ts";

const SANDBOX = mkdtempSync(join(tmpdir(), "darius-web-settings-"));
process.env.DARIUS_STATE_DIR = join(SANDBOX, "state");
process.env.DARIUS_CONFIG_DIR = join(SANDBOX, "config");

const built: { default: WebHandler } = await import("../web/build/server/index.js");

const STATUS: HostStatus = {
  host: "testhost",
  version: "9.9.9",
  generatedAt: "2026-09-28T09:00:00.000Z",
  today: "2026-09-28",
  utcOffset: 120,
  profiles: [],
  projects: [],
};

const context: WebContext = {
  viewer: "owner on phone",
  nonce: "bm9uY2Utb2YtdGhlLXRlc3Q=",
  status: () => STATUS,
  ritual: () => null,
  run: () => null,
};

async function page(path: string, settings: Settings | null): Promise<string> {
  const headers = new Headers();
  if (settings !== null) headers.set("cookie", `${SETTINGS_COOKIE}=${settingsValue(settings)}`);
  const response = await built.default(new Request(`http://darius.test${path}`, { headers }), context);
  assert.equal(response.status, 200, path);
  return response.text();
}

function htmlTag(body: string): string {
  return /<html\b[^>]*>/u.exec(body)?.[0] ?? "";
}

test("no cookie renders the dark, comfortable theme", async () => {
  const tag = htmlTag(await page("/settings", null));
  assert.ok(tag.includes('data-theme="dark"'), tag);
  assert.ok(tag.includes('data-density="comfortable"'), tag);
  assert.ok(tag.includes('data-motion="system"'), tag);
});

test("a light cookie renders data-theme=light on <html>, on every page", async () => {
  const light: Settings = { ...DEFAULT_SETTINGS, theme: "light", density: "compact", motion: "reduce" };
  for (const path of ["/", "/runs", "/settings", "/profiles"]) {
    const body = await page(path, light);
    const tag = htmlTag(body);
    assert.ok(tag.includes('data-theme="light"'), `${path}: ${tag}`);
    assert.ok(tag.includes('data-density="compact"'), `${path}: ${tag}`);
    assert.ok(tag.includes('data-motion="reduce"'), `${path}: ${tag}`);
    assert.ok(body.includes('<meta name="color-scheme" content="light"'), path);
    assert.ok(body.includes('<meta name="theme-color" content="#f0e6c9"'), path);
  }
});

test("the system theme names both colour schemes and both theme colours", async () => {
  const body = await page("/settings", { ...DEFAULT_SETTINGS, theme: "system" });
  assert.ok(htmlTag(body).includes('data-theme="system"'));
  assert.ok(body.includes('content="dark light"'));
  assert.match(body, /<meta name="theme-color" content="#f0e6c9" media="\(prefers-color-scheme: light\)"/u);
  assert.match(body, /<meta name="theme-color" content="#15100b" media="\(prefers-color-scheme: dark\)"/u);
});

test("the settings page shows its sections and the host facts", async () => {
  const body = (await page("/settings", null)).replaceAll("<!-- -->", "");
  for (const text of ["Appearance", "Workspaces", "Motion", "Notifications", "About", "testhost", "darius 9.9.9", "owner on phone", "Self-test workspace".toLowerCase()]) {
    assert.ok(body.toLowerCase().includes(text.toLowerCase()), text);
  }
});

test("a cookie that is not valid changes nothing", async () => {
  const response = await built.default(new Request("http://darius.test/settings", { headers: { cookie: `${SETTINGS_COOKIE}=%E0%A4%A` } }), context);
  assert.ok(htmlTag(await response.text()).includes('data-theme="dark"'));
});
