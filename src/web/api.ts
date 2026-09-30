/**
 * The contract between `darius serve` and the web app in `web/`
 * (docs/concept.md, "Web status page"). The web app is a React Router
 * framework-mode app. Its server build is bundled with everything it needs
 * and committed under `web/build/`, and `darius serve` imports it and calls
 * its handler with a `WebContext`. The loaders read darius ONLY through that
 * context: the data code stays in `src/`, the web bundle holds the pages.
 *
 * This file is type-only on the web side (`import type`), so nothing from
 * `src/` is bundled into the app. Keep it free of runtime imports.
 */

// --- markdown ------------------------------------------------------------------------------

/**
 * Findings and ritual instructions are written by a model or a person, so
 * they are untrusted text. darius parses them into blocks; the app renders
 * blocks as React elements, never as HTML. No links and no images exist in
 * this model on purpose: a link target is the one value a model could use to
 * put a `javascript:` URL on the page.
 */
export interface MdSpan {
  kind: "text" | "code" | "bold" | "italic";
  text: string;
}

/** One line of inline content. */
export type MdLine = MdSpan[];

export interface MdHeading {
  kind: "heading";
  /** 1 to 6, as written. The app maps it to its own heading sizes. */
  level: number;
  content: MdLine;
}

export interface MdParagraph {
  kind: "paragraph";
  /** Source lines, shown with a line break between them. */
  lines: MdLine[];
}

export interface MdList {
  kind: "list";
  ordered: boolean;
  /** The number of the first item; 1 for a bullet list. */
  start: number;
  items: MdLine[];
}

export interface MdTable {
  kind: "table";
  head: MdLine[];
  rows: MdLine[][];
}

export interface MdCode {
  kind: "code";
  text: string;
}

export type MdBlock = MdHeading | MdParagraph | MdList | MdTable | MdCode;

// --- status --------------------------------------------------------------------------------

/** A person saw a failed or abandoned run (`darius run ack`). Display only: the timer still does not retry it today. */
export interface Acknowledgement {
  at: string;
  who: string;
  note: string | null;
}

export interface RitualRow {
  slug: string;
  title: string;
  lifecycle: string;
  mode: string;
  cadence: string | null;
  nextDue: string | null;
  isDue: boolean;
  overdueDays: number;
  skill: string | null;
  profile: string | null;
  /** The one host whose runner starts this ritual; null when any host may. */
  host: string | null;
  lastCompleted: string | null;
  heldRun: string | null;
  openRun: string | null;
  /** The latest run failed or was abandoned today, so the timer does not start the ritual again today. */
  failedToday: { run: string; acknowledged: Acknowledgement | null } | null;
}

// --- run results (0.22.0) ------------------------------------------------------------------

/**
 * A run's result block (src/core/result.ts): what the model handed in with
 * its findings, checked by darius. Every text is untrusted plain text: the
 * app renders it as text, never as markdown, HTML or a link. `status` only
 * goes up: darius makes it `attention` when there is a question, an open
 * high or critical item, or an item not verified.
 */
export type ResultStatus = "ok" | "attention" | "failed";
export type ResultSeverity = "critical" | "high" | "medium" | "low" | "info";
/** `open` and `needs-decision` wait for someone; `not-verified` could not be settled; `fixed` is done. */
export type ResultItemState = "open" | "fixed" | "needs-decision" | "not-verified";

export interface ResultMetric {
  label: string;
  value: number | string;
  unit?: string;
  tone?: "ok" | "warn" | "bad";
}

export interface ResultItem {
  title: string;
  severity: ResultSeverity;
  state: ResultItemState;
  /** What the items group under, for example a market. */
  group?: string;
  /** What the item is about, for example a post. Text, never a link. */
  target?: string;
  detail?: string;
}

export interface ResultQuestion {
  text: string;
  recommendation?: string;
}

export interface ResultAction {
  text: string;
  state: "done" | "failed" | "skipped";
  target?: string;
}

export interface RunResult {
  v: 1;
  status: ResultStatus;
  summary: string;
  metrics: ResultMetric[];
  items: ResultItem[];
  questions: ResultQuestion[];
  actions: ResultAction[];
  /** A note of at most 200 characters for the next run of the ritual (0.26.0); absent when the run left none. */
  handoff?: string;
}

/** Items not yet fixed, per severity. */
export interface ResultCounts {
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
}

/** What a run row knows about the result without reading its blob: the counts on the ledger line. */
export interface RunResultSummary {
  status: ResultStatus;
  /** Questions for the operator. A complete run with questions waits for `darius run ack` (its note records the decision). */
  questions: number;
  open: ResultCounts;
  fixed: number;
}

