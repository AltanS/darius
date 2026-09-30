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

/** A spec path relative to the repo root that is verified but uncommitted. */
export type UncommittedVerifiedSpec = {
  /** Repo-relative path as reported by git. */
  path: string;
  /** Git porcelain status code (e.g. " M", "A ", "??"). */
  gitStatus: string;
};

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
