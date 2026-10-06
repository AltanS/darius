/**
 * Follow-up runs (docs/concept.md, "Follow-up runs", 0.47.0). A complete run
 * of a ritual asks the operator questions; a question may list the exact
 * command lines a yes would run. `darius run follow-up <run> --approve N`
 * starts a new run of the same ritual, attended in a herdr tab, whose gate
 * passes those lines as written (grants, src/harness/gate.ts). Everything
 * else about the policy stays as it is.
 *
 * Since 0.69.0 the operator may also approve `needs-decision` items by
 * their key (`--item KEY`): the follow-up carries out exactly the proposals
 * of those items (src/core/result.ts, `proposal`), within the ritual's
 * policy plus its `follow_up_may`. An approved item grants no line.
 *
 * This file holds the parts the CLI and the runner share: the parent's
 * checks, the grants, the prompt section, and the ledger facts that link a
 * follow-up to its parent.
 */

import type { JsonValue, LedgerLine } from "../core/model.ts";
import { parseResult, type ResultItem, type RunResult } from "../core/result.ts";
import { getBlobText, type Project } from "../core/store.ts";
import { grantRefusal } from "../harness/gate.ts";
import { viewRun } from "./run-due.ts";

/** What `darius run follow-up` asks the runner for. */
export interface FollowUp {
  /** The complete run whose questions the operator approved. */
  parent: string;
  /** The approved question numbers, from 1. */
  approved: number[];
  /** The granted lines: the commands of the approved questions, then the `--grant` lines. */
  grants: string[];
  /** The keys of the approved `needs-decision` items (0.69.0), in the order given. */
  items?: string[];
  /** The operator's note for the follow-up. */
  note?: string;
  /** Run headless instead of in a herdr tab. The ritual's `follow_up = "headless"` does the same (0.69.0). */
  headless?: boolean;
}

/** The longest list of approved items a follow-up takes (0.69.0). */
export const ITEMS_MAX = 20;

/** The items of a result a follow-up may approve by key: state `needs-decision`, a key, and no other item with that key (0.69.0). */
export function approvableItems(result: RunResult | null): ResultItem[] {
  const items = result?.items ?? [];
  const count = new Map<string, number>();
  for (const item of items) if (item.key !== undefined) count.set(item.key, (count.get(item.key) ?? 0) + 1);
  return items.filter((item) => item.state === "needs-decision" && item.key !== undefined && count.get(item.key) === 1);
}

/** Why `key` cannot be approved on `parent`, or undefined when it can. */
function itemRefusal(result: RunResult | null, parent: string, key: string): string | undefined {
  const found = (result?.items ?? []).filter((item) => item.key === key);
  const shown = key.slice(0, 80);
  if (found.length === 0) return `run '${parent}' has no item with key '${shown}'`;
  if (found.length > 1) return `run '${parent}' has ${String(found.length)} items with key '${shown}'; an item is approved by a key that only one item has`;
  const state = found[0]?.state ?? "open";
  if (state !== "needs-decision") return `item '${shown}' of run '${parent}' is ${state}; only a needs-decision item can be approved`;
  return undefined;
}

function isText(value: JsonValue | undefined): value is string {
  return typeof value === "string";
}

/** The parent's result block from its blob, checked again; null without one. */
export function parentResult(project: Project, ledger: readonly LedgerLine[], parent: string): RunResult | null {
  const completed = ledger.findLast((line) => line.run === parent && line.type === "run.completed");
  const sha = completed?.result_sha;
  if (!isText(sha)) return null;
  const blob = getBlobText(project, sha);
  if (blob === null) return null;
  const parsed = parseResult(blob);
  return "result" in parsed ? parsed.result : null;
}

/** The run a run follows up, from its `run.started` line; undefined for any other run. */
export function followUpOf(ledger: readonly LedgerLine[], run: string): string | undefined {
  const started = ledger.find((line) => line.run === run && line.type === "run.started");
  return isText(started?.follow_up_of) ? started.follow_up_of : undefined;
}

/** The runs that follow up `parent`, in ledger order. */
export function followUpsOf(ledger: readonly LedgerLine[], parent: string): string[] {
  return ledger.flatMap((line) => (line.type === "run.started" && line.follow_up_of === parent && isText(line.run) ? [line.run] : []));
}

/** The first run of the project still in phase running, with its item; a held run does not count. */
function runningRun(ledger: readonly LedgerLine[]): { run: string; item: string } | undefined {
  const phase = new Map<string, { item: string; running: boolean }>();
  for (const line of ledger) {
    if (!isText(line.run)) continue;
    const known = phase.get(line.run);
    const item = known?.item ?? (isText(line.item) ? line.item : "");
    if (line.type === "run.started" || line.type === "run.resumed") phase.set(line.run, { item, running: true });
    else if (line.type === "run.held" || line.type === "run.completed") phase.set(line.run, { item, running: false });
    else if (known === undefined) phase.set(line.run, { item, running: false });
  }
  for (const [run, view] of phase) if (view.running) return { run, item: view.item };
  return undefined;
}

