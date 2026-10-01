/**
 * `darius ritual export` (src/cli/ritual-export.ts; docs/architecture/marker-v3.md,
 * section 6): a v3 marker from store rituals.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseArgs } from "../src/cli/args.ts";
import type { Command, ParsedArgs } from "../src/cli/registry.ts";
import { ritualCommand } from "../src/cli/ritual.ts";
import { appendLine } from "../src/core/ledger.ts";
import { readMarker } from "../src/core/marker.ts";
import type { Ritual } from "../src/core/model.ts";
import { writeLink } from "../src/core/links.ts";
import { mirrorHash, reconcileProject } from "../src/core/reconcile.ts";
import { itemRef, openProject, type Project } from "../src/core/store.ts";
import { commitAll, dirty, initRepo, NO_GIT } from "./helpers/git.ts";

const SANDBOX = mkdtempSync(join(tmpdir(), "darius-export-"));
process.env.DARIUS_STATE_DIR = join(SANDBOX, "state");
process.env.DARIUS_CONFIG_DIR = join(SANDBOX, "config");
delete process.env.DARIUS_PROJECT;

const V2 = `# darius: this repo's project.
v = 2
project = "NAME"
max_mode = "act"

[profiles.watch]
surface = "herdr"
permissions = "skip"

[defaults]
ritual = "watch"
`;

let counter = 0;

interface Setup {
  project: Project;
  dir: string;
}

function ritualHeader(slug: string, extra: Partial<Ritual> = {}): Ritual {
  const now = "2026-10-01T06:00:00.000Z";
  return {
    id: `01J00000000000000000000${slug.length.toString().padStart(3, "0")}`.slice(0, 26),
    kind: "ritual",
    slug,
    title: `Title of ${slug}`,
    created: now,
    updated: now,
    tags: [],
    cadence: "1d",
    anchor: "due",
    policy: { mode: "off", may: [], hold: [] },
    ...extra,
  };
}

function setup(opts: { git?: boolean; marker?: string | null } = {}): Setup {
  counter += 1;
  const name = `acme-web-${String(counter)}`;
  const dir = join(SANDBOX, `repo-${String(counter)}`);
  mkdirSync(dir, { recursive: true });
  const marker = opts.marker === undefined ? V2 : opts.marker;
  if (marker !== null) writeFileSync(join(dir, ".darius.toml"), marker.replaceAll("NAME", name));
  writeFileSync(join(dir, "README.md"), "# acme-web\n");
  if (opts.git === true) {
    initRepo(dir);
    commitAll(dir, "init");
  }
  const project = openProject(name, { create: true });
  writeLink(name, dir);
  const who = { who: "test" };
  project.writeItem(
    {
      header: ritualHeader("daily-report", {
        policy: { mode: "report", may: ["Bash(date *)", "Bash(pnpm cli *)"], hold: ["\\bdeploy\\b", "--confirm\\b"], notes: "Never push.", model: "opus", max_turns: 50 },
      }),
      body: "Write the report.\n",
    },
    who,
  );
  project.writeItem({ header: ritualHeader("weekly-audit", { skill: "audit", anchor: "completion", cadence: "1w" }), body: "ignored\n" }, who);
  project.writeItem({ header: ritualHeader("old-one"), body: "x\n" }, who);
  appendLine(project, { who: "test", type: "ritual.lifecycle", item: itemRef("ritual", "old-one"), state: "retired" });
  return { project, dir };
}

async function run(project: string, argv: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const args: ParsedArgs = parseArgs(["export", ...argv, "--project", project]);
  const out: string[] = [];
  const err: string[] = [];
  const log = console.log;
  const error = console.error;
  const write = process.stdout.write.bind(process.stdout);
  console.log = (...parts: unknown[]) => void out.push(`${parts.join(" ")}\n`);
  console.error = (...parts: unknown[]) => void err.push(`${parts.join(" ")}\n`);
  process.stdout.write = (chunk: string | Uint8Array): boolean => {
    out.push(String(chunk));
    return true;
  };
  try {
    const command: Command = ritualCommand;
    const code = await command.run(args);
    return { code, stdout: out.join(""), stderr: err.join("") };
  } catch (cause) {
    const name = cause instanceof Error ? cause.name : "";
    return { code: name === "UsageError" ? 2 : 1, stdout: out.join(""), stderr: cause instanceof Error ? cause.message : String(cause) };
  } finally {
    console.log = log;
    console.error = error;
    process.stdout.write = write;
  }
}

test("stdout form parses as v3 and reconciles to the same def_hash", async () => {
  const { project, dir } = setup();
  const result = await run(project.name, []);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /^# darius: this repo's project\.\nv = 3\nproject = "acme-web-\d+"\nmax_mode = "act"\ntz = "[^"]+"\n/u);
  assert.match(result.stdout, /\[profiles\.watch\]\nsurface = "herdr"/u);
  assert.doesNotMatch(result.stdout, /old-one|host/u);
  const target = join(SANDBOX, `check-${String(counter)}`);
  mkdirSync(target);
  writeFileSync(join(target, ".darius.toml"), result.stdout);
  assert.equal(readMarker(target)?.version, 3);
  const freshName = `acme-web-fresh-${String(counter)}`;
  writeFileSync(join(target, ".darius.toml"), result.stdout.replace(`project = "${project.name}"`, `project = "${freshName}"`));
  const marker = readMarker(target);
  assert.ok(marker !== null);
  assert.deepEqual(marker.rituals.map((ritual) => ritual.slug), ["daily-report", "weekly-audit"]);
  const [daily, weekly] = marker.rituals;
  assert.ok(daily !== undefined && weekly !== undefined);
  assert.equal(daily.skill, "daily-report");
  assert.equal(weekly.skill, "audit");
  assert.equal(weekly.anchor, "completion");
  assert.deepEqual(daily.policy.hold, ["\\bdeploy\\b", "--confirm\\b"]);
  assert.deepEqual(daily.policy.may, ["Bash(date *)", "Bash(pnpm cli *)"]);
  assert.equal(daily.maxTurns, 50);
  assert.equal(daily.model, "opus");
  const fresh = openProject(freshName, { create: true });
  const first = reconcileProject(fresh, target, "host-a", new Date("2026-10-01T06:00:00.000Z"));
  assert.deepEqual(first.adopted.toSorted(), ["daily-report", "weekly-audit"]);
  for (const ritual of marker.rituals) {
    assert.equal(fresh.readItem<Ritual>("ritual", ritual.slug)?.header.def_hash, mirrorHash(marker, ritual));
  }
  const again = reconcileProject(fresh, target, "host-a", new Date("2026-10-01T06:15:00.000Z"));
  assert.deepEqual(again.unchanged.toSorted(), ["daily-report", "weekly-audit"]);
  assert.equal(existsSync(join(dir, ".claude")), false, "stdout form writes nothing");
});

test("a store ritual without cadence exports without a cadence line and round-trips to the same mirrorHash", async () => {
  const { project } = setup();
  const header = ritualHeader("on-demand", { skill: "manual" });
  delete header.cadence;
  project.writeItem({ header, body: "ignored\n" }, { who: "test" });
  const result = await run(project.name, []);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /\[rituals\.on-demand\]\ntitle = "Title of on-demand"\nskill = "manual"\n/u);
  const target = join(SANDBOX, `check-nocadence-${String(counter)}`);
  mkdirSync(target);
  const freshName = `acme-web-nocad-${String(counter)}`;
  writeFileSync(join(target, ".darius.toml"), result.stdout.replace(`project = "${project.name}"`, `project = "${freshName}"`));
  const marker = readMarker(target);
  const ritual = marker?.rituals.find((item) => item.slug === "on-demand");
  assert.ok(marker !== null && ritual !== undefined);
  assert.equal(ritual.cadence, undefined);
  const fresh = openProject(freshName, { create: true });
  reconcileProject(fresh, target, "host-a", new Date("2026-10-01T06:00:00.000Z"));
  const mirrored = fresh.readItem<Ritual>("ritual", "on-demand")?.header;
  assert.equal(mirrored?.cadence, undefined);
  assert.equal(mirrored?.def_hash, mirrorHash(marker, ritual));
});

test("a project with no marker gets the two required root lines", async () => {
  const { project } = setup({ marker: null });
  const result = await run(project.name, []);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /^v = 3\nproject = "acme-web-\d+"\nmax_mode = "report"\ntz = "[^"]+"\n\n\[rituals\.daily-report\]/u);
});

test("--write writes the marker and the skill file, and never commits", { skip: NO_GIT }, async () => {
  const { project, dir } = setup({ git: true });
  const result = await run(project.name, ["--write"]);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /commit, push, pull on the running host/u);
  const skill = readFileSync(join(dir, ".claude/skills/daily-report/SKILL.md"), "utf8");
  assert.equal(skill, "---\nname: daily-report\ndescription: Title of daily-report\n---\nWrite the report.\n");
  assert.equal(existsSync(join(dir, ".claude/skills/weekly-audit")), false, "a ritual with a skill gets no file");
  assert.equal(readMarker(dir)?.version, 3);
  assert.equal(existsSync(join(dir, ".darius.toml.tmp")), false);
  const second = await run(project.name, ["--write"]);
  assert.equal(second.code, 2);
  assert.match(second.stderr, /already v = 3/u);
});

test("--write refuses a dirty marker, an existing skill file and a dirty skill file", { skip: NO_GIT }, async () => {
  const a = setup({ git: true });
  dirty(a.dir, ".darius.toml");
  const dirtyMarker = await run(a.project.name, ["--write"]);
  assert.equal(dirtyMarker.code, 2);
  assert.match(dirtyMarker.stderr, /uncommitted changes/u);
  assert.equal(readFileSync(join(a.dir, ".darius.toml"), "utf8").includes("v = 2"), true);

  const b = setup({ git: true });
  const target = join(b.dir, ".claude/skills/daily-report");
  mkdirSync(target, { recursive: true });
  writeFileSync(join(target, "SKILL.md"), "mine\n");
  const exists = await run(b.project.name, ["--write"]);
  assert.equal(exists.code, 2);
  assert.match(exists.stderr, /exists/u);
  assert.equal(readFileSync(join(target, "SKILL.md"), "utf8"), "mine\n");
  assert.equal(readFileSync(join(b.dir, ".darius.toml"), "utf8").includes("v = 2"), true);
});

test("--write refuses when the marker is already v3", async () => {
  const v3 = 'v = 3\nproject = "NAME"\ntz = "UTC"\n';
  const { project } = setup({ marker: v3 });
  const result = await run(project.name, ["--write"]);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /already v = 3/u);
});

test("slugs with a dot exit 2 and are listed", async () => {
  const { project } = setup();
  project.writeItem({ header: ritualHeader("acme.nightly"), body: "x\n" }, { who: "test" });
  const result = await run(project.name, []);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /acme\.nightly: not a v3 slug/u);
  assert.equal(result.stdout, "");
  const written = await run(project.name, ["--write"]);
  assert.equal(written.code, 2);
});

test("max_mode: added when a ritual is above off, never when all are off, kept when present", async () => {
  const none = setup({ marker: null });
  const noCap = await run(none.project.name, []);
  assert.match(noCap.stdout, /^v = 3\nproject = "acme-web-\d+"\nmax_mode = "report"\ntz = /u);
  const target = join(SANDBOX, `cap-${String(counter)}`);
  mkdirSync(target);
  writeFileSync(join(target, ".darius.toml"), noCap.stdout);
  assert.equal(readMarker(target)?.maxMode, "report");

  const copied = setup({ marker: 'v = 2\nproject = "NAME"\n\n[defaults]\nritual = "x"\n' });
  copied.project.writeItem({ header: ritualHeader("act-one", { policy: { mode: "act", may: [], hold: [] } }), body: "x\n" }, { who: "test" });
  const out = await run(copied.project.name, []);
  assert.match(out.stdout, /^v = 3\nproject = "acme-web-\d+"\nmax_mode = "act"\ntz = "[^"]+"\n\n\[defaults\]/u);

  const kept = await run(setup().project.name, []);
  assert.equal(kept.stdout.match(/max_mode/gu)?.length, 1);
});

test("a ritual with a skill and a body warns on stderr and in --json", async () => {
  const { project } = setup();
  const text = await run(project.name, []);
  assert.match(text.stderr, /^! weekly-audit: the store body is not exported; the skill audit is the procedure$/mu);
  const json = await run(project.name, ["--json"]);
  const parsed: { warnings: string[] } = JSON.parse(json.stdout);
  assert.deepEqual(parsed.warnings, ["weekly-audit: the store body is not exported; the skill audit is the procedure"]);
});
