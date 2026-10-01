/**
 * `darius run-due`: start every due ritual whose policy lets the timer run
 * it, one headless harness session each (Claude Code today), in sequence (docs/concept.md, "App
 * design" > "Unattended runner").
 *
 * Per project:
 *
 *   1. Sync when `[remote]` is configured. Offline or a held project lease is
 *      not an error: the pull half already ran or the local state is used.
 *   2. For each ritual that is active and due, skip it when its policy mode
 *      is `off`, it is pinned to another host (`other-host`: its `host`
 *      field names a host other than `hostId()`), its latest run is held,
 *      it has an open run, or its latest
 *      run ended `failed` or `abandoned` TODAY. That last rule is the retry
 *      cap: a failed run keeps a ritual due (src/core/due.ts), and the hourly
 *      timer must not relaunch it until the next due date or an operator.
 *      An acknowledgement (`darius run ack`) changes only what the report
 *      says: the timer does not retry an acknowledged failure either.
 *      Then find the project's working dir on this host (src/core/workdir.ts):
 *      none here skips it as `no-workdir`, and a mode above the checkout's
 *      `.darius.toml` `max_mode` skips it as `policy-capped`. Both are decided
 *      before a run starts, so neither leaves an open run behind.
 *   3. Take the ritual lease (src/core/lease.ts): S3
 *      `<project>/leases/ritual-<slug>.json` when a remote is configured, else
 *      an O_EXCL file `<store>/<project>/leases/ritual-<slug>.lock`. A lease
 *      expires after the run timeout plus 5 minutes; a lease held by a dead
 *      process on this host is stale at once. When the lease cannot be taken
 *      the ritual is skipped and the report says so.
 *   4. Write the run files, let the harness adapter (src/harness/) wire the
 *      gate, and run the gate preflight: a gate that does not deny a
 *      synthetic call skips the ritual as `gate-broken` before any run
 *      exists. Then append `run.started` under the project lock (the same
 *      check as `darius run start`) and launch the harness headless
 *      (src/surface/headless.ts).
 *   5. After the harness exits, read the run back. Completed or held by the model
 *      or by the hook: leave it. Still running: append
 *      `run.completed{outcome:"failed"}` with the result as a blob.
 *   6. Release the lease, sync again.
 *
 * A run's id is minted here the same way src/cli/run.ts mints it: a ulid
 * carried as the `run` payload field (see that file's header). `run now`
 * and `run resume` take the same path (options `now` and `resume`); a
 * resume keeps the held run's id and appends `run.resumed` in step 4
 * (src/runner/resume.ts).
 */

import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import { loadConfigIfPresent, type Config } from "../core/config.ts";
import { loadCredentials } from "../core/credentials.ts";
import { ritualState } from "../core/due.ts";
import { latestHandoff } from "../core/handoff.ts";
import { appendLine, hostId, readLedger, type LedgerLineInput } from "../core/ledger.ts";
import { takeLease, type LeaseOutcome } from "../core/lease.ts";
import { isAboveCap, type Marker } from "../core/marker.ts";
import type { Document, JsonValue, LedgerLine, Profile, ProfileFields, Ritual } from "../core/model.ts";
import { projectDir } from "../core/paths.ts";
import { createS3, type S3 } from "../core/s3.ts";
import { GLOBAL_PROJECT, itemRef, listProjects, openProject, putBlob, type Project } from "../core/store.ts";
import { readSummary, type ResultSummary } from "../core/result.ts";
import { localToday } from "../core/sweep.ts";
import { syncProject } from "../core/sync.ts";
import { ulid } from "../core/ulid.ts";
import { projectWorkdir } from "../core/workdir.ts";
import type { HarnessAdapter, HarnessLaunch, ResolvedProfile, ResultFacts, RunFiles } from "../harness/contract.ts";
import { allowsSubagents } from "../harness/gate.ts";
import { resolveProfile, type RepoProfiles, type Resolution } from "../harness/profile.ts";
import { errorMessage } from "../runtime.ts";
import { launchHeadless, type ChildEnv, type LaunchResult } from "../surface/headless.ts";
import { closeFinishedTabs, DEFAULT_POLL_MS, DEFAULT_WAIT_GRACE_MS, herdrTarget, herdrUnavailable, launchHerdr, RUNS_WORKSPACE } from "../surface/herdr.ts";
import { followUpSection, parentResult, type FollowUp } from "./follow-up.ts";
import { harnessReadiness, type Readiness } from "./harness-check.ts";
import { acknowledgeRun, recordHold } from "./hold.ts";
import { buildEnv, gateCommand, preflightGate, writeRunFiles, type PromptInput } from "./launch.ts";
import { readSessionNote, resumeMessage, writeSessionNote } from "./resume.ts";
import { missingTools } from "./tools.ts";
import { FAILING_SKIPS, type BatchReport, type ProjectEntry, type RitualEntry, type RunEnd, type SkipReason } from "./report.ts";

export const DEFAULT_RUN_TIMEOUT_MS = 20 * 60_000;
const LEASE_MARGIN_MS = 5 * 60_000;

