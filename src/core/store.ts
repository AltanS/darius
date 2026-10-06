/**
 * The local store of one project (docs/concept.md, "Storage and sync" >
 * "Local layout"):
 *
 *   <stateDir>/<project>/
 *     items/rituals/<slug>.md      definitions, frontmatter + body
 *     items/vigils/<slug>.md
 *     ledger/<host>/open.jsonl     lines appended locally (src/core/ledger.ts)
 *     ledger/<host>/<ulid>.jsonl   closed chunks, immutable once written
 *     blobs/<sha256>               prior item versions, run findings, held outputs
 *     sync.json                    owned by src/core/sync.ts, never read here
 *     .lock                        O_EXCL lock for local writes
 *
 * Every local write takes `.lock`. The lock is an O_EXCL file, retried with
 * exponential backoff and jitter, and taken over once it is older than 30 s
 * (a holder that old has crashed: every body run under it is a single file
 * edit). Takeover goes through a second O_EXCL guard file and re-checks the
 * age inside it, so two waiters that both see a stale lock cannot both
 * delete it and both win.
 *
 * The lock is re-entrant inside one process: `writeItem` holds it and calls
 * `appendLine`, which takes it again.
 *
 * Helpers beyond the module contract, for sync (T5) and the commands:
 *
 *   itemRef(kind: Kind, slug: string): string
 *       "ritual/<slug>", the `item` field of a ledger line.
 *   readItemText(project: Project, kind: Kind, slug: string): string | null
 *       The raw item file, for the manifest sha and for pushing.
 *   writeItemText(project: Project, write: ItemTextWrite): "written" | "unchanged"
 *       Writes a raw item file verbatim (a pulled remote item), after
 *       decoding it to prove it is valid. Same blob + `item.changed` rule as
 *       `writeItem`.
 *   decodeItem(text: string, file: string): Document
 *   encodeItem(doc: Document): string
 *       The typed item <-> file text codec. Frontmatter leaves are strings
 *       on disk; `heavy` is "true"/"false" and `policy.max_turns` digits.
 *   putBlob(project: Project, content: string | Uint8Array): string
 *       Content-addressed write, returns the sha256 hex. Idempotent.
 *   getBlob(project: Project, sha: string): Uint8Array | null
 *   getBlobText(project: Project, sha: string): string | null
 *   listBlobs(project: Project): string[]
 *   sha256Hex(content: string | Uint8Array): string
 *   withFileLock<R>(lockPath: string, fn: () => R, timing?: LockTiming): R
 *       The lock primitive behind `Project.withLock`.
 */

import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";

import { sleepSync } from "../runtime.ts";
import { parseDocument, serializeDocument } from "./frontmatter.ts";
import type { FrontmatterHeader, FrontmatterList, FrontmatterMap, FrontmatterScalar, FrontmatterValue } from "./frontmatter.ts";
import { appendLine, defaultWho } from "./ledger.ts";
import { UsageError } from "./model.ts";
import type { Document, Item, Kind, Policy, Profile, Ritual, Vigil } from "./model.ts";
import { projectDir, stateDir } from "./paths.ts";

export interface Project {
  name: string;
  root: string;
  listItems(kind: Kind): string[];
  readItem<T extends Item>(kind: Kind, slug: string): Document<T> | null;
  writeItem(doc: Document, opts?: { who: string }): void;
  withLock<R>(fn: () => R): R;
}

export interface LockTiming {
  readonly timeoutMs: number;
  readonly staleMs: number;
}

/** A raw item file to write verbatim, for `writeItemText`. */
export interface ItemTextWrite {
  readonly kind: Kind;
  readonly slug: string;
  readonly text: string;
  readonly who?: string;
}

const KIND_DIRS = { ritual: "rituals", vigil: "vigils", profile: "profiles" } as const satisfies Record<Kind, string>;
const PROJECT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
/**
 * The reserved store project for store-wide definitions: harness profiles
 * (docs/concept.md, "Profiles"). Its leading `_` can never collide with a
 * real project name, and listProjects never returns it, so no command that
 * walks projects treats it as one. Sync includes it on purpose.
 */
export const GLOBAL_PROJECT = "_global";

