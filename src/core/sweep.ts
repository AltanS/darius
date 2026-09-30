/**
 * Vigils: adding one, closing one, reading its status, and the daily sweep
 * that runs its checks (docs/concept.md, "Vigil auto-execution").
 *
 * The sweep rules are ported from the legacy vigil sweep script it replaced, where they were
 * measured on 60 real vigils. Read `docs/concept.md` before changing a rule.
 * The rules that matter most:
 *
 * - The sweep auto-closes `held` only. A failing check stays armed and is
 *   flagged, because a machine cannot tell a shut precondition from a broken
 *   guard (djinn `WouldFailEntry`, the m309 time-band vigil).
 * - An event-gated vigil is never closed on a coincidence. Without a
 *   `gate_command`, all checks passing is a FINDING for the operator. With
 *   one, exit 0 means the event fired and the vigil is due from then on; any
 *   other exit, or a timeout, means "not yet" and is never a failure.
 * - A vigil with executable checks AND an unanswered manual item stays armed
 *   as `awaiting-manual`: a `held` close would claim more than was measured.
 * - Heavy Commands are opt-in (`--include-heavy`).
 * - A sweep refuses to start inside another sweep. `DARIUS_SWEEP_ACTIVE` is
 *   set on every child, so a Command that reaches the sweep by any route
 *   stops at depth 1. On 2026-09-03 a self-invoking vigil reached 14 levels
 *   and load 61. `addVigil` also refuses a self-invoking Command at write
 *   time, and the sweep refuses to run one.
 * - `today` is the host's LOCAL date, never UTC.
 * - `classifyOnly` executes nothing and writes nothing. `dryRun` executes
 *   every Command and writes evidence and `vigil.swept`, but never
 *   `vigil.closed`.
 *
 * Evidence and outcomes are ledger lines, never edits of the vigil file:
 * `evidence{check,exit,outcome,output_sha,duration_ms}` per executed check
 * (output tail stored as a blob), `vigil.swept{outcome,checks[],gate}` per
 * vigil, `vigil.closed{verdict,by}` on a close.
 *
 * One guard beyond djinn: the old tracker's trailing-pipe rule (tracker
 * `lib/verification/runner.ts`, M347/04). A Command whose last stage is a
 * `| head`, `| wc -l` or similar filter, paired with `Expected: exit N`, can
 * never fail, because the shell reports the filter's status. Such a check is
 * never run and never counts as passing. It is reported as `masked`, which
 * keeps its vigil from closing, and the reason names the filter.
 */

import { spawnSync } from "node:child_process";

import {
  classifyCommand,
  parseChecklist,
  parseExpectation,
  runCheck,
  splitShellStages,
  stageFirstToken,
  type Check,
} from "./checks.ts";
import { appendLine, linesFor, readLedger } from "./ledger.ts";
import { UsageError, type Document, type JsonValue, type LedgerLine, type Vigil } from "./model.ts";
import { itemRef, putBlob, type Project } from "./store.ts";
import { ulid } from "./ulid.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SweepBucket =
  | "closed"
  | "no-command"
  | "manual-only"
  | "mixed"
  | "heavy"
  | "event-gated"
  | "date-gated"
  | "runnable";

export type GateState = "n/a" | "fired" | "not-fired";

/**
 * `held`, `failed`, `awaiting-manual` and `skipped` are the contract's four.
 * Two more cover the event gate without a `gate_command` (djinn's
 * `eventGatedPassing` / `eventGatedPending`): `finding` (every check passed
 * before the awaited event was confirmed, never a close) and `pending` (not
 * every check passed yet, never a failure).
 */
export type SweepOutcome = "held" | "failed" | "awaiting-manual" | "skipped" | "finding" | "pending";

/**
 * `pass`, `fail`, `timeout`: the check ran. The rest never ran:
 * `manual` is an operator decision, `noop` a shell no-op, `unparsable` an
 * Expected the grammar rejects (or none), `masked` an exit assertion taken by
 * a trailing filter.
 */
export type SweptCheckOutcome = "pass" | "fail" | "timeout" | "manual" | "noop" | "unparsable" | "masked";

export interface SweptCheck {
  index: number;
  text: string;
  outcome: SweptCheckOutcome;
  exit: number | null;
  reason?: string;
  output_sha?: string;
  duration_ms?: number;
}

