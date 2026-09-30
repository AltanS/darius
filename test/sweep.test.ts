/**
 * `darius vigil` and the sweep, on the six vigils of the `darius-selftest`
 * table in docs/plan-tonight.md. Every fixture goes through `vigil add`, the
 * same code path the CLI uses.
 *
 * One fixture change from the table: the table's passing check is `true`,
 * which the ported no-op classifier (src/core/checks.ts) calls a shell no-op,
 * so a vigil holding only `true` has no executable check and can never close.
 * The fixtures use `test 1 = 1`, a real command with the same result.
 *
 * Each check costs about 0.5 s (`bash -lc`), so this file takes ~10 s.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseArgs } from "../src/cli/args.ts";
import { vigilCommand } from "../src/cli/vigil.ts";
import { linesFor, readLedger } from "../src/core/ledger.ts";
import type { LedgerLine } from "../src/core/model.ts";
import { itemRef, openProject } from "../src/core/store.ts";
import { localToday, trailingPipeFilter, type SweepResult, type SweptVigil } from "../src/core/sweep.ts";

// Every path is read at call time, so pointing the store at a throwaway dir
// here, before any call, keeps the operator's real store untouched.
const SANDBOX = mkdtempSync(join(tmpdir(), "darius-sweep-"));
process.env.DARIUS_STATE_DIR = join(SANDBOX, "state");
process.env.DARIUS_CONFIG_DIR = join(SANDBOX, "config");
delete process.env.DARIUS_SWEEP_ACTIVE;

const PROJECT = "darius-selftest";

interface CliRun {
  code: number;
  stdout: string;
  stderr: string;
}

/** Runs `darius vigil ...` in process, capturing stdout and stderr. */
async function runVigil(argv: string[], stdin?: string): Promise<CliRun> {
  const args = parseArgs([...argv, "--project", PROJECT]);
  if (stdin !== undefined) args.stdin = stdin;
  const out: string[] = [];
  const err: string[] = [];
  const { log, error } = console;
  console.log = (...parts: string[]) => out.push(parts.join(" "));
  console.error = (...parts: string[]) => err.push(parts.join(" "));
  try {
    const code = await vigilCommand.run(args);
    return { code, stdout: out.join("\n"), stderr: err.join("\n") };
  } finally {
    console.log = log;
    console.error = error;
  }
}

async function sweep(extra: string[] = []): Promise<SweepResult> {
  const run = await runVigil(["sweep", "--json", ...extra]);
  assert.equal(run.code, 0, run.stderr);
  const result: SweepResult = JSON.parse(run.stdout);
  return result;
}

function entry(result: SweepResult, slug: string): SweptVigil {
  const found = result.vigils.find((vigil) => vigil.slug === slug);
  assert.ok(found, `no ${slug} in the sweep result`);
  return found;
}

function lines(slug: string, type: string): LedgerLine[] {
  const project = openProject(PROJECT);
  return linesFor(readLedger(project), itemRef("vigil", slug)).filter((line) => line.type === type);
}

function yesterday(): string {
  const now = new Date();
  now.setDate(now.getDate() - 1);
  return localToday(now);
}

function checklist(...items: string[]): string {
  return `# checks\n\n${items.join("\n")}\n`;
}

function execItem(label: string, command: string, expected = "exit 0"): string {
  return `- [ ] ${label}\n  - Command: \`${command}\`\n  - Expected: \`${expected}\``;
}

const MARKER = join(process.env.DARIUS_STATE_DIR, PROJECT, "fired.marker");

