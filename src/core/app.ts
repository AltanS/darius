/**
 * The versioned app install that `darius update` and `scripts/install.sh`
 * share. One layout on every host, NixOS included:
 *
 *   <app>/versions/vX.Y.Z/   a shallow clone of tag vX.Y.Z
 *   <app>/current            -> versions/vX.Y.Z, a relative link, flipped by
 *                            writing current.new and renaming it over current
 *   <app>/update.json        the last update: from, to, at, outcome, detail
 *   <app>/update.lock        an O_EXCL file while an update runs
 *
 * `<app>` is `~/.local/opt/darius`, or `DARIUS_APP_DIR` (src/core/paths.ts).
 * `~/.local/bin/darius` links to `<app>/current/bin/darius`, so a flip needs
 * no relink. bin/darius resolves every link before it starts a runtime, so a
 * running process keeps the version dir it started in, whatever `current`
 * says later.
 *
 * A release is a git tag. darius has no build step and commits `web/build/`,
 * so the tag fetched over the operator's SSH is the whole release: no
 * tarball, no CI, no checksum. The clone of a tag is checked against the
 * tag: its package.json must carry the same version.
 *
 * The git calls run the real `git`. A test points them at a `file://` repo
 * in a temp dir, so none of them reaches the network.
 */

import { spawnSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { basename, join, posix } from "node:path";

import { errorMessage } from "../runtime.ts";
import type { JsonValue } from "./model.ts";
import { isNixStorePath } from "./unit-path.ts";

/** Where a fresh install clones from when nothing else names a source. */
export const DEFAULT_SOURCE = "https://github.com/AltanS/darius.git";

const TAG = /^v(\d+)\.(\d+)\.(\d+)$/u;
const LS_REMOTE_TIMEOUT_MS = 60_000;
const CLONE_TIMEOUT_MS = 300_000;

// --- versions ---------------------------------------------------------------------

export interface SemVer {
  major: number;
  minor: number;
  patch: number;
}

/** `v1.2.3` as numbers, or null for anything that is not a plain release tag. */
export function parseTag(tag: string): SemVer | null {
  const match = TAG.exec(tag);
  if (match === null) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

/** `1.2.3` or `v1.2.3` as the tag `v1.2.3`, or null when it is neither. */
export function toTag(version: string): string | null {
  const tag = version.startsWith("v") ? version : `v${version}`;
  return parseTag(tag) === null ? null : tag;
}

/** `v1.2.3` as the bare version `1.2.3`. */
export function tagVersion(tag: string): string {
  return tag.startsWith("v") ? tag.slice(1) : tag;
}

/** SemVer order of two tags. A tag that does not parse sorts first. */
export function compareTags(a: string, b: string): number {
  const left = parseTag(a);
  const right = parseTag(b);
  if (left === null || right === null) return (left === null ? 0 : 1) - (right === null ? 0 : 1);
  return left.major - right.major || left.minor - right.minor || left.patch - right.patch;
}

/** The newest tag, or undefined for an empty list. */
export function newestTag(tags: readonly string[]): string | undefined {
  return tags.toSorted(compareTags).at(-1);
}

/** True when `to` has a higher major than `from`: the operator must change something first. */
export function isMajorStep(from: string, to: string): boolean {
  const left = parseTag(from);
  const right = parseTag(to);
  return left !== null && right !== null && right.major > left.major;
}

/** The release tags in `git ls-remote --tags --refs` output, oldest first. */
export function tagsFromLsRemote(stdout: string): string[] {
  const tags: string[] = [];
  for (const line of stdout.split("\n")) {
    const ref = line.split("\t")[1]?.trim() ?? "";
    const tag = ref.startsWith("refs/tags/") ? ref.slice("refs/tags/".length) : "";
    if (parseTag(tag) !== null) tags.push(tag);
  }
  return tags.toSorted(compareTags);
}

// --- install kinds ------------------------------------------------------------------

/**
 * How darius got onto this host, read from the real path of its root:
 * `app` under `<app>/versions/<tag>`, `nix` under the Nix store, `checkout`
 * for anything else (a clone such as `~/projects/darius`).
 */
export type InstallKind = { kind: "app"; tag: string } | { kind: "nix" } | { kind: "checkout" };

function tidy(path: string): string {
  const normal = posix.normalize(path);
  return normal.length > 1 && normal.endsWith("/") ? normal.slice(0, -1) : normal;
}

/** The install kind of a darius whose root is `root`, given the app dir `app`. Both are real paths. */
export function installKind(root: string, app: string): InstallKind {
  const dir = tidy(root);
  if (isNixStorePath(dir)) return { kind: "nix" };
  const versions = `${tidy(app)}/versions/`;
  if (!dir.startsWith(versions)) return { kind: "checkout" };
  const name = dir.slice(versions.length);
  return !name.includes("/") && parseTag(name) !== null ? { kind: "app", tag: name } : { kind: "checkout" };
}

// --- the layout -----------------------------------------------------------------------

export function versionsDir(app: string): string {
  return join(app, "versions");
}

export function versionDir(app: string, tag: string): string {
  return join(app, "versions", tag);
}

/** `<app>/current/bin/darius`: what `~/.local/bin/darius` links to on an app install. */
export function currentBin(app: string): string {
  return join(app, "current", "bin", "darius");
}

/** The tag `<app>/current` points at, or undefined when there is no such link. */
export function currentTag(app: string): string | undefined {
  let target: string;
  try {
    target = readlinkSync(join(app, "current"));
  } catch {
    return undefined;
  }
  const name = basename(target);
  return parseTag(name) === null ? undefined : name;
}

/** Points `<app>/current` at `versions/<tag>` in one rename, so no reader ever sees it missing. */
export function flipCurrent(app: string, tag: string): void {
  const next = join(app, "current.new");
  rmSync(next, { force: true });
  symlinkSync(join("versions", tag), next);
  renameSync(next, join(app, "current"));
}

/** The staged version dirs, oldest first. A `.tmp` dir of an interrupted clone is not one. */
export function stagedTags(app: string): string[] {
  const dir = versionsDir(app);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => parseTag(name) !== null)
    .toSorted(compareTags);
}

/** The version dirs a prune keeps, and the ones it removes. */
export interface PruneChoice {
  keep: string[];
  remove: string[];
}

/**
 * Which version dirs a prune keeps: `current`, then `previous` (the rollback
 * target, and the dir a timer started before the flip still runs from), then
 * the newest others, `keep` in all besides `current`.
 */
export function pruneChoice(tags: readonly string[], current: string, previous: string | undefined, keep = 2): PruneChoice {
  const others = tags.filter((tag) => tag !== current).toSorted((a, b) => compareTags(b, a));
  const ordered = previous !== undefined && others.includes(previous) ? [previous, ...others.filter((tag) => tag !== previous)] : others;
  return { keep: [current, ...ordered.slice(0, keep)], remove: ordered.slice(keep) };
}

/** Removes the version dirs `pruneChoice` does not keep. Returns the removed tags. */
export function pruneVersions(app: string, current: string, previous: string | undefined): string[] {
  const { remove } = pruneChoice(stagedTags(app), current, previous);
  for (const tag of remove) rmSync(versionDir(app, tag), { recursive: true, force: true });
  return remove;
}

// --- update.json ------------------------------------------------------------------------

export type UpdateOutcome = "updated" | "rolled-back" | "failed";

export interface UpdateRecord {
  from: string;
  to: string;
  at: string;
  outcome: UpdateOutcome;
  detail: string;
}

/** Writes `<app>/update.json` through a temp file, so a reader never sees half a record. */
export function writeUpdateRecord(app: string, record: UpdateRecord): void {
  const file = join(app, "update.json");
  const temp = `${file}.tmp`;
  writeFileSync(temp, `${JSON.stringify(record, null, 2)}\n`);
  renameSync(temp, file);
}

function isRecord(value: JsonValue): value is { readonly [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isText(value: JsonValue | undefined): value is string {
  return typeof value === "string";
}

// --- update.lock ---------------------------------------------------------------------------

export type UpdateLock = { held: false; release: () => void } | { held: true; pid: number };

function hasErrnoCode(cause: unknown, code: string): boolean {
  return cause instanceof Error && "code" in cause && cause.code === code;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (cause) {
    return !hasErrnoCode(cause, "ESRCH");
  }
}

function createLock(file: string, pid: number): boolean {
  try {
    const fd = openSync(file, "wx");
    try {
      writeSync(fd, `${pid}\n`);
    } finally {
      closeSync(fd);
    }
    return true;
  } catch (cause) {
    if (hasErrnoCode(cause, "EEXIST")) return false;
    throw cause;
  }
}

function lockHolder(file: string): number {
  try {
    return Number.parseInt(readFileSync(file, "utf8").trim(), 10);
  } catch {
    return Number.NaN;
  }
}

/**
 * Takes `<app>/update.lock`. A lock whose PID is dead, or that holds no PID,
 * is stale: it is removed and taken once more. `release` removes the lock
 * only while it still holds this process's PID.
 */
export function takeUpdateLock(app: string, pid: number = process.pid): UpdateLock {
  mkdirSync(app, { recursive: true });
  const file = join(app, "update.lock");
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (createLock(file, pid)) {
      return {
        held: false,
        release: () => {
          if (lockHolder(file) === pid) unlinkSync(file);
        },
      };
    }
    const holder = lockHolder(file);
    if (Number.isInteger(holder) && holder > 0 && isProcessAlive(holder)) return { held: true, pid: holder };
    rmSync(file, { force: true });
  }
  return { held: true, pid: lockHolder(file) };
}

// --- git ------------------------------------------------------------------------------------

type GitResult = { ok: true; stdout: string } | { ok: false; detail: string };

function git(args: readonly string[], timeoutMs: number): GitResult {
  const result = spawnSync("git", [...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: timeoutMs,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  if (result.error !== undefined) return { ok: false, detail: errorMessage(result.error) };
  if (result.status === 0) return { ok: true, stdout: result.stdout };
  const said = result.stderr.trim().split("\n").findLast((line) => line.trim() !== "");
  return { ok: false, detail: said ?? `git ${args[0] ?? ""} exited ${String(result.status)}` };
}

/** The release tags at `source`, oldest first. Not ok when the source cannot be reached. */
export function remoteTags(source: string): { ok: true; tags: string[] } | { ok: false; detail: string } {
  const result = git(["ls-remote", "--tags", "--refs", source], LS_REMOTE_TIMEOUT_MS);
  return result.ok ? { ok: true, tags: tagsFromLsRemote(result.stdout) } : result;
}

/** The `origin` URL of the clone at `dir`, or undefined. */
export function originUrl(dir: string): string | undefined {
  if (!existsSync(join(dir, ".git"))) return undefined;
  const result = git(["-C", dir, "remote", "get-url", "origin"], LS_REMOTE_TIMEOUT_MS);
  const url = result.ok ? result.stdout.trim() : "";
  return url === "" ? undefined : url;
}

/** The `version` in `<dir>/package.json`, or undefined. */
export function packageVersion(dir: string): string | undefined {
  try {
    const parsed: JsonValue = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    if (!isRecord(parsed)) return undefined;
    const { version } = parsed;
    return isText(version) ? version : undefined;
  } catch {
    return undefined;
  }
}

export type StageResult = { ok: true; cloned: boolean } | { ok: false; detail: string };

/**
 * Makes sure `versions/<tag>` holds tag `<tag>`: a shallow clone into
 * `versions/<tag>.tmp`, a check that its package.json carries the tag's
 * version, then a rename. A dir that is already there is kept as it is.
 */
export function stageVersion(app: string, tag: string, source: string): StageResult {
  const final = versionDir(app, tag);
  if (existsSync(final)) return { ok: true, cloned: false };
  const temp = `${final}.tmp`;
  rmSync(temp, { recursive: true, force: true });
  mkdirSync(versionsDir(app), { recursive: true });
  const clone = git(["clone", "-q", "--depth", "1", "--branch", tag, source, temp], CLONE_TIMEOUT_MS);
  if (!clone.ok) {
    rmSync(temp, { recursive: true, force: true });
    return { ok: false, detail: `could not clone ${tag} from ${source}: ${clone.detail}` };
  }
  const version = packageVersion(temp);
  if (version !== tagVersion(tag)) {
    rmSync(temp, { recursive: true, force: true });
    return { ok: false, detail: `tag ${tag} carries package.json version ${version ?? "(none)"}, not ${tagVersion(tag)}. Refused.` };
  }
  renameSync(temp, final);
  return { ok: true, cloned: true };
}
