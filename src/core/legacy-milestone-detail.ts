/**
 * Read-only detail of one legacy tracker milestone (`<checkout>/.tracker/M<n>-<slug>/`):
 * its README, the full text of each spec, every other file in its directory,
 * and the worklogs that belong to it. Like `legacy-milestones.ts`, it never
 * writes to `.tracker/`.
 *
 * A worklog belongs to a milestone the way the tracker CLI ties them:
 *
 * - by name: `.tracker/worklog/M7-anything.md` belongs to M7. This is the
 *   rule of the worklog index (`worklog-index.ts`, `^(M\d+)-`, any case),
 *   which also covers the distill gate's rule (the file is named after the
 *   milestone directory). The numbers are compared, so `m07-` is M7 too.
 * - by spec: a thread in any worklog carries `<!-- spec: <path> -->` (written
 *   by `tracker worklog create --spec`), and the path points into this
 *   milestone's directory.
 *
 * Generated `00-` files in `worklog/` are not worklogs (`isWorklogIndexFile`).
 *
 * Paths are guarded: the milestone is picked from the directory listing, never
 * joined from the caller's text, and every file read must resolve (symlinks
 * followed) inside the checkout's `.tracker/`. Anything else is left out.
 */

import { lstatSync, readdirSync, readFileSync, realpathSync, statSync, type Stats } from "node:fs";
import { join, sep } from "node:path";

import { parseHeader } from "./legacy-header.ts";
import { readLegacyMilestones, type LegacyMilestone, type LegacySpec } from "./legacy-milestones.ts";

/** A file larger than this is listed, not read. */
export const MAX_TEXT_BYTES = 256 * 1024;
/** How deep the walk goes below the milestone directory, and how many files it lists at most. */
const MAX_DEPTH = 4;
const MAX_FILES = 300;

/** One file of a milestone or one worklog. */
export interface LegacyFile {
  /** The path below the milestone directory or `worklog/`, with `/`: `01-cart.md`, `_counsel/01-cart.md`. */
  path: string;
  size: number;
  /** Last change, an ISO time. */
  modifiedAt: string;
  /** A `.md` file: its text is markdown. */
  markdown: boolean;
  /** The text, a markdown header (`---` block) cut off; null when `omitted` says why. */
  text: string | null;
  omitted: "binary" | "too-large" | "unreadable" | null;
}

export interface LegacySpecFile {
  spec: LegacySpec;
  file: LegacyFile;
}

export interface LegacyWorklog extends LegacyFile {
  /** How the tracker ties it to the milestone: its file name, or a thread's spec marker. */
  link: "name" | "spec";
  /** When `worklog distill` replaced it with a stub; null for a worklog that is not distilled. */
  distilledAt: string | null;
}

export interface LegacyMilestoneDetail {
  milestone: LegacyMilestone;
  /** The directory name, `M12-cart`. */
  dir: string;
  /** Null when the milestone has no readable `00-README.md`. */
  readme: LegacyFile | null;
  /** The specs in their order, each with its file. */
  specs: LegacySpecFile[];
  /** Every other file of the directory, depth first, by path. */
  others: LegacyFile[];
  /** The worklogs that belong to the milestone, the latest change first. */
  worklogs: LegacyWorklog[];
}

const MILESTONE_REF = /^M\d+(?:-[\w.-]+)?$/iu;
const WORKLOG_MILESTONE = /^M(\d+)-/iu;
const SPEC_MARKER = /^<!-- spec: (.+) -->$/u;
const DISTILL_STAMP = /^<!-- distilled: (\S+) source-sha256: [0-9a-f]{64} raw: \S.*? -->$/u;
const BINARY_EXTENSIONS = /\.(?:png|jpe?g|gif|webp|avif|ico|pdf|zip|gz|tgz|bz2|xz|zst|woff2?|ttf|otf|mp[34]|mov|webm|wasm|sqlite|db)$/iu;

