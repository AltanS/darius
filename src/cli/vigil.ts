/**
 * `darius vigil <verb>`: add, set-body, list, show, close and sweep vigils.
 *
 *   vigil add <slug> [--name N | --title N] (--due YYYY-MM-DD | --until TEXT)
 *             [--from REF] [--agent A] [--opened YYYY-MM-DD]
 *             [--stdin | --content TEXT] [--gate-command CMD] [--heavy] [--who W]
 *   vigil set-body <slug> (--stdin | --content TEXT)
 *   vigil list [--all] [--json]
 *   vigil show <slug>
 *   vigil close <slug> --verdict held|failed [--date YYYY-MM-DD]
 *   vigil sweep [--all-projects] [--only SLUG] [--include-heavy] [--daily]
 *               [--classify-only] [--dry-run] [--timeout SECONDS] [--who W]
 *
 * `add`, `set-body`, `list` and `close` take the command-line forms of the
 * legacy tracker's verbs, so skills, the darius agent and existing vigil
 * Commands keep working: the same flags, the same `--json` array, the same
 * text lines. `--content` is a file path as the legacy verb read it; a value
 * that is no file is taken as the body text. A body is checked with the
 * legacy `assertVigilBodyIsWorkable` (src/core/vigil-body.ts).
 *
 * After a write the vigils are projected as read-only legacy files under the
 * project's tree directory (src/core/vigil-projection.ts).
 *
 * The sweep rules live in src/core/sweep.ts. Commands run in the project's working
 * dir on this host (src/core/workdir.ts). A project whose checkout is not on
 * this host is skipped (`no-workdir`) with --all-projects or --daily, and
 * refused when named alone.
 *
 * `--daily` is what the timer runs: each project is swept at most once per
 * local day across every host that shares the bucket
 * (src/core/sweep-lease.ts). A project another host swept today, or is
 * sweeping now, is skipped.
 *
 * Exit codes: 0 when the sweep ran, even when vigils failed (failures are
 * data), and when a project was skipped for another host; 1 on a real error,
 * including a sweep started inside another sweep; 2 usage; 3 when `bash`
 * cannot start (every check would read as failed) or the bucket cannot be
 * reached for the daily lease.
 */

import { existsSync, readFileSync, statSync } from "node:fs";

import { loadConfigIfPresent } from "../core/config.ts";
import { loadCredentials } from "../core/credentials.ts";
import { defaultWho, hostId, linesFor, readLedger } from "../core/ledger.ts";
import type { LeaseBlock } from "../core/lease.ts";
import type { Vigil } from "../core/model.ts";
import { projectDir, resolveProject } from "../core/paths.ts";
import { createS3, type S3 } from "../core/s3.ts";
import { itemRef, listProjects, openProject, type Project } from "../core/store.ts";
import { pruneSweepLeases, takeSweepLease } from "../core/sweep-lease.ts";
import { projectWorkdir } from "../core/workdir.ts";
import {
  addVigil,
  assertNotNested,
  closeVigil,
  commandsOf,
  invokesSweep,
  isBashAvailable,
  latestEvidence,
  localToday,
  sweepProject,
  vigilStatus,
  type SweepOptions,
  type SweepResult,
  type SweptVigil,
  type VigilStatus,
} from "../core/sweep.ts";
import { checkVigilBody, commandCount } from "../core/vigil-body.ts";
import { projectedVigilPath, projectVigils, treeDirOf } from "../core/vigil-projection.ts";
import { isCalendarDate, localNoonIso, readVigilViews, type VigilView } from "../core/vigil-view.ts";
import { errorMessage } from "../runtime.ts";
import { UsageError, type Command, type ParsedArgs } from "./registry.ts";

const VERBS = "add | set-body | list | show | close | sweep";

function stringFlag(args: ParsedArgs, name: string): string | undefined {
  const value = args.flags[name];
  if (value === undefined || value === false) return undefined;
  if (value === true) throw new UsageError(`--${name} needs a value`);
  return value;
}

