/**
 * Whether a follow-up of a run can start now (0.48.0): the run page shows
 * its button by this, and the POST of the button checks it again
 * (src/web/action-api.ts). Read only: it writes no ledger line, no run dir,
 * and opens no tab.
 *
 * The checks are the ones `darius run follow-up` makes, on the same code
 * path: the parent and its questions (planFollowUp), then a dry run of the
 * follow-up through runDue, which checks the ritual, the host pin, the
 * linked checkout, `max_mode`, the profile and herdr (or the ritual's
 * `follow_up = "headless"`, 0.69.0). A dry run reaches no bucket. The
 * spawned CLI checks everything again before it starts.
 *
 * On a host that is not the ritual's (src/core/workdir.ts, ritualHost) the
 * page forwards (0.69.0): the same dry run runs on the ritual's host,
 * through `darius run follow-up --dry-run --json --on <host>`, the CLI's
 * own ssh forward (src/core/ssh.ts). Ready there means the button starts
 * the follow-up there. When ssh fails, or the dry run there refuses, the
 * reason names that host; the page shows it and no command to copy. Before
 * 0.69.0 the page never forwarded and showed the ssh command instead.
 */

import { spawn } from "node:child_process";

import { hostId, readLedger } from "../core/ledger.ts";
import type { JsonValue, Ritual } from "../core/model.ts";
import { SSH_FAILED } from "../core/ssh.ts";
import { listProjects, openProject } from "../core/store.ts";
import { ritualHost } from "../core/workdir.ts";
import { errorMessage } from "../runtime.ts";
import type { FollowUpItem, FollowUpQuestion, FollowUpReadiness } from "../web/api.ts";
import { approvableItems, parentResult, planFollowUp } from "./follow-up.ts";
import { dariusBin } from "./launch.ts";
import { DEFAULT_RUN_TIMEOUT_MS, runDue, viewRun } from "./run-due.ts";

const RITUAL_PREFIX = "ritual/";

/** The words the page leads with for the two reasons an operator meets most. */
function reasonOf(skip: { reason?: string | undefined; detail?: string | undefined }, host: string): string {
  const detail = skip.detail ?? "";
  if (skip.reason === "not-followable" && detail.includes("permissions gated")) return `gated profile: ${detail}`;
  if (skip.reason === "not-followable" && detail.startsWith("a follow-up opens a herdr tab")) return `no herdr on ${host}: ${detail}`;
  return detail === "" ? (skip.reason ?? "skipped") : `${skip.reason ?? "skipped"}: ${detail}`;
}

/** The questions of the parent's result that list commands, numbered from 1. */
function approvable(questions: readonly { commands?: string[] }[]): FollowUpQuestion[] {
  return questions.flatMap((question, index) => {
    const commands = question.commands ?? [];
    return commands.length === 0 ? [] : [{ n: index + 1, commands: [...commands] }];
  });
}

/** What running `darius <argv>` here gave back, output captured. */
export interface DariusCapture {
  /** The exit code; null when it could not start or was stopped. */
  code: number | null;
  stdout: string;
  stderr: string;
}

/** Runs `darius <argv>` here and captures its output. No shell: argv goes to the process as it is. */
export type DariusRunner = (argv: readonly string[]) => Promise<DariusCapture>;

/** ssh may wait 10 s to connect, and the dry run there takes a few more. */
const FORWARD_TIMEOUT_MS = 30_000;

export const captureDarius: DariusRunner = (argv) =>
  new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    const child = spawn(dariusBin(), [...argv], { stdio: ["ignore", "pipe", "pipe"], timeout: FORWARD_TIMEOUT_MS });
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (cause) => {
      resolve({ code: null, stdout, stderr: `${stderr}could not start darius: ${errorMessage(cause)}\n` });
    });
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });

