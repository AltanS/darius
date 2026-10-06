/**
 * `.darius.toml` (src/core/marker.ts), links.toml (src/core/links.ts), the
 * TOML subset both use (src/core/toml.ts), and where a project's work runs
 * (src/core/workdir.ts).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { appendLine, hostId, readLedger } from "../src/core/ledger.ts";
import { linksFile, readLinks, writeLink } from "../src/core/links.ts";
import { definitionHash, findMarker, isAboveCap, readMarker, resolvedLines, resolvedPolicy, shellOperatorIn, type Marker, type RepoRitual } from "../src/core/marker.ts";
import { DEFAULT_KINDS } from "../src/core/kinds.ts";
import { ownedKinds, resolveProject } from "../src/core/paths.ts";
import type { Document, LedgerLine, Ritual } from "../src/core/model.ts";
import { openProject } from "../src/core/store.ts";
import { parseToml, tomlKey, tomlString } from "../src/core/toml.ts";
import { projectWorkdir, ritualHost, LINKED_LINE } from "../src/core/workdir.ts";

const SANDBOX = mkdtempSync(join(tmpdir(), "darius-marker-"));
process.env.DARIUS_STATE_DIR = join(SANDBOX, "state");
process.env.DARIUS_CONFIG_DIR = join(SANDBOX, "config");
delete process.env.DARIUS_PROJECT;

let counter = 0;

/** A fresh checkout dir holding `.darius.toml` with `text`. */
function checkout(text: string): string {
  counter += 1;
  const dir = join(SANDBOX, `repo-${String(counter)}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, ".darius.toml"), text);
  return dir;
}

// --- toml -------------------------------------------------------------------------

test("TOML keys may carry '-' and be quoted; line numbers are kept", () => {
  const doc = parseToml('[projects]\nacme-web = "/a"\n"my.project" = "/b"\n', "x.toml");
  assert.deepEqual(doc.sections.projects, { "acme-web": "/a", "my.project": "/b" });
  assert.equal(doc.lines["projects.my.project"], 3);
});

test("tomlKey quotes only what a bare key cannot hold, and tomlString round-trips", () => {
  assert.equal(tomlKey("acme-web"), "acme-web");
  assert.equal(tomlKey("my.project"), '"my.project"');
  const tricky = 'a "quoted" path\\with\ttab';
  const doc = parseToml(`k = ${tomlString(tricky)}\n`, "x.toml");
  assert.equal(doc.root.k, tricky);
});

// --- marker -----------------------------------------------------------------------

test("a marker with v, project and max_mode reads back; v is optional", () => {
  const dir = checkout('# committed\nv = 1\nproject = "ws"\nmax_mode = "report"   # ceiling\n');
  const marker = readMarker(dir);
  assert.equal(marker?.project, "ws");
  assert.equal(marker?.maxMode, "report");
  assert.equal(marker?.dir, dir);
  assert.equal(readMarker(checkout('project = "old-style"\n'))?.maxMode, undefined);
});

test("a marker is strict: unknown key, section, newer v, bad max_mode, no project all throw with file:line", () => {
  assert.throws(() => readMarker(checkout('project = "ws"\nmax-mode = "act"\n')), /\.darius\.toml:2: unknown key "max-mode"/u);
  assert.throws(() => readMarker(checkout('project = "ws"\n[runner]\nhost = "x"\n')), /\.darius\.toml:3: \[runner\] is not a \.darius\.toml section/u);
  assert.throws(() => readMarker(checkout('v = 4\nproject = "ws"\n')), /\.darius\.toml:1: v = 4 .*upgrade darius/u);
  assert.throws(() => readMarker(checkout('project = "ws"\nmax_mode = "yolo"\n')), /max_mode must be/u);
  assert.throws(() => readMarker(checkout("v = 1\n")), /project = "<name>" is required/u);
});

test("a v2 marker reads profiles and defaults; a v1 marker has none", () => {
  const marker = readMarker(
    checkout(
      [
        "v = 2",
        'project = "ws"',
        'max_mode = "report"',
        "[profiles.opus-skip]",
        'model = "opus"',
        'effort = "medium"',
        'permissions = "skip"',
        'surface = "herdr"',
        "max_turns = 40",
        'args = ["--verbose", "--add-dir=/tmp"]',
        "[profiles.cheap]",
        'model = "haiku"',
        "[defaults]",
        'ritual = "cheap"',
        'follow_up = "opus-skip"',
        "",
      ].join("\n"),
    ),
  );
  assert.deepEqual(marker?.profiles, {
    "opus-skip": { model: "opus", effort: "medium", permissions: "skip", surface: "herdr", max_turns: 40, args: ["--verbose", "--add-dir=/tmp"] },
    cheap: { model: "haiku" },
  });
  assert.equal(marker?.defaultRitual, "cheap");
  assert.equal(marker?.defaultFollowUp, "opus-skip");
  assert.deepEqual(readMarker(checkout('v = 2\nproject = "ws"\n'))?.profiles, {});
  assert.deepEqual(readMarker(checkout('project = "ws"\n'))?.profiles, {});
});

test("a v2 marker is strict too: tables need v = 2, and every profile field has a shape", () => {
  const bad = (body: string): string => checkout(`project = "ws"\n${body}`);
  assert.throws(() => readMarker(bad('[profiles.x]\nmodel = "opus"\n')), /\.darius\.toml:3: \[profiles\.x\] needs v = 2/u);
  assert.throws(() => readMarker(bad('v = 2\n[profiles.x]\nmodell = "opus"\n')), /:4: unknown key "modell"/u);
  assert.throws(() => readMarker(bad('v = 2\n[profiles.x]\npermissions = "yolo"\n')), /:4: permissions must be "gated" or "skip"/u);
  assert.throws(() => readMarker(bad('v = 2\n[profiles.x]\nmax_turns = 0\n')), /max_turns must be a positive integer/u);
  assert.throws(() => readMarker(bad('v = 2\n[profiles.x]\nargs = "--verbose"\n')), /args must be a list of strings/u);
  assert.throws(() => readMarker(bad('v = 2\n[profiles.x]\nmodel = ["opus"]\n')), /model must be a string/u);
  assert.throws(() => readMarker(bad('v = 2\n[profiles.Big]\nmodel = "opus"\n')), /a profile name is lowercase/u);
  assert.throws(() => readMarker(bad('v = 2\n[defaults]\nvigil = "x"\n')), /unknown key "vigil"/u);
  assert.throws(() => readMarker(bad('v = 2\nmax_mode = "act"\n[defaults]\nritual = 3\n')), /ritual must name a profile/u);
  assert.throws(() => readMarker(bad('v = 2\n[defaults]\nfollow_up = "Bad Name"\n')), /:4: follow_up must name a profile/u);
});

test("findMarker walks up from a subdir, and resolveProject uses it", () => {
  const dir = checkout('project = "walked"\n');
  const deep = join(dir, "a", "b");
  mkdirSync(deep, { recursive: true });
  assert.equal(findMarker(deep)?.dir, dir);
  assert.equal(resolveProject(undefined, deep), "walked");
});

test("isAboveCap: no marker or no max_mode means no ceiling; off < report < act", () => {
  const capped = readMarker(checkout('project = "ws"\nmax_mode = "report"\n'));
  assert.equal(isAboveCap("act", null), false);
  assert.equal(isAboveCap("act", readMarker(checkout('project = "ws"\n'))), false);
  assert.equal(isAboveCap("act", capped), true);
  assert.equal(isAboveCap("report", capped), false);
  assert.equal(isAboveCap("off", capped), false);
});

// --- links ------------------------------------------------------------------------

test("writeLink keeps other links, sorts, and quotes a dotted project name", () => {
  writeLink("zeta", "/z");
  writeLink("my.project", '/path with "quotes"');
  writeLink("zeta", "/z2");
  assert.deepEqual([...readLinks().entries()], [
    ["my.project", '/path with "quotes"'],
    ["zeta", "/z2"],
  ]);
  const text = readFileSync(linksFile(), "utf8");
  assert.match(text, /^\[projects\]$/mu);
  assert.match(text, /^"my\.project" = /mu);
});

test("links.toml refuses keys outside [projects]", () => {
  const saved = readFileSync(linksFile(), "utf8");
  try {
    writeFileSync(linksFile(), 'stray = "x"\n[projects]\n');
    assert.throws(() => readLinks(), /outside \[projects\]/u);
  } finally {
    writeFileSync(linksFile(), saved);
  }
});

// --- workdir ----------------------------------------------------------------------

test("workdir: a project with no repo runs in its store dir", () => {
  const project = openProject("wd-plain", { create: true });
  const where = projectWorkdir(project, readLedger(project));
  assert.deepEqual(where, { dir: project.root, from: "store", marker: null });
});

test("workdir: a link wins, and brings the checkout's marker", () => {
  const dir = checkout('project = "wd-linked"\nmax_mode = "report"\n');
  const project = openProject("wd-linked", { create: true });
  writeLink("wd-linked", dir);
  const where = projectWorkdir(project, readLedger(project));
  assert.ok("dir" in where);
  assert.equal(where.dir, dir);
  assert.equal(where.from, "link");
  assert.equal(where.marker?.maxMode, "report");
});

test("workdir: the import's repo is used when it exists here, with no marker needed", () => {
  const repo = join(SANDBOX, "imported-repo");
  mkdirSync(join(repo, ".tracker"), { recursive: true });
  const project = openProject("wd-imported", { create: true });
  appendLine(project, { who: "test", type: "import", source: join(repo, ".tracker") });
  const where = projectWorkdir(project, readLedger(project));
  assert.ok("dir" in where);
  assert.equal(where.dir, repo);
  assert.equal(where.from, "import");
});

test("workdir: a project linked or imported on another host has no workdir here", () => {
  const linked = openProject("wd-elsewhere", { create: true });
  appendLine(linked, { who: "test", type: LINKED_LINE, path: "/nonexistent-darius/ws" });
  const where = projectWorkdir(linked, readLedger(linked));
  assert.ok("missing" in where);
  assert.match(where.detail, /\/nonexistent-darius\/ws on .*not on this host: run `darius link`/u);

  const imported = openProject("wd-imported-elsewhere", { create: true });
  appendLine(imported, { who: "test", type: "import", source: "/nonexistent-darius/repo/.tracker" });
  assert.ok("missing" in projectWorkdir(imported, readLedger(imported)));
});

test("workdir: a link to a gone dir is missing; a link to another project's checkout throws", () => {
  const gone = checkout('project = "wd-gone"\n');
  const project = openProject("wd-gone", { create: true });
  writeLink("wd-gone", gone);
  rmSync(gone, { recursive: true });
  const where = projectWorkdir(project, readLedger(project));
  assert.ok("missing" in where);
  assert.match(where.detail, /is gone/u);

  const wrong = openProject("wd-wrong", { create: true });
  writeLink("wd-wrong", checkout('project = "someone-else"\n'));
  assert.throws(() => projectWorkdir(wrong, readLedger(wrong)), /names project "someone-else"/u);
});

// --- the right host (0.50.0) -------------------------------------------------------

/** A ritual document, pinned to `host` when given. Only its header's host matters here. */
function ritualDoc(host?: string): Document<Ritual> {
  const header: Ritual = {
    id: "01HZZZZZZZZZZZZZZZZZZZZZZZ",
    kind: "ritual",
    slug: "heartbeat",
    title: "Heartbeat",
    created: "2026-10-01T08:00:00Z",
    updated: "2026-10-01T08:00:00Z",
    tags: [],
    cadence: "1d",
    anchor: "due",
    policy: { mode: "report", may: [], hold: [] },
  };
  if (host !== undefined) header.host = host;
  return { header, body: "" };
}

/** A `project.linked` line from `host`, as a sync brings it. */
function linkedLine(host: string, path: string, id: string): LedgerLine {
  return { v: 1, id, at: "2026-10-01T08:00:00Z", host, who: "test", project: "rh", type: LINKED_LINE, path };
}

test("ritualHost: the pin wins over every link", () => {
  const project = openProject("rh-pinned", { create: true });
  writeLink("rh-pinned", checkout('project = "rh-pinned"\n'));
  const ledger = [linkedLine("host-c", "/srv/rh", "01HZ0000000000000000000001")];
  assert.deepEqual(ritualHost(project, ledger, ritualDoc("host-b")), { host: "host-b", why: "pinned" });
});

test("ritualHost: a checkout linked on another host names that host; the latest line wins", () => {
  const project = openProject("rh-linked", { create: true });
  const ledger = [linkedLine("host-b", "/srv/a", "01HZ0000000000000000000001"), linkedLine("host-c", "/srv/b", "01HZ0000000000000000000002")];
  assert.deepEqual(ritualHost(project, ledger, ritualDoc()), { host: "host-c", why: "linked" });
});

test("ritualHost: a checkout here, linked or imported, names this host", () => {
  const project = openProject("rh-here", { create: true });
  writeLink("rh-here", checkout('project = "rh-here"\n'));
  const elsewhere = [linkedLine("host-b", "/srv/a", "01HZ0000000000000000000001")];
  assert.deepEqual(ritualHost(project, elsewhere, ritualDoc()), { host: hostId(), why: "linked" });

  const repo = join(SANDBOX, "rh-imported-repo");
  mkdirSync(join(repo, ".tracker"), { recursive: true });
  const imported = openProject("rh-imported", { create: true });
  appendLine(imported, { who: "test", type: "import", source: join(repo, ".tracker") });
  assert.deepEqual(ritualHost(imported, [...elsewhere, ...readLedger(imported)], ritualDoc()), { host: hostId(), why: "linked" });
});

test("ritualHost: null with no pin and no checkout anywhere; this host's own old link line does not count", () => {
  const project = openProject("rh-none", { create: true });
  assert.equal(ritualHost(project, [], ritualDoc()), null);
  appendLine(project, { who: "test", type: LINKED_LINE, path: "/nonexistent-darius/rh" });
  assert.equal(ritualHost(project, readLedger(project), ritualDoc()), null);
  assert.equal(ritualHost(project, [], ritualDoc("")), null, "an empty pin is no pin");
});

// --- marker v3 --------------------------------------------------------------------

const V3_ROOT = 'v = 3\nproject = "acme-web"\nmax_mode = "act"\ntz = "Europe/Berlin"\n';
const RITUAL = '[rituals.daily]\ntitle = "Daily"\ncadence = "1d"\nskill = "daily"\n';

/** A v3 marker: the standard root lines, then `body`. */
function v3(body: string, root: string = V3_ROOT): string {
  return `${root}${body}`;
}

test("the v3 example parses: root tz, policy inlined, mode, hold and timeout resolved", () => {
  const fixture = readFileSync(join(import.meta.dirname, "fixtures", "marker-v3.toml"), "utf8");
  const marker = readMarker(checkout(fixture));
  assert.equal(marker?.version, 3);
  assert.equal(marker?.project, "acme-web");
  assert.equal(marker?.tz, "Europe/Berlin");
  assert.equal(marker?.maxMode, "act");
  assert.deepEqual(Object.keys(marker?.profiles ?? {}), ["watch"]);
  assert.equal(marker?.defaultRitual, "watch");
  assert.deepEqual(Object.keys(marker?.policies ?? {}), ["read-only"]);
  assert.deepEqual(marker?.policies["read-only"]?.hold, ["\\bdeploy\\b", "--confirm\\b"]);
  assert.deepEqual(
    marker?.rituals.map((ritual) => ritual.slug),
    ["daily-report", "weekly-audit"],
  );
  const [daily, weekly] = marker?.rituals ?? [];
  assert.deepEqual(daily, {
    slug: "daily-report",
    title: "Daily site report",
    cadence: "1d",
    anchor: "due",
    at: "07:00",
    skill: "daily-report",
    timeoutMs: 30 * 60_000,
    policyName: "read-only",
    policy: { mode: "report", may: ["Bash(cd tools)", "Bash(pnpm cli *)", "Bash(date *)"], hold: ["\\bdeploy\\b", "--confirm\\b"] },
    line: 24,
  });
  assert.equal(weekly?.tz, "UTC");
  assert.equal(weekly?.from, "2026-10-05");
  assert.equal(weekly?.model, "opus");
  assert.equal(weekly?.maxTurns, 200);
  assert.equal(weekly?.policyName, undefined);
  assert.deepEqual(weekly?.policy, { mode: "act", may: ["Bash(cd tools)", "Bash(pnpm cli *)"], hold: ["\\bdeploy\\b"], notes: "Never push. Hand in a diff." });
});

test("a v3 ritual with only the required keys gets defaults: anchor due, mode off", () => {
  const ritual = readMarker(checkout(v3(RITUAL)))?.rituals[0];
  assert.deepEqual(ritual, { slug: "daily", title: "Daily", cadence: "1d", anchor: "due", skill: "daily", policy: { mode: "off", may: [], hold: [] }, line: 5 });
});

test("a v3 ritual without cadence is on demand and keeps its other defaults", () => {
  const ritual = readMarker(checkout(v3('[rituals.manual]\ntitle = "Manual"\nskill = "manual"\n')))?.rituals[0];
  assert.deepEqual(ritual, { slug: "manual", title: "Manual", anchor: "due", skill: "manual", policy: { mode: "off", may: [], hold: [] }, line: 5 });
  assert.equal("cadence" in (ritual ?? {}), false);
});

test("a v3 ritual without cadence hashes without a cadence key", () => {
  const marker = readMarker(checkout(v3('[rituals.manual]\ntitle = "Manual"\nskill = "manual"\n')));
  const ritual = marker?.rituals[0];
  assert.ok(ritual !== undefined);
  assert.match(definitionHash(ritual), /^[0-9a-f]{64}$/u);
});

test("a v1 or v2 marker has no tz, rituals or policies", () => {
  const v2 = readMarker(checkout('v = 2\nproject = "ws"\n'));
  assert.equal(v2?.version, 2);
  assert.deepEqual([v2?.tz, v2?.rituals, v2?.policies], [undefined, [], {}]);
  assert.equal(readMarker(checkout('project = "ws"\n'))?.version, 1);
});

test("a v3 marker with no tz is an error at the v line", () => {
  assert.throws(() => readMarker(checkout('# c\nv = 3\nproject = "ws"\n')), /\.darius\.toml:2: v = 3 needs tz = "<IANA zone>"/u);
});

const V3_ERRORS: readonly (readonly [string, string, RegExp])[] = [
  ["bad root tz", v3("", 'v = 3\nproject = "ws"\ntz = "Mars/Base"\n'), /:3: tz must be an IANA time zone name/u],
  ["root tz not a string", v3("", 'v = 3\nproject = "ws"\ntz = 1\n'), /:3: tz must be an IANA time zone name/u],
  ["tz below v3", 'v = 2\nproject = "ws"\ntz = "UTC"\n', /:3: tz needs v = 3/u],
  ["rituals below v3", `v = 2\nproject = "ws"\n${RITUAL}`, /:4: \[rituals\.daily\] needs v = 3/u],
  ["policies below v3", 'v = 2\nproject = "ws"\n[policies.p]\nmode = "off"\n', /:4: \[policies\.p\] needs v = 3/u],
  ["unknown section", v3("[runner]\nx = \"y\"\n"), /:6: \[runner\] is not a \.darius\.toml section \(known: \[profiles\.<name>\], \[defaults\], \[rituals\.<slug>\], \[policies\.<name>\]\)/u],
  ["unknown ritual key", v3(`${RITUAL}dir = "x"\n`), /:9: unknown key "dir"/u],
  ["unknown policy key", v3('[policies.p]\nmode = "off"\nfoo = 1\n'), /:7: unknown key "foo"/u],
  ["uppercase slug", v3(RITUAL.replace("daily", "Daily")), /:5: \[rituals\.Daily\]: a ritual slug is/u],
  ["policy name with a bad shape", v3('[policies.Bad]\nmode = "off"\n'), /:6: \[policies\.Bad\]: a policy name is/u],
  ["missing title", v3('[rituals.a]\ncadence = "1d"\nskill = "a"\n'), /:5: \[rituals\.a\] needs title/u],
  ["empty title", v3(`${RITUAL.replace('"Daily"', '""')}`), /:6: title must be a non-empty string/u],
  ["at without cadence", v3('[rituals.a]\ntitle = "A"\nskill = "a"\nat = "07:00"\n'), /:8: at needs cadence/u],
  ["from without cadence", v3('[rituals.a]\ntitle = "A"\nskill = "a"\nfrom = "2026-10-05"\n'), /:8: from needs cadence/u],
  ["cadence without a unit", v3(RITUAL.replace('"1d"', '"7"')), /:7: cadence must be like "1d"/u],
  ["cadence zero", v3(RITUAL.replace('"1d"', '"0d"')), /:7: cadence must be above zero/u],
  ["missing skill", v3('[rituals.a]\ntitle = "A"\ncadence = "1d"\n'), /:5: \[rituals\.a\] needs skill/u],
  ["bad skill name", v3(RITUAL.replace('"daily"\n', '"Not Ok"\n')), /:8: skill must be a skill name/u],
  ["bad anchor", v3(`${RITUAL}anchor = "weekly"\n`), /:9: anchor must be "due" or "completion"/u],
  ["at without zero pad", v3(`${RITUAL}at = "7:00"\n`), /:9: at must be a time "HH:MM"/u],
  ["at 24:00", v3(`${RITUAL}at = "24:00"\n`), /:9: at must be a time "HH:MM"/u],
  ["at 12:60", v3(`${RITUAL}at = "12:60"\n`), /:9: at must be a time "HH:MM"/u],
  ["bad ritual tz", v3(`${RITUAL}tz = "Nowhere/Land"\n`), /:9: tz must be an IANA time zone name/u],
  ["from not a date", v3(`${RITUAL}from = "2026-13-01"\n`), /:9: from must be a date "YYYY-MM-DD"/u],
  ["from Feb 30", v3(`${RITUAL}from = "2026-02-30"\n`), /:9: from must be a date "YYYY-MM-DD"/u],
  ["timeout without a unit", v3(`${RITUAL}timeout = "30"\n`), /:9: timeout must be like "30m" or "2h"/u],
  ["timeout 0m", v3(`${RITUAL}timeout = "0m"\n`), /:9: timeout must be from "1m" to "12h"/u],
  ["timeout 13h", v3(`${RITUAL}timeout = "13h"\n`), /:9: timeout must be from "1m" to "12h"/u],
  ["timeout 721m", v3(`${RITUAL}timeout = "721m"\n`), /:9: timeout must be from "1m" to "12h"/u],
  ["bad profile name", v3(`${RITUAL}profile = "Not Ok"\n`), /:9: profile must be a profile name/u],
  ["max_turns zero", v3(`${RITUAL}max_turns = 0\n`), /:9: max_turns must be a positive integer/u],
  ["model not a string", v3(`${RITUAL}model = 3\n`), /:9: model must be a non-empty string/u],
  ["bad mode", v3(`${RITUAL}mode = "yolo"\n`), /:9: mode must be "off", "report" or "act"/u],
  ["bad may rule", v3(`${RITUAL}may = ["not a rule"]\n`), /:9: may must be a list of Claude Code permission rules .* got "not a rule"/u],
  ["may rule that starts with -", v3(`${RITUAL}may = ["-mcp__x__y"]\n`), /:9: may must be a list of Claude Code permission rules .* got "-mcp__x__y"/u],
  ["may tool name with a blank", v3(`${RITUAL}may = ["mcp__some server__get_thing"]\n`), /:9: may must be a list of Claude Code permission rules .* got "mcp__some server__get_thing"/u],
  ["may not a list", v3(`${RITUAL}may = "Bash"\n`), /:9: may must be a list of strings/u],
  ["hold that does not compile", v3(`${RITUAL}hold = ['(']\n`), /:9: hold must be a list of regular expressions that compile, got "\("/u],
  ["hold that needs the u flag", v3(`${RITUAL}hold = ['\\p{Nope}']\n`), /:9: hold must be a list of regular expressions that compile/u],
  ["notes not a string", v3(`${RITUAL}notes = 3\n`), /:9: notes must be a string/u],
  ["on_hold not stop or deny", v3(`${RITUAL}on_hold = "pause"\n`), /:9: on_hold must be "stop" or "deny"/u],
  ["on_hold not a string", v3(`${RITUAL}on_hold = true\n`), /:9: on_hold must be "stop" or "deny"/u],
  ["on_hold bad in a policy table", v3('[policies.p]\nmode = "off"\non_hold = "Deny"\n'), /:7: on_hold must be "stop" or "deny"/u],
  ["policy with on_hold", v3(`[policies.p]\nmode = "report"\n${RITUAL}policy = "p"\non_hold = "deny"\n`), /:12: on_hold cannot be combined with policy = "p"/u],
  ["policy with follow_up_may", v3(`[policies.p]\nmode = "report"\n${RITUAL}policy = "p"\nfollow_up_may = ["Read"]\n`), /:12: follow_up_may cannot be combined with policy = "p"; put it in \[policies\.p\]/u],
  ["follow_up_may not rules", v3(`${RITUAL}mode = "report"\nfollow_up_may = ["not a rule!"]\n`), /:10: follow_up_may must be a list of Claude Code permission rules/u],
  ["follow_up_may_extra not a list", v3(`${RITUAL}mode = "report"\nfollow_up_may_extra = "Read"\n`), /:10: follow_up_may_extra must be a list of strings/u],
  ["follow_up_may bad in a policy table", v3('[policies.p]\nmode = "off"\nfollow_up_may = "Read"\n'), /:7: follow_up_may must be a list of strings/u],
  ["follow_up not headless or attended", v3(`${RITUAL}follow_up = "tab"\n`), /:9: follow_up must be "headless" or "attended"/u],
  ["args not a string", v3(`${RITUAL}args = ["--site", "acme"]\n`), /:9: args must be a string: args = "--site acme"/u],
  ["args empty", v3(`${RITUAL}args = ""\n`), /:9: args must be not empty/u],
  ["args with a newline", v3(`${RITUAL}args = "--site acme\\n--dry"\n`), /:9: args must be one line, with no newline/u],
  ["args with a newline in a multi-line string", v3(`${RITUAL}args = """\n--site acme\n--dry"""\n`), /:9: args must be one line, with no newline/u],
  ["args over 256 characters", v3(`${RITUAL}args = "${"a".repeat(257)}"\n`), /:9: args must be at most 256 characters, got 257/u],
  ["args in a policy table", v3('[policies.p]\nmode = "off"\nargs = "x"\n'), /:7: unknown key "args"/u],
  ["policy missing", v3(`${RITUAL}policy = "nope"\n`), /:9: policy = "nope" names no \[policies\.nope\] table/u],
  ["policy with mode", v3(`[policies.p]\nmode = "report"\n${RITUAL}policy = "p"\nmode = "off"\n`), /:12: mode cannot be combined with policy = "p"/u],
  ["policy with may", v3(`[policies.p]\nmode = "report"\n${RITUAL}policy = "p"\nmay = ["Bash"]\n`), /:12: may cannot be combined with policy = "p"/u],
  ["policy with hold", v3(`[policies.p]\nmode = "report"\n${RITUAL}policy = "p"\nhold = ['x']\n`), /:12: hold cannot be combined with policy = "p"/u],
  ["policy with notes that is not a string", v3(`[policies.p]\nmode = "report"\n${RITUAL}policy = "p"\nnotes = 3\n`), /:12: notes must be a string/u],
  ["policy without mode", v3("[policies.p]\nmay = []\n"), /:5: \[policies\.p\] needs mode/u],
  ["may_extra with a bad rule", v3(`[policies.p]\nmode = "report"\n${RITUAL}policy = "p"\nmay_extra = ["not a rule"]\n`), /:12: may_extra must be a list of Claude Code permission rules .* got "not a rule"/u],
  ["may_extra not a list", v3(`${RITUAL}may_extra = "Bash"\n`), /:9: may_extra must be a list of strings/u],
  ["hold_extra that does not compile", v3(`[policies.p]\nmode = "report"\n${RITUAL}policy = "p"\nhold_extra = ['(']\n`), /:12: hold_extra must be a list of regular expressions that compile, got "\("/u],
  ["hold_extra that needs the u flag", v3(`${RITUAL}hold_extra = ['\\p{Nope}']\n`), /:9: hold_extra must be a list of regular expressions that compile/u],
  ["hold_extra not a list", v3(`${RITUAL}hold_extra = 'x'\n`), /:9: hold_extra must be a list of regular expressions/u],
  ["policy missing, with extras", v3(`${RITUAL}policy = "nope"\nmay_extra = ["Read"]\nhold_extra = ['x']\n`), /:9: policy = "nope" names no \[policies\.nope\] table/u],
  ["may_extra in a policy table", v3('[policies.p]\nmode = "off"\nmay_extra = ["Read"]\n'), /:7: unknown key "may_extra"/u],
  ["hold_extra in a policy table", v3("[policies.p]\nmode = \"off\"\nhold_extra = ['x']\n"), /:7: unknown key "hold_extra"/u],
  ["mode above max_mode", v3(`${RITUAL}mode = "act"\n`, 'v = 3\nproject = "ws"\nmax_mode = "report"\ntz = "UTC"\n'), /:9: mode "act" is above max_mode "report"/u],
  ["policy mode above max_mode", v3(`[policies.p]\nmode = "act"\n${RITUAL}policy = "p"\n`, 'v = 3\nproject = "ws"\nmax_mode = "report"\ntz = "UTC"\n'), /:11: mode "act" is above max_mode "report"/u],
  ["act with no max_mode", v3(`${RITUAL}mode = "act"\n`, 'v = 3\nproject = "ws"\ntz = "UTC"\n'), /:8: mode "act" needs max_mode = "act"/u],
];

for (const [name, text, expected] of V3_ERRORS) {
  test(`v3 error: ${name}`, () => {
    assert.throws(() => readMarker(checkout(text)), expected);
  });
}

test("v3: a multi-line may list and a report ritual under max_mode report are fine", () => {
  const marker = readMarker(
    checkout(v3(`${RITUAL}mode = "report"\nmay = [\n  "Bash(date *)", # when\n  "Read",\n]\n`, 'v = 3\nproject = "ws"\nmax_mode = "report"\ntz = "UTC"\n')),
  );
  assert.deepEqual(marker?.rituals[0]?.policy.may, ["Bash(date *)", "Read"]);
});

