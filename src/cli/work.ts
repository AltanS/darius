/**
 * `darius work plan|verify|commit-check` (0.102.0): the mechanical steps of
 * the Work Loop as three verbs, so a session runs one command where a forked
 * skill used to run eight (docs/concept.md, "Work verbs").
 *
 *   work plan [--batch N] [--skip-commit-first] [--override "<reason>"] [--session <id>] [--json]
 *       The commit-first gate, the next spec, the dependency gate, the spec
 *       check, the review stamp, the worklog context, the claim, the thread
 *       (opened at `planned`, or reused) and the agent roster.
 *   work verify <spec> --thread <id> --touched <a,b,...> [--timeout <s>] [--json]
 *       The artifact and stub scans, `verify` on the whole spec, the index,
 *       the Artifacts entry and, when all of it passed, `set-stage verified`.
 *   work commit-check <spec...> [--json]
 *       Reads only, apart from the index rebuild: the scoped threads, the
 *       paths to `git add`, the refusals, the drift warning and the progress
 *       trailer. The caller commits and stamps `committed`.
 *
 * Exit codes: 0 the verb ran and `status` is the answer (`work verify` exits
 * 1 for `fail`); 1 refused or failed, with a `next:` line; 2 usage; 3 no
 * tracker here, or a step whose output could not be read.
 *
 * Every write runs the existing verb as a child (src/core/work-engine.ts), so
 * the store sync, the gates and the printed lines stay those of the verb.
 * The claim's `CLAIMED:` line, the new thread's `OPENED:` line and the stage
 * line of `set-stage` go to stderr and into the JSON.
 */

import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

import { checkSpecFile, loadSpecGrammar, type RiskReason } from "../core/spec-check.ts";
import { resolveTrackerRoot, resolveTreeArg, specKey, type TrackerWhere } from "../core/tracker-root.ts";
import {
  clip,
  firstLine,
  isPassingLine,
  lastNote,
  loadWorkLegacy,
  runDarius,
  type ChildRun,
  type LegacyScanMatch,
  type WorkLegacy,
} from "../core/work-engine.ts";
import { UsageError, type Command, type ParsedArgs } from "./registry.ts";

const USAGE = [
  "usage: darius work plan [--batch N] [--skip-commit-first] [--override \"<reason>\"] [--session <id>] [--json]",
  "       darius work verify <spec> --thread <id> --touched <a,b,...> [--timeout <seconds>] [--json]",
  "       darius work commit-check <spec>... [--json]",
].join("\n");

/** A short text cap for anything that lands in the session's context. */
const NOTE_MAX = 160;
const FINDING_MAX = 200;

// ---------------------------------------------------------------------------
// Child output, as the legacy verbs print it
// ---------------------------------------------------------------------------

interface NextAnswer {
  status: "task" | "complete" | "broken" | "claimed";
  label?: string;
  file?: string;
  spec?: string;
  milestone?: string;
  error?: string;
  skippedClaimed?: { spec: string; session: string | null; host: string | null }[];
}

interface SpecListing {
  path: string;
  file: string;
  milestoneSlug: string;
  status: string;
  verified: number;
  total: number;
  depends_on: string[];
  claim?: { state: string; session: string | null; host: string | null };
}

interface SpecTask {
  index: number;
  state: string;
  label: string;
  command: string | null;
  expected: string | null;
}

interface SpecView {
  verified: number;
  total: number;
  tasks: SpecTask[];
}

interface StampListing {
  stage: string;
  at: string;
}

interface ThreadListing {
  threadId: string;
  specPath?: string;
  stage?: string;
  worklogFile: string;
  artifacts?: string[];
  stamps?: StampListing[];
}

interface AgentEntry {
  invocable: string;
  description: string;
}

interface UncommittedEntry {
  path: string;
  gitStatus: string;
  threadId?: string;
  dirtyArtifacts?: string[];
}

/** A step whose output darius cannot read: exit 3, the environment is inconclusive. */
class StepError extends Error {}

/** The JSON a child printed on stdout; a StepError when there is none. */
function childJson<T>(run: ChildRun, what: string): T {
  try {
    // SAFETY: the vendored verb's documented --json output; the fields read are checked where they matter.
    return JSON.parse(run.stdout) as T;
  } catch {
    throw new StepError(`darius ${what} gave no JSON (exit ${String(run.code)}): ${firstLine(run.stderr)}`);
  }
}

function sessionArgs(session: string | undefined): string[] {
  return session === undefined ? [] : ["--session", session];
}

function stringFlag(args: ParsedArgs, name: string): string | undefined {
  const value = args.flags[name];
  if (value === undefined || value === false) return undefined;
  if (value === true) throw new UsageError(`--${name} needs a value\n${USAGE}`);
  return value;
}

function positiveInt(raw: string | undefined, name: string, fallback: number): number {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) throw new UsageError(`--${name} must be a positive whole number, got "${raw}"`);
  return value;
}

/** Writes the answer: compact JSON, or the text lines. */
function emit<T>(json: boolean, payload: T, text: readonly string[]): void {
  if (json) console.log(JSON.stringify(payload));
  else console.log(text.join("\n"));
}

/** The tracker tree here, or null after an exit-3 message. */
function treeHere(verb: string): Extract<TrackerWhere, { trackerRoot: string }> | null {
  const where = resolveTrackerRoot(process.cwd());
  if (where.mode === "none") {
    console.error(`darius work ${verb}: no tracker here: no .darius.toml with milestone in kinds, and no .tracker/ folder`);
    console.error("  next: darius init");
    return null;
  }
  return where;
}

