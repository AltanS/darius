/**
 * Whether this host can start a follow-up of a run now (0.48.0): the run
 * page shows its button by this, and the POST of the button checks it again
 * (src/web/action-api.ts). Read only: it writes no ledger line, no run dir,
 * and opens no tab.
 *
 * The checks are the ones `darius run follow-up` makes, on the same code
 * path: the parent and its questions (planFollowUp), then a dry run of the
 * follow-up through runDue, which checks the ritual, the host pin, the
 * linked checkout, `max_mode`, the profile and herdr. A dry run reaches no
 * bucket. The spawned CLI checks everything again before it starts.
 *
 * On a host that is not the ritual's (src/core/workdir.ts, ritualHost) the
 * button is off, and the reason names the right host and the ssh command
 * (0.50.0). The page never forwards a follow-up to another host.
 */

import { hostId, readLedger } from "../core/ledger.ts";
import type { Ritual } from "../core/model.ts";
import { sshDariusLine } from "../core/ssh.ts";
import { listProjects, openProject } from "../core/store.ts";
import { ritualHost } from "../core/workdir.ts";
import { errorMessage } from "../runtime.ts";
import type { FollowUpQuestion, FollowUpReadiness } from "../web/api.ts";
import { parentResult, planFollowUp } from "./follow-up.ts";
import type { RitualEntry } from "./report.ts";
import { DEFAULT_RUN_TIMEOUT_MS, runDue, viewRun } from "./run-due.ts";

const RITUAL_PREFIX = "ritual/";

/** The words the page leads with for the two reasons an operator meets most. */
function reasonOf(entry: RitualEntry, host: string): string {
  const detail = entry.detail ?? "";
  if (entry.reason === "not-followable" && detail.includes("permissions gated")) return `gated profile: ${detail}`;
  if (entry.reason === "not-followable" && detail.startsWith("a follow-up opens a herdr tab")) return `no herdr on ${host}: ${detail}`;
  return detail === "" ? (entry.reason ?? "skipped") : `${entry.reason ?? "skipped"}: ${detail}`;
}

/** The questions of the parent's result that list commands, numbered from 1. */
function approvable(questions: readonly { commands?: string[] }[]): FollowUpQuestion[] {
  return questions.flatMap((question, index) => {
    const commands = question.commands ?? [];
    return commands.length === 0 ? [] : [{ n: index + 1, commands: [...commands] }];
  });
}

/** Whether `darius run follow-up <run>` would start here now, approving every question that lists commands (none is fine: the follow-up then carries a note, 0.65.0). */
export async function followUpReadiness(projectName: string, run: string): Promise<FollowUpReadiness> {
  const host = hostId();
  const off = (reason: string): FollowUpReadiness => ({ ready: false, host, reason });
  if (!listProjects().includes(projectName)) return off(`no project ${projectName} on ${host}`);
  try {
    const project = openProject(projectName);
    const ledger = readLedger(project);
    const result = parentResult(project, ledger, run);
    const questions = approvable(result?.questions ?? []);
    const item = viewRun(ledger, run).item;
    if (item === undefined) return off(`no run ${run} in ${projectName}`);
    const slug = item.startsWith(RITUAL_PREFIX) ? item.slice(RITUAL_PREFIX.length) : item;
    const doc = project.readItem<Ritual>("ritual", slug);
    const right = doc === null ? null : ritualHost(project, ledger, doc);
    if (right !== null && right.host !== host) {
      const approve = questions.length === 0 ? ["--note", "TEXT"] : questions.flatMap((question) => ["--approve", String(question.n)]);
      const command = sshDariusLine(right.host, ["run", "follow-up", run, ...approve, "--project", projectName]);
      return { ready: false, host, reason: `runs on ${right.host}; open this page on ${right.host}, or: ${command}`, rightHost: right.host, command };
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
    return { ready: true, host, profile: entry.profile ?? "built-in", questions };
  } catch (cause) {
    return off(errorMessage(cause));
  }
}
