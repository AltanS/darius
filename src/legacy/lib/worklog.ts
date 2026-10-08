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
import {
  NO_GIT_HEAD,
  StageRefusal,
  dirtyArtifacts,
  gitHead,
  hostName,
  inGitRepo,
  isAncestorOfHead,
  ledgerVerdict,
  projectRootOf,
  resolveCommit,
  changedPaths,
  gitPrefix,
} from "./stage-evidence.ts";
import { artifactPathsOf, checkArtifactText, gitPathMatches } from "./artifact-paths.ts";

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
 * Forward-only: planned → dispatched → verified → committed → reviewed.
 * Threads without a stage (legacy, or opened outside the Work Loop)
 * are exempt from loop gating. `reviewed` is new in 0.72.0.
 */
export type WorklogStage = "planned" | "dispatched" | "verified" | "committed" | "reviewed";

export const WORKLOG_STAGES: readonly WorklogStage[] = [
  "planned",
  "dispatched",
  "verified",
  "committed",
  "reviewed",
];

/** Stages with an evidence rule. A forward move may not skip one of them. */
const EVIDENCE_STAGES: readonly WorklogStage[] = ["verified", "committed", "reviewed"];

/** A note whose text starts with this prefix is the review that `reviewed` needs. */
export const REVIEW_NOTE_PREFIX = "Review:";

/**
 * Evidence recorded with every stage change (0.72.0). Stored as one
 * `<!-- stamp: {json} -->` comment per change, next to the `<!-- stage: -->`
 * line, so an older reader keeps the stage and carries the stamp as prose.
 */
export type StageStamp = {
  stage: WorklogStage;
  /** ISO-8601 time of the change. */
  at: string;
  /** Git HEAD of the checkout, or `none` outside git. */
  head: string;
  host: string;
  /** `committed` only: the commit the work landed in, or `none` with --no-git. */
  commit?: string;
  /** Set when `--force --reason` skipped the evidence rules. */
  forced?: boolean;
  reason?: string;
  /** The acting session, when one was resolved. */
  session?: string;
  /** `committed` with `--no-code` (0.76.0): why the spec changed no code. */
  noCode?: string;
  /** `dispatched` with `--as-other-session` (0.76.0): the env session that acted for `session`. */
  actingSession?: string;
};

export type WorklogThread = {
  threadId: string;
  label: string;
  openedAt: string;
  closedAt?: string;
  closeStatus?: "done" | "blocked" | "cancelled";
  specPath?: string;
  stage?: WorklogStage;
  /** Session that owns the thread (set by open and dispatch, 0.72.0). */
  session?: string;
  /** Stage stamps in the order they were written (0.72.0). */
  stamps?: StageStamp[];
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
  /** Acting session id; recorded as the thread owner when set. */
  session?: string | null;
};

/**
 * Open a new worklog thread. Creates the worklog file if it doesn't exist.
 * Returns the new thread ID.
 */