/**
 * The spec key of a reference (`specKey` in src/core/tracker-root.ts): the
 * tracker-relative path, whichever form names the spec. A bare name or a path
 * that exists from the cwd resolves to the file first.
 */
function keyOf(spec: string): string {
  const cwd = process.cwd();
  const where = resolveTrackerRoot(cwd);
  if (where.mode === "none") return spec.trim();
  const resolved = specKey(resolveTreeArg(spec, cwd, where), where);
  return existsSync(join(where.trackerRoot, resolved)) ? resolved : specKey(spec, where);
}

/** True when two spec references name the same spec, in any form a thread or a caller uses. */
function sameSpec(a: string, b: string): boolean {
  return keyOf(a) === keyOf(b);
}

/** The spec name the work verbs hand on: the spec key, tracker-relative in both modes. */
function specName(spec: string): string {
  return keyOf(spec);
}

/** `<milestone>/_counsel/<spec-slug>.md` below the tree, where the review transcript lives. */
function transcriptPath(trackerRoot: string, specAbs: string): string {
  return join(trackerRoot, basename(dirname(specAbs)), "_counsel", `${basename(specAbs, ".md")}.md`);
}

function isOpenTask(task: SpecTask): boolean {
  return task.state === "pending" || task.state === "in_progress";
}

// ---------------------------------------------------------------------------
// work plan
// ---------------------------------------------------------------------------

interface Candidate {
  spec: string;
  specAbsPath: string;
  milestone: string;
  task: string;
  agent: string | null;
  needsReview: boolean;
}

interface PlannedTask {
  spec: string;
  specAbsPath: string;
  milestone: string;
  task: string;
  threadId: string;
  stage: string;
  worklogPath: string;
  agent: string | null;
  verification: { command: string; expected: string }[];
  priorArtifacts: string[];
  counselTranscript: string | null;
}

type PlanStatus = "ready" | "commit_first" | "spec_invalid" | "review_required" | "blocked" | "counsel_exhausted" | "complete";

interface ReviewInfo {
  spec: string;
  riskReasons: string[];
  transcriptPath: string;
}

interface DebtLine {
  path: string;
  gitStatus: string;
  threadId: string | null;
  dirtyArtifacts: string[];
}

interface ContextLine {
  id: string;
  spec: string | null;
  stage: string | null;
  note: string | null;
}

interface PendingLine {
  threadId: string;
  spec: string | null;
  stage: string | null;
}

/** The parts of a plan answer that only some statuses carry. */
interface PlanExtra {
  specs?: (string | DebtLine)[];
  problems?: string[];
  review?: ReviewInfo;
  context?: ContextLine[];
  pending?: PendingLine[];
}

interface PlanAnswer extends PlanExtra {
  status: PlanStatus;
  tasks: PlannedTask[];
  availableAgents: AgentEntry[];
  blocked: { spec: string; reason: string }[];
  warnings: string[];
  claims: string[];
  opened: string[];
}

interface PlanState {
  json: boolean;
  where: Extract<TrackerWhere, { trackerRoot: string }>;
  session: string | undefined;
  warnings: string[];
  blocked: { spec: string; reason: string }[];
  claims: string[];
  opened: string[];
}

function planText(payload: PlanAnswer): string[] {
  const lines = [`STATUS: ${payload.status}`];
  for (const spec of payload.specs ?? []) lines.push(`SPEC: ${isText(spec) ? spec : `${spec.path} (${spec.gitStatus})`}`);
  for (const problem of payload.problems ?? []) lines.push(`PROBLEM: ${problem}`);
  if (payload.review !== undefined) lines.push(`REVIEW: ${payload.review.spec} transcript=${payload.review.transcriptPath}`, ...payload.review.riskReasons.map((reason) => `  risk: ${reason}`));
  for (const task of payload.tasks) {
    lines.push(`TASK: ${task.spec} thread=${task.threadId} stage=${task.stage} agent=${task.agent ?? "(pick from AGENTS)"}`);
    lines.push(`  item: ${task.task}`);
    for (const check of task.verification) lines.push(`  verify: ${check.command} -> ${check.expected}`);
  }
  if (payload.availableAgents.length > 0) lines.push(`AGENTS: ${payload.availableAgents.map((agent) => agent.invocable).join(", ")}`);
  for (const thread of payload.pending ?? []) lines.push(`PENDING: ${thread.threadId} ${thread.spec ?? ""} stage=${thread.stage ?? "none"}`);
  for (const item of payload.blocked) lines.push(`BLOCKED: ${item.spec}: ${item.reason}`);
  for (const warning of payload.warnings) lines.push(`WARN: ${warning}`);
  return lines;
}

/** Prints the plan answer. Exit 0: the status is the answer. */
function finishPlan(state: PlanState, status: PlanStatus, extra: PlanExtra, tasks: PlannedTask[] = [], agents: AgentEntry[] = []): number {
  const payload: PlanAnswer = {
    status,
    ...extra,
    tasks,
    availableAgents: agents,
    blocked: state.blocked,
    warnings: state.warnings,
    claims: state.claims,
    opened: state.opened,
  };
  emit(state.json, payload, planText(payload));
  return 0;
}