test("v3: a policy nobody references is allowed", () => {
  const marker = readMarker(checkout(v3('[policies.spare]\nmode = "off"\n')));
  assert.deepEqual(marker?.policies.spare, { mode: "off", may: [], hold: [] });
  assert.deepEqual(marker?.rituals, []);
});

test("definitionHash is stable across key order, comments and policy form", () => {
  const first = readMarker(checkout(v3(`${RITUAL}at = "07:00"\nmode = "report"\nhold = ['\\bx\\b']\n`)))?.rituals[0];
  const second = readMarker(
    checkout(
      v3('# another order\n[rituals.daily]\nhold = [\n  # note\n  \'\\bx\\b\',\n]\nmode = "report"\nat = "07:00" # morning\nskill = "daily"\ncadence = "1d"\ntitle = "Daily"\n'),
    ),
  )?.rituals[0];
  assert.ok(first !== undefined && second !== undefined);
  assert.notEqual(first.line, second.line);
  assert.match(definitionHash(first), /^[0-9a-f]{64}$/u);
  assert.equal(definitionHash(first), definitionHash(second));
  const changed: RepoRitual = { ...first, at: "07:05" };
  assert.notEqual(definitionHash(first), definitionHash(changed));
  const renamed: RepoRitual = { ...first, line: 99, policyName: "p" };
  assert.equal(definitionHash(first), definitionHash(renamed));
});

