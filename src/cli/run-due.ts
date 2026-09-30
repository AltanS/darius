/**
 * `darius run-due --unattended [--project P | --all-projects] [--only slug]
 *                 [--dry-run] [--who W] [--timeout SECONDS] [--json]`
 *
 * What the hourly systemd timer calls. Starts every due ritual whose policy
 * mode is `report` or `act`, one `claude -p` session each; the work is in
 * src/runner/run-due.ts. `--dry-run` syncs nothing, starts nothing and
 * writes nothing: it lists what would start. Without `--project` (and
 * without DARIUS_PROJECT) it covers every project in the local store, which
 * is what the timer wants.
 *
 * `--who` defaults to `timer`. `--timeout` is the per-run budget in seconds,
 * default 1200; claude is stopped after it and the run is marked failed.
 *
 * Exit codes (probe contract): 0 every started run completed or held and no
 * project failed; 1 a run failed, a project errored, or the webhook post
 * failed; 3 nothing failed but a ritual was skipped because its lease was
 * held elsewhere or the bucket was unreachable; 2 usage.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { flushAlerts, sendAlerts } from "../core/alerts.ts";
import { defaultWho, readLedger } from "../core/ledger.ts";
import { resolveProject, stateDir } from "../core/paths.ts";
import { openProject } from "../core/store.ts";
import { runDue, viewRun, DEFAULT_RUN_TIMEOUT_MS, type RunDueOptions } from "../runner/run-due.ts";
import { deliverReport, skipAlerts, type BatchReport, type ReportScope } from "../runner/report.ts";
import { errorMessage } from "../runtime.ts";
import { UsageError, type Command, type ParsedArgs } from "./registry.ts";

const EXIT_OK = 0;
const EXIT_FAILED = 1;
const EXIT_INCONCLUSIVE = 3;
const DEFAULT_WHO = "timer";
const RITUAL_PREFIX = "ritual/";

function stringFlag(args: ParsedArgs, name: string): string | undefined {
  const value = args.flags[name];
  if (value === undefined || value === false) return undefined;
  if (value === true) throw new UsageError(`--${name} needs a value`);
  return value;
}

function projectsFlag(args: ParsedArgs): string[] {
  const project = stringFlag(args, "project");
  const isAll = args.flags["all-projects"] === true;
  if (isAll && project !== undefined) throw new UsageError("use --project or --all-projects, not both");
  if (project !== undefined) return [project];
  const fromEnv = process.env.DARIUS_PROJECT;
  if (!isAll && fromEnv !== undefined && fromEnv !== "") return [fromEnv];
  return [];
}

function timeoutFlag(args: ParsedArgs): number {
  const raw = stringFlag(args, "timeout");
  if (raw === undefined) return DEFAULT_RUN_TIMEOUT_MS;
  const seconds = Number(raw);
  if (!Number.isFinite(seconds) || seconds <= 0) throw new UsageError(`--timeout must be a positive number of seconds, got '${raw}'`);
  return Math.round(seconds * 1000);
}

export function parseRunDueOptions(args: ParsedArgs): RunDueOptions {
  const isDryRun = args.flags["dry-run"] === true;
  if (args.flags.unattended !== true && !isDryRun) {
    throw new UsageError("run-due launches claude with nobody watching: pass --unattended, or --dry-run to preview");
  }
  const options: RunDueOptions = {
    projects: projectsFlag(args),
    isDryRun,
    who: stringFlag(args, "who") ?? DEFAULT_WHO,
    timeoutMs: timeoutFlag(args),
  };
  const only = stringFlag(args, "only");
  if (only !== undefined) options.only = only;
  return options;
}

export function runDueExitCode(report: BatchReport): number {
  if (!report.ok) return EXIT_FAILED;
  const isLeaseSkip = report.projects.some((project) =>
    project.rituals.some((ritual) => ritual.reason === "lease-held" || ritual.reason === "lease-offline"),
  );
  return isLeaseSkip ? EXIT_INCONCLUSIVE : EXIT_OK;
}

/** Where this host notes the local date of its last digest (src/runner/report.ts, ReportScope). */
function digestFile(): string {
  return join(stateDir(), "run-due-digest.json");
}

/** `digest` for the first real batch of the local day, `news` after it; `all` for a dry run. */
export function reportScope(report: BatchReport): ReportScope {
  if (report.dryRun) return "all";
  const file = digestFile();
  if (!existsSync(file)) return "digest";
  try {
    const last: { date?: string } = JSON.parse(readFileSync(file, "utf8"));
    return last.date === report.date ? "news" : "digest";
  } catch {
    return "digest";
  }
}

/** A digest that reached the webhook or the journal counts as sent; a failed post is tried again next batch. */
function noteDigest(report: BatchReport, scope: ReportScope): void {
  if (scope !== "digest" || report.notify === undefined || report.notify.startsWith("failed")) return;
  writeFileSync(digestFile(), `${JSON.stringify({ date: report.date, notify: report.notify })}\n`);
}

/**
 * After a batch, this host tells the operator by push (src/core/alerts.ts,
 * 0.29.0): the failing skips of the report, then every alert its ledgers hold.
 * Best effort: a failed send never changes the exit code, and the next batch
 * or sync tries it again.
 */
