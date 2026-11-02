/**
 * A vigil that lights a candle (0.110.0): `vigil add|set --in --candle`, the sweep
 * that lights `vigil:<slug>` on a failure and blows it out on a held close, and
 * `candle accept` that closes the vigil. Every test runs in a throwaway state
 * dir with no push keys, so a flush leaves `alert.failed` lines and sends
 * nothing. Each check costs about 0.5 s (`bash -lc`).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseArgs } from "../src/cli/args.ts";
import { candleCommand } from "../src/cli/candle.ts";
import { vigilCommand } from "../src/cli/vigil.ts";
import { collectCandles, candleOpenings, type Candle } from "../src/core/candle-index.ts";
import { appendLine, linesFor, readLedger } from "../src/core/ledger.ts";
import { UsageError, type LedgerLine, type Vigil } from "../src/core/model.ts";
import { dueFromIn } from "../src/core/relative-date.ts";
import { itemRef, openProject } from "../src/core/store.ts";
import { localToday, vigilStatus, type SweepResult, type SweptVigil } from "../src/core/sweep.ts";

const BIN = join(import.meta.dirname, "..", "bin", "darius");
const SANDBOX = mkdtempSync(join(tmpdir(), "darius-candle-vigil-"));
process.env.DARIUS_STATE_DIR = join(SANDBOX, "state");
process.env.DARIUS_CONFIG_DIR = join(SANDBOX, "config");
mkdirSync(process.env.DARIUS_STATE_DIR, { recursive: true });
mkdirSync(process.env.DARIUS_CONFIG_DIR, { recursive: true });
delete process.env.DARIUS_RUN;
delete process.env.DARIUS_RUN_POLICY;
delete process.env.DARIUS_PROJECT;
delete process.env.DARIUS_SWEEP_ACTIVE;

interface CliRun {
  code: number;
  stdout: string;
  stderr: string;
}

async function capture(run: () => Promise<number>): Promise<CliRun> {
  const out: string[] = [];
  const err: string[] = [];
  const { log, error } = console;
  console.log = (...parts: string[]) => out.push(parts.join(" "));
  console.error = (...parts: string[]) => err.push(parts.join(" "));
  try {
    const code = await run();
    return { code, stdout: out.join("\n"), stderr: err.join("\n") };
  } finally {
    console.log = log;
    console.error = error;
  }
}

async function vigil(project: string, argv: string[], stdin?: string): Promise<CliRun> {
  const args = parseArgs([...argv, "--project", project], vigilCommand.flags);
  if (stdin !== undefined) args.stdin = stdin;
  return capture(() => vigilCommand.run(args));
}

async function candle(project: string, argv: string[]): Promise<CliRun> {
  return capture(() => candleCommand.run(parseArgs([...argv, "--project", project], candleCommand.flags)));
}

function fresh(name: string): string {
  openProject(name, { create: true });
  return name;
}

function checklist(command: string): string {
  return `# checks\n\n## Verification Checklist\n\n- [ ] it holds\n  - Command: \`${command}\`\n  - Expected: \`exit 0\`\n`;
}

function yesterday(): string {
  const now = new Date();
  now.setDate(now.getDate() - 1);
  return localToday(now);
}

/** A marker file the check looks for: the check passes once the file exists. */
function marker(project: string, slug: string): string {
  return join(SANDBOX, `marker-${project}-${slug}`);
}

async function addCandleVigil(project: string, slug: string, flags: string[], command = `test -f ${marker(project, slug)}`): Promise<void> {
  const run = await vigil(project, ["add", slug, "--title", `Vigil ${slug}`, ...flags, "--stdin"], checklist(command));
  assert.equal(run.code, 0, run.stderr);
}

async function sweep(project: string, extra: string[] = []): Promise<SweepResult> {
  const run = await vigil(project, ["sweep", "--json", ...extra]);
  assert.equal(run.code, 0, run.stderr);
  const result: SweepResult = JSON.parse(run.stdout);
  return result;
}

function entry(result: SweepResult, slug: string): SweptVigil {
  const found = result.vigils.find((candidate) => candidate.slug === slug);
  assert.ok(found, `no ${slug} in the sweep result`);
  return found;
}