export interface SweptVigil {
  slug: string;
  bucket: SweepBucket;
  gate: GateState;
  outcome?: SweepOutcome;
  closed: boolean;
  /** Swept `failed` and left armed: the operator must look. */
  flagged: boolean;
  reason?: string;
  checks: SweptCheck[];
}

export interface SweepError {
  slug: string;
  message: string;
}

/** How many vigils landed in each bucket. */
export interface BucketCounts {
  closed: number;
  "no-command": number;
  "manual-only": number;
  mixed: number;
  heavy: number;
  "event-gated": number;
  "date-gated": number;
  runnable: number;
}

export interface SweepResult {
  project: string;
  date: string;
  /** Where the Commands ran. */
  cwd: string;
  dryRun: boolean;
  classifyOnly: boolean;
  vigils: SweptVigil[];
  counts: BucketCounts;
  errors: SweepError[];
}

export interface SweepOptions {
  includeHeavy: boolean;
  classifyOnly: boolean;
  dryRun: boolean;
  /** Local `YYYY-MM-DD`. */
  today: string;
  /** Sweep one vigil only. */
  only?: string;
  /** Per Command, gate included. Default 120 s. */
  timeoutMs?: number;
  /** The `who` of every line written. Default `sweep`. */
  who?: string;
  /**
   * Where Commands run. The CLI passes the project's working dir on this
   * host (src/core/workdir.ts): its linked checkout, so a Command such as
   * `cd app && ...` works. Default the project's store dir.
   */
  cwd?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const SWEEP_ACTIVE_ENV = "DARIUS_SWEEP_ACTIVE";
export const DEFAULT_SWEEP_TIMEOUT_MS = 120_000;
const DEFAULT_SWEEP_WHO = "sweep";

/** Matched on the verb pair, so a wrapper or another runner still trips it. */
const SELF_INVOCATION_RE = /\bvigil\s+sweep\b|\bfc\s+vigil-sweep\b/u;

/** Too expensive to run unattended every day (djinn `HEAVY_COMMAND_PATTERNS`). */
const HEAVY_COMMAND_PATTERNS: readonly { pattern: RegExp; label: string }[] = [
  { pattern: /\btoolbox\s+run\b/u, label: "toolbox run" },
  { pattern: /\beval-/u, label: "eval-" },
  { pattern: /--runs\b/u, label: "--runs" },
  { pattern: /\bfc\s+discover\b/u, label: "fc discover" },
  { pattern: /\bfc\s+check\b/u, label: "fc check" },
];

/** Filters that exit 0 whatever reached them (tracker `EXIT_MASKING_FILTERS`). */
const EXIT_MASKING_FILTERS: ReadonlySet<string> = new Set([
  "head",
  "tail",
  "sort",
  "uniq",
  "cut",
  "sed",
  "tr",
  "awk",
  "column",
  "wc",
]);

/** `set -o pipefail` or `${PIPESTATUS[..]}`: the author thought about the pipeline status. */
const PIPE_STATUS_OPT_IN_RE = /\bpipefail\b|\bPIPESTATUS\b/u;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/u;

// ---------------------------------------------------------------------------
// Small pure helpers
// ---------------------------------------------------------------------------

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** `YYYY-MM-DD` in the host's local zone. */
export function localToday(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

function isText(value: JsonValue | undefined): value is string {
  return typeof value === "string";
}

/** True when a Command would start another sweep. */
export function invokesSweep(command: string): boolean {
  return SELF_INVOCATION_RE.test(command);
}

/** The heavy markers present in a Command, or an empty array. */
export function heavyMarkers(command: string): string[] {
  return HEAVY_COMMAND_PATTERNS.filter((heavy) => heavy.pattern.test(command)).map((heavy) => heavy.label);
}

/**
 * The trailing `|` stage that takes the Command's exit status, or null when
 * the Command's own status survives. Only the last stage counts, and only
 * when a single `|` introduced it: `a && head -1` still reports `a`.
 * `| xargs` is transparent (it reports its child's failure) unless it runs a
 * masking filter or `-r` lets it run nothing.
 */
export function trailingPipeFilter(command: string): string | null {
  if (PIPE_STATUS_OPT_IN_RE.test(command)) return null;
  const stages = splitShellStages(command);
  const last = stages.at(-1);
  if (last === undefined || stages.length < 2) return null;
  const before = command.slice(0, command.lastIndexOf(last)).trimEnd();
  if (!before.endsWith("|") || before.endsWith("||")) return null;
  const token = stageFirstToken(last);
  if (token === "xargs") return xargsMasks(last) ? "xargs" : null;
  return EXIT_MASKING_FILTERS.has(token) ? token : null;
}

/** `xargs` flags that take a separate value, so the next token is not the child command. */
const XARGS_VALUE_FLAGS: ReadonlySet<string> = new Set([
  "-a", "-d", "-E", "-e", "-I", "-i", "-L", "-l", "-n", "-P", "-s",
  "--arg-file", "--delimiter", "--eof", "--replace", "--max-args", "--max-chars", "--max-lines", "--max-procs",
]);

/** `-r` runs nothing on empty input and exits 0; a bare `xargs` runs `echo`. Both mask. */
function xargsMasks(stage: string): boolean {
  const tokens = stage.trim().split(/\s+/u).slice(1);
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i] ?? "";
    if (!token.startsWith("-")) return EXIT_MASKING_FILTERS.has(token);
    if (token === "-r" || token === "--no-run-if-empty") return true;
    if (XARGS_VALUE_FLAGS.has(token)) i++;
  }
  return true;
}

