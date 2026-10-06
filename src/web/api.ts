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

/**
 * A checklist box, as the tracker writes it: `[x]` done, `[ ]` open, `[~]`
 * in progress, `[!]` blocked, `[-]` skipped.
 */
export type MdCheck = "done" | "open" | "doing" | "blocked" | "skipped";

export interface MdList {
  kind: "list";
  ordered: boolean;
  /** The number of the first item; 1 for a bullet list. */
  start: number;
  items: MdLine[];
  /** Per item, its checklist box, or null for a plain item. Absent when no item has one (0.42.0). */
  checks?: Array<MdCheck | null>;
  /** Per item, true when it is indented under the item before it. Absent when none is (0.42.0). */
  nested?: boolean[];
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
  /**
   * `repo`: defined in `.darius.toml` (marker v3), so git owns the definition.
   * `unmanaged`: a store ritual that a v3 marker on this host does not name.
   * Null: a store ritual (v2 project). Same facts as `darius ritual list --json`.
   */
  source: "repo" | "unmanaged" | null;
  /** The commit, host and instant of the last reconcile; null unless `source` is `repo` (and the commit, when the checkout is not in git). */
  defCommit: string | null;
  defHost: string | null;
  defAt: string | null;
  /** `.darius.toml` had uncommitted changes at the last reconcile. */
  defDirty: boolean;
  /** The mirrored schedule: `HH:MM` and an IANA zone; null for a store ritual. */
  at: string | null;
  zone: string | null;
  /** The skill's input from the marker (`args`); null when none is set. */
  args: string | null;
  /** The per-run budget as written (`30m`); null when none is set. */
  timeout: string | null;
  /** The instant the next occurrence is due (ISO); null for a retired ritual. */
  nextDueAt: string | null;
  /** The warnings of `darius ritual list`: a stale mirror, a retired slug named again. */
  warnings: string[];
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
/** `open`, `needs-decision` and `needs-code` wait for someone; `not-verified` could not be settled; `fixed` is done. */
export type ResultItemState = "open" | "fixed" | "needs-decision" | "needs-code" | "not-verified";

export interface ResultMetric {
  label: string;
  value: number | string;
  unit?: string;
  tone?: "ok" | "warn" | "bad";
}

export interface ResultItem {
  /** A stable id across runs of the ritual (0.62.0, "Findings"). Plain text. */
  key?: string;
  title: string;
  severity: ResultSeverity;
  state: ResultItemState;
  /** What the items group under, for example a market. */
  group?: string;
  /** What the item is about, for example a post. Text, never a link. */
  target?: string;
  detail?: string;
  /** The change a needs-decision item proposes (0.69.0). Plain text with newlines, shown as text. */
  proposal?: ResultProposal;
}

/** The exact change a needs-decision item proposes (0.69.0); the operator approves it by the item's key. */
export interface ResultProposal {
  current?: string;
  proposed: string;
  why?: string;
  effect?: string;
}

// --- findings (0.62.0) ---------------------------------------------------------------------

/** What a finding is now: `needs-you` and `open` wait, `closed` is the operator's, `fixed` is done (src/core/finding-index.ts). */
export type FindingStatus = "needs-you" | "open" | "fixed" | "closed";

export interface FindingSeen {
  run: string;
  at: string;
}

export interface FindingStep {
  run: string;
  at: string;
  state: ResultItemState;
  severity: ResultSeverity;
}

/** One finding of a ritual, as `darius finding list --json` gives it, with the project it belongs to. Every text is untrusted plain text. */
export interface FindingRow {
  project: string;
  /** The ritual slug. */
  ritual: string;
  key: string;
  /** True when darius made the key: the run gave none. */
  auto: boolean;
  title: string;
  severity: ResultSeverity;
  state: ResultItemState;
  group?: string;
  target?: string;
  detail?: string;
  firstSeen: FindingSeen;
  lastSeen: FindingSeen;
  /** The results that reported it. */
  runs: number;
  /** Oldest first, the newest 10. */
  history: FindingStep[];
  stale: boolean;
  reopened: boolean;
  /** Only while the close is in force. */
  closed?: { at: string; who: string; note?: string; severity: ResultSeverity };
  status: FindingStatus;
}

/** The counts the dashboard shows for a project. */
export interface FindingCounts {
  /** Findings with the status `needs-you`. */
  needsYou: number;
  /** `needs-you` plus `open`. */
  open: number;
}

export interface ResultQuestion {
  text: string;
  recommendation?: string;
  /** The exact command lines a yes would run (0.46.0). Text, shown as written. */
  commands?: string[];
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

/**
 * One spec of a milestone. `source` tells where it lives: "legacy" is read from
 * the old tracker's `.tracker/` (read-only), "darius" is for milestones darius
 * will hold itself. The shape is the same for both.
 */
export interface SpecRow {
  source: "legacy" | "darius";
  /** Stable id, keeps the milestone number: `m77-01-name`. */
  slug: string;
  /** What the page shows: `M77/01`. */
  label: string;
  number: number;
  title: string;
  /** Not Started, In Progress, Complete, Blocked, Skipped, or Waiting (a spec it depends on is not Complete). */
  status: string;
  /** Checks done, and all checks. */
  done: number;
  total: number;
  /** Someone checked the spec against its verification. */
  verified: boolean;
  verifiedAt: string | null;
  /** Slugs of the specs this one waits for. */
  dependsOn: string[];
}

export interface MilestoneRow {
  source: "legacy" | "darius";
  /** `M77` */
  id: string;
  label: string;
  slug: string;
  title: string;
  started: string | null;
  target: string | null;
  /** Not Started, In Progress, Complete, Skipped, Deferred or Closed. */
  status: string;
  /** Checks done and all checks, summed over the specs. */
  done: number;
  total: number;
  specs: SpecRow[];
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
  /** Open milestones, the lowest number first. Read-only, from the linked checkout's `.tracker/`. */
  milestones: MilestoneRow[];
  /** How many milestones are archived. */
  milestonesArchived: number;
  /** The findings its rituals report, counted (0.62.0). */
  findings: FindingCounts;
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

// --- system status (0.44.0) ----------------------------------------------------------------

/** One host that wrote ledger chunks into a project this host holds, or this host itself. */
export interface SystemHost {
  host: string;
  /** True for the host that serves this page. */
  self: boolean;
  /** The time of its newest ledger chunk in any project (this host: its newest line); null when it has none. */
  lastSeen: string | null;
  /** Closed ledger chunks of this host, over all projects. */
  chunks: number;
  /** The projects this host wrote into. */
  projects: string[];
}

/** What one project holds in the local store, and when this host last synced it. */
export interface SystemProject {
  project: string;
  /** The last finished sync of this host; null when it never synced the project. */
  lastSync: string | null;
  rituals: number;
  vigils: number;
  profiles: number;
  /** Runs in the ledger (lines of type `run.started`). */
  runs: number;
  /** Bytes the project directory holds. */
  bytes: number;
}

export interface SystemDisk {
  /** "store" or "backups": what lives on the volume. */
  label: string;
  path: string;
  freeBytes: number;
  totalBytes: number;
}

/** The machine and the store, for the status page. Computed by `src/web/system.ts`, never writes. */
export interface SystemStatus {
  host: string;
  version: string;
  /** "bun 1.x" or "node 22.x". */
  runtime: string;
  /** For example "linux x64". */
  platform: string;
  generatedAt: string;
  uptimeSeconds: number;
  /** The 1, 5 and 15 minute load averages. */
  load: [number, number, number];
  memory: { totalBytes: number; freeBytes: number };
  disks: SystemDisk[];
  store: {
    path: string;
    bytes: number;
    files: number;
    projects: number;
    rituals: number;
    vigils: number;
    profiles: number;
    runs: number;
    /** Open milestones and their specs, read from the linked checkouts. */
    milestones: number;
    specs: number;
  };
  hosts: SystemHost[];
  projects: SystemProject[];
  /** The sync bucket, without any secret; null when this host has no `[remote]`. */
  syncRemote: { endpoint: string; bucket: string } | null;
}

// --- backups (0.44.0) ------------------------------------------------------------------------

/** Where a setting's value came from. `env` is locked: the page cannot change it. */
export type SettingSource = "env" | "file" | "config" | "default";

export interface BackupField<T> {
  value: T;
  source: SettingSource;
}

/** The snapshot settings (src/core/snapshot-settings.ts). The access key pair is never part of this. */
export interface BackupSettings {
  enabled: BackupField<boolean>;
  /** The local folder, as written (with `~`). */
  dir: BackupField<string>;
  /** Local snapshots to keep. */
  keep: BackupField<number>;
  /** Snapshots to keep in the bucket. */
  keepRemote: BackupField<number>;
  endpoint: BackupField<string>;
  bucket: BackupField<string>;
  region: BackupField<string>;
  prefix: BackupField<string>;
  pathStyle: BackupField<boolean>;
  allowHttp: BackupField<boolean>;
  sse: BackupField<boolean>;
}

export interface BackupRow {
  /** `darius-<host>-<UTC stamp>.tar.gz` */
  name: string;
  /** When it was made, an ISO time. */
  at: string;
  bytes: number;
  /** Files in the store at that time; null when the manifest is gone or the snapshot is only in the bucket. */
  files: number | null;
  sha256: string | null;
  local: boolean;
  /** The bucket held it at the last contact. */
  remote: boolean;
}

/** The state of the snapshots on this host: settings, the last run, the folder and the bucket. */
export interface BackupsStatus {
  generatedAt: string;
  host: string;
  settings: BackupSettings;
  /** What the operator must fix; a run refuses while any exist. */
  problems: string[];
  /** Where the access key pair would come from. The key itself never leaves the host. */
  credentials: "env" | "file" | "none";
  /** True when the endpoint and the bucket are set and valid. */
  remoteConfigured: boolean;
  /** Set while a run holds the lock. */
  running: { pid: number; startedAt: string } | null;
  last: { at: string; ok: boolean; name: string | null; error: string | null } | null;
  /** The last contact with the bucket (a run's upload or a check); `count` is its listing then. */
  remote: { at: string; ok: boolean; error: string | null; count: number } | null;
  /** Local snapshots, plus the ones only the bucket holds, newest first. */
  snapshots: BackupRow[];
  /** Bytes the local snapshots take. */
  localBytes: number;
  /** The store a snapshot is made from, and where `tar -xzf` puts one back. */
  storePath: string;
  /** The file that sets the environment of the timer and the page (`DARIUS_SNAPSHOT_*`). */
  envFile: string;
}

// --- details -------------------------------------------------------------------------------

export interface RitualPolicy {
  mode: string;
  may: string[];
  hold: string[];
  /** What a hold match does (0.66.0): "stop" holds the run, "deny" refuses the call and the run goes on. */
  onHold: "stop" | "deny";
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
  /** Set when the run asked questions and someone acknowledged it with no note (0.68.0): the operator chose not to act. */
  dismissed: { who: string; at: string } | null;
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
  /** The run this one follows up (`darius run follow-up`, 0.47.0); null for any other run. */
  followUpOf: string | null;
  /** The runs that follow this one up, oldest first. */
  followUps: string[];
  /** The sha256 hex of the ritual skill's SKILL.md at launch (0.56.0); null for a run that recorded none. */
  skillHash: string | null;
}

/** The command lines of one question a follow-up may approve. */
export interface FollowUpQuestion {
  /** The question's number in the result, from 1. */
  n: number;
  /** Its command lines, as written. */
  commands: string[];
}

/**
 * Whether this host can start a follow-up of a run from the run page
 * (0.48.0). Ready means the checks of `darius run follow-up` pass here now:
 * the run, the ritual, the checkout, the profile and herdr. `reason` says
 * what is off, in one line. The server checks again on the POST.
 */
export type FollowUpReadiness =
  | { ready: true; host: string; profile: string; questions: FollowUpQuestion[] }
  | {
      ready: false;
      host: string;
      reason: string;
      /** The ritual's host when it is another one (0.50.0): its pin, or where its checkout is linked. */
      rightHost?: string;
      /** The command to type for the follow-up there: `ssh <rightHost> darius run follow-up ...`. */
      command?: string;
    };

/**
 * One file of a milestone, or one worklog. Read-only from the linked
 * checkout's `.tracker/`; the text is untrusted, so it comes parsed.
 */
export interface MilestoneFile {
  /** The path below the milestone directory or `worklog/`: `01-cart.md`, `_counsel/notes.md`. */
  path: string;
  /** Bytes. */
  size: number;
  /** Last change, an ISO time. */
  modifiedAt: string;
  /** Lines of text, for the page to fold a long one; 0 when the text is left out. */
  lines: number;
  /** A markdown file as blocks, any other text file as one code block; null when the text is left out. */
  body: MdBlock[] | null;
  /** Why the text is left out: not text, larger than 256 KiB, or unreadable. */
  omitted: "binary" | "too-large" | "unreadable" | null;
}

export interface MilestoneSpecDetail {
  row: SpecRow;
  file: MilestoneFile;
}

export interface MilestoneWorklog extends MilestoneFile {
  /** How the tracker ties it to the milestone: its name (`M7-...md`), or a thread's `spec:` marker. */
  link: "name" | "spec";
  /** When `worklog distill` made it a stub; null otherwise. */
  distilledAt: string | null;
}

/** One milestone with everything its directory holds and its worklogs (0.42.0). */
export interface MilestoneDetail {
  project: string;
  row: MilestoneRow;
  /** The directory below `.tracker/`: `M12-cart`. */
  dir: string;
  /** The `00-README.md`, header cut off; null when there is none. */
  readme: MilestoneFile | null;
  /** The specs in order, each with its full text. */
  specs: MilestoneSpecDetail[];
  /** Every other file of the directory, by path. */
  others: MilestoneFile[];
  /** The worklogs that belong to it, the latest change first. */
  worklogs: MilestoneWorklog[];
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
  /** A milestone by id (`M12`) or directory name (`M12-cart`); null when the project or the milestone is unknown. */
  milestone(project: string, milestone: string): MilestoneDetail | null;
  /** The machine and the store (0.44.0). */
  system(): SystemStatus;
  /** The snapshots of this host (0.44.0). */
  backups(): BackupsStatus;
  /** The findings of every project of this host (0.62.0), worst first within a project. */
  findings(): Promise<FindingRow[]>;
  /** Whether this host can start a follow-up of the run now (0.48.0). Reads only. */
  followUp(project: string, run: string): Promise<FollowUpReadiness>;
  /**
   * Whether the viewer may write through the page (0.68.0): false for the
   * loopback viewer, whose POSTs the server refuses. The page hides the
   * Acknowledge button when it is false.
   */
  canWrite: boolean;
}

/**
 * The default export of `web/build/server/index.js`: one request in, one
 * response out. `darius serve` has already checked access and serves the
 * static files under `web/build/client` itself.
 */
export type WebHandler = (request: Request, context: WebContext) => Promise<Response>;
