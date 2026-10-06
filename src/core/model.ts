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
  /** "deny" (0.66.0): a hold-list match refuses the one call and the run goes on. Absent: it holds the run. */
  on_hold?: "deny";
  /**
   * Rules a follow-up run of the ritual may use on top of `may` (0.69.0).
   * Merged into `may` only in a follow-up's run files, never in a scheduled
   * run. `hold` still wins over them. Absent when empty.
   */
  follow_up_may?: string[];
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
  /**
   * `"repo"` when the git-owned fields below and in `policy` mirror a
   * `[rituals.<slug>]` table of the marker (docs/concept.md, "Marker v3").
   * Absent: a store ritual. Reconcile writes it; no verb does.
   */
  source?: "repo";
  /** The mirrored schedule of a repo ritual: `HH:MM`, an IANA zone, a `YYYY-MM-DD` grid origin. */
  at?: string;
  tz?: string;
  from?: string;
  /** The mirrored input for the skill (`args` in the marker): one line, passed on in the run prompt. */
  args?: string;
  /** The mirrored per-run budget, as written: `30m`, `2h`. */
  timeout?: string;
  /**
   * `follow_up = "headless"` in the marker (0.69.0): a follow-up of this
   * ritual runs headless, without herdr. Absent: attended, in a herdr tab.
   */
  follow_up?: "headless";
  /** `definitionHash` of the mirrored definition. */
  def_hash?: string;
  /** The short commit of the checkout that reconcile read; absent outside git. */
  def_commit?: string;
  /** `.darius.toml` had uncommitted changes when reconcile read it. */
  def_dirty?: boolean;
  /** The host that reconciled, and when (ISO instant). */
  def_host?: string;
  def_at?: string;
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