export interface RunDueOptions {
  /** Project names; empty means every project in the local store. */
  projects: string[];
  only?: string;
  isDryRun: boolean;
  who: string;
  timeoutMs: number;
  /**
   * `darius run now`: start `only` whether it is due or not, and whatever
   * failed today. A held or open run still blocks it, and `max_mode` still
   * caps it. `profile` overrides the ritual's own for this run.
   */
  now?: { profile?: string };
  /**
   * `darius run resume`: go on with the held and answered run `run` of
   * ritual `only`, with the same run id (src/runner/resume.ts). The checks
   * of `now` apply; no new run starts.
   */
  resume?: { run: string };
  /**
   * `darius run follow-up`: a new run of ritual `only` that follows up the
   * complete run `parent` and may run the granted lines (src/runner/follow-up.ts).
   * The checks of `now` apply, plus: mode act, a linked checkout, a profile
   * with permissions skip, and a herdr tab unless `headless`.
   */
  followUp?: FollowUp;
}

// --- run view: what the ledger says about one run -----------------------------

export type RunPhase = "running" | "held" | "closed";

/** A person saw a failed or abandoned run (`darius run ack`). Display only. */
export interface Acknowledgement {
  who: string;
  at: string;
  note?: string;
}

export interface RunView {
  item?: string;
  phase?: RunPhase;
  outcome?: string;
  /** Every question of every hold, in order. `run answer <run> <n>` numbers them from 1. */
  questions: string[];
  /** The latest answer per question number. */
  answers: Map<number, string>;
  /** Held since the latest start or resume. */
  hasHeld: boolean;
  /** An answer came after the latest hold: the run may be resumed. */
  isAnswered: boolean;
  completedAt?: string;
  /** The first `run.acknowledged` line of the run. */
  acknowledged?: Acknowledgement;
  /** The counts of the run's result, from its `run.completed` line (0.22.0). */
  result?: ResultSummary;
}

function isJsonText(value: JsonValue | undefined): value is string {
  return typeof value === "string";
}

function isJsonTextList(value: JsonValue | undefined): value is readonly string[] {
  return Array.isArray(value) && value.every((entry) => isJsonText(entry));
}

function isJsonCount(value: JsonValue | undefined): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

/** Phase, outcome, questions and answers of run `runId`, from every ledger line carrying it. */
export function viewRun(ledger: readonly LedgerLine[], runId: string): RunView {
  const view: RunView = { questions: [], answers: new Map(), hasHeld: false, isAnswered: false };
  for (const line of ledger) {
    if (line.run !== runId) continue;
    view.item ??= line.item;
    if (line.type === "run.started" || line.type === "run.resumed") {
      view.phase = "running";
      view.hasHeld = false;
    }
    if (line.type === "run.held") {
      view.phase = "held";
      view.hasHeld = true;
      view.isAnswered = false;
      if (isJsonTextList(line.questions)) view.questions.push(...line.questions);
    }
    if (line.type === "run.answered" && isJsonCount(line.n) && isJsonText(line.text)) {
      view.answers.set(line.n, line.text);
      view.isAnswered = true;
    }
    if (line.type === "run.completed") {
      view.phase = "closed";
      if (isJsonText(line.outcome)) view.outcome = line.outcome;
      view.completedAt = line.at;
      const result = readSummary(line.result);
      if (result !== null) view.result = result;
    }
    if (line.type === "run.acknowledged" && view.acknowledged === undefined) {
      view.acknowledged = isJsonText(line.note) ? { who: line.who, at: line.at, note: line.note } : { who: line.who, at: line.at };
    }
  }
  return view;
}

/** The run id of the ritual's latest run when it ended failed or abandoned today. */
export function failedToday(ledger: readonly LedgerLine[], ritual: { slug: string; today: string }): string | undefined {
  const ref = itemRef("ritual", ritual.slug);
  const latest = ledger.findLast((line) => line.item === ref && line.type === "run.started");
  if (latest === undefined || !isJsonText(latest.run)) return undefined;
  const view = viewRun(ledger, latest.run);
  if (view.phase !== "closed" || view.outcome === "complete" || view.completedAt === undefined) return undefined;
  return localToday(new Date(view.completedAt)) === ritual.today ? latest.run : undefined;
}

// --- config and remote ------------------------------------------------------------

function remoteClient(cfg: Config | null): S3 | null {
  if (cfg?.remote === undefined) return null;
  return createS3(cfg.remote, loadCredentials(cfg.remote.credentials));
}

/** One sync, as a report word. Offline and a held project lease are not errors. */
async function syncStep(project: Project, remote: { s3: S3 | null; cfg: Config | null }): Promise<string> {
  if (remote.s3 === null || remote.cfg === null) return "no-remote";
  const report = await syncProject(project, remote.s3, remote.cfg);
  return report.skipped ?? "ok";
}

// --- ritual lease -----------------------------------------------------------------

export interface LeaseRequest {
  project: Project;
  slug: string;
  run: string;
  s3: S3 | null;
  ttlMs: number;
}