/** Throws when this process runs inside a sweep. The CLI maps it to exit 1. */
export function assertNotNested(): void {
  const depth = process.env[SWEEP_ACTIVE_ENV];
  if (depth === undefined || depth === "") return;
  throw new Error(
    `refusing to sweep: ${SWEEP_ACTIVE_ENV}=${depth} is set, so a vigil Command started this sweep. ` +
      "Rewrite that vigil to read a sweep artefact instead of running the sweep.",
  );
}

// ---------------------------------------------------------------------------
// Check classification (pure)
// ---------------------------------------------------------------------------

type ClassifiedCheck =
  | { kind: "exec"; check: Check }
  | { kind: "unanswered"; check: Check; outcome: Exclude<SweptCheckOutcome, "pass" | "fail" | "timeout">; reason: string };

/**
 * What a check IS, without running it. Null for a prose item with no
 * Command and no manual Expected: djinn ignores those, and so does darius.
 * A manual Expected counts with or without a Command.
 */
function classifyCheck(check: Check): ClassifiedCheck | null {
  if (check.manual !== undefined) {
    const reason = `operator decision (owner: ${check.manual.owner || "?"}, expires: ${check.manual.expires || "?"})`;
    return { kind: "unanswered", check, outcome: "manual", reason };
  }
  const commandClass = classifyCommand(check.command);
  if (commandClass === "none") return null;
  if (check.expected === undefined || check.expected.trim() === "") {
    return { kind: "unanswered", check, outcome: "unparsable", reason: "the Command has no Expected clause" };
  }
  if (commandClass === "noop") {
    return { kind: "unanswered", check, outcome: "noop", reason: "the Command is a shell no-op, running it proves nothing" };
  }
  const parsed = parseExpectation(check.expected);
  if ("error" in parsed) return { kind: "unanswered", check, outcome: "unparsable", reason: parsed.error };
  const filter = parsed.kind === "exit" ? trailingPipeFilter(check.command ?? "") : null;
  if (filter !== null) {
    const reason =
      `the exit status is taken by the trailing \`| ${filter}\`, which exits 0 whatever reached it; ` +
      "assert on the output, drop the filter, or opt in with `set -o pipefail`";
    return { kind: "unanswered", check, outcome: "masked", reason };
  }
  return { kind: "exec", check };
}

type GateKind = "date-due" | "event" | "date" | "ungated";

/**
 * Which gate governs the vigil today. A passed `due` wins; before it passes,
 * `until` is the live gate (djinn `classifyGate`). `date` is a future `due`
 * with no `until`, which the contract names `date-gated`.
 */
function gateKind(vigil: Vigil, today: string): GateKind {
  const due = vigil.due?.trim() ?? "";
  const until = vigil.until?.trim() ?? "";
  if (due !== "" && due <= today) return "date-due";
  if (until !== "") return "event";
  if (due !== "") return "date";
  return "ungated";
}

