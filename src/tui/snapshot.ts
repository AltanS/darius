/**
 * What the TUI shows, read from the local store. The Due list comes from the
 * web page's status reader (`collectStatus()` in src/web/status.ts), a run
 * from `runFindings()` there plus the runner's run view (`viewRun()` in
 * src/runner/run-due.ts), which knows the answers. Nothing here writes.
 * Every call is a fresh read: the screens re-read on each key and every few
 * seconds, so a run that ends or gets answered elsewhere shows up.
 *
 * THE DUE LIST, in this order (the concept lists rituals first; held runs
 * and runs that ask lead here because they are the rows that wait for the
 * operator):
 *
 *   1. Held runs: project, ritual, questions, answers.
 *   2. Complete runs whose result asks the operator something (0.22.0),
 *      until a person records a decision (`darius run ack --note`).
 *   3. Rituals that are due or overdue, mode `off` included (the row says so).
 *   4. Open vigils that are due, armed (waiting on an event) or flagged.
 *   5. Rituals whose latest run ended `failed` today, unless a person
 *      acknowledged that run. Such a ritual stays due, but it is listed here
 *      only: both rows would open the same run. An acknowledged one is a Due
 *      row again, marked "failed today, acknowledged": the timer still does
 *      not retry it today.
 *
 * A run's full result is a blob (`result_sha` on its `run.completed`
 * line); the Run screen reads it and checks it again with `parseResult()`,
 * since a blob from another host is as untrusted as the model.
 *
 * `collectStatus()` lists a project's 20 newest runs. The full ledger is
 * read once more, only for a project that has a held run (its answers) or a
 * due ritual whose latest run is older than those 20.
 */

import { readLedger } from "../core/ledger.ts";
import type { JsonValue, LedgerLine, Ritual } from "../core/model.ts";
import { parseResult, type RunResult } from "../core/result.ts";
import { getBlobText, itemRef, openProject, type Project } from "../core/store.ts";
import { localToday } from "../core/sweep.ts";
import { viewRun, type RunView } from "../runner/run-due.ts";
import type { Acknowledgement, ProjectStatus, RitualRow, RunResultSummary, RunRow, VigilRow } from "../web/api.ts";
import { collectStatus, RECENT_RUNS, runFindings, runRows } from "../web/status.ts";

export interface RunTarget {
  project: string;
  run: string;
}

export interface HeldRow {
  kind: "held";
  project: string;
  slug: string;
  run: string;
  questions: number;
  answered: number;
}

/** A complete run whose result asks the operator something that nobody answered yet. */
export interface AsksRow {
  kind: "asks";
  project: string;
  slug: string;
  run: string;
  questions: number;
  endedAt: string;
}

export interface DueRitualRow {
  kind: "ritual";
  project: string;
  slug: string;
  title: string;
  nextDue: string | null;
  overdueDays: number;
  isOff: boolean;
  isRunning: boolean;
  /** Its latest run failed today and a person acknowledged it. */
  isAcknowledgedFailure: boolean;
  /** The one host whose runner starts it; null when any host may. */
  host: string | null;
  /** The run Enter opens; null when the ritual never ran. */
  latestRun: string | null;
}

export interface VigilDueRow {
  kind: "vigil";
  project: string;
  slug: string;
  title: string;
  gate: "flagged" | "due" | "armed";
  due: string | null;
  until: string | null;
}

export interface FailedRow {
  kind: "failed";
  project: string;
  slug: string;
  run: string;
  endedAt: string;
}

export type DueRow = HeldRow | AsksRow | DueRitualRow | VigilDueRow | FailedRow;

export interface DueSnapshot {
  host: string;
  version: string;
  /** When the store was read, ISO. */
  readAt: string;
  rows: DueRow[];
  /** One line per project darius could not read. */
  errors: string[];
}

interface Sections {
  held: HeldRow[];
  asks: AsksRow[];
  due: DueRitualRow[];
  vigils: VigilDueRow[];
  failed: FailedRow[];
}