/** True when `path` resolves inside `root`, both already real paths. */
function inside(root: string, path: string): boolean {
  return path === root || path.startsWith(`${root}${sep}`);
}

/** The real path of `path` when it lies inside `root`; null when it escapes or cannot be resolved. */
function guarded(root: string, path: string): string | null {
  try {
    const real = realpathSync(path);
    return inside(root, real) ? real : null;
  } catch {
    return null;
  }
}

function looksBinary(bytes: Buffer): boolean {
  return bytes.subarray(0, 8192).includes(0);
}

/** A file's entry: its text when it is text and small enough. `real` is already guarded. */
function readFile(real: string, path: string, stats: Stats): LegacyFile {
  const markdown = path.toLowerCase().endsWith(".md");
  const base = { path, size: stats.size, modifiedAt: stats.mtime.toISOString(), markdown };
  if (BINARY_EXTENSIONS.test(path)) return { ...base, text: null, omitted: "binary" };
  if (stats.size > MAX_TEXT_BYTES) return { ...base, text: null, omitted: "too-large" };
  try {
    const bytes = readFileSync(real);
    if (looksBinary(bytes)) return { ...base, text: null, omitted: "binary" };
    const raw = bytes.toString("utf8");
    if (!markdown) return { ...base, text: raw, omitted: null };
    const header = parseHeader(raw);
    return { ...base, text: header.closed ? header.body : raw, omitted: null };
  } catch {
    return { ...base, text: null, omitted: "unreadable" };
  }
}

/** One file by path, guarded; null when it escapes `.tracker/`, is gone, or is not a file. */
function fileAt(root: string, absolute: string, path: string): LegacyFile | null {
  const real = guarded(root, absolute);
  if (real === null) return null;
  try {
    const stats = statSync(real);
    return stats.isFile() ? readFile(real, path, stats) : null;
  } catch {
    return null;
  }
}