function isRecord(value: JsonValue | undefined): value is { readonly [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The last line of `text` that parses as a JSON object, or null. */
function lastJson(output: string): { readonly [key: string]: JsonValue } | null {
  for (const line of output.split("\n").toReversed()) {
    if (!line.trimStart().startsWith("{")) continue;
    try {
      const parsed: JsonValue = JSON.parse(line);
      if (isRecord(parsed)) return parsed;
    } catch {
      // Not JSON: look further up.
    }
  }
  return null;
}

/** The last plain line of a CLI's output, with the `darius: ` and `! ` prefixes taken off. */
export function lastSentence(output: string): string {
  const line = output
    .split("\n")
    .map((candidate) => candidate.trim())
    .findLast((candidate) => candidate !== "" && !candidate.startsWith("{"));
  return (line ?? "").replace(/^darius run (?:follow-up|now): /u, "").replace(/^darius: /u, "").replace(/^! /u, "");
}

/** The one ritual entry of a `--json` batch report, when the output holds one. */
function reportEntry(json: { readonly [key: string]: JsonValue } | null): { readonly [key: string]: JsonValue } | null {
  const projects = json?.projects;
  if (!Array.isArray(projects)) return null;
  const first = projects[0];
  const rituals = isRecord(first) ? first.rituals : undefined;
  const entry = Array.isArray(rituals) ? rituals[0] : undefined;
  return isRecord(entry) ? entry : null;
}

function isText(value: JsonValue | undefined): value is string {
  return typeof value === "string";
}

/** A string field of a JSON object, or undefined. */
function field(value: JsonValue | undefined): string | undefined {
  return isText(value) ? value : undefined;
}

/**
 * The readiness on the ritual's host `right`, by the CLI's ssh forward:
 * `darius run follow-up <run> --dry-run --json --on <right>`. The words go to
 * the CLI as argv, never through a shell here; ssh quotes them for the
 * other host's shell (shellWord).
 */
async function remoteReadiness(at: { project: string; run: string; host: string; right: string }, offer: { questions: FollowUpQuestion[]; items: FollowUpItem[] }, forward: DariusRunner): Promise<FollowUpReadiness> {
  const { host, right } = at;
  const off = (reason: string): FollowUpReadiness => ({ ready: false, host, reason: `on ${right}: ${reason}`, rightHost: right });
  const approve = offer.questions.flatMap((question) => ["--approve", String(question.n)]);
  // With no command question the follow-up carries the operator's decision as a note (0.65.0); the check stands in for it.
  const argv = ["run", "follow-up", at.run, "--project", at.project, ...approve, "--note", "decision", "--dry-run", "--json", "--on", right];
  const ran = await forward(argv);
  const json = lastJson(ran.stdout);
  const entry = reportEntry(json);
  if (entry !== null && entry.action === "would-start") {
    const surface = field(entry.surface) === "headless" ? "headless" : "herdr";
    return { ready: true, host: right, via: host, profile: field(entry.profile) ?? "built-in", surface, questions: offer.questions, items: offer.items };
  }
  if (entry !== null) return off(reasonOf({ reason: field(entry.reason), detail: field(entry.detail) }, right));
  const error = field(json?.error);
  if (error !== undefined) return off(error);
  if (ran.code === SSH_FAILED || ran.code === null) return off(`ssh to ${right} failed: ${lastSentence(ran.stderr) || "no answer"}`);
  return off(lastSentence(ran.stderr) || lastSentence(ran.stdout) || `darius exited ${String(ran.code)}`);
}

/** The items a follow-up may approve, for the page: key and title. */
function itemOffer(items: ReturnType<typeof approvableItems>): FollowUpItem[] {
  return items.map((item) => ({ key: item.key ?? "", title: item.title }));
}

/**
 * Whether `darius run follow-up <run>` would start now, approving every
 * question that lists commands (none is fine: the follow-up then carries a
 * note, 0.65.0). Here when this host is the ritual's, else on the ritual's
 * host through the CLI's ssh forward (0.69.0); `forward` runs the CLI.
 */
export async function followUpReadiness(projectName: string, run: string, forward: DariusRunner = captureDarius): Promise<FollowUpReadiness> {
  const host = hostId();
  const off = (reason: string): FollowUpReadiness => ({ ready: false, host, reason });
  if (!listProjects().includes(projectName)) return off(`no project ${projectName} on ${host}`);
  try {
    const project = openProject(projectName);
    const ledger = readLedger(project);
    const result = parentResult(project, ledger, run);
    const questions = approvable(result?.questions ?? []);
    const items = itemOffer(approvableItems(result));
    const item = viewRun(ledger, run).item;
    if (item === undefined) return off(`no run ${run} in ${projectName}`);
    const slug = item.startsWith(RITUAL_PREFIX) ? item.slice(RITUAL_PREFIX.length) : item;
    const doc = project.readItem<Ritual>("ritual", slug);
    const right = doc === null ? null : ritualHost(project, ledger, doc);
    if (right !== null && right.host !== host) {
      return await remoteReadiness({ project: projectName, run, host, right: right.host }, { questions, items }, forward);
    }
    // With no command question the follow-up carries the operator's decision as a note (0.65.0); the check stands in for it.
    const plan = planFollowUp(ledger, result, { parent: run, approve: questions.map((question) => question.n), grant: [], note: "decision" });
    if ("usage" in plan) return off(plan.usage);
    if ("refused" in plan) return off(plan.refused);
    const { report } = await runDue({
      projects: [projectName],
      only: slug,
      isDryRun: true,
      who: "web",
      timeoutMs: DEFAULT_RUN_TIMEOUT_MS,
      followUp: { parent: run, approved: questions.map((question) => question.n), grants: plan.grants },
    });
    const entry = report.projects[0]?.rituals[0];
    if (entry === undefined) return off(report.errors[0]?.error ?? `no ritual ${slug} in ${projectName}`);
    if (entry.action !== "would-start") return off(reasonOf(entry, host));
    return { ready: true, host, profile: entry.profile ?? "built-in", surface: entry.surface === "headless" ? "headless" : "herdr", questions, items };
  } catch (cause) {
    return off(errorMessage(cause));
  }
}