/** `<project>/leases/ritual-<slug>.json` in the bucket, or `<store>/leases/ritual-<slug>.lock` without one. */
export function takeRitualLease(request: LeaseRequest, host: string): Promise<LeaseOutcome> {
  const { project, slug, run, s3, ttlMs } = request;
  return takeLease({
    key: `${project.name}/leases/ritual-${slug}.json`,
    file: join(project.root, "leases", `ritual-${slug}.lock`),
    s3,
    host,
    ttlMs,
    run,
  });
}

// --- one ritual ---------------------------------------------------------------------

interface ProjectContext {
  project: Project;
  s3: S3 | null;
  cfg: Config | null;
  /** The store-wide profiles (`_global`), or null when this host has none. */
  global: Project | null;
  host: string;
  today: string;
  options: RunDueOptions;
  /** Shared by every project of the batch: one version check per harness, and the report that lists the checks. */
  batch: { readiness: Map<string, Readiness>; report: BatchReport };
}

function skipped(slug: string, reason: SkipReason, detail?: string | undefined): RitualEntry {
  const entry: RitualEntry = { slug, action: "skipped", reason };
  if (detail !== undefined) entry.detail = detail;
  return entry;
}

/**
 * Why a due ritual must not start now, or undefined when it may. `host` is
 * this host's id; `resuming` is the held run a resume goes on with.
 */
function blocker(
  doc: Document<Ritual>,
  ledger: LedgerLine[],
  at: { today: string; host: string; isNow: boolean; resuming?: string | undefined },
): RitualEntry | undefined {
  const { slug, policy } = doc.header;
  const { today, isNow, resuming } = at;
  const state = ritualState(doc, ledger, today);
  if (isNow && state.lifecycle !== "active") return skipped(slug, "not-active", `the ritual is ${state.lifecycle}`);
  if (policy.mode === "off") {
    return skipped(slug, "policy-off", isNow ? "an unattended run needs mode report or act: darius ritual set --mode report" : undefined);
  }
  // A pinned ritual runs on its host only: two runner hosts would race for it, and the lease only serializes them.
  const pin = doc.header.host;
  if (pin !== undefined && pin !== at.host) return skipped(slug, "other-host", `pinned to ${pin}`);
  if (state.heldRun !== undefined && state.heldRun !== resuming) return skipped(slug, "held", `run ${state.heldRun}`);
  if (state.openRun !== undefined) return skipped(slug, "open-run", `run ${state.openRun}`);
  if (resuming !== undefined) return resumeBlocker(slug, viewRun(ledger, resuming), resuming);
  if (isNow) return undefined;
  const failed = failedToday(ledger, { slug, today });
  if (failed !== undefined) return skipped(slug, "failed-today", failedTodayDetail(ledger, failed, slug));
  return undefined;
}

/** Who saw the failed run, or the two commands a person has: mark it seen, or start the ritual now. */
function failedTodayDetail(ledger: readonly LedgerLine[], run: string, slug: string): string {
  const seen = viewRun(ledger, run).acknowledged;
  if (seen !== undefined) return `run ${run}; acknowledged by ${seen.who}`;
  return `run ${run}; darius run ack ${run} or darius run now ${slug}`;
}

/** Why held run `run` cannot go on: it is not held, or nobody answered since the hold. */
function resumeBlocker(slug: string, view: RunView, run: string): RitualEntry | undefined {
  if (view.phase !== "held") return skipped(slug, "not-resumable", `run ${run} is not held (phase: ${view.phase ?? "unknown"})`);
  if (!view.isAnswered) return skipped(slug, "not-resumable", `run ${run} has no answer since it was held`);
  return undefined;
}

/** True when the ritual is active and due today, whatever its policy says. */
function isCandidate(doc: Document<Ritual>, ledger: LedgerLine[], today: string): boolean {
  const state = ritualState(doc, ledger, today);
  if (state.lifecycle !== "active") return false;
  return state.isDue || state.heldRun !== undefined || state.openRun !== undefined;
}

/** Appends run.started under the project lock, or returns the open run that blocks it. */
function startRun(ctx: ProjectContext, target: { doc: Document<Ritual>; run: string }): { run: string } | { blockedBy: string } {
  const { doc, run } = target;
  return ctx.project.withLock(() => {
    const state = ritualState(doc, readLedger(ctx.project), ctx.today);
    const open = state.heldRun ?? state.openRun;
    if (open !== undefined) return { blockedBy: open };
    const line: LedgerLineInput = { who: ctx.options.who, type: "run.started", item: itemRef("ritual", doc.header.slug), run };
    const { followUp } = ctx.options;
    if (followUp !== undefined) {
      line.follow_up_of = followUp.parent;
      line.approved = [...followUp.approved];
      line.grants = [...followUp.grants];
    }
    appendLine(ctx.project, line);
    return { run };
  });
}

/**
 * A parent whose questions wait for the operator is acknowledged once its
 * follow-up started: starting it is the operator's decision. Any other
 * parent is left as it is.
 */
