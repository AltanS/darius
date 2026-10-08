/**
 * `darius finding list|show|close|reopen|reset`: the findings the rituals of
 * a project report across runs (docs/concept.md, "Findings (0.62.0)"). A
 * finding is derived from the ledger and the result blobs
 * (src/core/finding-index.ts); the only thing written is the operator's
 * close, reopen or reset, as one ledger line.
 *
 *   finding list [--ritual SLUG] [--open | --all] [--json]
 *                  default: the findings that need the operator (needs-you);
 *                  --open adds the open ones; --all adds closed, lapsed
 *                  and fixed
 *   finding show <key> [--ritual SLUG] [--json]
 *   finding close <key> [--ritual SLUG] [--note TEXT] [--who NAME]
 *                  refuses a fixed or an already closed finding
 *   finding reopen <key> [--ritual SLUG] [--who NAME]
 *                  refuses a finding that is not closed
 *   finding reset [--ritual SLUG] [--note TEXT] [--who NAME] (0.66.0)
 *                  hides every run result that completed before now, for
 *                  one ritual or for all; prints how many findings it hid
 *
 * A key is scoped to its ritual. A key found in more than one ritual needs
 * `--ritual` (a usage error, exit 2, that names them). An unknown key is a
 * usage error too. A refused close or reopen exits 1.
 */

import { collectFindings, FINDING_RESET, type Finding, type FindingStatus } from "../core/finding-index.ts";
import { appendLine, defaultWho, readLedger, type LedgerLineInput } from "../core/ledger.ts";
import { resolveProject } from "../core/paths.ts";
import { itemRef, openProject, type Project } from "../core/store.ts";
import { NotFoundError, UsageError, type Command, type ParsedArgs } from "./registry.ts";

const VERBS = "list | show | close | reopen | reset";

function stringFlag(args: ParsedArgs, name: string): string | undefined {
  const value = args.flags[name];
  if (value === undefined || value === false) return undefined;
  if (value === true) throw new UsageError(`--${name} needs a value`);
  return value;
}

function currentProject(args: ParsedArgs): Project {
  return openProject(resolveProject(stringFlag(args, "project")));
}

function printJson<T>(value: T): void {
  console.log(JSON.stringify(value));
}

function requireKey(args: ParsedArgs, verb: string): string {
  const key = args.positional[1];
  if (key === undefined || key === "") throw new UsageError(`finding ${verb}: missing <key>`);
  return key;
}

function stamp(at: string): string {
  return at.slice(0, 10);
}

function findingLine(finding: Finding): string {
  const where = [finding.group, finding.target].filter((part) => part !== undefined).join(", ");
  const tags = [finding.stale ? "stale" : "", finding.reopened ? "reopened" : ""].filter((tag) => tag !== "");
  const parts = [
    `${finding.status} ${finding.severity} ${finding.state}: ${finding.title}${where === "" ? "" : ` [${where}]`} {${finding.key}}`,
    ...tags,
    `since ${stamp(finding.firstSeen.at)}`,
    `in ${finding.ritual}`,
  ];
  return parts.join(" ");
}

// --- list -------------------------------------------------------------------------

function shownStatuses(args: ParsedArgs): readonly FindingStatus[] {
  if (args.flags.all === true) return ["needs-you", "open", "closed", "lapsed", "fixed"];
  if (args.flags.open === true) return ["needs-you", "open"];
  return ["needs-you"];
}

function findingList(args: ParsedArgs): number {
  const project = currentProject(args);
  const ritual = stringFlag(args, "ritual");
  const statuses = shownStatuses(args);
  const findings = collectFindings(project, readLedger(project)).filter(
    (finding) => statuses.includes(finding.status) && (ritual === undefined || finding.ritual === ritual),
  );
  if (args.json) {
    printJson({ project: project.name, findings });
    return 0;
  }
  if (findings.length === 0) console.log("no findings");
  for (const finding of findings) console.log(findingLine(finding));
  return 0;
}

// --- lookup -----------------------------------------------------------------------

/** The one finding named by `key` (and `ritual`), or a usage error: unknown, or in more than one ritual. */
function lookup(findings: readonly Finding[], key: string, ritual: string | undefined): Finding {
  const matches = findings.filter((finding) => finding.key === key && (ritual === undefined || finding.ritual === ritual));
  const [first] = matches;
  if (first === undefined) {
    throw new NotFoundError(`no finding '${key}'${ritual === undefined ? "" : ` in ritual '${ritual}'`}`);
  }
  if (matches.length > 1) {
    throw new UsageError(`finding '${key}' is in ${String(matches.length)} rituals (${matches.map((match) => match.ritual).join(", ")}); pass --ritual SLUG`);
  }
  return first;
}

// --- show -------------------------------------------------------------------------

function describeFinding(finding: Finding): string[] {
  const lines = [findingLine(finding)];
  if (finding.auto) lines.push("  key made by darius: the run gave none");
  lines.push(`  first seen run ${finding.firstSeen.run} at ${finding.firstSeen.at}`);
  lines.push(`  last seen run ${finding.lastSeen.run} at ${finding.lastSeen.at}, reported in ${String(finding.runs)} run(s)`);
  if (finding.detail !== undefined) lines.push(`  detail: ${finding.detail}`);
  if (finding.closed !== undefined) {
    const { closed } = finding;
    lines.push(`  closed by ${closed.who} at ${closed.at} at severity ${closed.severity}${closed.note === undefined ? "" : `: ${closed.note}`}`);
  }
  lines.push("  history, oldest first:");
  for (const step of finding.history) lines.push(`    ${step.at} run ${step.run}: ${step.severity} ${step.state}`);
  return lines;
}

