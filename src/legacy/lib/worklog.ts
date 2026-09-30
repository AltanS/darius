/**
 * Worklog operations — create/append/close threads in worklog files.
 *
 * Worklog files live at .tracker/worklog/<milestone-slug>.md or a custom path.
 * File format: Markdown with YAML front-matter per thread (one thread per ## header).
 *
 * Concurrency safety:
 * Uses O_EXCL-based lock file with exponential backoff retry.
 * Lock files are named <target>.lock and are cleaned up on release.
 */

import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  unlinkSync,
  openSync,
  closeSync,
  readdirSync,
  statSync,
} from "node:fs";
import { join, dirname, basename } from "node:path";
import { generateThreadId } from "./ulid.ts";
import { atomicWriteFileSync } from "./atomic.ts";

// ---------------------------------------------------------------------------
// Lock constants
// ---------------------------------------------------------------------------

const LOCK_RETRY_COUNT = 20;
const LOCK_RETRY_BASE_MS = 50;
const LOCK_RETRY_MAX_MS = 800;

// ---------------------------------------------------------------------------
// Index files
// ---------------------------------------------------------------------------

/**
 * `00-`-prefixed files in .tracker/worklog/ are generated documentation *about*
 * the directory, never worklogs in it. Every enumeration skips them, so the
 * index cannot list itself, cannot be distilled, and cannot own a thread.
 */
const WORKLOG_INDEX_PREFIX = "00-";