// --- notes next to a policy -------------------------------------------------------

const POLICY_NOTES = `[policies.p]\nmode = "report"\nnotes = "Never push."\n`;
const POLICY_BARE = `[policies.p]\nmode = "report"\n`;

test("a ritual that names a policy: policy notes only, own notes only, both joined by a blank line, or neither", () => {
  assert.equal(firstRitual(`${POLICY_NOTES}${RITUAL}policy = "p"\n`).policy.notes, "Never push.");
  assert.equal(firstRitual(`${POLICY_BARE}${RITUAL}policy = "p"\nnotes = "Hand in a diff."\n`).policy.notes, "Hand in a diff.");
  const both = firstRitual(`${POLICY_NOTES}${RITUAL}policy = "p"\nnotes = "Hand in a diff."\n`);
  assert.equal(both.policy.notes, "Never push.\n\nHand in a diff.");
  assert.equal(both.ownNotes, "Hand in a diff.");
  const neither = firstRitual(`${POLICY_BARE}${RITUAL}policy = "p"\n`);
  assert.equal(neither.policy.notes, undefined);
  assert.equal("notes" in neither.policy, false);
  assert.equal("ownNotes" in neither, false);
});

test("own notes with a policy and extras: the notes are appended, the gates are untouched, and the policy table is not changed", () => {
  const marker = readMarker(
    checkout(v3(`${POLICY_NOTES}${RITUAL}policy = "p"\nnotes = "Own."\nhold_extra = ['x']\n[rituals.other]\ntitle = "Other"\nskill = "other"\npolicy = "p"\n`)),
  );
  assert.ok(marker !== null);
  const [first, second] = marker.rituals;
  assert.equal(first?.policy.notes, "Never push.\n\nOwn.");
  assert.deepEqual(first?.policy.hold, ["x"]);
  assert.equal(second?.policy.notes, "Never push.", "another ritual on the policy keeps the policy's notes");
  assert.equal(marker.policies.p?.notes, "Never push.");
});