function ackParent(ctx: ProjectContext, followUp: FollowUp, run: string): void {
  const view = viewRun(readLedger(ctx.project), followUp.parent);
  const isWaiting = view.outcome === "complete" && (view.result?.questions ?? 0) > 0 && view.acknowledged === undefined;
  if (!isWaiting) return;
  const what = followUp.approved.length > 0 ? `approved ${followUp.approved.join(", ")}` : `granted ${String(followUp.grants.length)} line(s)`;
  acknowledgeRun(ctx.project, { run: followUp.parent, who: ctx.options.who, note: `follow-up ${run}, ${what}` });
}

/** The findings `run complete` refused (src/cli/run.ts), clipped, when the run dir has them. */
function rejectedFindings(runDir: string): string | null {
  const file = join(runDir, "findings-rejected.md");
  if (!existsSync(file)) return null;
  const text = readFileSync(file, "utf8");
  return text.length > 20_000 ? `${text.slice(0, 20_000)}\n[clipped]` : text;
}

function failureBlob(launch: LaunchResult, facts: ResultFacts, harness: string, runDir: string): string {
  let reason = `${harness} exited without completing or holding the run`;
  if (launch.spawnError !== undefined) reason = launch.spawnError.includes("is not on PATH") ? launch.spawnError : `${harness} did not start: ${launch.spawnError}`;
  else if (launch.exitCode === 127) reason = `${harness} is not on PATH: install it or set the profile's command`;
  else if (launch.timedOut) reason = `${harness} was stopped after the run timeout (${String(launch.durationMs)} ms)`;
  const blob: JsonValue = {
    reason,
    exit_code: launch.exitCode,
    signal: launch.signal,
    timed_out: launch.timedOut,
    duration_ms: launch.durationMs,
    result: facts.result,
    stdout_tail: facts.result === null ? launch.stdout.slice(-4096) : null,
    stderr_tail: launch.stderrTail,
    // The model's last findings, when darius refused their result block; else lost with the run.
    rejected_findings: rejectedFindings(runDir),
  };
  return `${JSON.stringify(blob, null, 2)}\n`;
}

/** How a run ended, read back from the ledger. */
interface RunClose {
  end: RunEnd;
  questions: string[];
  result?: ResultSummary;
}

/** Reads the run back after the harness exited; appends run.completed failed when it is still running. */
function finalizeRun(
  ctx: ProjectContext,
  run: string,
  ended: { launch: LaunchResult; facts: ResultFacts; harness: string },
): RunClose {
  const { launch, facts } = ended;
  return ctx.project.withLock(() => {
    const view = viewRun(readLedger(ctx.project), run);
    if (view.phase === "held") return { end: "held", questions: view.questions };
    if (view.phase === "closed") {
      const closed: RunClose = { end: toRunEnd(view.outcome), questions: view.questions };
      if (view.result !== undefined) closed.result = view.result;
      return closed;
    }
    const line: LedgerLineInput = {
      who: ctx.options.who,
      type: "run.completed",
      item: view.item,
      run,
      outcome: "failed",
      findings_sha: putBlob(ctx.project, failureBlob(launch, facts, ended.harness, join(ctx.project.root, "runs", run))),
    };
    if (facts.sessionId !== undefined) line.session_id = facts.sessionId;
    appendLine(ctx.project, line);
    return { end: "failed", questions: view.questions };
  });
}

/** Appends run.resumed under the project lock while the run is still held and answered, or returns the run that blocks it. */
function resumeRun(ctx: ProjectContext, target: { run: string; sessionId?: string | undefined }): { run: string } | { blockedBy: string } {
  const { run, sessionId } = target;
  return ctx.project.withLock(() => {
    const view = viewRun(readLedger(ctx.project), run);
    if (view.phase !== "held" || !view.isAnswered) return { blockedBy: run };
    const line: LedgerLineInput = { who: ctx.options.who, type: "run.resumed", item: view.item, run };
    if (sessionId === undefined) line.fresh = true;
    else line.session_id = sessionId;
    appendLine(ctx.project, line);
    return { run };
  });
}

function toRunEnd(outcome: string | undefined): RunEnd {
  if (outcome === "complete" || outcome === "abandoned") return outcome;
  return "failed";
}

/** The surface a run uses. A profile's `herdr` falls back to headless, with a warning, where herdr is not running. */
interface SurfaceChoice {
  surface: "headless" | "herdr";
  warning?: string;
}

async function chooseSurface(profile: ResolvedProfile): Promise<SurfaceChoice> {
  if (profile.surface !== "herdr") return { surface: "headless" };
  const unavailable = await herdrUnavailable();
  if (unavailable === null) return { surface: "herdr" };
  return { surface: "headless", warning: `surface-fallback: ${unavailable}; ran headless` };
}

/** A follow-up is attended: a herdr tab, never a silent fallback; headless only when asked. */
async function followUpSurface(followUp: FollowUp): Promise<SurfaceChoice | { refused: string }> {
  if (followUp.headless === true) return { surface: "headless" };
  const unavailable = await herdrUnavailable();
  if (unavailable === null) return { surface: "herdr" };
  return { refused: `a follow-up opens a herdr tab, and ${unavailable}; start herdr, or pass --headless` };
}