/** The slug of `ritual/<slug>`. */
function slugOf(item: string): string {
  return item.slice(item.indexOf("/") + 1);
}

/** Answers to questions the run actually asked. */
function answeredCount(view: RunView): number {
  return [...view.answers.keys()].filter((n) => n <= view.questions.length).length;
}

function vigilGate(vigil: VigilRow, today: string): VigilDueRow["gate"] | null {
  if (vigil.state !== "open") return null;
  if (vigil.flagged) return "flagged";
  if (vigil.due !== null && vigil.due <= today) return "due";
  if (vigil.until !== null) return "armed";
  // A vigil with neither gate is treated as due (docs/concept.md, "Vigil auto-execution" > "Gate").
  return vigil.due === null ? "due" : null;
}

/** A complete run with questions in its result, not acknowledged: it waits for the operator's decision. */
export function asksOperator(run: RunRow): run is RunRow & { endedAt: string } {
  return run.phase === "closed" && run.outcome === "complete" && run.endedAt !== null && (run.result?.questions ?? 0) > 0 && run.acknowledged === null;
}

function isFailedToday(run: RunRow | undefined, today: string): run is RunRow & { endedAt: string } {
  if (run?.phase !== "closed" || run.outcome !== "failed" || run.endedAt === null) return false;
  return localToday(new Date(run.endedAt)) === today;
}

/** The rows of one readable project. */
function projectSections(project: ProjectStatus, today: string): Sections {
  let ledger: LedgerLine[] | undefined;
  let allRuns: RunRow[] | undefined;
  const fullLedger = (): LedgerLine[] => (ledger ??= readLedger(openProject(project.name)));
  const everyRun = (): RunRow[] => (allRuns ??= runRows(fullLedger()));
  const isComplete = project.runs.length < RECENT_RUNS;
  const latestRun = (ritual: RitualRow): RunRow | undefined => {
    const ref = itemRef("ritual", ritual.slug);
    const recent = project.runs.find((run) => run.item === ref);
    if (recent !== undefined || isComplete || !ritual.isDue) return recent;
    return everyRun().find((run) => run.item === ref);
  };

  const sections: Sections = { held: [], asks: [], due: [], vigils: [], failed: [] };
  const heldRuns = new Map<string, string>();
  for (const ritual of project.rituals) if (ritual.heldRun !== null) heldRuns.set(ritual.heldRun, ritual.slug);
  for (const run of project.runs) if (run.phase === "held") heldRuns.set(run.run, slugOf(run.item));
  for (const [run, slug] of heldRuns) {
    const view = viewRun(fullLedger(), run);
    if (view.phase !== "held") continue;
    sections.held.push({ kind: "held", project: project.name, slug, run, questions: view.questions.length, answered: answeredCount(view) });
  }

  for (const run of project.runs) {
    if (!asksOperator(run)) continue;
    sections.asks.push({ kind: "asks", project: project.name, slug: slugOf(run.item), run: run.run, questions: run.result?.questions ?? 0, endedAt: run.endedAt });
  }

  for (const ritual of project.rituals) {
    const latest = latestRun(ritual);
    const hasFailed = isFailedToday(latest, today);
    if (hasFailed && latest.acknowledged === null) {
      sections.failed.push({ kind: "failed", project: project.name, slug: ritual.slug, run: latest.run, endedAt: latest.endedAt });
      continue;
    }
    if (!ritual.isDue) continue;
    sections.due.push({
      kind: "ritual",
      project: project.name,
      slug: ritual.slug,
      title: ritual.title,
      nextDue: ritual.nextDue,
      overdueDays: ritual.overdueDays,
      isOff: ritual.mode === "off",
      isRunning: ritual.openRun !== null,
      isAcknowledgedFailure: hasFailed,
      host: ritual.host,
      latestRun: latest?.run ?? null,
    });
  }

  for (const vigil of project.vigils) {
    const gate = vigilGate(vigil, today);
    if (gate === null) continue;
    sections.vigils.push({ kind: "vigil", project: project.name, slug: vigil.slug, title: vigil.title, gate, due: vigil.due, until: vigil.until });
  }
  return sections;
}

