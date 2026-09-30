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
