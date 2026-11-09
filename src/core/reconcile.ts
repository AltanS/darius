/**
 * Reconcile (docs/architecture/marker-v3.md, section 4): a v3 marker's
 * `[rituals.<slug>]` tables, mirrored into the project's store.
 *
 * The store item of a repo ritual is a mirror of git plus the store-owned
 * fields (host, owner, agent, tags, created, imported_from). Reconcile is the
 * only writer of the git-owned fields, `source` and the `def_*` keys.
 *
 *   reconcileProject(project, checkout, host, now): ReconcileResult
 *       1. read the marker; a parse error returns `marker: "invalid"` and
 *          writes nothing; a v1 or v2 marker returns `marker: "v2"`.
 *       2. read the checkout's commit and whether `.darius.toml` is dirty.
 *       3. under the project lock: adopt, update or leave each repo ritual;
 *          retire a repo item the marker no longer names; list a store
 *          ritual the marker does not name as `unmanaged`.
 *       4. one `ritual.defined` ledger line per adopted, updated or retired slug.
 *
 * Hosts may hold different checkouts (section 4.3). Each written item gets
 * `updated = now`, so the bucket's last-writer-wins sync keeps the newest
 * reconcile. An item is rewritten only when its hash, commit or dirty flag
 * differs from this checkout's, so two hosts on the same commit write once.
 * Until 0.129.0 a host on an older commit wrote its older marker back, and
 * retired what the newer host had adopted; the guard below stops that.
 *
 * It never decides whether a run may start. The caller judges `ok`, `marker`,
 * `dirty` and `stale` (sections 4.4 to 4.6).
 *
 * The guard (0.129.0, src/core/reconcile-guard.ts) runs before step 3: a
 * checkout older than the commit of the newest `ritual.defined` line, from
 * any host, writes nothing and returns `stale`. Each line now also carries
 * `marker_hash`, the sha256 of the marker file. `force` (only `darius ritual
 * reconcile --force`, a person's verb) skips the guard.
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { ritualLifecycle } from "./due.ts";
import { appendLines, defaultWho, readLedger, type LedgerLineInput } from "./ledger.ts";
import { definitionHash, MARKER_FILE, readMarker, type Marker, type RepoRitual } from "./marker.ts";
import type { Document, LedgerLine, Policy, Ritual } from "./model.ts";
import { commitRelation, decideReconcile, headFacts, latestRecord, markerHash, staleLine, writeStaleRecord, type GuardDecision, type StaleMarker } from "./reconcile-guard.ts";
import { itemRef, type Project } from "./store.ts";
import { parseToml, type TomlValue } from "./toml.ts";
import { ulid } from "./ulid.ts";
import { errorMessage } from "../runtime.ts";

export interface ReconcileResult {
  /** False only when the marker is invalid. */
  ok: boolean;
  marker: "v2" | "v3" | "invalid";
  /** The parse error with `file:line`, when `marker` is `"invalid"`. */
  error?: string;
  /** `git rev-parse --short=12 HEAD` of the checkout; absent outside git. */
  commit?: string;
  /** `.darius.toml` has uncommitted changes. False outside git. */
  dirty: boolean;
  adopted: string[];
  updated: string[];
  unchanged: string[];
  retired: string[];
  unmanaged: string[];
  /** Things the operator should know: a retired ritual named again in the marker, a guard that could not judge the checkout. */
  warnings: string[];
  /**
   * The checkout is older than the marker the store holds, or off its
   * history (0.129.0): nothing was written. `line` is what the report says.
   */
  stale?: StaleMarker & { line: string };
}

/** The `change` of a `ritual.defined` ledger line. */
export type DefinitionChange = "adopted" | "updated" | "retired";

/** The ledger line type reconcile appends per changed slug. */
export const RITUAL_DEFINED = "ritual.defined";

const SHORT_COMMIT = "--short=12";
const MINUTES_PER_HOUR = 60;
const MS_PER_MINUTE = 60_000;