export function isWorklogIndexFile(file: string): boolean {
  return basename(file).startsWith(WORKLOG_INDEX_PREFIX);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WorklogEntry = {
  kind: "note" | "artifact" | "blocker";
  text?: string;
  path?: string;
  timestamp: string;
};

/**
 * Work Loop position, stamped on threads opened by work-plan.
 * Forward-only: planned → dispatched → verified → committed.
 * Threads without a stage (legacy, or opened outside the Work Loop)
 * are exempt from loop gating.
 */
export type WorklogStage = "planned" | "dispatched" | "verified" | "committed";

export const WORKLOG_STAGES: readonly WorklogStage[] = [
  "planned",
  "dispatched",
  "verified",
  "committed",
];

export type WorklogThread = {
  threadId: string;
  label: string;
  openedAt: string;
  closedAt?: string;
  closeStatus?: "done" | "blocked" | "cancelled";
  specPath?: string;
  stage?: WorklogStage;
  entries: WorklogEntry[];
  /**
   * The verbatim `## ...` header line as read from disk. When present, the
   * serializer re-emits it unchanged (so a hand-written `## X` header without a
   * ` — ` separator round-trips instead of being rewritten as `## X — X`).
   * Threads created programmatically have no rawHeader and serialize as
   * `## ${threadId} — ${label}`.
   */
  rawHeader?: string;
  /**
   * Verbatim body lines inside a thread section that are neither recognized
   * metadata comments nor part of an entry (hand-written prose). Captured in
   * order and re-emitted after the metadata comments and before the entries.
   */
  freeform?: string[];
};

/**
 * A lossless representation of a whole worklog file: everything read from disk
 * lands somewhere in this model so a round-trip (parse → serialize) never
 * destroys hand-written content.
 */
export type WorklogDoc = {
  /** Verbatim lines before the first thread header (H1 title, intro prose, blanks). */
  preamble: string[];
  threads: WorklogThread[];
  /**
   * How many `## ` headings were folded back into preamble/freeform because they
   * carried no `<!-- opened: ... -->` marker — plain section headers from a
   * pre-CLI freeform worklog. Always 0 for files the CLI wrote; a non-zero count
   * is what makes `worklog list` flag the file as legacy.
   */
  foldedHeadings: number;
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type OpenThreadOpts = {
  worklogPath: string;
  slug?: string;
  specPath?: string;
  message?: string;
  stage?: WorklogStage;
};

/**
 * Open a new worklog thread. Creates the worklog file if it doesn't exist.
 * Returns the new thread ID.
 */
export function openThread(opts: OpenThreadOpts): string {
  const { worklogPath, slug, specPath, message, stage } = opts;
  const threadId = generateThreadId(slug);

  withLock(worklogPath, () => {
    const doc = readDocForMutation(worklogPath);

    const thread: WorklogThread = {
      threadId,
      label: slug ?? threadId,
      openedAt: new Date().toISOString(),
      specPath,
      stage,
      entries: [],
    };

    if (message) {
      thread.entries.push({
        kind: "note",
        text: message,
        timestamp: new Date().toISOString(),
      });
    }

    doc.threads.push(thread);
    writeDoc(worklogPath, doc);
  });

  return threadId;
}

export type AppendThreadOpts = {
  worklogPath: string;
  threadId: string;
  section: string;
  message: string;
};

/**
 * Append an entry to an existing thread. Throws if thread not found.
 */
export function appendThread(opts: AppendThreadOpts): void {
  const { worklogPath, threadId, section, message } = opts;

  withLock(worklogPath, () => {
    const doc = readDocForMutation(worklogPath);
    const thread = doc.threads.find((t) => t.threadId === threadId);
    if (!thread) {
      throw new Error(`Thread not found: ${threadId}`);
    }

    const kind = sectionToKind(section);
    const entry: WorklogEntry = {
      kind,
      timestamp: new Date().toISOString(),
    };

    if (kind === "artifact") {
      entry.path = message;
    } else {
      entry.text = message;
    }

    thread.entries.push(entry);
    writeDoc(worklogPath, doc);
  });
}

export type CloseThreadOpts = {
  worklogPath: string;
  threadId: string;
  status: "done" | "blocked" | "cancelled";
};

/**
 * Mark a thread as closed. Throws if thread not found.
 */
export function closeThread(opts: CloseThreadOpts): void {
  const { worklogPath, threadId, status } = opts;

  withLock(worklogPath, () => {
    const doc = readDocForMutation(worklogPath);
    const thread = doc.threads.find((t) => t.threadId === threadId);
    if (!thread) {
      throw new Error(`Thread not found: ${threadId}`);
    }

    thread.closedAt = new Date().toISOString();
    thread.closeStatus = status;
    writeDoc(worklogPath, doc);
  });
}

export type SetStageOpts = {
  worklogPath: string;
  threadId: string;
  stage: WorklogStage;
};

/**
 * Set a thread's Work Loop stage. Transitions are forward-only:
 * planned → dispatched → verified → committed.
 * Same-stage is an idempotent no-op; an unset stage accepts any first stamp.
 * Throws on backward transitions and on closed threads.
 */
export function setStage(opts: SetStageOpts): void {
  const { worklogPath, threadId, stage } = opts;

  withLock(worklogPath, () => {
    const doc = readDocForMutation(worklogPath);
    const thread = doc.threads.find((t) => t.threadId === threadId);
    if (!thread) {
      throw new Error(`Thread not found: ${threadId}`);
    }
    if (thread.closedAt) {
      throw new Error(`Thread is closed: ${threadId} (stage changes are not allowed)`);
    }

    if (thread.stage !== undefined) {
      const current = WORKLOG_STAGES.indexOf(thread.stage);
      const requested = WORKLOG_STAGES.indexOf(stage);
      if (requested < current) {
        throw new Error(
          `Backward stage transition rejected: ${thread.stage} → ${stage} (thread ${threadId})`,
        );
      }
      if (requested === current) {
        return; // idempotent
      }
    }

    thread.stage = stage;
    writeDoc(worklogPath, doc);
  });
}

export type DispatchThreadOpts = {
  worklogPath: string;
  threadId: string;
  agent: string;
  reason?: string;
};

/**
 * Stage-2 sugar: mark a thread `dispatched` and record the agent selection
 * in one locked write. Replaces the prose-mandated "Agent selected:" logging.
 */
export function dispatchThread(opts: DispatchThreadOpts): void {
  const { worklogPath, threadId, agent, reason } = opts;

  withLock(worklogPath, () => {
    const doc = readDocForMutation(worklogPath);
    const thread = doc.threads.find((t) => t.threadId === threadId);
    if (!thread) {
      throw new Error(`Thread not found: ${threadId}`);
    }
    if (thread.closedAt) {
      throw new Error(`Thread is closed: ${threadId} (cannot dispatch)`);
    }
    if (thread.stage !== undefined && thread.stage !== "planned" && thread.stage !== "dispatched") {
      throw new Error(
        `Backward stage transition rejected: ${thread.stage} → dispatched (thread ${threadId})`,
      );
    }

    thread.stage = "dispatched";
    thread.entries.push({
      kind: "note",
      text: `Agent selected: ${agent}${reason ? ` — ${reason}` : ""}`,
      timestamp: new Date().toISOString(),
    });
    writeDoc(worklogPath, doc);
  });
}

export type ParkThreadOpts = {
  worklogPath: string;
  threadId: string;
  reason: string;
};

/**
 * The sanctioned "stop without finishing" exit: record why, then close the
 * thread as blocked. A parked thread is exempt from loop gating.
 */
export function parkThread(opts: ParkThreadOpts): void {
  const { worklogPath, threadId, reason } = opts;
  if (!reason.trim()) {
    throw new Error("park requires a non-empty reason");
  }

  withLock(worklogPath, () => {
    const doc = readDocForMutation(worklogPath);
    const thread = doc.threads.find((t) => t.threadId === threadId);
    if (!thread) {
      throw new Error(`Thread not found: ${threadId}`);
    }
    if (thread.closedAt) {
      throw new Error(`Thread is already closed: ${threadId}`);
    }

    thread.entries.push({
      kind: "note",
      text: `Parked: ${reason}`,
      timestamp: new Date().toISOString(),
    });
    thread.closedAt = new Date().toISOString();
    thread.closeStatus = "blocked";
    writeDoc(worklogPath, doc);
  });
}

export type ListThreadsOpts = {
  trackerRoot: string;
  activeOnly?: boolean;
  milestoneSlug?: string;
};

export type ThreadSummary = {
  threadId: string;
  label: string;
  openedAt: string;
  closedAt?: string;
  closeStatus?: string;
  specPath?: string;
  stage?: WorklogStage;
  entryCount: number;
  worklogFile: string;
  /**
   * Set only when the containing file is legacy — it holds unmarked `## `
   * headings that folded into freeform. The thread itself is real; the flag
   * warns that its file also carries prose the CLI never wrote.
   */
  legacy?: boolean;
};

/**
 * How a worklog file reads as a whole:
 * - `clean`     — CLI-written threads only.
 * - `legacy`    — holds non-blank content the parser could not attribute to a
 *                 marked thread: either no threads at all, or real threads plus
 *                 folded headings.
 * - `distilled` — carries a `<!-- distilled: ... -->` provenance stamp. A stub
 *                 is thread-less prose and would otherwise read as `legacy`, so
 *                 `distilled` takes precedence: it is deliberate, not pre-CLI.
 */
export type WorklogFileState = "clean" | "legacy" | "distilled";

export type WorklogFileSummary = {
  worklogFile: string;
  threadCount: number;
  state: WorklogFileState;
  /**
   * The file holds non-blank content the parser could not attribute to a marked
   * thread. False for distilled stubs — see {@link WorklogFileState}.
   */
  legacy: boolean;
};

export type WorklogFileScan = {
  /** Basename inside .tracker/worklog/, e.g. `M7-worklog-dreaming.md`. */
  file: string;
  /** Full path actually read. */
  path: string;
  /** Verbatim file content. */
  raw: string;
  doc: WorklogDoc;
  stamp: DistillStamp | null;
  state: WorklogFileState;
  legacy: boolean;
};

/**
 * Read every worklog file in .tracker/worklog/ (optionally filtered to one
 * milestone), parsed once, with the per-file state verdict attached. Shared by
 * {@link listThreads}, {@link listWorklogFiles}, the distill gates and the
 * worklog index so they all see the same view.
 *
 * Generated `00-` index files are skipped: this is the one enumeration every
 * caller shares, so filtering here is what keeps the index out of `worklog
 * list`, out of `distill --list`, and out of its own rows.
 */
export function scanWorklogDir(trackerRoot: string, milestoneSlug?: string): WorklogFileScan[] {
  const worklogDir = join(trackerRoot, "worklog");

  if (!existsSync(worklogDir)) {
    return [];
  }

  const files = readdirSync(worklogDir).filter((f) => f.endsWith(".md") && !isWorklogIndexFile(f));
  const results: WorklogFileScan[] = [];

  for (const file of files) {
    if (milestoneSlug && !file.includes(milestoneSlug)) {
      continue;
    }
    results.push(scanWorklogFile(join(worklogDir, file)));
  }

  return results;
}

/**
 * Read and classify a single worklog file. Missing files scan as empty/`clean`.
 */
export function scanWorklogFile(path: string): WorklogFileScan {
  const raw = existsSync(path) ? readFileSync(path, "utf-8") : "";
  const doc = parseWorklogMarkdown(raw);
  const stamp = parseDistillStamp(raw);

  // A thread-less file with content is entirely pre-CLI prose; a file with
  // threads is legacy only if some heading folded. An empty file is neither.
  // A distilled stub is thread-less prose by construction, so the stamp wins.
  const hasContent = doc.preamble.some((l) => l.trim() !== "");
  const legacy =
    stamp === null && (doc.foldedHeadings > 0 || (doc.threads.length === 0 && hasContent));
  const state: WorklogFileState = stamp !== null ? "distilled" : legacy ? "legacy" : "clean";

  return { file: basename(path), path, raw, doc, stamp, state, legacy };
}

/**
 * List worklog threads across all worklog files in .tracker/worklog/.
 */
export function listThreads(opts: ListThreadsOpts): ThreadSummary[] {
  const { trackerRoot, activeOnly, milestoneSlug } = opts;
  const results: ThreadSummary[] = [];

  for (const { file, doc, legacy } of scanWorklogDir(trackerRoot, milestoneSlug)) {
    for (const thread of doc.threads) {
      if (activeOnly && thread.closedAt) {
        continue;
      }

      const summary: ThreadSummary = {
        threadId: thread.threadId,
        label: thread.label,
        openedAt: thread.openedAt,
        closedAt: thread.closedAt,
        closeStatus: thread.closeStatus,
        specPath: thread.specPath,
        stage: thread.stage,
        entryCount: thread.entries.length,
        worklogFile: file,
      };
      if (legacy) {
        summary.legacy = true;
      }
      results.push(summary);
    }
  }

  return results;
}

export type ListWorklogFilesOpts = {
  trackerRoot: string;
  milestoneSlug?: string;
};

/**
 * List the worklog files themselves. Thread-less legacy files are invisible to
 * {@link listThreads} — before the marker rule they shredded into fake open
 * threads, and now they parse as pure prose — so this is how `worklog list`
 * keeps them in view instead of dropping them.
 */
export function listWorklogFiles(opts: ListWorklogFilesOpts): WorklogFileSummary[] {
  const { trackerRoot, milestoneSlug } = opts;

  return scanWorklogDir(trackerRoot, milestoneSlug).map(({ file, doc, legacy, state }) => ({
    worklogFile: file,
    threadCount: doc.threads.length,
    state,
    legacy,
  }));
}

/**
 * Newest timestamp the file's own *content* vouches for: thread open/close
 * stamps and entry timestamps. Null when the file carries none of those —
 * pre-CLI prose, a distilled stub, an empty file.
 *
 * Pure: no filesystem, no clock. Callers that may only use content (the worklog
 * index, whose output is committed and must survive a fresh clone) use this;
 * callers making a live-session judgement (the distill age gate) go through
 * {@link worklogLastActivity}, which adds the mtime fallback.
 */
export function worklogThreadActivity(doc: WorklogDoc): string | null {
  let newest = 0;

  const consider = (value: string | undefined): void => {
    if (!value) return;
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed) && parsed > newest) newest = parsed;
  };

  for (const thread of doc.threads) {
    consider(thread.openedAt);
    consider(thread.closedAt);
    for (const entry of thread.entries) {
      consider(entry.timestamp);
    }
  }

  return newest === 0 ? null : new Date(newest).toISOString();
}

