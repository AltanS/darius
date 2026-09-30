/**
 * `src/cli/selftest.ts` (T12): seeding the `darius-selftest` project through
 * the same code paths `ritual add` and `vigil add` use, idempotently, plus
 * `selftest fire` and `selftest status`.
 *
 * test/sweep.test.ts (T9) already proved the sweep semantics for this exact
 * fixture set against hand-built vigils; this file's job is the SEEDING --
 * that `darius selftest seed` produces the same five vigils and the one
 * ritual, that a second seed changes nothing, and that the seeded fixtures
 * land in the buckets and outcomes docs/plan-tonight.md's table promises.
 *
 * Each executable check costs about 0.5 s (`bash -lc`, src/core/checks.ts);
 * this file runs a handful, so it takes a few seconds.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseArgs } from "../src/cli/args.ts";
import type { Command, ParsedArgs } from "../src/cli/registry.ts";
import { fireMarker, selftestCommand } from "../src/cli/selftest.ts";
import { vigilCommand } from "../src/cli/vigil.ts";
import type { Ritual } from "../src/core/model.ts";
import type { SweepResult, SweptVigil } from "../src/core/sweep.ts";
import { openProject } from "../src/core/store.ts";

// Every path is read at call time, so pointing the store at a throwaway dir
// here, before any call, keeps the operator's real store untouched.
const SANDBOX = mkdtempSync(join(tmpdir(), "darius-selftest-cli-"));
process.env.DARIUS_STATE_DIR = join(SANDBOX, "state");
process.env.DARIUS_CONFIG_DIR = join(SANDBOX, "config");
delete process.env.DARIUS_SWEEP_ACTIVE;

const PROJECT = "darius-selftest";
const VIGIL_SLUGS = ["date-failed", "date-held", "event-gated", "heavy-one", "mixed-manual"];

interface CliRun {
  code: number;
  stdout: string;
  stderr: string;
}

/** Runs a Command's `run()` in process, capturing stdout and stderr. */
async function runCli(command: Command, argv: string[]): Promise<CliRun> {
  const args: ParsedArgs = parseArgs(argv);
  const out: string[] = [];
  const err: string[] = [];
  const { log, error } = console;
  console.log = (...parts: string[]) => out.push(parts.join(" "));
  console.error = (...parts: string[]) => err.push(parts.join(" "));
  try {
    const code = await command.run(args);
    return { code, stdout: out.join("\n"), stderr: err.join("\n") };
  } finally {
    console.log = log;
    console.error = error;
  }
}

async function seed(project: string): Promise<CliRun> {
  return runCli(selftestCommand, ["seed", "--project", project]);
}

async function sweep(project: string, extra: string[] = []): Promise<SweepResult> {
  const run = await runCli(vigilCommand, ["sweep", "--project", project, "--json", ...extra]);
  assert.equal(run.code, 0, run.stderr);
  return JSON.parse(run.stdout);
}

function entry(result: SweepResult, slug: string): SweptVigil {
  const found = result.vigils.find((vigil) => vigil.slug === slug);
  assert.ok(found, `no ${slug} in the sweep result`);
  return found;
}

function readRitual(project: string): Ritual {
  const doc = openProject(project).readItem<Ritual>("ritual", "heartbeat");
  assert.ok(doc !== null, `no heartbeat ritual in ${project}`);
  return doc.header;
}

// --- seed: idempotent, through the CLI ---------------------------------------

test("seed creates 1 ritual and 5 vigils; a second seed changes nothing", async () => {
  const first = await runCli(selftestCommand, ["seed", "--project", PROJECT, "--json"]);
  assert.equal(first.code, 0, first.stderr);
  const firstReport: { project: string; items: { kind: string; slug: string; status: string }[] } = JSON.parse(
    first.stdout,
  );
  assert.equal(firstReport.project, PROJECT);
  assert.deepEqual(
    firstReport.items.map((item) => [item.kind, item.slug, item.status]),
    [
      ["ritual", "heartbeat", "added"],
      ["vigil", "date-held", "added"],
      ["vigil", "date-failed", "added"],
      ["vigil", "event-gated", "added"],
      ["vigil", "heavy-one", "added"],
      ["vigil", "mixed-manual", "added"],
    ],
  );

  const project = openProject(PROJECT);
  assert.deepEqual(project.listItems("ritual"), ["heartbeat"]);
  assert.deepEqual(project.listItems("vigil"), VIGIL_SLUGS);

  const second = await runCli(selftestCommand, ["seed", "--project", PROJECT, "--json"]);
  assert.equal(second.code, 0, second.stderr);
  const secondReport: { items: { status: string }[] } = JSON.parse(second.stdout);
  assert.ok(secondReport.items.every((item) => item.status === "unchanged"));

  // Idempotent: still exactly one ritual and five vigils, none rewritten.
  assert.deepEqual(project.listItems("ritual"), ["heartbeat"]);
  assert.deepEqual(project.listItems("vigil"), VIGIL_SLUGS);
});

test("seed writes the heartbeat ritual with cadence, anchor and the policy ritual add cannot set yet", async () => {
  const project = "selftest-ritual-shape";
  assert.equal((await seed(project)).code, 0);

  const header = readRitual(project);
  assert.equal(header.title, "Heartbeat");
  assert.equal(header.cadence, "1d");
  assert.equal(header.anchor, "due");
  assert.deepEqual(header.policy, {
    mode: "report",
    may: ["Bash(darius *)", "Bash(date)"],
    hold: ["git push", "rm -rf"],
    notes: "Read-only. Runs darius --version and date, then reports the outputs. Nothing else is allowed.",
    model: "haiku",
    max_turns: 6,
  });

  const doc = openProject(project).readItem<Ritual>("ritual", "heartbeat");
  assert.match(doc?.body ?? "", /darius --version/u);
  assert.match(doc?.body ?? "", /\bdate\b/u);
  assert.match(
    doc?.body ?? "",
    new RegExp(`darius run complete <run> --project ${project} --outcome complete --findings-stdin`, "u"),
  );
});

