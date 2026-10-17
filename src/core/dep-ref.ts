/**
 * Short forms of a `depends_on` entry, both naming a sibling spec of the same
 * milestone: a bare spec number such as `02` names the spec whose file name
 * starts with `02-`, and a sibling stem such as `02-name` names `02-name.md`.
 * Every other entry (a file name, a tracker-relative path, a `.tracker/` path)
 * stays as written.
 *
 * `src/legacy/lib/dep-ref.ts` holds the same two functions: `src/legacy/` and `src/core/` are
 * separate programs (own tsconfig), so neither imports the other. Change both together.
 */

const BARE_NUMBER = /^\d+$/u;
const SIBLING_STEM = /^\d+-.+$/u;

/** True when `dep` is a sibling file name without `.md`, `01-one-new-sheet`. */
function isSiblingStem(dep: string): boolean {
  return !dep.includes("/") && !dep.endsWith(".md") && SIBLING_STEM.test(dep);
}

/** True when `dep` is a short form: a bare spec number (`02` or `2`) or a sibling stem (`02-name`). */
export function isShortSpecRef(dep: string): boolean {
  const trimmed = dep.trim();
  return BARE_NUMBER.test(trimmed) || isSiblingStem(trimmed);
}

/**
 * The file name that `dep` names among `siblingFiles`, the spec files of one
 * milestone. A bare number matches the one file that carries it. A sibling stem
 * matches the file `<stem>.md`. Returns `dep` unchanged when it is not a short
 * form, or when no file (or, for a number, more than one file) matches. The
 * caller then reports it as missing, as it does for any other unknown entry.
 */
export function expandShortSpecRef(dep: string, siblingFiles: readonly string[]): string {
  const trimmed = dep.trim();
  if (isSiblingStem(trimmed)) return siblingFiles.includes(`${trimmed}.md`) ? `${trimmed}.md` : dep;
  if (!BARE_NUMBER.test(trimmed)) return dep;
  const wanted = Number.parseInt(trimmed, 10);
  const matches = siblingFiles.filter((file) => {
    const prefix = /^(\d+)-/u.exec(file)?.[1];
    return prefix !== undefined && Number.parseInt(prefix, 10) === wanted;
  });
  return matches.length === 1 ? (matches[0] ?? dep) : dep;
}
