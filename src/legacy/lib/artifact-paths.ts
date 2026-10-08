/**
 * Artifact paths of a worklog thread (0.76.0): one normaliser for every place
 * that records or checks them.
 *
 * An artifact entry holds one path or a list. A list splits on commas and
 * newlines only, never on spaces, so a path with a space stays one path.
 * Each path is normalised relative to the project root (the parent of
 * `.tracker/`): `./a//b/` and `x/../a/b` both become `a/b`, and an absolute
 * path inside the project becomes relative.
 *
 * Rejected, with a reason: an empty path, `.` (the whole project), a path
 * outside the project (absolute or through `..`), and a glob (`*`, `?`, `[`,
 * `{`). The CLI refuses these when they are recorded; a checker skips them,
 * so an old entry such as `.` can never vouch for a commit.
 */

import { isAbsolute, posix, relative, resolve, sep } from "node:path";

export type ArtifactCheck = { ok: true; path: string } | { ok: false; raw: string; reason: string };

const GLOB_RE = /[*?[\]{}]/;

/**
 * Split an artifact entry into its raw parts: commas and newlines only. A
 * Markdown list marker (`- `) and code backticks around a part are dropped.
 */
export function splitArtifactList(text: string): string[] {
  return text
    .split(/[,\n]/)
    .map((part) => part.trim().replace(/^[-*+]\s+/, "").replace(/^`(.*)`$/, "$1").trim())
    .filter((part) => part !== "");
}

/** Normalise one raw artifact path against the project root. */
export function normaliseArtifact(raw: string, projectRoot: string): ArtifactCheck {
  const trimmed = raw.trim();
  if (trimmed === "") return { ok: false, raw, reason: "the path is empty" };
  if (GLOB_RE.test(trimmed)) return { ok: false, raw, reason: "a glob is not a path; name the files" };
  let rel: string;
  if (isAbsolute(trimmed)) {
    rel = relative(resolve(projectRoot), resolve(trimmed)).split(sep).join("/");
  } else {
    rel = posix.normalize(trimmed.split(sep).join("/"));
  }
  rel = rel.replace(/\/+$/, "");
  if (rel === "" || rel === ".") {
    return { ok: false, raw, reason: "the path names the whole project; name the files" };
  }
  if (rel === ".." || rel.startsWith("../") || isAbsolute(rel)) {
    return { ok: false, raw, reason: "the path is outside the project" };
  }
  return { ok: true, path: rel };
}

/** Every check of one entry's text, in order. */
export function checkArtifactText(text: string, projectRoot: string): ArtifactCheck[] {
  return splitArtifactList(text).map((raw) => normaliseArtifact(raw, projectRoot));
}

/** The valid, normalised, de-duplicated artifact paths of a set of entry texts. */
export function artifactPathsOf(texts: readonly string[], projectRoot: string): string[] {
  const out: string[] = [];
  for (const text of texts) {
    for (const check of checkArtifactText(text, projectRoot)) {
      if (check.ok && !out.includes(check.path)) out.push(check.path);
    }
  }
  return out;
}

/**
 * True when a git path (relative to the git top level) is the artifact or
 * lies below it. `prefix` is `git rev-parse --show-prefix` of the project
 * root: empty when the project root is the top level.
 */
export function gitPathMatches(gitPath: string, artifact: string, prefix: string): boolean {
  const a = `${prefix}${artifact}`.replace(/\/+$/, "");
  const p = gitPath.replace(/^\.\//, "").replace(/\/+$/, "");
  return p === a || p.startsWith(`${a}/`);
}

/** The artifacts that match one of the dirty git paths (relative to the git top level). */
export function dirtyAmong(dirtyGitPaths: readonly string[], artifacts: readonly string[], prefix: string): string[] {
  const result: string[] = [];
  for (const artifact of artifacts) {
    if (artifact === "" || result.includes(artifact)) continue;
    if (dirtyGitPaths.some((d) => gitPathMatches(d, artifact, prefix))) result.push(artifact);
  }
  return result;
}