/**
 * {@link worklogThreadActivity} with an mtime fallback for thread-less files,
 * and null only when the file is absent.
 *
 * mtime is deliberately *not* clone-stable — git does not preserve it — so this
 * is only safe where the answer is consumed inside the session that asked. The
 * distill age gate is exactly that: "has nobody touched this in 14 days?" is a
 * question about this checkout. Anything written to a committed file must use
 * {@link worklogThreadActivity} instead.
 */
export function worklogLastActivity(doc: WorklogDoc, path: string): string | null {
  const fromContent = worklogThreadActivity(doc);
  if (fromContent !== null) return fromContent;

  if (!existsSync(path)) return null;
  return new Date(statSync(path).mtimeMs).toISOString();
}

/**
 * Resolve the worklog file path for a given thread ID by searching all worklog files.
 * Returns null if not found.
 */
export function findWorklogFileForThread(opts: {
  trackerRoot: string;
  threadId: string;
}): string | null {
  const { trackerRoot, threadId } = opts;
  const worklogDir = join(trackerRoot, "worklog");

  if (!existsSync(worklogDir)) {
    return null;
  }

  // Generated index files never own threads — skip them so a `## ` heading in
  // an index can never be resolved as a thread's home file.
  const files = readdirSync(worklogDir).filter((f) => f.endsWith(".md") && !isWorklogIndexFile(f));
  for (const file of files) {
    const filePath = join(worklogDir, file);
    const { threads } = readDoc(filePath);
    if (threads.some((t) => t.threadId === threadId)) {
      return filePath;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// File locking
// ---------------------------------------------------------------------------

/**
 * Acquire a lock on `targetPath` using an O_EXCL lock file, run `fn`, then release.
 * Retries with exponential backoff. Throws after LOCK_RETRY_COUNT failures.
 */
export function withLock(targetPath: string, fn: () => void): void {
  const lockPath = `${targetPath}.lock`;
  // Ensure the directory exists before attempting to create a lock file
  const lockDir = dirname(lockPath);
  if (!existsSync(lockDir)) {
    mkdirSync(lockDir, { recursive: true });
  }
  let acquired = false;

  for (let attempt = 1; attempt <= LOCK_RETRY_COUNT; attempt++) {
    try {
      // O_EXCL: fails if file already exists (atomic create)
      const fd = openSync(lockPath, "wx");
      closeSync(fd);
      acquired = true;
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") {
        throw err;
      }
      // Lock exists — sleep with jitter then retry
      const delay = Math.min(
        LOCK_RETRY_BASE_MS * Math.pow(2, attempt - 1),
        LOCK_RETRY_MAX_MS,
      );
      const jitter = Math.floor(Math.random() * delay * 0.3);
      sleepSync(delay + jitter);
    }
  }

  if (!acquired) {
    throw new Error(`Failed to acquire lock on ${targetPath} after ${LOCK_RETRY_COUNT} attempts`);
  }

  try {
    fn();
  } finally {
    try {
      unlinkSync(lockPath);
    } catch {
      // Best-effort cleanup
    }
  }
}

/**
 * Synchronous sleep using a busy-wait with Atomics.
 * Used only for lock retry — durations are short (< 1s).
 */
function sleepSync(ms: number): void {
  const sab = new SharedArrayBuffer(4);
  const arr = new Int32Array(sab);
  Atomics.wait(arr, 0, 0, ms);
}

// ---------------------------------------------------------------------------
// Serialization / Deserialization
// ---------------------------------------------------------------------------

/**
 * Read a worklog file into the lossless doc model. Used by read-only callers
 * (list/find) — does NOT run the fail-closed guard.
 */
function readDoc(filePath: string): WorklogDoc {
  if (!existsSync(filePath)) {
    return { preamble: [], threads: [], foldedHeadings: 0 };
  }
  const raw = readFileSync(filePath, "utf-8");
  return parseWorklogMarkdown(raw);
}

/**
 * Read a worklog file for a MUTATING command. Same parse as {@link readDoc},
 * plus the fail-closed guard: if re-serializing the freshly parsed doc would
 * drop any non-blank line present on disk, we abort instead of rewriting the
 * file and silently destroying content. With the lossless parser this never
 * fires on real files — it is defense in depth against a future parser gap.
 */
function readDocForMutation(filePath: string): WorklogDoc {
  if (!existsSync(filePath)) {
    return { preamble: [], threads: [], foldedHeadings: 0 };
  }
  const raw = readFileSync(filePath, "utf-8");
  const doc = parseWorklogMarkdown(raw);
  assertWorklogLossless(filePath, raw, doc);
  return doc;
}

/**
 * Write a worklog doc to disk atomically.
 */
function writeDoc(filePath: string, doc: WorklogDoc): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  atomicWriteFileSync(filePath, serializeWorklogMarkdown(doc));
}

/**
 * Collapse runs of whitespace to a single space and trim, so cosmetic
 * differences (trimmed timestamps in entry headers, trailing spaces, relocated
 * metadata comments) don't register as content loss in the guard.
 */
function normalizeWs(line: string): string {
  return line.replace(/\s+/g, " ").trim();
}

/**
 * Fail-closed content-preservation guard. Compares whitespace-normalized,
 * non-blank lines of the raw input against the re-serialized doc as a multiset:
 * every input line must be accounted for in the output. Blank lines are ignored
 * entirely (the serializer manages its own separators). Throws — naming the
 * file and listing up to ten destroyed lines — if any input line would be lost.
 */
function assertWorklogLossless(filePath: string, raw: string, doc: WorklogDoc): void {
  const serialized = serializeWorklogMarkdown(doc);

  const outCounts = new Map<string, number>();
  for (const line of serialized.split("\n")) {
    const norm = normalizeWs(line);
    if (norm === "") continue;
    outCounts.set(norm, (outCounts.get(norm) ?? 0) + 1);
  }

  const lost: string[] = [];
  for (const line of raw.split("\n")) {
    const norm = normalizeWs(line);
    if (norm === "") continue;
    const remaining = outCounts.get(norm) ?? 0;
    if (remaining <= 0) {
      lost.push(line);
    } else {
      outCounts.set(norm, remaining - 1);
    }
  }

  if (lost.length === 0) return;

  const shown = lost
    .slice(0, 10)
    .map((l) => `  - ${l}`)
    .join("\n");
  const more = lost.length > 10 ? `\n  … and ${lost.length - 10} more` : "";
  throw new Error(
    `Refusing to rewrite worklog ${filePath}: parsing it would destroy ${lost.length} ` +
      `non-blank line(s) of hand-written content:\n${shown}${more}\n` +
      `Fix the file by hand (or file a parser bug) before retrying.`,
  );
}

// Metadata comment forms recognized inside a thread section. Hoisted so the
// thread-marker lookahead and the parse loop agree on what counts as metadata.
/**
 * Provenance stamp written by `worklog distill` as the first line of a stub:
 * `<!-- distilled: <ISO> source-sha256: <sha256> raw: <path> -->`.
 * It lands in the doc preamble like any other prose line — this regex is how
 * readers recognize it without the parser needing a special case.
 */
const DISTILL_STAMP_RE =
  /^<!-- distilled: (\S+) source-sha256: ([0-9a-f]{64}) raw: (\S.*?) -->$/;

export type DistillStamp = {
  distilledAt: string;
  sourceSha256: string;
  rawPath: string;
};

/**
 * Read the distill provenance stamp from a worklog file's raw content. The
 * stamp must be the first non-blank line — a `<!-- distilled: ... -->` comment
 * buried mid-file is prose, not provenance. Returns null when absent.
 */
export function parseDistillStamp(raw: string): DistillStamp | null {
  for (const line of raw.split("\n")) {
    if (line.trim() === "") continue;
    const match = DISTILL_STAMP_RE.exec(line.trim());
    if (!match) return null;
    return {
      distilledAt: match[1] ?? "",
      sourceSha256: match[2] ?? "",
      rawPath: match[3] ?? "",
    };
  }
  return null;
}

const OPENED_RE = /^<!-- opened: (.+) -->$/;
const SPEC_RE = /^<!-- spec: (.+) -->$/;
const STAGE_RE = /^<!-- stage: (.+) -->$/;
const CLOSED_RE = /^<!-- closed: (.+) status: (.+) -->$/;

/**
 * Read the `<!-- opened: ... -->` marker that promotes a `## ` heading to a real
 * thread. The marker may sit behind other metadata comments and blank lines, but
 * not behind content: a heading followed by prose is a plain section header from
 * a pre-CLI freeform worklog, not a thread. Returns the marker's value, or null
 * when the heading carries none.
 */
function readThreadOpenedMarker(lines: string[], headingIndex: number): string | null {
  for (let i = headingIndex + 1; i < lines.length; i++) {
    const line = lines[i]!;
    const opened = OPENED_RE.exec(line);
    if (opened) return (opened[1] ?? "").trim();
    if (line.trim() === "") continue;
    if (SPEC_RE.test(line) || STAGE_RE.test(line) || CLOSED_RE.test(line)) continue;
    return null;
  }
  return null;
}

/**
 * Parse worklog markdown into the lossless {@link WorklogDoc} model. Every line
 * read lands somewhere: preamble (before the first thread), a thread's verbatim
 * header (rawHeader), recognized metadata comments, freeform body lines, or
 * entry text.
 *
 * A `## ` heading only opens a thread when an `<!-- opened: ... -->` marker
 * follows it (the serializer always writes one, so every CLI-written thread has
 * it). Unmarked headings are prose from pre-CLI freeform worklogs: they fold
 * back into the surrounding text and are counted in `foldedHeadings` rather than
 * fabricating a perpetually-open thread with an invented timestamp.
 *
 * Format:
 * <preamble prose>
 * ## <threadId> — <label>
 * <!-- opened: <ISO> -->
 * <!-- spec: <path> -->
 * <!-- stage: <stage> -->
 * <!-- closed: <ISO> status: <done|blocked|cancelled> -->
 * <freeform prose>
 * ### <timestamp> [<kind>]
 * <text>
 */
export function parseWorklogMarkdown(raw: string): WorklogDoc {
  const preamble: string[] = [];
  const threads: WorklogThread[] = [];
  const lines = raw.split("\n");

  let foldedHeadings = 0;
  let currentThread: WorklogThread | null = null;
  let currentFreeform: string[] = [];
  let currentEntryKind: WorklogEntry["kind"] | null = null;
  let currentEntryTimestamp = "";
  let currentEntryLines: string[] = [];

  function flushEntry(): void {
    if (!currentThread || currentEntryKind === null) return;
    const text = currentEntryLines.join("\n").trim();
    const entry: WorklogEntry = {
      kind: currentEntryKind,
      timestamp: currentEntryTimestamp,
    };
    if (currentEntryKind === "artifact") {
      entry.path = text;
    } else {
      entry.text = text;
    }
    currentThread.entries.push(entry);
    currentEntryKind = null;
    currentEntryTimestamp = "";
    currentEntryLines = [];
  }

  function flushThread(): void {
    flushEntry();
    if (currentThread) {
      // Trim trailing blank lines from freeform — the serializer adds its own
      // blank separators, so keeping them would accumulate blanks on repeated
      // round-trips. Interior blanks are kept.
      let end = currentFreeform.length;
      while (end > 0 && currentFreeform[end - 1]!.trim() === "") end--;
      if (end > 0) {
        currentThread.freeform = currentFreeform.slice(0, end);
      }
      threads.push(currentThread);
      currentThread = null;
    }
    currentFreeform = [];
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    // Thread header: ## <threadId> — <label>, but only when it carries an
    // <!-- opened: --> marker. An unmarked heading is freeform prose: it falls
    // through and is captured verbatim like any other content line.
    const threadMatch = /^## (.+)$/.exec(line);
    if (threadMatch) {
      const openedAt = readThreadOpenedMarker(lines, i);
      if (openedAt !== null) {
        flushThread();
        const headerText = threadMatch[1] ?? "";
        const dashIdx = headerText.indexOf(" — ");
        const threadId = dashIdx >= 0 ? headerText.slice(0, dashIdx).trim() : headerText.trim();
        const label = dashIdx >= 0 ? headerText.slice(dashIdx + 3).trim() : threadId;
        currentThread = {
          threadId,
          label,
          openedAt,
          entries: [],
          rawHeader: line,
        };
        continue;
      }
      foldedHeadings++;
    }

    // Before the first thread: everything is preamble (H1 title, intro prose).
    if (!currentThread) {
      preamble.push(line);
      continue;
    }

    // Metadata comment: <!-- opened: ... -->
    const openedMatch = OPENED_RE.exec(line);
    if (openedMatch) {
      currentThread.openedAt = (openedMatch[1] ?? "").trim();
      continue;
    }

    // Metadata comment: <!-- spec: ... -->
    const specMatch = SPEC_RE.exec(line);
    if (specMatch) {
      currentThread.specPath = (specMatch[1] ?? "").trim();
      continue;
    }

    // Metadata comment: <!-- stage: ... -->
    const stageMatch = STAGE_RE.exec(line);
    if (stageMatch) {
      const value = (stageMatch[1] ?? "").trim();
      if ((WORKLOG_STAGES as readonly string[]).includes(value)) {
        currentThread.stage = value as WorklogStage;
        continue;
      }
      // Unknown stage value: preserve verbatim as freeform rather than dropping
      // it (keeps the read behavior of ignoring the stage while staying lossless).
    } else {
      // Metadata comment: <!-- closed: ... status: ... -->
      const closedMatch = CLOSED_RE.exec(line);
      if (closedMatch) {
        currentThread.closedAt = (closedMatch[1] ?? "").trim();
        currentThread.closeStatus = (closedMatch[2] ?? "").trim() as
          | "done"
          | "blocked"
          | "cancelled";
        continue;
      }

      // Entry header: ### <timestamp> [<kind>]
      const entryMatch = /^### (.+) \[(\w+)\]$/.exec(line);
      if (entryMatch) {
        flushEntry();
        currentEntryTimestamp = (entryMatch[1] ?? "").trim();
        currentEntryKind = (entryMatch[2] ?? "note") as WorklogEntry["kind"];
        continue;
      }
    }

    // Everything else: entry body if inside an entry, else freeform prose.
    if (currentEntryKind !== null) {
      currentEntryLines.push(line);
    } else {
      currentFreeform.push(line);
    }
  }

  flushThread();
  return { preamble, threads, foldedHeadings };
}

/**
 * Serialize a {@link WorklogDoc} back to worklog markdown. Preamble is emitted
 * verbatim first, then each thread: header (rawHeader verbatim when present),
 * metadata comments, freeform prose, entries, and a trailing blank separator.
 */
export function serializeWorklogMarkdown(doc: WorklogDoc): string {
  const parts: string[] = [];

  for (const line of doc.preamble) {
    parts.push(line);
  }

  for (const thread of doc.threads) {
    parts.push(thread.rawHeader ?? `## ${thread.threadId} — ${thread.label}`);
    parts.push(`<!-- opened: ${thread.openedAt} -->`);

    if (thread.specPath) {
      parts.push(`<!-- spec: ${thread.specPath} -->`);
    }

    if (thread.stage) {
      parts.push(`<!-- stage: ${thread.stage} -->`);
    }

    if (thread.closedAt && thread.closeStatus) {
      parts.push(`<!-- closed: ${thread.closedAt} status: ${thread.closeStatus} -->`);
    }

    for (const line of thread.freeform ?? []) {
      parts.push(line);
    }

    for (const entry of thread.entries) {
      parts.push(`### ${entry.timestamp} [${entry.kind}]`);
      if (entry.kind === "artifact" && entry.path) {
        parts.push(entry.path);
      } else if (entry.text) {
        parts.push(entry.text);
      }
    }

    parts.push("");
  }

  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function sectionToKind(section: string): WorklogEntry["kind"] {
  const lower = section.toLowerCase();
  if (lower === "artifact") return "artifact";
  if (lower === "blocker") return "blocker";
  return "note";
}

/**
 * Resolve a thread's worklog file path, given either:
 * - An explicit worklog path
 * - A tracker root + thread ID (searches all worklog files)
 */
export function resolveWorklogPath(opts: {
  trackerRoot: string;
  threadId: string;
  explicitPath?: string;
}): string {
  if (opts.explicitPath) {
    return opts.explicitPath;
  }

  const found = findWorklogFileForThread({
    trackerRoot: opts.trackerRoot,
    threadId: opts.threadId,
  });

  if (found) {
    return found;
  }

  // Default: worklog/<threadId>.md
  const worklogDir = join(opts.trackerRoot, "worklog");
  return join(worklogDir, `${basename(opts.threadId)}.md`);
}
