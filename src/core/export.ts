/**
 * `darius export`: the nightly backup (docs/concept.md, "Backup").
 *
 * It mirrors this host's state dir (the store: `_global`, every project dir,
 * the digests) into `<clone>/<host>/` of a private backup git repo, writes
 * `<clone>/<host>/EXPORT.json`, commits when something changed, and pushes.
 * One directory per host, not per project: every host holds its own local
 * copy of the store, and two hosts must never write the same paths, so their
 * commits never conflict.
 *
 * The config dir is never exported: it holds credentials, keys and push
 * secrets. Before it copies, the export scans the store for names that look
 * like secrets and refuses when it finds one.
 *
 * Git runs as a child process with no terminal prompt. The fetch is a
 * `fetch` plus a `rebase` onto the remote branch, not `pull --ff-only`: a
 * commit left local by an offline night must still land on top of another
 * host's push. Hosts write disjoint directories, so the rebase never
 * conflicts on the files darius wrote.
 */

import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import { errorMessage } from "../runtime.ts";
import type { Config } from "./config.ts";

/** The manifest file the export writes at the top of `<clone>/<host>/`. */
export const MANIFEST_NAME = "EXPORT.json";

/** One regular file in the store, relative to the store root with `/` separators. */
export interface StoreFile {
  path: string;
  bytes: number;
}

/** A walk of the store: its regular files, and anything else (a link, a socket) it cannot copy. */
export interface StoreListing {
  files: StoreFile[];
  other: string[];
}

/** What a mirror did, or would do in a dry run. */
export interface MirrorReport {
  files: number;
  bytes: number;
  copied: number;
  deleted: number;
  /** Paths that are not regular files or directories; not copied, reported as warnings. */
  other: string[];
}

export interface ExportManifest {
  v: 1;
  host: string;
  at: string;
  darius: string;
  files: number;
  bytes: number;
}

// --- the store walk -----------------------------------------------------------------

function toPosix(path: string): string {
  return sep === "/" ? path : path.split(sep).join("/");
}

function sortedEntries(dir: string): string[] {
  return readdirSync(dir).toSorted();
}

/** Every regular file under `root`, sorted, with its size. Links and other file types go to `other`. */
export function listStore(root: string): StoreListing {
  const listing: StoreListing = { files: [], other: [] };
  const walk = (dir: string): void => {
    for (const name of sortedEntries(dir)) {
      const full = join(dir, name);
      const stat = lstatSync(full);
      const rel = toPosix(relative(root, full));
      if (stat.isDirectory()) walk(full);
      else if (stat.isFile()) listing.files.push({ path: rel, bytes: stat.size });
      else listing.other.push(rel);
    }
  };
  walk(root);
  return listing;
}

// --- the secret scan ----------------------------------------------------------------

const SECRET_NAMES = new Set(["credentials", "keys"]);
const SECRET_SUFFIXES = [".pem", ".key", ".credentials"];

/** True when one path segment looks like a secret: `credentials`, `keys`, `*.pem`, `*.key`, `*.credentials`. */
function isSecretName(segment: string): boolean {
  const lower = segment.toLowerCase();
  return SECRET_NAMES.has(lower) || SECRET_SUFFIXES.some((suffix) => lower.endsWith(suffix));
}

/** The store paths with a file or directory name that looks like a secret. Blobs and ledgers pass. */
export function findSecretNames(paths: readonly string[]): string[] {
  return paths.filter((path) => path.split("/").some((segment) => isSecretName(segment)));
}

// --- the mirror -----------------------------------------------------------------------

function sameContent(source: string, dest: string, bytes: number): boolean {
  const stat = lstatSync(dest, { throwIfNoEntry: false });
  if (stat === undefined || !stat.isFile() || stat.size !== bytes) return false;
  return readFileSync(source).equals(readFileSync(dest));
}

/**
 * Removes everything under `dest` that the source does not have, except the
 * top-level names in `keep`. Returns how many files it removed (or would).
 */
function deleteStale(dest: string, wanted: ReadonlySet<string>, wantedDirs: ReadonlySet<string>, keep: ReadonlySet<string>, dryRun: boolean): number {
  let deleted = 0;
  const walk = (dir: string): void => {
    for (const name of sortedEntries(dir)) {
      const full = join(dir, name);
      const rel = toPosix(relative(dest, full));
      if (keep.has(rel)) continue;
      const stat = lstatSync(full);
      if (stat.isDirectory() && wantedDirs.has(rel)) {
        walk(full);
        continue;
      }
      if (!stat.isDirectory() && wanted.has(rel)) continue;
      if (stat.isDirectory()) {
        const inside = listStore(full);
        deleted += inside.files.length + inside.other.length;
      } else {
        deleted += 1;
      }
      if (!dryRun) rmSync(full, { recursive: true, force: true });
    }
  };
  if (existsSync(dest)) walk(dest);
  return deleted;
}

