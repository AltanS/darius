/**
 * Stage evidence: the facts a Work Loop stage change must rest on (0.72.0).
 *
 * Every stage stamp records where it was made: the git HEAD of the checkout
 * (or `none` outside git), the host name, and the time. Three stages also need
 * proof before `worklog set-stage` accepts them:
 *
 * - `verified`  needs a passing ledger line for the thread's spec, written
 *               after the thread was dispatched, and no item of that spec whose
 *               latest ledger result is a failure.
 * - `committed` needs a commit that is an ancestor of HEAD, and no artifact of
 *               the thread may be dirty or untracked.
 * - `reviewed`  needs a `Review:` note written after the committed stamp.
 *
 * Git is shelled out here and nowhere else in the stage code. Every git helper
 * returns null or false on failure, so callers decide what a missing answer
 * means.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { parseFrontmatter } from "./markdown/frontmatter.ts";
import { parseChecklist } from "./markdown/checklist.ts";
import { parsePorcelainLine } from "./uncommitted.ts";
import { dirtyAmong } from "./artifact-paths.ts";
import { NO_GIT_HEAD, git } from "./host-stamp.ts";

export { NO_GIT_HEAD, gitHead, hostName } from "./host-stamp.ts";
import { readLedger, toLedgerSpecPath, type LedgerEntry } from "./verification/ledger.ts";

/** Exit-code-carrying refusal: 1 refused, 3 inconclusive environment. */
export class StageRefusal extends Error {
  exitCode: 1 | 3;
  constructor(message: string, exitCode: 1 | 3 = 1) {
    super(message);
    this.name = "StageRefusal";
    this.exitCode = exitCode;
  }
}

/** The checkout that holds a tracker (src/legacy/lib/tracker-root.ts). */
export { projectRootOf } from "./tracker-root.ts";
import { resolveTreeRef } from "./tracker-root.ts";

/** True when `cwd` is inside a git work tree. */
export function inGitRepo(cwd: string): boolean {
  return git(cwd, ["rev-parse", "--is-inside-work-tree"])?.trim() === "true";
}

/** The full sha a ref names, or null when it names no commit. */
export function resolveCommit(cwd: string, ref: string): string | null {
  const out = git(cwd, ["rev-parse", "--verify", "-q", `${ref}^{commit}`]);
  const sha = out?.trim() ?? "";
  return sha === "" ? null : sha;
}

/** True when `sha` is an ancestor of (or equal to) HEAD. */
export function isAncestorOfHead(cwd: string, sha: string): boolean {
  try {
    execFileSync("git", ["-C", cwd, "merge-base", "--is-ancestor", sha, "HEAD"], {
      stdio: ["ignore", "ignore", "ignore"],
    });
    return true;
  } catch {
    return false;
  }
}

/** `git rev-parse --show-prefix` of the project root: its path below the git top level. */
export function gitPrefix(cwd: string): string {
  return git(cwd, ["rev-parse", "--show-prefix"])?.trim() ?? "";
}

/** Paths a commit range changed, relative to the git top level; null when git fails. */
export function changedPaths(cwd: string, from: string, to: string): string[] | null {
  const out = git(cwd, ["-c", "core.quotePath=false", "diff", "--name-only", `${from}..${to}`]);
  if (out === null) return null;
  return out.split("\n").map((l) => l.trim()).filter((l) => l !== "");
}

/**
 * The artifacts that are dirty or untracked. Artifacts are the normalised,
 * project-relative paths of `artifact-paths.ts`. An artifact may name a
 * directory: any dirty file below it counts. Returns null when git status
 * fails.
 */
export function dirtyArtifacts(cwd: string, artifacts: readonly string[]): string[] | null {
  const porcelain = git(cwd, ["-c", "core.quotePath=false", "status", "--porcelain", "-uall"]);
  if (porcelain === null) return null;
  return dirtyArtifactsOf(porcelain, artifacts, gitPrefix(cwd));
}