function findingShow(args: ParsedArgs): number {
  const key = requireKey(args, "show");
  const project = currentProject(args);
  const finding = lookup(collectFindings(project, readLedger(project)), key, stringFlag(args, "ritual"));
  if (args.json) {
    printJson({ project: project.name, finding });
    return 0;
  }
  for (const line of describeFinding(finding)) console.log(line);
  return 0;
}

// --- close and reopen -------------------------------------------------------------

type Change = { ok: true; finding: Finding } | { ok: false; error: string };

/**
 * Writes one operator line under the project lock, the way
 * src/runner/hold.ts writes `run.acknowledged`: the finding is read again
 * inside the lock, so two operators cannot close it twice.
 */
function change(args: ParsedArgs, verb: "close" | "reopen"): Change {
  const key = requireKey(args, verb);
  const project = currentProject(args);
  const ritual = stringFlag(args, "ritual");
  const who = stringFlag(args, "who") ?? defaultWho();
  const note = stringFlag(args, "note");
  return project.withLock((): Change => {
    const finding = lookup(collectFindings(project, readLedger(project)), key, ritual);
    const named = `finding '${key}' of ritual '${finding.ritual}'`;
    if (verb === "close") {
      if (finding.status === "fixed") return { ok: false, error: `${named} is fixed; there is nothing to close` };
      if (finding.status === "closed") return { ok: false, error: `${named} is already closed by ${finding.closed?.who ?? "someone"}` };
    } else if (finding.status !== "closed") {
      return { ok: false, error: `${named} is not closed (status: ${finding.status})` };
    }
    const line: LedgerLineInput = {
      who,
      type: verb === "close" ? "finding.closed" : "finding.reopened",
      item: itemRef("ritual", finding.ritual),
      key,
    };
    if (verb === "close" && note !== undefined && note !== "") line.note = note;
    appendLine(project, line);
    return { ok: true, finding };
  });
}

function findingChange(args: ParsedArgs, verb: "close" | "reopen"): number {
  const result = change(args, verb);
  if (!result.ok) {
    if (args.json) printJson({ ok: false, error: result.error });
    else console.log(`! ${result.error}`);
    return 1;
  }
  const { finding } = result;
  if (args.json) printJson({ ok: true, ritual: finding.ritual, key: finding.key });
  else console.log(`✓ ${verb === "close" ? "closed" : "reopened"} finding '${finding.key}' of ritual '${finding.ritual}'`);
  return 0;
}

// --- reset ------------------------------------------------------------------------

/** What a reset hid: every finding of its scope, and how many of them waited (needs-you or open). */
interface ResetResult {
  hidden: number;
  waiting: number;
  ritual?: string;
}

/**
 * `finding reset` (0.66.0): one `finding.reset` ledger line, under the
 * project lock. collectFindings then ignores every result that completed
 * before it, for the ritual it names or for all. Nothing is deleted: the
 * results stay in the ledger and the blobs, and the line syncs like any
 * other.
 */
function findingReset(args: ParsedArgs): number {
  if (args.positional.length > 1) throw new UsageError("finding reset takes no <key>; pass --ritual SLUG to reset one ritual");
  const project = currentProject(args);
  const ritual = stringFlag(args, "ritual");
  const who = stringFlag(args, "who") ?? defaultWho();
  const note = stringFlag(args, "note");
  const result = project.withLock((): ResetResult => {
    const before = collectFindings(project, readLedger(project)).filter((finding) => ritual === undefined || finding.ritual === ritual);
    const line: LedgerLineInput = { who, type: FINDING_RESET };
    if (ritual !== undefined) line.item = itemRef("ritual", ritual);
    if (note !== undefined && note.trim() !== "") line.note = note.trim();
    appendLine(project, line);
    const after = new Set(collectFindings(project, readLedger(project)).map((finding) => `${finding.ritual}\u0000${finding.key}`));
    const hidden = before.filter((finding) => !after.has(`${finding.ritual}\u0000${finding.key}`));
    const reset: ResetResult = { hidden: hidden.length, waiting: hidden.filter((finding) => finding.status === "needs-you" || finding.status === "open").length };
    if (ritual !== undefined) reset.ritual = ritual;
    return reset;
  });
  const scope = result.ritual === undefined ? "all rituals" : `ritual '${result.ritual}'`;
  if (args.json) printJson({ ok: true, project: project.name, ...result });
  else console.log(`✓ reset the findings of ${scope} in ${project.name}: hid ${String(result.hidden)} finding(s), ${String(result.waiting)} of them open`);
  return 0;
}

// --- dispatch ---------------------------------------------------------------------

export const findingCommand: Command = {
  name: "finding",
  flags: ["all", "open", "ritual", "who", "note"],
  summary: "list, show, close, reopen and reset the findings rituals report across runs",
  audience: "session",
  usage: `finding ${VERBS.replaceAll(" | ", "|")}`,
  async run(args: ParsedArgs): Promise<number> {
    const verb = args.positional[0];
    switch (verb) {
      case "list":
        return findingList(args);
      case "show":
        return findingShow(args);
      case "close":
        return findingChange(args, "close");
      case "reopen":
        return findingChange(args, "reopen");
      case "reset":
        return findingReset(args);
      default:
        throw new UsageError(`finding needs a verb: ${VERBS}`);
    }
  },
};