async function seed(): Promise<void> {
  const due = yesterday();
  const adds: [string[], string][] = [
    [["date-held", "--title", "date held", "--due", due], checklist(execItem("passes", "test 1 = 1"))],
    [["date-failed", "--title", "date failed", "--due", due], checklist(execItem("fails", "test -f /nonexistent"))],
    [
      [
        "event-gated",
        "--title",
        "event gated",
        "--until",
        "selftest marker exists",
        "--gate-command",
        "test -f $DARIUS_STATE_DIR/darius-selftest/fired.marker",
      ],
      checklist(execItem("passes", "test 1 = 1")),
    ],
    [["heavy-one", "--title", "heavy one", "--heavy"], checklist(execItem("sleeps", "sleep 1"))],
    [
      ["mixed-manual", "--title", "mixed manual", "--due", due],
      checklist(
        execItem("passes", "test 1 = 1"),
        "- [ ] operator looks at the page\n  - Expected: `manual (owner: owner, expires: 2027-01-01)`",
      ),
    ],
  ];
  for (const [argv, body] of adds) {
    const run = await runVigil(["add", ...argv, "--stdin"], body);
    assert.equal(run.code, 0, run.stderr);
  }
}

test("the six selftest vigils land in the planned buckets and outcomes", async () => {
  await seed();

  // Classify-only runs nothing and writes nothing.
  const ledgerBefore = readLedger(openProject(PROJECT)).length;
  const classified = await sweep(["--classify-only"]);
  assert.equal(readLedger(openProject(PROJECT)).length, ledgerBefore);
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

  // First real sweep.
  const first = await sweep();
  assert.equal(first.date, localToday());

  const held = entry(first, "date-held");
  assert.deepEqual([held.bucket, held.outcome, held.closed], ["runnable", "held", true]);
  const closedLines = lines("date-held", "vigil.closed");
  assert.equal(closedLines.length, 1);
  assert.equal(closedLines[0]?.verdict, "held");
  assert.equal(closedLines[0]?.by, "sweep");
  assert.equal(lines("date-held", "evidence")[0]?.check, "vigil/date-held#0");

  const failed = entry(first, "date-failed");
  assert.deepEqual([failed.outcome, failed.closed, failed.flagged], ["failed", false, true]);
  assert.equal(lines("date-failed", "vigil.swept")[0]?.outcome, "failed");
  assert.equal(lines("date-failed", "vigil.closed").length, 0);

  const gated = entry(first, "event-gated");
  assert.deepEqual([gated.bucket, gated.gate, gated.outcome, gated.closed], ["event-gated", "not-fired", undefined, false]);
  assert.equal(lines("event-gated", "evidence").length, 0, "no check runs before the gate fires");

  const heavy = entry(first, "heavy-one");
  assert.deepEqual([heavy.bucket, heavy.outcome], ["heavy", "skipped"]);
  assert.equal(lines("heavy-one", "evidence").length, 0);

  const mixed = entry(first, "mixed-manual");
  assert.deepEqual([mixed.bucket, mixed.outcome, mixed.closed, mixed.flagged], ["mixed", "awaiting-manual", false, false]);

  // `vigil list` flags the failed one only.
  const list = await runVigil(["list", "--json"]);
  const listed: { vigils: { slug: string; status: { flagged: boolean; state: string } }[] } = JSON.parse(list.stdout);
  assert.deepEqual(
    listed.vigils.filter((vigil) => vigil.status.flagged).map((vigil) => vigil.slug),
    ["date-failed"],
  );

  // The event fires: the gate command now exits 0 and the vigil closes held.
  writeFileSync(MARKER, "");
  const second = await sweep();
  const fired = entry(second, "event-gated");
  assert.deepEqual([fired.bucket, fired.gate, fired.outcome, fired.closed], ["runnable", "fired", "held", true]);
  assert.equal(lines("event-gated", "vigil.closed")[0]?.verdict, "held");
  assert.equal(entry(second, "date-held").bucket, "closed");
  assert.equal(entry(second, "date-failed").closed, false);
  assert.equal(lines("heavy-one", "vigil.swept").length, 1, "the skipped line is written once per day");

  // Heavy is opt-in.
  const third = await sweep(["--include-heavy"]);
  const ranHeavy = entry(third, "heavy-one");
  assert.deepEqual([ranHeavy.bucket, ranHeavy.outcome, ranHeavy.closed], ["runnable", "held", true]);
});