/** The files below a directory, depth first by name; dot files and folders are skipped, symlinked folders are not followed. */
function walk(root: string, dir: string, prefix: string, depth: number, out: LegacyFile[], skip: (name: string) => boolean): void {
  if (depth > MAX_DEPTH) return;
  let names: string[] = [];
  try {
    // Code point order, the same on every host and locale.
    names = readdirSync(dir).toSorted((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  } catch {
    return;
  }
  for (const name of names) {
    if (out.length >= MAX_FILES) return;
    if (name.startsWith(".") || (depth === 0 && skip(name))) continue;
    const absolute = join(dir, name);
    const path = prefix === "" ? name : `${prefix}/${name}`;
    let link: Stats;
    try {
      link = lstatSync(absolute);
    } catch {
      continue;
    }
    if (link.isDirectory()) {
      if (guarded(root, absolute) !== null) walk(root, absolute, path, depth + 1, out, skip);
      continue;
    }
    const file = fileAt(root, absolute, path);
    if (file !== null) out.push(file);
  }
}

/** A thread's spec path points into the milestone directory `dir`: `.tracker/<dir>/...`, `<dir>/...`, or an absolute path into this `.tracker/`. */
export function specPointsInto(entry: string, dir: string, trackerRoots: readonly string[]): boolean {
  let path = entry.trim().replaceAll("\\", "/");
  if (path.startsWith("/")) {
    const root = trackerRoots.find((candidate) => path.startsWith(`${candidate}/`));
    if (root === undefined) return false;
    path = path.slice(root.length + 1);
  } else {
    path = path.replace(/^(?:\.\/)+/u, "").replace(/^\.tracker\//u, "");
  }
  const [first = "", ...rest] = path.split("/");
  return rest.length > 0 && first.toLowerCase() === dir.toLowerCase();
}

/** The milestone number a worklog file name names, `M7-x.md` to 7; null for a cross-cutting file. */
export function worklogMilestone(file: string): number | null {
  const match = WORKLOG_MILESTONE.exec(file);
  return match === null ? null : Number.parseInt(match[1] ?? "", 10);
}

function distilledAt(text: string): string | null {
  const first = text.split("\n").find((line) => line.trim() !== "");
  return first === undefined ? null : (DISTILL_STAMP.exec(first.trim())?.[1] ?? null);
}

function worklogsOf(root: string, milestone: LegacyMilestone, dir: string, trackerRoots: readonly string[]): LegacyWorklog[] {
  const worklogDir = join(root, "worklog");
  if (guarded(root, worklogDir) === null) return [];
  let names: string[] = [];
  try {
    names = readdirSync(worklogDir);
  } catch {
    return [];
  }
  const out: LegacyWorklog[] = [];
  for (const name of names.filter((candidate) => candidate.endsWith(".md") && !candidate.startsWith("00-") && !candidate.startsWith("."))) {
    const byName = worklogMilestone(name) === milestone.number;
    const file = fileAt(root, join(worklogDir, name), name);
    if (file === null) continue;
    const text = file.text ?? "";
    const bySpec = !byName && text.split("\n").some((line) => {
      const marker = SPEC_MARKER.exec(line.trim())?.[1];
      return marker !== undefined && specPointsInto(marker, dir, trackerRoots);
    });
    if (!byName && !bySpec) continue;
    out.push({ ...file, link: byName ? "name" : "spec", distilledAt: distilledAt(text) });
  }
  return out.toSorted((left, right) => right.modifiedAt.localeCompare(left.modifiedAt) || left.path.localeCompare(right.path));
}

/**
 * Which milestone a URL names: its id (`M12`, any case) when only one directory
 * has that id, else the directory name (`M12-cart`). Null when none or several match.
 */
export function pickMilestone(milestones: readonly LegacyMilestone[], ref: string): LegacyMilestone | null {
  if (!MILESTONE_REF.test(ref) || ref.includes("..")) return null;
  const wanted = ref.toLowerCase();
  const byDir = milestones.filter((milestone) => `${milestone.id}-${milestone.slug}`.toLowerCase() === wanted);
  if (byDir.length === 1) return byDir[0] ?? null;
  const byId = milestones.filter((milestone) => milestone.id.toLowerCase() === wanted);
  return byId.length === 1 ? (byId[0] ?? null) : null;
}

/** One open milestone of a checkout with everything its directory holds and its worklogs; null when the checkout has no such milestone. */
export function readLegacyMilestoneDetail(checkout: string, ref: string): LegacyMilestoneDetail | null {
  const trackerDir = join(checkout, ".tracker");
  let root: string;
  try {
    root = realpathSync(trackerDir);
  } catch {
    return null;
  }
  const milestone = pickMilestone(readLegacyMilestones(checkout).milestones, ref);
  if (milestone === null) return null;
  const dir = `${milestone.id}-${milestone.slug}`;
  const milestoneDir = join(root, dir);
  if (guarded(root, milestoneDir) === null) return null;

  const specs: LegacySpecFile[] = [];
  const specFiles = new Set<string>();
  // The order of the list page: by spec number, then by file name.
  for (const spec of milestone.specs.toSorted((left, right) => left.number - right.number)) {
    const name = `${spec.slug.slice(milestone.id.length + 1)}.md`;
    const file = fileAt(root, join(milestoneDir, name), name);
    if (file === null) continue;
    specs.push({ spec, file });
    specFiles.add(name);
  }
  const readme = fileAt(root, join(milestoneDir, "00-README.md"), "00-README.md");
  const others: LegacyFile[] = [];
  // A spec file the tracker refuses is no spec, so it is listed with the other files.
  walk(root, milestoneDir, "", 0, others, (name) => name === "00-README.md" || specFiles.has(name));
  const roots = [...new Set([trackerDir, root])];
  return { milestone, dir, readme, specs, others, worklogs: worklogsOf(root, milestone, dir, roots) };
}