function toSwept(classified: ClassifiedCheck): SweptCheck {
  const { check } = classified;
  if (classified.kind === "exec") return { index: check.index, text: check.text, outcome: "pass", exit: null };
  return { index: check.index, text: check.text, outcome: classified.outcome, exit: null, reason: classified.reason };
}

// ---------------------------------------------------------------------------
// Ledger reads
// ---------------------------------------------------------------------------

export interface VigilStatus {
  slug: string;
  state: "open" | "closed";
  verdict?: string;
  closedBy?: string;
  closedAt?: string;
  /** The latest `vigil.swept` line. */
  lastSwept?: LedgerLine;
  /** The latest sweep that reached a verdict-like outcome. */
  lastOutcome?: string;
  flagged: boolean;
  gateFired: boolean;
}

const JUDGED_OUTCOMES: ReadonlySet<string> = new Set(["held", "failed", "awaiting-manual", "finding", "pending"]);

/** Status computed from the ledger lines of one vigil (`linesFor(ledger, "vigil/<slug>")`). */
export function vigilStatus(slug: string, lines: readonly LedgerLine[]): VigilStatus {
  const closedLine = lines.findLast((line) => line.type === "vigil.closed");
  const swept = lines.filter((line) => line.type === "vigil.swept");
  const judged = swept.findLast((line) => isText(line.outcome) && JUDGED_OUTCOMES.has(line.outcome));
  const lastOutcome = judged !== undefined && isText(judged.outcome) ? judged.outcome : undefined;
  const status: VigilStatus = {
    slug,
    state: closedLine === undefined ? "open" : "closed",
    flagged: closedLine === undefined && lastOutcome === "failed",
    gateFired: swept.some((line) => line.gate === "fired"),
  };
  if (closedLine !== undefined) {
    if (isText(closedLine.verdict)) status.verdict = closedLine.verdict;
    if (isText(closedLine.by)) status.closedBy = closedLine.by;
    status.closedAt = closedLine.at;
  }
  const lastSwept = swept.at(-1);
  if (lastSwept !== undefined) status.lastSwept = lastSwept;
  if (lastOutcome !== undefined) status.lastOutcome = lastOutcome;
  return status;
}

/** The latest `evidence` line per check of one vigil, by check index. */
export function latestEvidence(slug: string, lines: readonly LedgerLine[]): Map<number, LedgerLine> {
  const prefix = `${itemRef("vigil", slug)}#`;
  const latest = new Map<number, LedgerLine>();
  for (const line of lines) {
    if (line.type !== "evidence" || !isText(line.check) || !line.check.startsWith(prefix)) continue;
    latest.set(Number(line.check.slice(prefix.length)), line);
  }
  return latest;
}

function localDateOf(iso: string): string {
  return localToday(new Date(iso));
}

// ---------------------------------------------------------------------------
// Add and close
// ---------------------------------------------------------------------------

export interface VigilInput {
  slug: string;
  title: string;
  body: string;
  due?: string;
  until?: string;
  gate_command?: string;
  heavy: boolean;
  from?: string;
  who: string;
}

function assertIsoDate(value: string | undefined, flag: string): void {
  if (value === undefined || ISO_DATE_RE.test(value)) return;
  throw new UsageError(`${flag} must be a date as YYYY-MM-DD, got '${value}'`);
}

/** Every Command a vigil would run: its checks and its gate. */
function commandsOf(body: string, gateCommand: string | undefined): string[] {
  const commands = parseChecklist(body).flatMap((check) => (check.command === undefined ? [] : [check.command]));
  if (gateCommand !== undefined) commands.push(gateCommand);
  return commands;
}

/**
 * Writes a new vigil. Refuses (throws) when the slug exists or a Command would
 * start a sweep; a bad date or an empty title is a UsageError.
 */