function parentDirs(path: string): string[] {
  const parts = path.split("/");
  const dirs: string[] = [];
  for (let index = 1; index < parts.length; index += 1) dirs.push(parts.slice(0, index).join("/"));
  return dirs;
}

/**
 * Makes `dest` a copy of `source`: copies each regular file whose content
 * differs, and deletes every file and directory that `source` does not have.
 * The top-level names in `keep` (the manifest) are left alone. With `dryRun`
 * it counts and writes nothing.
 */
export function mirrorTree(source: string, dest: string, options: { dryRun?: boolean; keep?: readonly string[] } = {}): MirrorReport {
  const dryRun = options.dryRun === true;
  const keep = new Set(options.keep ?? []);
  const listing = listStore(source);
  const wanted = new Set(listing.files.map((file) => file.path));
  const wantedDirs = new Set(listing.files.flatMap((file) => parentDirs(file.path)));
  const deleted = deleteStale(dest, wanted, wantedDirs, keep, dryRun);

  let copied = 0;
  for (const file of listing.files) {
    const from = join(source, file.path);
    const to = join(dest, file.path);
    if (sameContent(from, to, file.bytes)) continue;
    copied += 1;
    if (dryRun) continue;
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(from, to);
  }
  const bytes = listing.files.reduce((sum, file) => sum + file.bytes, 0);
  return { files: listing.files.length, bytes, copied, deleted, other: listing.other };
}

/** Writes `<dest>/EXPORT.json`. */
export function writeManifest(dest: string, manifest: ExportManifest): void {
  mkdirSync(dest, { recursive: true });
  writeFileSync(join(dest, MANIFEST_NAME), `${JSON.stringify(manifest, null, 2)}\n`);
}