/**
 * The definition the store mirrors: the ritual with its zone resolved (its
 * own `tz`, else the marker's root `tz`). A v3 ritual always has a zone.
 */
export function mirrorDefinition(marker: Marker, ritual: RepoRitual): RepoRitual {
  const zone = ritual.tz ?? marker.tz;
  const policy = { ...ritual.policy, may: [...ritual.policy.may], hold: [...ritual.policy.hold] };
  if (ritual.policy.follow_up_may !== undefined) policy.follow_up_may = [...ritual.policy.follow_up_may];
  const resolved: RepoRitual = { ...ritual, policy };
  if (zone !== undefined) resolved.tz = zone;
  return resolved;
}

/** `def_hash` of a ritual as reconcile writes it: the hash of its mirrored definition. */
export function mirrorHash(marker: Marker, ritual: RepoRitual): string {
  return definitionHash(mirrorDefinition(marker, ritual));
}

function git(checkout: string, args: readonly string[]): string | undefined {
  const result = spawnSync("git", args, { cwd: checkout, encoding: "utf8", timeout: 10_000 });
  if (result.error !== undefined || result.status !== 0) return undefined;
  return result.stdout;
}

/** `git rev-parse --short=12 HEAD` in `checkout`, or undefined (no git, not a repo, no commit). */
export function checkoutCommit(checkout: string): string | undefined {
  const out = git(checkout, ["rev-parse", SHORT_COMMIT, "HEAD"])?.trim();
  return out === undefined || out === "" ? undefined : out;
}

/** True when `git status --porcelain -- .darius.toml` prints anything. False when git fails. */
export function markerDirty(checkout: string): boolean {
  const out = git(checkout, ["status", "--porcelain", "--", MARKER_FILE]);
  return out !== undefined && out.trim() !== "";
}

/** A skill's folder in a checkout, as git sees it: `.claude/skills/<skill>/`. */
export function skillFolder(skill: string): string {
  return `.claude/skills/${skill}/`;
}

/**
 * True when `git status --porcelain -- .claude/skills/<skill>/` prints
 * anything: a modified or an untracked file. False when git fails, as for
 * `markerDirty`. A skill is config, so only a committed one runs unattended.
 */
export function skillDirty(checkout: string, skill: string): boolean {
  const out = git(checkout, ["status", "--porcelain", "--", skillFolder(skill)]);
  return out !== undefined && out.trim() !== "";
}

function isText(value: TomlValue | undefined): value is string {
  return typeof value === "string";
}

/** The `timeout` text of each ritual table as written in the file, by slug. */
function writtenTimeouts(marker: Marker): Map<string, string> {
  const found = new Map<string, string>();
  const { sections } = parseToml(readFileSync(marker.file, "utf8"), marker.file);
  for (const ritual of marker.rituals) {
    const text = sections[`rituals.${ritual.slug}`]?.timeout;
    if (isText(text)) found.set(ritual.slug, text);
  }
  return found;
}

/** `30m` or `2h` from milliseconds: whole hours as `h`, else minutes. */
function timeoutText(ms: number): string {
  const minutes = Math.round(ms / MS_PER_MINUTE);
  return minutes % MINUTES_PER_HOUR === 0 ? `${String(minutes / MINUTES_PER_HOUR)}h` : `${String(minutes)}m`;
}

function mirroredPolicy(ritual: RepoRitual): Policy {
  const policy: Policy = { mode: ritual.policy.mode, may: [...ritual.policy.may], hold: [...ritual.policy.hold] };
  if (ritual.policy.notes !== undefined) policy.notes = ritual.policy.notes;
  if (ritual.policy.on_hold !== undefined) policy.on_hold = ritual.policy.on_hold;
  if (ritual.policy.follow_up_may !== undefined) policy.follow_up_may = [...ritual.policy.follow_up_may];
  if (ritual.model !== undefined) policy.model = ritual.model;
  if (ritual.maxTurns !== undefined) policy.max_turns = ritual.maxTurns;
  if (ritual.profile !== undefined) policy.profile = ritual.profile;
  return policy;
}

