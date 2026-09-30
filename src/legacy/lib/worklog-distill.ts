/**
 * `worklog distill` — the deterministic half of worklog dreaming (M7/02).
 *
 * Distillation replaces a worklog file wholesale with a small, LLM-authored
 * anchor stub. That is a *lossy* rewrite, so the CLI never authors content and
 * never trusts the caller's judgment about when it is safe: it enforces the
 * eligibility gates, preserves the raw file under `<root>/archive/worklog-raw/`,
 * stamps provenance, and swaps atomically. The judgment about what belongs in
 * the stub lives in the dream skill; everything mechanical lives here.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { atomicWriteFileSync } from "./atomic.ts";
import {
  isWorklogIndexFile,
  scanWorklogDir,
  scanWorklogFile,
  withLock,
  worklogLastActivity,
  type WorklogFileScan,
} from "./worklog.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Cross-cutting (milestone-less) files need this much quiet before distilling. */
export const DEFAULT_MIN_AGE_DAYS = 14;

/** Raw copies live here, relative to the tracker root. */
export const WORKLOG_RAW_DIR = join("archive", "worklog-raw");

/** Anchors are supposed to be small — bigger stubs warn (they never refuse). */
export const STUB_WARN_BYTES = 4096;

const MS_PER_DAY = 86_400_000;

/** A worklog file named after a milestone: `M7-worklog-dreaming.md`. */
const MILESTONE_FILE_RE = /^M\d+-/i;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Machine-readable outcome of the gate chain. The five spec'd gates map to
 * `open-threads`, `milestone-active` / `not-archived`, `too-recent` and
 * `already-distilled`; `not-found` and `index-file` are the two ways the
 * "is this even a distillable worklog file" gate fails.
 */
export type DistillReason =
  | "eligible"
  | "not-found"
  | "index-file"
  | "open-threads"
  | "milestone-active"
  | "not-archived"
  | "too-recent"
  | "already-distilled";

export type DistillEligibility = {
  worklogFile: string;
  eligible: boolean;
  reason: DistillReason;
  /** One-line human explanation. Empty when eligible. */
  detail: string;
  openThreads: number;
  /** Max thread/entry timestamp, file mtime for legacy files. Null if unread. */
  lastActivity: string | null;
};

export type EvaluateDistillOpts = {
  trackerRoot: string;
  /** Worklog file basename, with or without the `.md` suffix. */
  file: string;
  minAgeDays?: number;
  now?: Date;
};

export type ListDistillOpts = {
  trackerRoot: string;
  minAgeDays?: number;
  now?: Date;
};

export type DistillOpts = EvaluateDistillOpts & {
  /** The stub body. The CLI prepends the provenance stamp; callers never do. */
  content: string;
  /** Re-distill a file that already carries a stamp. */
  force?: boolean;
};

export type DistillResult = {
  worklogFile: string;
  /** Tracker-relative path recorded in the stamp. */
  rawPath: string;
  sourceSha256: string;
  distilledAt: string;
  /**
   * `copied` — first distill. `already-identical` — a re-run over content that
   * matches the existing copy. `kept-original` — a `--force` re-distill, where
   * the preserved raw stays the original rather than the previous stub.
   */
  rawPreserved: "copied" | "already-identical" | "kept-original";
  /** Byte length of the written stub, stamp included. */
  bytes: number;
  /** True when the stub body exceeds {@link STUB_WARN_BYTES}. */
  oversize: boolean;
};

// ---------------------------------------------------------------------------
// Eligibility
// ---------------------------------------------------------------------------

/**
 * Run the gate chain for one worklog file. Never writes; safe to call from
 * `--check`, `--list`, and from inside the distill lock.
 */
export function evaluateDistillEligibility(opts: EvaluateDistillOpts): DistillEligibility {
  const fileName = normalizeWorklogFileName(opts.file);

  // Naming an index file explicitly gets a refusal rather than a "not found":
  // enumeration skips them, but a targeted `distill 00-INDEX.md` deserves the
  // real reason.
  if (isWorklogIndexFile(fileName)) {
    return indexFileVerdict(fileName);
  }

  const path = join(opts.trackerRoot, "worklog", fileName);
  if (!existsSync(path)) {
    return ineligible(
      fileName,
      "not-found",
      `no such worklog file: ${join("worklog", fileName)} under ${opts.trackerRoot}`,
    );
  }

  return gateScan(scanWorklogFile(path), opts);
}

/**
 * Evaluate every worklog file in the directory. Generated `00-` index files are
 * not worklogs, so they are not listed at all — `scanWorklogDir` drops them
 * before the gates ever see them.
 */
export function listDistillCandidates(opts: ListDistillOpts): DistillEligibility[] {
  return scanWorklogDir(opts.trackerRoot)
    .map((scan) => gateScan(scan, opts))
    .sort((a, b) => a.worklogFile.localeCompare(b.worklogFile));
}

/**
 * The gate chain proper, in the order the spec fixes:
 * open threads → milestone lifecycle → age → existing stamp.
 */