/**
 * Why ritual `doc` cannot have a follow-up here, before its profile is
 * known: the ritual must be in mode act. A report ritual never runs a
 * write, granted or not.
 */
function followUpBlocker(doc: Document<Ritual>): RitualEntry | undefined {
  const { slug, policy } = doc.header;
  if (policy.mode === "act") return undefined;
  return skipped(slug, "not-followable", `ritual ${slug} is in mode ${policy.mode}; set --mode act, or run the lines by hand`);
}

/** One ritual about to run: its item, run id, working dir, resolved profile and surface. */
interface RunTarget {
  doc: Document<Ritual>;
  run: string;
  cwd: string;
  resolution: Resolution;
  surface: SurfaceChoice;
  /** What the report should say about this run that did not stop it. */
  warnings: string[];
}

/** A run ready to launch on either surface. */
interface PreparedRun {
  files: RunFiles;
  launch: HarnessLaunch;
  bin: string;
  env: ChildEnv;
  /** The harness session a resume goes on with; undefined for a new session. */
  sessionId?: string;
}

/** A resume's first message, and the session to go on with when this host still has it. */
function resumePlan(ctx: ProjectContext, target: RunTarget, harness: Resolution["harness"]): { message: string; sessionId?: string } {
  const { run, doc } = target;
  const note = readSessionNote(join(ctx.project.root, "runs", run));
  const sessionId = note !== null && note.harness === harness.id && harness.canResume(note.session_id) ? note.session_id : undefined;
  const view = viewRun(readLedger(ctx.project), run);
  const message = resumeMessage({ run, slug: doc.header.slug, view, isFresh: sessionId === undefined });
  return sessionId === undefined ? { message } : { message, sessionId };
}

/** The harness executable on this host: `[runner] claude` for Claude Code, else the adapter's default. */
function harnessBin(ctx: ProjectContext, harness: HarnessAdapter): string {
  return harness.resolveBin(harness.id === "claude" ? ctx.cfg?.runner.claude : undefined);
}

/**
 * Whether the harness may start runs here: the latest gate check of its
 * installed version on this host passed (src/runner/harness-check.ts). Asked
 * once per harness per batch; a missing check runs here, outside dry runs.
 */
async function readiness(ctx: ProjectContext, harness: HarnessAdapter): Promise<Readiness> {
  const known = ctx.batch.readiness.get(harness.id);
  if (known !== undefined) return known;
  const { report } = ctx.batch;
  const result = await harnessReadiness({
    harness,
    bin: harnessBin(ctx, harness),
    today: ctx.today,
    isDryRun: ctx.options.isDryRun,
    who: ctx.options.who,
    openGlobal: () => ctx.global ?? (ctx.options.isDryRun ? null : openProject(GLOBAL_PROJECT, { create: true })),
    onCheck: (check) => {
      report.harnessChecks = [...(report.harnessChecks ?? []), check];
    },
  });
  ctx.batch.readiness.set(harness.id, result);
  return result;
}

/**
 * Writes the run files, lets the adapter wire the gate, and proves the gate
 * works before anything is started. The run id exists, the run does not yet.
 */
function prepareRun(ctx: ProjectContext, target: RunTarget): PreparedRun | { gateBroken: string; files: RunFiles } {
  const { doc, run } = target;
  const { profile, harness } = target.resolution;
  const project = ctx.project.name;
  const ledger = readLedger(ctx.project);
  const handoff = latestHandoff(ctx.project, ledger, doc.header.slug);
  const { followUp } = ctx.options;
  const prompt: PromptInput = { project, run, ritual: doc.header, body: doc.body, handoff };
  if (followUp !== undefined) prompt.followUp = followUpSection(followUp, parentResult(ctx.project, ledger, followUp.parent));
  // A skill can grant tools of its own (`allowed-tools`), so a ritual that
  // names one gets the full gate, which enforces `may` itself. So does one
  // that may start subagents: the gate must see each of their calls.
  const needsFull = doc.header.skill !== undefined || allowsSubagents(doc.header.policy.may);
  const scope = needsFull ? "full" : harness.gateScope(profile);
  const resume = ctx.options.resume === undefined ? undefined : resumePlan(ctx, target, harness);
  const granted = followUp === undefined ? undefined : { grants: followUp.grants, followUpOf: followUp.parent };
  const files = writeRunFiles(ctx.project.root, prompt, scope, granted);
  const gate = gateCommand(files, harness);
  const message =
    followUp === undefined
      ? {}
      : { message: `Follow up run ${followUp.parent} of ritual ${doc.header.slug} now. Run id ${run}. Follow the protocol and the Follow-up section in your system prompt.` };
  const launch = harness.prepare({ ritual: doc.header, run, files, profile, scope, gate, ...message, ...resume });
  const env = buildEnv({ project, run, files, harness });
  const broken = preflightGate(gate, harness, env);
  if (broken !== undefined) return { gateBroken: broken, files };
  const bin = harnessBin(ctx, harness);
  const prepared: PreparedRun = { files, launch, bin, env };
  if (resume?.sessionId !== undefined) prepared.sessionId = resume.sessionId;
  return prepared;
}

