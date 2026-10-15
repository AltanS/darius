/**
 * The activity model (0.88.0; docs/concept.md, "Web status page"): one event
 * list behind every timeline of the web app. `activityOf` turns the ledger
 * lines of one project into `ActivityEntry` rows (who, when, kind, text,
 * links), so the ritual page, the run page, the vigil page and a workspace
 * agree on what an event is called.
 *
 * Pure: it reads no file and writes none. The caller reads the ledger and, if
 * it wants item titles, passes `titleOf`. The list of kinds is closed on
 * purpose. A ledger type that is not handled here (`snapshot.*`, `alert.*`,
 * `push.*`, `harness.*`, `tree.*`, `ritual.defined`, a dry-run sweep, anything
 * new) is left out until someone adds it deliberately.
 *
 * Every operator text it shows (a note, an answer, a reason, a granted line)
 * goes through `maskSecrets`: the ledger is append only and syncs, so a
 * secret typed into a note is shown masked, as the vigil page does.
 */

import { maskSecrets } from "../core/mask-secrets.ts";
import type { JsonValue, LedgerLine } from "../core/model.ts";
import type { ActivityActor, ActivityEntry, ActivityKind, ActivityOptions, ActivityTone, RunRow } from "./api.ts";

/** `activityOf` options: the filters of the contract, and the title lookup that keeps the function free of reads. */
interface ActivityInput extends ActivityOptions {
  /** The title of a ritual or vigil by its slug; the entry falls back to the slug. */
  titleOf?: (type: "ritual" | "vigil", id: string) => string | undefined;
}

const RUN_ID = /^[0-9A-Z]{26}$/u;
/** `who` values darius writes itself: an import and the default sweep. */
const SYSTEM_WHO: ReadonlySet<string> = new Set(["import", "sweep"]);