export function addVigil(project: Project, input: VigilInput): Document<Vigil> {
  if (input.title.trim() === "") throw new UsageError("a vigil needs --title");
  assertIsoDate(input.due, "--due");
  const selfInvoking = commandsOf(input.body, input.gate_command).find(invokesSweep);
  if (selfInvoking !== undefined) {
    throw new Error(`refusing vigil '${input.slug}': its Command starts a sweep (${selfInvoking})`);
  }
  if (project.readItem("vigil", input.slug) !== null) {
    throw new Error(`vigil '${input.slug}' already exists in ${project.name}`);
  }
  const now = new Date().toISOString();
  const header: Vigil = {
    id: ulid(),
    kind: "vigil",
    slug: input.slug,
    title: input.title,
    created: now,
    updated: now,
    tags: [],
    heavy: input.heavy,
  };
  if (input.from !== undefined) header.from = input.from;
  if (input.due !== undefined) header.due = input.due;
  if (input.until !== undefined) header.until = input.until;
  if (input.gate_command !== undefined) header.gate_command = input.gate_command;
  const doc: Document<Vigil> = { header, body: input.body };
  project.writeItem(doc, { who: input.who });
  return doc;
}

export interface CloseInput {
  slug: string;
  verdict: "held" | "failed";
  by: string;
  who: string;
}

/** Appends `vigil.closed`. Refuses (throws) a missing or already closed vigil. */
export function closeVigil(project: Project, input: CloseInput): LedgerLine {
  if (project.readItem("vigil", input.slug) === null) {
    throw new Error(`no vigil '${input.slug}' in ${project.name}`);
  }
  return project.withLock(() => {
    const status = vigilStatus(input.slug, linesFor(readLedger(project), itemRef("vigil", input.slug)));
    if (status.state === "closed") {
      throw new Error(`vigil '${input.slug}' is already closed ${status.verdict ?? ""}`.trimEnd());
    }
    return appendLine(project, {
      who: input.who,
      type: "vigil.closed",
      item: itemRef("vigil", input.slug),
      verdict: input.verdict,
      by: input.by,
    });
  });
}

// ---------------------------------------------------------------------------
// Sweep
// ---------------------------------------------------------------------------

interface SweepContext {
  project: Project;
  ledger: LedgerLine[];
  opts: SweepOptions;
  who: string;
  cwd: string;
  timeoutMs: number;
}

/** What the gate command did, carried on the `vigil.swept` line. */
interface GateFields {
  gate_exit: number | null;
  gate_duration_ms: number;
  gate_output_sha: string;
}

interface VigilPlan {
  doc: Document<Vigil>;
  lines: LedgerLine[];
  ref: string;
  classified: ClassifiedCheck[];
  execs: Check[];
  unanswered: number;
}

function emptyCounts(): BucketCounts {
  return {
    closed: 0,
    "no-command": 0,
    "manual-only": 0,
    mixed: 0,
    heavy: 0,
    "event-gated": 0,
    "date-gated": 0,
    runnable: 0,
  };
}

/**
 * Sweeps every vigil of one project (or `opts.only`). Never throws for a
 * single vigil: a broken item lands in `errors` and the sweep goes on.
 * Throws when run inside another sweep.
 */
export async function sweepProject(project: Project, opts: SweepOptions): Promise<SweepResult> {
  assertNotNested();
  const ctx: SweepContext = {
    project,
    ledger: readLedger(project),
    opts,
    who: opts.who ?? DEFAULT_SWEEP_WHO,
    cwd: opts.cwd ?? project.root,
    timeoutMs: opts.timeoutMs ?? DEFAULT_SWEEP_TIMEOUT_MS,
  };
  const result: SweepResult = {
    project: project.name,
    date: opts.today,
    cwd: ctx.cwd,
    dryRun: opts.dryRun,
    classifyOnly: opts.classifyOnly,
    vigils: [],
    counts: emptyCounts(),
    errors: [],
  };
  const slugs = project.listItems("vigil").filter((slug) => opts.only === undefined || slug === opts.only);
  if (opts.only !== undefined && slugs.length === 0) {
    result.errors.push({ slug: opts.only, message: "no vigil with this slug" });
  }
  for (const slug of slugs) {
    try {
      const swept = await sweepVigil(ctx, slug);
      result.vigils.push(swept);
      result.counts[swept.bucket] += 1;
    } catch (cause) {
      result.errors.push({ slug, message: cause instanceof Error ? cause.message : String(cause) });
    }
  }
  return result;
}