test("a ritual without a policy keeps its own notes as before", () => {
  assert.equal(firstRitual(`${RITUAL}notes = "Own."\n`).policy.notes, "Own.");
  assert.equal("ownNotes" in firstRitual(`${RITUAL}notes = "Own."\n`), false);
});

test("the hash changes when the own notes next to a policy change, and ignores how they are split", () => {
  const one = firstRitual(`${POLICY_NOTES}${RITUAL}policy = "p"\nnotes = "One."\n`);
  const two = firstRitual(`${POLICY_NOTES}${RITUAL}policy = "p"\nnotes = "Two."\n`);
  const none = firstRitual(`${POLICY_NOTES}${RITUAL}policy = "p"\n`);
  assert.notEqual(definitionHash(one), definitionHash(two));
  assert.notEqual(definitionHash(one), definitionHash(none));
  const inline = firstRitual(`${RITUAL}mode = "report"\nnotes = "Never push.\\n\\nOne."\n`);
  assert.equal(definitionHash(one), definitionHash(inline), "the hash covers the effective notes, not how the file writes them");
});

test("--resolved leaves notes out, with or without own notes", () => {
  const ritual = firstRitual(`${POLICY_NOTES}${RITUAL}policy = "p"\nnotes = "Own."\n`);
  assert.deepEqual(resolvedLines(resolvedPolicy(ritual)), ["mode: report"]);
});