function gateScan(
  scan: WorklogFileScan,
  opts: EvaluateDistillOpts | ListDistillOpts,
): DistillEligibility {
  const { trackerRoot } = opts;
  const minAgeDays = opts.minAgeDays ?? DEFAULT_MIN_AGE_DAYS;
  const now = (opts.now ?? new Date()).getTime();

  const file = scan.file;
  const openThreads = scan.doc.threads.filter((t) => !t.closedAt).length;
  const lastActivity = worklogLastActivity(scan.doc, scan.path);
  const base = { worklogFile: file, openThreads, lastActivity };

  // Gate 2 — every thread must be closed. Pure-legacy files have no threads at
  // all and pass here; that is deliberate, their gate is age or the milestone.
  if (openThreads > 0) {
    return {
      ...base,
      eligible: false,
      reason: "open-threads",
      detail: `${file} has ${openThreads} open thread(s) — close them before distilling`,
    };
  }

  const slug = file.slice(0, -".md".length);

  if (MILESTONE_FILE_RE.test(file)) {
    // Gate 3 — a milestone worklog rides its milestone's lifecycle: the
    // milestone directory must be gone and its archive document must exist.
    const activeDir = findEntry(trackerRoot, slug, "dir");
    if (activeDir !== null) {
      return {
        ...base,
        eligible: false,
        reason: "milestone-active",
        detail:
          `${file} belongs to milestone ${activeDir}, still active at ` +
          `${join(trackerRoot, activeDir)} — archive the milestone first`,
      };
    }

    const archiveDoc = findEntry(join(trackerRoot, "archive"), `${slug}.md`, "file");
    if (archiveDoc === null) {
      return {
        ...base,
        eligible: false,
        reason: "not-archived",
        detail:
          `${file} has no archive document at ` +
          `${join(trackerRoot, "archive", `${slug}.md`)} — archive the milestone first`,
      };
    }
  } else {
    // Gate 4 — cross-cutting files have no milestone lifecycle to ride, so age
    // is the only proxy for "nobody is working out of this file any more".
    const ageDays = lastActivity === null ? 0 : (now - Date.parse(lastActivity)) / MS_PER_DAY;
    if (ageDays < minAgeDays) {
      return {
        ...base,
        eligible: false,
        reason: "too-recent",
        detail:
          `${file} was last active ${ageDays.toFixed(1)} day(s) ago — needs ${minAgeDays} ` +
          `(raise --min-age-days to override)`,
      };
    }
  }

  // Gate 5 — a stamped file has already been distilled; re-distilling discards
  // a stub someone wrote on purpose, so it takes an explicit --force.
  if (scan.stamp !== null) {
    return {
      ...base,
      eligible: false,
      reason: "already-distilled",
      detail:
        `${file} was already distilled at ${scan.stamp.distilledAt} — pass --force to re-distill`,
    };
  }

  return { ...base, eligible: true, reason: "eligible", detail: "" };
}

/** Generated index files are documentation about the directory, never input. */
function indexFileVerdict(file: string): DistillEligibility {
  return ineligible(
    file,
    "index-file",
    `${file} is a generated index file — never eligible for distillation`,
  );
}

function ineligible(file: string, reason: DistillReason, detail: string): DistillEligibility {
  return {
    worklogFile: file,
    eligible: false,
    reason,
    detail,
    openThreads: 0,
    lastActivity: null,
  };
}

/**
 * Case-insensitive lookup of a directory entry. Milestone slugs are written by
 * hand in worklog filenames, so `m7-foo.md` must still find `M7-foo/`.
 * Returns the on-disk name, or null.
 */
function findEntry(dir: string, name: string, kind: "dir" | "file"): string | null {
  if (!existsSync(dir)) return null;

  const wanted = name.toLowerCase();
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.toLowerCase() !== wanted) continue;
    if (kind === "dir" && entry.isDirectory()) return entry.name;
    if (kind === "file" && entry.isFile()) return entry.name;
  }
  return null;
}

/** Basename-only, `.md`-suffixed. Strips any path so `<file>` cannot escape. */
function normalizeWorklogFileName(file: string): string {
  const name = basename(file.trim());
  return name.endsWith(".md") ? name : `${name}.md`;
}

// ---------------------------------------------------------------------------
// Distillation
// ---------------------------------------------------------------------------

/**
 * Replace an eligible worklog file with `content`, preserving the raw file and
 * stamping provenance. Throws with the gate's one-line detail when ineligible,
 * or when the raw copy cannot be reconciled.
 */