/** Step 0: verified threads (or specs) not yet committed. Null when there is no debt. */
function commitDebt(state: PlanState): UncommittedEntry[] | null {
  const run = runDarius(["uncommitted-verified", "--json"]);
  if (run.code !== 0) {
    state.warnings.push(`commit-first gate skipped: ${firstLine(run.stderr)}`);
    return null;
  }
  const debt = childJson<UncommittedEntry[]>(run, "uncommitted-verified");
  return debt.length > 0 ? debt : null;
}

/** The first open task label of a spec, through `show --json`; null when none is open. */
function showSpec(spec: string): SpecView {
  return childJson<SpecView>(runDarius(["show", spec, "--json"]), `show ${spec}`);
}

function isText(value: string | number | boolean | readonly string[] | DebtLine | undefined): value is string {
  return typeof value === "string";
}

/** The `agent:` frontmatter value of a spec, or null. */
async function frontmatterAgent(specAbs: string): Promise<string | null> {
  try {
    const grammar = await loadSpecGrammar();
    const value = grammar.parseFrontmatter(readFileSync(specAbs, "utf8")).data["agent"];
    return isText(value) && value.trim() !== "" ? value.trim() : null;
  } catch {
    return null;
  }
}

/** Steps 1 and 2: the specs to plan. Specs waiting on dependencies go to `blocked`. */
function candidateSpecs(state: PlanState, next: NextAnswer, listing: SpecListing[], batch: number): { spec: string; milestone: string; task: string }[] {
  const milestone = next.milestone ?? "";
  for (const entry of listing) {
    if (entry.milestoneSlug === milestone && entry.status === "Waiting") {
      state.blocked.push({ spec: entry.path, reason: `depends_on: ${entry.depends_on.join(", ")}` });
    }
  }
  const picked = [{ spec: next.spec ?? "", milestone, task: next.label ?? "" }];
  if (batch < 2) return picked;
  for (const entry of listing) {
    if (picked.length >= batch) break;
    if (entry.milestoneSlug !== milestone || sameSpec(entry.path, picked[0]?.spec ?? "")) continue;
    if (["Complete", "Skipped", "Waiting", "Archived"].includes(entry.status) || entry.verified >= entry.total) continue;
    if (entry.claim?.state === "held") continue;
    const open = showSpec(entry.path).tasks.find(isOpenTask);
    if (open !== undefined) picked.push({ spec: entry.path, milestone, task: open.label });
  }
  return picked;
}

/** The backticked paths a spec names (`src/x.ts`), for the batch overlap warning. */
function namedPaths(specAbs: string): Set<string> {
  const found = new Set<string>();
  try {
    for (const match of readFileSync(specAbs, "utf8").matchAll(/`([\w./-]+\/[\w.-]+\.\w+)`/gu)) {
      if (match[1] !== undefined) found.add(match[1]);
    }
  } catch {
    // An unreadable spec names nothing.
  }
  return found;
}

function overlapWarnings(candidates: readonly Candidate[]): string[] {
  const warnings: string[] = [];
  for (let a = 0; a < candidates.length; a += 1) {
    for (let b = a + 1; b < candidates.length; b += 1) {
      const left = candidates[a];
      const right = candidates[b];
      if (left === undefined || right === undefined) continue;
      const theirs = namedPaths(right.specAbsPath);
      const shared = [...namedPaths(left.specAbsPath)].filter((path) => theirs.has(path));
      if (shared.length > 0) warnings.push(`${left.spec} and ${right.spec} both name ${shared.slice(0, 3).join(", ")}: run them one after the other`);
    }
  }
  return warnings;
}

const STAMPED = /^\d{4}-\d{2}-\d{2}T|^overridden$/u;

type ReviewStop = { status: "blocked" | "counsel_exhausted"; review: ReviewInfo };

type CandidateCheck = { stop: PlanExtra & { status: PlanStatus } } | { candidates: Candidate[]; review: ReviewInfo | null };

/** Step 3: the spec check and the review stamp of each candidate. Returns the answer when one stops the plan. */
async function checkCandidates(state: PlanState, picked: readonly { spec: string; milestone: string; task: string }[], override: string | undefined): Promise<CandidateCheck> {
  const candidates: Candidate[] = [];
  let review: ReviewInfo | null = null;
  for (const pick of picked) {
    const specAbsPath = resolveTreeArg(pick.spec, process.cwd());
    const { result } = await checkSpecFile(pick.spec, process.cwd());
    for (const warning of result.warnings) state.warnings.push(`${pick.spec}: ${warning}`);
    if (!result.ok) return { stop: { status: "spec_invalid", specs: [pick.spec], problems: result.problems } };
    const reviewInfo: ReviewInfo = { spec: pick.spec, riskReasons: compactReasons(result.riskReasons), transcriptPath: transcriptPath(state.where.trackerRoot, specAbsPath) };
    let needsReview = false;
    if (result.reviewRequired && !STAMPED.test(result.counsel ?? "")) {
      const stop = reviewStop(result.counsel, reviewInfo);
      if (stop !== null && override === undefined) {
        state.blocked.push({ spec: pick.spec, reason: stop.status === "blocked" ? "review rejected" : "review rounds exhausted" });
        return { stop: { status: stop.status, review: stop.review } };
      }
      if (stop !== null && override !== undefined) {
        const run = runDarius(["counsel-gate", "--spec", pick.spec, "--override", override]);
        if (run.code !== 0) throw new RefusalError(`counsel-gate --override refused: ${firstLine(run.stderr)}`, `darius counsel-gate --spec ${pick.spec} --override "<reason>"`);
      } else {
        needsReview = true;
        review ??= reviewInfo;
      }
    }
    candidates.push({ ...pick, specAbsPath, agent: await frontmatterAgent(specAbsPath), needsReview });
  }
  return { candidates, review };
}

