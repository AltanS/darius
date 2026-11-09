/**
 * The milestone finder as data (web/app/lib/finder.ts): the two short lists
 * of an empty query, the filter and rank of a query, the refs it links to,
 * and the keys that open it.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import type { MilestoneRow } from "../src/web/api.ts";
import { finderOf, finderRows, finderSections, lastWorkedOn, matches, newest, opensFinder, queryTerms, search, type FinderRow } from "../web/app/lib/finder.ts";

function milestone(id: string, title: string, extra: Partial<MilestoneRow> = {}): MilestoneRow {
  return { source: "legacy", id, label: id, slug: title.toLowerCase().replaceAll(" ", "-"), title, started: null, target: null, status: "In Progress", done: 0, total: 0, specs: [], lastActivity: null, ...extra };
}

const ROWS: MilestoneRow[] = [
  milestone("M1", "Setup the repo", { status: "Complete", lastActivity: "2026-08-01T10:00:00.000Z" }),
  milestone("M2", "Cart survives a reload", { lastActivity: "2026-11-08T10:00:00.000Z" }),
  milestone("M3", "Search finds typos", { status: "Not Started" }),
  milestone("M12", "Checkout mail", { status: "Closed", lastActivity: "2026-10-01T10:00:00.000Z" }),
  milestone("M120", "Theme cleanup", { lastActivity: "2026-11-01T10:00:00.000Z" }),
  milestone("M7", "Cart tax rules", { lastActivity: "2026-09-01T10:00:00.000Z" }),
  milestone("M8", "Order export", { lastActivity: "2026-07-01T10:00:00.000Z" }),
];

const rows: FinderRow[] = finderRows(ROWS);
const ids = (list: readonly FinderRow[]): string[] => list.map((row) => row.id);

test("an empty query: Last worked on (newest first, no time left out) and Newest (by number), five each", () => {
  assert.deepEqual(ids(lastWorkedOn(rows)), ["M2", "M120", "M12", "M7", "M1"]);
  assert.deepEqual(ids(newest(rows)), ["M120", "M12", "M8", "M7", "M3"]);
  const sections = finderSections(rows, "   ");
  assert.deepEqual(sections.map((section) => section.title), ["Last worked on", "Newest"]);
  assert.equal(sections[0]?.rows.length, 5);
});

test("an empty query in a workspace where nothing has a time shows Newest alone", () => {
  const bare = finderRows([milestone("M1", "A"), milestone("M2", "B")]);
  assert.deepEqual(finderSections(bare, "").map((section) => section.title), ["Newest"]);
  assert.deepEqual(finderSections([], ""), []);
});

test("a query: every word must be in the id, the title or the slug, any case; all statuses are in", () => {
  assert.deepEqual(queryTerms("  Cart   TAX "), ["cart", "tax"]);
  assert.deepEqual(ids(search(rows, "cart tax")), ["M7"]);
  assert.deepEqual(ids(search(rows, "CART")), ["M2", "M7"]);
  assert.deepEqual(ids(search(rows, "survives-a")), ["M2"], "the slug counts");
  assert.deepEqual(ids(search(rows, "mail")), ["M12"], "a closed milestone is found");
  assert.deepEqual(ids(search(rows, "setup")), ["M1"], "a complete milestone is found");
  assert.deepEqual(search(rows, "cart nothing"), []);
  const cart = rows.find((row) => row.id === "M2");
  assert.ok(cart !== undefined);
  assert.equal(matches(cart, ["cart", "reload"]), true);
});

test("rank: the exact id first, then an id or title prefix, then by last activity", () => {
  // M12 is the id; M120 starts with it; M1 is no hit for "m12".
  assert.deepEqual(ids(search(rows, "m12")), ["M12", "M120"]);
  assert.deepEqual(ids(search(rows, "12")), ["M12", "M120"], "a bare number names the id");
  // "M1" hits M1 exactly, then M12 and M120 by prefix, newest work first.
  assert.deepEqual(ids(search(rows, "m1")), ["M1", "M120", "M12"]);
  // A title prefix beats a hit inside the title, whatever the time.
  const extra = finderRows([...ROWS, milestone("M9", "Old order cleanup", { lastActivity: "2026-11-09T09:00:00.000Z" })]);
  assert.deepEqual(ids(search(extra, "order")), ["M8", "M9"]);
  assert.deepEqual(ids(search(extra, "cleanup")), ["M9", "M120"], "no prefix hit: newest work first");
});

test("a query gives one flat list with no title", () => {
  const sections = finderSections(rows, "cart");
  assert.equal(sections.length, 1);
  assert.equal(sections[0]?.title, null);
  assert.deepEqual(finderSections(rows, "zzz"), [{ title: null, rows: [] }]);
});

test("the ref keeps the M12 vs M12-slug rule of the detail page", () => {
  const shared = finderRows([milestone("M5", "Cart"), milestone("M5", "Mail"), milestone("M6", "Solo")]);
  assert.deepEqual(shared.map((row) => row.ref), ["M5-cart", "M5-mail", "M6"]);
});

test("the finder data comes for a workspace page only", () => {
  const projects = [{ name: "demo", milestones: ROWS }];
  assert.equal(finderOf(projects, "/w/demo/milestones/M2")?.ws, "demo");
  assert.equal(finderOf(projects, "/w/demo")?.rows.length, ROWS.length);
  assert.equal(finderOf(projects, "/milestones"), null, "all workspaces");
  assert.equal(finderOf(projects, "/settings"), null, "a host page");
  assert.equal(finderOf(projects, "/w/other/vigils"), null, "a workspace this host does not have");
});

interface KeyPress {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}

function key(k: string, extra: Partial<KeyPress> = {}): KeyPress {
  return { key: k, ctrlKey: false, metaKey: false, altKey: false, ...extra };
}

test("the keys: / outside a text field, Ctrl+K or Cmd+K anywhere", () => {
  assert.equal(opensFinder(key("/"), false), true);
  assert.equal(opensFinder(key("/"), true), false, "typing / in a field");
  assert.equal(opensFinder(key("k", { ctrlKey: true }), true), true);
  assert.equal(opensFinder(key("K", { metaKey: true }), false), true);
  assert.equal(opensFinder(key("k"), false), false);
  assert.equal(opensFinder(key("k", { ctrlKey: true, altKey: true }), false), false);
  assert.equal(opensFinder(key("/", { ctrlKey: true }), false), false);
});