async function alertBatch(report: BatchReport, command: string): Promise<void> {
  if (report.dryRun) return;
  const failures: string[] = [];
  try {
    for (const entry of report.projects) {
      const alerts = skipAlerts(entry, report);
      if (alerts.length > 0) failures.push(...((await sendAlerts(openProject(entry.project), alerts))?.failed ?? []));
    }
    failures.push(...((await flushAlerts())?.failed ?? []));
  } catch (cause) {
    failures.push(errorMessage(cause));
  }
  for (const failure of failures) console.error(`darius ${command}: alert: ${failure}`);
}

export const runDueCommand: Command = {
  name: "run-due",
  summary: "start due rituals unattended with claude -p: --unattended | --dry-run, --project P, --only slug",
  async run(args: ParsedArgs): Promise<number> {
    const { report, cfg } = await runDue(parseRunDueOptions(args));
    const scope = reportScope(report);
    await deliverReport(report, { webhook: cfg?.notify.webhook ?? "", isJson: args.json, scope });
    noteDigest(report, scope);
    await alertBatch(report, "run-due");
    for (const failure of report.errors) console.error(`darius run-due: ${failure.project}: ${failure.error}`);
    return runDueExitCode(report);
  },
};

/**
 * `darius run now <ritual> [--project P] [--profile NAME] [--timeout S]
 * [--dry-run] [--json] [--who W]`: start one ritual unattended now, due or
 * not (docs/concept.md, "Djinns"). The same path as run-due: lease, gate
 * preflight, profile, surface, report. A held or open run still blocks it,
 * mode `off` refuses it, and `max_mode` still caps it. The report goes to
 * the webhook too (to stdout without one), and alerts go out as after a
 * batch: a run started by hand in a tab or over ssh must not end without a
 * word.
 */
export async function runNow(args: ParsedArgs): Promise<number> {
  const slug = args.positional[1];
  if (slug === undefined || slug === "") throw new UsageError("run now: missing <ritual>");
  const project = resolveProject(stringFlag(args, "project"));
  if (openProject(project).readItem("ritual", slug) === null) throw new UsageError(`no ritual '${slug}' in ${project}`);
  const now: NonNullable<RunDueOptions["now"]> = {};
  const profile = stringFlag(args, "profile");
  if (profile !== undefined && profile !== "") now.profile = profile;
  const options: RunDueOptions = {
    projects: [project],
    only: slug,
    isDryRun: args.flags["dry-run"] === true,
    who: stringFlag(args, "who") ?? defaultWho(),
    timeoutMs: timeoutFlag(args),
    now,
  };
  const { report, cfg } = await runDue(options);
  await deliverReport(report, { webhook: cfg?.notify.webhook ?? "", isJson: args.json, scope: "all" });
  await alertBatch(report, "run now");
  for (const failure of report.errors) console.error(`darius run now: ${failure.project}: ${failure.error}`);
  return runDueExitCode(report);
}

function refuseResume(args: ParsedArgs, run: string, reason: string): number {
  if (args.json) console.log(JSON.stringify({ ok: false, run, error: reason }));
  else console.log(`! ${reason}`);
  return EXIT_FAILED;
}

/**
 * `darius run resume <run> [--project P] [--timeout S] [--json] [--who W]`:
 * a held run goes on after the operator answered it (docs/concept.md,
 * "Unattended runner" > "Resume"; src/runner/resume.ts). It goes on with
 * its harness session when this host still has it, else in a new session
 * that gets the questions and the answers. The same checks as `run now`
 * apply. Refuses (exit 1) a run that is not held, or held with no answer
 * since the hold. The report goes to the webhook, as for `run now`.
 */
export async function runResume(args: ParsedArgs): Promise<number> {
  const run = args.positional[1];
  if (run === undefined || run === "") throw new UsageError("run resume: missing <run>");
  const project = resolveProject(stringFlag(args, "project"));
  const view = viewRun(readLedger(openProject(project)), run);
  if (view.item === undefined) throw new UsageError(`no run '${run}' in ${project}`);
  if (!view.item.startsWith(RITUAL_PREFIX)) throw new UsageError(`run '${run}' belongs to ${view.item}; only ritual runs resume`);
  if (view.phase !== "held") return refuseResume(args, run, `run '${run}' is not held (phase: ${view.phase ?? "unknown"})`);
  if (!view.isAnswered) {
    return refuseResume(args, run, `run '${run}' has no answer since it was held: darius run answer ${run} <n> <text> --project ${project}`);
  }
  const options: RunDueOptions = {
    projects: [project],
    only: view.item.slice(RITUAL_PREFIX.length),
    isDryRun: false,
    who: stringFlag(args, "who") ?? defaultWho(),
    timeoutMs: timeoutFlag(args),
    resume: { run },
  };
  const { report, cfg } = await runDue(options);
  await deliverReport(report, { webhook: cfg?.notify.webhook ?? "", isJson: args.json, scope: "all" });
  await alertBatch(report, "run resume");
  for (const failure of report.errors) console.error(`darius run resume: ${failure.project}: ${failure.error}`);
  return runDueExitCode(report);
}
