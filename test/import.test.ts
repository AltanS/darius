/**
 * `src/core/import.ts` and `src/cli/import.ts` against the synthetic legacy
 * tracker in test/fixtures/tracker-mini: the mapping table of
 * docs/plan-tonight.md "Import (read-only)", idempotency, the due state the
 * imported facts produce, and that the source is never written.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { importCommand } from "../src/cli/import.ts";
import { ritualState } from "../src/core/due.ts";
import { importTracker } from "../src/core/import.ts";
import { readLedger } from "../src/core/ledger.ts";
import { UsageError } from "../src/core/model.ts";
import type { JsonValue, LedgerLine, Ritual } from "../src/core/model.ts";
import { getBlobText, openProject } from "../src/core/store.ts";

const FIXTURE = join(import.meta.dirname, "fixtures", "tracker-mini");
const TODAY = "2026-09-28";

// Paths are read from the environment on every call, so setting them here,
// after the imports, still keeps every write inside this throwaway dir.
const sandbox = mkdtempSync(join(tmpdir(), "darius-import-test-"));
process.env.DARIUS_STATE_DIR = join(sandbox, "state");
process.env.DARIUS_CONFIG_DIR = join(sandbox, "config");

let projectCounter = 0;
function freshProject(): string {
  projectCounter += 1;
  return `import-test-${projectCounter}`;
}

/** Every file under `dir` with its content and mtime, to prove a run left the source untouched. */
function snapshot(dir: string): Map<string, string> {
  const files = new Map<string, string>();
  for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    files.set(path, `${statSync(path).mtimeMs} ${readFileSync(path, "utf8")}`);
  }
  return files;
}

function isText(value: JsonValue | undefined): value is string {
  return typeof value === "string";
}

