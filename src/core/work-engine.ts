/**
 * What `darius work plan|verify|commit-check` (0.102.0) needs from the rest
 * of darius: a way to run a darius verb as a child process, and the read-only
 * parts of the vendored legacy engine.
 *
 * Writes go through child processes, never in-process calls. A legacy verb
 * that writes the tracker tree runs inside the router's store handling: in
 * store mode the router syncs the tree before the verb and records the change
 * after it (src/cli.ts, `runLegacyVerb`). Many legacy verbs also print their
 * own lines and end the process with `process.exit`. A child keeps all of
 * that as it is, and each step leaves the same trace as the verb typed by
 * hand (docs/concept.md, "Work verbs").
 *
 * Reads that need no sync (the spec text, the worklog parse, the ledger, a
 * file scan, git status) load the vendored modules in-process, the way
 * src/core/legacy-entry.ts and src/core/spec-check.ts already do.
 */

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/** The darius entry file this process runs: the child gets the same one. */
const CLI_ENTRY = fileURLToPath(new URL("../cli.ts", import.meta.url));

/** One finished child: its exit code and both streams. */
export interface ChildRun {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Runs `darius <argv>` as a child, with the same runtime, its flags and this
 * process's env and cwd. The child's router resolves the tracker tree again
 * and sets the engine env itself.
 */
export function runDarius(argv: readonly string[]): ChildRun {
  const result = spawnSync(process.execPath, [...process.execArgv, CLI_ENTRY, ...argv], {
    cwd: process.cwd(),
    env: process.env,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error !== undefined) {
    return { code: 3, stdout: "", stderr: `cannot start darius ${argv[0] ?? ""}: ${result.error.message}` };
  }
  return { code: result.status ?? 1, stdout: result.stdout, stderr: result.stderr };
}

/** The first line of a child's stderr without the `darius ` prefix, or a fallback. */
export function firstLine(text: string, fallback = "no message"): string {
  const line = text
    .split("\n")
    .map((part) => part.trim())
    .find((part) => part !== "");
  return line === undefined ? fallback : line.replace(/^darius:?\s*/u, "");
}

/** `text` cut to `max` characters, with an ellipsis when it was longer. */
export function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/gu, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 3)}...`;
}

// ---------------------------------------------------------------------------
// Read-only legacy modules
// ---------------------------------------------------------------------------

/** A worklog entry as the legacy parser returns it (the fields read here). */
export interface LegacyEntry {
  kind: "note" | "artifact" | "blocker";
  text?: string;
  path?: string;
  timestamp: string;
}

/** A parsed worklog thread (the fields read here). */
export interface LegacyWorklogThread {
  threadId: string;
  entries: LegacyEntry[];
}

/** One worklog file and its parse. */
export interface LegacyWorklogScan {
  file: string;
  doc: { threads: LegacyWorklogThread[] };
}

/** One line of `.verification-log.jsonl` (the fields read here). */
export interface LegacyLedgerLine {
  spec: string;
  index: number;
  outcome: string;
  at: string;
  evidence?: string;
  override?: string;
}

/** One scan hit: a debug artifact or a stub. */
export interface LegacyScanMatch {
  file: string;
  line: number;
  pattern: string;
  text: string;
}

/** The read-only legacy functions the work verbs use. */
export interface WorkLegacy {
  scanWorklogDir(trackerRoot: string, milestoneSlug?: string): LegacyWorklogScan[];
  readLedger(trackerRoot: string): LegacyLedgerLine[];
  toLedgerSpecPath(trackerRoot: string, specPath: string): string;
  artifactPathsOf(texts: readonly string[], projectRoot: string): string[];
  dirtyArtifacts(cwd: string, artifacts: readonly string[]): string[] | null;
  scanArtifacts(opts: { path: string }): LegacyScanMatch[];
  scanStubs(opts: { path: string }): LegacyScanMatch[];
}

const VENDORED = {
  worklog: new URL("../legacy/lib/worklog.ts", import.meta.url),
  ledger: new URL("../legacy/lib/verification/ledger.ts", import.meta.url),
  artifacts: new URL("../legacy/lib/artifact-paths.ts", import.meta.url),
  evidence: new URL("../legacy/lib/stage-evidence.ts", import.meta.url),
  scan: new URL("../legacy/lib/scan.ts", import.meta.url),
};

/** Loads the vendored read-only helpers once per call; each is checked before use. */
export async function loadWorkLegacy(): Promise<WorkLegacy> {
  // SAFETY: darius's own vendored modules; every function is checked below before it is used.
  const worklog = (await import(VENDORED.worklog.href)) as Partial<Pick<WorkLegacy, "scanWorklogDir">>;
  // SAFETY: as above.
  const ledger = (await import(VENDORED.ledger.href)) as Partial<Pick<WorkLegacy, "readLedger" | "toLedgerSpecPath">>;
  // SAFETY: as above.
  const artifacts = (await import(VENDORED.artifacts.href)) as Partial<Pick<WorkLegacy, "artifactPathsOf">>;
  // SAFETY: as above.
  const evidence = (await import(VENDORED.evidence.href)) as Partial<Pick<WorkLegacy, "dirtyArtifacts">>;
  // SAFETY: as above.
  const scan = (await import(VENDORED.scan.href)) as Partial<Pick<WorkLegacy, "scanArtifacts" | "scanStubs">>;
  const { scanWorklogDir } = worklog;
  const { readLedger, toLedgerSpecPath } = ledger;
  const { artifactPathsOf } = artifacts;
  const { dirtyArtifacts } = evidence;
  const { scanArtifacts, scanStubs } = scan;
  if (
    scanWorklogDir === undefined ||
    readLedger === undefined ||
    toLedgerSpecPath === undefined ||
    artifactPathsOf === undefined ||
    dirtyArtifacts === undefined ||
    scanArtifacts === undefined ||
    scanStubs === undefined
  ) {
    throw new Error("the vendored legacy modules are missing an export the work verbs need");
  }
  return { scanWorklogDir, readLedger, toLedgerSpecPath, artifactPathsOf, dirtyArtifacts, scanArtifacts, scanStubs };
}

/** The text of the newest note of a thread, or null. */
export function lastNote(thread: LegacyWorklogThread): string | null {
  for (let at = thread.entries.length - 1; at >= 0; at -= 1) {
    const entry = thread.entries[at];
    if (entry?.kind === "note" && entry.text !== undefined && entry.text.trim() !== "") return entry.text;
  }
  return null;
}

/** True when a ledger line earned a tick: a pass, or a manual line with evidence (stage-evidence.ts). */
export function isPassingLine(line: LegacyLedgerLine): boolean {
  if (line.outcome === "pass") return true;
  const evidence = (line.evidence ?? "").trim() !== "";
  if (line.outcome === "manual") return evidence;
  if (line.outcome === "manual-override") return evidence && (line.override ?? "").trim() !== "";
  return false;
}