export interface RunRow {
  run: string;
  /** `ritual/<slug>` or `vigil/<slug>`. */
  item: string;
  phase: "running" | "held" | "closed";
  outcome: string | null;
  startedAt: string;
  endedAt: string | null;
  who: string;
  questions: string[];
  findingsSha: string | null;
  /** Null for a run without a result block (older runs, by-hand runs, failed runs). */
  result: RunResultSummary | null;
  /** Set once a person acknowledged the failed or abandoned run. */
  acknowledged: Acknowledgement | null;
}

export interface VigilRow {
  slug: string;
  title: string;
  state: string;
  verdict: string | null;
  flagged: boolean;
  lastOutcome: string | null;
  due: string | null;
  until: string | null;
}

export interface ProjectStatus {
  name: string;
  /** This host's checkout, from `darius link`; null when the project has none here. */
  checkout: string | null;
  maxMode: string | null;
  lastSync: string | null;
  rituals: RitualRow[];
  /** The newest 20 runs. */
  runs: RunRow[];
  vigils: VigilRow[];
  /** Set when darius could not read the project; the lists are then empty. */
  error: string | null;
}

export interface ProfileRow {
  name: string;
  harness: string;
  model: string | null;
  effort: string | null;
  permissions: string;
  surface: string;
}

export interface HostStatus {
  host: string;
  version: string;
  generatedAt: string;
  /** The host's local date, YYYY-MM-DD. */
  today: string;
  /**
   * The host's offset from UTC at `generatedAt`, in minutes east (120 for
   * CEST). The app shows clock times ("started 23:42") in the host's zone, the
   * same on the server and in the browser, so the page hydrates cleanly.
   */
  utcOffset: number;
  profiles: ProfileRow[];
  projects: ProjectStatus[];
}

// --- details -------------------------------------------------------------------------------

export interface RitualPolicy {
  mode: string;
  may: string[];
  hold: string[];
  notes: string | null;
  model: string | null;
  maxTurns: number | null;
  profile: string | null;
}

/**
 * What the next run of a ritual gets at the top of its prompt (0.26.0): the
 * note of the latest run that handed in a result, its questions, and the
 * operator's note on that run.
 */
export interface RitualHandoff {
  /** The run that left it. */
  run: string;
  /** When that run completed. */
  at: string;
  /** Null when that run left no note. */
  note: string | null;
  questions: ResultQuestion[];
  /** The operator's note from `darius run ack --note`; null until then. */
  operator: { who: string; at: string; note: string } | null;
}

export interface RitualDetail {
  project: string;
  row: RitualRow;
  anchor: string;
  policy: RitualPolicy;
  /** The ritual's instructions, from the body of its definition. */
  body: MdBlock[];
  /** Every run of this ritual, newest first, at most 100. */
  runs: RunRow[];
  /** Null when no run passed anything on. */
  handoff: RitualHandoff | null;
}

export interface RunEvent {
  at: string;
  who: string;
  /** The ledger type, for example `run.started` or `run.held`. */
  type: string;
  /** A short human line for the event (the outcome, a question, a reason), or null. */
  detail: string | null;
}

export interface RunDetail {
  project: string;
  row: RunRow;
  /** The ritual or vigil slug from `row.item`. */
  itemKind: string;
  itemSlug: string;
  events: RunEvent[];
  /** Null when the run has no findings (yet). The result block is cut out of them. */
  findings: MdBlock[] | null;
  /** The whole result block; null when the run handed in none. */
  result: RunResult | null;
}

// --- the handler ---------------------------------------------------------------------------

/**
 * What `darius serve` passes to the app with every request, as the React
 * Router load context. All reads are synchronous reads of the local store.
 */
export interface WebContext {
  /** Who is looking: "this host", or "<login> on <device>". */
  viewer: string;
  /** A fresh base64 nonce per request. The CSP allows only scripts that carry it. */
  nonce: string;
  status(): HostStatus;
  /** Null when the project or the ritual is unknown. */
  ritual(project: string, slug: string): RitualDetail | null;
  /** Null when the project or the run is unknown. */
  run(project: string, run: string): RunDetail | null;
}

/**
 * The default export of `web/build/server/index.js`: one request in, one
 * response out. `darius serve` has already checked access and serves the
 * static files under `web/build/client` itself.
 */
export type WebHandler = (request: Request, context: WebContext) => Promise<Response>;
