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
import { appendLine, hostId, linesFor, readLedger } from "../src/core/ledger.ts";
import { UsageError, type LedgerLine } from "../src/core/model.ts";
import { itemRef, openProject, putBlob } from "../src/core/store.ts";
import { takeSweepLease, takeVigilSweepLease } from "../src/core/sweep-lease.ts";
import { cooldownLeftMs, lastFailure, localToday, sweepProject, trailingPipeFilter, vigilStatus, type SweepResult, type SweptVigil } from "../src/core/sweep.ts";

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
  return `# checks\n\n## Verification Checklist\n\n${items.join("\n")}\n`;
}

function execItem(label: string, command: string, expected = "exit 0", pending?: string): string {
  const clause = pending === undefined ? "" : `\n  - Pending: \`${pending}\``;
  return `- [ ] ${label}\n  - Command: \`${command}\`\n  - Expected: \`${expected}\`${clause}`;
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
    [["heavy-one", "--title", "heavy one", "--due", due, "--heavy"], checklist(execItem("sleeps", "sleep 1"))],
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

  // `vigil list` flags the failed one only, and hides the closed one without --all.
  const list = await runVigil(["list", "--json"]);
  const listed: { slug: string; flagged: boolean; state: string; lastOutcome: string | null }[] = JSON.parse(list.stdout);
  assert.deepEqual(
    listed.filter((vigil) => vigil.flagged).map((vigil) => vigil.slug),
    ["date-failed"],
  );
  assert.ok(!listed.some((vigil) => vigil.slug === "date-held"), "a closed vigil is not listed without --all");
  assert.equal(listed.find((vigil) => vigil.slug === "date-failed")?.lastOutcome, "failed");

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
  assert.equal((await runVigil(["add", "guard-env", "--title", "guard env", "--due", yesterday(), "--stdin"], body)).code, 0);
  const result = await sweep(["--only", "guard-env"]);
  assert.equal(entry(result, "guard-env").outcome, "held");
});

test("vigil add refuses a Command that starts a sweep", async () => {
  const body = checklist(execItem("recurses", "darius vigil sweep --json"));
  await assert.rejects(runVigil(["add", "recursive", "--title", "recursive", "--until", "x", "--stdin"], body), /starts a sweep/u);
  const gate = ["add", "recursive-gate", "--title", "r", "--until", "x", "--gate-command", "djinn fc vigil-sweep"];
  await assert.rejects(runVigil(gate), /starts a sweep/u);
});

