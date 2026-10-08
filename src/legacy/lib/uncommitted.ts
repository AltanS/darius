/**
 * Verified-but-uncommitted detector — pure selection logic.
 *
 * The "commit-first" gate stops the planner from opening new work while a
 * previously-verified spec sits uncommitted. The failure it guards against:
 * darius verifies a spec (work-verify stamps `verification_passed:` into the
 * spec frontmatter and flips items to `[x]`), then gets pulled forward into
 * counsel / new-spec creation and never reaches `/tracker:commit`. The verified
 * work becomes an uncommitted debt that the next plan silently steps over.
 *
 * Detection signal (deterministic, git-derived):
 *   a spec file that is DIRTY in `git status --porcelain` AND whose working-tree
 *   frontmatter carries a `verification_passed:` timestamp.
 *
 * The dirtiness is what was never committed; the `verification_passed:` stamp is
 * what makes it *verified* work rather than an in-progress edit. We deliberately
 * bias toward flagging: a false positive (a committed-verified spec edited for an
 * unrelated reason) only tells darius to commit first, which is harmless and
 * usually correct. A false negative would let the original bug recur.
 *
 * This module is pure — git is shelled out in bin/tracker.mts and its porcelain
 * output is fed in here, so the selection rule is unit-testable without a repo.
 */

import { checkArtifactText, dirtyAmong } from "./artifact-paths.ts";

/** A spec path relative to the repo root that is verified but uncommitted. */
export type UncommittedVerifiedSpec = {
  /** Repo-relative path as reported by git (git mode) or the thread's spec path (store mode). */
  path: string;
  /**
   * Git porcelain status code (e.g. " M", "A ", "??"). In store mode it is the
   * fixed word {@link THREAD_GIT_STATUS}, because no tracker file is in git.
   */
  gitStatus: string;
  /** Where the entry came from. Absent in older output, which was always `git`. */
  source?: "git" | "thread";
  /** Store mode only: the worklog thread that is verified but not committed. */
  threadId?: string;
  /** Store mode only: artifacts of that thread that are dirty in `git status`. */
  dirtyArtifacts?: string[];
};

/** The `gitStatus` of a store-mode entry: the thread is verified, the code is not committed. */
export const THREAD_GIT_STATUS = "verified-uncommitted";

/**
 * Does the marker text list `milestone` in its root `kinds`? Then the store owns
 * the tracker tree, `.tracker` is a git-ignored link, and git cannot see a spec.
 * A light scan on purpose: the marker is validated by darius itself, this
 * vendored lib only needs the one fact.
 */