function isFlagSet(args: ParsedArgs, name: string): boolean {
  return args.flags[name] === true;
}

function requireSlug(args: ParsedArgs, verb: string): string {
  const slug = args.positional[1];
  if (slug === undefined || slug === "") throw new UsageError(`vigil ${verb} needs a <slug>`);
  return slug;
}

function currentProject(args: ParsedArgs, opts?: { create?: boolean }): Project {
  return openProject(resolveProject(stringFlag(args, "project")), opts);
}

function printJson<T>(value: T): void {
  console.log(JSON.stringify(value));
}

// --- shared: flags, bodies, the projected files --------------------------------

/** The legacy text lines use an em dash. It is kept only so the output stays compatible. */
const LEGACY_DASH = "\u2014";

function dateFlag(args: ParsedArgs, name: string): string | undefined {
  const value = stringFlag(args, name)?.trim();
  if (value === undefined || value === "") return undefined;
  if (!isCalendarDate(value)) throw new UsageError(`--${name} must be a date as YYYY-MM-DD, got '${value}'`);
  return value;
}

function textFlag(args: ParsedArgs, name: string): string | undefined {
  const value = stringFlag(args, name)?.trim();
  return value === undefined || value === "" ? undefined : value;
}

/** `--content`: a file path (the legacy form); a value that is no file is the body text itself. */
function contentOf(value: string): string {
  try {
    if (!value.includes("\n") && statSync(value).isFile()) return readFileSync(value, "utf8");
  } catch {
    // Not a readable file: the value is the text.
  }
  return value;
}

/** The body from `--stdin` or `--content`; undefined when neither was given. */
function suppliedBody(args: ParsedArgs, verb: string): string | undefined {
  const content = stringFlag(args, "content");
  const isStdin = isFlagSet(args, "stdin");
  if (content !== undefined && isStdin) throw new UsageError(`vigil ${verb}: --content and --stdin are mutually exclusive`);
  if (isStdin) return args.stdin ?? "";
  return content === undefined ? undefined : contentOf(content);
}

/** Brings the read-only legacy files in line with the store. A failure warns; the write already happened. */
function refreshProjection(project: Project): void {
  try {
    projectVigils(project, treeDirOf(project));
  } catch (cause) {
    console.error(`darius: warning: the legacy vigil files were not refreshed: ${errorMessage(cause)}`);
  }
}

// --- add ------------------------------------------------------------------------

async function runAdd(args: ParsedArgs): Promise<number> {
  const slug = requireSlug(args, "add");
  const name = textFlag(args, "name") ?? textFlag(args, "title") ?? slug;
  const due = dateFlag(args, "due");
  const until = textFlag(args, "until");
  if (due === undefined && until === undefined) {
    throw new UsageError('a vigil needs a gate: provide --due <YYYY-MM-DD> and/or --until "<event>"');
  }
  const opened = dateFlag(args, "opened");
  const body = suppliedBody(args, "add");
  const project = currentProject(args, { create: true });
  if (project.readItem("vigil", slug) !== null) {
    if (args.json) printJson({ project: project.name, exists: true, slug });
    else console.log(`already exists: vigil ${slug}`);
    return 0;
  }
  const checked =
    body === undefined
      ? { body: `# ${name}\n`, executableCommands: 0 }
      : await checkVigilBody({ body, title: name, slug, context: `refusing to write vigil ${slug} in ${project.name}` });
  const who = stringFlag(args, "who") ?? defaultWho();
  const doc = addVigil(project, {
    slug,
    title: name,
    body: checked.body,
    due,
    until,
    gate_command: stringFlag(args, "gate-command"),
    heavy: isFlagSet(args, "heavy"),
    from: textFlag(args, "from"),
    agent: textFlag(args, "agent"),
    created: opened === undefined ? undefined : localNoonIso(opened),
    who,
  });
  refreshProjection(project);
  if (args.json) printJson({ project: project.name, added: doc.header, executableCommands: checked.executableCommands });
  else console.log(`created vigil ${slug} in ${project.name} (${commandCount(checked.executableCommands)})`);
  return 0;
}

