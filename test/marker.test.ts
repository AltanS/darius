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
import { findMarker, isAboveCap, readMarker } from "../src/core/marker.ts";
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
  assert.throws(() => readMarker(checkout('v = 3\nproject = "ws"\n')), /\.darius\.toml:1: v = 3 .*upgrade darius/u);
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