/** What the operator asked for on the command line. */
export interface FollowUpRequest {
  parent: string;
  approve: readonly number[];
  grant: readonly string[];
  /** The operator's note. With no lines granted, a non-empty note is the decision the run carries out (0.65.0). */
  note?: string;
  /** The keys of the `needs-decision` items the operator approves (0.69.0). */
  items?: readonly string[];
}

/**
 * The grants of a follow-up, or why it cannot start. `usage` is a mistake
 * on the command line (exit 2); `refused` is the state of the parent (exit 1).
 */
export type FollowUpPlan = { grants: string[]; items: string[] } | { usage: string } | { refused: string };

/**
 * Checks the parent and the request: the parent is a ritual run, closed
 * complete; each approved question exists and lists commands; each line is
 * one plain command; something to do is given: a granted line or, since
 * 0.65.0, a non-empty note (a decision follow-up, whose `grants` is empty);
 * each approved item key (0.69.0) names exactly one `needs-decision` item of
 * the parent, and is given once;
 * no follow-up of the parent is still open; no run of the project is running (a held run is
 * fine), so a granted line never races a run that is in the middle of its
 * work. Duplicate lines are granted once.
 */
export function planFollowUp(ledger: readonly LedgerLine[], result: RunResult | null, request: FollowUpRequest): FollowUpPlan {
  const { parent } = request;
  const view = viewRun(ledger, parent);
  if (view.item === undefined) return { usage: `no run '${parent}'` };
  if (!view.item.startsWith("ritual/")) return { usage: `run '${parent}' belongs to ${view.item}; only a ritual run has follow-ups` };
  if (view.phase !== "closed") return { refused: `run '${parent}' is ${view.phase ?? "unknown"}; a follow-up needs a closed run` };
  if (view.outcome !== "complete") return { refused: `run '${parent}' ended ${view.outcome ?? "without an outcome"}; a follow-up needs a complete run` };
  const grants: string[] = [];
  for (const n of request.approve) {
    const question = result?.questions[n - 1];
    if (question === undefined) {
      return { usage: `run '${parent}' has ${String(result?.questions.length ?? 0)} question(s) in its result; there is no question ${String(n)}` };
    }
    const lines = question.commands ?? [];
    if (lines.length === 0) return { usage: `question ${String(n)} lists no commands; use --grant` };
    grants.push(...lines);
  }
  for (const line of request.grant) {
    const refused = grantRefusal(line);
    if (refused !== undefined) return { usage: `--grant "${line.slice(0, 80)}" is not one plain command: ${refused}` };
    grants.push(line.trim());
  }
  const items = request.items ?? [];
  if (items.length > ITEMS_MAX) return { usage: `at most ${String(ITEMS_MAX)} --item keys, got ${String(items.length)}` };
  const seen = new Set<string>();
  for (const key of items) {
    if (seen.has(key)) return { usage: `--item '${key.slice(0, 80)}' is given twice` };
    seen.add(key);
    const refused = itemRefusal(result, parent, key);
    if (refused !== undefined) return { usage: refused };
  }
  if (grants.length === 0 && items.length === 0 && (request.note ?? "").trim() === "") {
    return { usage: "nothing to do: pass --approve N, --grant LINE, --item KEY or --note TEXT" };
  }
  const open = followUpsOf(ledger, parent).find((run) => viewRun(ledger, run).phase !== "closed");
  if (open !== undefined) return { refused: `follow-up ${open} of run '${parent}' is still open; finish it first` };
  const running = runningRun(ledger);
  if (running !== undefined) {
    const name = running.item.startsWith("ritual/") ? running.item.slice("ritual/".length) : running.item || "an unknown item";
    return { refused: `run ${running.run.slice(-6).toLowerCase()} of ${name} is running; a follow-up starts when no run is open` };
  }
  return { grants: [...new Set(grants)], items: [...items] };
}

const LIST_MAX = 20;

/** A list clipped to LIST_MAX lines, with a line that says how many were left out. */
function clipped(lines: readonly string[]): string[] {
  if (lines.length <= LIST_MAX) return [...lines];
  return [...lines.slice(0, LIST_MAX), `- (${String(lines.length - LIST_MAX)} more)`];
}

/** A text of an approved item, every line indented under its label, so a multi-line text stays one block. */
function block(label: string, text: string | undefined): string[] {
  if (text === undefined) return [];
  const [first = "", ...rest] = text.split("\n");
  return [`  ${label}: ${first}`, ...rest.map((line) => `    ${line}`)];
}