/** True when `name` may name a project: letters, digits, '-', '_' or '.', a letter or digit first. */
export function isProjectName(name: string): boolean {
  return PROJECT_NAME.test(name);
}
const SLUG = /^[a-z0-9][a-z0-9._-]{0,127}$/u;

/** True when `slug` may name an item: lowercase letters, digits, '-', '_' or '.', a letter or digit first. */
export function isSlug(slug: string): boolean {
  return SLUG.test(slug);
}
const SHA256_HEX = /^[0-9a-f]{64}$/u;

const DEFAULT_LOCK_TIMING: LockTiming = { timeoutMs: 45_000, staleMs: 30_000 };
const LOCK_BACKOFF_BASE_MS = 5;
const LOCK_BACKOFF_MAX_MS = 250;
const LOCK_JITTER = 0.3;

// --- errno and small file helpers --------------------------------------------

function hasErrnoCode(cause: unknown, code: string): boolean {
  return cause instanceof Error && "code" in cause && cause.code === code;
}

function unlinkIfPresent(path: string): void {
  try {
    unlinkSync(path);
  } catch (cause) {
    if (!hasErrnoCode(cause, "ENOENT")) throw cause;
  }
}

function readTextIfPresent(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch (cause) {
    if (hasErrnoCode(cause, "ENOENT")) return null;
    throw cause;
  }
}