/** Pure part of {@link dirtyArtifacts}: porcelain paths are relative to the git top level. */
export function dirtyArtifactsOf(porcelain: string, artifacts: readonly string[], prefix: string): string[] {
  const dirty: string[] = [];
  for (const line of porcelain.split("\n")) {
    const parsed = parsePorcelainLine(line.replace(/\r$/, ""));
    if (parsed !== null) dirty.push(parsed.path);
  }
  return dirtyAmong(dirty, artifacts, prefix);
}

// ---------------------------------------------------------------------------
// Ledger evidence
// ---------------------------------------------------------------------------

const FAILING_OUTCOMES: ReadonlySet<string> = new Set(["fail", "regression", "error", "timeout"]);

/**
 * A line that earned a tick: an executed pass, a manual mark with evidence
 * text, or (0.76.0) a manual override of a runnable check with its reason.
 */
function isPassing(entry: LedgerEntry): boolean {
  if (entry.outcome === "pass") return true;
  const evidence = typeof entry.evidence === "string" && entry.evidence.trim() !== "";
  if (entry.outcome === "manual") return evidence;
  if (entry.outcome === "manual-override") {
    return evidence && typeof entry.override === "string" && entry.override.trim() !== "";
  }
  return false;
}

function atMs(value: string | undefined): number {
  const ms = Date.parse(value ?? "");
  return Number.isFinite(ms) ? ms : Number.NaN;
}

export type LedgerVerdict =
  | { ok: true; passing: number }
  | { ok: false; reason: string };

/** The checklist items of a spec file, or null when it cannot be read. */
function specItems(absSpecPath: string): { index: number; state: string }[] | null {
  try {
    const { content } = parseFrontmatter(readFileSync(absSpecPath, "utf-8"));
    return parseChecklist(content).map((item) => ({ index: item.index, state: item.state }));
  } catch {
    return null;
  }
}

/**
 * May a thread on `specPath` move to `verified`? Since 0.76.0 every checklist
 * item that is not skipped (`[-]`) needs a latest ledger line that passes,
 * written at or after `since` (the dispatch stamp). A failing line for an item
 * that is now skipped, or that no longer exists, is ignored.
 */
export function ledgerVerdict(trackerRoot: string, specPath: string, since: string): LedgerVerdict {
  const absSpec = resolveTreeRef(trackerRoot, specPath);
  const spec = toLedgerSpecPath(trackerRoot, absSpec);
  const items = specItems(absSpec);
  if (items === null) {
    return { ok: false, reason: `cannot read spec ${spec}, so no ledger line can vouch for it` };
  }
  const open = items.filter((item) => item.state !== "skipped");
  if (open.length === 0) {
    return { ok: false, reason: `no passing ledger line can vouch for ${spec}: it has no checklist item that is not skipped` };
  }
  const lines = readLedger(trackerRoot).filter((e) => e.spec === spec);
  const sinceMs = atMs(since);

  // The latest line per item; on a tie the later line in the file wins.
  const latest = new Map<number, LedgerEntry>();
  for (const entry of lines) {
    const prev = latest.get(entry.index);
    if (prev === undefined || !(atMs(prev.at) > atMs(entry.at))) latest.set(entry.index, entry);
  }

  const failing: string[] = [];
  const missing: string[] = [];
  for (const item of open) {
    const line = latest.get(item.index);
    if (line === undefined) {
      missing.push(`#${String(item.index)}`);
      continue;
    }
    if (FAILING_OUTCOMES.has(line.outcome)) {
      failing.push(`#${String(item.index)} (${line.outcome})`);
      continue;
    }
    if (!isPassing(line) || (!Number.isNaN(sinceMs) && !(atMs(line.at) >= sinceMs))) {
      missing.push(`#${String(item.index)}`);
    }
  }
  if (failing.length > 0) {
    return { ok: false, reason: `spec ${spec} has items whose latest ledger result failed: ${failing.join(", ")}` };
  }
  if (missing.length > 0) {
    return {
      ok: false,
      reason:
        `no passing ledger line for ${spec} since ${since} on items ${missing.join(", ")}. ` +
        'Run `darius verify-item <spec> <idx>` for each (or `darius mark <spec> <idx> --verified --evidence "..."` for a manual item) first',
    };
  }
  return { ok: true, passing: open.length };
}