interface Definition {
  ritual: RepoRitual;
  hash: string;
  timeout?: string;
}

interface Checkout {
  commit?: string;
  dirty: boolean;
  host: string;
  now: Date;
  /** sha256 of the marker file (0.129.0): the guard's short cut on the next reconcile. */
  markerHash: string;
  /** `ritual reconcile --force` skipped the guard: the lines say so. */
  isForced: boolean;
}

/** `base` with every git-owned field and `def_*` key replaced from `definition`. Store-owned fields are kept. */
function mirrored(base: Ritual, definition: Definition, at: Checkout): Ritual {
  const { ritual } = definition;
  const header: Ritual = {
    ...base,
    title: ritual.title,
    anchor: ritual.anchor,
    skill: ritual.skill,
    policy: mirroredPolicy(ritual),
    source: "repo",
    def_hash: definition.hash,
    def_dirty: at.dirty,
    def_host: at.host,
    def_at: at.now.toISOString(),
    updated: at.now.toISOString(),
  };
  for (const key of ["cadence", "at", "tz", "from", "args", "timeout", "follow_up", "candle_deliver", "report_deliver", "def_commit"] as const) delete header[key];
  if (ritual.cadence !== undefined) header.cadence = ritual.cadence;
  if (ritual.at !== undefined) header.at = ritual.at;
  if (ritual.tz !== undefined) header.tz = ritual.tz;
  if (ritual.from !== undefined) header.from = ritual.from;
  if (ritual.args !== undefined) header.args = ritual.args;
  if (ritual.followUp !== undefined) header.follow_up = ritual.followUp;
  if (ritual.candleDeliver !== undefined) header.candle_deliver = [...ritual.candleDeliver];
  if (ritual.reportDeliver !== undefined) header.report_deliver = [...ritual.reportDeliver];
  if (definition.timeout !== undefined) header.timeout = definition.timeout;
  if (at.commit !== undefined) header.def_commit = at.commit;
  return header;
}

function newItem(slug: string, now: Date): Ritual {
  const iso = now.toISOString();
  return {
    id: ulid(now.getTime()),
    kind: "ritual",
    slug,
    title: slug,
    created: iso,
    updated: iso,
    tags: [],
    anchor: "due",
    policy: { mode: "off", may: [], hold: [] },
  };
}

function definedLine(slug: string, change: DefinitionChange, fields: { hash: string | undefined; at: Checkout }): LedgerLineInput {
  const line: LedgerLineInput = {
    who: defaultWho(),
    type: RITUAL_DEFINED,
    item: itemRef("ritual", slug),
    at: fields.at.now.toISOString(),
    slug,
    def_hash: fields.hash,
    commit: fields.at.commit,
    dirty: fields.at.dirty,
    change,
    // 0.129.0: an older darius keeps unknown fields of a line, so these are safe to sync.
    marker_hash: fields.at.markerHash,
  };
  if (fields.at.isForced) line.forced = true;
  return line;
}

function emptyResult(marker: ReconcileResult["marker"], at: { commit?: string; dirty: boolean }): ReconcileResult {
  const result: ReconcileResult = {
    ok: marker !== "invalid",
    marker,
    dirty: at.dirty,
    adopted: [],
    updated: [],
    unchanged: [],
    retired: [],
    unmanaged: [],
    warnings: [],
  };
  if (at.commit !== undefined) result.commit = at.commit;
  return result;
}

function readCheckoutMarker(checkout: string, project: Project): { marker: Marker } | { error: string } {
  try {
    const marker = readMarker(checkout);
    if (marker === null) return { error: `${checkout}: no ${MARKER_FILE}` };
    if (marker.project !== project.name) {
      return { error: `${marker.file}: project = "${marker.project}", not "${project.name}"` };
    }
    return { marker };
  } catch (cause) {
    return { error: errorMessage(cause) };
  }
}

