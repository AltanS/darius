/**
 * The domain model every other module reads and writes: item headers
 * (ritual, vigil), the append-only ledger line shape, and the one error
 * type a command throws to mean "the caller invoked this wrong."
 *
 * Kept intentionally thin. Status is never stored here: due dates, run
 * state and vigil verdicts are computed from ledger lines elsewhere
 * (docs/concept.md, "Domain model": "Store facts, compute status").
 */

export type Kind = "ritual" | "vigil" | "profile";

export interface ItemHeader {
  id: string;
  kind: Kind;
  slug: string;
  title: string;
  created: string;
  updated: string;
  tags: string[];
  imported_from?: string;
}

export interface Policy {
  mode: "off" | "report" | "act";
  may: string[];
  hold: string[];
  notes?: string;
  model?: string;
  max_turns?: number;
  /** A harness profile by name (docs/concept.md, "Profiles"). */
  profile?: string;
}

export interface Ritual extends ItemHeader {
  kind: "ritual";
  cadence?: string;
  anchor: "due" | "completion";
  agent?: string;
  owner?: string;
  /**
   * A skill of the project's repo this ritual invokes (docs/concept.md,
   * "Djinns"). The checkout supplies the skill; the prompt names it.
   */
  skill?: string;
  /**
   * The one host whose runner may start this ritual (docs/concept.md,
   * "Unattended runner" > "Host pin"). It lives in the store item, never in
   * the repo: decision 9 keeps host names out of git.
   */
  host?: string;
  policy: Policy;
}

export interface Vigil extends ItemHeader {
  kind: "vigil";
  from?: string;
  due?: string;
  until?: string;
  gate_command?: string;
  heavy: boolean;
  agent?: string;
}

/**
 * A named preset for starting a harness (docs/concept.md, "Harnesses,
 * profiles and surfaces" > "Profiles"). Store-wide profiles live in the
 * reserved `_global` project; a repo's `.darius.toml` may override them.
 */
export interface Profile extends ItemHeader, ProfileFields {
  kind: "profile";
}

/** What a profile sets. Every field is optional: resolution fills the gaps field by field. */
export interface ProfileFields {
  harness?: string;
  model?: string;
  effort?: string;
  permissions?: "gated" | "skip";
  surface?: "headless" | "herdr";
  max_turns?: number;
  args?: string[];
}

export type Item = Ritual | Vigil | Profile;

export interface Document<T extends Item = Item> {
  header: T;
  body: string;
}

/**
 * A JSON value with no unsafe escape hatch. A ledger line is, per
 * docs/plan-tonight.md's "Ledger line" section, literally "one JSON object
 * per line" — this is that object's value type.
 */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

/**
 * One line of an append-only, per-host ledger file. The eight named fields
 * are on every line (docs/plan-tonight.md, "Ledger line"); everything else
 * is the payload for `type`, for example `run.held`'s `questions`.
 *
 * DEVIATION from the module contract in docs/plan-tonight.md, which spells
 * the index signature `[k: string]: unknown`: `unknown` as a dictionary's
 * value type is exactly what the vendored oxlint rule
 * `anti-slop/no-unsafe-dictionary-type` exists to catch, and it reports on
 * this exact shape. `JsonValue` carries the same "any extra field" intent
 * the contract wants, with a value contract a caller can actually switch
 * on instead of casting away.
 */
export interface LedgerLine {
  v: 1;
  id: string;
  at: string;
  host: string;
  who: string;
  project: string;
  type: string;
  item?: string;
  [k: string]: JsonValue | undefined;
}

/**
 * The caller invoked darius wrong: an unresolvable project, a missing
 * required flag, a malformed argument. `src/cli.ts` maps this to exit code
 * 2, the probe contract's "usage" (never 1, "refused or failed").
 */
export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}