/** One approved item in full: key, title, target, detail and every proposal field (0.69.0). */
function approvedItemLines(item: ResultItem): string[] {
  const { proposal } = item;
  return [
    `- key: ${item.key ?? ""}`,
    `  title: ${item.title}`,
    ...block("target", item.target),
    ...block("detail", item.detail),
    ...block("current", proposal?.current),
    ...block("proposed", proposal?.proposed ?? "(no proposal: decide from the title and the detail, within the policy)"),
    ...block("why", proposal?.why),
    ...block("expected effect", proposal?.effect),
  ];
}

const REPORT_RULE = "In your result, report only the items you changed or re-checked, with the key of the parent's item when it has one. Do not repeat the parent's other items.";

/** The rule for approved proposals (0.69.0), naming the parent so the model can print each approved text. */
function proposalRule(parent: string): string {
  return [
    "Carry out exactly the approved proposals above, within this run's policy: may and hold apply as usual, and the procedure's rules for writes (checks before a write, before-states, verify after) still hold. Do not act on any other open item of that run.",
    `Print the approved text with \`darius run proposal ${parent} <key>\` (add \`--field current\` for the text there now) and pipe it into the write, so the page gets exactly the approved text, byte for byte. Do not retype it or quote it on the command line.`,
    "Verify each change. In your result, report each approved key once, with the parent's key: state fixed when the change is made and verified; state open, with the reason in detail, when it could not be done. Do not copy the proposal into the item. List each write you made as an action.",
  ].join(" ");
}

/**
 * The `## Follow-up` section of the run prompt, after the handoff. Facts
 * from the parent's result block, not its markdown: the block is checked
 * and clipped, the markdown is not. Approved items (0.69.0) are printed in
 * full under "Approved proposals"; every other open item stays one line.
 */
export function followUpSection(followUp: FollowUp, result: RunResult | null): string[] {
  const lines = ["## Follow-up", "", `This run follows up run ${followUp.parent}.${result === null ? "" : ` Its summary: ${result.summary}`}`, ""];
  for (const n of followUp.approved) {
    const question = result?.questions[n - 1];
    if (question === undefined) continue;
    const rec = question.recommendation === undefined ? "" : ` Recommended: ${question.recommendation}`;
    lines.push(`Approved question ${String(n)}: ${question.text}${rec}`);
  }
  const keys = new Set(followUp.items ?? []);
  const approvedItems = approvableItems(result).filter((item) => keys.has(item.key ?? ""));
  const hasGrants = followUp.grants.length > 0;
  const hasItems = approvedItems.length > 0;
  const isDecision = !hasGrants && !hasItems;
  if (followUp.note !== undefined) lines.push(`${isDecision ? "Operator decision" : "Operator note"}: ${followUp.note}`);
  lines.push("");
  if (hasGrants) {
    lines.push(
      "Granted lines. The gate passes each exactly as written, for you, not for a subagent, and only in the dir this run started in. Do not cd: a granted line names its dir with a flag.",
      "",
      "```bash",
      ...followUp.grants,
      "```",
      "",
    );
  }
  if (hasItems) {
    lines.push(`Approved proposals. The operator approved ${approvedItems.length === 1 ? "this item" : `these ${String(approvedItems.length)} items`} of that run, each by its key:`, "");
    for (const item of approvedItems) lines.push(...approvedItemLines(item), "");
  }
  const open = (result?.items ?? [])
    .filter((item) => item.state !== "fixed" && !(item.key !== undefined && keys.has(item.key)))
    .map((item) => `- ${item.severity} ${item.state}: ${item.title}${item.target === undefined ? "" : ` [${item.target}]`}${item.key === undefined ? "" : ` {${item.key}}`}`);
  if (open.length > 0) lines.push(hasItems ? "Other open items of that run, not approved:" : "Open items of that run:", ...clipped(open), "");
  const actions = (result?.actions ?? []).map((action) => `- ${action.state}: ${action.text}${action.target === undefined ? "" : ` [${action.target}]`}`);
  if (actions.length > 0) lines.push("Actions of that run:", ...clipped(actions), "");
  if (isDecision) {
    lines.push(
      `No lines are granted. Carry out the operator's decision within this run's policy: may and hold apply as usual, and the procedure's rules for writes (checks before a write, before-states, verify after) still hold. Verify each change. ${REPORT_RULE}`,
      "",
    );
    return lines;
  }
  const rule = [
    ...(hasGrants ? ["Run the granted lines as written, then verify each result."] : []),
    ...(hasItems ? [proposalRule(followUp.parent)] : []),
    "Anything else holds as usual.",
    REPORT_RULE,
  ];
  lines.push(rule.join(" "), "");
  return lines;
}