test("may accepts an MCP tool name with a hyphen in the server name (0.66.0)", () => {
  const ritual = firstRitual(`${RITUAL}mode = "report"\nmay = ["mcp__some-server__get_thing", "Bash(date *)"]\n`);
  assert.deepEqual(ritual.policy.may, ["mcp__some-server__get_thing", "Bash(date *)"]);
});

test("shellOperatorIn finds an escaped pipe, ; and && outside a class, not an alternation or a class (0.66.0)", () => {
  assert.equal(shellOperatorIn(String.raw`curl.*\|\s*sh`), "\\|");
  assert.equal(shellOperatorIn("a;b"), ";");
  assert.equal(shellOperatorIn(String.raw`a\;b`), ";");
  assert.equal(shellOperatorIn("make && x"), "&&");
  assert.equal(shellOperatorIn(String.raw`a\&\&b`), "&&");
  for (const clean of [String.raw`(^|[;&|(]\s*)wp\s`, String.raw`\bcurl\b(?![^|;&]*\s-G\s)`, "a|b", String.raw`[]|;]x`, String.raw`[^]|;&]x`, String.raw`a\\|b`, "a&b", String.raw`\bdeploy\b`]) {
    assert.equal(shellOperatorIn(clean), undefined, clean);
  }
});

// --- on_hold (0.66.0) --------------------------------------------------------------

test("on_hold: deny on a ritual or on the policy it names; stop is the default and stored as no key", () => {
  const inline = firstRitual(`${RITUAL}mode = "report"\nhold = ['x']\non_hold = "deny"\n`);
  assert.equal(inline.policy.on_hold, "deny");
  const named = firstRitual(`[policies.p]\nmode = "report"\nhold = ['x']\non_hold = "deny"\n${RITUAL}policy = "p"\nhold_extra = ['y']\n`);
  assert.equal(named.policy.on_hold, "deny", "a ritual takes its policy's on_hold");
  assert.deepEqual(named.policy.hold, ["x", "y"]);
  const plain = firstRitual(`${RITUAL}mode = "report"\nhold = ['x']\n`);
  const stop = firstRitual(`${RITUAL}mode = "report"\nhold = ['x']\non_hold = "stop"\n`);
  assert.equal(plain.policy.on_hold, undefined);
  assert.equal(stop.policy.on_hold, undefined, "stop is the default: no key");
  assert.equal(definitionHash(plain), definitionHash(stop), "the hash of a ritual without on_hold does not change");
  assert.notEqual(definitionHash(plain), definitionHash(firstRitual(`${RITUAL}mode = "report"\nhold = ['x']\non_hold = "deny"\n`)));
});

test("--resolved shows on_hold: deny after the mode, and nothing for the default", () => {
  const deny = firstRitual(`[policies.p]\nmode = "report"\nhold = ['x']\non_hold = "deny"\n${RITUAL}policy = "p"\n`);
  assert.deepEqual(resolvedLines(resolvedPolicy(deny)), ["mode: report", "on_hold: deny", "hold: x"]);
  assert.equal(resolvedPolicy(deny).on_hold, "deny");
  const stop = firstRitual(`${RITUAL}mode = "report"\nhold = ['x']\n`);
  assert.deepEqual(resolvedLines(resolvedPolicy(stop)), ["mode: report", "hold: x"]);
  assert.equal(resolvedPolicy(stop).on_hold, "stop");
});

// --- follow_up_may and follow_up (0.69.0) -------------------------------------------