export function openThread(opts: OpenThreadOpts): string {
  const { worklogPath, slug, specPath, message, stage } = opts;
  const session = opts.session ?? undefined;
  assertMarkerValue("spec", specPath);
  assertMarkerValue("session", session);
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
    if (session) thread.session = session;
    if (stage !== undefined) {
      thread.stamps = [makeStamp(worklogPath, stage, { session })];
    }

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
      entry.path = normaliseArtifactMessage(message, projectRootOf(dirname(dirname(worklogPath))));
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
    // 0.79.1: `done` ends the Work Loop, so a staged thread must be reviewed
    // first. A thread without a stage (a plain note thread) closes as before.
    if (status === "done" && thread.stage !== undefined && thread.stage !== "reviewed") {
      throw new Error(
        `${threadId} is at stage ${thread.stage}; --status done needs stage reviewed. ` +
          "Finish the loop first, or park it (worklog park) or close it as blocked or cancelled",
      );
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
  /** The `.tracker/` dir; defaults to the parent of the worklog dir. */
  trackerRoot?: string;
  /** `committed`: the commit the work landed in (default HEAD). */
  commit?: string;
  /** `committed` outside git: record `commit: none` instead of refusing. */
  noGit?: boolean;
  /** Skip the evidence and no-skip rules. Needs a non-empty `reason`. */
  force?: boolean;
  reason?: string;
  /** Acting session id, recorded on the stamp when set. */
  session?: string | null;
  /** `committed` for a spec that changes no code (0.76.0): the reason, recorded on the stamp. */
  noCode?: string;
  /** The env session, when `--as-other-session` let `session` differ from it (0.76.0). */
  actingSession?: string | null;
};

/**
 * Set a thread's Work Loop stage. Transitions are forward-only:
 * planned → dispatched → verified → committed → reviewed.
 * Same-stage is an idempotent no-op; an unset stage counts as before `planned`.
 *
 * Since 0.72.0 every change writes a {@link StageStamp}, and a forward move may
 * not skip `verified` or `committed`. Evidence rules:
 * - `verified`: every open checklist item of the spec has a latest ledger line
 *   that passes, written after the dispatch stamp (0.76.0).
 * - `committed`: the commit is an ancestor of HEAD, no artifact is dirty, the
 *   thread has artifacts, and the commit range since dispatch touches one of
 *   them (0.76.0). `noCode` replaces the last two for a spec with no code.
 *   Outside git it refuses with exit 3 unless `noGit` is set.
 * - `reviewed`: a `Review:` note with at least three words, written after the
 *   committed stamp.
 * `force` with a reason skips all of these and marks the stamp `forced`.
 *
 * Throws on backward transitions and on closed threads; evidence refusals
 * throw {@link StageRefusal} with the exit code to use.
 */
export function setStage(opts: SetStageOpts): void {
  const { worklogPath, threadId, stage } = opts;
  const force = opts.force === true;
  const reason = opts.reason?.trim() ?? "";
  if (force && reason === "") {
    throw new StageRefusal("--force needs a non-empty --reason");
  }
  const noCode = opts.noCode?.trim();
  if (noCode !== undefined && (noCode === "" || stage !== "committed")) {
    throw new StageRefusal('--no-code needs a non-empty reason and applies to committed only: --no-code "<why no code changed>"');
  }
  assertMarkerValue("session", opts.session ?? undefined);
  const trackerRoot = opts.trackerRoot ?? dirname(dirname(worklogPath));
  const repoRoot = projectRootOf(trackerRoot);

  withLock(worklogPath, () => {
    const doc = readDocForMutation(worklogPath);
    const thread = doc.threads.find((t) => t.threadId === threadId);
    if (!thread) {
      throw new Error(`Thread not found: ${threadId}`);
    }
    if (thread.closedAt) {
      throw new Error(`Thread is closed: ${threadId} (stage changes are not allowed)`);
    }

    const current = thread.stage === undefined ? -1 : WORKLOG_STAGES.indexOf(thread.stage);
    const requested = WORKLOG_STAGES.indexOf(stage);
    if (requested < current) {
      throw new Error(
        `Backward stage transition rejected: ${thread.stage} → ${stage} (thread ${threadId})`,
      );
    }
    if (requested === current) {
      return; // idempotent
    }

    const extra: Partial<StageStamp> = {};
    if (force) {
      extra.forced = true;
      extra.reason = reason;
      if (stage === "committed") {
        const sha = opts.commit ? resolveCommit(repoRoot, opts.commit) : null;
        extra.commit = sha ?? opts.commit ?? gitHead(repoRoot);
      }
    } else {
      const skipped = WORKLOG_STAGES.slice(current + 1, requested).filter((s) =>
        EVIDENCE_STAGES.includes(s),
      );
      if (skipped.length > 0) {
        throw new StageRefusal(
          `cannot move ${thread.stage ?? "(no stage)"} → ${stage}: it skips ${skipped.join(", ")}. ` +
            `Each of those stages needs its own evidence (thread ${threadId})`,
        );
      }
      if (stage === "verified") checkVerified(thread, trackerRoot);
      if (stage === "committed") {
        extra.commit = checkCommitted(thread, repoRoot, opts);
        if (noCode !== undefined) extra.noCode = noCode;
      }
      if (stage === "reviewed") checkReviewed(thread);
    }

    thread.stage = stage;
    if (opts.actingSession) extra.actingSession = opts.actingSession;
    const stamp = makeStamp(worklogPath, stage, { trackerRoot, session: opts.session ?? undefined, ...extra });
    thread.stamps = [...(thread.stamps ?? []), stamp];
    if (force) {
      thread.entries.push({
        kind: "note",
        text: `Forced to ${stage}: ${reason}`,
        timestamp: stamp.at,
      });
    }
    writeDoc(worklogPath, doc);
  });
}

/** The latest stamp for `stage`, or undefined. */
export function latestStamp(thread: { stamps?: StageStamp[] }, stage: WorklogStage): StageStamp | undefined {
  const stamps = thread.stamps ?? [];
  for (let i = stamps.length - 1; i >= 0; i--) {
    if (stamps[i]!.stage === stage) return stamps[i];
  }
  return undefined;
}

function checkVerified(thread: WorklogThread, trackerRoot: string): void {
  if (!thread.specPath) {
    throw new StageRefusal(
      `cannot move to verified: thread ${thread.threadId} names no spec, so no ledger line can vouch for it`,
    );
  }
  const since = latestStamp(thread, "dispatched")?.at ?? thread.openedAt;
  const verdict = ledgerVerdict(trackerRoot, thread.specPath, since);
  if (!verdict.ok) {
    throw new StageRefusal(`cannot move to verified: ${verdict.reason}`);
  }
}

function checkCommitted(thread: WorklogThread, repoRoot: string, opts: SetStageOpts): string {
  if (!inGitRepo(repoRoot)) {
    if (opts.noGit) return NO_GIT_HEAD;
    throw new StageRefusal(
      `cannot move to committed: ${repoRoot} is not a git checkout. ` +
        "Pass --no-git to record the stage without a commit",
      3,
    );
  }
  const ref = opts.commit ?? "HEAD";
  const sha = resolveCommit(repoRoot, ref);
  if (sha === null) {
    throw new StageRefusal(`cannot move to committed: ${ref} names no commit`);
  }
  if (!isAncestorOfHead(repoRoot, sha)) {
    throw new StageRefusal(`cannot move to committed: ${sha} is not an ancestor of HEAD`);
  }
  // One artifact entry may list several paths, split on commas and newlines
  // only, normalised against the project root (0.76.0).
  const artifacts = threadArtifactPaths(thread, repoRoot);
  const dirty = dirtyArtifacts(repoRoot, artifacts);
  if (dirty === null) {
    throw new StageRefusal("cannot move to committed: git status failed", 3);
  }
  if (dirty.length > 0) {
    throw new StageRefusal(
      `cannot move to committed: these artifacts are dirty or untracked: ${dirty.join(", ")}. ` +
        "Commit them first",
    );
  }
  const noCode = opts.noCode?.trim();
  if (noCode !== undefined) {
    if (artifacts.length > 0) {
      throw new StageRefusal(
        `cannot move to committed with --no-code: thread ${thread.threadId} records artifacts (${artifacts.join(", ")}), so code changed`,
      );
    }
    return sha;
  }
  if (artifacts.length === 0) {
    throw new StageRefusal(
      `cannot move to committed: thread ${thread.threadId} records no artifacts. ` +
        `Add them with \`darius worklog append ${thread.threadId} --section artifact --message "<path>"\`, ` +
        'or pass --no-code "<reason>" for a spec that changes no code',
    );
  }
  // The range from the dispatch (else the opening) to the commit must touch an artifact.
  const from = (latestStamp(thread, "dispatched") ?? thread.stamps?.[0])?.head;
  if (from === undefined || from === NO_GIT_HEAD) return sha;
  const fromSha = resolveCommit(repoRoot, from);
  if (fromSha === null) {
    throw new StageRefusal(
      `cannot move to committed: the dispatch commit ${from} is not in this checkout, so the commit range cannot be checked`,
      3,
    );
  }
  if (fromSha === sha) {
    throw new StageRefusal(
      `cannot move to committed: no commit since dispatch (${sha.slice(0, 12)}). ` +
        'Commit the work first, or pass --no-code "<reason>" for a spec that changes no code',
    );
  }
  const touched = changedPaths(repoRoot, fromSha, sha);
  if (touched === null) {
    throw new StageRefusal(`cannot move to committed: git diff ${fromSha.slice(0, 12)}..${sha.slice(0, 12)} failed`, 3);
  }
  const prefix = gitPrefix(repoRoot);
  if (!artifacts.some((a) => touched.some((p) => gitPathMatches(p, a, prefix)))) {
    throw new StageRefusal(
      `cannot move to committed: the commits ${fromSha.slice(0, 12)}..${sha.slice(0, 12)} touch none of the artifacts ` +
        `(${artifacts.join(", ")})`,
    );
  }
  return sha;
}

/** The normalised artifact paths of a thread (0.76.0); invalid old entries are skipped. */
export function threadArtifactPaths(thread: { entries: WorklogEntry[] }, repoRoot: string): string[] {
  return artifactPathsOf(
    thread.entries.flatMap((e) => (e.kind === "artifact" && e.path ? [e.path] : [])),
    repoRoot,
  );
}

/**
 * The text an artifact entry stores (0.76.0): every path of the message,
 * normalised, joined with ", ". Throws, naming each bad path, when one is
 * empty, `.`, a glob, or outside the project.
 */
export function normaliseArtifactMessage(message: string, projectRoot: string): string {
  const checks = checkArtifactText(message, projectRoot);
  const bad = checks.flatMap((c) => (c.ok ? [] : [`${JSON.stringify(c.raw)}: ${c.reason}`]));
  if (checks.length === 0) bad.push("the message names no path");
  if (bad.length > 0) {
    throw new StageRefusal(`artifact refused: ${bad.join("; ")}. Name project-relative files, separated by commas`);
  }
  const paths: string[] = [];
  for (const c of checks) if (c.ok && !paths.includes(c.path)) paths.push(c.path);
  return paths.join(", ");
}

/**
 * Stage markers the CLI did not write (0.76.0, `darius doctor`). Only threads
 * with stamps are checked: every thread since 0.72.0 has one from its first
 * stage change, and older threads carry none. A thread is flagged when its
 * stage has no stamp, when the latest stamp is for another stage, when a
 * stamp skips an evidence stage without `forced`, or when a `committed`
 * stamp has no commit.
 */
export function stageIntegrityProblems(thread: WorklogThread): string[] {
  const stamps = thread.stamps ?? [];
  if (stamps.length === 0) return [];
  const problems: string[] = [];
  if (thread.stage !== undefined && latestStamp(thread, thread.stage) === undefined) {
    problems.push(`stage ${thread.stage} has no stamp`);
  }
  const last = stamps[stamps.length - 1]!;
  if (thread.stage !== undefined && last.stage !== thread.stage) {
    problems.push(`stage ${thread.stage} differs from the latest stamp (${last.stage})`);
  }
  let reached = -1;
  for (const stamp of stamps) {
    const at = WORKLOG_STAGES.indexOf(stamp.stage);
    const skipped = WORKLOG_STAGES.slice(reached + 1, at).filter((st) => EVIDENCE_STAGES.includes(st));
    if (skipped.length > 0 && !stamp.forced && reached >= 0) {
      problems.push(`the ${stamp.stage} stamp of ${stamp.at} skips ${skipped.join(", ")}`);
    }
    if (stamp.stage === "committed" && stamp.commit === undefined && !stamp.forced) {
      problems.push(`the committed stamp of ${stamp.at} names no commit`);
    }
    reached = Math.max(reached, at);
  }
  return problems;
}

/** Refuse a value that would break out of a one-line `<!-- key: value -->` marker. */
function assertMarkerValue(name: string, value: string | undefined): void {
  if (value === undefined) return;
  if (/[\r\n]/.test(value) || value.includes("-->")) {
    throw new StageRefusal(`${name} must be one line without "-->"`);
  }
}

/** Words of a review note after the `Review:` prefix. */
export function reviewWordCount(text: string): number {
  const body = text.trimStart().slice(REVIEW_NOTE_PREFIX.length).trim();
  return body === "" ? 0 : body.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

/** A review note needs this many words of text after `Review:` (0.76.0). */
export const REVIEW_MIN_WORDS = 3;

function checkReviewed(thread: WorklogThread): void {
  const since = latestStamp(thread, "committed")?.at;
  const sinceMs = since === undefined ? Number.NEGATIVE_INFINITY : Date.parse(since);
  const found = thread.entries.some(
    (e) =>
      e.kind === "note" &&
      (e.text ?? "").trimStart().startsWith(REVIEW_NOTE_PREFIX) &&
      reviewWordCount(e.text ?? "") >= REVIEW_MIN_WORDS &&
      !(Date.parse(e.timestamp) < sinceMs),
  );
  if (!found) {
    throw new StageRefusal(
      `cannot move to reviewed: thread ${thread.threadId} has no note starting with "${REVIEW_NOTE_PREFIX}" ` +
        `with at least ${REVIEW_MIN_WORDS} words of text, written after it was committed. Add one with ` +
        `\`darius worklog append ${thread.threadId} --section note --message "Review: ..."\``,
    );
  }
}

/** Build a stamp for a stage change made now, from this checkout and host. */
function makeStamp(
  worklogPath: string,
  stage: WorklogStage,
  extra: Partial<StageStamp> & { trackerRoot?: string },
): StageStamp {
  const { trackerRoot, ...rest } = extra;
  const repoRoot = projectRootOf(trackerRoot ?? dirname(dirname(worklogPath)));
  const stamp: StageStamp = {
    stage,
    at: new Date().toISOString(),
    head: gitHead(repoRoot),
    host: hostName(),
  };
  if (rest.commit !== undefined) stamp.commit = rest.commit;
  if (rest.forced) stamp.forced = true;
  if (rest.reason !== undefined) stamp.reason = rest.reason;
  if (rest.session) stamp.session = rest.session;
  if (rest.noCode !== undefined) stamp.noCode = rest.noCode;
  if (rest.actingSession) stamp.actingSession = rest.actingSession;
  return stamp;
}

export type DispatchThreadOpts = {
  worklogPath: string;
  threadId: string;
  agent: string;
  reason?: string;
  /** Acting session id; becomes the thread owner when set. */
  session?: string | null;
  /** The env session, when `--as-other-session` let `session` differ from it (0.76.0). */
  actingSession?: string | null;
};

/**
 * Stage-2 sugar: mark a thread `dispatched` and record the agent selection
 * in one locked write. Replaces the prose-mandated "Agent selected:" logging.
 * Since 0.72.0 it also stamps the stage and records the acting session as the
 * thread owner, which the exit gate uses.
 */
export function dispatchThread(opts: DispatchThreadOpts): void {
  const { worklogPath, threadId, agent, reason } = opts;
  const session = opts.session ?? undefined;
  assertMarkerValue("session", session);

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
    if (session) thread.session = session;
    thread.stamps = [...(thread.stamps ?? []), makeStamp(worklogPath, "dispatched", { session, ...(opts.actingSession ? { actingSession: opts.actingSession } : {}) })];
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
  /** Owning session (0.72.0). Absent on threads opened before it or with no session. */
  session?: string;
  /** Every stage stamp, oldest first (0.72.0). Absent on threads without one. */
  stamps?: StageStamp[];
  /** The stamp of the current stage, when one was written (0.72.0). */
  stageStamp?: StageStamp;
  /** True when the latest stage change used --force (0.72.0). */
  forced?: boolean;
  entryCount: number;
  worklogFile: string;
  /** Paths of the thread's artifact entries (0.72.0). */
  artifacts?: string[];
  /** Timestamps of notes that start with `Review:` (0.72.0). */
  reviewNotes?: string[];
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
      if (thread.session) summary.session = thread.session;
      if (thread.stamps && thread.stamps.length > 0) {
        summary.stamps = thread.stamps;
        const current = thread.stage ? latestStamp(thread, thread.stage) : undefined;
        if (current) summary.stageStamp = current;
        if (thread.stamps[thread.stamps.length - 1]!.forced) summary.forced = true;
      }
      const artifacts = thread.entries.flatMap((e) => (e.kind === "artifact" && e.path ? [e.path] : []));
      if (artifacts.length > 0) summary.artifacts = artifacts;
      const reviews = thread.entries
        .filter((e) => e.kind === "note" && (e.text ?? "").trimStart().startsWith(REVIEW_NOTE_PREFIX))
        .map((e) => e.timestamp);
      if (reviews.length > 0) summary.reviewNotes = reviews;
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
const SESSION_RE = /^<!-- session: (.+) -->$/;
const STAMP_RE = /^<!-- stamp: (\{.*\}) -->$/;

/**
 * The verbatim body a parsed entry came from (0.76.0). An entry read from disk
 * and left unchanged is written back byte for byte, so the escape rule below
 * never rewrites an entry that an older version wrote.
 */
const ENTRY_RAW = new WeakMap<WorklogEntry, string>();

/**
 * A line of entry text that the parser could read as structure: it starts,
 * after optional whitespace, with `<!--` (a marker such as `<!-- stage: -->`
 * or `<!-- stamp: -->`) or `#` (a thread `## ` or entry `### ` header).
 * Backslashes already in front are part of the match, so the escape is
 * reversible: write adds one backslash, read removes one.
 */
const STRUCTURE_LINE_RE = /^(\s*)(\\*)(<!--|#)/;
const ESCAPED_LINE_RE = /^(\s*)\\(\\*)(<!--|#)/;

/**
 * Make user text inert before it is written into a worklog (0.76.0). Each line
 * that could read as structure gets one backslash in front: `\## x`,
 * `\<!-- stage: committed -->`. In Markdown the backslash also renders the
 * `#` as text. {@link unescapeEntryText} reverses it on read.
 */
export function escapeEntryText(text: string): string {
  return text
    .split("\n")
    .map((line) => line.replace(STRUCTURE_LINE_RE, "$1\\$2$3"))
    .join("\n");
}

/** Reverse {@link escapeEntryText}: what the user wrote, for display and checks. */
export function unescapeEntryText(text: string): string {
  return text
    .split("\n")
    .map((line) => line.replace(ESCAPED_LINE_RE, "$1$2$3"))
    .join("\n");
}

function entryBodyLine(entry: WorklogEntry, body: string): string {
  const raw = ENTRY_RAW.get(entry);
  if (raw !== undefined && unescapeEntryText(raw) === body) return raw;
  return escapeEntryText(body);
}

/** The verbatim line a parsed stamp came from, so a rewrite never reformats it. */
const STAMP_RAW = new WeakMap<StageStamp, string>();

/** One stamp as a metadata comment. `<` and `>` are escaped so `-->` cannot end it early. */
function formatStamp(stamp: StageStamp): string {
  const json = JSON.stringify(stamp).replace(/</g, "\\u003c").replace(/>/g, "\\u003e");
  return `<!-- stamp: ${json} -->`;
}

/** Parse a stamp comment; null when the JSON or its required fields are bad (it stays prose). */
function parseStamp(line: string): StageStamp | null {
  const match = STAMP_RE.exec(line.trim());
  if (!match) return null;
  try {
    const parsed: unknown = JSON.parse(match[1] ?? "");
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    const obj = parsed as Record<string, unknown>;
    if (typeof obj.stage !== "string" || !(WORKLOG_STAGES as readonly string[]).includes(obj.stage)) return null;
    if (typeof obj.at !== "string") return null;
    const stamp: StageStamp = {
      stage: obj.stage as WorklogStage,
      at: obj.at,
      head: typeof obj.head === "string" ? obj.head : NO_GIT_HEAD,
      host: typeof obj.host === "string" ? obj.host : "unknown",
    };
    if (typeof obj.commit === "string") stamp.commit = obj.commit;
    if (obj.forced === true) stamp.forced = true;
    if (typeof obj.reason === "string") stamp.reason = obj.reason;
    if (typeof obj.session === "string") stamp.session = obj.session;
    if (typeof obj.noCode === "string") stamp.noCode = obj.noCode;
    if (typeof obj.actingSession === "string") stamp.actingSession = obj.actingSession;
    STAMP_RAW.set(stamp, line);
    return stamp;
  } catch {
    return null;
  }
}

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
    if (SESSION_RE.test(line) || STAMP_RE.test(line)) continue;
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
 * <!-- session: <id> -->              (0.72.0, optional)
 * <!-- stamp: {"stage":...} -->       (0.72.0, one per stage change)
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
    const plain = unescapeEntryText(text);
    if (currentEntryKind === "artifact") {
      entry.path = plain;
    } else {
      entry.text = plain;
    }
    ENTRY_RAW.set(entry, text);
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

    // Metadata comment: <!-- session: ... --> (0.72.0)
    const sessionMatch = SESSION_RE.exec(line);
    if (sessionMatch) {
      currentThread.session = (sessionMatch[1] ?? "").trim();
      continue;
    }

    // Metadata comment: <!-- stamp: {...} --> (0.72.0). A bad one stays prose.
    if (STAMP_RE.test(line)) {
      const stamp = parseStamp(line);
      if (stamp !== null) {
        currentThread.stamps = [...(currentThread.stamps ?? []), stamp];
        continue;
      }
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

    if (thread.session) {
      parts.push(`<!-- session: ${thread.session} -->`);
    }

    for (const stamp of thread.stamps ?? []) {
      parts.push(STAMP_RAW.get(stamp) ?? formatStamp(stamp));
    }

    if (thread.closedAt && thread.closeStatus) {
      parts.push(`<!-- closed: ${thread.closedAt} status: ${thread.closeStatus} -->`);
    }

    for (const line of thread.freeform ?? []) {
      parts.push(line);
    }

    for (const entry of thread.entries) {
      parts.push(`### ${entry.timestamp} [${entry.kind}]`);
      const body = entry.kind === "artifact" ? entry.path : entry.text;
      if (body) parts.push(entryBodyLine(entry, body));
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
  // `Artifacts` is what the work-verify skill passes; it was filed as a note
  // before 0.72.0, which hid the paths from the committed-stage check.
  if (lower === "artifact" || lower === "artifacts") return "artifact";
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