function isRecord(value: JsonValue | undefined): value is { readonly [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function linesOfType(lines: LedgerLine[], type: string): LedgerLine[] {
  return lines.filter((line) => line.type === type);
}

function localDate(at: string): string {
  const date = new Date(at);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

test("imports rituals, runs, reschedules, lifecycle and evidence per the mapping table", () => {
  const name = freshProject();
  const report = importTracker({ source: FIXTURE, project: name, dryRun: false });

  assert.deepEqual(report.rituals, { found: 4, new: 4, updated: 0, unchanged: 0 });
  assert.deepEqual(report.runs, { found: 8, new: 8 });
  assert.deepEqual(report.rescheduled, { found: 1, new: 1 });
  assert.deepEqual(report.lifecycle, { found: 1, new: 1 });
  assert.deepEqual(report.evidence, { found: 3, new: 3 });
  assert.equal(report.totalNew, 4 + 8 * 2 + 1 + 1 + 3);
  assert.equal(report.problems.length, 5, report.problems.join("\n"));
  for (const needle of ["broken-dir", "_ledger.md:7", "notes.txt", ".verification-log.jsonl:4", ".verification-log.jsonl:5"]) {
    assert.ok(report.problems.some((problem) => problem.includes(needle)), `a problem names ${needle}`);
  }
});

test("an imported ritual item is policy off, anchor due, with imported_from and the source fields", () => {
  const project = openProject(freshProject(), { create: true });
  importTracker({ source: FIXTURE, project: project.name, dryRun: false });
  const doc = project.readItem<Ritual>("ritual", "weekly-check");
  assert.ok(doc !== null);
  const { header } = doc;
  assert.equal(header.title, "Weekly check");
  assert.equal(header.cadence, "7d");
  assert.equal(header.anchor, "due");
  assert.equal(header.agent, "djinn");
  assert.equal(header.owner, "ops@example.com");
  assert.equal(header.created, "2026-08-25");
  assert.equal(header.imported_from, "tracker-mini/rituals/weekly-check/ritual.md");
  assert.deepEqual(header.policy, { mode: "off", may: [], hold: [] });

  const onDemand = project.readItem<Ritual>("ritual", "on-demand");
  assert.equal(onDemand?.header.title, "On demand: a rare check");
  assert.equal(onDemand?.header.cadence, undefined);
  assert.equal(onDemand?.header.agent, undefined);
});

test("the body is kept byte for byte except the Findings section, which becomes a blob", () => {
  const project = openProject(freshProject(), { create: true });
  importTracker({ source: FIXTURE, project: project.name, dryRun: false });
  const source = readFileSync(join(FIXTURE, "rituals", "weekly-check", "ritual.md"), "utf8");
  const sourceBody = source.slice(source.indexOf("\n---\n") + "\n---\n".length);
  const cut = sourceBody.indexOf("## Findings");
  const doc = project.readItem<Ritual>("ritual", "weekly-check");
  assert.equal(doc?.body, sourceBody.slice(0, cut));

  const importLine = linesOfType(readLedger(project), "import")[0];
  const findings = importLine?.findings;
  assert.ok(isRecord(findings));
  const sha = findings["weekly-check"];
  assert.ok(isText(sha));
  assert.equal(getBlobText(project, sha), sourceBody.slice(cut));
});

test("run lines sit at local noon of the source date, completed after started, with the run file as blob", () => {
  const project = openProject(freshProject(), { create: true });
  importTracker({ source: FIXTURE, project: project.name, dryRun: false });
  const ledger = readLedger(project).filter((line) => line.item === "ritual/weekly-check");
  const completed = linesOfType(ledger, "run.completed");
  assert.deepEqual(completed.map((line) => localDate(line.at)), ["2026-08-25", "2026-08-25", "2026-09-01", "2026-09-08", "2026-09-08"]);
  for (const line of completed) {
    assert.equal(line.who, "import");
    assert.equal(line.outcome, "complete");
    const started = ledger.find((other) => other.type === "run.started" && other.run === line.run);
    assert.ok(started !== undefined && started.id < line.id, "run.started sorts before its run.completed");
    assert.equal(new Date(started.at).getHours(), 12);
  }
  const fileRun = completed.find((line) => line.imported_from === "tracker-mini/rituals/weekly-check/runs/2026-09-01.md");
  assert.ok(fileRun !== undefined && isText(fileRun.findings_sha));
  assert.equal(getBlobText(project, fileRun.findings_sha), readFileSync(join(FIXTURE, "rituals", "weekly-check", "runs", "2026-09-01.md"), "utf8"));

  const synthetic = linesOfType(readLedger(project), "run.completed").find((line) => line.item === "ritual/moved-due");
  assert.equal(synthetic?.imported_from, "tracker-mini/rituals/moved-due/ritual.md#last_run=2026-09-10");
  assert.equal(synthetic?.findings_sha, null);
});

test("evidence lines keep the source time and name the check <spec>#<index>", () => {
  const project = openProject(freshProject(), { create: true });
  importTracker({ source: FIXTURE, project: project.name, dryRun: false });
  const evidence = linesOfType(readLedger(project), "evidence");
  assert.deepEqual(
    evidence.map((line) => [line.check, line.at, line.outcome, line.exit]),
    [
      [".tracker/M1-probe/01-p.md#0", "2026-08-03T21:15:11.488Z", "pass", 0],
      [".tracker/M1-probe/01-p.md#1", "2026-08-04T09:00:00.000Z", "manual", null],
      [".tracker/M2-other/02-q.md#3", "2026-09-01T10:30:00.000Z", "fail", 1],
    ],
  );
  assert.equal(evidence[1]?.note, "checked by hand on the live page");
  assert.ok(evidence.every((line) => line.who === "import"));
});

test("the imported facts give the due state the legacy tracker had", () => {
  const project = openProject(freshProject(), { create: true });
  importTracker({ source: FIXTURE, project: project.name, dryRun: false });
  const ledger = readLedger(project);
  const state = (slug: string): ReturnType<typeof ritualState> => {
    const doc = project.readItem<Ritual>("ritual", slug);
    assert.ok(doc !== null);
    return ritualState(doc, ledger, { now: new Date(`${TODAY}T12:00:00`) });
  };
  assert.deepEqual(
    [state("weekly-check").nextDue, state("weekly-check").isDue, state("weekly-check").lastCompleted],
    ["2026-09-15", true, "2026-09-08"],
  );
  assert.equal(state("moved-due").nextDue, "2026-09-20", "the reschedule wins over last_run + cadence");
  assert.equal(state("old-one").lifecycle, "retired");
  assert.equal(state("old-one").isDue, false);
  assert.equal(state("on-demand").isDue, false, "no cadence and already run: dormant");
  const lifecycle = linesOfType(ledger, "ritual.lifecycle")[0];
  assert.equal(lifecycle?.reason, "window closed 2026-09-05; nothing left to do");
});

test("a second import writes nothing and reports 0 new", () => {
  const project = openProject(freshProject(), { create: true });
  importTracker({ source: FIXTURE, project: project.name, dryRun: false });
  const before = readLedger(project).length;
  const report = importTracker({ source: FIXTURE, project: project.name, dryRun: false });
  assert.equal(report.totalNew, 0);
  assert.deepEqual(report.rituals, { found: 4, new: 0, updated: 0, unchanged: 4 });
  assert.deepEqual(report.runs, { found: 8, new: 0 });
  assert.deepEqual(report.evidence, { found: 3, new: 0 });
  assert.equal(readLedger(project).length, before, "no line appended, not even an import line");
  assert.equal(linesOfType(readLedger(project), "import").length, 1);
});

test("the source directory is never written", () => {
  const before = snapshot(FIXTURE);
  const name = freshProject();
  importTracker({ source: FIXTURE, project: name, dryRun: false });
  importTracker({ source: FIXTURE, project: name, dryRun: false });
  assert.deepEqual(snapshot(FIXTURE), before);
});

test("--dry-run reports the same counts and creates nothing", () => {
  const name = freshProject();
  const report = importTracker({ source: FIXTURE, project: name, dryRun: true });
  assert.equal(report.dryRun, true);
  assert.equal(report.rituals.new, 4);
  assert.equal(report.evidence.new, 3);
  assert.equal(existsSync(join(sandbox, "state", name)), false);
});

test("a changed source updates the item, keeps darius-owned fields, and imports only the new run", () => {
  const copy = join(mkdtempSync(join(tmpdir(), "darius-import-src-")), "tracker-mini");
  cpSync(FIXTURE, copy, { recursive: true });
  const project = openProject(freshProject(), { create: true });
  importTracker({ source: copy, project: project.name, dryRun: false });
  const original = project.readItem<Ritual>("ritual", "moved-due");
  assert.ok(original !== null);
  project.writeItem({ ...original, header: { ...original.header, policy: { mode: "report", may: ["Bash(date)"], hold: [] } } });

  const file = join(copy, "rituals", "moved-due", "ritual.md");
  writeFileSync(file, readFileSync(file, "utf8").replace("pushed the due date out", "moved the due date"));
  cpSync(join(copy, "rituals", "weekly-check", "runs", "2026-09-01.md"), join(copy, "rituals", "weekly-check", "runs", "2026-09-15.md"));
  const report = importTracker({ source: copy, project: project.name, dryRun: false });

  assert.deepEqual(report.rituals, { found: 4, new: 0, updated: 1, unchanged: 3 });
  assert.deepEqual(report.runs, { found: 9, new: 1 });
  const updated = project.readItem<Ritual>("ritual", "moved-due");
  assert.equal(updated?.header.id, original.header.id);
  assert.equal(updated?.header.policy.mode, "report");
  assert.ok(updated?.body.includes("moved the due date"));
});

test("a pruned row is the same run as its run file: skipped when the file is there or was imported", () => {
  const copy = join(mkdtempSync(join(tmpdir(), "darius-import-src-")), "tracker-mini");
  cpSync(FIXTURE, copy, { recursive: true });
  const runs = join(copy, "rituals", "weekly-check", "runs");
  const rows = join(runs, "_ledger.md");
  writeFileSync(rows, `${readFileSync(rows, "utf8")}- 2026-09-01: Weekly check — run 2026-09-01 — 1/1 verified\n`);
  const project = openProject(freshProject(), { create: true });
  const first = importTracker({ source: copy, project: project.name, dryRun: false });
  assert.deepEqual(first.runs, { found: 9, new: 8 }, "the row for 2026-09-01 is skipped: its run file is in the source");

  rmSync(join(runs, "2026-09-08.md"));
  writeFileSync(rows, `${readFileSync(rows, "utf8")}- 2026-09-08: Weekly check — run 2026-09-08 — 1/1 verified\n`);
  const second = importTracker({ source: copy, project: project.name, dryRun: false });
  assert.deepEqual(second.runs, { found: 9, new: 0 }, "the row for 2026-09-08 is skipped: its run file was imported");
});

test("refuses to overwrite a ritual that was not imported from this source", () => {
  const project = openProject(freshProject(), { create: true });
  project.writeItem({
    header: {
      id: "01K5Z8QK5Q9S1N1B5N9S1N1B5N",
      kind: "ritual",
      slug: "weekly-check",
      title: "Mine",
      created: "2026-09-01",
      updated: "2026-09-01",
      tags: [],
      anchor: "due",
      policy: { mode: "off", may: [], hold: [] },
    },
    body: "\n# Mine\n",
  });
  assert.throws(() => importTracker({ source: FIXTURE, project: project.name, dryRun: false }), /refusing to overwrite/u);
});

test("a path that is not a tracker directory is a usage error", () => {
  assert.throws(() => importTracker({ source: join(FIXTURE, "vigils"), project: freshProject(), dryRun: false }), UsageError);
  assert.throws(() => importTracker({ source: join(sandbox, "missing"), project: freshProject(), dryRun: false }), UsageError);
});

test("the command prints one JSON object with --json and refuses a missing path", async () => {
  const name = freshProject();
  const printed: string[] = [];
  const original = console.log;
  console.log = (text: string): void => {
    printed.push(text);
  };
  try {
    const code = await importCommand.run({ positional: [FIXTURE], flags: { project: name, json: true }, json: true, repeated: {} });
    assert.equal(code, 0);
  } finally {
    console.log = original;
  }
  assert.equal(printed.length, 1);
  const parsed = JSON.parse(printed[0] ?? "");
  assert.equal(parsed.project, name);
  assert.equal(parsed.rituals.found, 4);
  assert.equal(parsed.evidence.found, 3);

  await assert.rejects(importCommand.run({ positional: [], flags: { project: name }, json: false, repeated: {} }), UsageError);
});

test("import refuses a v3 project: rituals come from .darius.toml", async () => {
  const name = freshProject();
  const repo = join(sandbox, `${name}-repo`);
  cpSync(FIXTURE, join(repo, ".tracker"), { recursive: true });
  writeFileSync(join(repo, ".darius.toml"), `v = 3\nproject = "${name}"\ntz = "UTC"\n`);
  await assert.rejects(
    importCommand.run({ positional: [join(repo, ".tracker")], flags: {}, json: false, repeated: {} }),
    { name: "UsageError", message: /rituals come from .*\.darius\.toml in a v3 project/u },
  );
  assert.equal(existsSync(join(sandbox, "state", name)), false, "nothing was written");
});