function reviewStop(counsel: string | null, review: ReviewInfo): ReviewStop | null {
  if (counsel === "rejected") return { status: "blocked", review };
  if (counsel === "exhausted") return { status: "counsel_exhausted", review };
  return null;
}

function compactReasons(reasons: readonly RiskReason[]): string[] {
  return reasons.map((reason) => clip(`${reason.pattern} (${reason.class}) line ${String(reason.line)}: ${reason.text}`, NOTE_MAX));
}

/** A refusal with the command that comes next (exit 1). */
class RefusalError extends Error {
  readonly next: string;
  constructor(message: string, next: string) {
    super(message);
    this.next = next;
  }
}

/** Step 5: the open threads of a milestone, and a short context line for each. */
function milestoneThreads(milestone: string): ThreadListing[] {
  const run = runDarius(["worklog", "list", "--active", "--milestone", milestone, "--json"]);
  if (run.code !== 0) return [];
  return childJson<{ threads: ThreadListing[] }>(run, "worklog list").threads;
}

function threadContext(legacy: WorkLegacy, trackerRoot: string, milestone: string, threads: readonly ThreadListing[]): ContextLine[] {
  const notes = new Map<string, string>();
  for (const scan of legacy.scanWorklogDir(trackerRoot, milestone)) {
    for (const thread of scan.doc.threads) {
      const note = lastNote(thread);
      if (note !== null) notes.set(thread.threadId, clip(note, NOTE_MAX));
    }
  }
  return threads.map((thread) => ({ id: thread.threadId, spec: thread.specPath ?? null, stage: thread.stage ?? null, note: notes.get(thread.threadId) ?? null }));
}

/** Step 6: claims the spec, then reuses or opens its thread. Null when the spec is dropped. */
function claimAndOpen(state: PlanState, candidate: Candidate, threads: readonly ThreadListing[]): ThreadListing | null {
  const claim = runDarius(["claim", candidate.spec, ...sessionArgs(state.session)]);
  if (claim.code !== 0) {
    state.blocked.push({ spec: candidate.spec, reason: `claim refused: ${firstLine(claim.stderr)}` });
    return null;
  }
  const claimed = claim.stdout.split("\n").find((line) => /CLAIMED|TAKEN OVER|TAKEOVER/u.test(line));
  if (claimed !== undefined) {
    state.claims.push(claimed.trim());
    console.error(claimed.trim());
  }
  const reuse = threads.find((thread) => thread.specPath !== undefined && sameSpec(thread.specPath, candidate.spec));
  if (reuse !== undefined) return reuse;
  const open = runDarius(["worklog", "open", candidate.milestone, "--spec", candidate.spec, "--message", candidate.task, "--stage", "planned", ...sessionArgs(state.session)]);
  if (open.code !== 0) {
    state.blocked.push({ spec: candidate.spec, reason: `worklog open refused: ${firstLine(open.stderr)}` });
    runDarius(["release", candidate.spec, ...sessionArgs(state.session)]);
    return null;
  }
  const threadId = open.stdout.trim().split("\n").pop() ?? "";
  const line = `OPENED: ${threadId} ${candidate.spec}`;
  state.opened.push(threadId);
  console.error(line);
  return { threadId, specPath: candidate.spec, stage: "planned", worklogFile: `${candidate.milestone}.md` };
}

/** Step 7: the roster, with each description cut short. */
function roster(): AgentEntry[] {
  const run = runDarius(["agents", "--json"]);
  if (run.code !== 0) return [];
  return childJson<AgentEntry[]>(run, "agents").map((agent) => ({ invocable: agent.invocable, description: clip(agent.description, NOTE_MAX) }));
}

function pickAgent(wanted: string | null, agents: readonly AgentEntry[]): string | null {
  if (agents.length === 0) return "main";
  if (wanted !== null && agents.some((agent) => agent.invocable === wanted)) return wanted;
  return null;
}

