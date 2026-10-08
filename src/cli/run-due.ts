/**
 * `darius run-due --unattended [--project P | --all-projects] [--only slug]
 *                 [--dry-run] [--who W] [--timeout SECONDS] [--json]`
 *
 * What the 15-minute systemd timer calls. Starts every due ritual whose policy
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
 * failed; 3 nothing failed but the bucket was unreachable for a lease; 2 usage.
 * A lease held by another host is a quiet skip, exit 0 (0.54.0): with a
 * 15-minute tick it happens on most batches of two linked hosts.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { userInfo } from "node:os";
import { join } from "node:path";

import { flushAlerts, sendAlerts } from "../core/alerts.ts";
import { defaultWho, hostId, readLedger } from "../core/ledger.ts";
import type { Document, LedgerLine, Ritual } from "../core/model.ts";
import { resolveProject, stateDir } from "../core/paths.ts";
import { sshDarius, sshDariusLine, sshProgram } from "../core/ssh.ts";
import { openProject, type Project } from "../core/store.ts";
import { ritualHost } from "../core/workdir.ts";
import { parentResult, planFollowUp, type FollowUp, type FollowUpRequest } from "../runner/follow-up.ts";
import { runDue, viewRun, DEFAULT_RUN_TIMEOUT_MS, type RunDueOptions } from "../runner/run-due.ts";
import { deliverReport, skipAlerts, type BatchReport, type ReportScope } from "../runner/report.ts";
import { errorMessage } from "../runtime.ts";
import { NotFoundError, UsageError, type Command, type ParsedArgs } from "./registry.ts";

const EXIT_OK = 0;
const EXIT_FAILED = 1;
const EXIT_INCONCLUSIVE = 3;
const DEFAULT_WHO = "timer";
const RITUAL_PREFIX = "ritual/";
/** The stderr line `run follow-up` prints when the run started (0.69.0); the web reads the run id after it. */
export const STARTED_PREFIX = "darius run follow-up: started run ";

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
  const isLeaseSkip = report.projects.some((project) => project.rituals.some((ritual) => ritual.reason === "lease-offline"));
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

// --- the right host (0.50.0) -----------------------------------------------------------

/** Skips that mean "not on this host": the timer passes them quietly, a person who asked gets exit 1. */
const WRONG_HOST_SKIPS: ReadonlySet<string> = new Set(["other-host", "no-workdir"]);

/**
 * The argv of this verb as the user gave it, for another host: `run`, the
 * positionals, then every flag in the order given, `--on` left out and
 * `--project` set to the project resolved here (the other host has no
 * cwd to find it from). `set` replaces or adds flags. A positional that
 * looks like a flag goes after `--`.
 */
export function verbArgv(args: ParsedArgs, project: string, set: Readonly<Record<string, string>> = {}): string[] {
  const values: Record<string, readonly string[] | true> = {};
  for (const [name, value] of Object.entries(args.flags)) {
    if (name === "on" || value === false) continue;
    values[name] = value === true ? true : (args.repeated[name] ?? [value]);
  }
  values.project = [project];
  for (const [name, value] of Object.entries(set)) values[name] = [value];
  const flags = Object.entries(values).flatMap(([name, value]) => (value === true ? [`--${name}`] : value.flatMap((one) => [`--${name}`, one])));
  const isFlagLike = args.positional.some((word) => word.startsWith("--"));
  return isFlagLike ? ["run", ...flags, "--", ...args.positional] : ["run", ...args.positional, ...flags];
}

function isSet(name: string): boolean {
  const value = process.env[name];
  return value !== undefined && value !== "";
}

/** Who a forwarded run is by: `<login>@<this host> via ssh`. */
function forwardedWho(): string {
  const login = process.env.USER;
  return `${login === undefined || login === "" ? userInfo().username : login}@${hostId()} via ssh`;
}

/**
 * `--on <host>`: run this verb on `host` over ssh (src/core/ssh.ts), output
 * streamed here, its exit code passed through. The host applies every gate
 * itself. Undefined when there is no `--on`, or it names this host: then the
 * verb runs here. Refused inside a run: ssh would drop DARIUS_RUN, and the
 * other host would not know it is a run's call.
 */
function forwardOn(args: ParsedArgs, project: string, verb: string): number | undefined {
  const on = stringFlag(args, "on");
  if (on === undefined) return undefined;
  if (isSet("DARIUS_RUN") || isSet("DARIUS_RUN_POLICY")) {
    const reason = `run ${verb} --on is for a person; a run darius started does not reach other hosts`;
    if (args.json) console.log(JSON.stringify({ ok: false, error: reason }));
    else console.log(`! ${reason}`);
    return EXIT_FAILED;
  }
  if (on === hostId()) return undefined;
  return sshDarius(sshProgram(), on, verbArgv(args, project, { who: stringFlag(args, "who") ?? forwardedWho() }));
}

