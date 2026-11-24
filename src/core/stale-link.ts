/**
 * The doctor warning for a link that no longer names the real checkout
 * (0.138.0). A checkout moves, and the old path becomes a symlink to the new
 * one. `darius link --list` keeps the old path, and run-due and the vigil
 * sweep keep using it. The warning names the fix: `darius link --force` run
 * in the real checkout path.
 */

import { lstatSync, realpathSync } from "node:fs";

import { readLinks } from "./links.ts";
import { findMarker } from "./marker.ts";
import { resolveProject } from "./paths.ts";

function realOf(path: string): string | null {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
}

function isSymlink(path: string): boolean {
  return lstatSync(path, { throwIfNoEntry: false })?.isSymbolicLink() === true;
}

/** The checkout `cwd` is in for `project`: its real path, or null when `cwd` is in no checkout of that project. */
function hereReal(project: string, cwd: string): string | null {
  try {
    const marker = findMarker(cwd);
    return marker !== null && marker.project === project ? realOf(marker.dir) : null;
  } catch {
    return null;
  }
}

/**
 * One WARN line when the link of the project at `cwd` on this host is stale,
 * else null. Stale means: the linked path is a symlink, or its real path
 * differs from it, or the checkout `cwd` is in has another real path than the
 * linked one (or the linked path is gone).
 */
export function staleLinkLine(cwd: string): string | null {
  let project: string;
  let recorded: string | undefined;
  try {
    project = resolveProject(undefined, cwd);
    recorded = readLinks().get(project);
  } catch {
    return null;
  }
  if (recorded === undefined) return null;
  const linkedReal = realOf(recorded);
  const here = hereReal(project, cwd);
  if (linkedReal !== null && (isSymlink(recorded) || linkedReal !== recorded)) {
    const fixIn = here ?? linkedReal;
    return `WARN: the link of ${project} on this host is ${recorded}, and its real path is ${linkedReal}. Run darius link --force in the real checkout path (${fixIn}), so the link names it.`;
  }
  if (here !== null && here !== (linkedReal ?? recorded)) {
    const state = linkedReal === null ? `${recorded}, which does not exist` : recorded;
    return `WARN: this checkout of ${project} is ${here}, but the link on this host is ${state}. run-due and the vigil sweep use the link. Run darius link --force in ${here}.`;
  }
  return null;
}
