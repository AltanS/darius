/**
 * `darius run start|hold|answer|resume|complete|ack|list|now` — the Run
 * lifecycle (docs/concept.md, "Domain model": running -> held -> ... ->
 * complete | failed | abandoned). Every mutation is one more ledger line;
 * nothing about a run is stored anywhere else.
 *
 *   run start <ritual> [--who W]
 *                  prints what the previous run of the ritual passes on
 *                  (src/core/handoff.ts, 0.26.0) and the open findings of
 *                  the ritual (src/core/finding-index.ts, 0.62.0)
 *   run hold <run> --question Q [--question Q ...] [--who W] [--banner]
 *   run answer <run> <n> <text...>
 *   run complete <run> --outcome complete|failed|abandoned [--findings-stdin] [--who W] [--banner]
 *                  Both print the ghost sign-off (src/core/signoff.ts, 0.52.0)
 *                  after their output when DARIUS_RUN is the run, or with
 *                  --banner; never with --json.
 *                  The findings may end with one ```darius-result block
 *                  (src/core/result.ts); a run darius launched must hand one
 *                  in to complete, and an invalid block is refused.
 *   run ack <run> [--note TEXT] [--who W]                          (display only)
 *   run list [--open]
 *   run show <run>             the run's findings and its result block (0.24.0)
 *   run now <ritual> [--profile NAME] [--timeout S] [--dry-run]   (src/cli/run-due.ts)
 *   run resume <run> [--timeout S]                                (src/cli/run-due.ts)
 *   run follow-up <run> [--approve N] [--grant LINE] [--note T]   (src/cli/run-due.ts)
 *                  These three run on the ritual's host only, and refuse
 *                  elsewhere with the ssh command; `--on HOST` forwards
 *                  them over ssh (0.50.0).
 *
 * RUN IDENTITY. A run's id is a ULID minted with `ulid()` at `run start` and
 * carried as the `run` payload field on every ledger line about it,
 * including the `run.started` line itself — src/core/due.ts's `readRuns`
 * requires that field on all four `run.*` types it recognizes. It is NOT
 * necessarily the run.started line's own `id` field: `appendLine` mints that
 * `id` internally with one more `ulid()` call after the `run` value above was
 * minted, and `ulid()`'s per-millisecond counter makes the two differ by one
 * step. This mirrors the already-landed convention in src/core/import.ts's
 * `planRuns` (`const runId = ulid(startedMs);`, then a separate
 * `appendLines` write with that id as the `run` field) — read first-hand,
 * not reinvented here. Every lookup in this file keys off the `run` payload
 * field, never off `line.id`.
 *
 * CONCURRENCY. `run start` and `run complete` both read the ledger fresh and
 * append under `project.withLock`. Two processes racing on the same
 * project's `.lock` file serialize there: the loser re-reads a ledger that
 * already has the winner's line and refuses (exit 1) — an expected outcome
 * of the race, never a UsageError (exit 2, reserved for a caller mistake).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { appendLine, defaultWho, readLedger, type LedgerLineInput } from "../core/ledger.ts";
import { ritualState } from "../core/due.ts";
import { collectFindings, findingPromptLines, findingsSection } from "../core/finding-index.ts";
import { handoffLines, latestHandoff, type Handoff } from "../core/handoff.ts";
import type { JsonValue, LedgerLine, Ritual } from "../core/model.ts";
import { resolveProject } from "../core/paths.ts";
import { signoffBanner, type SignoffInput } from "../core/signoff.ts";
import { cutResult, FINDINGS_MAX, parseResult, readSummary, summarizeResult, type ResultSummary, type RunResult } from "../core/result.ts";
import { getBlobText, itemRef, openProject, putBlob, type Project } from "../core/store.ts";
import { ulid } from "../core/ulid.ts";
import { followUpOf } from "../runner/follow-up.ts";
import { acknowledgeRun, answerRun } from "../runner/hold.ts";
import { readStdin } from "./args.ts";
import { runFollowUp, runNow, runResume } from "./run-due.ts";
import { UsageError, type Command, type ParsedArgs } from "./registry.ts";

const VERBS = "start | hold | answer | resume | complete | ack | list | show | now | follow-up";
const OUTCOMES = ["complete", "failed", "abandoned"] as const;
type Outcome = (typeof OUTCOMES)[number];
type RunPhase = "running" | "held" | "closed";

function stringFlag(args: ParsedArgs, name: string): string | undefined {
  const value = args.flags[name];
  if (value === undefined || value === false) return undefined;
  if (value === true) throw new UsageError(`--${name} needs a value`);
  return value;
}

function requirePositional(args: ParsedArgs, index: number, label: string): string {
  const value = args.positional[index];
  if (value === undefined || value === "") throw new UsageError(`run: missing ${label}`);
  return value;
}

function currentProject(args: ParsedArgs): Project {
  return openProject(resolveProject(stringFlag(args, "project")));
}

function printJson<T>(value: T): void {
  console.log(JSON.stringify(value));
}

function isText(value: JsonValue | undefined): value is string {
  return typeof value === "string";
}

function runIdOf(line: LedgerLine): string | undefined {
  return isText(line.run) ? line.run : undefined;
}

/** Every ledger line carrying this run id (the started line included), in ledger order. */
function findRunLines(ledger: readonly LedgerLine[], runId: string): LedgerLine[] {
  return ledger.filter((line) => runIdOf(line) === runId);
}