function isRecord(value: JsonValue | undefined): value is { readonly [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: JsonValue | undefined): value is string {
  return typeof value === "string";
}

function isNumber(value: JsonValue | undefined): value is number {
  return typeof value === "number";
}

function text(value: JsonValue | undefined): string | null {
  return isString(value) && value !== "" ? value : null;
}

function textList(value: JsonValue | undefined): string[] {
  return Array.isArray(value) ? value.filter((entry) => isString(entry)) : [];
}

function numberList(value: JsonValue | undefined): number[] {
  return Array.isArray(value) ? value.filter((entry) => isNumber(entry)) : [];
}

/** Who acted, from the `who` of a line. */
export function actorOf(who: string): ActivityActor {
  if (who.startsWith("web:")) return "web";
  if (who === "timer") return "timer";
  if (SYSTEM_WHO.has(who)) return "system";
  if (RUN_ID.test(who)) return "run";
  return "cli";
}

/** Who started a run, in the three words `RunRow.startedBy` has. */
export function startedByOf(who: string): RunRow["startedBy"] {
  if (who.startsWith("web:")) return "web";
  return who === "timer" ? "timer" : "cli";
}

/** The kind of an acknowledgement. The order is the contract: answers, a follow-up, a dismissal, a note. */
export function ackKindOf(line: LedgerLine): "answered" | "dismissed" | "note" | "follow-up" {
  if (Array.isArray(line.answers) && line.answers.length > 0) return "answered";
  if (text(line.follow_up) !== null) return "follow-up";
  if (text(line.earlier_than) !== null || text(line.note) === null) return "dismissed";
  return "note";
}

/** Operator text as one masked line. */
function shown(value: string): string {
  return maskSecrets(value);
}

function plural(count: number, word: string): string {
  return `${String(count)} ${word}${count === 1 ? "" : "s"}`;
}

interface Built {
  kind: ActivityKind;
  text: string;
  tone: ActivityTone;
  detail?: string[];
}

/** `built` with its detail lines, or as it is when there are none. */
function detailed(built: Built, detail: readonly string[]): Built {
  if (detail.length > 0) built.detail = [...detail];
  return built;
}

/** What a run line is about. */
interface Subject {
  /** `ritual/<slug>` or `vigil/<slug>`, or the ref of a finding line's ritual. */
  ref: string;
  slug: string;
  type: "ritual" | "vigil";
}

function subjectOf(ref: string | undefined): Subject | null {
  if (ref === undefined) return null;
  const slash = ref.indexOf("/");
  if (slash < 0) return null;
  const type = ref.slice(0, slash);
  const slug = ref.slice(slash + 1);
  if ((type !== "ritual" && type !== "vigil") || slug === "") return null;
  return { ref, slug, type };
}

// --- one builder per ledger type ----------------------------------------------------------

function startedEntry(line: LedgerLine): Built {
  const parent = text(line.follow_up_of);
  const answersRead = textList(line.answers_read);
  const read = answersRead.length > 0 ? [`Read ${plural(answersRead.length, "answer")}`] : [];
  if (parent === null) return detailed({ kind: "run-started", text: `Run started by ${line.who}`, tone: "run" }, read);
  const approved = numberList(line.approved).map((n) => `Q${String(n)}`);
  const items = textList(line.items).map((key) => `item ${key}`);
  const grants = textList(line.grants);
  const parts = [...(approved.length > 0 ? [`approved ${approved.join(", ")}`] : []), ...(items.length > 0 ? [items.join(", ")] : []), ...(grants.length > 0 ? [`granted ${plural(grants.length, "line")}`] : [])];
  const note = text(line.note);
  const what = [...(parts.length > 0 ? [parts.join(", ")] : []), ...(note === null ? [] : [`note: ${shown(note)}`])];
  const detail = [...grants.map((grant) => `Granted: ${shown(grant)}`), ...read];
  return detailed({ kind: "follow-up-started", text: `Follow-up of ${parent} started by ${line.who}${what.length > 0 ? `: ${what.join("; ")}` : ""}`, tone: "run" }, detail);
}

function heldEntry(line: LedgerLine): Built {
  const questions = textList(line.questions);
  return detailed({ kind: "run-held", text: `Run held with ${plural(questions.length, "question")}`, tone: "wait" }, questions.map((question) => shown(question)));
}

function answeredEntry(line: LedgerLine): Built {
  const answer = text(line.text);
  const subject = isNumber(line.n) ? `Q${String(line.n)}` : "Question";
  return detailed({ kind: "run-answered", text: `${subject} answered by ${line.who}`, tone: "wait" }, answer === null ? [] : [shown(answer)]);
}

function resumedEntry(line: LedgerLine): Built {
  const answersRead = textList(line.answers_read);
  return detailed({ kind: "run-resumed", text: `Run resumed by ${line.who} ${line.fresh === true ? "in a new session" : "in the same session"}`, tone: "run" }, answersRead.length > 0 ? [`Read ${plural(answersRead.length, "answer")}`] : []);
}

function completedEntry(line: LedgerLine): Built {
  const outcome = text(line.outcome) ?? "unknown";
  if (outcome !== "complete") return { kind: "run-failed", text: `Run ${outcome}`, tone: "bad" };
  const result = isRecord(line.result) ? line.result : undefined;
  const asked = result?.questions;
  const questions = isNumber(asked) ? asked : 0;
  return { kind: "run-completed", text: questions > 0 ? `Run completed with ${plural(questions, "question")} for you` : "Run completed", tone: questions > 0 ? "wait" : "ok" };
}

function acknowledgedEntry(line: LedgerLine): Built {
  const kind = ackKindOf(line);
  const note = text(line.note);
  const fromAnswers = line.note_from_answers === true;
  const answers = Array.isArray(line.answers) ? line.answers.flatMap((one) => (isRecord(one) && isNumber(one.n) && isString(one.text) ? [`Q${String(one.n)}: ${shown(one.text)}`] : [])) : [];
  const aside = note !== null && !fromAnswers ? `; note: ${shown(note)}` : "";
  if (kind === "answered") return detailed({ kind: "ack-answered", text: `Answered by ${line.who}${aside}`, tone: "ok" }, answers);
  if (kind === "follow-up") return { kind: "ack-follow-up", text: `Follow-up ${text(line.follow_up) ?? "run"} chosen by ${line.who}${aside}`, tone: "run" };
  if (kind === "dismissed") {
    const earlier = text(line.earlier_than);
    return { kind: "ack-dismissed", text: earlier === null ? `Dismissed by ${line.who}` : `Dismissed by ${line.who} as older than run ${earlier}`, tone: "idle" };
  }
  return { kind: "ack-note", text: `Noted by ${line.who}: ${shown(note ?? "")}`, tone: "idle" };
}

/** The checks a sweep ran, one line each, from its evidence lines. */
function evidenceDetail(evidence: readonly LedgerLine[]): string[] {
  return evidence.map((line) => {
    const check = text(line.check) ?? "";
    const index = check.includes("#") ? check.slice(check.lastIndexOf("#") + 1) : "?";
    const exit = isNumber(line.exit) ? `, exit ${String(line.exit)}` : "";
    const command = text(line.command);
    return `Check ${index}: ${text(line.outcome) ?? "unknown"}${exit}${command === null ? "" : ` (${shown(command)})`}`;
  });
}

function sweptEntry(line: LedgerLine, evidence: readonly LedgerLine[]): Built {
  const outcome = text(line.outcome) ?? "unknown";
  const reason = text(line.reason);
  const tone: ActivityTone = outcome === "held" ? "ok" : outcome === "failed" ? "bad" : outcome === "skipped" ? "idle" : "wait";
  const detail = [...evidenceDetail(evidence), ...(reason === null ? [] : [shown(reason)])];
  return detailed({ kind: "vigil-swept", text: `Checked by ${line.who}: ${outcome}`, tone }, detail);
}

function pausedEntry(line: LedgerLine): Built {
  const until = text(line.until);
  const reason = text(line.reason);
  return { kind: "vigil-paused", text: `Paused by ${line.who}${until === null ? "" : ` until ${shown(until)}`}${reason === null ? "" : `: ${shown(reason)}`}`, tone: "wait" };
}

function closedEntry(line: LedgerLine): Built {
  const verdict = shown(text(line.verdict) ?? "closed");
  const by = text(line.by) === null ? null : shown(text(line.by) ?? "");
  const reason = text(line.reason);
  const tail = [...(by === null || by === line.who ? [] : [`by ${by}`]), ...(reason === null ? [] : [shown(reason)])];
  return { kind: "vigil-closed", text: `Closed ${verdict} by ${line.who}${tail.length > 0 ? `: ${tail.join("; ")}` : ""}`, tone: verdict === "held" ? "ok" : "idle" };
}

function findingEntry(line: LedgerLine, kind: "finding-closed" | "finding-reopened"): Built {
  const key = text(line.key) ?? "?";
  const note = text(line.note);
  const verb = kind === "finding-closed" ? "closed" : "reopened";
  return { kind, text: `Finding ${shown(key)} ${verb} by ${line.who}${note === null ? "" : `: ${shown(note)}`}`, tone: kind === "finding-closed" ? "idle" : "wait" };
}

function resetEntry(line: LedgerLine): Built {
  const note = text(line.note);
  const scope = subjectOf(line.item)?.slug;
  return { kind: "finding-reset", text: `Findings of ${scope === undefined ? "every ritual" : `ritual ${scope}`} reset by ${line.who}${note === null ? "" : `: ${shown(note)}`}`, tone: "idle" };
}

function lifecycleEntry(line: LedgerLine): Built {
  const state = shown(text(line.state) ?? "changed");
  const note = text(line.note);
  return { kind: "ritual-lifecycle", text: `Ritual ${state} by ${line.who}${note === null ? "" : `: ${shown(note)}`}`, tone: state === "active" ? "ok" : "idle" };
}

function rescheduledEntry(line: LedgerLine): Built {
  const due = text(line.due);
  return { kind: "ritual-rescheduled", text: `Ritual rescheduled by ${line.who}${due === null ? "" : ` to ${shown(due)}`}`, tone: "idle" };
}

// --- the list -----------------------------------------------------------------------------

function entryOf(line: LedgerLine, built: Built, input: ActivityInput, runItems: ReadonlyMap<string, string>): ActivityEntry | null {
  const run = text(line.run);
  const subject = subjectOf(line.item ?? (run === null ? undefined : runItems.get(run)));
  const title = (type: "ritual" | "vigil", slug: string): string => input.titleOf?.(type, slug) ?? slug;
  const links: ActivityEntry["links"] = {};
  if (subject !== null) links[subject.type] = subject.slug;
  const entry = (item: ActivityEntry["item"]): ActivityEntry => {
    const made: ActivityEntry = { at: line.at, who: line.who, actor: actorOf(line.who), kind: built.kind, item, text: built.text, links, tone: built.tone };
    if (built.detail !== undefined) made.detail = built.detail;
    return made;
  };
  if (built.kind.startsWith("finding-")) {
    const key = text(line.key);
    if (built.kind === "finding-reset") return entry(subject === null ? { type: "finding", id: "", title: "All findings" } : { type: "ritual", id: subject.slug, title: title("ritual", subject.slug) });
    if (key === null) return null;
    links.finding = key;
    return entry({ type: "finding", id: key, title: key });
  }
  if (run !== null) {
    links.run = run;
    const made = entry({ type: "run", id: run, title: subject === null ? run : title(subject.type, subject.slug) });
    made.run = run;
    return made;
  }
  if (subject === null) return null;
  return entry({ type: subject.type, id: subject.slug, title: title(subject.type, subject.slug) });
}

/** The entry a ledger line makes, or null when the type is not part of activity. Evidence lines are handled by the caller. */
function build(line: LedgerLine, evidence: readonly LedgerLine[]): Built | null {
  switch (line.type) {
    case "run.started":
      return startedEntry(line);
    case "run.held":
      return heldEntry(line);
    case "run.answered":
      return answeredEntry(line);
    case "run.resumed":
      return resumedEntry(line);
    case "run.completed":
      return completedEntry(line);
    case "run.acknowledged":
      return acknowledgedEntry(line);
    case "vigil.swept":
      return line.dry_run === true ? null : sweptEntry(line, evidence);
    case "vigil.paused":
      return pausedEntry(line);
    case "vigil.resumed":
      return { kind: "vigil-resumed", text: `Resumed by ${line.who}`, tone: "ok" };
    case "vigil.closed":
      return closedEntry(line);
    case "finding.closed":
      return findingEntry(line, "finding-closed");
    case "finding.reopened":
      return findingEntry(line, "finding-reopened");
    case "finding.reset":
      return resetEntry(line);
    case "ritual.lifecycle":
      return lifecycleEntry(line);
    case "ritual.rescheduled":
      return rescheduledEntry(line);
    default:
      return null;
  }
}

/** True when the entry's line passes the filters. A filter that names an id the line does not carry drops it. */
function matches(line: LedgerLine, entry: ActivityEntry, options: ActivityOptions): boolean {
  if (options.ritual !== undefined && entry.links.ritual !== options.ritual) return false;
  if (options.vigil !== undefined && entry.links.vigil !== options.vigil) return false;
  if (options.finding !== undefined && entry.links.finding !== options.finding) return false;
  if (options.run !== undefined && ![line.run, line.follow_up_of, line.follow_up].includes(options.run)) return false;
  if (options.since !== undefined && entry.at < options.since) return false;
  return true;
}

/**
 * The activity of one project, newest first. `lines` is the project's ledger
 * in order (oldest first, as `readLedger` gives it). `evidence` lines fold
 * into the `vigil.swept` line that follows them and never show on their own.
 */
export function activityOf(project: string, lines: readonly LedgerLine[], input: ActivityInput = {}): ActivityEntry[] {
  const runItems = new Map<string, string>();
  for (const line of lines) {
    const run = text(line.run);
    if (line.type === "run.started" && run !== null && line.item !== undefined) runItems.set(run, line.item);
  }
  const entries: ActivityEntry[] = [];
  const evidence = new Map<string, LedgerLine[]>();
  for (const line of lines) {
    if (line.project !== project) continue;
    if (line.type === "evidence" && line.item !== undefined) {
      evidence.set(line.item, [...(evidence.get(line.item) ?? []), line]);
      continue;
    }
    const folded = line.type === "vigil.swept" && line.item !== undefined ? (evidence.get(line.item) ?? []) : [];
    if (line.type === "vigil.swept" && line.item !== undefined) evidence.delete(line.item);
    const built = build(line, folded);
    if (built === null) continue;
    const entry = entryOf(line, built, input, runItems);
    if (entry !== null && matches(line, entry, input)) entries.push(entry);
  }
  entries.reverse();
  return input.limit === undefined ? entries : entries.slice(0, Math.max(0, input.limit));
}