// --- set-body -------------------------------------------------------------------

async function runSetBody(args: ParsedArgs): Promise<number> {
  const slug = requireSlug(args, "set-body");
  const body = suppliedBody(args, "set-body");
  if (body === undefined) throw new UsageError("vigil set-body needs --stdin or --content");
  const project = currentProject(args);
  const doc = project.readItem<Vigil>("vigil", slug);
  if (doc === null) throw new Error(`no vigil '${slug}' in ${project.name}`);
  const checked = await checkVigilBody({
    body,
    title: doc.header.title,
    slug,
    context: `refusing to rewrite vigil ${slug} in ${project.name}`,
  });
  const selfInvoking = commandsOf(checked.body, doc.header.gate_command).find(invokesSweep);
  if (selfInvoking !== undefined) throw new Error(`refusing vigil '${slug}': its Command starts a sweep (${selfInvoking})`);
  const who = stringFlag(args, "who") ?? defaultWho();
  project.withLock(() => {
    const current = project.readItem<Vigil>("vigil", slug);
    if (current === null) throw new Error(`no vigil '${slug}' in ${project.name}`);
    const status = vigilStatus(slug, linesFor(readLedger(project), itemRef("vigil", slug)));
    if (status.state === "closed") {
      throw new Error(
        `vigil '${slug}' is closed (verdict ${status.verdict ?? "?"}): a closed vigil is a historical claim, not a draft, and its body is not rewritten`,
      );
    }
    project.writeItem({ header: { ...current.header, updated: new Date().toISOString() }, body: checked.body }, { who });
  });
  refreshProjection(project);
  if (args.json) printJson({ project: project.name, slug, executableCommands: checked.executableCommands });
  else console.log(`wrote vigil ${slug} in ${project.name} (${commandCount(checked.executableCommands)})`);
  return 0;
}

// --- list and show --------------------------------------------------------------

function gateSummary(view: VigilView): string {
  const parts: string[] = [];
  if (view.due !== null) parts.push(`due ${view.due}`);
  if (view.until !== null) parts.push(`until: ${view.until}`);
  return parts.length > 0 ? `(${parts.join("; ")})` : "(no gate)";
}

/** The legacy `vigil list` text line: open vigils show their gate, closed ones their verdict. */
function listLine(view: VigilView): string {
  const from = view.from === null ? "" : `  [from ${view.from}]`;
  if (view.state === "open") {
    return `${view.slug}  ${gateSummary(view)}  ${LEGACY_DASH} ${view.name}  (opened ${view.opened ?? LEGACY_DASH})${from}`;
  }
  return `${view.slug}  [${view.verdict ?? "closed"}, resolved ${view.resolved ?? LEGACY_DASH}]  ${LEGACY_DASH} ${view.name}${from}`;
}

/** One record of `vigil list --json`: the legacy fields in legacy order, then the native ones. */
function listRecord(view: VigilView, treeDir: string | null): JsonRecord {
  const projected = treeDir === null ? "" : projectedVigilPath(treeDir, view.slug);
  return {
    slug: view.slug,
    name: view.name,
    due: view.due,
    until: view.until,
    from: view.from,
    agent: view.agent,
    opened: view.opened,
    resolved: view.resolved,
    verdict: view.verdict,
    path: projected !== "" && existsSync(projected) ? projected : "",
    state: view.state,
    flagged: view.flagged,
    heavy: view.heavy,
    lastOutcome: view.lastOutcome,
  };
}

interface JsonRecord {
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
  state: "open" | "closed";
  flagged: boolean;
  heavy: boolean;
  lastOutcome: string | null;
}

