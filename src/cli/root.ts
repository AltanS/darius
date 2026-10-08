/**
 * `darius root [--json]`: where the tracker tree of this checkout is.
 *
 * Plain: the `.tracker` path on one line (exit 1 with no tracker here), the
 * answer the legacy `root` always gave.
 *
 * `--json` (0.77.0): `{ mode, trackerRoot, project, linked }`. It changes
 * nothing on disk.
 *
 *   mode         "store": the marker lists `milestone` in `kinds`, so the
 *                darius store owns the tracker tree. "git": a `.tracker/`
 *                folder in the checkout, kept in git. "none": neither.
 *   trackerRoot  the absolute path of the tracker tree: the store's working
 *                copy in store mode, the real `.tracker` folder in git mode,
 *                null in none mode. The same tree from every worktree.
 *   project      the marker's project name, or null without a marker.
 *   linked       a `.tracker` symlink exists in this checkout (the old
 *                access path, deprecated). It is information only.
 *
 * A skill calls it to detect the mode. The JSON form exits 0 for all three
 * modes: "none" is an answer, not a failure.
 */

import { lstatSync } from "node:fs";
import { join } from "node:path";

import { findMarker } from "../core/marker.ts";
import { findTrackerDir, projectDir } from "../core/paths.ts";
import { TRACKER_LINK, treeDir } from "../core/tree.ts";
import type { Command, ParsedArgs } from "./registry.ts";

interface RootReport {
  mode: "store" | "git" | "none";
  trackerRoot: string | null;
  project: string | null;
  linked: boolean;
}

function isSymlink(path: string): boolean {
  return lstatSync(path, { throwIfNoEntry: false })?.isSymbolicLink() === true;
}

/** The report for `cwd`. Reads only. */
export function rootReport(cwd: string): RootReport {
  const marker = findMarker(cwd);
  const project = marker === null ? null : marker.project;
  if (marker !== null && marker.kinds.includes("milestone")) {
    return { mode: "store", trackerRoot: treeDir({ root: projectDir(marker.project) }), project, linked: isSymlink(join(marker.dir, TRACKER_LINK)) };
  }
  const folder = findTrackerDir(cwd);
  if (folder === null) return { mode: "none", trackerRoot: null, project, linked: false };
  return { mode: "git", trackerRoot: folder, project, linked: isSymlink(folder) };
}

async function run(args: ParsedArgs): Promise<number> {
  if (args.positional.length > 0) {
    console.error("darius: root takes no argument");
    return 2;
  }
  const report = rootReport(process.cwd());
  if (args.json) {
    console.log(JSON.stringify(report));
    return 0;
  }
  if (report.trackerRoot === null) {
    console.error("darius: no .tracker/ directory found");
    return 1;
  }
  console.log(report.trackerRoot);
  return 0;
}

export const rootCommand: Command = {
  name: "root",
  help: "usage: darius root [--json]\nprint the tracker tree path of this checkout. --json: { mode: store|git|none, trackerRoot, project, linked }; it changes nothing on disk.",
  flags: [],
  summary: "print the tracker tree path; --json reports the mode (store, git, none) and the tree, and changes nothing",
  usage: "root [--json]",
  run,
};