async function runPlan(args: ParsedArgs): Promise<number> {
  if (args.positional.length > 1) throw new UsageError(USAGE);
  const batch = positiveInt(stringFlag(args, "batch"), "batch", 1);
  const override = stringFlag(args, "override");
  if (override !== undefined && override.trim() === "") throw new UsageError("--override needs a non-empty reason");
  const where = treeHere("plan");
  if (where === null) return 3;
  const state: PlanState = { json: args.json, where, session: stringFlag(args, "session"), warnings: [], blocked: [], claims: [], opened: [] };

  if (args.flags["skip-commit-first"] !== true) {
    const debt = commitDebt(state);
    if (debt !== null) {
      const specs = debt.map((entry): DebtLine => ({ path: entry.path, gitStatus: entry.gitStatus, threadId: entry.threadId ?? null, dirtyArtifacts: entry.dirtyArtifacts ?? [] }));
      return finishPlan(state, "commit_first", { specs });
    }
  }

  const nextRun = runDarius(["next", "--json", ...sessionArgs(state.session)]);
  const next = childJson<NextAnswer>(nextRun, "next");
  for (const held of next.skippedClaimed ?? []) state.blocked.push({ spec: held.spec, reason: `claimed by session ${held.session ?? "unknown"} on ${held.host ?? "unknown host"}` });
  if (next.status === "broken") return finishPlan(state, "spec_invalid", { specs: [`${next.milestone ?? ""}/${next.file ?? ""}`], problems: [next.error ?? "the spec does not parse"] });
  if (next.status === "claimed") return finishPlan(state, "blocked", { problems: ["every ready spec is claimed by another live session"] });
  if (next.status === "complete") return finishPlan(state, "complete", { pending: pendingThreads() });

  const listing = childJson<SpecListing[]>(runDarius(["list", "specs", "--json", ...sessionArgs(state.session)]), "list specs");
  const picked = candidateSpecs(state, next, listing, batch);
  for (const pick of picked) pick.spec = specName(pick.spec);
  const checked = await checkCandidates(state, picked, override);
  if ("stop" in checked) {
    const { status, ...rest } = checked.stop;
    return finishPlan(state, status, rest);
  }
  const { candidates, review } = checked;
  state.warnings.push(...overlapWarnings(candidates));

  const legacy = await loadWorkLegacy();
  const milestone = candidates[0]?.milestone ?? "";
  const threads = milestoneThreads(milestone);
  const context = threadContext(legacy, where.trackerRoot, milestone, threads);
  const agents = roster();
  const tasks: PlannedTask[] = [];
  for (const candidate of candidates) {
    const thread = claimAndOpen(state, candidate, threads);
    if (thread === null) continue;
    const view = showSpec(candidate.spec);
    const transcript = transcriptPath(where.trackerRoot, candidate.specAbsPath);
    tasks.push({
      spec: candidate.spec,
      specAbsPath: candidate.specAbsPath,
      milestone: candidate.milestone,
      task: candidate.task,
      threadId: thread.threadId,
      stage: thread.stage ?? "planned",
      worklogPath: join(where.trackerRoot, "worklog", thread.worklogFile),
      agent: pickAgent(candidate.agent, agents),
      verification: view.tasks.filter(isOpenTask).flatMap((task) => (task.command !== null && task.expected !== null ? [{ command: task.command, expected: task.expected }] : [])),
      priorArtifacts: legacy.artifactPathsOf(thread.artifacts ?? [], where.checkout),
      counselTranscript: existsSync(transcript) ? transcript : null,
    });
  }
  if (tasks.length === 0) return finishPlan(state, "blocked", { context, problems: ["no spec could be claimed"] }, [], agents);
  if (review !== null && tasks.some((task) => sameSpec(task.spec, review.spec))) return finishPlan(state, "review_required", { review, context }, tasks, agents);
  return finishPlan(state, "ready", { context }, tasks, agents);
}

/** Open threads that still owe a stage before `reviewed`, for a `complete` answer. */
function pendingThreads(): PendingLine[] {
  const run = runDarius(["worklog", "list", "--active", "--json"]);
  if (run.code !== 0) return [];
  return childJson<{ threads: ThreadListing[] }>(run, "worklog list")
    .threads.filter((thread) => thread.stage !== undefined && thread.stage !== "reviewed")
    .map((thread) => ({ threadId: thread.threadId, spec: thread.specPath ?? null, stage: thread.stage ?? null }));
}

// ---------------------------------------------------------------------------
// work verify
// ---------------------------------------------------------------------------

/** Scan hits that fail verification. Every other hit is a warning. */
const CRITICAL_PATTERNS: ReadonlySet<string> = new Set([
  "console.log",
  "console.debug",
  "console.trace",
  "debugger",
  "var_dump()",
  'throw new Error("not implemented")',
  "trivial assertion",
]);

interface VerifyAnswer {
  status: "pass" | "fail" | "manual";
  reason?: "artifacts" | "stubs" | "verification" | "spec_grammar";
  findings: string[];
  warnings: string[];
  verified: number;
  total: number;
  manual: { index: number; label: string }[];
  touched: string[];
  stamp?: string;
}

/** A touched path as the worklog records it: relative to the checkout, `/` separators. */
function repoRelative(path: string, checkout: string): string {
  const absolute = isAbsolute(path) ? path : resolve(process.cwd(), path);
  return relative(checkout, absolute).split("\\").join("/");
}

function scanHits(legacy: WorkLegacy, files: readonly string[], checkout: string, scan: "artifacts" | "stubs"): LegacyScanMatch[] {
  const hits: LegacyScanMatch[] = [];
  for (const file of files) {
    const path = join(checkout, file);
    if (!existsSync(path)) continue;
    hits.push(...(scan === "artifacts" ? legacy.scanArtifacts({ path }) : legacy.scanStubs({ path })));
  }
  return hits;
}

function hitText(hit: LegacyScanMatch, checkout: string): string {
  return clip(`${repoRelative(hit.file, checkout)}:${String(hit.line)}: ${hit.pattern}`, FINDING_MAX);
}

/** Lines `  [3] label...` of a verify report section. */
function indexedLines(text: string): { index: number; label: string }[] {
  const found: { index: number; label: string }[] = [];
  for (const line of text.split("\n")) {
    const match = /^\s+\[(\d+)\] (.*)$/u.exec(line);
    if (match?.[1] !== undefined && match[2] !== undefined) found.push({ index: Number(match[1]), label: match[2] });
  }
  return found;
}

/** The manual items `verify` listed on stdout. */
function manualItems(stdout: string): { index: number; label: string }[] {
  const at = stdout.indexOf("\nManual items");
  if (at === -1) return [];
  const section = stdout.slice(at + 1).split("\n\n")[0] ?? "";
  return indexedLines(section).map((item) => ({ index: item.index, label: clip(item.label, NOTE_MAX) }));
}