/** The guard's decision, and the id of the record it was made against. */
interface Judged {
  decision: GuardDecision;
  record: string | undefined;
}

/** What step 4 does with one marker ritual: the change and the item to write, or no change. */
interface Step {
  change: "adopted" | "updated" | null;
  doc: Document<Ritual>;
}

/** Step 4 for one marker ritual. */
function reconcileOne(existing: Document<Ritual> | null, definition: Definition, at: Checkout): Step {
  if (existing === null) {
    return { change: "adopted", doc: { header: mirrored(newItem(definition.ritual.slug, at.now), definition, at), body: "" } };
  }
  const old = existing.header;
  if (old.source !== "repo") return { change: "adopted", doc: { header: mirrored(old, definition, at), body: "" } };
  const same = old.def_hash === definition.hash && old.def_commit === at.commit && old.def_dirty === at.dirty;
  if (same) return { change: null, doc: existing };
  return { change: "updated", doc: { header: mirrored(old, definition, at), body: "" } };
}

/**
 * Mirrors the v3 marker in `checkout` into `project`'s store (section 4.2).
 * `host` is the reconciling host (`hostId()` in production); `now` stamps
 * `updated`, `def_at` and the ledger lines. Store I/O errors throw.
 * `dryRun` classifies and reports the same way and writes nothing
 * (`darius ritual reconcile --dry-run`, run-due's dry run). `force` skips
 * the guard (`darius ritual reconcile --force`; never run-due).
 */
export function reconcileProject(
  project: Project,
  checkout: string,
  host: string,
  now: Date,
  options: { dryRun?: boolean; force?: boolean } = {},
): ReconcileResult {
  const isDry = options.dryRun === true;
  const read = readCheckoutMarker(checkout, project);
  if ("error" in read) {
    const result = emptyResult("invalid", { dirty: false });
    result.error = read.error;
    return result;
  }
  const { marker } = read;
  if (marker.version < 3) return emptyResult("v2", { dirty: false });
  const at: Checkout = { dirty: markerDirty(checkout), host, now, markerHash: markerHash(marker.file), isForced: options.force === true };
  const commit = checkoutCommit(checkout);
  if (commit !== undefined) at.commit = commit;
  const result = emptyResult("v3", at);
  const timeouts = writtenTimeouts(marker);
  const definitions = marker.rituals.map((ritual): Definition => {
    const resolved = mirrorDefinition(marker, ritual);
    const definition: Definition = { ritual: resolved, hash: definitionHash(resolved) };
    if (ritual.timeoutMs !== undefined) definition.timeout = timeouts.get(ritual.slug) ?? timeoutText(ritual.timeoutMs);
    return definition;
  });
  // The git calls run before the lock; under it the decision is made again only if a newer record came in between.
  const head = headFacts(checkout);
  const judge = (ledger: readonly LedgerLine[]): Judged => {
    const record = latestRecord(ledger);
    const decision = decideReconcile({ record, head, markerHash: at.markerHash, force: at.isForced, relation: (recorded, sha) => commitRelation(checkout, recorded, sha) });
    return { decision, record: record?.id };
  };
  let judged = judge(readLedger(project));
  project.withLock(() => {
    const lines: LedgerLineInput[] = [];
    const named = new Set(definitions.map((definition) => definition.ritual.slug));
    const ledger = readLedger(project);
    if (latestRecord(ledger)?.id !== judged.record) judged = judge(ledger);
    const { decision } = judged;
    if (decision.action === "reconcile" && decision.note !== undefined) result.warnings.push(decision.note);
    if (decision.action === "stale") {
      result.stale = { ...decision.stale, line: staleLine(project.name, decision.stale) };
      return;
    }
    if (decision.action === "unchanged") {
      listUnchanged(result, { definitions, ledger, project });
      return;
    }
    for (const definition of definitions) {
      const { slug } = definition.ritual;
      const existing = project.readItem<Ritual>("ritual", slug);
      // Architect ruling: a retired ritual stays retired, repo or store. It is not mirrored again.
      if (existing !== null && ritualLifecycle(ledger, slug) === "retired") {
        result.warnings.push(`${slug} was retired; use a new slug`);
        continue;
      }
      const step = reconcileOne(existing, definition, at);
      if (step.change === null) {
        result.unchanged.push(slug);
        continue;
      }
      if (!isDry) project.writeItem(step.doc, { who: defaultWho() });
      result[step.change].push(slug);
      lines.push(definedLine(slug, step.change, { hash: definition.hash, at }));
    }
    for (const slug of project.listItems("ritual")) {
      if (named.has(slug)) continue;
      const doc = project.readItem<Ritual>("ritual", slug);
      if (doc === null || ritualLifecycle(ledger, slug) === "retired") continue;
      if (doc.header.source !== "repo") {
        result.unmanaged.push(slug);
        continue;
      }
      const note = at.commit === undefined ? `left ${MARKER_FILE}` : `left ${MARKER_FILE} at ${at.commit}`;
      lines.push({ who: defaultWho(), type: "ritual.lifecycle", item: itemRef("ritual", slug), at: now.toISOString(), state: "retired", note });
      lines.push(definedLine(slug, "retired", { hash: doc.header.def_hash, at }));
      result.retired.push(slug);
    }
    if (!isDry) appendLines(project, lines);
  });
  if (!isDry) keepStaleRecord(project, { checkout, now }, result);
  return result;
}

