/**
 * Which code writes each kind, and so which code answers each verb.
 *
 * darius is the one tracker CLI. A kind in `DARIUS_KINDS` lives in the darius
 * store and is written by darius's own code only. Every other kind lives in a
 * project's `.tracker/` and is written by the vendored legacy CLI
 * (`src/legacy/`) only. Moving a kind into the store is one edit here plus an
 * import, never a change to a caller (docs/concept.md, "Migration plan").
 *
 * The rule is context free: it reads the command line only, never the cwd,
 * the store or `.tracker/`. `routeVerb` is the whole decision.
 */

/** The kinds that have a darius verb. */
export type Kind = "ritual" | "vigil";

/** The kinds darius's store owns. `vigil` joins at migration phase 3. */
export const DARIUS_KINDS: ReadonlySet<Kind> = new Set<Kind>(["ritual"]);

/** The top-level verbs that act on one kind. A run belongs to a ritual. */
const KIND_OF_VERB = new Map<string, Kind>([
  ["ritual", "ritual"],
  ["run", "ritual"],
  ["vigil", "vigil"],
]);

/**
 * Subverbs of a legacy kind that stay native. `vigil sweep` is what the
 * daily timer runs; the legacy CLI has no `sweep`, and the sweep writes the
 * store only.
 */
const NATIVE_SUBVERBS = {
  ritual: [],
  vigil: ["sweep"],
} as const satisfies Record<Kind, readonly string[]>;

/** The verbs darius does not own: each one goes to the vendored legacy CLI. */
export const LEGACY_VERBS: ReadonlySet<string> = new Set([
  "root",
  "status",
  "list",
  "show",
  "next",
  "add",
  "mark",
  "set-status",
  "index",
  "verify",
  "verify-item",
  "archive-check",
  "uncommitted-verified",
  "agents",
  "counsel-gate",
  "worklog",
  "claim",
  "release",
  "loop-check",
  "doctor",
  "migrate",
  "scan",
  "vigil",
  "context",
]);

/** The kind a top-level verb acts on, or null for a verb of no kind. */
export function kindOfVerb(verb: string): Kind | null {
  return KIND_OF_VERB.get(verb) ?? null;
}

/**
 * Where a command line goes.
 *
 * - `darius`: a registered darius command.
 * - `legacy`: the vendored legacy CLI, with the whole argv.
 * - `unknown`: neither; a usage error.
 *
 * A verb of a kind outside `DARIUS_KINDS` goes to the legacy writer even when
 * darius registers the verb too, so each kind keeps exactly one writer.
 * Otherwise the darius registry wins, then `LEGACY_VERBS`.
 */
export function routeVerb(
  verb: string,
  subverb: string | undefined,
  isRegistered: (name: string) => boolean,
): "darius" | "legacy" | "unknown" {
  const kind = kindOfVerb(verb);
  if (kind !== null && !DARIUS_KINDS.has(kind) && LEGACY_VERBS.has(verb)) {
    const nativeSubverbs: readonly string[] = NATIVE_SUBVERBS[kind];
    const native = subverb !== undefined && nativeSubverbs.includes(subverb);
    if (!native) return "legacy";
  }
  if (isRegistered(verb)) return "darius";
  if (LEGACY_VERBS.has(verb)) return "legacy";
  return "unknown";
}