/**
 * The variables a herdr tab gets: the run's, and the store dirs when set.
 * Not PATH: the tab's login shell owns it, and the timer's PATH is narrowed
 * for the unit (src/core/unit-path.ts).
 */
const TAB_ENV_KEYS: readonly string[] = [
  "DARIUS_RUN", "DARIUS_RUN_POLICY", "DARIUS_PROJECT", "DARIUS_WHO", "DARIUS_STATE_DIR", "DARIUS_CONFIG_DIR",
];

function tabEnv(env: ChildEnv): ChildEnv {
  const picked: ChildEnv = {};
  for (const key of TAB_ENV_KEYS) {
    const value = env[key];
    if (value !== undefined) picked[key] = value;
  }
  return picked;
}

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || !/^\d+$/u.test(raw)) return fallback;
  return Number(raw);
}

function launchOnSurface(ctx: ProjectContext, target: RunTarget, prepared: PreparedRun): Promise<LaunchResult> {
  const { run, cwd, doc } = target;
  const { timeoutMs } = ctx.options;
  if (target.surface.surface === "headless") {
    return launchHeadless({ bin: prepared.bin, argv: prepared.launch.headless, cwd, env: prepared.env, timeoutMs });
  }
  const project = ctx.project;
  return launchHerdr({
    target: herdrTarget(),
    kind: target.resolution.harness.id,
    argv: prepared.launch.interactive,
    message: prepared.launch.message,
    cwd,
    env: tabEnv(prepared.env),
    label: `${doc.header.slug} ${run.slice(-6).toLowerCase()}`,
    run,
    runDir: prepared.files.dir,
    timeoutMs,
    pollMs: envNumber("DARIUS_HERDR_POLL_MS", DEFAULT_POLL_MS),
    graceMs: envNumber("DARIUS_HERDR_WAIT_GRACE_MS", DEFAULT_WAIT_GRACE_MS),
    phase: () => viewRun(readLedger(project), run).phase ?? "running",
    hold: (question) => {
      recordHold({ project: project.name, run }, { question, who: `herdr:${run}` });
    },
  });
}

async function launchRun(ctx: ProjectContext, target: RunTarget, prepared: PreparedRun): Promise<RitualEntry> {
  const { doc, run, resolution } = target;
  const launch = await launchOnSurface(ctx, target, prepared);
  const facts = resolution.harness.parseResult(launch.stdout);
  if (facts.sessionId !== undefined) writeSessionNote(prepared.files.dir, { harness: resolution.harness.id, session_id: facts.sessionId });
  const { end, questions, result } = finalizeRun(ctx, run, { launch, facts, harness: resolution.harness.id });
  const entry: RitualEntry = {
    ...launchFacts(resolution, target.surface, target.warnings),
    slug: doc.header.slug,
    action: "started",
    run,
    end,
    exitCode: launch.exitCode,
    timedOut: launch.timedOut,
    durationMs: launch.durationMs,
  };
  if (ctx.options.resume !== undefined) entry.resumed = true;
  if (ctx.options.followUp !== undefined) entry.followUpOf = ctx.options.followUp.parent;
  if (questions.length > 0) entry.questions = questions;
  if (result !== undefined) entry.result = result;
  if (facts.sessionId !== undefined) entry.sessionId = facts.sessionId;
  if (facts.costUsd !== undefined) entry.costUsd = facts.costUsd;
  return entry;
}

/** The profile, harness and surface a run uses, and its warnings, for the report. */
function launchFacts(
  resolution: Resolution,
  choice: SurfaceChoice,
  extra: readonly string[] = [],
): Pick<RitualEntry, "profile" | "harness" | "surface" | "warnings"> {
  const { profile } = resolution;
  const facts: Pick<RitualEntry, "profile" | "harness" | "surface" | "warnings"> = { harness: profile.harness, surface: choice.surface };
  if (profile.name !== undefined) facts.profile = profile.name;
  const warnings = [...(choice.warning === undefined ? [] : [choice.warning]), ...extra];
  if (warnings.length > 0) facts.warnings = warnings;
  return facts;
}

/** A ritual as one run sees it, and what the report says about the change. */
interface ProvenRitual {
  doc: Document<Ritual>;
  warnings: string[];
}

/**
 * The ritual as this run sees it. A ritual whose `may` names Agent keeps it
 * only when the harness version's gate check saw the gate judge a subagent
 * on this host; otherwise a report ritual runs without subagents, and the
 * report says why. An act ritual does not run at all (null): its subagents
 * verify before it writes, so without them it would write unverified.
 */