function verifyText(answer: VerifyAnswer, spec: string): string[] {
  const lines = [`STATUS: ${answer.status}${answer.reason === undefined ? "" : ` (${answer.reason})`}`, `SPEC: ${spec}`, `VERIFIED: ${String(answer.verified)}/${String(answer.total)}`];
  for (const finding of answer.findings) lines.push(`FINDING: ${finding}`);
  for (const item of answer.manual) lines.push(`MANUAL: [${String(item.index)}] ${item.label}`);
  for (const warning of answer.warnings) lines.push(`WARN: ${warning}`);
  if (answer.stamp !== undefined) lines.push(answer.stamp);
  lines.push(`TOUCHED_FILES: ${answer.touched.join(", ")}`);
  return lines;
}

interface VerifyRun {
  spec: string;
  thread: string;
  timeout: string | undefined;
  touched: string[];
  json: boolean;
}

/** Logs a failure on the thread (one note) and prints the answer. Exit 1. */
function failVerify(run: VerifyRun, answer: VerifyAnswer): number {
  runDarius(["worklog", "append", run.thread, "--section", "note", "--message", clip(`Verify: fail (${answer.reason ?? "verification"}): ${answer.findings.join("; ")}`, 400)]);
  emit(run.json, { ...answer, next: verifyAgain(run) }, verifyText(answer, run.spec));
  console.error(`  next: fix the findings, then run: ${verifyAgain(run)}`);
  return 1;
}

function verifyAgain(run: VerifyRun): string {
  return `darius work verify ${run.spec} --thread ${run.thread} --touched ${run.touched.join(",") || '""'}`;
}

/** Runs `verify` on the spec; with `recheck` it re-proves ticked items too. */
function runVerifyVerb(run: VerifyRun, recheck: boolean): ChildRun {
  return runDarius(["verify", run.spec, ...(recheck ? ["--recheck"] : []), ...(run.timeout === undefined ? [] : ["--timeout", run.timeout])]);
}

/** The reason a failed `verify` names: a spec the grammar cannot read, or a check that failed. */
interface VerifyFailure {
  reason: "verification" | "spec_grammar";
  findings: string[];
}

function verifyFailure(result: ChildRun): VerifyFailure {
  const items = indexedLines(result.stderr).map((item) => clip(`[${String(item.index)}] ${item.label}`, FINDING_MAX));
  const grammar = /parse error:|grammar error:/u.test(result.stderr);
  const findings = items.length > 0 ? items : [clip(firstLine(result.stderr), FINDING_MAX)];
  return { reason: grammar ? "spec_grammar" : "verification", findings };
}

/** Appends the touched paths the thread does not record yet. Returns the refusal, or null. */
function appendArtifacts(legacy: WorkLegacy, where: Extract<TrackerWhere, { trackerRoot: string }>, run: VerifyRun): string | null {
  if (run.touched.length === 0) return null;
  const recorded = new Set<string>();
  for (const scan of legacy.scanWorklogDir(where.trackerRoot)) {
    const thread = scan.doc.threads.find((item) => item.threadId === run.thread);
    if (thread === undefined) continue;
    const texts = thread.entries.flatMap((entry) => (entry.kind === "artifact" && entry.path !== undefined ? [entry.path] : []));
    for (const path of legacy.artifactPathsOf(texts, where.checkout)) recorded.add(path);
  }
  const fresh = run.touched.filter((path) => !recorded.has(path));
  if (fresh.length === 0) return null;
  const append = runDarius(["worklog", "append", run.thread, "--section", "Artifacts", "--message", fresh.join(", ")]);
  return append.code === 0 ? null : firstLine(append.stderr);
}

/** `set-stage verified`; when the ledger has no line since the dispatch for an old tick, one `verify --recheck` first. */
function stampVerified(run: VerifyRun): { stamp: string } | { refusal: string } {
  let stage = runDarius(["worklog", "set-stage", run.thread, "verified"]);
  if (stage.code !== 0 && /no passing ledger line/u.test(stage.stderr)) {
    const recheck = runVerifyVerb(run, true);
    if (recheck.code === 0) stage = runDarius(["worklog", "set-stage", run.thread, "verified"]);
  }
  if (stage.code !== 0) return { refusal: firstLine(stage.stderr) };
  return { stamp: stage.stdout.trim().replace(/^darius worklog /u, "") };
}