test("a trailing-pipe exit check is masked: never run, never closes", async () => {
  const touched = join(SANDBOX, "ran");
  const body = checklist(execItem("masked", `touch ${touched}; false | head -1`));
  assert.equal((await runVigil(["add", "masked-pipe", "--title", "masked", "--due", yesterday(), "--stdin"], body)).code, 0);
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

async function addDue(slug: string, command: string): Promise<void> {
  const run = await runVigil(["add", slug, "--title", slug, "--due", yesterday(), "--stdin"], checklist(execItem("checks", command)));
  assert.equal(run.code, 0, run.stderr);
}

test("vigil sweep <slug> sweeps that vigil only", async () => {
  await addDue("slug-one", "test 1 = 1");
  await addDue("slug-two", "test 1 = 1");
  const result = await sweep(["slug-one"]);
  assert.deepEqual(
    result.vigils.map((vigil) => vigil.slug),
    ["slug-one"],
  );
  assert.equal(lines("slug-one", "evidence").length, 1);
  assert.equal(lines("slug-two", "evidence").length, 0, "the other vigil did not run");
  assert.equal(lines("slug-two", "vigil.swept").length, 0);
  // The same slug as --only is not a conflict.
  assert.equal(entry(await sweep(["slug-two", "--only", "slug-two"]), "slug-two").outcome, "held");
});

test("vigil sweep <slug> with a different --only, --daily or --all-projects exits 2", async () => {
  const wrongOnly = await runVigil(["sweep", "slug-one", "--only", "slug-two", "--json"]).catch((cause: unknown) => cause);
  assert.ok(wrongOnly instanceof UsageError);
  assert.match(wrongOnly.message, /different vigils/u);
  const daily = await runVigil(["sweep", "slug-one", "--daily"]).catch((cause: unknown) => cause);
  assert.ok(daily instanceof UsageError);
  assert.match(daily.message, /--daily or --all-projects/u);
  const all = await runVigil(["sweep", "slug-one", "--all-projects"]).catch((cause: unknown) => cause);
  assert.ok(all instanceof UsageError);
  assert.match(all.message, /--daily or --all-projects/u);
});

test("two parallel sweeps of one vigil write one vigil.closed", async () => {
  await addDue("parallel-close", "sleep 0.3; test 1 = 1");
  const opts = { includeHeavy: false, classifyOnly: false, dryRun: false, today: localToday(), only: "parallel-close" };
  const [first, second] = await Promise.all([sweepProject(openProject(PROJECT), opts), sweepProject(openProject(PROJECT), opts)]);
  assert.equal(lines("parallel-close", "vigil.closed").length, 1);
  const closed = [first, second].flatMap((result) => result.vigils).filter((vigil) => vigil.closed);
  assert.equal(closed.length, 1, "only the sweep that wrote the line reports closed");
});

interface ShownFailure {
  failKind: string;
  index: number;
  text: string;
  command?: string;
  expected?: string;
  source: string;
  exit: number | null;
  outputTail: string | null;
}

test("a failing vigil records command and expected, and show says why it is flagged", async () => {
  const command = "seq 1 25; echo 'no such file' >&2; exit 3";
  await addDue("why-flagged", command);
  await sweep(["why-flagged"]);
  const evidence = lines("why-flagged", "evidence")[0];
  assert.equal(evidence?.command, command);
  assert.equal(evidence?.expected, "exit 0");

  const text = await runVigil(["show", "why-flagged"]);
  assert.equal(text.code, 0, text.stderr);
  assert.match(text.stdout, /Why flagged\n {2}step 0: checks\n {2}Command: seq 1 25;/u);
  assert.match(text.stdout, /Expected: exit 0\n/u);
  assert.match(text.stdout, /fail, exit 3, /u);
  assert.doesNotMatch(text.stdout, /from the current body/u);
  assert.match(text.stdout, /\n {4}[^\n]*no such file$/mu);
  assert.ok(!text.stdout.includes("\u001b"), "control characters of the output are dropped");
  assert.doesNotMatch(text.stdout, /^ {4}6$/mu, "the tail keeps 20 of the 26 lines, so line 6 is cut");
  assert.match(text.stdout, /^ {4}7$/mu);

  const json = await runVigil(["show", "why-flagged", "--json"]);
  const shown: { lastFailure: ShownFailure | null } = JSON.parse(json.stdout);
  assert.equal(shown.lastFailure?.source, "evidence");
  assert.equal(shown.lastFailure?.exit, 3);
  assert.equal(shown.lastFailure?.command, command);
  assert.equal(shown.lastFailure?.outputTail?.split("\n").length, 20);
  assert.match(shown.lastFailure?.outputTail ?? "", /^7\n/u);
});

test("an old evidence line without command falls back to the body and says so", async () => {
  const body = checklist(execItem("the page loads", "curl -sf http://localhost/", "exit 0"));
  assert.equal((await runVigil(["add", "old-line", "--title", "old line", "--until", "someday", "--stdin"], body)).code, 0);
  const project = openProject(PROJECT);
  const item = itemRef("vigil", "old-line");
  appendLine(project, {
    who: "sweep",
    type: "evidence",
    item,
    check: `${item}#0`,
    exit: 22,
    outcome: "fail",
    output_sha: putBlob(project, "curl: (22) 404\n"),
    duration_ms: 12,
  });
  appendLine(project, { who: "sweep", type: "vigil.swept", item, outcome: "failed", gate: "n/a", checks: [{ index: 0, outcome: "fail", exit: 22 }] });

  const text = await runVigil(["show", "old-line"]);
  assert.match(text.stdout, /step 0: the page loads\n {2}Command: curl -sf http:\/\/localhost\/ \(from the current body/u);
  assert.match(text.stdout, /Expected: exit 0 \(from the current body/u);
  assert.match(text.stdout, /fail, exit 22, /u);
  assert.match(text.stdout, /\n {4}curl: \(22\) 404\n/u);

  const json = await runVigil(["show", "old-line", "--json"]);
  const shown: { lastFailure: ShownFailure | null } = JSON.parse(json.stdout);
  assert.equal(shown.lastFailure?.source, "body");
  assert.equal(shown.lastFailure?.command, "curl -sf http://localhost/");
  assert.equal(shown.lastFailure?.failKind, "unknown", "a line from before fail_kind reads unknown");
  assert.match(text.stdout, /\n {2}kind: unknown\n/u);
  assert.equal((await listedVigil("old-line"))?.failKind, "unknown");
});

test("lastFailure is null while the newest judged sweep did not fail", async () => {
  await addDue("no-failure", "test 1 = 1");
  await sweep(["no-failure"]);
  const body = checklist(execItem("checks", "test 1 = 1"));
  const ledger = linesFor(readLedger(openProject(PROJECT)), itemRef("vigil", "no-failure"));
  assert.equal(lastFailure("no-failure", ledger, body), null);
  const shown: { lastFailure: ShownFailure | null } = JSON.parse((await runVigil(["show", "no-failure", "--json"])).stdout);
  assert.equal(shown.lastFailure, null);
});

async function listedVigil(slug: string): Promise<{ flagged: boolean; failKind: string | null } | undefined> {
  const run = await runVigil(["list", "--all", "--json"]);
  const all: { slug: string; flagged: boolean; failKind: string | null }[] = JSON.parse(run.stdout);
  return all.find((vigil) => vigil.slug === slug);
}

test("a failed sweep records fail_kind: pending, broken or unknown, and list and show report it", async () => {
  const rows: [string, string, string | undefined, string][] = [
    ["kind-pending", "exit 1", "exit 1", "pending"],
    ["kind-wrong-pending", "exit 2", "exit 1", "broken"],
    ["kind-missing-tool", "no-such-tool-darius-probe", undefined, "broken"],
    ["kind-unknown", "exit 1", undefined, "unknown"],
  ];
  for (const [slug, command, pending, want] of rows) {
    const body = checklist(execItem("checks", command, "exit 0", pending));
    assert.equal((await runVigil(["add", slug, "--title", slug, "--due", yesterday(), "--stdin"], body)).code, 0);
    const swept = entry(await sweep([slug]), slug);
    assert.equal(swept.outcome, "failed");
    assert.equal(swept.flagged, true, "outcome and flagged stay as they were");
    assert.equal(swept.fail_kind, want, slug);
    const line = lines(slug, "vigil.swept")[0];
    assert.equal(line?.outcome, "failed");
    assert.equal(line?.fail_kind, want);
    assert.equal((await listedVigil(slug))?.failKind, want);
    const shown: { lastFailure: ShownFailure | null } = JSON.parse((await runVigil(["show", slug, "--json"])).stdout);
    assert.equal(shown.lastFailure?.failKind, want);
  }
});

test("a timeout is broken, one broken check makes the sweep broken, and a pass has no fail_kind", async () => {
  const body = checklist(execItem("waits", "exit 1", "exit 0", "exit 1"), execItem("hangs", "sleep 30"), execItem("fine", "test 1 = 1"));
  assert.equal((await runVigil(["add", "kind-mixed", "--title", "mixed", "--due", yesterday(), "--stdin"], body)).code, 0);
  const swept = entry(await sweep(["kind-mixed", "--timeout", "1"]), "kind-mixed");
  assert.deepEqual(swept.checks.map((check) => [check.outcome, check.fail_kind]), [["fail", "pending"], ["timeout", "broken"], ["pass", undefined]]);
  assert.equal(swept.fail_kind, "broken");
  assert.deepEqual(lines("kind-mixed", "vigil.swept")[0]?.checks, [
    { index: 0, outcome: "fail", exit: 1, fail_kind: "pending" },
    { index: 1, outcome: "timeout", exit: null, fail_kind: "broken" },
    { index: 2, outcome: "pass", exit: 0 },
  ]);
});

test("a held sweep has no fail_kind and list reports failKind null", async () => {
  await addDue("kind-held", "test 1 = 1");
  const swept = entry(await sweep(["kind-held"]), "kind-held");
  assert.equal(swept.fail_kind, undefined);
  assert.equal(lines("kind-held", "vigil.swept")[0]?.fail_kind, undefined);
  assert.equal((await listedVigil("kind-held"))?.failKind, null);
});

function tomorrow(): string {
  const now = new Date();
  now.setDate(now.getDate() + 1);
  return localToday(now);
}

test("a paused vigil lands in the paused bucket, runs nothing, and the skipped line names the reason", async () => {
  await addDue("pause-me", "test 1 = 1");
  const paused = await runVigil(["pause", "pause-me", "--reason", "vendor is down"]);
  assert.equal(paused.code, 0, paused.stderr);
  assert.match(paused.stdout, /paused vigil pause-me .*until resumed.*vendor is down/u);
  const result = await sweep(["pause-me"]);
  const swept = entry(result, "pause-me");
  assert.equal(swept.bucket, "paused");
  assert.equal(swept.outcome, "skipped");
  assert.equal(swept.reason, "paused: vendor is down");
  assert.equal(result.counts.paused, 1);
  assert.equal(lines("pause-me", "evidence").length, 0, "nothing ran");
  assert.equal(lines("pause-me", "vigil.closed").length, 0);
  const skipped = lines("pause-me", "vigil.swept");
  assert.deepEqual(skipped.map((line) => [line.outcome, line.reason]), [["skipped", "paused: vendor is down"]]);
  // A named sweep does not run it either, and the daily skipped line is not repeated.
  assert.equal(entry(await sweep(["pause-me"]), "pause-me").bucket, "paused");
  assert.equal(lines("pause-me", "vigil.swept").length, 1);
});

test("resume ends a pause: the next sweep runs the checks, and a second resume is a no-op", async () => {
  await addDue("resume-me", "test 1 = 1");
  assert.equal((await runVigil(["pause", "resume-me", "--reason", "wait"])).code, 0);
  assert.equal(entry(await sweep(["resume-me"]), "resume-me").bucket, "paused");
  const resumed = await runVigil(["resume", "resume-me"]);
  assert.equal(resumed.code, 0, resumed.stderr);
  assert.equal(lines("resume-me", "vigil.resumed").length, 1);
  assert.equal(entry(await sweep(["resume-me"]), "resume-me").outcome, "held");
  const again = await runVigil(["resume", "resume-me"]);
  assert.equal(again.code, 0);
  assert.match(again.stdout, /not paused/u);
  assert.equal(lines("resume-me", "vigil.resumed").length, 1);
});

test("a snooze covers its last local day and ends after it", async () => {
  const status = (until: string, today: string) => {
    const line = { v: 1, id: "x", at: new Date().toISOString(), host: "h", who: "w", project: PROJECT, type: "vigil.paused", item: "vigil/s", reason: "r", until };
    return vigilStatus("s", [line], today);
  };
  assert.equal(status("2026-10-20", "2026-10-19").paused, true);
  assert.equal(status("2026-10-20", "2026-10-20").paused, true, "still paused on its date");
  assert.equal(status("2026-10-20", "2026-10-21").paused, false, "over the day after");
  assert.equal(status("2026-10-20", "2026-10-21").pausedUntil, undefined);

  await addDue("snooze-over", "test 1 = 1");
  await addDue("snooze-open", "test 1 = 1");
  assert.equal((await runVigil(["pause", "snooze-over", "--until", yesterday(), "--reason", "short"])).code, 0);
  assert.equal((await runVigil(["pause", "snooze-open", "--until", localToday(), "--reason", "today"])).code, 0);
  assert.equal(entry(await sweep(["snooze-over"]), "snooze-over").outcome, "held", "the snooze ended on its own");
  const open = entry(await sweep(["snooze-open"]), "snooze-open");
  assert.equal(open.bucket, "paused");
  assert.equal(open.reason, `paused until ${localToday()}: today`);
  const rows: { slug: string; paused: boolean; pausedUntil: string | null }[] = JSON.parse((await runVigil(["list", "--all", "--json"])).stdout);
  assert.deepEqual(rows.filter((row) => row.slug === "snooze-open").map((row) => [row.paused, row.pausedUntil]), [[true, localToday()]]);
  assert.equal(await runVigil(["pause", "snooze-open", "--until", tomorrow(), "--reason", "longer"]).then((run) => run.code), 0);
  assert.equal(lines("snooze-open", "vigil.paused").length, 2, "a second pause replaces the first");
});

test("pause needs a reason and a real date, and refuses a closed or unknown vigil", async () => {
  await addDue("pause-guard", "test 1 = 1");
  await assert.rejects(runVigil(["pause", "pause-guard"]), UsageError);
  await assert.rejects(runVigil(["pause", "pause-guard", "--reason", "x", "--until", "next week"]), UsageError);
  await assert.rejects(runVigil(["pause", "no-such-vigil", "--reason", "x"]), /no vigil 'no-such-vigil'/u);
  assert.equal((await runVigil(["close", "pause-guard", "--verdict", "held", "--reason", "done"])).code, 0);
  await assert.rejects(runVigil(["pause", "pause-guard", "--reason", "x"]), /closed/u);
  assert.equal(lines("pause-guard", "vigil.paused").length, 0);
});

test("vigil close stores --reason on vigil.closed; without it a warning goes to stderr and the close works", async () => {
  await addDue("close-reason", "test 1 = 1");
  await addDue("close-bare", "test 1 = 1");
  const withReason = await runVigil(["close", "close-reason", "--verdict", "failed", "--reason", "the vendor dropped the line"]);
  assert.equal(withReason.code, 0, withReason.stderr);
  assert.equal(withReason.stderr, "");
  assert.equal(lines("close-reason", "vigil.closed")[0]?.reason, "the vendor dropped the line");
  assert.match((await runVigil(["show", "close-reason"])).stdout, /\nreason: the vendor dropped the line\n/u);

  const bare = await runVigil(["close", "close-bare", "--verdict", "held"]);
  assert.equal(bare.code, 0);
  assert.match(bare.stderr, /warning: vigil close without --reason/u);
  assert.equal(lines("close-bare", "vigil.closed").length, 1);
  assert.equal(lines("close-bare", "vigil.closed")[0]?.reason, undefined);
});

// --- one-vigil lease and cooldown ----------------------------------------------

function leaseFile(name: string): string {
  return join(openProject(PROJECT).root, "leases", name);
}

async function addFailing(slug: string): Promise<void> {
  await addDue(slug, "test 1 = 2");
}

test("a one-vigil sweep never writes the daily lease and releases its own", async () => {
  await addFailing("lease-free");
  assert.equal(entry(await sweep(["lease-free"]), "lease-free").outcome, "failed");
  assert.equal(existsSync(leaseFile(`sweep-${localToday()}.lock`)), false, "no daily lease");
  assert.equal(existsSync(leaseFile("vigil-lease-free.lock")), false, "the vigil lease is released");
});

test("a one-vigil sweep is refused while the daily sweep is held, and allowed once it is done", async () => {
  await addFailing("lease-daily");
  const project = openProject(PROJECT);
  const daily = await takeSweepLease(project, { s3: null, host: hostId(), today: localToday() });
  assert.ok("handle" in daily);
  const refused = await runVigil(["sweep", "lease-daily", "--json"]);
  assert.equal(refused.code, 1);
  assert.match(refused.stderr, /the daily sweep runs on /u);
  assert.equal(lines("lease-daily", "evidence").length, 0, "nothing ran");
  await daily.handle.finish();
  assert.equal((await runVigil(["sweep", "lease-daily", "--json"])).code, 0);
  assert.equal(lines("lease-daily", "evidence").length, 1);
});

test("a one-vigil sweep is refused while another check of the vigil holds the lease", async () => {
  await addFailing("lease-busy");
  const project = openProject(PROJECT);
  const held = await takeVigilSweepLease(project, { s3: null, host: hostId(), today: localToday(), slug: "lease-busy", ttlMs: 60_000 });
  assert.ok("handle" in held);
  const refused = await runVigil(["sweep", "lease-busy", "--json"]);
  assert.equal(refused.code, 1);
  assert.match(refused.stderr, /a check of 'lease-busy' is already running/u);
  assert.equal(lines("lease-busy", "evidence").length, 0);
  await held.handle.release();
  assert.equal((await runVigil(["sweep", "lease-busy", "--json"])).code, 0);
});

test("a second check of one vigil inside 2 minutes is refused, --force passes", async () => {
  await addFailing("cool-down");
  assert.equal((await runVigil(["sweep", "cool-down", "--json"])).code, 0);
  assert.equal(lines("cool-down", "evidence").length, 1);

  const refused = await runVigil(["sweep", "cool-down", "--json"]);
  assert.equal(refused.code, 1);
  assert.match(refused.stderr, /vigil 'cool-down' was swept less than 2 minutes ago; wait \d+ s or pass --force/u);
  assert.equal((await runVigil(["sweep", "--only", "cool-down"])).code, 1, "--only is the same sweep");
  assert.equal(lines("cool-down", "evidence").length, 1, "nothing ran");

  const forced = await runVigil(["sweep", "cool-down", "--force", "--json"]);
  assert.equal(forced.code, 0, forced.stderr);
  assert.equal(lines("cool-down", "evidence").length, 2);
  assert.equal(existsSync(leaseFile("vigil-cool-down.lock")), false);
});

test("--force needs a vigil, and a classify-only look is never on cooldown", async () => {
  await assert.rejects(runVigil(["sweep", "--force"]), UsageError);
  assert.equal((await runVigil(["sweep", "cool-down", "--classify-only", "--json"])).code, 0);
});

test("cooldownLeftMs counts from the newest sweep that ran something, not from a skipped line", () => {
  const swept = (at: string, outcome: string): LedgerLine => ({ v: 1, id: at, at, host: "h", who: "w", project: PROJECT, type: "vigil.swept", item: "vigil/s", outcome });
  const now = Date.parse("2026-10-13T10:00:00Z");
  assert.equal(cooldownLeftMs([], now), 0);
  assert.equal(cooldownLeftMs([swept("2026-10-13T09:59:00Z", "failed")], now), 60_000);
  assert.equal(cooldownLeftMs([swept("2026-10-13T09:57:59Z", "failed")], now), 0);
  assert.equal(cooldownLeftMs([swept("2026-10-13T09:59:30Z", "skipped")], now), 0, "a skipped line ran nothing");
  assert.equal(cooldownLeftMs([swept("2026-10-13T09:59:00Z", "failed"), swept("2026-10-13T09:59:50Z", "skipped")], now), 60_000);
});
