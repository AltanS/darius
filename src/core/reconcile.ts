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
 * The run on a host always uses that host's own marker; a stale mirror only
 * changes what the web shows.
 *
 * It never decides whether a run may start. The caller judges `ok`, `marker`
 * and `dirty` (sections 4.4 to 4.6).
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { ritualLifecycle } from "./due.ts";
import { appendLines, defaultWho, readLedger, type LedgerLineInput } from "./ledger.ts";
import { definitionHash, MARKER_FILE, readMarker, type Marker, type RepoRitual } from "./marker.ts";
import type { Document, Policy, Ritual } from "./model.ts";
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
  const resolved: RepoRitual = { ...ritual, policy: { ...ritual.policy, may: [...ritual.policy.may], hold: [...ritual.policy.hold] } };
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
}

/** `base` with every git-owned field and `def_*` key replaced from `definition`. Store-owned fields are kept. */
function mirrored(base: Ritual, definition: Definition, at: Checkout): Ritual {
  const { ritual } = definition;
  const header: Ritual = {
    ...base,
    title: ritual.title,
    cadence: ritual.cadence,
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
  for (const key of ["at", "tz", "from", "timeout", "def_commit"] as const) delete header[key];
  if (ritual.at !== undefined) header.at = ritual.at;
  if (ritual.tz !== undefined) header.tz = ritual.tz;
  if (ritual.from !== undefined) header.from = ritual.from;
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
  return {
    who: defaultWho(),
    type: RITUAL_DEFINED,
    item: itemRef("ritual", slug),
    at: fields.at.now.toISOString(),
    slug,
    def_hash: fields.hash,
    commit: fields.at.commit,
    dirty: fields.at.dirty,
    change,
  };
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
 */
export function reconcileProject(project: Project, checkout: string, host: string, now: Date): ReconcileResult {
  const read = readCheckoutMarker(checkout, project);
  if ("error" in read) {
    const result = emptyResult("invalid", { dirty: false });
    result.error = read.error;
    return result;
  }
  const { marker } = read;
  if (marker.version < 3) return emptyResult("v2", { dirty: false });
  const at: Checkout = { dirty: markerDirty(checkout), host, now };
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
  project.withLock(() => {
    const lines: LedgerLineInput[] = [];
    const named = new Set(definitions.map((definition) => definition.ritual.slug));
    for (const definition of definitions) {
      const { slug } = definition.ritual;
      const step = reconcileOne(project.readItem<Ritual>("ritual", slug), definition, at);
      if (step.change === null) {
        result.unchanged.push(slug);
        continue;
      }
      project.writeItem(step.doc, { who: defaultWho() });
      result[step.change].push(slug);
      lines.push(definedLine(slug, step.change, { hash: definition.hash, at }));
    }
    const ledger = readLedger(project);
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
    appendLines(project, lines);
  });
  return result;
}
