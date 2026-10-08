/**
 * Which code writes each kind, and so which code answers each verb.
 *
 * darius is the one tracker CLI. A kind the project owns lives in the darius
 * store and is written by darius's own code only. Every other kind lives in
 * the project's `.tracker/` and is written by the vendored legacy CLI
 * (`src/legacy/`) only (docs/concept.md, "Migration plan").
 *
 * Ownership is per project. The repo marker's root key `kinds` names the
 * kinds the store owns (src/core/marker.ts); `DEFAULT_KINDS` holds when the
 * marker has no `kinds`, or there is no marker. So the route reads the
 * marker of the repo, not only the command line: src/cli.ts resolves the
 * owned set (`ownedKinds` in src/core/paths.ts) and passes it to `routeVerb`.
 * `routeVerb` itself is pure: the verb, the subverb and the owned set are
 * the whole decision.
 */

/** The kinds that have a darius verb. */
export type Kind = "ritual" | "vigil";

/**
 * A kind the store can own, as the marker's `kinds` names it. `vigil` means
 * the store owns this project's vigils. `milestone` means the store owns the
 * whole tracker tree: milestones, specs, worklogs and the archive.
 */
export type OwnedKind = "ritual" | "vigil" | "milestone";

/** The kinds the store owns in a project whose marker has no `kinds`. */
export const DEFAULT_KINDS: ReadonlySet<OwnedKind> = new Set<OwnedKind>(["ritual"]);

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

/**
 * The verbs darius does not own: each one goes to the vendored legacy CLI.
 * `root` is listed for the verb tables but answered natively since 0.77.0
 * (src/cli/root.ts): `--json` reports the mode and creates a missing store link.
 */
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
  "hook-stop",
  "hook-drift",
  "delegation",
  "doctor",
  "migrate",
  "scan",
  "vigil",
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
 * A verb of a kind the project does not own (`vigil` without `vigil` in
 * `owned`) goes to the legacy writer even when darius registers the verb
 * too, so each kind keeps exactly one writer. Otherwise the darius registry
 * wins, then `LEGACY_VERBS`. A verb in `LEGACY_VERBS` with no kind (status,
 * list, show, ...) goes to legacy for every `owned`.
 */
export function routeVerb(
  verb: string,
  subverb: string | undefined,
  isRegistered: (name: string) => boolean,
  owned: ReadonlySet<OwnedKind>,
): "darius" | "legacy" | "unknown" {
  const kind = kindOfVerb(verb);
  if (kind !== null && !owned.has(kind) && LEGACY_VERBS.has(verb)) {
    const nativeSubverbs: readonly string[] = NATIVE_SUBVERBS[kind];
    const native = subverb !== undefined && nativeSubverbs.includes(subverb);
    if (!native) return "legacy";
  }
  if (isRegistered(verb)) return "darius";
  if (LEGACY_VERBS.has(verb)) return "legacy";
  return "unknown";
}
