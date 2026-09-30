/**
 * `darius link [<dir>] [--force]` and `darius link --list`
 *
 * Records which checkout on THIS host holds a project. Run it inside a
 * checkout: darius walks up to the `.darius.toml`, reads the project from it,
 * and writes `<project> = "<checkout>"` to `~/.config/darius/links.toml`
 * (src/core/links.ts). From then on run-due starts claude there and the vigil
 * sweep runs Commands there (src/core/workdir.ts).
 *
 * It also appends one `project.linked{path}` ledger line, once per host and
 * path. Other hosts read it after a sync and know the project lives in a
 * checkout, so a host without one skips its work instead of running it in
 * the wrong dir.
 *
 * A project already linked to another dir that still exists is refused
 * unless `--force`. Exit codes: 0 linked or unchanged, 1 refused, 2 usage
 * (no `.darius.toml` found).
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { appendLine, defaultWho, hostId, readLedger } from "../core/ledger.ts";
import { linksFile, readLinks, writeLink } from "../core/links.ts";
import { findMarker, readMarker, MARKER_FILE } from "../core/marker.ts";
import { openProject, type Project } from "../core/store.ts";
import { LINKED_LINE } from "../core/workdir.ts";
import { errorMessage } from "../runtime.ts";
import { UsageError, type Command, type ParsedArgs } from "./registry.ts";

const USAGE = "usage: darius link [<dir>] [--force] | darius link --list";

interface LinkResult {
  project: string;
  dir: string;
  outcome: "linked" | "unchanged";
  /** A `project.linked` line was appended. */
  recorded: boolean;
  replaced?: string;
}

interface ListedLink {
  project: string;
  dir: string;
  /** "ok", "missing" (the dir is gone), or what is wrong with its marker. */
  state: string;
}

function linkState(project: string, dir: string): string {
  if (!existsSync(dir)) return "missing";
  try {
    const marker = readMarker(dir);
    if (marker === null) return `no ${MARKER_FILE}`;
    return marker.project === project ? "ok" : `${MARKER_FILE} names ${marker.project}`;
  } catch (cause) {
    return errorMessage(cause);
  }
}

function runList(args: ParsedArgs): number {
  const links: ListedLink[] = [...readLinks().entries()].map(([project, dir]) => ({
    project,
    dir,
    state: linkState(project, dir),
  }));
  if (args.json) {
    console.log(JSON.stringify({ file: linksFile(), links }));
    return 0;
  }
  if (links.length === 0) console.log(`no links on this host (${linksFile()})`);
  for (const link of links) console.log(`${link.project.padEnd(28)} ${link.dir}${link.state === "ok" ? "" : `  (${link.state})`}`);
  return 0;
}

/** True when this host's latest `project.linked` line already names `dir`. */
function isRecorded(project: Project, dir: string): boolean {
  const host = hostId();
  const latest = readLedger(project).findLast((line) => line.type === LINKED_LINE && line.host === host);
  return latest?.path === dir;
}

function runLink(args: ParsedArgs): number {
  const [target, ...extra] = args.positional;
  if (extra.length > 0) throw new UsageError(USAGE);
  const start = resolve(target ?? process.cwd());
  const marker = findMarker(start);
  if (marker === null) {
    throw new UsageError(
      `no ${MARKER_FILE} in ${start} or above it. Commit one at the repo root first:\n` +
        `  v = 1\n  project = "<name>"`,
    );
  }
  const { project: name, dir } = marker;
  const old = readLinks().get(name);
  if (old !== undefined && old !== dir && existsSync(old) && args.flags.force !== true) {
    throw new Error(`${name} is already linked to ${old} on this host. Pass --force to link ${dir} instead.`);
  }
  if (old !== dir) writeLink(name, dir);
  const project = openProject(name, { create: true });
  const isNewLine = !isRecorded(project, dir);
  if (isNewLine) appendLine(project, { who: defaultWho(), type: LINKED_LINE, path: dir });

  const outcome = old === dir ? "unchanged" : "linked";
  if (args.json) {
    const result: LinkResult = { project: name, dir, outcome, recorded: isNewLine };
    if (old !== undefined && old !== dir) result.replaced = old;
    console.log(JSON.stringify(result));
    return 0;
  }
  if (outcome === "unchanged") console.log(`· ${name} is linked to ${dir}`);
  else console.log(`✓ linked ${name} to ${dir}${old === undefined ? "" : ` (was ${old})`}`);
  return 0;
}

export const linkCommand: Command = {
  name: "link",
  summary: "record which checkout on this host holds a project; run it inside the checkout. --force, --list",
  async run(args: ParsedArgs): Promise<number> {
    return args.flags.list === true ? runList(args) : runLink(args);
  },
};