async function runVerify(args: ParsedArgs): Promise<number> {
  const spec = args.positional[1];
  const thread = stringFlag(args, "thread");
  const touchedFlag = args.flags.touched;
  if (spec === undefined || args.positional.length > 2 || thread === undefined || touchedFlag === undefined || touchedFlag === false) throw new UsageError(USAGE);
  const where = treeHere("verify");
  if (where === null) return 3;
  if (!existsSync(resolveTreeArg(spec, process.cwd()))) {
    console.error(`darius work verify: no spec at ${spec}`);
    console.error("  next: darius list specs --json");
    return 1;
  }
  const raw = touchedFlag === true ? "" : touchedFlag;
  const touched = [...new Set(raw.split(/[,\n]/u).map((part) => part.trim()).filter((part) => part !== "").map((part) => repoRelative(part, where.checkout)))];
  const timeout = stringFlag(args, "timeout");
  if (timeout !== undefined) positiveInt(timeout, "timeout", 60);
  const run: VerifyRun = { spec, thread, timeout, touched, json: args.json };
  const legacy = await loadWorkLegacy();
  // A child verb first: in store mode it applies the store to the tree before anything reads it.
  const open = childJson<{ threads: ThreadListing[] }>(runDarius(["worklog", "list", "--active", "--json"]), "worklog list").threads;
  if (!open.some((item) => item.threadId === thread)) {
    console.error(`darius work verify: no open thread ${thread}`);
    console.error("  next: darius worklog list --active --json");
    return 1;
  }
  const answer: VerifyAnswer = { status: "pass", findings: [], warnings: [], verified: 0, total: 0, manual: [], touched };

  for (const scan of ["artifacts", "stubs"] as const) {
    const hits = scanHits(legacy, touched, where.checkout, scan);
    const critical = hits.filter((hit) => CRITICAL_PATTERNS.has(hit.pattern));
    answer.warnings.push(...hits.filter((hit) => !CRITICAL_PATTERNS.has(hit.pattern)).slice(0, 10).map((hit) => hitText(hit, where.checkout)));
    if (critical.length > 0) return failVerify(run, { ...answer, status: "fail", reason: scan, findings: critical.slice(0, 10).map((hit) => hitText(hit, where.checkout)) });
  }

  const verified = runVerifyVerb(run, false);
  runDarius(["index", "--rebuild"]);
  const view = showSpec(spec);
  answer.verified = view.verified;
  answer.total = view.total;
  if (verified.code !== 0) return failVerify(run, { ...answer, status: "fail", ...verifyFailure(verified) });
  answer.manual = manualItems(verified.stdout);
  const unchecked = view.tasks.filter((task) => task.state !== "verified" && task.state !== "skipped" && !answer.manual.some((item) => item.index === task.index));
  if (unchecked.length > 0) {
    const findings = unchecked.map((task) => clip(`[${String(task.index)}] ${task.label}: no Command/Expected pair`, FINDING_MAX));
    return failVerify(run, { ...answer, status: "fail", reason: "spec_grammar", findings });
  }

  const refused = appendArtifacts(legacy, where, run);
  if (refused !== null) return failVerify(run, { ...answer, status: "fail", reason: "artifacts", findings: [clip(`Artifacts entry refused: ${refused}`, FINDING_MAX)] });

  if (answer.manual.length > 0) {
    answer.status = "manual";
    emit(args.json, { ...answer }, verifyText(answer, spec));
    return 0;
  }
  const stamped = stampVerified(run);
  if ("refusal" in stamped) return failVerify(run, { ...answer, status: "fail", reason: "verification", findings: [clip(stamped.refusal, FINDING_MAX)] });
  answer.stamp = stamped.stamp;
  console.error(stamped.stamp);
  emit(args.json, { ...answer }, verifyText(answer, spec));
  return 0;
}

// ---------------------------------------------------------------------------
// work commit-check
// ---------------------------------------------------------------------------

interface CheckedThread {
  spec: string;
  threadId: string | null;
  stage: string | null;
  artifacts: string[];
  dirty: string[];
}

/** `Tracker: M1-x/01-y 3/5 -> 4/5 verified`, the before count from the ledger and the dispatch stamp. */
function trailerLine(legacy: WorkLegacy, trackerRoot: string, spec: string, thread: ThreadListing | undefined): string {
  const view = showSpec(spec);
  const now = `${String(view.verified)}/${String(view.total)} verified`;
  const dispatched = (thread?.stamps ?? []).toReversed().find((stamp) => stamp.stage === "dispatched")?.at;
  const since = Date.parse(dispatched ?? "");
  if (Number.isNaN(since)) return `Tracker: ${spec} ${now}`;
  const key = legacy.toLedgerSpecPath(trackerRoot, resolveTreeArg(spec, process.cwd()));
  const lines = legacy.readLedger(trackerRoot).filter((line) => line.spec === key && isPassingLine(line));
  let fresh = 0;
  for (const task of view.tasks) {
    if (task.state !== "verified") continue;
    const times = lines.filter((line) => line.index === task.index).map((line) => Date.parse(line.at));
    if (times.length > 0 && times.every((at) => at >= since)) fresh += 1;
  }
  return `Tracker: ${spec} ${String(view.verified - fresh)}/${String(view.total)} -> ${now}`;
}