function withSubagentProof(doc: Document<Ritual>, ready: { subagents: boolean; version: string }, harness: HarnessAdapter): ProvenRitual | null {
  const { policy } = doc.header;
  if (!allowsSubagents(policy.may) || ready.subagents) return { doc, warnings: [] };
  if (policy.mode === "act") return null;
  const may = policy.may.filter((rule) => rule !== "Agent");
  const warning = `subagents off: the gate check of ${harness.id} ${ready.version} on this host did not prove them; run darius harness check ${harness.id}`;
  return { doc: { ...doc, header: { ...doc.header, policy: { ...policy, may } } }, warnings: [warning] };
}

/** Leases, starts (or resumes) and runs one ritual. */
async function runRitual(ctx: ProjectContext, target: Omit<RunTarget, "run">): Promise<RitualEntry> {
  const { doc } = target;
  const { slug } = doc.header;
  const { resume } = ctx.options;
  // The run id is minted before the lease so the lease names the run it guards.
  const run = resume?.run ?? ulid();
  // A resume keeps its run dir: the session note and the earlier files live there.
  const discard = (files: RunFiles): void => {
    if (resume === undefined) rmSync(files.dir, { recursive: true, force: true });
  };
  const lease = await takeRitualLease(
    { project: ctx.project, slug, run, s3: ctx.s3, ttlMs: ctx.options.timeoutMs + LEASE_MARGIN_MS },
    ctx.host,
  );
  if ("blocked" in lease) return skipped(slug, lease.blocked === "lease-offline" ? "lease-offline" : "lease-held", lease.detail);
  try {
    const prepared = prepareRun(ctx, { ...target, run });
    if ("gateBroken" in prepared) {
      discard(prepared.files);
      return skipped(slug, "gate-broken", prepared.gateBroken);
    }
    const started = resume === undefined ? startRun(ctx, { doc, run }) : resumeRun(ctx, { run, sessionId: prepared.sessionId });
    if ("blockedBy" in started) {
      discard(prepared.files);
      return skipped(slug, resume === undefined ? "open-run" : "not-resumable", `run ${started.blockedBy}`);
    }
    if (ctx.options.followUp !== undefined) ackParent(ctx, ctx.options.followUp, started.run);
    return await launchRun(ctx, { ...target, run: started.run }, prepared);
  } finally {
    await lease.handle.release();
  }
}

async function handleRitual(ctx: ProjectContext, slug: string): Promise<RitualEntry | null> {
  const doc = ctx.project.readItem<Ritual>("ritual", slug);
  if (doc === null) return null;
  const ledger = readLedger(ctx.project);
  const { now, resume, followUp } = ctx.options;
  const isByHand = now !== undefined || resume !== undefined || followUp !== undefined;
  if (!isByHand && !isCandidate(doc, ledger, ctx.today)) return null;
  const blocked = blocker(doc, ledger, { today: ctx.today, host: ctx.host, isNow: isByHand, resuming: resume?.run }) ?? (followUp === undefined ? undefined : followUpBlocker(doc));
  if (blocked !== undefined) return blocked;
  try {
    const where = projectWorkdir(ctx.project, ledger);
    if ("missing" in where) return skipped(slug, "no-workdir", where.detail);
    if (followUp !== undefined && where.from === "store") {
      return skipped(slug, "no-workdir", `a follow-up runs in a checkout of ${ctx.project.name}, and none is linked on this host: run darius link inside one`);
    }
    const { mode, may } = doc.header.policy;
    const missing = missingTools(may, process.env.PATH ?? "");
    if (missing.length > 0) {
      return skipped(slug, "tool-missing", `${missing.join(", ")} not on the runner PATH; add the dir, then darius setup --systemd`);
    }
    if (isAboveCap(mode, where.marker)) {
      const cap = `max_mode = "${where.marker?.maxMode ?? "?"}" in ${where.marker?.file ?? "?"}`;
      return skipped(slug, "policy-capped", `mode ${mode} is above ${cap}`);
    }
    let resolution: Resolution;
    try {
      // A follow-up uses `[defaults] follow_up` of the checkout when set, else the ritual's profile.
      const named = followUp === undefined ? now?.profile : where.marker?.defaultFollowUp;
      const policy = named === undefined ? doc.header.policy : { ...doc.header.policy, profile: named };
      resolution = resolveProfile({ policy, repo: repoProfiles(where.marker), global: globalProfile(ctx) });
    } catch (cause) {
      return skipped(slug, "profile-invalid", errorMessage(cause));
    }
    if (followUp !== undefined && resolution.profile.permissions !== "skip") {
      const name = resolution.profile.name ?? "built-in";
      return skipped(slug, "not-followable", `profile ${name} has permissions gated, and its allowlist would refuse the granted lines; use a profile with permissions skip ([defaults] follow_up)`);
    }
    const chosen = followUp === undefined ? await chooseSurface(resolution.profile) : await followUpSurface(followUp);
    if ("refused" in chosen) return skipped(slug, "not-followable", chosen.refused);
    const surface = chosen;
    const ready = await readiness(ctx, resolution.harness);
    if (!ready.ready) return skipped(slug, "harness-unchecked", ready.detail);
    if (ctx.options.isDryRun) {
      const warnings = ready.pending === undefined ? [] : [ready.pending];
      const entry: RitualEntry = { ...launchFacts(resolution, surface, warnings), slug, action: "would-start" };
      if (followUp !== undefined) {
        entry.followUpOf = followUp.parent;
        entry.detail = surface.surface === "herdr" ? `a herdr tab in workspace ${RUNS_WORKSPACE}, cwd ${where.dir}` : `headless, cwd ${where.dir}`;
      }
      return entry;
    }
    const proven = withSubagentProof(doc, ready, resolution.harness);
    if (proven === null) {
      const retry = `darius harness check ${resolution.harness.id}`;
      return skipped(slug, "subagents-unproven", `an act ritual with subagents needs the gate check of ${resolution.harness.id} ${ready.version} to prove them on this host; run ${retry}`);
    }
    return await runRitual(ctx, { doc: proven.doc, cwd: where.dir, resolution, surface, warnings: proven.warnings });
  } catch (cause) {
    return skipped(slug, "error", errorMessage(cause));
  }
}