function lines(project: string, type: string): LedgerLine[] {
  return readLedger(openProject(project)).filter((line) => line.type === type);
}

function candleOf(project: string, key: string): Candle | undefined {
  return collectCandles(openProject(project)).find((candidate) => candidate.key === key);
}

function header(project: string, slug: string): Vigil {
  const doc = openProject(project).readItem<Vigil>("vigil", slug);
  assert.ok(doc, `no vigil ${slug}`);
  return doc.header;
}

function statusOf(project: string, slug: string): ReturnType<typeof vigilStatus> {
  return vigilStatus(slug, linesFor(readLedger(openProject(project)), itemRef("vigil", slug)));
}

// --- --in -------------------------------------------------------------------------------

test("--in counts days, weeks and months from today, and a month end does not overflow", () => {
  assert.equal(dueFromIn("7d", "2026-11-01"), "2026-11-08");
  assert.equal(dueFromIn("2w", "2026-11-01"), "2026-11-15");
  assert.equal(dueFromIn("1m", "2026-11-01"), "2026-12-01");
  assert.equal(dueFromIn("2m", "2026-11-30"), "2027-01-30");
  assert.equal(dueFromIn("1m", "2026-01-31"), "2026-02-28");
  assert.equal(dueFromIn("1m", "2028-01-31"), "2028-02-29");
  assert.equal(dueFromIn("3d", "2026-12-30"), "2027-01-02");
  for (const bad of ["", "7", "d", "0d", "-1d", "7y", "1.5d", "7 d", "99999d"]) {
    assert.throws(() => dueFromIn(bad, "2026-11-01"), UsageError, `'${bad}'`);
  }
});

test("vigil add --in stores the due date, not the phrase, and --in cannot combine with --due", async () => {
  const project = fresh("fv-in");
  const add = await vigil(project, ["add", "soon", "--in", "7d", "--stdin"], checklist("test 1 = 1"));
  assert.equal(add.code, 0, add.stderr);
  assert.equal(header(project, "soon").due, dueFromIn("7d", localToday()));
  assert.doesNotMatch(readFileSync(join(SANDBOX, "state", project, "items", "vigils", "soon.md"), "utf8"), /^in:/mu);

  const both = await vigil(project, ["add", "both", "--in", "7d", "--due", "2027-01-01", "--stdin"], checklist("test 1 = 1")).catch((cause: unknown) => cause);
  assert.ok(both instanceof UsageError);
  assert.match(both.message, /--due and --in exclude each other/u);
  assert.equal(openProject(project).readItem("vigil", "both"), null);

  const set = await vigil(project, ["set", "soon", "--in", "2w"]);
  assert.equal(set.code, 0, set.stderr);
  assert.equal(header(project, "soon").due, dueFromIn("2w", localToday()));
  const setBoth = await vigil(project, ["set", "soon", "--in", "2w", "--due", "2027-01-01"]).catch((cause: unknown) => cause);
  assert.ok(setBoth instanceof UsageError);
});

// --- the flags on the item --------------------------------------------------------------

