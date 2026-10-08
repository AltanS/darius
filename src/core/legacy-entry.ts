/**
 * The one door into the vendored legacy CLI (`src/legacy/bin/tracker.mts`).
 *
 * The import is dynamic, so a native verb never loads the legacy tree and
 * darius starts as fast as before. The specifier is a runtime value, so the
 * main typecheck does not follow it into `src/legacy/`, which has its own
 * tsconfig.
 *
 * `DARIUS_LEGACY_ENTRY` names another module with the same `main` export. It
 * is a test seam: a test points it at a fake, the way `DARIUS_HERDR` works.
 */

import { fileURLToPath, pathToFileURL } from "node:url";

import { errorMessage } from "../runtime.ts";

/** The vendored entry file, relative to this module. */
const VENDORED_ENTRY = new URL("../legacy/bin/tracker.mts", import.meta.url);

/** What the legacy entry file exports: one command line in, an exit code out. */
interface LegacyModule {
  main(argv: string[]): Promise<number>;
}

/** The legacy entry file this process loads. */
export function legacyEntryPath(): string {
  const override = process.env.DARIUS_LEGACY_ENTRY;
  if (override !== undefined && override !== "") return override;
  return fileURLToPath(VENDORED_ENTRY);
}

/**
 * Runs one legacy command line, verb first (`["vigil", "list", "--json"]`).
 * Output goes straight to stdout and stderr, and the exit code comes back
 * unchanged. A legacy verb that fails may call `process.exit` itself.
 */
export async function runLegacy(argv: string[]): Promise<number> {
  const path = legacyEntryPath();
  let loaded: Partial<LegacyModule>;
  try {
    // SAFETY: the entry file is darius's own vendored tree (or a test fake of
    // it); `main` is checked below before it is called.
    loaded = (await import(pathToFileURL(path).href)) as Partial<LegacyModule>;
  } catch (error) {
    throw new Error(`cannot load the legacy tracker CLI at ${path}: ${errorMessage(error)}`, { cause: error });
  }
  if (loaded.main === undefined) throw new Error(`the legacy tracker CLI at ${path} exports no main()`);
  return loaded.main(argv);
}

/** The vendored writer module: `initTracker` scaffolds `.tracker/00-INDEX.md`. */
const VENDORED_WRITER = new URL("../legacy/lib/tracker-writer.ts", import.meta.url);

/** What darius needs from the writer module. */
interface LegacyWriter {
  initTracker(opts: { projectRoot: string; trackerDir?: string }): void;
  rebuildIndex(trackerRoot: string): void;
}

/**
 * Scaffolds `<root>/.tracker/` through the vendored writer, the one writer of
 * `.tracker/` (docs/concept.md, "Risks"). Throws when `.tracker/` exists.
 */
export async function scaffoldTracker(root: string): Promise<void> {
  // SAFETY: darius's own vendored module; `initTracker` is checked before it is called.
  const loaded = (await import(VENDORED_WRITER.href)) as Partial<LegacyWriter>;
  if (loaded.initTracker === undefined) throw new Error(`the legacy tracker writer at ${fileURLToPath(VENDORED_WRITER)} exports no initTracker()`);
  loaded.initTracker({ projectRoot: root });
}

/**
 * Scaffolds the tracker tree in the store dir `tree` through the vendored
 * writer (0.78.0): only `00-INDEX.md`, nothing in the checkout `root`.
 * Throws when the tree already has an index.
 */
export async function scaffoldStoreTree(root: string, tree: string): Promise<void> {
  // SAFETY: darius's own vendored module; `initTracker` is checked before it is called.
  const loaded = (await import(VENDORED_WRITER.href)) as Partial<LegacyWriter>;
  if (loaded.initTracker === undefined) throw new Error(`the legacy tracker writer at ${fileURLToPath(VENDORED_WRITER)} exports no initTracker()`);
  loaded.initTracker({ projectRoot: root, trackerDir: tree });
}

/**
 * Rebuilds `<trackerRoot>/00-INDEX.md` through the vendored writer, the one
 * writer of that file (`tracker index --rebuild` without its stdout lines).
 * The writer prints nothing on stdout, so a verb's own output stays as it was.
 */