/**
 * Refuses a verb typed on the wrong host, and names the right one with the
 * command to type (0.50.0). Undefined when this host is right, or when no
 * host is known: runDue decides then, and a `no-workdir` skip exits 1 too.
 */
function refuseWrongHost(args: ParsedArgs, target: { project: Project; ledger: readonly LedgerLine[]; doc: Document<Ritual> }): number | undefined {
  const right = ritualHost(target.project, target.ledger, target.doc);
  if (right === null || right.host === hostId()) return undefined;
  const command = sshDariusLine(right.host, verbArgv(args, target.project.name));
  const ritual = target.doc.header.slug;
  if (args.json) {
    console.log(JSON.stringify({ ok: false, ritual, host: right.host, why: right.why, command }));
  } else {
    const why = right.why === "pinned" ? "pinned" : "its checkout is linked there";
    console.log(`! ${ritual} runs on ${right.host} (${why}): ${command}`);
  }
  return EXIT_FAILED;
}

/** The exit code of a run started by hand: a skip for the wrong host fails, where the timer would pass it quietly. */
function byHandExitCode(report: BatchReport): number {
  const entry = report.projects[0]?.rituals[0];
  if (entry?.action === "skipped" && WRONG_HOST_SKIPS.has(entry.reason ?? "")) return EXIT_FAILED;
  return runDueExitCode(report);
}

/**
 * `darius run now <ritual> [--project P] [--profile NAME] [--timeout S]
 * [--dry-run] [--json] [--who W]`: start one ritual unattended now, due or
 * not (docs/concept.md, "Djinns"). The same path as run-due: lease, gate
 * preflight, profile, surface, report. A held or open run still blocks it,
 * mode `off` refuses it, and `max_mode` still caps it. The report goes to
 * the webhook too (to stdout without one), and alerts go out as after a
 * batch: a run started by hand in a tab or over ssh must not end without a
 * word.
 *
 * On a host that is not the ritual's (src/core/workdir.ts, ritualHost) it
 * refuses with exit 1 and prints the ssh command for the right host, with
 * `--dry-run` too; a `no-workdir` skip exits 1 as well (0.50.0). `--on HOST`
 * runs the same verb on HOST over ssh instead. The same holds for `run
 * resume` and `run follow-up`.
 */
export async function runNow(args: ParsedArgs): Promise<number> {
  const slug = args.positional[1];
  if (slug === undefined || slug === "") throw new UsageError("run now: missing <ritual>");
  const project = resolveProject(stringFlag(args, "project"));
  const forwarded = forwardOn(args, project, "now");
  if (forwarded !== undefined) return forwarded;
  const store = openProject(project);
  const doc = store.readItem<Ritual>("ritual", slug);
  if (doc === null) throw new NotFoundError(`no ritual '${slug}' in ${project}`);
  const wrongHost = refuseWrongHost(args, { project: store, ledger: readLedger(store), doc });
  if (wrongHost !== undefined) return wrongHost;
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
  return byHandExitCode(report);
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
  // 0.66.0: a resume has no dry run. It used to launch a real run anyway.
  if (args.flags["dry-run"] !== undefined) throw new UsageError("run resume has no dry run: it starts the run again; drop --dry-run, or read the run with darius run show <run>");
  const project = resolveProject(stringFlag(args, "project"));
  const forwarded = forwardOn(args, project, "resume");
  if (forwarded !== undefined) return forwarded;
  const store = openProject(project);
  const ledger = readLedger(store);
  const view = viewRun(ledger, run);
  if (view.item === undefined) throw new NotFoundError(`no run '${run}' in ${project}`);
  if (!view.item.startsWith(RITUAL_PREFIX)) throw new UsageError(`run '${run}' belongs to ${view.item}; only ritual runs resume`);
  if (view.phase !== "held") return refuseResume(args, run, `run '${run}' is not held (phase: ${view.phase ?? "unknown"})`);
  if (!view.isAnswered) {
    return refuseResume(args, run, `run '${run}' has no answer since it was held: darius run answer ${run} <n> <text> --project ${project}`);
  }
  const doc = store.readItem<Ritual>("ritual", view.item.slice(RITUAL_PREFIX.length));
  const wrongHost = doc === null ? undefined : refuseWrongHost(args, { project: store, ledger, doc });
  if (wrongHost !== undefined) return wrongHost;
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
  return byHandExitCode(report);
}

