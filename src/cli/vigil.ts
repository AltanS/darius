/**
 * `darius vigil <verb>`: add, list, show, close and sweep vigils.
 *
 *   vigil add <slug> --title T [--due YYYY-MM-DD] [--until TEXT]
 *             [--gate-command CMD] [--heavy] [--from REF] [--stdin]
 *   vigil list
 *   vigil show <slug>
 *   vigil close <slug> --verdict held|failed
 *   vigil sweep [--all-projects] [--only SLUG] [--include-heavy] [--daily]
 *               [--classify-only] [--dry-run] [--timeout SECONDS] [--who W]
 *
 * The rules live in src/core/sweep.ts. Commands run in the project's working
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

import { loadConfigIfPresent } from "../core/config.ts";
import { loadCredentials } from "../core/credentials.ts";
import { defaultWho, hostId, linesFor, readLedger } from "../core/ledger.ts";
import type { LeaseBlock } from "../core/lease.ts";
import type { Vigil } from "../core/model.ts";
import { resolveProject } from "../core/paths.ts";
import { createS3, type S3 } from "../core/s3.ts";
import { itemRef, listProjects, openProject, type Project } from "../core/store.ts";
import { pruneSweepLeases, takeSweepLease } from "../core/sweep-lease.ts";
import { projectWorkdir } from "../core/workdir.ts";
import {
  addVigil,
  assertNotNested,
  closeVigil,
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
import { errorMessage } from "../runtime.ts";
import { UsageError, type Command, type ParsedArgs } from "./registry.ts";

const VERBS = "add | list | show | close | sweep";

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

// --- add ------------------------------------------------------------------------

function runAdd(args: ParsedArgs): number {
  const slug = requireSlug(args, "add");
  const title = stringFlag(args, "title");
  if (title === undefined) throw new UsageError("vigil add needs --title");
  const project = currentProject(args, { create: true });
  const doc = addVigil(project, {
    slug,
    title,
    body: args.stdin ?? `# ${title}\n`,
    due: stringFlag(args, "due"),
    until: stringFlag(args, "until"),
    gate_command: stringFlag(args, "gate-command"),
    heavy: isFlagSet(args, "heavy"),
    from: stringFlag(args, "from"),
    who: stringFlag(args, "who") ?? defaultWho(),
  });
  if (args.json) printJson({ project: project.name, added: doc.header });
  else console.log(`✓ vigil ${slug} added to ${project.name}`);
  return 0;
}

// --- list and show --------------------------------------------------------------

interface ListedVigil {
  slug: string;
  title: string;
  due?: string;
  until?: string;
  heavy: boolean;
  status: VigilStatus;
}

function listVigils(project: Project): ListedVigil[] {
  const ledger = readLedger(project);
  return project.listItems("vigil").flatMap((slug) => {
    const doc = project.readItem<Vigil>("vigil", slug);
    if (doc === null) return [];
    const { header } = doc;
    const status = vigilStatus(slug, linesFor(ledger, itemRef("vigil", slug)));
    const listed: ListedVigil = { slug, title: header.title, heavy: header.heavy, status };
    if (header.due !== undefined) listed.due = header.due;
    if (header.until !== undefined) listed.until = header.until;
    return [listed];
  });
}

function stateLabel(status: VigilStatus): string {
  if (status.state === "closed") return `closed ${status.verdict ?? ""}`.trimEnd();
  if (status.flagged) return "open, FLAGGED";
  return "open";
}

function runList(args: ParsedArgs): number {
  const project = currentProject(args);
  const vigils = listVigils(project);
  if (args.json) {
    printJson({
      project: project.name,
      vigils: vigils.map((vigil) => ({
        ...vigil,
        status: { ...vigil.status, lastSwept: vigil.status.lastSwept?.at },
      })),
    });
    return 0;
  }
  if (vigils.length === 0) console.log(`no vigils in ${project.name}`);
  for (const vigil of vigils) {
    const gate = vigil.due === undefined ? (vigil.until ?? "") : `due ${vigil.due}`;
    const last = vigil.status.lastOutcome === undefined ? "" : `  last: ${vigil.status.lastOutcome}`;
    console.log(`${vigil.slug.padEnd(28)} ${stateLabel(vigil.status).padEnd(16)} ${gate}${last}`);
  }
  return 0;
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
  const project = currentProject(args);
  const who = stringFlag(args, "who") ?? defaultWho();
  const line = closeVigil(project, { slug, verdict, by: who, who });
  if (args.json) printJson({ project: project.name, closed: line });
  else console.log(`✓ vigil ${slug} closed ${verdict}`);
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
  summary: "add, list, show, close and sweep vigils",
  async run(args: ParsedArgs): Promise<number> {
    const verb = args.positional[0];
    switch (verb) {
      case "add":
        return runAdd(args);
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