export async function rebuildTrackerIndex(trackerRoot: string): Promise<void> {
  // SAFETY: darius's own vendored module; `rebuildIndex` is checked before it is called.
  const loaded = (await import(VENDORED_WRITER.href)) as Partial<LegacyWriter>;
  if (loaded.rebuildIndex === undefined) throw new Error(`the legacy tracker writer at ${fileURLToPath(VENDORED_WRITER)} exports no rebuildIndex()`);
  loaded.rebuildIndex(trackerRoot);
}

/** The vendored worklog module: the one parser of worklog files. */
const VENDORED_WORKLOG = new URL("../legacy/lib/worklog.ts", import.meta.url);

/** A worklog thread as the legacy `worklog list --json` reports it (the fields darius reads). */
export interface LegacyThread {
  threadId: string;
  label: string;
  openedAt: string;
  closedAt?: string;
  closeStatus?: string;
  specPath?: string;
  /** The Work Loop stage (`planned` to `reviewed`); absent for a thread opened outside the loop. */
  stage?: string;
  worklogFile: string;
}

/** A worklog file and how it reads: `clean`, `legacy` or `distilled`. */
export interface LegacyWorklogFile {
  worklogFile: string;
  threadCount: number;
  state: string;
}

interface LegacyWorklog {
  listThreads(opts: { trackerRoot: string; activeOnly?: boolean }): LegacyThread[];
  listWorklogFiles(opts: { trackerRoot: string }): LegacyWorklogFile[];
  closeThread(opts: { worklogPath: string; threadId: string; status: "done" | "blocked" | "cancelled" }): void;
}

async function loadWorklog(): Promise<LegacyWorklog> {
  // SAFETY: darius's own vendored module; both functions are checked before use.
  const loaded = (await import(VENDORED_WORKLOG.href)) as Partial<LegacyWorklog>;
  if (loaded.listThreads === undefined || loaded.listWorklogFiles === undefined || loaded.closeThread === undefined) {
    throw new Error(`the legacy worklog module at ${fileURLToPath(VENDORED_WORKLOG)} exports no listThreads(), listWorklogFiles() or closeThread()`);
  }
  return { listThreads: loaded.listThreads, listWorklogFiles: loaded.listWorklogFiles, closeThread: loaded.closeThread };
}

/** Every open worklog thread under `trackerRoot`, read through the vendored parser. Reads only. */
export async function openWorklogThreads(trackerRoot: string): Promise<LegacyThread[]> {
  return (await loadWorklog()).listThreads({ trackerRoot, activeOnly: true });
}

/** Every worklog file under `trackerRoot` with its state, read through the vendored parser. Reads only. */
export async function worklogFiles(trackerRoot: string): Promise<LegacyWorklogFile[]> {
  return (await loadWorklog()).listWorklogFiles({ trackerRoot });
}

/**
 * Closes one worklog thread as `done` through the vendored writer, the way
 * `darius worklog close <id> --status done` does. `worklogPath` is the file
 * under the tracker tree. Throws when the thread is not in the file.
 */
export async function closeWorklogThreadDone(worklogPath: string, threadId: string): Promise<void> {
  (await loadWorklog()).closeThread({ worklogPath, threadId, status: "done" });
}

/** One checklist item of a spec as the vendored parser reads it. */
export interface LegacyChecklistItem {
  /** Zero-based, the index `darius mark` and `darius verify-item` take. */
  index: number;
  label: string;
  state: "pending" | "in_progress" | "verified" | "skipped" | "blocked";
}

const VENDORED_CHECKLIST = new URL("../legacy/lib/markdown/checklist.ts", import.meta.url);
const VENDORED_FRONTMATTER = new URL("../legacy/lib/markdown/frontmatter.ts", import.meta.url);

/** The checklist items of a spec file's text, read through the vendored parser. Reads only. */
export async function checklistItems(specText: string): Promise<LegacyChecklistItem[]> {
  // SAFETY: darius's own vendored modules; both functions are checked before use.
  const checklist = (await import(VENDORED_CHECKLIST.href)) as { parseChecklist?: (content: string) => LegacyChecklistItem[] };
  // SAFETY: as above.
  const frontmatter = (await import(VENDORED_FRONTMATTER.href)) as { parseFrontmatter?: (raw: string) => { content: string } };
  if (checklist.parseChecklist === undefined || frontmatter.parseFrontmatter === undefined) {
    throw new Error("the legacy checklist parser is missing parseChecklist() or parseFrontmatter()");
  }
  return checklist.parseChecklist(frontmatter.parseFrontmatter(specText).content);
}