test("candle and candle_deliver are absent from the item when not set, and set, changed and dropped by the verbs", async () => {
  const project = fresh("fv-item");
  const file = join(SANDBOX, "state", project, "items", "vigils", "plain.md");
  await addCandleVigil(project, "plain", ["--due", yesterday()]);
  assert.doesNotMatch(readFileSync(file, "utf8"), /^candle/mu, "no key without the flag");

  const set = await vigil(project, ["set", "plain", "--candle", "high", "--candle-deliver", "push,email"]);
  assert.equal(set.code, 0, set.stderr);
  assert.match(set.stdout, /candle=high, candle_deliver=push,email/u);
  assert.equal(header(project, "plain").candle, "high");
  assert.deepEqual(header(project, "plain").candle_deliver, ["push", "email"]);

  assert.equal((await vigil(project, ["set", "plain", "--candle-deliver", "none"])).code, 0);
  assert.deepEqual(header(project, "plain").candle_deliver, [], "none is the app only");
  assert.match(readFileSync(file, "utf8"), /^candle_deliver/mu);

  const show = await vigil(project, ["show", "plain"]);
  assert.match(show.stdout, /^candle: high, deliver: none, the app only$/mu);
  const shown: { header: Vigil } = JSON.parse((await vigil(project, ["show", "plain", "--json"])).stdout);
  assert.equal(shown.header.candle, "high");

  const dropped = await vigil(project, ["set", "plain", "--no-candle"]);
  assert.equal(dropped.code, 0, dropped.stderr);
  assert.doesNotMatch(readFileSync(file, "utf8"), /^candle/mu, "--no-candle removes both keys");
  assert.equal(header(project, "plain").candle, undefined);

  const mixed = await vigil(project, ["set", "plain", "--no-candle", "--candle", "low"]).catch((cause: unknown) => cause);
  assert.ok(mixed instanceof UsageError);
  const orphan = await vigil(project, ["set", "plain", "--candle-deliver", "push"]).catch((cause: unknown) => cause);
  assert.ok(orphan instanceof UsageError, "deliver needs a candle");
});

/** One record of `vigil list --json`, read only for the keys it holds. */
interface ListRow {
  slug: string;
  name: string;
  due: string | null;
  until: string | null;
  from: string | null;
  agent: string | null;
  opened: string | null;
  resolved: string | null;
  verdict: string | null;
  path: string;
}

test("vigil list --json keeps its fields when a vigil has a candle", async () => {
  const project = fresh("fv-list");
  await addCandleVigil(project, "listed", ["--due", yesterday(), "--candle", "high"]);
  const rows: ListRow[] = JSON.parse((await vigil(project, ["list", "--json"])).stdout);
  const [row] = rows;
  for (const key of ["slug", "name", "due", "until", "from", "agent", "opened", "resolved", "verdict", "path"]) {
    assert.ok(row !== undefined && key in row, `the legacy field ${key} stays`);
  }
});

test("--candle is refused on a vigil that only waits on an event, with the reason", async () => {
  const project = fresh("fv-until");
  const add = await vigil(project, ["add", "waiting", "--until", "the batch lands", "--candle", "high", "--stdin"], checklist("test 1 = 1")).catch((cause: unknown) => cause);
  assert.ok(add instanceof UsageError);
  assert.match(add.message, /no date and no gate command, so its checks never fail/u);
  assert.equal(openProject(project).readItem("vigil", "waiting"), null, "nothing is written");

  assert.equal((await vigil(project, ["add", "waiting", "--until", "the batch lands", "--stdin"], checklist("test 1 = 1"))).code, 0);
  const set = await vigil(project, ["set", "waiting", "--candle", "high"]).catch((cause: unknown) => cause);
  assert.ok(set instanceof UsageError);
  assert.equal(header(project, "waiting").candle, undefined);

  // A date or a gate command makes it legal.
  assert.equal((await vigil(project, ["set", "waiting", "--candle", "high", "--in", "7d"])).code, 0);
  assert.equal(header(project, "waiting").candle, "high");
  assert.equal((await vigil(project, ["add", "gated", "--until", "x", "--gate-command", "test 1 = 1", "--candle", "low", "--stdin"], checklist("test 1 = 1"))).code, 0);
});