/** `1234` -> `1.2 KiB`. */
export function formatBytes(bytes: number): string {
  const units = ["KiB", "MiB", "GiB", "TiB"];
  if (bytes < 1024) return `${bytes} B`;
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit] ?? "TiB"}`;
}

// --- git ----------------------------------------------------------------------------

interface GitResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

function git(cwd: string, args: readonly string[]): GitResult {
  const ran = spawnSync("git", [...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  if (ran.error !== undefined) throw new Error(`cannot run git: ${errorMessage(ran.error)}`);
  return { ok: ran.status === 0, stdout: ran.stdout.trim(), stderr: ran.stderr.trim() };
}

/** Runs git and throws with its stderr when it fails. */
function gitOrThrow(cwd: string, args: readonly string[], what: string): string {
  const result = git(cwd, args);
  if (!result.ok) throw new Error(`${what}: ${result.stderr || `git ${args.join(" ")} failed`}`);
  return result.stdout;
}

/** The first line of git's stderr, for a warning. */
function firstLine(text: string): string {
  return text.split("\n").find((line) => line.trim() !== "") ?? "no output";
}

function isEmptyDir(path: string): boolean {
  return lstatSync(path).isDirectory() && readdirSync(path).length === 0;
}

function hasCommits(clone: string): boolean {
  return git(clone, ["rev-parse", "--verify", "--quiet", "HEAD"]).ok;
}

function currentBranch(clone: string): string {
  return gitOrThrow(clone, ["symbolic-ref", "--short", "HEAD"], "the backup clone has no branch checked out");
}

function remoteRef(branch: string): string {
  return `refs/remotes/origin/${branch}`;
}

function hasRemoteBranch(clone: string, branch: string): boolean {
  return git(clone, ["rev-parse", "--verify", "--quiet", remoteRef(branch)]).ok;
}

/** Refuses a `dir` that is not a git clone of `repo`. */
function checkClone(clone: string, repo: string): void {
  if (!existsSync(join(clone, ".git"))) {
    throw new Error(`${clone} exists but is not a git clone. Remove it, or point [backup] dir somewhere else.`);
  }
  const origin = git(clone, ["remote", "get-url", "origin"]);
  if (!origin.ok || origin.stdout !== repo) {
    const found = origin.ok ? `"${origin.stdout}"` : "no origin";
    throw new Error(`${clone} is a clone of ${found}, not of [backup] repo "${repo}". Refusing to export into it.`);
  }
}

/**
 * Brings the clone up to date with origin: fetch, then move onto the remote
 * branch. An unborn branch checks the remote branch out; a branch with
 * commits rebases onto it, so a commit an offline night left local lands on
 * top. Returns a warning when the fetch failed (offline): the export then
 * continues with the local clone.
 */
function updateClone(clone: string): string | undefined {
  const fetched = git(clone, ["fetch", "--quiet", "origin"]);
  if (!fetched.ok) return `cannot fetch from origin, continuing with the local clone (${firstLine(fetched.stderr)})`;
  const branch = currentBranch(clone);
  if (!hasRemoteBranch(clone, branch)) return undefined;
  if (!hasCommits(clone)) {
    gitOrThrow(clone, ["checkout", "--quiet", "-f", "-B", branch, remoteRef(branch)], "cannot check out the backup branch");
    return undefined;
  }
  const rebased = git(clone, ["rebase", "--quiet", "--autostash", remoteRef(branch)]);
  if (!rebased.ok) {
    git(clone, ["rebase", "--abort"]);
    throw new Error(`cannot rebase the backup clone onto origin/${branch}: ${firstLine(rebased.stderr)}`);
  }
  return undefined;
}

/** `-c` flags for the commit: no signing prompt, and a fallback identity on a host without one. */
function commitConfig(clone: string, host: string): string[] {
  const flags = ["-c", "commit.gpgsign=false"];
  if (!git(clone, ["config", "user.name"]).ok) flags.push("-c", "user.name=darius");
  if (!git(clone, ["config", "user.email"]).ok) flags.push("-c", `user.email=darius@${host}.invalid`);
  return flags;
}

/** Commits `<host>/` when it changed. Returns the short sha, or undefined when nothing changed. */
function commitHost(clone: string, host: string, at: string): string | undefined {
  gitOrThrow(clone, ["add", "-A", "--", host], "git add failed");
  if (git(clone, ["diff", "--cached", "--quiet", "--", host]).ok) return undefined;
  gitOrThrow(clone, [...commitConfig(clone, host), "commit", "--quiet", "-m", `export ${host} ${at}`, "--", host], "git commit failed");
  return gitOrThrow(clone, ["rev-parse", "--short", "HEAD"], "git rev-parse failed");
}

/** How many local commits origin does not have yet. */
function aheadCount(clone: string, branch: string): number {
  if (!hasCommits(clone)) return 0;
  const range = hasRemoteBranch(clone, branch) ? `${remoteRef(branch)}..HEAD` : "HEAD";
  return Number.parseInt(gitOrThrow(clone, ["rev-list", "--count", range], "git rev-list failed"), 10);
}

function isRejected(stderr: string): boolean {
  return /\[rejected\]|non-fast-forward|fetch first/u.test(stderr);
}

/**
 * Pushes the branch. When another host pushed in between, it fetches,
 * rebases and pushes once more. Returns a warning when the push failed
 * (offline): the commit stays local for the next run.
 */
function pushClone(clone: string, branch: string): string | undefined {
  const args = ["push", "--quiet", "-u", "origin", `${branch}:refs/heads/${branch}`];
  let pushed = git(clone, args);
  if (!pushed.ok && isRejected(pushed.stderr)) {
    const warning = updateClone(clone);
    if (warning !== undefined) return `push failed, the commit stays local (${warning})`;
    pushed = git(clone, args);
  }
  return pushed.ok ? undefined : `push failed, the commit stays local (${firstLine(pushed.stderr)})`;
}

// --- the export -----------------------------------------------------------------------

export interface ExportOptions {
  config: Config;
  /** The store root, `stateDir()`. */
  stateDir: string;
  /** The config dir, `configDir()`. Never exported. */
  configDir: string;
  /** darius's version, for the manifest. */
  version: string;
  dryRun?: boolean;
  now?: Date;
}

export interface ExportResult {
  /** 0 done; 3 the push failed or the clone could not be made (offline): try again on the next run. */
  code: 0 | 3;
  dryRun: boolean;
  host: string;
  repo: string;
  /** The local clone. */
  dir: string;
  files: number;
  bytes: number;
  copied: number;
  deleted: number;
  /** The short sha of the new commit, or null when nothing changed (or a dry run). */
  commit: string | null;
  /** How many commits reached origin in this run. */
  pushed: number;
  /** True when the dry run found no clone yet and would clone first. */
  wouldClone: boolean;
  warnings: string[];
}

const HOST_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;

function isInside(child: string, parent: string): boolean {
  const rel = relative(parent, child);
  if (rel === "") return true;
  return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

/** Refuses a layout where the export would copy the config dir, or copy the clone into itself. */
function checkLayout(state: string, config: string, clone: string, host: string): void {
  if (!HOST_NAME.test(host) || host === ".git") {
    throw new Error(`host "${host}" cannot name a directory in the backup repo: use letters, digits, ".", "_" or "-"`);
  }
  if (!existsSync(state)) throw new Error(`no store at ${state}: nothing to export`);
  if (isInside(config, state) || isInside(state, config)) {
    throw new Error(`the store ${state} and the config dir ${config} overlap. The config dir holds secrets and is never exported.`);
  }
  if (isInside(clone, state) || isInside(state, clone)) {
    throw new Error(`[backup] dir ${clone} and the store ${state} overlap. Point [backup] dir outside the store.`);
  }
}

function emptyResult(options: ExportOptions, host: string, repo: string, dir: string): ExportResult {
  return {
    code: 0,
    dryRun: options.dryRun === true,
    host,
    repo,
    dir,
    files: 0,
    bytes: 0,
    copied: 0,
    deleted: 0,
    commit: null,
    pushed: 0,
    wouldClone: false,
    warnings: [],
  };
}

/**
 * Runs one export. Throws on a refusal (a foreign clone, a secret-looking
 * name, an overlap of the store and the config dir); returns code 3 when the
 * network is missing. The caller checks that `[backup]` is set.
 */
export function runExport(options: ExportOptions): ExportResult {
  const backup = options.config.backup;
  if (backup === undefined) throw new Error("backup not configured: add a [backup] table with repo to config.toml");
  const host = options.config.host;
  const clone = resolve(backup.dir);
  const state = resolve(options.stateDir);
  checkLayout(state, resolve(options.configDir), clone, host);
  const result = emptyResult(options, host, backup.repo, clone);

  const listing = listStore(state);
  const secrets = findSecretNames([...listing.files.map((file) => file.path), ...listing.other]);
  if (secrets.length > 0) {
    throw new Error(
      `the store holds names that look like secrets: ${secrets.join(", ")}. ` +
        "Secrets belong in the config dir, which is never exported. Move them out of the store, then re-run.",
    );
  }

  const needsClone = !existsSync(clone) || isEmptyDir(clone);
  if (!needsClone) checkClone(clone, backup.repo);
  const dest = join(clone, host);

  if (options.dryRun === true) {
    const plan = mirrorTree(state, dest, { dryRun: true, keep: [MANIFEST_NAME] });
    return { ...result, files: plan.files, bytes: plan.bytes, copied: plan.copied, deleted: plan.deleted, wouldClone: needsClone, warnings: plan.other.map((path) => `not a regular file, skipped: ${path}`) };
  }

  if (needsClone) {
    mkdirSync(dirname(clone), { recursive: true });
    const cloned = git(dirname(clone), ["clone", "--quiet", backup.repo, clone]);
    if (!cloned.ok) {
      return { ...result, code: 3, warnings: [`cannot clone ${backup.repo} (${firstLine(cloned.stderr)})`] };
    }
  } else {
    const warning = updateClone(clone);
    if (warning !== undefined) result.warnings.push(warning);
  }

  const report = mirrorTree(state, dest, { keep: [MANIFEST_NAME] });
  for (const path of report.other) result.warnings.push(`not a regular file, skipped: ${path}`);
  const at = (options.now ?? new Date()).toISOString();
  if (report.copied > 0 || report.deleted > 0 || !existsSync(join(dest, MANIFEST_NAME))) {
    writeManifest(dest, { v: 1, host, at, darius: options.version, files: report.files, bytes: report.bytes });
  }

  const commit = commitHost(clone, host, at) ?? null;
  const branch = currentBranch(clone);
  const ahead = aheadCount(clone, branch);
  const done = { ...result, files: report.files, bytes: report.bytes, copied: report.copied, deleted: report.deleted, commit };
  if (ahead === 0) return done;
  const failed = pushClone(clone, branch);
  if (failed !== undefined) return { ...done, code: 3, warnings: [...done.warnings, failed] };
  return { ...done, pushed: ahead };
}

/** The one line `darius export` prints. */
export function describeExport(result: ExportResult): string {
  const size = `${result.files} files, ${formatBytes(result.bytes)}`;
  if (result.dryRun) {
    const clone = result.wouldClone ? `, would clone ${result.repo} into ${result.dir} first` : "";
    return `· export (dry run): ${size} in the store; would copy ${result.copied}, delete ${result.deleted} in ${join(result.dir, result.host)}${clone}`;
  }
  if (result.code === 3) {
    return result.commit === null ? `! export: ${size}, not pushed` : `! export: ${size}, committed ${result.commit}, not pushed`;
  }
  if (result.commit !== null) return `✓ export: ${size}, committed ${result.commit} and pushed`;
  if (result.pushed > 0) return `✓ export: nothing changed, pushed ${result.pushed} earlier commit${result.pushed === 1 ? "" : "s"}`;
  return `· export: nothing changed (${size})`;
}
