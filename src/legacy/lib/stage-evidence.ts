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
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { parsePorcelainLine } from "./uncommitted.ts";
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

/** The checkout that holds a tracker: the parent of `.tracker/`. */
export function projectRootOf(trackerRoot: string): string {
  return dirname(resolve(trackerRoot));
}

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

function normPath(p: string): string {
  return p.trim().replace(/^\.\//, "").replace(/\/{2,}/g, "/").replace(/\/$/, "");
}

/**
 * The artifacts that are dirty or untracked, as written in the thread. An
 * artifact may name a directory: any dirty file below it counts. Returns null
 * when git status fails.
 */
export function dirtyArtifacts(cwd: string, artifacts: readonly string[]): string[] | null {
  const porcelain = git(cwd, ["-c", "core.quotePath=false", "status", "--porcelain", "-uall"]);
  if (porcelain === null) return null;
  const top = git(cwd, ["rev-parse", "--show-toplevel"])?.trim() ?? cwd;
  const prefix = git(cwd, ["rev-parse", "--show-prefix"])?.trim() ?? "";

  const dirty: string[] = [];
  for (const line of porcelain.split("\n")) {
    const parsed = parsePorcelainLine(line.replace(/\r$/, ""));
    if (parsed !== null) dirty.push(normPath(parsed.path));
  }

  const result: string[] = [];
  for (const artifact of artifacts) {
    const raw = artifact.trim();
    if (raw === "" || result.includes(raw)) continue;
    // Porcelain paths are relative to the git top level; artifacts are relative
    // to the project root, which may sit below it.
    const a = normPath(isAbsolute(raw) ? relative(top, raw) : `${prefix}${raw}`);
    if (a === "") continue;
    if (dirty.some((d) => d === a || d.startsWith(`${a}/`))) result.push(raw);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Ledger evidence
// ---------------------------------------------------------------------------

const FAILING_OUTCOMES: ReadonlySet<string> = new Set(["fail", "regression", "error", "timeout"]);

/** A line that earned a tick: an executed pass, or a manual mark with evidence text. */
function isPassing(entry: LedgerEntry): boolean {
  if (entry.outcome === "pass") return true;
  return entry.outcome === "manual" && typeof entry.evidence === "string" && entry.evidence.trim() !== "";
}

function atMs(value: string | undefined): number {
  const ms = Date.parse(value ?? "");
  return Number.isFinite(ms) ? ms : Number.NaN;
}

export type LedgerVerdict =
  | { ok: true; passing: number }
  | { ok: false; reason: string };

/**
 * May a thread on `specPath` move to `verified`? Needs one passing ledger line
 * for the spec at or after `since`, and no item whose latest line failed.
 */
export function ledgerVerdict(trackerRoot: string, specPath: string, since: string): LedgerVerdict {
  const repoRoot = projectRootOf(trackerRoot);
  const spec = toLedgerSpecPath(trackerRoot, isAbsolute(specPath) ? specPath : resolve(repoRoot, specPath));
  const lines = readLedger(trackerRoot).filter((e) => e.spec === spec);
  const sinceMs = atMs(since);

  const latest = new Map<number, LedgerEntry>();
  for (const entry of lines) {
    const prev = latest.get(entry.index);
    if (prev === undefined || !(atMs(prev.at) > atMs(entry.at))) latest.set(entry.index, entry);
  }
  const failing = [...latest.values()].filter((e) => FAILING_OUTCOMES.has(e.outcome));
  if (failing.length > 0) {
    const items = failing.map((e) => `#${String(e.index)} (${e.outcome})`).join(", ");
    return { ok: false, reason: `spec ${spec} has items whose latest ledger result failed: ${items}` };
  }

  const passing = lines.filter((e) => isPassing(e) && (Number.isNaN(sinceMs) || atMs(e.at) >= sinceMs)).length;
  if (passing === 0) {
    return {
      ok: false,
      reason:
        `no passing ledger line for ${spec} since ${since}. ` +
        'Run `darius verify-item <spec> <idx>` (or `darius mark <spec> <idx> --verified --evidence "..."`) first',
    };
  }
  return { ok: true, passing };
}