test("follow_up_may: on a ritual or on the policy it names, follow_up_may_extra adds to it; follow_up = headless is kept, attended is no key", () => {
  const inline = firstRitual(`${RITUAL}mode = "report"\nmay = ["Read"]\nfollow_up_may = ["Bash(pnpm cli blocks update *)", "Read"]\nfollow_up_may_extra = ["Bash(pnpm cli seo push *)"]\n`);
  assert.deepEqual(inline.policy.may, ["Read"], "may is untouched");
  assert.deepEqual(inline.policy.follow_up_may, ["Bash(pnpm cli blocks update *)", "Read", "Bash(pnpm cli seo push *)"]);
  const named = firstRitual(`[policies.p]\nmode = "report"\nfollow_up_may = ["Bash(a *)", "Bash(a *)"]\n${RITUAL}policy = "p"\nfollow_up_may_extra = ["Bash(b *)"]\nfollow_up = "headless"\n`);
  assert.deepEqual(named.policy.follow_up_may, ["Bash(a *)", "Bash(b *)"], "the policy's list, deduped, then the extra");
  assert.equal(named.followUp, "headless");
  const extraOnly = firstRitual(`[policies.p]\nmode = "report"\n${RITUAL}policy = "p"\nfollow_up_may_extra = ["Bash(b *)"]\n`);
  assert.deepEqual(extraOnly.policy.follow_up_may, ["Bash(b *)"]);
  const attended = firstRitual(`${RITUAL}mode = "report"\nfollow_up = "attended"\nfollow_up_may = []\n`);
  assert.equal(attended.followUp, undefined, "attended is the default: no key");
  assert.equal(attended.policy.follow_up_may, undefined, "an empty list is no key");
});

test("follow_up_may and follow_up: the hash of a ritual without them is the hash of 0.68.0", () => {
  const text = 'v = 3\nproject = "acme"\nmax_mode = "act"\ntz = "Europe/Berlin"\n[policies.p]\nmode = "act"\nmay = ["Bash(date)"]\nhold = [\'x\']\n[rituals.daily]\ntitle = "Daily"\ncadence = "1d"\nskill = "daily"\npolicy = "p"\nmay_extra = ["Read"]\n[rituals.own]\ntitle = "Own"\nskill = "own"\nmode = "report"\nmay = ["Grep"]\nhold = [\'y\']\non_hold = "deny"\n';
  // Computed by darius 0.68.0 (91e348f) for this exact text.
  const golden = ["e2266101cb605a9f4e3d22fdcc306342e134b74f17b7cf9260abeeb91c9763a7", "b4669ae2b1675a679c4137d2433c1af8ae848db81fb57fc82605d0ffd441e34c"];
  assert.deepEqual(readMarker(checkout(text))?.rituals.map((ritual) => definitionHash(ritual)), golden);
  const withDefaults = text.replace('on_hold = "deny"\n', 'on_hold = "deny"\nfollow_up = "attended"\nfollow_up_may = []\n');
  assert.deepEqual(readMarker(checkout(withDefaults))?.rituals.map((ritual) => definitionHash(ritual)), golden, "the defaults written out change nothing");
  const plain = firstRitual(`${RITUAL}mode = "report"\n`);
  assert.notEqual(definitionHash(plain), definitionHash(firstRitual(`${RITUAL}mode = "report"\nfollow_up = "headless"\n`)));
  assert.notEqual(definitionHash(plain), definitionHash(firstRitual(`${RITUAL}mode = "report"\nfollow_up_may = ["Read"]\n`)));
});

test("--resolved lists follow_up_may after hold, sorted, and nothing when there is none", () => {
  const ritual = firstRitual(`${RITUAL}mode = "report"\nhold = ['x']\nfollow_up_may = ["Bash(z *)", "Bash(a *)"]\n`);
  assert.deepEqual(resolvedLines(resolvedPolicy(ritual)), ["mode: report", "hold: x", "follow_up_may: Bash(a *)", "follow_up_may: Bash(z *)"]);
  assert.deepEqual(resolvedPolicy(firstRitual(`${RITUAL}mode = "report"\n`)).follow_up_may, []);
});

// --- may_extra and hold_extra -----------------------------------------------------

const POLICY_P = `[policies.p]\nmode = "report"\nmay = ["Read", "Bash(date *)"]\nhold = ['\\bdeploy\\b', '--confirm\\b']\n`;

function firstRitual(body: string): RepoRitual {
  const ritual = readMarker(checkout(v3(body)))?.rituals[0];
  assert.ok(ritual !== undefined);
  return ritual;
}

test("extras add to the named policy: base rules first, in place, then the extras", () => {
  const ritual = firstRitual(`${POLICY_P}${RITUAL}policy = "p"\nmay_extra = ["Grep"]\nhold_extra = ['\\bpush\\b']\n`);
  assert.deepEqual(ritual.policy, { mode: "report", may: ["Read", "Bash(date *)", "Grep"], hold: ["\\bdeploy\\b", "--confirm\\b", "\\bpush\\b"] });
  assert.equal(ritual.policyName, "p");
  assert.deepEqual(ritual.policyExtra, { may: ["Grep"], hold: ["\\bpush\\b"] });
});

test("extras never remove: empty extras keep the base; every base hold pattern stays", () => {
  const empty = firstRitual(`${POLICY_P}${RITUAL}policy = "p"\nmay_extra = []\nhold_extra = []\n`);
  assert.deepEqual(empty.policy, { mode: "report", may: ["Read", "Bash(date *)"], hold: ["\\bdeploy\\b", "--confirm\\b"] });
  const base = ["\\bdeploy\\b", "--confirm\\b"];
  const added = firstRitual(`${POLICY_P}${RITUAL}policy = "p"\nhold_extra = ['--confirm\\b', '\\bpush\\b']\n`);
  assert.deepEqual(added.policy.hold.slice(0, base.length), base, "the base hold is a prefix of the effective hold");
  assert.deepEqual(added.policy.hold, ["\\bdeploy\\b", "--confirm\\b", "\\bpush\\b"]);
});

test("extras drop duplicates and keep the first place", () => {
  const ritual = firstRitual(`${POLICY_P}${RITUAL}policy = "p"\nmay_extra = ["Grep", "Read", "Grep"]\nhold_extra = ['\\bdeploy\\b', '\\bx\\b', '\\bx\\b']\n`);
  assert.deepEqual(ritual.policy.may, ["Read", "Bash(date *)", "Grep"]);
  assert.deepEqual(ritual.policy.hold, ["\\bdeploy\\b", "--confirm\\b", "\\bx\\b"]);
});

test("extras without a policy add to the ritual's own may and hold; mode stays the ritual's", () => {
  const own = firstRitual(`${RITUAL}mode = "report"\nmay = ["Read"]\nhold = ['a']\nmay_extra = ["Grep"]\nhold_extra = ['b']\n`);
  assert.deepEqual(own.policy, { mode: "report", may: ["Read", "Grep"], hold: ["a", "b"] });
  const bare = firstRitual(`${RITUAL}may_extra = ["Grep"]\nhold_extra = ['b']\n`);
  assert.deepEqual(bare.policy, { mode: "off", may: ["Grep"], hold: ["b"] });
});

test("a ritual without extras has no policyExtra, and its policy is as before", () => {
  const ritual = firstRitual(`${POLICY_P}${RITUAL}policy = "p"\n`);
  assert.equal("policyExtra" in ritual, false);
  assert.deepEqual(ritual.policy, { mode: "report", may: ["Read", "Bash(date *)"], hold: ["\\bdeploy\\b", "--confirm\\b"] });
});

