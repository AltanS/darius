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
  initTracker(opts: { projectRoot: string }): void;
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