/** `--approve N` values: whole numbers from 1. */
function approveFlags(args: ParsedArgs): number[] {
  return (args.repeated.approve ?? []).map((raw) => {
    const n = Number.parseInt(raw, 10);
    if (!Number.isInteger(n) || n < 1 || String(n) !== raw) throw new UsageError(`--approve must name a question by its number, from 1, got '${raw}'`);
    return n;
  });
}

/**
 * `darius run follow-up <run> [--project P] [--approve N ...] [--grant LINE ...]
 * [--item KEY ...] [--note TEXT] [--headless] [--timeout S] [--dry-run] [--json] [--who W]`:
 * a new run of the ritual of complete run `<run>`, attended in a herdr tab,
 * that may run the command lines of the approved questions and the
 * `--grant` lines as written (docs/concept.md, "Follow-up runs";
 * src/runner/follow-up.ts). The path of `run now`: lease, cap, profile,
 * preflight, report and alerts. A mistake on the command line exits 2; a
 * parent or ritual that cannot have a follow-up now exits 1, and so does a
 * call from inside a run (DARIUS_RUN set): a run never grants itself. `--dry-run`
 * prints the grants and where the run would open, and writes nothing.
 *
 * `--item KEY` (0.69.0, repeatable) approves the proposal of the parent's
 * `needs-decision` item with that key; the run carries out exactly those.
 * Right after the run starts, stderr gets one line, `darius run follow-up:
 * started run <id> on <host>`: the web page waits for it (src/web/action-api.ts).
 */
export async function runFollowUp(args: ParsedArgs): Promise<number> {
  // A run must never grant itself lines: the operator starts a follow-up, not a session darius started.
  const inRun = process.env.DARIUS_RUN ?? process.env.DARIUS_RUN_POLICY;
  if (inRun !== undefined && inRun !== "") return refuseResume(args, args.positional[1] ?? "", "run follow-up is for a person; a run darius started cannot start one");
  const parent = args.positional[1];
  if (parent === undefined || parent === "") throw new UsageError("run follow-up: missing <run>");
  const project = resolveProject(stringFlag(args, "project"));
  const forwarded = forwardOn(args, project, "follow-up");
  if (forwarded !== undefined) return forwarded;
  const store = openProject(project);
  const ledger = readLedger(store);
  const approved = [...new Set(approveFlags(args))];
  const note = stringFlag(args, "note");
  const request: FollowUpRequest = { parent, approve: approved, grant: args.repeated.grant ?? [], items: args.repeated.item ?? [] };
  if (note !== undefined) request.note = note;
  const plan = planFollowUp(ledger, parentResult(store, ledger, parent), request);
  if ("usage" in plan) throw new UsageError(`run follow-up: ${plan.usage}`);
  if ("refused" in plan) return refuseResume(args, parent, plan.refused);
  const followUp: FollowUp = { parent, approved, grants: plan.grants };
  if (plan.items.length > 0) followUp.items = plan.items;
  if (note !== undefined && note !== "") followUp.note = note;
  if (args.flags.headless === true) followUp.headless = true;
  const isDryRun = args.flags["dry-run"] === true;
  const slug = (viewRun(ledger, parent).item ?? "").slice(RITUAL_PREFIX.length);
  const doc = store.readItem<Ritual>("ritual", slug);
  if (doc === null) throw new UsageError(`run follow-up: no ritual '${slug}' in ${project}`);
  const wrongHost = refuseWrongHost(args, { project: store, ledger, doc });
  if (wrongHost !== undefined) return wrongHost;
  const options: RunDueOptions = {
    projects: [project],
    only: slug,
    isDryRun,
    who: stringFlag(args, "who") ?? defaultWho(),
    timeoutMs: timeoutFlag(args),
    followUp,
    onStarted: (run) => {
      console.error(`${STARTED_PREFIX}${run} on ${hostId()}`);
    },
  };
  if (isDryRun && !args.json) {
    console.log(`follow-up of run ${parent}, ${String(plan.grants.length)} granted line(s):`);
    for (const line of plan.grants) console.log(`  ${line}`);
    if (plan.items.length > 0) console.log(`approved item(s): ${plan.items.join(", ")}`);
  }
  const { report, cfg } = await runDue(options);
  await deliverReport(report, { webhook: cfg?.notify.webhook ?? "", isJson: args.json, scope: "all" });
  await alertBatch(report, "run follow-up");
  for (const failure of report.errors) console.error(`darius run follow-up: ${failure.project}: ${failure.error}`);
  const entry = report.projects[0]?.rituals[0];
  if (entry?.action === "skipped") {
    console.error(`darius run follow-up: ${entry.reason ?? "skipped"}: ${entry.detail ?? ""}`);
    return EXIT_FAILED;
  }
  return runDueExitCode(report);
}