function runItemRef(lines: readonly LedgerLine[]): string | undefined {
  return lines[0]?.item;
}

function currentPhase(lines: readonly LedgerLine[]): RunPhase | undefined {
  let phase: RunPhase | undefined;
  for (const line of lines) {
    if (line.type === "run.started" || line.type === "run.resumed") phase = "running";
    else if (line.type === "run.held") phase = "held";
    else if (line.type === "run.completed") phase = "closed";
  }
  return phase;
}

// --- start ------------------------------------------------------------------

type StartResult = { started: true; run: string; handoff: Handoff | null; findings: string[] } | { started: false; openRun: string };

function runStart(args: ParsedArgs): number {
  const slug = requirePositional(args, 1, "<ritual> slug");
  const project = currentProject(args);
  const doc = project.readItem<Ritual>("ritual", slug);
  if (doc === null) throw new UsageError(`no ritual '${slug}' in ${project.name}`);
  const who = stringFlag(args, "who") ?? defaultWho();

  const result = project.withLock((): StartResult => {
    const ledger = readLedger(project);
    const state = ritualState(doc, ledger, { now: new Date() });
    const openRun = state.heldRun ?? state.openRun;
    if (openRun !== undefined) return { started: false, openRun };
    const runId = ulid();
    appendLine(project, { who, type: "run.started", item: itemRef("ritual", slug), run: runId });
    const findings = findingPromptLines(collectFindings(project, ledger).filter((finding) => finding.ritual === slug));
    return { started: true, run: runId, handoff: latestHandoff(project, ledger, slug), findings };
  });

  if (!result.started) {
    if (args.json) printJson({ ok: false, ritual: slug, openRun: result.openRun });
    else console.log(`! ritual '${slug}' already has an open run (${result.openRun})`);
    return 1;
  }
  if (args.json) {
    printJson({ ok: true, ritual: slug, run: result.run, handoff: result.handoff });
    return 0;
  }
  console.log(`✓ started run ${result.run} for ritual '${slug}'`);
  if (result.handoff !== null) console.log(`\n${handoffLines(result.handoff).join("\n")}`);
  if (result.findings.length > 0) console.log(`\n${findingsSection(result.findings).join("\n")}`);
  return 0;
}

// --- hold ---------------------------------------------------------------------

/** `ritual/heartbeat` -> `heartbeat`. */
function ritualOf(item: string): string {
  return item.slice(item.indexOf("/") + 1);
}

/**
 * The sign-off block (src/core/signoff.ts, 0.52.0) goes to the run's own
 * session, and to a person who asks with --banner. Never into --json.
 */
function printBanner(args: ParsedArgs, project: Project, runId: string, facts: Omit<SignoffInput, "ritual" | "run" | "project" | "startedAt" | "followUpOf">): void {
  if (args.json) return;
  if (process.env.DARIUS_RUN !== runId && args.flags.banner !== true) return;
  const lines = findRunLines(readLedger(project), runId);
  const item = runItemRef(lines);
  if (item === undefined) return;
  const input: SignoffInput = { ...facts, ritual: ritualOf(item), run: runId, project: project.name };
  const started = lines[0]?.at;
  if (started !== undefined) input.startedAt = started;
  const parent = followUpOf(lines, runId);
  if (parent !== undefined) input.followUpOf = parent;
  console.log(signoffBanner(input));
}

