/**
 * The sign-off (0.52.0): the banner text, where `run complete` and `run hold`
 * print it, the prompt rule, and which finished herdr tabs close. A fake herdr
 * script logs the calls; the real herdr is never reached.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { signoffBanner, SIGNOFF_MAX_LINES, SIGNOFF_MAX_WIDTH, type SignoffInput } from "../src/core/signoff.ts";
import type { Ritual } from "../src/core/model.ts";
import { buildPrompt } from "../src/runner/launch.ts";
import { closeFinishedTabs, TAB_KEEP_MS, type TabRun } from "../src/surface/herdr.ts";

const BIN = join(import.meta.dirname, "..", "bin", "darius");
const RUN = "01JABCDEFGHJKMNPQRSTVWXYZ0";
const NOW = new Date("2026-10-01T12:30:00Z");
const BASE: SignoffInput = {
  kind: "complete",
  ritual: "fact-check",
  run: RUN,
  project: "acme-web",
  startedAt: "2026-10-01T11:34:00Z",
  now: NOW,
};
const OPEN = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };

function assertFitsPane(text: string): void {
  const lines = text.split("\n");
  assert.ok(lines.length <= SIGNOFF_MAX_LINES, `${String(lines.length)} lines`);
  for (const line of lines) assert.ok(line.length <= SIGNOFF_MAX_WIDTH, `too wide: ${line}`);
  assert.match(text, /^[\x20-\x7e\n]+$/u, "printable ASCII only");
}

test("complete with attention: the ghost leaves, the result line counts questions, fixed and open", () => {
  const text = signoffBanner({ ...BASE, summary: { status: "attention", questions: 2, fixed: 1, open: { ...OPEN, high: 1, low: 1 } } });
  assertFitsPane(text);
  assert.equal(
    text,
    [
      " |^|^|^|^|^|^|^|",
      " |             |          .-.",
      " |    .---.    |   ~     (o o)",
      " |   /     \\   | ~~~~    | O |",
      " |___|     |___|~~~~     '~^~'",
      "darius: fact-check left the castle",
      `run ${RUN} | acme-web`,
      "result: attention | 2 question(s) | 1 fixed | 2 open",
      "ended 12:30 UTC, took 56 min",
    ].join("\n"),
  );
});

test("ok with zero questions leaves the zero parts out", () => {
  const text = signoffBanner({ ...BASE, summary: { status: "ok", questions: 0, fixed: 0, open: OPEN } });
  assertFitsPane(text);
  assert.match(text, /^result: ok$/mu);
});

test("failed and abandoned say outcome, not result", () => {
  for (const outcome of ["failed", "abandoned"] as const) {
    const text = signoffBanner({ ...BASE, outcome });
    assertFitsPane(text);
    assert.match(text, new RegExp(`^outcome: ${outcome}$`, "mu"));
    assert.equal(text.includes("result:"), false);
  }
});

test("a follow-up names its parent, and the banner still fits 10 lines", () => {
  const text = signoffBanner({ ...BASE, summary: { status: "ok", questions: 0, fixed: 0, open: OPEN }, followUpOf: "01JPARENTPARENTPARENTAB1234" });
  assertFitsPane(text);
  assert.equal(text.split("\n").length, 10);
  assert.match(text, /^follow-up of ab1234$/mu);
});

test("held: the ghost waits, with the question count and the answer command", () => {
  const text = signoffBanner({ ...BASE, kind: "held", questions: 3 });
  assertFitsPane(text);
  assert.match(text, /^darius: fact-check waits at the gate$/mu);
  assert.match(text, /^3 question\(s\) for the operator$/mu);
  assert.ok(text.includes(`answer: darius run answer ${RUN} <n> <text>`));
  assert.ok(text.includes("--project acme-web"));
  assert.ok(text.includes("?"));
});

test("a long project name keeps every line within 72 columns", () => {
  assertFitsPane(signoffBanner({ ...BASE, kind: "held", questions: 1, project: "p".repeat(60) }));
  assertFitsPane(signoffBanner({ ...BASE, project: "p".repeat(80) }));
});

test("the run prompt carries the sign-off rule", () => {
  const ritual: Ritual = {
    id: "x", kind: "ritual", slug: "heartbeat", title: "Heartbeat", created: "", updated: "", tags: [], cadence: "1d", anchor: "due",
    policy: { mode: "report", may: [], hold: [] },
  };
  const prompt = buildPrompt({ project: "acme-web", run: RUN, ritual, body: "Do it." });
  assert.ok(prompt.includes("your last message is the sign-off block it printed, copied exactly inside a code block, and nothing else."));
});

// --- where the CLI prints it ----------------------------------------------------------

interface Sandbox {
  root: string;
  env: NodeJS.ProcessEnv;
}

interface CliOutput {
  code: number | null;
  stdout: string;
  stderr: string;
}

interface FakeHerdr {
  bin: string;
  calls: () => string[];
  root: string;
}

function sandbox(): Sandbox {
  const root = mkdtempSync(join(tmpdir(), "darius-signoff-"));
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: join(root, "home"), DARIUS_STATE_DIR: join(root, "state"), DARIUS_CONFIG_DIR: join(root, "config") };
  delete env.DARIUS_PROJECT;
  delete env.DARIUS_RUN;
  mkdirSync(join(root, "home"), { recursive: true });
  mkdirSync(join(root, "repo"), { recursive: true });
  writeFileSync(join(root, "repo", ".darius.toml"), 'project = "acme-web"\n');
  return { root, env };
}

function darius(root: string, env: NodeJS.ProcessEnv, argv: string[], extra: NodeJS.ProcessEnv = {}): CliOutput {
  const result = spawnSync(BIN, argv, { encoding: "utf8", env: { ...env, ...extra }, cwd: join(root, "repo"), timeout: 20_000 });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

function nextRun(root: string, env: NodeJS.ProcessEnv): string {
  const found = /"run":\s*"(?<run>[0-9A-Z]+)"/u.exec(darius(root, env, ["run", "start", "weekly-report", "--json"]).stdout);
  assert.ok(found?.groups?.run !== undefined, "run start --json names the run");
  return found.groups.run;
}

function startRun(root: string, env: NodeJS.ProcessEnv): string {
  assert.equal(darius(root, env, ["ritual", "add", "weekly-report", "--title", "Weekly report", "--cadence", "1w"]).code, 0);
  return nextRun(root, env);
}

test("run complete inside the run prints the banner; a person gets none; --banner asks; --json never has it", () => {
  const { root, env } = sandbox();
  const outside = startRun(root, env);
  const plain = darius(root, env, ["run", "complete", outside, "--outcome", "complete"]);
  assert.equal(plain.code, 0, plain.stderr);
  assert.equal(plain.stdout.includes("left the castle"), false);

  const inside = nextRun(root, env);
  const json = darius(root, env, ["run", "complete", inside, "--outcome", "complete", "--json"], { DARIUS_RUN: inside });
  assert.equal(json.code, 0, json.stderr);
  assert.equal(json.stdout.includes("castle"), false);
  assert.doesNotThrow(() => JSON.parse(json.stdout));

  const third = nextRun(root, env);
  const mine = darius(root, env, ["run", "complete", third, "--outcome", "complete"], { DARIUS_RUN: third });
  assert.equal(mine.code, 0, mine.stderr);
  assert.match(mine.stdout, /^✓ completed run /u);
  assert.match(mine.stdout, /darius: weekly-report left the castle\nrun \w+ \| acme-web\nresult: complete\nended /u);
  assertFitsPane(mine.stdout.slice(mine.stdout.indexOf("\n") + 1).trimEnd());

  const fourth = nextRun(root, env);
  const asked = darius(root, env, ["run", "complete", fourth, "--outcome", "failed", "--banner"]);
  assert.match(asked.stdout, /outcome: failed/u);
});

test("run hold inside the run prints the waiting banner; outside it prints none", () => {
  const { root, env } = sandbox();
  const run = startRun(root, env);
  const held = darius(root, env, ["run", "hold", run, "--question", "may I push?"], { DARIUS_RUN: run });
  assert.equal(held.code, 0, held.stderr);
  assert.match(held.stdout, /waits at the gate/u);
  assert.match(held.stdout, /1 question\(s\) for the operator/u);
});

test("run hold outside the run prints no banner", () => {
  const { root, env } = sandbox();
  const run = startRun(root, env);
  const held = darius(root, env, ["run", "hold", run, "--question", "may I push?"]);
  assert.equal(held.code, 0, held.stderr);
  assert.equal(held.stdout.includes("gate"), false);
});

// --- tab retention ----------------------------------------------------------------------

function fakeHerdr(): FakeHerdr {
  const root = mkdtempSync(join(tmpdir(), "darius-tabs-"));
  const bin = join(root, "herdr");
  writeFileSync(bin, `#!/bin/sh\necho "$@" >> "${join(root, "calls")}"\n`);
  chmodSync(bin, 0o755);
  writeFileSync(join(root, "calls"), "");
  return { bin, root, calls: () => readFileSync(join(root, "calls"), "utf8").trim().split("\n").filter((line) => line !== "") };
}

function tabFile(root: string, run: string): string {
  const dir = join(root, "runs", run);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "herdr.json"), JSON.stringify({ tab: `w1:${run}` }));
  return join(dir, "herdr.json");
}

const T0 = Date.parse("2026-10-01T10:00:00Z");
const at = (ms: number): string => new Date(ms).toISOString();

function finished(run: string, startedMs: number, endedMs: number): TabRun {
  return { run, item: "ritual/fact-check", phase: "closed", startedAt: at(startedMs), endedAt: at(endedMs) };
}

test("tab retention: a newer run of the same ritual closes the older finished tab", async () => {
  const h = fakeHerdr();
  const old = tabFile(h.root, "A");
  const fresh = tabFile(h.root, "B");
  const runs = [finished("A", T0, T0 + 60_000), finished("B", T0 + 3_600_000, T0 + 3_660_000)];
  const closed = await closeFinishedTabs(join(h.root, "runs"), runs, T0 + 7_200_000, { bin: h.bin });
  assert.equal(closed, 1);
  assert.deepEqual(h.calls(), ["tab close w1:A"]);
  assert.equal(existsSync(old), false);
  assert.equal(existsSync(fresh), true, "the newest run's tab stays");
});

test("tab retention: the newest run of a ritual stays under 48 hours, and a run of another ritual does not count", async () => {
  const h = fakeHerdr();
  tabFile(h.root, "A");
  const other: TabRun = { run: "Z", item: "ritual/other", phase: "closed", startedAt: at(T0 + 1000), endedAt: at(T0 + 2000) };
  const closed = await closeFinishedTabs(join(h.root, "runs"), [finished("A", T0, T0 + 60_000), other], T0 + TAB_KEEP_MS - 1000, { bin: h.bin });
  assert.equal(closed, 0);
  assert.deepEqual(h.calls(), []);
});

test("tab retention: a run that ended over 48 hours ago closes without a newer run", async () => {
  const h = fakeHerdr();
  const file = tabFile(h.root, "A");
  const closed = await closeFinishedTabs(join(h.root, "runs"), [finished("A", T0, T0 + 60_000)], T0 + 60_000 + TAB_KEEP_MS + 1000, { bin: h.bin });
  assert.equal(closed, 1);
  assert.deepEqual(h.calls(), ["tab close w1:A"]);
  assert.equal(existsSync(file), false);
});

test("tab retention: a held or running run keeps its tab, even with a newer run and after 48 hours", async () => {
  const h = fakeHerdr();
  const held = tabFile(h.root, "H");
  tabFile(h.root, "R");
  const runs: TabRun[] = [
    { run: "H", item: "ritual/fact-check", phase: "held", startedAt: at(T0) },
    { run: "R", item: "ritual/fact-check", phase: "running", startedAt: at(T0) },
    finished("N", T0 + 1000, T0 + 2000),
  ];
  const closed = await closeFinishedTabs(join(h.root, "runs"), runs, T0 + 5 * TAB_KEEP_MS, { bin: h.bin });
  assert.equal(closed, 0);
  assert.deepEqual(h.calls(), []);
  assert.equal(existsSync(held), true);
});