export function markerListsMilestone(markerText: string): boolean {
  const kinds = /^[ \t]*kinds[ \t]*=[ \t]*\[([^\]]*)\]/m.exec(markerText);
  if (kinds === null) return false;
  const body = kinds[1]!.split("\n").map((l) => l.replace(/#.*$/, "")).join("\n");
  return /["']milestone["']/.test(body);
}

/** One worklog thread, reduced to what the store-mode gate needs. */
export type ThreadForGate = {
  threadId: string;
  /** Worklog file basename, the fallback path when the thread names no spec. */
  worklogFile: string;
  specPath?: string;
  stage?: string;
  closed: boolean;
  /**
   * The thread's artifact entries as stored: one path or a comma-separated
   * list each. Absolute paths should be made relative by the caller.
   */
  artifacts: string[];
};

/**
 * Store-mode selection: every open thread at stage `verified` is a debt. Its
 * artifacts that are dirty in git are listed as extra information. Pass
 * porcelain from `git status --porcelain -uall`, so untracked files are listed
 * one by one and not folded into their directory.
 */
export function selectVerifiedThreads(
  threads: readonly ThreadForGate[],
  porcelain: string,
  prefix: string = "",
  /** Where a thread without a spec points: `.tracker/worklog/`, or `worklog/` for a store tree (0.78.0). */
  worklogDir: string = ".tracker/worklog/",
): UncommittedVerifiedSpec[] {
  const dirty: string[] = [];
  for (const rawLine of porcelain.split("\n")) {
    const parsed = parsePorcelainLine(rawLine.replace(/\r$/, ""));
    if (parsed !== null) dirty.push(parsed.path);
  }

  const result: UncommittedVerifiedSpec[] = [];
  for (const thread of threads) {
    if (thread.stage !== "verified" || thread.closed) continue;
    // One normaliser for record, check and this list (0.76.0): an entry may
    // hold a comma-separated list, and porcelain paths are relative to the
    // git top level while artifacts are relative to the project root.
    const artifacts: string[] = [];
    for (const text of thread.artifacts) {
      for (const check of checkArtifactText(text, "/")) {
        if (check.ok && !artifacts.includes(check.path)) artifacts.push(check.path);
      }
    }
    const dirtyArtifacts = dirtyAmong(dirty, artifacts, prefix);
    result.push({
      path: thread.specPath ?? `${worklogDir}${thread.worklogFile}`,
      gitStatus: THREAD_GIT_STATUS,
      source: "thread",
      threadId: thread.threadId,
      dirtyArtifacts,
    });
  }
  return result;
}

/**
 * Matches a tracker spec file: `.tracker/M<N>-<slug>/NN-NAME.md`, excluding the
 * reserved `00-README.md` milestone overview (which is not a spec).
 */
const SPEC_PATH_RE =
  /(?:^|\/)\.tracker\/M[^/]+\/(?!00-README\.md$)\d\d-[^/]*\.md$/;

/**
 * Parse a single `git status --porcelain` line into its status code and path.
 *
 * Porcelain v1 format: `XY <path>` where XY is exactly two status columns.
 * Renames (`R`) use `old -> new`; we take the new path. Quoted paths (core.quotePath)
 * are passed through verbatim — callers should run git with `-z` or `-c core.quotePath=false`
 * to avoid quoting; this parser does not unquote.
 */
export function parsePorcelainLine(
  line: string,
): { status: string; path: string } | null {
  if (line.length < 4) return null;
  const status = line.slice(0, 2);
  let path = line.slice(3);
  const arrow = path.indexOf(" -> ");
  if (arrow !== -1) {
    path = path.slice(arrow + 4);
  }
  if (path.length === 0) return null;
  return { status, path };
}

/**
 * Select the dirty spec files that are verified-but-uncommitted.
 *
 * @param porcelain     raw `git status --porcelain` output (one entry per line).
 * @param isVerified    predicate: does the working-tree spec at this repo-relative
 *                      path carry a `verification_passed:` frontmatter stamp?
 *                      (Reading the file is the caller's job — keeps this pure.)
 */
export function selectVerifiedUncommitted(
  porcelain: string,
  isVerified: (repoRelPath: string) => boolean,
): UncommittedVerifiedSpec[] {
  const result: UncommittedVerifiedSpec[] = [];
  const seen = new Set<string>();

  for (const rawLine of porcelain.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    if (line.trim().length === 0) continue;

    const parsed = parsePorcelainLine(line);
    if (parsed === null) continue;
    if (!SPEC_PATH_RE.test(parsed.path)) continue;
    if (seen.has(parsed.path)) continue;

    if (isVerified(parsed.path)) {
      seen.add(parsed.path);
      result.push({ path: parsed.path, gitStatus: parsed.status });
    }
  }

  return result;
}

/**
 * Does a spec's raw frontmatter carry a non-empty `verification_passed:` stamp?
 * Minimal scalar parse — mirrors the config readers in bin/tracker.mts and
 * avoids a full markdown parse for a single-field check.
 */
export function hasVerificationPassed(rawSpec: string): boolean {
  // Horizontal-whitespace classes only — `\s*` would cross the newline and
  // match the next line's content (e.g. a `---` fence), falsely reporting a
  // value where the field is actually empty.
  const m = /^[ \t]*verification_passed[ \t]*:[ \t]*(\S.*)$/m.exec(rawSpec);
  if (m === null) return false;
  const value = m[1]!.trim().replace(/^["']|["']$/g, "").trim();
  return value.length > 0;
}