function runHold(args: ParsedArgs): number {
  const runId = requirePositional(args, 1, "<run> id");
  const questions = args.repeated.question ?? [];
  if (questions.length === 0) throw new UsageError("run hold needs at least one --question");
  const project = currentProject(args);
  const lines = findRunLines(readLedger(project), runId);
  const item = runItemRef(lines);
  if (item === undefined) throw new UsageError(`no run '${runId}' in ${project.name}`);
  const phase = currentPhase(lines);
  if (phase !== "running") throw new UsageError(`run '${runId}' is not running (phase: ${phase ?? "unknown"})`);
  const who = stringFlag(args, "who") ?? defaultWho();
  appendLine(project, { who, type: "run.held", item, run: runId, questions: [...questions] });
  if (args.json) printJson({ ok: true, run: runId, questions });
  else console.log(`✓ held run ${runId} with ${String(questions.length)} question(s)`);
  printBanner(args, project, runId, { kind: "held", questions: questions.length });
  return 0;
}

// --- answer ---------------------------------------------------------------------

function runAnswer(args: ParsedArgs): number {
  const runId = requirePositional(args, 1, "<run> id");
  const nText = requirePositional(args, 2, "<n>");
  const n = Number.parseInt(nText, 10);
  if (!Number.isInteger(n) || n < 1 || String(n) !== nText) {
    throw new UsageError(`run answer: <n> must be a positive whole number, got '${nText}'`);
  }
  const text = args.positional.slice(3).join(" ");
  if (text.length === 0) throw new UsageError("run answer needs <text>");
  const who = stringFlag(args, "who") ?? defaultWho();
  const refused = answerRun(currentProject(args), { run: runId, n, text, who });
  if (refused !== undefined) throw new UsageError(refused);
  if (args.json) printJson({ ok: true, run: runId, n, text });
  else console.log(`✓ answered question ${String(n)} on run ${runId}`);
  return 0;
}

// --- complete ---------------------------------------------------------------------

function outcomeFlag(value: string | undefined): Outcome {
  const found = OUTCOMES.find((candidate) => candidate === value);
  if (found === undefined) {
    throw new UsageError(`run complete needs --outcome ${OUTCOMES.join("|")}, got '${value ?? ""}'`);
  }
  return found;
}