function pendingSync(trackerRoot: string): string[] {
  const path = join(trackerRoot, ".pending-sync");
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

function commitText(status: string, payload: { threads: CheckedThread[]; add: string[]; problems: string[]; warnings: string[]; trailer: string }): string[] {
  const lines = [`STATUS: ${status}`];
  for (const thread of payload.threads) lines.push(`THREAD: ${thread.threadId ?? "(none)"} ${thread.spec} stage=${thread.stage ?? "none"} dirty=${thread.dirty.join(",")}`);
  if (payload.add.length > 0) lines.push(`ADD: ${payload.add.join(" ")}`);
  for (const problem of payload.problems) lines.push(`PROBLEM: ${problem}`);
  for (const warning of payload.warnings) lines.push(`WARN: ${warning}`);
  lines.push(`TRAILER: ${payload.trailer.split("\n").join(" | ")}`);
  return lines;
}

/**
 * Git mode (deprecated) commits the tracker record with the code: the scoped
 * spec files, their worklog files, the index and the ledger, when dirty.
 * Store mode commits code only.
 */
function gitModeTrackerFiles(legacy: WorkLegacy, where: Extract<TrackerWhere, { trackerRoot: string }>, checked: readonly CheckedThread[], threads: readonly ThreadListing[]): string[] {
  if (where.mode !== "git") return [];
  const inTree = (path: string): string => relative(where.checkout, join(where.trackerRoot, path)).split("\\").join("/");
  const files = new Set([inTree("00-INDEX.md"), inTree(".verification-log.jsonl")]);
  for (const thread of checked) {
    files.add(relative(where.checkout, resolveTreeArg(thread.spec, process.cwd())).split("\\").join("/"));
    const listed = threads.find((item) => item.threadId === thread.threadId);
    if (listed !== undefined) files.add(inTree(`worklog/${listed.worklogFile}`));
  }
  return legacy.dirtyArtifacts(where.checkout, [...files]) ?? [];
}

async function runCommitCheck(args: ParsedArgs): Promise<number> {
  const specs = args.positional.slice(1);
  if (specs.length === 0) throw new UsageError(USAGE);
  const where = treeHere("commit-check");
  if (where === null) return 3;
  const index = runDarius(["index", "--rebuild"]);
  const legacy = await loadWorkLegacy();
  const listRun = runDarius(["worklog", "list", "--active", "--json"]);
  const threads = childJson<{ threads: ThreadListing[] }>(listRun, "worklog list").threads;
  const problems: string[] = [];
  const nextLines: string[] = [];
  const warnings: string[] = index.code === 0 ? [] : [`index rebuild failed: ${firstLine(index.stderr)}`];
  const checked: CheckedThread[] = [];
  const trailer: string[] = [];
  for (const spec of specs) {
    if (!existsSync(resolveTreeArg(spec, process.cwd()))) {
      problems.push(`${spec}: no such spec`);
      nextLines.push("darius list specs --json");
      continue;
    }
    const thread = threads.find((item) => item.specPath !== undefined && sameSpec(item.specPath, spec));
    trailer.push(trailerLine(legacy, where.trackerRoot, spec, thread));
    if (thread === undefined) {
      problems.push(`${spec}: no open worklog thread`);
      nextLines.push("darius worklog list --active --json");
      checked.push({ spec, threadId: null, stage: null, artifacts: [], dirty: [] });
      continue;
    }
    const artifacts = legacy.artifactPathsOf(thread.artifacts ?? [], where.checkout);
    const dirty = legacy.dirtyArtifacts(where.checkout, artifacts) ?? [];
    checked.push({ spec, threadId: thread.threadId, stage: thread.stage ?? null, artifacts, dirty });
    if (thread.stage !== "verified") {
      problems.push(`${spec}: thread ${thread.threadId} is at stage ${thread.stage ?? "none"}, not verified`);
      nextLines.push(`darius work verify ${spec} --thread ${thread.threadId} --touched <files>`);
    } else if (artifacts.length === 0) {
      problems.push(`${spec}: thread ${thread.threadId} records no artifacts; a spec with no code takes --no-code`);
      nextLines.push(`darius worklog set-stage ${thread.threadId} committed --no-code "<why no code changed>"`);
    } else if (dirty.length === 0) {
      problems.push(`${spec}: nothing to commit, its artifacts are clean; if the code is in a commit already, stamp that commit`);
      nextLines.push(`darius worklog set-stage ${thread.threadId} committed --commit <sha>`);
    }
  }
  const drift = pendingSync(where.trackerRoot);
  if (drift.length > 0) warnings.push(`.pending-sync lists ${String(drift.length)} file(s) changed outside the loop: ${clip(drift.join(", "), NOTE_MAX)}`);
  const add = [...new Set([...checked.flatMap((thread) => thread.dirty), ...gitModeTrackerFiles(legacy, where, checked, threads)])];
  const status = problems.length === 0 ? "ready" : "refused";
  const payload = { threads: checked, add, problems, warnings, trailer: trailer.join("\n"), indexRebuilt: index.code === 0, mode: where.mode };
  emit(args.json, problems.length === 0 ? payload : { ...payload, next: nextLines }, commitText(status, payload));
  if (problems.length === 0) return 0;
  for (const line of nextLines) console.error(`  next: ${line}`);
  return 1;
}

// ---------------------------------------------------------------------------
// The command
// ---------------------------------------------------------------------------

async function runWork(args: ParsedArgs): Promise<number> {
  const verb = args.positional[0];
  try {
    if (verb === "plan") return await runPlan(args);
    if (verb === "verify") return await runVerify(args);
    if (verb === "commit-check") return await runCommitCheck(args);
  } catch (error) {
    if (error instanceof StepError) {
      console.error(`darius work ${verb ?? ""}: ${error.message}`);
      return 3;
    }
    if (error instanceof RefusalError) {
      console.error(`darius work ${verb ?? ""}: ${error.message}`);
      console.error(`  next: ${error.next}`);
      return 1;
    }
    throw error;
  }
  if (verb === undefined) throw new UsageError(USAGE);
  throw new UsageError(`work: unknown verb "${verb}". Valid: plan, verify, commit-check\n${USAGE}`);
}

export const workCommand: Command = {
  name: "work",
  help: USAGE,
  flags: ["batch", "skip-commit-first", "override", "session", "thread", "touched", "timeout"],
  audience: "session",
  summary: "Work Loop steps, one call each",
  usage: "work plan|verify|commit-check",
  run: runWork,
};