function uniqueSuffix(): string {
  return `${process.pid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Writes `path` through a temp file and a rename, so a reader never sees half a file. */
function writeFileAtomic(path: string, content: string | Uint8Array): void {
  const temp = `${path}.tmp-${uniqueSuffix()}`;
  writeFileSync(temp, content);
  try {
    renameSync(temp, path);
  } catch (cause) {
    unlinkIfPresent(temp);
    throw cause;
  }
}

export function sha256Hex(content: string | Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}

// --- the lock ----------------------------------------------------------------

/** The lock paths this process holds right now. A nested `withFileLock` on one of them just runs. */
const heldLocks = new Set<string>();

/** Creates `path` with O_EXCL and returns what it wrote. Null when the file already exists. */
function tryCreateLockFile(path: string): string | null {
  let fd: number;
  try {
    fd = openSync(path, "wx");
  } catch (cause) {
    if (hasErrnoCode(cause, "EEXIST")) return null;
    throw cause;
  }
  const token = `${process.pid} ${hostname()} ${new Date().toISOString()} ${uniqueSuffix()}\n`;
  try {
    writeSync(fd, token);
  } finally {
    closeSync(fd);
  }
  return token;
}

/**
 * Deletes the lock file only when it still holds our token. A holder that
 * ran past the stale limit has had its lock taken over; deleting the new
 * holder's file would let a third process in.
 */
function releaseLock(lockPath: string, token: string): void {
  if (readTextIfPresent(lockPath) === token) unlinkIfPresent(lockPath);
}

/** Milliseconds since `path` was created, or null when it is gone. */
function lockAgeMs(path: string): number | null {
  const stats = statSync(path, { throwIfNoEntry: false });
  return stats === undefined ? null : Date.now() - stats.mtimeMs;
}

/**
 * Deletes the lock at `lockPath` when it is older than `staleMs`. Returns
 * true when the caller should retry at once (lock gone or removed).
 */
function takeOverIfStale(lockPath: string, staleMs: number): boolean {
  const age = lockAgeMs(lockPath);
  if (age === null) return true;
  if (age < staleMs) return false;
  const guard = `${lockPath}.takeover`;
  if (tryCreateLockFile(guard) === null) {
    const guardAge = lockAgeMs(guard);
    if (guardAge !== null && guardAge >= staleMs) unlinkIfPresent(guard);
    return false;
  }
  try {
    const ageInsideGuard = lockAgeMs(lockPath);
    if (ageInsideGuard !== null && ageInsideGuard >= staleMs) unlinkIfPresent(lockPath);
  } finally {
    unlinkIfPresent(guard);
  }
  return true;
}

function backoffMs(attempt: number): number {
  const delay = Math.min(LOCK_BACKOFF_BASE_MS * 2 ** (attempt - 1), LOCK_BACKOFF_MAX_MS);
  return delay + Math.floor(Math.random() * delay * LOCK_JITTER);
}

function describeHolder(lockPath: string): string {
  const holder = readTextIfPresent(lockPath);
  return holder === null ? "holder gone" : `holder: ${holder.trim()}`;
}

function acquireLock(lockPath: string, timing: LockTiming): string {
  const deadline = Date.now() + timing.timeoutMs;
  let attempt = 0;
  while (Date.now() <= deadline) {
    const token = tryCreateLockFile(lockPath);
    if (token !== null) return token;
    if (takeOverIfStale(lockPath, timing.staleMs)) continue;
    attempt += 1;
    sleepSync(backoffMs(attempt));
  }
  throw new Error(
    `${lockPath}: still locked after ${timing.timeoutMs} ms (${describeHolder(lockPath)}). ` +
      "Delete the file by hand only when no darius process is running.",
  );
}

function runSynchronously<R>(fn: () => R, lockPath: string): R {
  const result = fn();
  if (result instanceof Promise) {
    throw new Error(`${lockPath}: withLock needs a synchronous function; the lock would be released before it finished`);
  }
  return result;
}

/**
 * Runs `fn` while holding the O_EXCL lock file `lockPath`. Re-entrant within
 * one process. `fn` must be synchronous and short: a lock older than
 * `timing.staleMs` is taken over by the next waiter.
 */
export function withFileLock<R>(lockPath: string, fn: () => R, timing: LockTiming = DEFAULT_LOCK_TIMING): R {
  if (heldLocks.has(lockPath)) return runSynchronously(fn, lockPath);
  const token = acquireLock(lockPath, timing);
  heldLocks.add(lockPath);
  try {
    return runSynchronously(fn, lockPath);
  } finally {
    heldLocks.delete(lockPath);
    releaseLock(lockPath, token);
  }
}

// --- item codec: frontmatter header <-> typed Item ----------------------------

const RITUAL_KEYS: readonly string[] = [
  "id", "kind", "slug", "title", "created", "updated", "cadence", "anchor",
  "agent", "owner", "tags", "imported_from", "skill", "host", "policy",
  "source", "at", "tz", "from", "args", "timeout", "follow_up", "def_hash", "def_commit", "def_dirty", "def_host", "def_at",
];
const POLICY_KEYS: readonly string[] = ["mode", "may", "hold", "notes", "on_hold", "follow_up_may", "model", "max_turns", "profile"];
const PROFILE_KEYS: readonly string[] = [
  "id", "kind", "slug", "title", "created", "updated", "tags",
  "harness", "model", "effort", "permissions", "surface", "max_turns", "args",
];
const VIGIL_KEYS: readonly string[] = [
  "id", "kind", "slug", "title", "created", "updated", "from", "due", "until",
  "gate_command", "heavy", "agent", "tags", "imported_from",
];

function isScalar(value: FrontmatterValue): value is FrontmatterScalar {
  return typeof value === "string";
}

function isList(value: FrontmatterValue): value is FrontmatterList {
  return Array.isArray(value);
}

interface FieldReader {
  requiredString(key: string): string;
  optionalString(key: string): string | undefined;
  stringList(key: string): string[];
  boolean(key: string, fallback: boolean): boolean;
  optionalInteger(key: string): number | undefined;
  nestedMap(key: string): FieldReader | undefined;
  rejectUnknown(allowed: readonly string[]): void;
}

/** Typed reads over one frontmatter map; every error names `where`. */
function readerFor(map: FrontmatterMap, where: string): FieldReader {
  const fail = (message: string): Error => new Error(`${where}: ${message}`);
  const optionalString = (key: string): string | undefined => {
    const value = map[key];
    if (value === undefined) return undefined;
    if (!isScalar(value)) throw fail(`'${key}' must be a single value`);
    return value;
  };
  return {
    optionalString,
    requiredString(key) {
      const value = optionalString(key);
      if (value === undefined || value.length === 0) throw fail(`'${key}' is required`);
      return value;
    },
    stringList(key) {
      const value = map[key];
      if (value === undefined) return [];
      if (!isList(value)) throw fail(`'${key}' must be a list`);
      return [...value];
    },
    boolean(key, fallback) {
      const value = optionalString(key);
      if (value === undefined) return fallback;
      if (value === "true") return true;
      if (value === "false") return false;
      throw fail(`'${key}' must be true or false, got '${value}'`);
    },
    optionalInteger(key) {
      const value = optionalString(key);
      if (value === undefined) return undefined;
      if (!/^\d+$/u.test(value)) throw fail(`'${key}' must be a whole number, got '${value}'`);
      return Number(value);
    },
    nestedMap(key) {
      const value = map[key];
      if (value === undefined) return undefined;
      if (isScalar(value) || isList(value)) throw fail(`'${key}' must be a nested map`);
      return readerFor(value, `${where} ${key}`);
    },
    rejectUnknown(allowed) {
      const unknownKeys = Object.keys(map).filter((key) => !allowed.includes(key));
      if (unknownKeys.length > 0) throw fail(`unknown key(s): ${unknownKeys.join(", ")}`);
    },
  };
}

function toAnchor(value: string | undefined, where: string): Ritual["anchor"] {
  if (value === undefined || value === "due") return "due";
  if (value === "completion") return "completion";
  throw new Error(`${where}: 'anchor' must be due or completion, got '${value}'`);
}

function toMode(value: string | undefined, where: string): Policy["mode"] {
  if (value === undefined || value === "off") return "off";
  if (value === "report" || value === "act") return value;
  throw new Error(`${where}: 'policy.mode' must be off, report or act, got '${value}'`);
}

function decodePolicy(reader: FieldReader | undefined, where: string): Policy {
  if (reader === undefined) return { mode: "off", may: [], hold: [] };
  reader.rejectUnknown(POLICY_KEYS);
  const policy: Policy = {
    mode: toMode(reader.optionalString("mode"), where),
    may: reader.stringList("may"),
    hold: reader.stringList("hold"),
  };
  const notes = reader.optionalString("notes");
  const onHold = reader.optionalString("on_hold");
  const followUpMay = reader.stringList("follow_up_may");
  const model = reader.optionalString("model");
  const maxTurns = reader.optionalInteger("max_turns");
  const profile = reader.optionalString("profile");
  if (notes !== undefined) policy.notes = notes;
  if (onHold !== undefined && onHold !== "stop") {
    if (onHold !== "deny") throw new Error(`${where}: 'policy.on_hold' must be stop or deny, got '${onHold}'`);
    policy.on_hold = onHold;
  }
  if (followUpMay.length > 0) policy.follow_up_may = followUpMay;
  if (model !== undefined) policy.model = model;
  if (maxTurns !== undefined) policy.max_turns = maxTurns;
  if (profile !== undefined) policy.profile = profile;
  return policy;
}

function decodeRitual(reader: FieldReader, where: string): Ritual {
  reader.rejectUnknown(RITUAL_KEYS);
  const ritual: Ritual = {
    id: reader.requiredString("id"),
    kind: "ritual",
    slug: reader.requiredString("slug"),
    title: reader.requiredString("title"),
    created: reader.requiredString("created"),
    updated: reader.requiredString("updated"),
    tags: reader.stringList("tags"),
    anchor: toAnchor(reader.optionalString("anchor"), where),
    policy: decodePolicy(reader.nestedMap("policy"), where),
  };
  const cadence = reader.optionalString("cadence");
  const agent = reader.optionalString("agent");
  const owner = reader.optionalString("owner");
  const importedFrom = reader.optionalString("imported_from");
  const skill = reader.optionalString("skill");
  if (skill !== undefined) ritual.skill = skill;
  const host = reader.optionalString("host");
  if (host !== undefined) ritual.host = host;
  if (cadence !== undefined) ritual.cadence = cadence;
  if (agent !== undefined) ritual.agent = agent;
  if (owner !== undefined) ritual.owner = owner;
  if (importedFrom !== undefined) ritual.imported_from = importedFrom;
  decodeRepoFields(reader, ritual, where);
  return ritual;
}

/** The marker v3 keys of a repo ritual, written by reconcile only (src/core/marker.ts). */
function decodeRepoFields(reader: FieldReader, ritual: Ritual, where: string): void {
  const source = reader.optionalString("source");
  if (source !== undefined && source !== "repo") throw new Error(`${where}: 'source' must be repo, got '${source}'`);
  if (source !== undefined) ritual.source = source;
  for (const key of ["at", "tz", "from", "args", "timeout", "def_hash", "def_commit", "def_host", "def_at"] as const) {
    const value = reader.optionalString(key);
    if (value !== undefined) ritual[key] = value;
  }
  if (reader.optionalString("def_dirty") !== undefined) ritual.def_dirty = reader.boolean("def_dirty", false);
  const followUp = reader.optionalString("follow_up");
  if (followUp !== undefined && followUp !== "attended") {
    if (followUp !== "headless") throw new Error(`${where}: 'follow_up' must be headless or attended, got '${followUp}'`);
    ritual.follow_up = followUp;
  }
}

function decodeVigil(reader: FieldReader): Vigil {
  reader.rejectUnknown(VIGIL_KEYS);
  const vigil: Vigil = {
    id: reader.requiredString("id"),
    kind: "vigil",
    slug: reader.requiredString("slug"),
    title: reader.requiredString("title"),
    created: reader.requiredString("created"),
    updated: reader.requiredString("updated"),
    tags: reader.stringList("tags"),
    heavy: reader.boolean("heavy", false),
  };
  const optionalKeys = ["from", "due", "until", "gate_command", "agent", "imported_from"] as const;
  for (const key of optionalKeys) {
    const value = reader.optionalString(key);
    if (value !== undefined) vigil[key] = value;
  }
  return vigil;
}

function toPermissions(value: string | undefined, where: string): Profile["permissions"] {
  if (value === undefined || value === "gated" || value === "skip") return value;
  throw new Error(`${where}: 'permissions' must be gated or skip, got '${value}'`);
}

function toSurface(value: string | undefined, where: string): Profile["surface"] {
  if (value === undefined || value === "headless" || value === "herdr") return value;
  throw new Error(`${where}: 'surface' must be headless or herdr, got '${value}'`);
}

function decodeProfile(reader: FieldReader, where: string): Profile {
  reader.rejectUnknown(PROFILE_KEYS);
  const profile: Profile = {
    id: reader.requiredString("id"),
    kind: "profile",
    slug: reader.requiredString("slug"),
    title: reader.requiredString("title"),
    created: reader.requiredString("created"),
    updated: reader.requiredString("updated"),
    tags: reader.stringList("tags"),
  };
  for (const key of ["harness", "model", "effort"] as const) {
    const value = reader.optionalString(key);
    if (value !== undefined) profile[key] = value;
  }
  const permissions = toPermissions(reader.optionalString("permissions"), where);
  const surface = toSurface(reader.optionalString("surface"), where);
  const maxTurns = reader.optionalInteger("max_turns");
  const args = reader.stringList("args");
  if (permissions !== undefined) profile.permissions = permissions;
  if (surface !== undefined) profile.surface = surface;
  if (maxTurns !== undefined) profile.max_turns = maxTurns;
  if (args.length > 0) profile.args = args;
  return profile;
}

/** Parses an item file into a typed document. Throws naming `file` on any violation. */
export function decodeItem(text: string, file: string): Document {
  const { header, body } = parseDocument(text, file);
  const reader = readerFor(header, file);
  const kind = reader.requiredString("kind");
  if (kind === "ritual") return { header: decodeRitual(reader, file), body };
  if (kind === "vigil") return { header: decodeVigil(reader), body };
  if (kind === "profile") return { header: decodeProfile(reader, file), body };
  throw new Error(`${file}: 'kind' must be ritual, vigil or profile, got '${kind}'`);
}

type HeaderEntries = Record<string, FrontmatterValue>;

function putIfSet(entries: HeaderEntries, key: string, value: string | undefined): void {
  if (value !== undefined) entries[key] = value;
}

function encodePolicy(policy: Policy): FrontmatterMap {
  const entries: HeaderEntries = {};
  entries.mode = policy.mode;
  entries.may = [...policy.may];
  entries.hold = [...policy.hold];
  putIfSet(entries, "notes", policy.notes);
  putIfSet(entries, "on_hold", policy.on_hold);
  if (policy.follow_up_may !== undefined && policy.follow_up_may.length > 0) entries.follow_up_may = [...policy.follow_up_may];
  putIfSet(entries, "model", policy.model);
  putIfSet(entries, "max_turns", policy.max_turns === undefined ? undefined : String(policy.max_turns));
  putIfSet(entries, "profile", policy.profile);
  return entries;
}

function encodeHeader(item: Item): FrontmatterHeader {
  const entries: HeaderEntries = {};
  entries.id = item.id;
  entries.kind = item.kind;
  entries.slug = item.slug;
  entries.title = item.title;
  entries.created = item.created;
  entries.updated = item.updated;
  if (item.kind === "ritual") {
    putIfSet(entries, "cadence", item.cadence);
    entries.anchor = item.anchor;
    putIfSet(entries, "agent", item.agent);
    putIfSet(entries, "owner", item.owner);
    entries.tags = [...item.tags];
    putIfSet(entries, "imported_from", item.imported_from);
    putIfSet(entries, "skill", item.skill);
    putIfSet(entries, "host", item.host);
    putIfSet(entries, "source", item.source);
    for (const key of ["at", "tz", "from", "args", "timeout", "follow_up", "def_hash", "def_commit"] as const) putIfSet(entries, key, item[key]);
    putIfSet(entries, "def_dirty", item.def_dirty === undefined ? undefined : String(item.def_dirty));
    putIfSet(entries, "def_host", item.def_host);
    putIfSet(entries, "def_at", item.def_at);
    entries.policy = encodePolicy(item.policy);
    return entries;
  }
  if (item.kind === "profile") {
    entries.tags = [...item.tags];
    putIfSet(entries, "harness", item.harness);
    putIfSet(entries, "model", item.model);
    putIfSet(entries, "effort", item.effort);
    putIfSet(entries, "permissions", item.permissions);
    putIfSet(entries, "surface", item.surface);
    putIfSet(entries, "max_turns", item.max_turns === undefined ? undefined : String(item.max_turns));
    if (item.args !== undefined) entries.args = [...item.args];
    return entries;
  }
  putIfSet(entries, "from", item.from);
  putIfSet(entries, "due", item.due);
  putIfSet(entries, "until", item.until);
  putIfSet(entries, "gate_command", item.gate_command);
  entries.heavy = item.heavy ? "true" : "false";
  putIfSet(entries, "agent", item.agent);
  entries.tags = [...item.tags];
  putIfSet(entries, "imported_from", item.imported_from);
  return entries;
}

/** Renders a typed document into item file text, keys in the documented order. */
export function encodeItem(doc: Document): string {
  return serializeDocument(encodeHeader(doc.header), doc.body);
}

// --- paths and names ---------------------------------------------------------

function assertSlug(slug: string): void {
  if (!SLUG.test(slug)) {
    throw new UsageError(`invalid slug '${slug}': use lowercase letters, digits, '-', '_' or '.'`);
  }
}

function assertProjectName(name: string): void {
  if (name !== GLOBAL_PROJECT && !PROJECT_NAME.test(name)) {
    throw new UsageError(`invalid project name '${name}': use letters, digits, '-', '_' or '.'`);
  }
}

function itemPath(root: string, kind: Kind, slug: string): string {
  return join(root, "items", KIND_DIRS[kind], `${slug}.md`);
}

/** The `item` value of a ledger line about this item, e.g. "ritual/heartbeat". */
export function itemRef(kind: Kind, slug: string): string {
  return `${kind}/${slug}`;
}

// --- blobs -------------------------------------------------------------------

function blobPath(project: Project, sha: string): string {
  if (!SHA256_HEX.test(sha)) throw new Error(`'${sha}' is not a sha256 hex digest`);
  return join(project.root, "blobs", sha);
}

/** Stores `content` under `blobs/<sha256>` and returns the sha. Writing the same content twice is a no-op. */
export function putBlob(project: Project, content: string | Uint8Array): string {
  const sha = sha256Hex(content);
  const path = blobPath(project, sha);
  if (existsSync(path)) return sha;
  mkdirSync(join(project.root, "blobs"), { recursive: true });
  writeFileAtomic(path, content);
  return sha;
}

export function getBlob(project: Project, sha: string): Uint8Array | null {
  const path = blobPath(project, sha);
  try {
    return readFileSync(path);
  } catch (cause) {
    if (hasErrnoCode(cause, "ENOENT")) return null;
    throw cause;
  }
}

export function getBlobText(project: Project, sha: string): string | null {
  return readTextIfPresent(blobPath(project, sha));
}

export function listBlobs(project: Project): string[] {
  const dir = join(project.root, "blobs");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => SHA256_HEX.test(name))
    .toSorted();
}

// --- items -------------------------------------------------------------------

export function readItemText(project: Project, kind: Kind, slug: string): string | null {
  assertSlug(slug);
  return readTextIfPresent(itemPath(project.root, kind, slug));
}

/**
 * Writes a raw item file verbatim. The text is decoded first and must
 * describe the same kind and slug. When a previous version exists and
 * differs, it is kept under `blobs/` and an `item.changed{sha_before,
 * sha_after}` line is appended (`sha_before` is null for a new item).
 * Writing identical text changes nothing and appends nothing.
 */
export function writeItemText(project: Project, write: ItemTextWrite): "written" | "unchanged" {
  assertSlug(write.slug);
  const path = itemPath(project.root, write.kind, write.slug);
  const { header } = decodeItem(write.text, path);
  if (header.kind !== write.kind || header.slug !== write.slug) {
    throw new Error(`${path}: file says ${header.kind}/${header.slug}, expected ${write.kind}/${write.slug}`);
  }
  return project.withLock(() => {
    const previous = readTextIfPresent(path);
    if (previous === write.text) return "unchanged";
    const shaBefore = previous === null ? null : putBlob(project, previous);
    mkdirSync(join(project.root, "items", KIND_DIRS[write.kind]), { recursive: true });
    writeFileAtomic(path, write.text);
    appendLine(project, {
      who: write.who ?? defaultWho(),
      type: "item.changed",
      item: itemRef(write.kind, write.slug),
      sha_before: shaBefore,
      sha_after: sha256Hex(write.text),
    });
    return "written";
  });
}

class LocalProject implements Project {
  readonly name: string;
  readonly root: string;

  constructor(name: string, root: string) {
    this.name = name;
    this.root = root;
  }

  listItems(kind: Kind): string[] {
    const dir = join(this.root, "items", KIND_DIRS[kind]);
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((file) => file.endsWith(".md"))
      .map((file) => file.slice(0, -".md".length))
      .filter((slug) => SLUG.test(slug))
      .toSorted();
  }

  readItem<T extends Item>(kind: Kind, slug: string): Document<T> | null {
    const text = readItemText(this, kind, slug);
    if (text === null) return null;
    const path = itemPath(this.root, kind, slug);
    const doc = decodeItem(text, path);
    if (doc.header.kind !== kind || doc.header.slug !== slug) {
      throw new Error(`${path}: file says ${doc.header.kind}/${doc.header.slug}, expected ${kind}/${slug}`);
    }
    // SAFETY: the header's kind was just checked against `kind`; the caller
    // names the matching Item type for that kind (Ritual for "ritual").
    return doc as Document<T>;
  }

  writeItem(doc: Document, opts?: { who: string }): void {
    assertSlug(doc.header.slug);
    writeItemText(this, {
      kind: doc.header.kind,
      slug: doc.header.slug,
      text: encodeItem(doc),
      who: opts?.who,
    });
  }

  withLock<R>(fn: () => R): R {
    return withFileLock(join(this.root, ".lock"), fn);
  }
}

// --- projects ----------------------------------------------------------------

/**
 * Opens the store of project `name`. Refuses with a UsageError when it does
 * not exist, unless `create` is set, which lays out the directories.
 */
export function openProject(name: string, opts?: { create?: boolean }): Project {
  assertProjectName(name);
  const root = projectDir(name);
  if (!existsSync(root) && opts?.create !== true) {
    throw new UsageError(`no project '${name}' in ${stateDir()}`);
  }
  if (opts?.create === true) {
    for (const dir of ["items/rituals", "items/vigils", "items/profiles", "ledger", "blobs"]) {
      mkdirSync(join(root, dir), { recursive: true });
    }
  }
  return new LocalProject(name, root);
}

/** Every project in the state dir, sorted. A project is a directory with `items/` or `ledger/`. */
export function listProjects(): string[] {
  const root = stateDir();
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && PROJECT_NAME.test(entry.name))
    .filter((entry) => existsSync(join(root, entry.name, "items")) || existsSync(join(root, entry.name, "ledger")))
    .map((entry) => entry.name)
    .toSorted();
}