// --- classify-only and a real sweep, on the seeded fixtures ------------------

test("classify-only shows the buckets docs/plan-tonight.md's table promises", async () => {
  assert.equal((await seed(PROJECT)).code, 0);
  const classified = await sweep(PROJECT, ["--classify-only"]);
  // `sweepProject` walks `project.listItems("vigil")`, already alphabetical
  // (src/core/store.ts), so the result needs no re-sort.
  assert.deepEqual(
    classified.vigils.map((vigil) => [vigil.slug, vigil.bucket]),
    [
      ["date-failed", "runnable"],
      ["date-held", "runnable"],
      ["event-gated", "event-gated"],
      ["heavy-one", "heavy"],
      ["mixed-manual", "mixed"],
    ],
  );
});

test("a real sweep gives the outcomes the table promises; selftest fire then closes event-gated held", async () => {
  assert.equal((await seed(PROJECT)).code, 0);

  const first = await sweep(PROJECT);

  const held = entry(first, "date-held");
  assert.equal(held.outcome, "held");
  assert.equal(held.closed, true);

  const failed = entry(first, "date-failed");
  assert.equal(failed.outcome, "failed");
  assert.equal(failed.closed, false);
  assert.equal(failed.flagged, true);

  const gated = entry(first, "event-gated");
  assert.equal(gated.bucket, "event-gated");
  assert.equal(gated.gate, "not-fired");
  assert.equal(gated.closed, false);

  const heavy = entry(first, "heavy-one");
  assert.equal(heavy.bucket, "heavy");
  assert.equal(heavy.closed, false);

  const mixed = entry(first, "mixed-manual");
  assert.equal(mixed.outcome, "awaiting-manual");
  assert.equal(mixed.closed, false);
  assert.equal(mixed.flagged, false);

  const fired = await runCli(selftestCommand, ["fire", "--project", PROJECT, "--json"]);
  assert.equal(fired.code, 0, fired.stderr);
  const firedJson: { project: string; marker: string } = JSON.parse(fired.stdout);
  assert.equal(firedJson.project, PROJECT);
  assert.equal(firedJson.marker, join(openProject(PROJECT).root, "fired.marker"));
  assert.ok(existsSync(firedJson.marker));

  const second = await sweep(PROJECT);
  const gatedAfter = entry(second, "event-gated");
  assert.equal(gatedAfter.gate, "fired");
  assert.equal(gatedAfter.outcome, "held");
  assert.equal(gatedAfter.closed, true);
});

// --- fire: the marker path itself --------------------------------------------

test("fireMarker writes <store>/<project>/fired.marker, relative to the sweep's default cwd", async () => {
  const project = "selftest-fire-path";
  const opened = openProject(project, { create: true });
  const path = fireMarker(opened);
  assert.equal(path, join(opened.root, "fired.marker"));
  assert.ok(existsSync(path));

  // The sweep's default cwd is the project root (src/core/sweep.ts,
  // SweepOptions.cwd), so a gate_command of `test -f fired.marker` -- a
  // relative path, no $DARIUS_STATE_DIR needed -- resolves to exactly this
  // file. Proven end to end (gate fires after a real `selftest fire`) in
  // the sweep test above; this test isolates the path itself.
  assert.equal(opened.root, join(process.env.DARIUS_STATE_DIR ?? "", project));
});

// --- status: optional, but cheap and read-only -------------------------------

test("status reports the ritual's lifecycle and every vigil's state, machine and human", async () => {
  assert.equal((await seed(PROJECT)).code, 0);

  const machine = await runCli(selftestCommand, ["status", "--project", PROJECT, "--json"]);
  assert.equal(machine.code, 0, machine.stderr);
  const parsed: { project: string; ritual: { slug: string; lifecycle: string }; vigils: { slug: string }[] } =
    JSON.parse(machine.stdout);
  assert.equal(parsed.project, PROJECT);
  assert.equal(parsed.ritual.slug, "heartbeat");
  assert.equal(parsed.ritual.lifecycle, "active");
  assert.deepEqual(
    parsed.vigils.map((vigil) => vigil.slug).toSorted(),
    VIGIL_SLUGS,
  );

  const human = await runCli(selftestCommand, ["status", "--project", PROJECT]);
  assert.equal(human.code, 0, human.stderr);
  assert.match(human.stdout, /ritual heartbeat\s+active/u);
});

test("status reports 'not seeded' and 'no vigils' before seed ever runs", async () => {
  const project = "selftest-status-empty";
  openProject(project, { create: true });
  const status = await runCli(selftestCommand, ["status", "--project", project]);
  assert.equal(status.code, 0, status.stderr);
  assert.match(status.stdout, /not seeded/u);
  assert.match(status.stdout, /no vigils/u);
});

// --- usage errors -------------------------------------------------------------

test("selftest with no verb, or an unknown one, refuses with a usage error naming the verbs", async () => {
  await assert.rejects(runCli(selftestCommand, ["--project", PROJECT]), /needs a verb/u);
  await assert.rejects(runCli(selftestCommand, ["bogus", "--project", PROJECT]), /needs a verb/u);
});

test("fire and status refuse a project that was never created", async () => {
  await assert.rejects(runCli(selftestCommand, ["fire", "--project", "selftest-never-seeded"]), /no project/u);
  await assert.rejects(runCli(selftestCommand, ["status", "--project", "selftest-never-seeded"]), /no project/u);
});