export function distillWorklogFile(opts: DistillOpts): DistillResult {
  const fileName = normalizeWorklogFileName(opts.file);
  const worklogPath = join(opts.trackerRoot, "worklog", fileName);
  const rawDir = join(opts.trackerRoot, WORKLOG_RAW_DIR);
  const rawTarget = join(rawDir, fileName);
  const stampRawPath = `${basename(opts.trackerRoot)}/${WORKLOG_RAW_DIR}/${fileName}`;

  let result!: DistillResult;

  withLock(worklogPath, () => {
    // Re-check under the lock: eligibility is a property of the file on disk,
    // and a concurrent close/append could have changed it since --check ran.
    const gate = evaluateDistillEligibility(opts);
    const forced = gate.reason === "already-distilled" && opts.force === true;
    if (!gate.eligible && !forced) {
      throw new Error(gate.detail);
    }

    const scan = scanWorklogFile(worklogPath);
    const { sourceSha256, rawPreserved } = preserveRaw({
      scan,
      rawDir,
      rawTarget,
      forcedRedistill: forced,
    });

    const distilledAt = (opts.now ?? new Date()).toISOString();
    const stamp =
      `<!-- distilled: ${distilledAt} source-sha256: ${sourceSha256} ` +
      `raw: ${stampRawPath} -->`;
    const body = stripLeadingStamp(opts.content).replace(/^\n+/, "").trimEnd();
    const stub = `${stamp}\n${body}\n`;

    // ---- Sanctioned lossy write ------------------------------------------
    // This is the ONE code path that rewrites a worklog file without
    // assertWorklogLossless. Every thread mutator goes through
    // readDocForMutation because its job is to preserve every line; distill's
    // job is to *discard* lines, so the guard would refuse every call by
    // design. The loss-safety here is the raw copy taken immediately above —
    // the original bytes are on disk at rawTarget and are named, with their
    // digest, by the stamp this write carries. Do not reuse this bypass.
    atomicWriteFileSync(worklogPath, stub);
    // ----------------------------------------------------------------------

    result = {
      worklogFile: fileName,
      rawPath: stampRawPath,
      sourceSha256,
      distilledAt,
      rawPreserved,
      bytes: Buffer.byteLength(stub, "utf-8"),
      oversize: Buffer.byteLength(body, "utf-8") > STUB_WARN_BYTES,
    };
  });

  return result;
}

/**
 * Get the original worklog content onto disk under archive/worklog-raw/ before
 * anything is overwritten, and return the digest the stamp should carry.
 */
function preserveRaw(args: {
  scan: WorklogFileScan;
  rawDir: string;
  rawTarget: string;
  forcedRedistill: boolean;
}): { sourceSha256: string; rawPreserved: DistillResult["rawPreserved"] } {
  const { scan, rawDir, rawTarget, forcedRedistill } = args;

  if (forcedRedistill) {
    // On a --force re-distill the file on disk is a previous stub, not the
    // original. Overwriting the raw copy with it would destroy the very thing
    // the copy exists to hold, so instead verify the original is still intact
    // and carry its digest forward unchanged.
    const stamp = scan.stamp;
    if (stamp === null) {
      throw new Error(`${scan.file}: --force re-distill lost its provenance stamp mid-run`);
    }
    if (!existsSync(rawTarget)) {
      throw new Error(
        `${scan.file} is stamped as distilled but its raw copy is missing at ` +
          `${stamp.rawPath} — restore it before re-distilling`,
      );
    }
    const preserved = readFileSync(rawTarget, "utf-8");
    const sha = sha256(preserved);
    if (sha !== stamp.sourceSha256) {
      throw new Error(
        `raw copy at ${stamp.rawPath} no longer matches the recorded source-sha256 ` +
          `(${stamp.sourceSha256.slice(0, 12)}… vs ${sha.slice(0, 12)}…) — reconcile by hand`,
      );
    }
    return { sourceSha256: sha, rawPreserved: "kept-original" };
  }

  if (existsSync(rawTarget)) {
    // A re-run after a crash between copy and swap: identical content means the
    // copy is already the raw we would write, so proceed. Different content
    // means two distinct worklogs claim the same archive slot — there is no
    // override flag for that, because guessing which one to keep is how a
    // worklog gets lost.
    if (readFileSync(rawTarget, "utf-8") !== scan.raw) {
      throw new Error(
        `raw copy at ${join(WORKLOG_RAW_DIR, scan.file)} differs from the current ` +
          `${scan.file} — reconcile by hand (there is no override flag)`,
      );
    }
    return { sourceSha256: sha256(scan.raw), rawPreserved: "already-identical" };
  }

  if (!existsSync(rawDir)) {
    mkdirSync(rawDir, { recursive: true });
  }
  atomicWriteFileSync(rawTarget, scan.raw);
  return { sourceSha256: sha256(scan.raw), rawPreserved: "copied" };
}

/**
 * Drop a stamp the caller echoed back (the natural `--force` workflow is to
 * read the current stub, edit it, and pipe it back in). The CLI owns the stamp;
 * a caller-supplied one would otherwise be duplicated with a stale digest.
 */
function stripLeadingStamp(content: string): string {
  const newline = content.indexOf("\n");
  const first = (newline === -1 ? content : content.slice(0, newline)).trim();
  if (!first.startsWith("<!-- distilled: ")) return content;
  return newline === -1 ? "" : content.slice(newline + 1);
}

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf-8").digest("hex");
}