function isJsonRecord(value: JsonValue): value is { readonly [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** True when the run's policy.json on this host asks for a result block (every run darius launches). */
function resultRequired(project: Project, runId: string): boolean {
  const file = join(project.root, "runs", runId, "policy.json");
  if (!existsSync(file)) return false;
  try {
    const policy: JsonValue = JSON.parse(readFileSync(file, "utf8"));
    return isJsonRecord(policy) && policy.result === "required";
  } catch {
    return false;
  }
}

const MISSING_RESULT =
  "the findings must end with one ```darius-result block holding the result JSON (see Result in your system prompt)";

function tooLong(length: number): string {
  return `findings: at most ${String(FINDINGS_MAX)} characters, got ${String(length)}; the result block carries the facts, keep the prose to what it cannot say`;
}

/** What `run complete` stores, or why it refuses: the findings without the result block, and the checked result. */
type Intake = { findings?: string; result?: RunResult } | { errors: string[] };

/**
 * Reads the result block out of the findings. For `--outcome complete` a
 * block present must be valid, and a run darius launched must have one. A
 * failed or abandoned run is recorded whatever its block says: the failure
 * must not get lost over a format.
 */
function intakeFindings(findings: string | undefined, outcome: Outcome, isRequired: boolean): Intake {
  const strict = outcome === "complete";
  if (findings === undefined) return strict && isRequired ? { errors: [MISSING_RESULT] } : {};
  const cut = cutResult(findings);
  if ("error" in cut) return strict ? { errors: [cut.error] } : { findings };
  if (cut.block === null) {
    const length = cut.findings.trim().length;
    const errors = [...(isRequired ? [MISSING_RESULT] : []), ...(length > FINDINGS_MAX ? [tooLong(length)] : [])];
    return strict && errors.length > 0 ? { errors } : { findings };
  }
  const parsed = parseResult(cut.block);
  const length = cut.findings.trim().length;
  const errors = [...("errors" in parsed ? parsed.errors : []), ...(strict && length > FINDINGS_MAX ? [tooLong(length)] : [])];
  if (strict && errors.length > 0) return { errors };
  if ("errors" in parsed) return { findings };
  return { findings: cut.findings, result: parsed.result };
}

/** Keeps refused findings in the run dir, so they outlive a run that then runs out of turns. */
function keepRejected(project: Project, runId: string, findings: string): string {
  const dir = join(project.root, "runs", runId);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "findings-rejected.md");
  writeFileSync(file, findings);
  return file;
}

function summaryJson(summary: ResultSummary): JsonValue {
  const { open } = summary;
  return {
    status: summary.status,
    questions: summary.questions,
    open: { critical: open.critical, high: open.high, medium: open.medium, low: open.low, info: open.info },
    fixed: summary.fixed,
  };
}

function describeSummary(summary: ResultSummary, hasHandoff: boolean): string {
  const open = summary.open.critical + summary.open.high + summary.open.medium + summary.open.low + summary.open.info;
  const parts = [`result ${summary.status}`];
  if (summary.questions > 0) parts.push(`${String(summary.questions)} question(s) for the operator`);
  if (open > 0) parts.push(`${String(open)} open item(s)`);
  if (summary.fixed > 0) parts.push(`${String(summary.fixed)} fixed`);
  if (hasHandoff) parts.push("a note for the next run");
  return parts.join(", ");
}

function runComplete(args: ParsedArgs): number {
  const runId = requirePositional(args, 1, "<run> id");
  const outcome = outcomeFlag(stringFlag(args, "outcome"));
  const who = stringFlag(args, "who") ?? defaultWho();
  const findings = args.flags["findings-stdin"] === true ? (args.stdin ?? readStdin()) : undefined;
  const project = currentProject(args);

  const phase = currentPhase(findRunLines(readLedger(project), runId));
  if (phase !== undefined && phase !== "closed") {
    const intake = intakeFindings(findings, outcome, resultRequired(project, runId));
    if ("errors" in intake) return refuseFindings(args, { project, runId, findings: findings ?? "", errors: intake.errors });
    return appendCompletion(args, { project, runId, outcome, who, intake });
  }
  if (args.json) printJson({ ok: false, run: runId });
  else console.log(`! run '${runId}' is not open; nothing to complete`);
  return 1;
}

interface Refusal {
  project: Project;
  runId: string;
  findings: string;
  errors: string[];
}

/** Exit 1 with every problem, so the model fixes them all and runs the same command again. */
function refuseFindings(args: ParsedArgs, refusal: Refusal): number {
  const { project, runId, errors } = refusal;
  const kept = keepRejected(project, runId, refusal.findings);
  if (args.json) {
    printJson({ ok: false, run: runId, errors, rejected: kept });
    return 1;
  }
  console.log(`! darius refused the findings of run ${runId}: the run stays open.`);
  for (const error of errors) console.log(`  - ${error}`);
  console.log(`  Fix the findings and run the same command again. The findings you sent are in ${kept}.`);
  return 1;
}

interface Completion {
  project: Project;
  runId: string;
  outcome: Outcome;
  who: string;
  intake: { findings?: string; result?: RunResult };
}

function appendCompletion(args: ParsedArgs, completion: Completion): number {
  const { project, runId, outcome, who, intake } = completion;
  const summary = intake.result === undefined ? undefined : summarizeResult(intake.result);
  const completed = project.withLock((): boolean => {
    const lines = findRunLines(readLedger(project), runId);
    const item = runItemRef(lines);
    const phase = currentPhase(lines);
    if (item === undefined || phase === undefined || phase === "closed") return false;
    const findingsSha = intake.findings === undefined ? null : putBlob(project, intake.findings);
    const line: LedgerLineInput = { who, type: "run.completed", item, run: runId, outcome, findings_sha: findingsSha };
    if (intake.result !== undefined && summary !== undefined) {
      line.result_sha = putBlob(project, `${JSON.stringify(intake.result, null, 2)}\n`);
      line.result = summaryJson(summary);
      // The next run gets it from here, without a blob read (src/core/handoff.ts).
      if (intake.result.handoff !== undefined) line.handoff = intake.result.handoff;
    }
    appendLine(project, line);
    return true;
  });

  if (!completed) {
    if (args.json) printJson({ ok: false, run: runId });
    else console.log(`! run '${runId}' is not open; nothing to complete`);
    return 1;
  }
  if (args.json) printJson(summary === undefined ? { ok: true, run: runId, outcome } : { ok: true, run: runId, outcome, result: summaryJson(summary) });
  else console.log(`✓ completed run ${runId} (${outcome})${summary === undefined ? "" : `, ${describeSummary(summary, intake.result?.handoff !== undefined)}`}`);
  const facts: Parameters<typeof printBanner>[3] = { kind: "complete", outcome };
  if (summary !== undefined) facts.summary = summary;
  printBanner(args, project, runId, facts);
  return 0;
}

// --- ack ----------------------------------------------------------------------

/**
 * Marks a failed or abandoned run as seen (src/runner/hold.ts). The timer
 * still does not retry the ritual today. Exit 1 when the run is not failed
 * or abandoned, or already acknowledged; an unknown run is a usage error.
 */
function runAck(args: ParsedArgs): number {
  const runId = requirePositional(args, 1, "<run> id");
  const note = stringFlag(args, "note");
  const who = stringFlag(args, "who") ?? defaultWho();
  const result = acknowledgeRun(currentProject(args), { run: runId, who, note });
  if (!result.ok) {
    if (result.isUnknown) throw new UsageError(result.error);
    if (args.json) printJson({ ok: false, run: runId, error: result.error });
    else console.log(`! ${result.error}`);
    return 1;
  }
  if (args.json) printJson({ ok: true, run: runId, outcome: result.outcome, note: note === undefined || note === "" ? null : note });
  else console.log(`✓ acknowledged run ${runId} (${result.outcome})`);
  return 0;
}

// --- list ---------------------------------------------------------------------

interface RunRow {
  run: string;
  item: string;
  phase: RunPhase;
  outcome: string | null;
  startedAt: string;
  /** The counts of the run's result block; absent without one (0.22.0). */
  result?: ResultSummary;
  /** The run this one follows up (`run follow-up`, 0.47.0). */
  followUpOf?: string;
  /** The runs that follow this one up. */
  followUps?: string[];
}

function groupByRun(ledger: readonly LedgerLine[]): Map<string, LedgerLine[]> {
  const byRun = new Map<string, LedgerLine[]>();
  for (const line of ledger) {
    const run = runIdOf(line);
    if (run === undefined) continue;
    const lines = byRun.get(run);
    if (lines === undefined) byRun.set(run, [line]);
    else lines.push(line);
  }
  return byRun;
}

function outcomeField(line: LedgerLine): string | null {
  return isText(line.outcome) ? line.outcome : null;
}

function runRows(ledger: readonly LedgerLine[]): RunRow[] {
  const rows: RunRow[] = [];
  const children = new Map<string, string[]>();
  for (const line of ledger) {
    const child = runIdOf(line);
    if (line.type !== "run.started" || !isText(line.follow_up_of) || child === undefined) continue;
    children.set(line.follow_up_of, [...(children.get(line.follow_up_of) ?? []), child]);
  }
  for (const [run, lines] of groupByRun(ledger)) {
    const item = runItemRef(lines);
    const phase = currentPhase(lines);
    const first = lines[0];
    if (item === undefined || phase === undefined || first === undefined) continue;
    const completedLine = lines.findLast((line) => line.type === "run.completed");
    const row: RunRow = { run, item, phase, outcome: completedLine === undefined ? null : outcomeField(completedLine), startedAt: first.at };
    const result = readSummary(completedLine?.result);
    if (result !== null) row.result = result;
    const parent = followUpOf(lines, run);
    if (parent !== undefined) row.followUpOf = parent;
    const followUps = children.get(run);
    if (followUps !== undefined) row.followUps = followUps;
    rows.push(row);
  }
  return rows.toSorted((a, b) => (a.startedAt < b.startedAt ? -1 : a.startedAt > b.startedAt ? 1 : 0));
}

function runList(args: ParsedArgs): number {
  const project = currentProject(args);
  const openOnly = args.flags.open === true;
  const rows = runRows(readLedger(project)).filter((row) => !openOnly || row.phase !== "closed");
  if (args.json) {
    printJson({ project: project.name, runs: rows });
    return 0;
  }
  if (rows.length === 0) console.log("no runs");
  for (const row of rows) {
    const outcomeText = row.outcome === null ? "" : ` (${row.outcome})`;
    console.log(`${row.run}  ${row.item}  ${row.phase}${outcomeText}  started ${row.startedAt}${followUpTag(row, short)}`);
  }
  return 0;
}

/** The last six characters of a run id, as a herdr tab names the run. */
function short(run: string): string {
  return run.slice(-6).toLowerCase();
}

/** `  follow-up of <run>` on a follow-up, `  followed up by <run>` on its parent; empty for any other run. */
function followUpTag(row: RunRow, name: (run: string) => string): string {
  const tags: string[] = [];
  if (row.followUpOf !== undefined) tags.push(`follow-up of ${name(row.followUpOf)}`);
  if (row.followUps !== undefined) tags.push(`followed up by ${row.followUps.map(name).join(", ")}`);
  return tags.map((tag) => `  ${tag}`).join("");
}

// --- show -------------------------------------------------------------------------

/** The run's result block from its blob, checked again; null without one. */
function storedResult(project: Project, completed: LedgerLine | undefined): RunResult | null {
  const sha = completed?.result_sha;
  if (!isText(sha)) return null;
  const blob = getBlobText(project, sha);
  if (blob === null) return null;
  const parsed = parseResult(blob);
  return "result" in parsed ? parsed.result : null;
}

function describeResult(result: RunResult): string[] {
  const lines = [`Result: ${result.status}. ${result.summary}`];
  result.questions.forEach((question, index) => {
    const rec = question.recommendation === undefined ? "" : ` (recommended: ${question.recommendation})`;
    lines.push(`  question ${String(index + 1)}: ${question.text}${rec}`);
    for (const command of question.commands ?? []) lines.push(`    run: ${command}`);
  });
  for (const entry of result.items) {
    const where = [entry.group, entry.target].filter((part) => part !== undefined).join(", ");
    lines.push(`  ${entry.severity} ${entry.state}: ${entry.title}${where === "" ? "" : ` [${where}]`}${entry.key === undefined ? "" : ` {${entry.key}}`}`);
  }
  for (const act of result.actions) lines.push(`  action ${act.state}: ${act.text}${act.target === undefined ? "" : ` [${act.target}]`}`);
  if (result.handoff !== undefined) lines.push(`  note for the next run: ${result.handoff}`);
  return lines;
}

/**
 * Prints one run: its facts, its findings markdown and its result block.
 * A later run reads earlier ones this way (the fact check's carry-over), and
 * so can a person or a session, without looking up blob paths.
 */
function runShow(args: ParsedArgs): number {
  const runId = requirePositional(args, 1, "<run> id");
  const project = currentProject(args);
  const ledger = readLedger(project);
  const lines = findRunLines(ledger, runId);
  const row = runRows(ledger).find((candidate) => candidate.run === runId);
  if (row === undefined) throw new UsageError(`no run '${runId}' in ${project.name}`);
  const completed = lines.findLast((line) => line.type === "run.completed");
  const sha = completed?.findings_sha;
  const findings = isText(sha) ? getBlobText(project, sha) : null;
  const result = storedResult(project, completed);
  const skillHash = lines.find((line) => line.type === "run.started")?.skill_hash;
  if (args.json) {
    printJson({ project: project.name, ...row, skill_hash: isText(skillHash) ? skillHash : undefined, findings, result });
    return 0;
  }
  const outcome = row.outcome === null ? "" : ` (${row.outcome})`;
  console.log(`${row.run}  ${row.item}  ${row.phase}${outcome}  started ${row.startedAt}${followUpTag(row, (run) => run)}`);
  if (isText(skillHash)) console.log(`skill hash ${skillHash.slice(0, 12)}`);
  if (result !== null) for (const line of describeResult(result)) console.log(line);
  console.log(findings === null ? "no findings" : `\n${findings.trimEnd()}`);
  return 0;
}

// --- dispatch ---------------------------------------------------------------------

export const runCommand: Command = {
  name: "run",
  summary: "start, hold, answer, resume, complete, acknowledge, list and show ritual runs",
  audience: "session",
  usage: `run ${VERBS.replaceAll(" | ", "|")}`,
  async run(args: ParsedArgs): Promise<number> {
    const verb = args.positional[0];
    switch (verb) {
      case "start":
        return runStart(args);
      case "hold":
        return runHold(args);
      case "answer":
        return runAnswer(args);
      case "complete":
        return runComplete(args);
      case "ack":
        return runAck(args);
      case "list":
        return runList(args);
      case "show":
        return runShow(args);
      case "now":
        return runNow(args);
      case "resume":
        return runResume(args);
      case "follow-up":
        return runFollowUp(args);
      default:
        throw new UsageError(`run needs a verb: ${VERBS}`);
    }
  },
};