test("a sweep inside a sweep refuses with exit 1 and runs nothing", async () => {
  process.env.DARIUS_SWEEP_ACTIVE = "1";
  try {
    const run = await runVigil(["sweep", "--json"]);
    assert.equal(run.code, 1);
    assert.equal(run.stdout, "");
    assert.match(run.stderr, /DARIUS_SWEEP_ACTIVE/u);
  } finally {
    delete process.env.DARIUS_SWEEP_ACTIVE;
  }
});

test("every Command runs with DARIUS_SWEEP_ACTIVE=1", async () => {
  const body = checklist(execItem("sees the guard", 'test "$DARIUS_SWEEP_ACTIVE" = 1'));
  assert.equal((await runVigil(["add", "guard-env", "--title", "guard env", "--stdin"], body)).code, 0);
  const result = await sweep(["--only", "guard-env"]);
  assert.equal(entry(result, "guard-env").outcome, "held");
});

test("vigil add refuses a Command that starts a sweep", async () => {
  const body = checklist(execItem("recurses", "darius vigil sweep --json"));
  await assert.rejects(runVigil(["add", "recursive", "--title", "recursive", "--stdin"], body), /starts a sweep/u);
  const gate = ["add", "recursive-gate", "--title", "r", "--until", "x", "--gate-command", "djinn fc vigil-sweep"];
  await assert.rejects(runVigil(gate), /starts a sweep/u);
});

test("a trailing-pipe exit check is masked: never run, never closes", async () => {
  const touched = join(SANDBOX, "ran");
  const body = checklist(execItem("masked", `touch ${touched}; false | head -1`));
  assert.equal((await runVigil(["add", "masked-pipe", "--title", "masked", "--stdin"], body)).code, 0);
  const result = await sweep(["--only", "masked-pipe"]);
  const masked = entry(result, "masked-pipe");
  assert.equal(masked.bucket, "no-command");
  assert.equal(masked.closed, false);
  assert.equal(masked.checks[0]?.outcome, "masked");
  assert.match(masked.checks[0]?.reason ?? "", /head/u);
  assert.equal(existsSync(touched), false);
});

test("trailingPipeFilter reads only the last |-joined stage", () => {
  assert.equal(trailingPipeFilter("rg foo x | head -1"), "head");
  assert.equal(trailingPipeFilter("rg foo x | wc -l"), "wc");
  assert.equal(trailingPipeFilter("rg foo x && head -1 f"), null);
  assert.equal(trailingPipeFilter("rg foo x || head -1 f"), null);
  assert.equal(trailingPipeFilter("rg foo x | head -1 | grep -q y"), null);
  assert.equal(trailingPipeFilter("set -o pipefail; rg foo x | head -1"), null);
  assert.equal(trailingPipeFilter("grep -l x f | xargs grep -l y"), null);
  assert.equal(trailingPipeFilter("grep -l x f | xargs -r grep -l y"), "xargs");
  assert.equal(trailingPipeFilter("grep -l x f | xargs -n 1 head"), "xargs");
});

test("vigil close closes once and refuses a second close; show renders evidence", async () => {
  const body = checklist(execItem("passes", "test 1 = 1"));
  assert.equal((await runVigil(["add", "by-hand", "--title", "by hand", "--until", "someday", "--stdin"], body)).code, 0);
  assert.equal((await runVigil(["close", "by-hand", "--verdict", "failed", "--who", "owner"])).code, 0);
  assert.equal(lines("by-hand", "vigil.closed")[0]?.verdict, "failed");
  await assert.rejects(runVigil(["close", "by-hand", "--verdict", "held"]), /already closed/u);
  await assert.rejects(runVigil(["close", "by-hand", "--verdict", "maybe"]), /--verdict held\|failed/u);

  const show = await runVigil(["show", "date-failed", "--json"]);
  const shown: { status: { flagged: boolean }; evidence: { check: string; outcome: string }[] } = JSON.parse(show.stdout);
  assert.equal(shown.status.flagged, true);
  assert.deepEqual(
    shown.evidence.map((line) => [line.check, line.outcome]),
    [["vigil/date-failed#0", "fail"]],
  );
});