function runList(args: ParsedArgs): number {
  const name = resolveProject(stringFlag(args, "project"));
  // A project with no store yet has no vigils: the legacy list printed "No open vigils" for an empty tree.
  const project = existsSync(projectDir(name)) ? openProject(name) : null;
  const isAll = isFlagSet(args, "all");
  const views = (project === null ? [] : readVigilViews(project)).filter((view) => isAll || view.state === "open");
  if (args.json) {
    const treeDir = project === null ? null : treeDirOf(project);
    console.log(JSON.stringify(views.map((view) => listRecord(view, treeDir)), null, 2));
    return 0;
  }
  if (views.length === 0) console.log(isAll ? "No vigils" : "No open vigils");
  for (const view of views) console.log(listLine(view));
  return 0;
}

function stateLabel(status: VigilStatus): string {
  if (status.state === "closed") return `closed ${status.verdict ?? ""}`.trimEnd();
  if (status.flagged) return "open, FLAGGED";
  return "open";
}

function runShow(args: ParsedArgs): number {
  const slug = requireSlug(args, "show");
  const project = currentProject(args);
  const doc = project.readItem<Vigil>("vigil", slug);
  if (doc === null) throw new Error(`no vigil '${slug}' in ${project.name}`);
  const lines = linesFor(readLedger(project), itemRef("vigil", slug));
  const status = vigilStatus(slug, lines);
  const evidence = [...latestEvidence(slug, lines).values()];
  if (args.json) {
    printJson({ project: project.name, header: doc.header, body: doc.body, status, evidence });
    return 0;
  }
  console.log(`${doc.header.title} (${slug})`);
  console.log(`state: ${stateLabel(status)}`);
  if (doc.header.due !== undefined) console.log(`due: ${doc.header.due}`);
  if (doc.header.until !== undefined) console.log(`until: ${doc.header.until}`);
  if (doc.header.gate_command !== undefined) console.log(`gate: ${doc.header.gate_command} (fired: ${status.gateFired ? "yes" : "no"})`);
  if (status.lastSwept !== undefined) {
    console.log(`\nlatest sweep ${status.lastSwept.at}: ${String(status.lastSwept.outcome ?? "gate " + String(status.lastSwept.gate))}`);
  }
  for (const line of evidence) {
    console.log(`  ${String(line.check)}  ${String(line.outcome)}  exit ${String(line.exit)}  ${String(line.duration_ms)} ms  ${line.at}`);
  }
  console.log(`\n${doc.body}`);
  return 0;
}

// --- close ----------------------------------------------------------------------

function runClose(args: ParsedArgs): number {
  const slug = requireSlug(args, "close");
  const verdict = stringFlag(args, "verdict");
  if (verdict !== "held" && verdict !== "failed") throw new UsageError("vigil close needs --verdict held|failed");
  const date = dateFlag(args, "date");
  const project = currentProject(args);
  const who = stringFlag(args, "who") ?? defaultWho();
  if (project.readItem("vigil", slug) === null) throw new Error(`no vigil '${slug}' in ${project.name}`);
  const status = vigilStatus(slug, linesFor(readLedger(project), itemRef("vigil", slug)));
  if (status.state === "closed" && status.verdict === verdict) {
    if (args.json) printJson({ project: project.name, slug, alreadyClosed: true, verdict });
    else console.log(`already closed: ${slug} (${verdict}), not overwritten`);
    return 0;
  }
  const line = closeVigil(project, { slug, verdict, by: who, who, at: date === undefined ? undefined : localNoonIso(date) });
  refreshProjection(project);
  if (args.json) {
    printJson({ project: project.name, closed: line });
    return 0;
  }
  console.log(`closed vigil ${slug} in ${project.name} (verdict ${verdict}, resolved ${date ?? localToday()})`);
  if (verdict === "failed") console.log("  Remediation goes to a new spec via darius add. Never bolt it onto the vigil.");
  return 0;
}

// --- sweep ----------------------------------------------------------------------