test("the candle key must pass the key rules: a slug that makes it too long is refused", async () => {
  const project = fresh("fv-key");
  const slug = "a".repeat(120);
  const add = await vigil(project, ["add", slug, "--due", yesterday(), "--candle", "high", "--stdin"], checklist("test 1 = 1")).catch((cause: unknown) => cause);
  assert.ok(add instanceof UsageError);
  assert.match(add.message, /vigil:a+' is at most 120 characters, got 126/u);
  const wrong = await vigil(project, ["add", "x", "--due", yesterday(), "--candle", "urgent", "--stdin"], checklist("test 1 = 1")).catch((cause: unknown) => cause);
  assert.ok(wrong instanceof UsageError);
  const channel = await vigil(project, ["add", "x", "--due", yesterday(), "--candle", "high", "--candle-deliver", "sms", "--stdin"], checklist("test 1 = 1")).catch((cause: unknown) => cause);
  assert.ok(channel instanceof UsageError);
  const orphan = await vigil(project, ["add", "x", "--due", yesterday(), "--candle-deliver", "push", "--stdin"], checklist("test 1 = 1")).catch((cause: unknown) => cause);
  assert.ok(orphan instanceof UsageError);
});

// --- the sweep lights -------------------------------------------------------------------

test("a failed sweep lights vigil:<slug> with the title, severity, source, deliver and a target, and flushes its project", async () => {
  const project = fresh("fv-light");
  await addCandleVigil(project, "guard", ["--due", yesterday(), "--candle", "high", "--candle-deliver", "push,email"]);
  const result = await sweep(project);
  const swept = entry(result, "guard");
  assert.deepEqual([swept.outcome, swept.flagged, swept.candleLit], ["failed", true, true]);

  const [lit, ...more] = lines(project, "candle.lit");
  assert.equal(more.length, 0);
  assert.equal(lit?.key, "vigil:guard");
  assert.equal(lit?.title, "Vigil guard");
  assert.equal(lit?.severity, "high");
  assert.equal(lit?.source, "vigil:guard");
  assert.deepEqual(lit?.deliver, ["push", "email"]);
  assert.match(String(lit?.target), /^A check (is still pending|could not run|failed), step 1: it holds$/u, "the kind of failure in words and the failing step, counted from one");

  const found = candleOf(project, "vigil:guard");
  assert.equal(found?.status, "lit");
  assert.equal(found?.source, "vigil:guard");
  assert.equal(statusOf(project, "guard").state, "open", "the vigil stays armed");

  const litId = lit?.id ?? "";
  const traces = lines(project, "alert.failed").map((line) => line.key);
  assert.ok(traces.includes(`line:${litId}:push`), "the sweep flushed this project: no push keys, so one trace");
});

test("deliver is left off the line when the vigil names none", async () => {
  const project = fresh("fv-nodeliver");
  await addCandleVigil(project, "plain", ["--due", yesterday(), "--candle", "low"]);
  await sweep(project);
  assert.equal(lines(project, "candle.lit")[0]?.deliver, undefined);
});

test("a dry run and a classify-only sweep light nothing and flush nothing", async () => {
  const project = fresh("fv-dry");
  await addCandleVigil(project, "guard", ["--due", yesterday(), "--candle", "high"]);
  const classified = await sweep(project, ["--classify-only"]);
  assert.equal(entry(classified, "guard").candleLit, undefined);
  const dry = await sweep(project, ["--dry-run"]);
  assert.equal(entry(dry, "guard").outcome, "failed", "the dry run did run the check");
  assert.equal(entry(dry, "guard").candleLit, undefined);
  assert.equal(lines(project, "candle.lit").length, 0);
  assert.equal(lines(project, "alert.failed").length, 0);
});

test("skipped, pending, finding and awaiting-manual outcomes light nothing", async () => {
  const project = fresh("fv-quiet");
  const manual = "- [ ] a person looks\n  - Expected: `manual (owner: owner, expires: 2027-01-01)`";
  const mixed = `${checklist("test 1 = 1")}${manual}\n`;
  await addCandleVigil(project, "heavy-one", ["--due", yesterday(), "--candle", "high", "--heavy"], "test 1 = 1");
  await addCandleVigil(project, "not-yet", ["--in", "7d", "--until", "the day comes", "--candle", "high"]);
  assert.equal((await vigil(project, ["add", "mixed-one", "--due", yesterday(), "--candle", "high", "--stdin"], mixed)).code, 0);
  await addCandleVigil(project, "paused-one", ["--due", yesterday(), "--candle", "high"]);
  assert.equal((await vigil(project, ["pause", "paused-one", "--reason", "away"])).code, 0);

  const result = await sweep(project);
  assert.equal(entry(result, "heavy-one").outcome, "skipped");
  assert.equal(entry(result, "not-yet").outcome, "pending");
  assert.equal(entry(result, "mixed-one").outcome, "awaiting-manual");
  assert.equal(entry(result, "paused-one").outcome, "skipped");
  assert.equal(result.vigils.filter((swept) => swept.candleLit === true).length, 0);
  assert.equal(lines(project, "candle.lit").length, 0);
  assert.equal(lines(project, "alert.failed").length, 0, "no candle lit, so no flush");
});

test("a vigil without a candle lights nothing when it fails", async () => {
  const project = fresh("fv-none");
  await addCandleVigil(project, "plain", ["--due", yesterday()]);
  const result = await sweep(project);
  assert.equal(entry(result, "plain").outcome, "failed");
  assert.equal(lines(project, "candle.lit").length, 0);
});

test("a daily repeat is one more report with no new notice", async () => {
  const project = fresh("fv-repeat");
  await addCandleVigil(project, "guard", ["--due", yesterday(), "--candle", "high"]);
  await sweep(project);
  await sweep(project);
  assert.equal(lines(project, "candle.lit").length, 2);
  const found = candleOf(project, "vigil:guard");
  assert.equal(found?.reports, 2);
  assert.equal(found?.status, "lit");
  const ledger = readLedger(openProject(project));
  assert.equal(candleOpenings(openProject(project), ledger).length, 1, "only the first line opened the candle");
  const keys = lines(project, "alert.failed").map((line) => line.key);
  assert.ok(keys.length > 0);
  assert.ok(keys.every((key) => key === `line:${lines(project, "candle.lit")[0]?.id ?? ""}:push`), "no notice for the second line");
});

test("a sweep flushes only the project it swept", async () => {
  const swept = fresh("fv-own");
  const other = fresh("fv-other");
  appendLine(openProject(other), { who: "t", type: "candle.lit", key: "elsewhere", title: "Elsewhere", severity: "high", source: "ci" });
  await addCandleVigil(swept, "guard", ["--due", yesterday(), "--candle", "high"]);
  await sweep(swept);
  assert.ok(lines(swept, "alert.failed").length > 0);
  assert.equal(lines(other, "alert.failed").length, 0, "the other project was left alone");
});

// --- the blow-out --------------------------------------------------------------------------

test("a passing sweep closes the vigil held and blows out its candle, inside the close", async () => {
  const project = fresh("fv-blow-out");
  await addCandleVigil(project, "guard", ["--due", yesterday(), "--candle", "high"]);
  await sweep(project);
  assert.equal(candleOf(project, "vigil:guard")?.status, "lit");

  writeFileSync(marker(project, "guard"), "");
  const second = await sweep(project);
  assert.deepEqual([entry(second, "guard").outcome, entry(second, "guard").closed], ["held", true]);
  const [blownOut, ...more] = lines(project, "candle.blown-out");
  assert.equal(more.length, 0);
  assert.equal(blownOut?.key, "vigil:guard");
  assert.equal(candleOf(project, "vigil:guard")?.status, "out");
  const ledger = readLedger(openProject(project));
  const closedAt = ledger.findIndex((line) => line.type === "vigil.closed");
  assert.equal(ledger.findIndex((line) => line.type === "candle.blown-out"), closedAt + 1, "the blow-out follows the close");
});

test("a vigil that never failed and closes held writes no candle.blown-out", async () => {
  const project = fresh("fv-never");
  writeFileSync(marker(project, "calm"), "");
  await addCandleVigil(project, "calm", ["--due", yesterday(), "--candle", "high"]);
  const result = await sweep(project);
  assert.equal(entry(result, "calm").closed, true);
  assert.equal(lines(project, "candle.blown-out").length, 0);
  assert.equal(lines(project, "candle.lit").length, 0);
});

test("a vigil without a candle setting writes no candle.blown-out on a held close either", async () => {
  const project = fresh("fv-plain-close");
  writeFileSync(marker(project, "plain"), "");
  await addCandleVigil(project, "plain", ["--due", yesterday()]);
  await sweep(project);
  assert.equal(lines(project, "candle.blown-out").length, 0);
});

test("vigil close --verdict held by a person blows out the candle; --verdict failed leaves it open", async () => {
  const project = fresh("fv-person");
  await addCandleVigil(project, "held-by-hand", ["--due", yesterday(), "--candle", "high"]);
  await addCandleVigil(project, "failed-by-hand", ["--due", yesterday(), "--candle", "high"]);
  await sweep(project);
  assert.equal(candleOf(project, "vigil:held-by-hand")?.status, "lit");

  const failed = await vigil(project, ["close", "failed-by-hand", "--verdict", "failed", "--reason", "it broke"]);
  assert.equal(failed.code, 0, failed.stderr);
  assert.equal(candleOf(project, "vigil:failed-by-hand")?.status, "lit", "a failed close leaves the candle to a person");
  assert.equal(lines(project, "candle.blown-out").length, 0);

  const held = await vigil(project, ["close", "held-by-hand", "--verdict", "held", "--reason", "checked by hand"]);
  assert.equal(held.code, 0, held.stderr);
  assert.equal(candleOf(project, "vigil:held-by-hand")?.status, "out");
  assert.equal(lines(project, "candle.blown-out").length, 1);
});

test("candle blow-out on an armed vigil relights at the next sweep", async () => {
  const project = fresh("fv-relight");
  await addCandleVigil(project, "guard", ["--due", yesterday(), "--candle", "high"]);
  await sweep(project);
  assert.equal((await candle(project, ["blow-out", "vigil:guard"])).code, 0);
  assert.equal(candleOf(project, "vigil:guard")?.status, "out");
  await sweep(project);
  assert.equal(candleOf(project, "vigil:guard")?.status, "lit");
});

// --- accept and answer ------------------------------------------------------------------

test("candle accept closes the vigil as failed, by candle, and the accept line comes first", async () => {
  const project = fresh("fv-accept");
  await addCandleVigil(project, "guard", ["--due", yesterday(), "--candle", "high"]);
  await sweep(project);
  const accept = await candle(project, ["accept", "vigil:guard", "--note", "known"]);
  assert.equal(accept.code, 0, accept.stderr);
  assert.match(accept.stdout, /closed vigil 'guard' as failed/u);

  const ledger = readLedger(openProject(project));
  const accepted = ledger.findIndex((line) => line.type === "candle.accepted");
  const closed = ledger.findIndex((line) => line.type === "vigil.closed");
  assert.ok(accepted >= 0 && closed > accepted, "accept first, then the close");
  assert.equal(ledger[closed]?.verdict, "failed");
  assert.equal(ledger[closed]?.by, "candle");
  assert.equal(statusOf(project, "guard").state, "closed");
  assert.equal(candleOf(project, "vigil:guard")?.status, "accepted");

  const json = await candle(project, ["accept", "vigil:guard", "--json"]);
  assert.equal(json.code, 1, "a second accept is refused, as before");
});

test("candle accept reports the vigil in --json", async () => {
  const project = fresh("fv-accept-json");
  await addCandleVigil(project, "guard", ["--due", yesterday(), "--candle", "high"]);
  await sweep(project);
  const accept = await candle(project, ["accept", "vigil:guard", "--json"]);
  assert.deepEqual(JSON.parse(accept.stdout), { ok: true, project, key: "vigil:guard", vigil: "guard", vigilClose: "closed" });
});

test("candle answer keeps the vigil armed", async () => {
  const project = fresh("fv-answer");
  await addCandleVigil(project, "guard", ["--due", yesterday(), "--candle", "high"]);
  await sweep(project);
  const answer = await candle(project, ["answer", "vigil:guard", "--note", "looking into it"]);
  assert.equal(answer.code, 0, answer.stderr);
  assert.equal(candleOf(project, "vigil:guard")?.status, "answered");
  assert.equal(statusOf(project, "guard").state, "open");
  assert.equal(lines(project, "vigil.closed").length, 0);

  // It keeps watching: a pass closes it and blows out the candle.
  writeFileSync(marker(project, "guard"), "");
  await sweep(project, ["--only", "guard", "--force"]);
  assert.equal(statusOf(project, "guard").state, "closed");
  assert.equal(candleOf(project, "vigil:guard")?.status, "out");
});

test("candle accept tolerates a vigil that is already closed", async () => {
  const project = fresh("fv-accept-closed");
  await addCandleVigil(project, "guard", ["--due", yesterday(), "--candle", "high"]);
  await sweep(project);
  assert.equal((await vigil(project, ["close", "guard", "--verdict", "failed", "--reason", "by hand"])).code, 0);
  const accept = await candle(project, ["accept", "vigil:guard"]);
  assert.equal(accept.code, 0, accept.stderr);
  assert.equal(accept.stderr, "");
  assert.equal(lines(project, "vigil.closed").length, 1, "no second close");
  assert.equal(candleOf(project, "vigil:guard")?.status, "accepted");
});

test("candle accept tolerates a vigil that is gone", async () => {
  const project = fresh("fv-accept-gone");
  await addCandleVigil(project, "guard", ["--due", yesterday(), "--candle", "high"]);
  await sweep(project);
  rmSync(join(SANDBOX, "state", project, "items", "vigils", "guard.md"));
  const accept = await candle(project, ["accept", "vigil:guard"]);
  assert.equal(accept.code, 0, accept.stderr);
  assert.equal(lines(project, "vigil.closed").length, 0);
});

test("candle accept closes no vigil when the newest report did not come from the vigil", async () => {
  const project = fresh("fv-accept-other");
  await addCandleVigil(project, "guard", ["--due", yesterday()]);
  appendLine(openProject(project), { who: "t", type: "candle.lit", key: "vigil:guard", title: "By a script", severity: "high", source: "ci:nightly" });
  const accept = await candle(project, ["accept", "vigil:guard"]);
  assert.equal(accept.code, 0, accept.stderr);
  assert.equal(statusOf(project, "guard").state, "open", "the source is a script, not the vigil");

  appendLine(openProject(project), { who: "t", type: "candle.lit", key: "plain-key", title: "Plain", severity: "high", source: "cli" });
  assert.equal((await candle(project, ["accept", "plain-key"])).code, 0);
  assert.equal(lines(project, "vigil.closed").length, 0);
});

test("when the vigil cannot be closed the accept stays on record, and stderr says so", async () => {
  const project = fresh("fv-accept-broken");
  await addCandleVigil(project, "guard", ["--due", yesterday(), "--candle", "high"]);
  await sweep(project);
  const file = join(SANDBOX, "state", project, "items", "vigils", "guard.md");
  writeFileSync(file, readFileSync(file, "utf8").replace("heavy:", "bogus: 1\nheavy:"));
  const accept = await candle(project, ["accept", "vigil:guard"]);
  assert.equal(accept.code, 1);
  assert.match(accept.stderr, /candle 'vigil:guard' is accepted and stays accepted, but vigil 'guard' was not closed/u);
  assert.match(accept.stderr, /darius vigil close guard --verdict failed/u);
  assert.equal(lines(project, "candle.accepted").length, 1);
  assert.equal(candleOf(project, "vigil:guard")?.status, "accepted");
});

// --- the legacy route -------------------------------------------------------------------

test("the legacy route refuses the new flags and drops none of them", () => {
  const repo = join(SANDBOX, "repos", "legacy-repo");
  mkdirSync(repo, { recursive: true });
  writeFileSync(join(repo, ".darius.toml"), 'v = 3\nproject = "legacy-repo"\ntz = "Europe/Berlin"\nkinds = ["ritual"]\n');
  const env = { ...process.env };
  const run = (argv: string[]) => spawnSync(BIN, argv, { cwd: repo, env, encoding: "utf8", input: checklist("test 1 = 1"), timeout: 30_000 });

  const flag = run(["vigil", "add", "x", "--due", "2027-01-01", "--candle", "high", "--stdin"]);
  assert.equal(flag.status, 2, flag.stderr);
  assert.match(flag.stderr, /unknown option --candle/u);

  const span = run(["vigil", "add", "x", "--in", "7d", "--stdin"]);
  assert.equal(span.status, 2, span.stderr);
  assert.match(span.stderr, /unknown option --in/u);

  const set = run(["vigil", "set", "x", "--candle", "high"]);
  assert.equal(set.status, 2, set.stderr);
});
