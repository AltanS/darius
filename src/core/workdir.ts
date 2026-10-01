/**
 * Where a project's work runs on this host: the cwd of its vigil Commands
 * (src/core/sweep.ts) and of the claude sessions run-due starts
 * (src/runner/run-due.ts). In order:
 *
 *   1. The checkout `darius link` recorded in links.toml on this host.
 *   2. The repo an import came from (the parent of the `.tracker` dir on the
 *      latest `import` line), when that path exists on this host. This keeps a
 *      host that imported before `darius link` existed working unchanged.
 *   3. Nowhere, when another host linked or imported the project: its work
 *      needs a checkout this host does not have. Callers skip it here
 *      (`no-workdir`) instead of running repo-relative Commands in the wrong
 *      dir.
 *   4. The project's store dir, for a project with no repo at all (for
 *      example `darius-selftest`).
 *
 * The checkout's `.darius.toml` comes back with the dir, for `max_mode`. A
 * marker that names another project is an error: the link points at the
 * wrong repo.
 */

import { existsSync } from "node:fs";
import { dirname } from "node:path";

import { hostId } from "./ledger.ts";
import { linkedDir, linksFile } from "./links.ts";
import { readMarker, type Marker } from "./marker.ts";
import type { Document, JsonValue, LedgerLine, Ritual } from "./model.ts";
import type { Project } from "./store.ts";

/** The ledger line `darius link` appends: `{path}` on this host. */
export const LINKED_LINE = "project.linked";

export type Workdir =
  | { dir: string; from: "link" | "import" | "store"; marker: Marker | null }
  | { missing: string; detail: string };

function isText(value: JsonValue | undefined): value is string {
  return typeof value === "string" && value !== "";
}

function checkedMarker(project: Project, dir: string): Marker | null {
  const marker = readMarker(dir);
  if (marker !== null && marker.project !== project.name) {
    throw new Error(`${marker.file} names project "${marker.project}", but darius uses that dir for ${project.name}`);
  }
  return marker;
}

/** The repo of the latest import, from its `.tracker` source path. */
function importedRepo(ledger: readonly LedgerLine[]): string | undefined {
  const line = ledger.findLast((one) => one.type === "import" && isText(one.source));
  return line !== undefined && isText(line.source) ? dirname(line.source) : undefined;
}

function linkedElsewhere(ledger: readonly LedgerLine[]): LedgerLine | undefined {
  return ledger.findLast((one) => one.type === LINKED_LINE && isText(one.path));
}

export function projectWorkdir(project: Project, ledger: readonly LedgerLine[]): Workdir {
  const linked = linkedDir(project.name);
  if (linked !== undefined) {
    if (existsSync(linked)) return { dir: linked, from: "link", marker: checkedMarker(project, linked) };
    return {
      missing: linked,
      detail: `${linked}, linked in ${linksFile()}, is gone: run \`darius link\` in a checkout of ${project.name}`,
    };
  }
  const imported = importedRepo(ledger);
  if (imported !== undefined && existsSync(imported)) {
    return { dir: imported, from: "import", marker: checkedMarker(project, imported) };
  }
  const other = linkedElsewhere(ledger);
  const recorded = other !== undefined && isText(other.path) ? `${other.path} on ${other.host}` : imported;
  if (recorded !== undefined) {
    return {
      missing: recorded,
      detail: `${project.name} lives in a checkout (${recorded}) that is not on this host: run \`darius link\` inside one here`,
    };
  }
  return { dir: project.root, from: "store", marker: null };
}

/** The host a ritual's work belongs to, and why: its `host` pin, or the host that linked its checkout. */
export interface RitualHost {
  host: string;
  why: "pinned" | "linked";
}

/**
 * Where a ritual runs (docs/concept.md, "Host pin"; 0.50.0). There is no
 * control host: the answer is per ritual.
 *
 *   1. Its `host` pin, when it has one.
 *   2. This host, when the project has a checkout here: a link in
 *      links.toml, or the repo of its latest import.
 *   3. The host of the latest `project.linked` line from another host: the
 *      checkout is there.
 *   4. null: no pin and no checkout anywhere darius knows of. Any host may
 *      run it (a project with no repo runs in its store dir).
 *
 * `run now`, `run resume` and `run follow-up` refuse on another host and name
 * this one; the timer and the vigil sweep skip quietly instead.
 */
export function ritualHost(project: Project, ledger: readonly LedgerLine[], doc: Document<Ritual>): RitualHost | null {
  const pin = doc.header.host;
  if (pin !== undefined && pin !== "") return { host: pin, why: "pinned" };
  const here = hostId();
  const imported = importedRepo(ledger);
  if (linkedDir(project.name) !== undefined || (imported !== undefined && existsSync(imported))) return { host: here, why: "linked" };
  const other = ledger.findLast((one) => one.type === LINKED_LINE && isText(one.path) && one.host !== here);
  return other === undefined ? null : { host: other.host, why: "linked" };
}