function sweepOptions(args: ParsedArgs): SweepOptions {
  const opts: SweepOptions = {
    includeHeavy: isFlagSet(args, "include-heavy"),
    classifyOnly: isFlagSet(args, "classify-only"),
    dryRun: isFlagSet(args, "dry-run"),
    today: localToday(),
    who: stringFlag(args, "who") ?? defaultWho(),
  };
  const only = stringFlag(args, "only");
  if (only !== undefined) opts.only = only;
  const timeout = stringFlag(args, "timeout");
  if (timeout !== undefined) {
    if (!/^[1-9]\d*$/u.test(timeout)) throw new UsageError(`--timeout takes whole seconds, got '${timeout}'`);
    opts.timeoutMs = Number(timeout) * 1000;
  }
  return opts;
}

function vigilMark(vigil: SweptVigil): string {
  if (vigil.flagged || vigil.outcome === "finding") return "!";
  return vigil.closed ? "✓" : "·";
}

function vigilLine(vigil: SweptVigil): string {
  if (vigil.bucket === "closed") return `  · ${vigil.slug.padEnd(28)} ${vigil.bucket.padEnd(12)} already closed`;
  const parts: string[] = [vigil.outcome ?? `gate ${vigil.gate}`];
  if (vigil.closed) parts.push("closed");
  const bad = vigil.checks.find((check) => check.outcome === "fail" || check.outcome === "timeout");
  if (vigil.flagged && bad !== undefined) {
    parts.push(`FLAGGED: #${bad.index} ${bad.text} (${bad.outcome}, exit ${String(bad.exit)})`);
  }
  const reason = vigil.reason === undefined ? "" : ` (${vigil.reason})`;
  return `  ${vigilMark(vigil)} ${vigil.slug.padEnd(28)} ${vigil.bucket.padEnd(12)} ${parts.join(", ")}${reason}`;
}

function printSweep(result: SweepResult): void {
  const mode = [result.classifyOnly ? "classify-only" : "", result.dryRun ? "dry-run" : ""].filter(Boolean).join(", ");
  console.log(`${result.project} ${result.date}${mode === "" ? "" : ` (${mode})`}`);
  if (result.vigils.length === 0) console.log("  no vigils");
  for (const vigil of result.vigils) console.log(vigilLine(vigil));
  for (const error of result.errors) console.error(`  ! ${error.slug}: ${error.message}`);
}

/** Why a project was not swept on this host. */
type SkipReason = "no-workdir" | "swept-today" | "sweep-held" | "lease-offline";

interface ProjectSkip {
  project: string;
  reason: SkipReason;
  detail: string;
}

interface ProjectFailure {
  project: string;
  message: string;
}

type ProjectSweep = { result: SweepResult } | { skip: ProjectSkip };

interface SweepPlan {
  opts: SweepOptions;
  /** The daily lease target; null without --daily. */
  daily: { s3: S3 | null; host: string } | null;
}

const LEASE_SKIPS = {
  "lease-done": "swept-today",
  "lease-held": "sweep-held",
  "lease-offline": "lease-offline",
} as const satisfies Record<LeaseBlock, SkipReason>;

function dailyTarget(args: ParsedArgs, opts: SweepOptions): SweepPlan["daily"] {
  if (!isFlagSet(args, "daily")) return null;
  if (opts.dryRun || opts.classifyOnly || opts.only !== undefined) {
    throw new UsageError("--daily is the timer's whole sweep; it takes no --dry-run, --classify-only or --only");
  }
  const cfg = loadConfigIfPresent();
  const s3 = cfg?.remote === undefined ? null : createS3(cfg.remote, loadCredentials(cfg.remote.credentials));
  return { s3, host: hostId() };
}

