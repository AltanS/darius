/**
 * The link builder of the web app (web/app/lib/paths.ts): every internal URL
 * is built by href() and read back by placeOf(). Two checks: a round trip over
 * the kinds of target, and a scan of the app source for a link written by hand.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const paths = await import("../web/app/lib/paths.ts");

type Place = ReturnType<typeof paths.placeOf>;
type Target = Parameters<typeof paths.href>[0];

const SPACED = "my project";
const PERCENT = "100%/done";

const CASES: { target: Target; place: Place }[] = [
  { target: { to: "overview", ws: null }, place: { scope: null, kind: "overview", section: null } },
  { target: { to: "overview", ws: "demo" }, place: { scope: "demo", kind: "overview", section: null } },
  { target: { to: "overview", ws: SPACED }, place: { scope: SPACED, kind: "overview", section: null } },
  { target: { to: "overview", ws: PERCENT }, place: { scope: PERCENT, kind: "overview", section: null } },
  { target: { to: "section", ws: null, section: "vigils" }, place: { scope: null, kind: "section", section: "vigils" } },
  { target: { to: "section", ws: null, section: "rituals" }, place: { scope: null, kind: "section", section: "rituals" } },
  { target: { to: "section", ws: null, section: "findings", query: { view: "all" } }, place: { scope: null, kind: "section", section: "findings" } },
  { target: { to: "section", ws: null, section: "milestones" }, place: { scope: null, kind: "section", section: "milestones" } },
  { target: { to: "section", ws: null, section: "runs", query: { state: "failed" } }, place: { scope: null, kind: "section", section: "runs" } },
  { target: { to: "section", ws: "demo", section: "vigils" }, place: { scope: "demo", kind: "section", section: "vigils" } },
  { target: { to: "section", ws: "demo", section: "runs", query: { imported: "1" } }, place: { scope: "demo", kind: "section", section: "runs" } },
  { target: { to: "section", ws: "demo", section: "findings", query: { view: "open", ritual: "daily report" } }, place: { scope: "demo", kind: "section", section: "findings" } },
  { target: { to: "section", ws: SPACED, section: "milestones" }, place: { scope: SPACED, kind: "section", section: "milestones" } },
  { target: { to: "ritual", ws: "demo", slug: "daily-report" }, place: { scope: "demo", kind: "detail", section: "rituals" } },
  { target: { to: "ritual", ws: SPACED, slug: "a b" }, place: { scope: SPACED, kind: "detail", section: "rituals" } },
  { target: { to: "run", ws: "demo", run: "01KAAAAAAAAAAAAAAAAAAAAAAA" }, place: { scope: "demo", kind: "detail", section: "runs" } },
  { target: { to: "run", ws: PERCENT, run: "01KAAAAAAAAAAAAAAAAAAAAAAA" }, place: { scope: PERCENT, kind: "detail", section: "runs" } },
  { target: { to: "milestone", ws: "demo", ref: "M7" }, place: { scope: "demo", kind: "detail", section: "milestones" } },
  { target: { to: "milestone", ws: SPACED, ref: "M12-cart shop" }, place: { scope: SPACED, kind: "detail", section: "milestones" } },
  { target: { to: "vigil", ws: "demo", slug: "guard-soak" }, place: { scope: "demo", kind: "section", section: "vigils" } },
  { target: { to: "host", page: "status" }, place: { scope: null, kind: "host", section: null } },
  { target: { to: "host", page: "profiles", hash: "profile-fast" }, place: { scope: null, kind: "host", section: null } },
  { target: { to: "host", page: "settings" }, place: { scope: null, kind: "host", section: null } },
  { target: { to: "host", page: "settings/backups" }, place: { scope: null, kind: "host", section: null } },
];

function pathnameOf(address: string): string {
  return new URL(address, "http://darius.test").pathname;
}

test("href() and placeOf() agree for every kind of target", () => {
  for (const { target, place } of CASES) {
    const address = paths.href(target);
    assert.deepEqual(paths.placeOf(pathnameOf(address)), place, address);
  }
});

test("href() encodes names, and keeps a query and a hash apart from the path", () => {
  assert.equal(paths.href({ to: "overview", ws: SPACED }), "/w/my%20project");
  assert.equal(paths.href({ to: "overview", ws: PERCENT }), "/w/100%25%2Fdone");
  assert.equal(paths.href({ to: "overview", ws: null }), "/all");
  assert.equal(paths.href({ to: "section", ws: null, section: "vigils" }), "/vigils");
  assert.equal(paths.href({ to: "section", ws: "demo", section: "findings", query: { view: "open", ritual: "a b" } }), "/w/demo/findings?view=open&ritual=a+b");
  assert.equal(paths.href({ to: "section", ws: "demo", section: "runs", query: { state: "failed" } }), "/w/demo/runs?state=failed");
  assert.equal(paths.href({ to: "ritual", ws: "demo", slug: "daily-report" }), "/w/demo/rituals/daily-report");
  assert.equal(paths.href({ to: "run", ws: "demo", run: "01K" }), "/w/demo/runs/01K");
  assert.equal(paths.href({ to: "milestone", ws: "demo", ref: "M12-cart" }), "/w/demo/milestones/M12-cart");
  assert.equal(paths.href({ to: "vigil", ws: "demo", slug: "guard soak" }), "/w/demo/vigils#vigil-guard%20soak");
  assert.equal(paths.href({ to: "host", page: "settings/about" }), "/settings/about");
  assert.equal(paths.href({ to: "host", page: "profiles", hash: "profile-fast" }), "/profiles#profile-fast");
});

test("placeOf() knows no scope for a path with none", () => {
  assert.deepEqual(paths.placeOf("/"), { scope: null, kind: "overview", section: null });
  assert.deepEqual(paths.placeOf("/nowhere"), { scope: null, kind: "unknown", section: null });
  assert.deepEqual(paths.placeOf("/w/demo/nowhere"), { scope: "demo", kind: "unknown", section: null });
  assert.deepEqual(paths.placeOf("/w/%E0%A4%A"), { scope: "%E0%A4%A", kind: "overview", section: null });
});

test("switchTarget() keeps the section and sends a detail page to its list", () => {
  const rituals = paths.placeOf("/w/demo/rituals");
  assert.equal(paths.href(paths.switchTarget(rituals, "other")), "/w/other/rituals");
  assert.equal(paths.href(paths.switchTarget(rituals, null)), "/rituals");
  assert.equal(paths.href(paths.switchTarget(paths.placeOf("/w/demo/milestones/M7"), "other")), "/w/other/milestones");
  assert.equal(paths.href(paths.switchTarget(paths.placeOf("/w/demo"), "other")), "/w/other");
  assert.equal(paths.href(paths.switchTarget(paths.placeOf("/status"), "other")), "/w/other");
  assert.equal(paths.href(paths.switchTarget(paths.placeOf("/all"), "other")), "/w/other");
});

test("crumbsOf() lists the scope, the section, the parent and the title; only the last step is not a link", () => {
  const ritual = paths.placeOf("/w/demo/rituals/daily-report");
  assert.deepEqual(paths.crumbsOf(ritual, undefined, "Daily report"), [
    { label: "demo", href: "/w/demo" },
    { label: "Rituals", href: "/w/demo/rituals" },
    { label: "Daily report", href: null },
  ]);
  const parent = { label: "Daily report", target: { to: "ritual", ws: "demo", slug: "daily-report" } satisfies Target };
  const run = paths.placeOf("/w/demo/runs/01K");
  const inRituals = { ...run, section: paths.litSection(run, "ritual") };
  assert.deepEqual(paths.crumbsOf(inRituals, parent, "Findings heading"), [
    { label: "demo", href: "/w/demo" },
    { label: "Rituals", href: "/w/demo/rituals" },
    { label: "Daily report", href: "/w/demo/rituals/daily-report" },
    { label: "Findings heading", href: null },
  ]);
  const vigil = { label: "Guard soak", target: { to: "vigil", ws: "demo", slug: "guard" } satisfies Target };
  assert.deepEqual(paths.crumbsOf({ ...run, section: paths.litSection(run, "vigil") }, undefined, "Guard soak").map((crumb) => crumb.label), ["demo", "Vigils", "Guard soak"]);
  assert.equal(paths.crumbsOf({ ...run, section: "vigils" }, vigil).at(-1)?.href, null, "without a title the parent is the last step and not a link");
  assert.deepEqual(paths.crumbsOf(paths.placeOf("/w/demo/runs")), [
    { label: "demo", href: "/w/demo" },
    { label: "Runs", href: null },
  ]);
  assert.deepEqual(paths.crumbsOf(paths.placeOf("/runs")), [
    { label: "All workspaces", href: "/all" },
    { label: "Runs", href: null },
  ]);
  assert.deepEqual(paths.crumbsOf(paths.placeOf("/w/demo")), []);
  assert.deepEqual(paths.crumbsOf(paths.placeOf("/settings")), []);
});

test("litSection() lights the section of the page; a run page lights the section of its item", () => {
  assert.equal(paths.litSection(paths.placeOf("/w/demo/rituals/daily-report")), "rituals");
  assert.equal(paths.litSection(paths.placeOf("/w/demo/milestones/M7")), "milestones");
  assert.equal(paths.litSection(paths.placeOf("/w/demo/findings")), "findings");
  assert.equal(paths.litSection(paths.placeOf("/w/demo/runs")), "runs");
  assert.equal(paths.litSection(paths.placeOf("/runs")), "runs");
  assert.equal(paths.litSection(paths.placeOf("/w/demo/runs/01K"), "ritual"), "rituals");
  assert.equal(paths.litSection(paths.placeOf("/w/demo/runs/01K"), "vigil"), "vigils");
  assert.equal(paths.litSection(paths.placeOf("/w/demo/runs/01K")), null);
  assert.equal(paths.litSection(paths.placeOf("/w/demo")), null);
  assert.equal(paths.litSection(paths.placeOf("/status")), null);
});

const APP = fileURLToPath(new URL("../web/app/", import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "+types" ? [] : sourceFiles(path);
    return /\.tsx?$/u.test(entry.name) ? [path] : [];
  });
}

/** The code of a file: comments are not links. */
function codeOf(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n");
}

const HAND_BUILT = [/\bto="\//u, /\bhref="\//u, /`\/w\//u, /"\/runs/u, /"\/findings/u, /"\/p\//u];
const ALLOWED = ["/favicon.svg", "/manifest.webmanifest", "/apple-touch-icon.png"];

test("no file of the app builds an internal link by hand", () => {
  const found: string[] = [];
  for (const file of sourceFiles(APP)) {
    const name = relative(APP, file);
    if (name === join("lib", "paths.ts")) continue;
    codeOf(readFileSync(file, "utf8"))
      .split("\n")
      .forEach((line, index) => {
        if (ALLOWED.some((allowed) => line.includes(`"${allowed}"`))) return;
        if (HAND_BUILT.some((pattern) => pattern.test(line))) found.push(`${name}:${index + 1}: ${line.trim()}`);
      });
  }
  assert.deepEqual(found, [], "build the link with href() from lib/paths.ts");
});