test("definitionHash hashes the effective policy: inline and factored forms in the same order hash the same", () => {
  const inline = firstRitual(`${RITUAL}mode = "report"\nmay = ["Read", "Bash(date *)", "Grep"]\nhold = ['\\bdeploy\\b', '--confirm\\b', '\\bpush\\b']\n`);
  const factored = firstRitual(`${POLICY_P}${RITUAL}policy = "p"\nmay_extra = ["Grep"]\nhold_extra = ['\\bpush\\b']\n`);
  assert.equal(definitionHash(inline), definitionHash(factored));
  const reordered = firstRitual(`${RITUAL}mode = "report"\nmay = ["Grep", "Read", "Bash(date *)"]\nhold = ['\\bdeploy\\b', '--confirm\\b', '\\bpush\\b']\n`);
  assert.notEqual(definitionHash(inline), definitionHash(reordered), "list order counts in the hash");
  assert.deepEqual(resolvedPolicy(inline), resolvedPolicy(reordered), "the resolved view does not");
});

function fixtureMarker(name: string): Marker {
  const marker = readMarker(checkout(readFileSync(join(import.meta.dirname, "fixtures", `marker-policy-${name}.toml`), "utf8")));
  assert.ok(marker !== null);
  return marker;
}

test("fixture pair: every ritual of the inline marker resolves byte for byte like its factored twin", () => {
  const inline = fixtureMarker("inline");
  const factored = fixtureMarker("factored");
  assert.deepEqual(inline.rituals.map((ritual) => ritual.slug), ["daily-report", "link-audit", "fact-check", "content-fix"]);
  assert.deepEqual(factored.rituals.map((ritual) => ritual.slug), inline.rituals.map((ritual) => ritual.slug));
  assert.equal(Object.keys(inline.policies).length, 0);
  assert.deepEqual(Object.keys(factored.policies), ["read-only", "content-write"]);
  for (const ritual of inline.rituals) {
    const twin = factored.rituals.find((one) => one.slug === ritual.slug);
    assert.ok(twin !== undefined, ritual.slug);
    const left = `${resolvedLines(resolvedPolicy(ritual)).join("\n")}\n`;
    const right = `${resolvedLines(resolvedPolicy(twin)).join("\n")}\n`;
    assert.equal(left, right, ritual.slug);
    assert.equal(ritual.policy.notes, twin.policy.notes, ritual.slug);
    // The base policy's hold is never cut short by the factored form.
    const base = factored.policies[twin.policyName ?? ""]?.hold ?? [];
    assert.ok(base.length > 0 && base.every((pattern) => twin.policy.hold.includes(pattern)), ritual.slug);
  }
  // The sorted view carries the differences: one more rule here, one more pattern there.
  const [, , factCheck, contentFix] = factored.rituals;
  assert.ok(factCheck !== undefined && contentFix !== undefined);
  const view = resolvedPolicy(contentFix);
  assert.equal(view.mode, "act");
  assert.ok(view.may.includes("Bash(pnpm cli content patch *)"));
  assert.ok(view.hold.includes("\\bpnpm\\s+cli\\s+content\\s+publish\\b"));
  assert.equal(resolvedPolicy(factCheck).may.filter((rule) => rule === "Read").length, 1, "a duplicate extra is dropped");
});

test("resolvedLines: mode, then may, then hold, each sorted, one per line", () => {
  const ritual = firstRitual(`${POLICY_P}${RITUAL}policy = "p"\nmay_extra = ["Grep"]\nhold_extra = ['\\bpush\\b']\n`);
  assert.deepEqual(resolvedLines(resolvedPolicy(ritual)), [
    "mode: report",
    "may: Bash(date *)",
    "may: Grep",
    "may: Read",
    "hold: --confirm\\b",
    "hold: \\bdeploy\\b",
    "hold: \\bpush\\b",
  ]);
});

// --- args and multi-line notes ------------------------------------------------------

test("a ritual's args reads back; 256 characters is the limit; a ritual without args has no key", () => {
  assert.equal(firstRitual(`${RITUAL}args = "--site acme"\n`).args, "--site acme");
  assert.equal(firstRitual(`${RITUAL}args = "${"a".repeat(256)}"\n`).args?.length, 256);
  assert.equal("args" in firstRitual(RITUAL), false);
});

test("args are part of the definition hash, and a profile's args list is a different key", () => {
  const plain = firstRitual(RITUAL);
  const withArgs = firstRitual(`${RITUAL}args = "--site acme"\n`);
  const other = firstRitual(`${RITUAL}args = "--site other"\n`);
  assert.notEqual(definitionHash(plain), definitionHash(withArgs));
  assert.notEqual(definitionHash(withArgs), definitionHash(other));
  const reordered = firstRitual('[rituals.daily]\nargs = "--site acme"\nskill = "daily"\ncadence = "1d"\ntitle = "Daily"\n');
  assert.equal(definitionHash(withArgs), definitionHash(reordered), "key order does not matter");
  const profile = readMarker(checkout(`v = 2\nproject = "ws"\n[profiles.p]\nargs = ["--flag"]\n`));
  assert.deepEqual(profile?.profiles.p?.args, ["--flag"]);
});

test("notes in the multi-line form read back as the same value and give the same definition hash", () => {
  const single = firstRitual(`${RITUAL}notes = "Never push.\\nHand in a diff.\\n"\n`);
  const multi = firstRitual(`${RITUAL}notes = """\nNever push.\nHand in a diff.\n"""\n`);
  const wrapped = firstRitual(`${RITUAL}notes = """Never push.\nHand in a diff.\n"""\n`);
  assert.equal(multi.policy.notes, "Never push.\nHand in a diff.\n");
  assert.equal(definitionHash(single), definitionHash(multi));
  assert.equal(definitionHash(multi), definitionHash(wrapped));
  const folded = firstRitual(`${RITUAL}notes = """\nOne long note \\\n    over two lines."""\n`);
  const flat = firstRitual(`${RITUAL}notes = "One long note over two lines."\n`);
  assert.equal(definitionHash(folded), definitionHash(flat));
  assert.equal(multi.line, single.line);
});

test("a multi-line notes value keeps the line of the keys after it", () => {
  const text = v3(`${RITUAL}notes = """\none\ntwo\n"""\nat = "07:00"\nmode = "plain"\n`);
  assert.throws(() => readMarker(checkout(text)), /:14: mode must be "off", "report" or "act"/u);
});

// --- kinds ------------------------------------------------------------------------

const V3 = 'v = 3\nproject = "ws"\ntz = "Europe/Berlin"\n';

test("kinds: the three valid lists read back, and an absent key is [ritual]", () => {
  assert.deepEqual(readMarker(checkout(V3))?.kinds, ["ritual"]);
  for (const list of [["ritual"], ["ritual", "vigil"], ["ritual", "vigil", "milestone"]]) {
    const text = `${V3}kinds = [${list.map((kind) => `"${kind}"`).join(", ")}]\n`;
    assert.deepEqual(readMarker(checkout(text))?.kinds, list);
  }
  assert.deepEqual(readMarker(checkout('project = "ws"\n'))?.kinds, ["ritual"]);
});

test("kinds: every other form is a marker error that lists the three valid forms", () => {
  const forms = /kinds must be one of \["ritual"\], \["ritual", "vigil"\], \["ritual", "vigil", "milestone"\], in this order/u;
  for (const bad of [
    '["tracker"]',
    '["ritual", "ritual"]',
    '["vigil", "ritual"]',
    '["ritual", "milestone"]',
    '["vigil"]',
    '["milestone"]',
    '["ritual", "vigil", "milestone", "ritual"]',
    "[]",
    '"ritual"',
  ]) {
    assert.throws(() => readMarker(checkout(`${V3}kinds = ${bad}\n`)), forms, bad);
  }
  assert.throws(() => readMarker(checkout(`${V3}kinds = [1]\n`)), /\.darius\.toml:4: /u);
  assert.throws(() => readMarker(checkout(`${V3}kinds = ["tracker"]\n`)), /\.darius\.toml:4: kinds must be one of/u);
});