async function sweepOne(project: Project, plan: SweepPlan): Promise<ProjectSweep> {
  const { opts, daily } = plan;
  const run: SweepOptions = { ...opts };
  // Nothing to run: no working dir and no lease needed.
  if (project.listItems("vigil").length === 0) return { result: await sweepProject(project, run) };
  if (!opts.classifyOnly) {
    const where = projectWorkdir(project, readLedger(project));
    if ("missing" in where) return { skip: { project: project.name, reason: "no-workdir", detail: where.detail } };
    run.cwd = where.dir;
  }
  if (daily === null) return { result: await sweepProject(project, run) };
  const lease = await takeSweepLease(project, { ...daily, today: opts.today });
  if ("blocked" in lease) return { skip: { project: project.name, reason: LEASE_SKIPS[lease.blocked], detail: lease.detail } };
  let result: SweepResult;
  try {
    result = await sweepProject(project, run);
  } catch (cause) {
    await lease.handle.release();
    throw cause;
  }
  await lease.handle.finish();
  await pruneSweepLeases(project, { s3: daily.s3, today: opts.today });
  return { result };
}

function skipLine(skip: ProjectSkip): string {
  return `${skip.project}: skipped, ${skip.reason} (${skip.detail})`;
}

interface SweepRun {
  results: SweepResult[];
  skipped: ProjectSkip[];
  failures: ProjectFailure[];
}

async function sweepAll(plan: SweepPlan): Promise<SweepRun> {
  const run: SweepRun = { results: [], skipped: [], failures: [] };
  for (const name of listProjects()) {
    try {
      const swept = await sweepOne(openProject(name), plan);
      if ("skip" in swept) run.skipped.push(swept.skip);
      else run.results.push(swept.result);
    } catch (cause) {
      run.failures.push({ project: name, message: errorMessage(cause) });
    }
  }
  return run;
}

function sweepExitCode(run: SweepRun): number {
  const hasErrors = run.failures.length > 0 || run.results.some((result) => result.errors.length > 0);
  if (hasErrors) return 1;
  return run.skipped.some((skip) => skip.reason === "lease-offline") ? 3 : 0;
}

async function runSweep(args: ParsedArgs): Promise<number> {
  try {
    assertNotNested();
  } catch (cause) {
    console.error(`darius: ${errorMessage(cause)}`);
    return 1;
  }
  const opts = sweepOptions(args);
  const plan: SweepPlan = { opts, daily: dailyTarget(args, opts) };
  if (!opts.classifyOnly && !isBashAvailable()) {
    console.error("darius: cannot start bash, so no check can run; the environment is inconclusive");
    return 3;
  }
  if (isFlagSet(args, "all-projects")) {
    const run = await sweepAll(plan);
    if (args.json) printJson({ projects: run.results, skipped: run.skipped, failures: run.failures });
    else {
      run.results.forEach(printSweep);
      for (const skip of run.skipped) console.log(skipLine(skip));
    }
    for (const failure of run.failures) console.error(`darius: ${failure.project}: ${failure.message}`);
    return sweepExitCode(run);
  }
  const swept = await sweepOne(currentProject(args), plan);
  if ("skip" in swept) {
    const { skip } = swept;
    if (skip.reason === "no-workdir" && plan.daily === null) {
      console.error(`darius: ${skip.detail}`);
      return 1;
    }
    if (args.json) printJson({ project: skip.project, skipped: { reason: skip.reason, detail: skip.detail } });
    else console.log(skipLine(skip));
    return skip.reason === "lease-offline" ? 3 : 0;
  }
  if (args.json) printJson(swept.result);
  else printSweep(swept.result);
  return swept.result.errors.length > 0 ? 1 : 0;
}

// --- dispatch -------------------------------------------------------------------

export const vigilCommand: Command = {
  name: "vigil",
  summary: "add, set-body, list, show, close and sweep vigils",
  async run(args: ParsedArgs): Promise<number> {
    const verb = args.positional[0];
    switch (verb) {
      case "add":
        return runAdd(args);
      case "set-body":
        return runSetBody(args);
      case "list":
        return runList(args);
      case "show":
        return runShow(args);
      case "close":
        return runClose(args);
      case "sweep":
        return runSweep(args);
      default:
        throw new UsageError(`vigil needs a verb: ${VERBS}`);
    }
  },
};