function planVigil(ctx: SweepContext, slug: string): VigilPlan {
  const doc = ctx.project.readItem<Vigil>("vigil", slug);
  if (doc === null) throw new Error(`vigil file for '${slug}' vanished during the sweep`);
  const ref = itemRef("vigil", slug);
  const classified = parseChecklist(doc.body).flatMap((check) => {
    const one = classifyCheck(check);
    return one === null ? [] : [one];
  });
  const execs = classified.flatMap((one) => (one.kind === "exec" ? [one.check] : []));
  return { doc, lines: linesFor(ctx.ledger, ref), ref, classified, execs, unanswered: classified.length - execs.length };
}

function report(plan: VigilPlan, fields: Omit<SweptVigil, "slug" | "checks" | "flagged"> & { checks?: SweptCheck[] }): SweptVigil {
  const checks = fields.checks ?? plan.classified.map(toSwept).filter((check) => check.reason !== undefined);
  return { ...fields, slug: plan.doc.header.slug, checks, flagged: fields.outcome === "failed" && !fields.closed };
}

async function sweepVigil(ctx: SweepContext, slug: string): Promise<SweptVigil> {
  const plan = planVigil(ctx, slug);
  const status = vigilStatus(slug, plan.lines);
  if (status.state === "closed") return report(plan, { bucket: "closed", gate: "n/a", closed: true, checks: [] });

  const header = plan.doc.header;
  const selfInvoking = commandsOf(plan.doc.body, header.gate_command).find(invokesSweep);
  if (selfInvoking !== undefined) return skip(ctx, plan, "no-command", `invokes the sweep: ${selfInvoking}`);

  if (plan.execs.length === 0) {
    const isManualOnly = plan.classified.length > 0 && plan.classified.every((one) => one.kind === "unanswered" && one.outcome === "manual");
    const reason = plan.classified.length === 0 ? "no Command in the checklist" : "no executable check";
    return skip(ctx, plan, isManualOnly ? "manual-only" : "no-command", reason);
  }

  const heavy = heavyReason(header, plan.execs);
  if (heavy !== null && !ctx.opts.includeHeavy) return skip(ctx, plan, "heavy", heavy);

  const kind = gateKind(header, ctx.opts.today);
  if (kind === "date-due" || kind === "ungated") return sweepDue(ctx, plan, "n/a");
  if (status.gateFired) return sweepDue(ctx, plan, "fired");
  if (header.gate_command === undefined) return sweepEvent(ctx, plan, kind === "event" ? "event-gated" : "date-gated");
  return sweepGate(ctx, plan, kind === "event" ? "event-gated" : "date-gated");
}

function heavyReason(header: Vigil, execs: readonly Check[]): string | null {
  if (header.heavy) return "heavy: true";
  const commands = execs.map((check) => check.command ?? "");
  if (header.gate_command !== undefined) commands.push(header.gate_command);
  for (const command of commands) {
    const markers = heavyMarkers(command);
    if (markers.length > 0) return `heavy command (${markers.join(", ")}): ${command}`;
  }
  return null;
}

/** Reported, nothing runs. Writes one `swept{outcome:"skipped"}` line per local day. */
function skip(ctx: SweepContext, plan: VigilPlan, bucket: SweepBucket, reason: string): SweptVigil {
  const swept = report(plan, { bucket, gate: "n/a", outcome: "skipped", closed: false, reason });
  if (ctx.opts.classifyOnly) return swept;
  const isWrittenToday = plan.lines.some(
    (line) => line.type === "vigil.swept" && line.outcome === "skipped" && localDateOf(line.at) === ctx.opts.today,
  );
  if (!isWrittenToday) writeSwept(ctx, plan, swept);
  return swept;
}

/** Event or date gate WITH a gate_command: run it; exit 0 fires, anything else is "not yet". */
async function sweepGate(ctx: SweepContext, plan: VigilPlan, bucket: SweepBucket): Promise<SweptVigil> {
  const notFired = report(plan, { bucket, gate: "not-fired", closed: false, checks: [] });
  if (ctx.opts.classifyOnly) return notFired;
  const gateCheck: Check = { index: -1, text: "gate", command: plan.doc.header.gate_command ?? "", expected: "exit 0" };
  const run = await runCheck(gateCheck, { cwd: ctx.cwd, timeoutMs: ctx.timeoutMs, env: { [SWEEP_ACTIVE_ENV]: "1" } });
  const gateFields: GateFields = {
    gate_exit: run.exit,
    gate_duration_ms: run.durationMs,
    gate_output_sha: putBlob(ctx.project, run.output),
  };
  if (run.outcome !== "pass") {
    writeSwept(ctx, plan, notFired, gateFields);
    return notFired;
  }
  return sweepDue(ctx, plan, "fired", gateFields);
}

