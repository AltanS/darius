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
import { definitionHash, findMarker, isAboveCap, readMarker, type RepoRitual } from "../src/core/marker.ts";
import { resolveProject } from "../src/core/paths.ts";
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
  ["missing cadence", v3('[rituals.a]\ntitle = "A"\nskill = "a"\n'), /:5: \[rituals\.a\] needs cadence/u],
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
  ["may not a list", v3(`${RITUAL}may = "Bash"\n`), /:9: may must be a list of strings/u],
  ["hold that does not compile", v3(`${RITUAL}hold = ['(']\n`), /:9: hold must be a list of regular expressions that compile, got "\("/u],
  ["hold that needs the u flag", v3(`${RITUAL}hold = ['\\p{Nope}']\n`), /:9: hold must be a list of regular expressions that compile/u],
  ["notes not a string", v3(`${RITUAL}notes = 3\n`), /:9: notes must be a string/u],
  ["policy missing", v3(`${RITUAL}policy = "nope"\n`), /:9: policy = "nope" names no \[policies\.nope\] table/u],
  ["policy with mode", v3(`[policies.p]\nmode = "report"\n${RITUAL}policy = "p"\nmode = "off"\n`), /:12: mode cannot be combined with policy = "p"/u],
  ["policy with may", v3(`[policies.p]\nmode = "report"\n${RITUAL}policy = "p"\nmay = ["Bash"]\n`), /:12: may cannot be combined with policy = "p"/u],
  ["policy with hold", v3(`[policies.p]\nmode = "report"\n${RITUAL}policy = "p"\nhold = ['x']\n`), /:12: hold cannot be combined with policy = "p"/u],
  ["policy with notes", v3(`[policies.p]\nmode = "report"\n${RITUAL}policy = "p"\nnotes = "x"\n`), /:12: notes cannot be combined with policy = "p"/u],
  ["policy without mode", v3("[policies.p]\nmay = []\n"), /:5: \[policies\.p\] needs mode/u],
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