/**
 * The guard's "same marker" case: the store already holds this content from
 * a commit this checkout is not on. Nothing is written; each named ritual
 * reads as unchanged, and a retired one warns as in a reconcile.
 */
function listUnchanged(result: ReconcileResult, at: { definitions: readonly Definition[]; ledger: readonly LedgerLine[]; project: Project }): void {
  for (const { ritual } of at.definitions) {
    const isRetired = at.project.readItem<Ritual>("ritual", ritual.slug) !== null && ritualLifecycle(at.ledger, ritual.slug) === "retired";
    if (isRetired) result.warnings.push(`${ritual.slug} was retired; use a new slug`);
    else result.unchanged.push(ritual.slug);
  }
}

/** Keeps `marker-stale.json` in step with this reconcile, for `darius doctor`. A write failure is a warning. */
function keepStaleRecord(project: Project, at: { checkout: string; now: Date }, result: ReconcileResult): void {
  try {
    writeStaleRecord(project, result.stale === undefined ? null : { at: at.now.toISOString(), checkout: at.checkout, line: result.stale.line });
  } catch (cause) {
    result.warnings.push(`cannot record the stale checkout for darius doctor: ${errorMessage(cause)}`);
  }
}

/**
 * What `ritual list` and the web warn about: a retired slug named again, and a mirror this checkout differs from (section 4.3).
 * `isStale`: the last reconcile found this checkout older than the store's marker (`marker-stale.json`, 0.129.0), so the advice is a pull, not a reconcile.
 */
export function ritualWarnings(doc: Document<Ritual>, lifecycle: string, marker: Marker | null, isStale = false): string[] {
  const { header } = doc;
  const defined = marker?.rituals.find((ritual) => ritual.slug === header.slug);
  if (marker === null || defined === undefined || header.source !== "repo") return [];
  if (lifecycle === "retired") return [`${header.slug} was retired; use a new slug`];
  if (header.def_hash === mirrorHash(marker, defined)) return [];
  const commit = header.def_commit === undefined ? "" : ` (commit ${header.def_commit})`;
  return [`mirror is from ${header.def_host ?? "another host"}${commit}, this checkout differs: ${isStale ? "pull the checkout" : "darius ritual reconcile"}`];
}
