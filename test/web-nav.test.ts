/**
 * The navigation of 0.141.0 (web/app/lib/paths.ts): which row of Places is
 * lit and which branch is open for each address, the page labels of the
 * loading line, the trails, and where the renamed addresses go.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

const paths = await import("../web/app/lib/paths.ts");

test("navOf: exactly one lit row and one open branch, the ones the page is in", () => {
  const cases: ReadonlyArray<readonly [string, ReturnType<typeof paths.navOf>]> = [
    ["/all", { lit: "overview", branch: { kind: "overview" } }],
    ["/vigils", { lit: "vigils", branch: { kind: "overview" } }],
    ["/runs", { lit: "runs", branch: { kind: "overview" } }],
    ["/activity", { lit: "activity", branch: { kind: "overview" } }],
    ["/w/demo-shop", { lit: "overview", branch: { kind: "workspace", ws: "demo-shop" } }],
    ["/w/demo-shop/rituals", { lit: "rituals", branch: { kind: "workspace", ws: "demo-shop" } }],
    ["/w/demo-shop/rituals/site-report", { lit: "rituals", branch: { kind: "workspace", ws: "demo-shop" } }],
    ["/w/demo-shop/milestones/M12", { lit: "milestones", branch: { kind: "workspace", ws: "demo-shop" } }],
    ["/w/demo-shop/runs/01K", { lit: "runs", branch: { kind: "workspace", ws: "demo-shop" } }],
    ["/w/my%20project/candles", { lit: "candles", branch: { kind: "workspace", ws: "my project" } }],
    ["/machines", { lit: "machines", branch: null }],
    ["/machines/host-b", { lit: "machines", branch: null }],
    ["/workspaces", { lit: "workspaces", branch: null }],
    ["/profiles", { lit: "profiles", branch: null }],
    ["/settings", { lit: "settings", branch: null }],
    ["/settings/backups", { lit: "settings", branch: null }],
    ["/nowhere", { lit: null, branch: null }],
    ["/w/demo-shop/nowhere", { lit: null, branch: { kind: "workspace", ws: "demo-shop" } }],
  ];
  for (const [path, nav] of cases) assert.deepEqual(paths.navOf(path), nav, path);
});

test("navOf: a run page lights the section of its item when the run's kind is known", () => {
  assert.deepEqual(paths.navOf("/w/demo/runs/01K", "ritual"), { lit: "rituals", branch: { kind: "workspace", ws: "demo" } });
  assert.deepEqual(paths.navOf("/w/demo/runs/01K", "vigil"), { lit: "vigils", branch: { kind: "workspace", ws: "demo" } });
});

test("pageLabel: the loading line names the page in the new words", () => {
  const cases: ReadonlyArray<readonly [string, string | null]> = [
    ["/workspaces", "Workspaces"],
    ["/machines", "Machines"],
    ["/machines/host-b", "machine host-b"],
    ["/machines/a%20b", "machine a b"],
    ["/all", "Overview"],
    ["/vigils", "Vigils"],
    ["/w/demo-shop", "demo-shop"],
    ["/w/demo-shop/vigils", "Vigils"],
    ["/w/demo-shop/vigils/odds-empty-record", "vigil odds-empty-record"],
    ["/w/demo-shop/rituals/site-report", "ritual site-report"],
    ["/settings/backups", "Settings"],
    ["/profiles", "Profiles"],
    ["/fleet", null],
    ["/status", null],
    ["/nope", null],
  ];
  for (const [path, label] of cases) assert.equal(paths.pageLabel(path), label, path);
});

test("href: the machine pages and the two lists live at the new addresses", () => {
  assert.equal(paths.href({ to: "host", page: "workspaces" }), "/workspaces");
  assert.equal(paths.href({ to: "host", page: "workspaces", query: { health: "failing" } }), "/workspaces?health=failing");
  assert.equal(paths.href({ to: "host", page: "machines" }), "/machines");
  assert.equal(paths.href({ to: "machine", host: "host-b" }), "/machines/host-b");
  assert.equal(paths.href({ to: "machine", host: "a b", hash: "running" }), "/machines/a%20b#running");
});

test("movedTo: the old addresses go to the new ones, with their query", () => {
  const cases: ReadonlyArray<readonly [string, string, string | null]> = [
    ["/fleet", "", "/workspaces"],
    ["/fleet", "?health=failing", "/workspaces?health=failing"],
    ["/topology", "", "/workspaces"],
    ["/hosts", "", "/machines"],
    ["/hosts/host-b", "", "/machines/host-b"],
    ["/hosts/a%20b", "", "/machines/a%20b"],
    ["/status", "", "/machines/demo"],
    ["/status", "?", "/machines/demo"],
    ["/hosts/host-b/x", "", null],
    ["/all", "", null],
  ];
  for (const [path, search, target] of cases) assert.equal(paths.movedTo(path, search, "demo"), target, `${path}${search}`);
});

test("crumbsOf: a page in a workspace starts its trail with Workspaces; all workspaces start with Overview", () => {
  assert.deepEqual(paths.crumbsOf(paths.placeOf("/w/demo-shop")), [
    { label: "Workspaces", href: "/workspaces" },
    { label: "demo-shop", href: null },
  ]);
  assert.deepEqual(paths.crumbsOf(paths.placeOf("/w/demo-shop/vigils")), [
    { label: "Workspaces", href: "/workspaces" },
    { label: "demo-shop", href: "/w/demo-shop" },
    { label: "Vigils", href: null },
  ]);
  assert.deepEqual(paths.crumbsOf(paths.placeOf("/vigils")), [
    { label: "Overview", href: "/all" },
    { label: "Vigils", href: null },
  ]);
  assert.deepEqual(paths.crumbsOf(paths.placeOf("/all")), []);
  assert.deepEqual(paths.crumbsOf(paths.placeOf("/machines")), []);
  assert.deepEqual(paths.machineCrumbs("host-b"), [
    { label: "Machines", href: "/machines" },
    { label: "host-b", href: null },
  ]);
});