// --- projects -------------------------------------------------------------------------

async function runProject(ctx: ProjectContext, cfg: Config | null): Promise<ProjectEntry> {
  const remote = { s3: ctx.s3, cfg };
  const entry: ProjectEntry = { project: ctx.project.name, syncBefore: "skipped", syncAfter: "skipped", rituals: [] };
  if (!ctx.options.isDryRun) {
    entry.syncBefore = await syncStep(ctx.project, remote);
    await closeFinishedTabs(join(ctx.project.root, "runs"), listRuns(ctx.project), (run) => isRunning(ctx.project, run));
  }
  const slugs = ctx.project.listItems("ritual").filter((slug) => ctx.options.only === undefined || slug === ctx.options.only);
  for (const slug of slugs) {
    const ritual = await handleRitual(ctx, slug);
    if (ritual !== null) entry.rituals.push(ritual);
  }
  const didStart = entry.rituals.some((ritual) => ritual.action === "started");
  if (didStart) entry.syncAfter = await syncStep(ctx.project, remote);
  return entry;
}

/** Runs every due ritual in the selected projects and returns the batch report (not yet delivered). */
export async function runDue(options: RunDueOptions): Promise<{ report: BatchReport; cfg: Config | null }> {
  const cfg = loadConfigIfPresent();
  const s3 = remoteClient(cfg);
  const host = hostId();
  const today = localToday();
  const report: BatchReport = { ok: true, date: today, host, dryRun: options.isDryRun, projects: [], errors: [] };
  const global = await openGlobal({ s3, cfg }, options.isDryRun, report);
  const names = options.projects.length > 0 ? options.projects : listProjects();
  const batch = { readiness: new Map<string, Readiness>(), report };
  for (const name of names) {
    try {
      const project = openProject(name);
      const ctx: ProjectContext = { project, s3, cfg, global, host, today, options, batch };
      report.projects.push(await runProject(ctx, cfg));
    } catch (cause) {
      report.errors.push({ project: name, error: errorMessage(cause) });
    }
  }
  report.ok = report.errors.length === 0 && !hasFailure(report);
  return { report, cfg };
}

function listRuns(project: Project): string[] {
  const dir = join(project.root, "runs");
  return existsSync(dir) ? readdirSync(dir) : [];
}

function isRunning(project: Project, run: string): boolean {
  return viewRun(readLedger(project), run).phase === "running";
}


/**
 * The store-wide profiles. With a remote, `_global` is created when missing
 * and synced first, so a new profile reaches this host before its rituals
 * run. Without one it is used when it exists.
 */
async function openGlobal(
  remote: { s3: S3 | null; cfg: Config | null },
  isDryRun: boolean,
  report: BatchReport,
): Promise<Project | null> {
  try {
    if (remote.s3 !== null && !isDryRun) {
      const global = openProject(GLOBAL_PROJECT, { create: true });
      report.globalSync = await syncStep(global, remote);
      return global;
    }
    return existsSync(projectDir(GLOBAL_PROJECT)) ? openProject(GLOBAL_PROJECT) : null;
  } catch (cause) {
    report.errors.push({ project: GLOBAL_PROJECT, error: errorMessage(cause) });
    return null;
  }
}

/** A store-wide profile by name, read from `_global`. */
function globalProfile(ctx: ProjectContext): (name: string) => ProfileFields | undefined {
  return (name) => ctx.global?.readItem<Profile>("profile", name)?.header;
}

/** A marker's profile tables, in the shape resolution reads. */
function repoProfiles(marker: Marker | null): RepoProfiles | null {
  if (marker === null) return null;
  const repo: RepoProfiles = { profiles: marker.profiles, file: marker.file };
  if (marker.defaultRitual !== undefined) repo.defaultRitual = marker.defaultRitual;
  return repo;
}

function hasFailure(report: BatchReport): boolean {
  return report.projects.some((project) =>
    project.rituals.some((ritual) => ritual.end === "failed" || FAILING_SKIPS.has(ritual.reason ?? "")),
  );
}