test("kinds needs v = 3, as tz does", () => {
  assert.throws(() => readMarker(checkout('v = 2\nproject = "ws"\nkinds = ["ritual", "vigil"]\n')), /\.darius\.toml:3: kinds needs v = 3 at the top of \.darius\.toml/u);
  assert.throws(() => readMarker(checkout('project = "ws"\nkinds = ["ritual"]\n')), /\.darius\.toml:2: kinds needs v = 3/u);
});

// --- ownedKinds -------------------------------------------------------------------

test("ownedKinds: the marker above cwd, else the default", () => {
  const dir = checkout(`${V3}kinds = ["ritual", "vigil"]\n`);
  const deep = join(dir, "a", "b");
  mkdirSync(deep, { recursive: true });
  const found = ownedKinds(["vigil", "list"], deep);
  assert.ok(found.ok);
  assert.deepEqual([...found.kinds], ["ritual", "vigil"]);
  assert.equal(found.marker?.project, "ws");

  const bare = join(SANDBOX, "no-marker");
  mkdirSync(bare, { recursive: true });
  const none = ownedKinds(["vigil", "list"], bare);
  assert.deepEqual(none, { ok: true, kinds: DEFAULT_KINDS, marker: null });
});

test("ownedKinds: --project P and --project=P read the linked checkout, not cwd", () => {
  const linked = checkout(`${V3}kinds = ["ritual", "vigil", "milestone"]\n`);
  writeLink("owned-linked", linked);
  const elsewhere = checkout('project = "other"\n');
  for (const argv of [["vigil", "list", "--project", "owned-linked"], ["vigil", "list", "--project=owned-linked"]]) {
    const found = ownedKinds(argv, elsewhere);
    assert.ok(found.ok, argv.join(" "));
    assert.deepEqual([...found.kinds], ["ritual", "vigil", "milestone"]);
  }
  // A name with no link, and a link to a directory with no marker, give the default.
  assert.deepEqual(ownedKinds(["vigil", "list", "--project", "never-linked"], linked), { ok: true, kinds: DEFAULT_KINDS, marker: null });
  const empty = join(SANDBOX, "linked-empty");
  mkdirSync(empty, { recursive: true });
  writeLink("owned-empty", empty);
  assert.deepEqual(ownedKinds(["vigil", "list", "--project=owned-empty"], linked), { ok: true, kinds: DEFAULT_KINDS, marker: null });
});

test("ownedKinds: DARIUS_PROJECT names the project when there is no flag; the flag wins", () => {
  const vigils = checkout(`${V3}kinds = ["ritual", "vigil"]\n`);
  const plain = checkout(V3);
  writeLink("owned-env", vigils);
  writeLink("owned-plain", plain);
  process.env.DARIUS_PROJECT = "owned-env";
  try {
    const fromEnv = ownedKinds(["vigil", "list"], plain);
    assert.ok(fromEnv.ok);
    assert.deepEqual([...fromEnv.kinds], ["ritual", "vigil"]);
    const flagged = ownedKinds(["vigil", "list", "--project", "owned-plain"], vigils);
    assert.ok(flagged.ok);
    assert.deepEqual([...flagged.kinds], ["ritual"]);
  } finally {
    delete process.env.DARIUS_PROJECT;
  }
});

test("ownedKinds: a marker that does not parse gives the parser's message and never throws", () => {
  const broken = checkout(`${V3}kinds = ["vigil"]\n`);
  const here = ownedKinds(["vigil", "list"], broken);
  assert.ok(!here.ok);
  assert.match(here.error, /\.darius\.toml:4: kinds must be one of/u);
  writeLink("owned-broken", broken);
  const named = ownedKinds(["vigil", "list", "--project", "owned-broken"], SANDBOX);
  assert.ok(!named.ok);
  assert.match(named.error, /kinds must be one of/u);
});

// --- icon (0.70.0) ----------------------------------------------------------------

function iconOf(value: string): Marker["icon"] {
  return readMarker(checkout(`${V3}icon = ${value}\n`))?.icon;
}

test("icon: one emoji reads back as an emoji, a ZWJ sequence, a flag and a keycap included", () => {
  for (const emoji of ["🎯", "👩‍👩‍👧", "🇩🇪", "1️⃣", "🏴󠁧󠁢󠁥󠁮󠁧󠁿", "❤️", "🧑🏽‍🚀"]) {
    assert.deepEqual(iconOf(tomlString(emoji)), { kind: "emoji", text: emoji }, emoji);
  }
  assert.equal(readMarker(checkout(V3))?.icon, undefined, "no key, no icon");
});

test("icon: a relative path to a .svg, .png or .webp file reads back as an image, any case of the extension", () => {
  for (const path of ["assets/logo.svg", "logo.PNG", "a/b-c/d_e.webp", "docs/icon.Svg", ".github/logo.png"]) {
    assert.deepEqual(iconOf(tomlString(path)), { kind: "image", path }, path);
  }
});

test("icon: every other value is a marker error at its line that says what is valid", () => {
  const rule = /\.darius\.toml:4: icon must be one emoji or a relative path to a \.svg, \.png, \.webp file in the repo, for example icon = "🎯" or icon = "assets\/logo\.svg"/u;
  const cases: [string, RegExp][] = [
    ['""', /it is empty$/u],
    ['"🎯🎯"', /more than one emoji, or a word$/u],
    ['"rocket"', /more than one emoji, or a word$/u],
    ['"a"', /one character but not an emoji$/u],
    ['"1"', /one character but not an emoji$/u],
    ['"<img src=x onerror=alert(1)>"', /more than one emoji, or a word$/u],
    ['"/srv/logo.svg"', /must be relative to the repo root/u],
    ['"~/logo.svg"', /must be relative to the repo root/u],
    ['"../logo.svg"', /may not hold a \.\. part$/u],
    ['"assets/../../logo.svg"', /may not hold a \.\. part$/u],
    ['"assets//logo.svg"', /empty or \. part$/u],
    ['"./logo.svg"', /empty or \. part$/u],
    ["'assets\\logo.svg'", /may not hold a backslash$/u],
    ['"logo.gif"', /must end in \.svg, \.png, \.webp$/u],
    ['"logo.svg.txt"', /must end in \.svg, \.png, \.webp$/u],
    ['"a\\u0000.svg"', /control character$/u],
    ['"a\\nb.svg"', /control character$/u],
    [tomlString(`${"a/".repeat(99)}x.svg`), /at most 200 characters$/u],
    [tomlString(`🎯${"️".repeat(15)}`), /one character but not an emoji$/u],
    ["1", /repo, for example icon = "🎯" or icon = "assets\/logo\.svg"$/u],
    ['["🎯"]', /repo, for example/u],
  ];
  for (const [value, reason] of cases) {
    assert.throws(() => iconOf(value), rule, value);
    assert.throws(() => iconOf(value), reason, value);
  }
});

test("icon needs v = 3, as tz and kinds do", () => {
  assert.throws(() => readMarker(checkout('v = 2\nproject = "ws"\nicon = "🎯"\n')), /\.darius\.toml:3: icon needs v = 3 at the top of \.darius\.toml/u);
  assert.throws(() => readMarker(checkout('project = "ws"\nicon = "assets/logo.svg"\n')), /\.darius\.toml:2: icon needs v = 3/u);
});

test("icon is a root key: the same key in a ritual table is still unknown", () => {
  const text = `${V3}\n[rituals.r]\ntitle = "R"\nskill = "r"\nicon = "🎯"\n`;
  assert.throws(() => readMarker(checkout(text)), /unknown key "icon"/u);
});

test("icon does not change a ritual's definition hash", () => {
  const ritual = `\n[rituals.r]\ntitle = "R"\nskill = "r"\n`;
  const plain = readMarker(checkout(`${V3}${ritual}`))?.rituals[0];
  const withIcon = readMarker(checkout(`${V3}icon = "🎯"\n${ritual}`))?.rituals[0];
  assert.ok(plain !== undefined && withIcon !== undefined);
  assert.equal(definitionHash(withIcon), definitionHash(plain));
});
