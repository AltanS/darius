/**
 * Short form of a `depends_on` entry: a bare spec number such as `02` names the
 * spec in the same milestone whose file name starts with `02-`. Every other
 * entry (a file name, a tracker-relative path, a `.tracker/` path) stays as written.
 *
 * `src/core/dep-ref.ts` holds the same two functions: `src/legacy/` and `src/core/` are
 * separate programs (own tsconfig), so neither imports the other. Change both together.
 */

const BARE_NUMBER = /^\d+$/u;

/** True when `dep` is a bare spec number, `02` or `2`. */
export function isBareSpecNumber(dep: string): boolean {
  return BARE_NUMBER.test(dep.trim());
}

/**
 * The file name that `dep` names among `siblingFiles`, the spec files of one
 * milestone. Returns `dep` unchanged when it is not a bare number, or when no
 * file or more than one file carries that number. The caller then reports it
 * as missing, as it does for any other unknown entry.
 */
export function expandBareSpecNumber(dep: string, siblingFiles: readonly string[]): string {
  const trimmed = dep.trim();
  if (!BARE_NUMBER.test(trimmed)) return dep;
  const wanted = Number.parseInt(trimmed, 10);
  const matches = siblingFiles.filter((file) => {
    const prefix = /^(\d+)-/u.exec(file)?.[1];
    return prefix !== undefined && Number.parseInt(prefix, 10) === wanted;
  });
  return matches.length === 1 ? (matches[0] ?? dep) : dep;
}