/**
 * The Due list of every project in the local store. `collectStatus()` never
 * lists the reserved `_global` project, so its profiles never show here.
 */
export function readDue(now: Date = new Date()): DueSnapshot {
  const status = collectStatus(now);
  const all: Sections = { held: [], asks: [], due: [], vigils: [], failed: [] };
  const errors: string[] = [];
  for (const project of status.projects) {
    if (project.error !== null) {
      errors.push(`${project.name}: ${project.error}`);
      continue;
    }
    const sections = projectSections(project, status.today);
    all.held.push(...sections.held);
    all.asks.push(...sections.asks);
    all.due.push(...sections.due);
    all.vigils.push(...sections.vigils);
    all.failed.push(...sections.failed);
  }
  return { host: status.host, version: status.version, readAt: status.generatedAt, rows: [...all.held, ...all.asks, ...all.due, ...all.vigils, ...all.failed], errors };
}

export interface RunSnapshot {
  project: string;
  run: string;
  /** `ritual/<slug>`. */
  item: string;
  /** The ritual's title; null when its definition is gone. */
  title: string | null;
  phase: RunRow["phase"];
  outcome: string | null;
  startedAt: string;
  endedAt: string | null;
  /** The raw markdown of the findings; null when the run has none (yet). */
  findings: string | null;
  /** Every question of every hold, in order; question n is `questions[n - 1]`. */
  questions: string[];
  /** The latest answer per question number. */
  answers: ReadonlyMap<number, string>;
  /** An answer came after the latest hold: the run may resume. */
  isAnswered: boolean;
  /** Set once a person acknowledged the failed or abandoned run, or recorded a decision on its result's questions. */
  acknowledged: Acknowledgement | null;
  /** The run ended on this host's today. */
  isEndedToday: boolean;
  /** The counts of the run's result, from its ledger line; null when it handed in none. */
  summary: RunResultSummary | null;
  /** The whole result, from its blob; null without one, or when the blob is not on this host or does not check. */
  result: RunResult | null;
}

function isText(value: JsonValue | undefined): value is string {
  return typeof value === "string";
}

/** The run's result blob, checked again: null when it has none, the blob is missing, or it does not check. */
function readResult(project: Project, ledger: readonly LedgerLine[], run: string): RunResult | null {
  const sha = ledger.findLast((entry) => entry.run === run && entry.type === "run.completed")?.result_sha;
  if (!isText(sha)) return null;
  const blob = getBlobText(project, sha);
  if (blob === null) return null;
  const parsed = parseResult(blob);
  return "result" in parsed ? parsed.result : null;
}

/** One run, fresh from the store; null when the project or the run is unknown. */
export function readRun(target: RunTarget, now: Date = new Date()): RunSnapshot | null {
  const found = runFindings(target.project, target.run);
  if (found === null) return null;
  const project = openProject(target.project);
  const ledger = readLedger(project);
  const view = viewRun(ledger, target.run);
  const { row } = found;
  const title = row.item.startsWith("ritual/") ? (project.readItem<Ritual>("ritual", slugOf(row.item))?.header.title ?? null) : null;
  return {
    project: target.project,
    run: target.run,
    item: row.item,
    title,
    phase: view.phase ?? row.phase,
    outcome: row.outcome,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    findings: found.findings,
    questions: view.questions,
    answers: view.answers,
    isAnswered: view.isAnswered,
    acknowledged: row.acknowledged,
    isEndedToday: row.endedAt !== null && localToday(new Date(row.endedAt)) === localToday(now),
    summary: row.result,
    result: readResult(project, ledger, target.run),
  };
}