/** Event or date gate WITHOUT a gate_command: checks run, all-pass is a finding, never a close. */
async function sweepEvent(ctx: SweepContext, plan: VigilPlan, bucket: SweepBucket): Promise<SweptVigil> {
  if (ctx.opts.classifyOnly) return report(plan, { bucket, gate: "n/a", closed: false });
  const checks = await executeChecks(ctx, plan);
  const isAllPass = checks.every((check) => check.outcome === "pass" || check.reason !== undefined);
  const outcome: SweepOutcome = isAllPass && plan.unanswered === 0 ? "finding" : "pending";
  const swept = report(plan, { bucket, gate: "n/a", outcome, closed: false, checks });
  writeSwept(ctx, plan, swept);
  return swept;
}

/** The gate allows execution: a verdict is owed today. */
async function sweepDue(
  ctx: SweepContext,
  plan: VigilPlan,
  gate: GateState,
  gateFields?: GateFields,
): Promise<SweptVigil> {
  const bucket: SweepBucket = plan.unanswered > 0 ? "mixed" : "runnable";
  if (ctx.opts.classifyOnly) return report(plan, { bucket, gate, closed: false });
  const checks = await executeChecks(ctx, plan);
  const isAnyBad = checks.some((check) => check.outcome === "fail" || check.outcome === "timeout");
  let outcome: SweepOutcome = "held";
  if (isAnyBad) outcome = "failed";
  else if (plan.unanswered > 0) outcome = "awaiting-manual";
  const willClose = outcome === "held" && !ctx.opts.dryRun;
  const swept = report(plan, { bucket, gate, outcome, closed: willClose, checks });
  writeSwept(ctx, plan, swept, gateFields);
  if (willClose) {
    appendLine(ctx.project, { who: ctx.who, type: "vigil.closed", item: plan.ref, verdict: "held", by: "sweep" });
  }
  return swept;
}

/** Runs every executable check in order and writes one `evidence` line each. Unanswered items ride along unrun. */
async function executeChecks(ctx: SweepContext, plan: VigilPlan): Promise<SweptCheck[]> {
  const results: SweptCheck[] = [];
  for (const one of plan.classified) {
    if (one.kind === "unanswered") {
      results.push(toSwept(one));
      continue;
    }
    const run = await runCheck(one.check, { cwd: ctx.cwd, timeoutMs: ctx.timeoutMs, env: { [SWEEP_ACTIVE_ENV]: "1" } });
    const outputSha = putBlob(ctx.project, run.output);
    appendLine(ctx.project, {
      who: ctx.who,
      type: "evidence",
      item: plan.ref,
      check: `${plan.ref}#${one.check.index}`,
      exit: run.exit,
      outcome: run.outcome,
      output_sha: outputSha,
      duration_ms: run.durationMs,
    });
    results.push({
      index: one.check.index,
      text: one.check.text,
      outcome: run.outcome,
      exit: run.exit,
      output_sha: outputSha,
      duration_ms: run.durationMs,
    });
  }
  return results;
}

function writeSwept(
  ctx: SweepContext,
  plan: VigilPlan,
  swept: SweptVigil,
  gateFields?: GateFields,
): void {
  const checks = swept.checks.map((check) => ({ index: check.index, outcome: check.outcome, exit: check.exit }));
  appendLine(ctx.project, {
    gate_exit: gateFields?.gate_exit,
    gate_duration_ms: gateFields?.gate_duration_ms,
    gate_output_sha: gateFields?.gate_output_sha,
    who: ctx.who,
    type: "vigil.swept",
    item: plan.ref,
    outcome: swept.outcome,
    gate: swept.gate,
    checks,
    reason: swept.reason,
    dry_run: ctx.opts.dryRun ? true : undefined,
  });
}

/** False when `bash` cannot be started: every check would read as failed, so the environment is inconclusive. */
export function isBashAvailable(): boolean {
  const probe = spawnSync("bash", ["-c", "exit 0"], { stdio: "ignore" });
  return probe.error === undefined && probe.status === 0;
}
