/**
 * The box layout: the bwrap argv and the scrubbed environment of one run in
 * the box (`[run] sandbox = "box"`, 0.117.0). This file is PURE. Every fact
 * about the filesystem (what exists, what is a symlink, where it points) and
 * the host (home, uid, runtime dir, store and config dirs, the mask list)
 * comes in through `BoxFacts`, so the tests can drive every rule without a
 * real bwrap. `src/core/box-host.ts` reads those facts on a real host and
 * prepares the copies the plan names. src/runner/box-launch.ts launches through it.
 *
 * The layout, in order. A later mount covers an earlier one, so the order
 * is the rule:
 *
 *   --ro-bind / /  --dev /dev  --proc /proc  --tmpfs /tmp  --tmpfs /run
 *   re-binds of /run/current-system, /run/wrappers, /run/opengl-driver,
 *     /run/booted-system when present (a symlink stays a symlink)
 *   --tmpfs /var/tmp                        terminal and browser sockets live there
 *   --dir /var/tmp/cache, /var/tmp/npm      XDG_CACHE_HOME and npm's cache, per run
 *   --perms 0700 --tmpfs $XDG_RUNTIME_DIR   no session bus, no host sockets
 *   --ro-bind <box dir> /run/darius         proxy and broker sockets, ssh wrapper
 *   --ro-bind <store>, --ro-bind <config>   read-only even under /tmp or /run
 *   --bind <each writable extra>            host `[box] writable`, then ritual `writable`
 *   --tmpfs <each hidden home folder>       HIDDEN_HOME_DIRS: socket nests
 *   --bind <agent socket>                   only when the run may use ssh
 *   --bind <work dir>                       --ro-bind in report mode, or in the store
 *   --ro-bind <work>/.git, <work>/.claude, <work>/.darius.toml on themselves
 *   --ro-bind <run dir>, --bind gate.jsonl, --bind scratch/
 *   --ro-bind ~/.claude, then the adapter's `boxWritable` (--bind, or
 *     --ro-bind over a writable one), a --tmpfs on each `boxScratch`, the per-run copies
 *   --tmpfs <masked dir>, --ro-bind /dev/null <masked file>
 *   --ro-bind /dev/null <each socket the home scan found>, but the bound agent
 *   --unshare-net --unshare-pid --die-with-parent [--new-session]
 *   --clearenv --setenv ... -- <command>
 *
 * The writable extras come before the work dir, so an extra that holds the
 * work dir cannot undo report mode or the read-only `.git`. The masks
 * come last, so no bind can uncover a secret.
 *
 * `.git` is one read-only mount on its own path (a folder, or the file of a
 * linked worktree), so a run can neither write it nor rename or remove it: a
 * mount point cannot be moved. A run in the box cannot commit; that is the
 * choice Codex's workspace-write sandbox makes too.
 *
 * Refused, with an error that names the path: a writable extra inside or
 * holding the store, the darius config or app dir, `~/.claude`, `~/.ssh`,
 * `~/.config/systemd`, `~/.config/autostart`, a shell rc file, the other
 * files a later unboxed session runs (`~/.local/bin`, git config, every PATH
 * entry of the runner), `/`, `/proc`, `/sys`, `/dev`, `/run` or `/tmp`;
 * `~/.cache` itself; a work dir that holds any of those. Each is checked as
 * written and with its symlinks resolved. A `.git`, `.claude` or
 * `.darius.toml` in the work dir that is a link is refused: a link in a
 * writable folder can be swapped, and bwrap mounts on its target.
 */

import { isIP } from "node:net";
import { basename, dirname, join, normalize } from "node:path";

import type { SecretPaths } from "../harness/gate.ts";
import type { MaskedPaths } from "./sandbox.ts";

/** One `host:port` pair: a `reach` entry, or a host the harness must reach. */
export interface HostPort {
  host: string;
  port: number;
}

/** A ritual's `net`: public addresses plus `reach`, only `reach`, or nothing but the harness API. */
export const BOX_NETS = ["public", "listed", "none"] as const;
export type BoxNet = (typeof BOX_NETS)[number];

/** The tools a ritual's `tools` may name. `gh` unmasks `~/.config/gh/hosts.yml` for that ritual. */
export const BOX_TOOLS = ["gh"] as const;
export type BoxTool = (typeof BOX_TOOLS)[number];

/** Where the box dir shows inside the box. */
export const BOX_MOUNT = "/run/darius";
/** The wrappers (ssh, scp, sftp) that spec 03 writes into the box dir. First on PATH. */
export const BOX_BIN = `${BOX_MOUNT}/bin`;
/** The proxy socket inside the box (src/core/box-proxy.ts listens on `<box dir>/proxy.sock`). */
export const BOX_PROXY_SOCKET = `${BOX_MOUNT}/proxy.sock`;
/** The broker socket inside the box (src/core/box-broker.ts listens on `<box dir>/broker.sock`). */
export const BOX_BROKER_SOCKET = `${BOX_MOUNT}/broker.sock`;

/**
 * Host `[box] writable` when the key is absent: nothing (0.122.0). Shared
 * caches hold code and files that later unboxed runs and shells load (pnpm's
 * global bins on PATH, fish completions in `~/.cache`, `~/.npm/_npx`, cargo and
 * go sources). Inside the box `XDG_CACHE_HOME` and npm's cache are per run
 * under the /var/tmp tmpfs. An operator who wants a shared cache names it in
 * host config and owns that risk.
 */
export const DEFAULT_BOX_WRITABLE: readonly string[] = [];

/** XDG_CACHE_HOME inside the box: on the /var/tmp tmpfs, so gone after the run. */
export const BOX_CACHE_HOME = "/var/tmp/cache";
/** npm's cache inside the box (`npm_config_cache`), on the same tmpfs. */
export const BOX_NPM_CACHE = "/var/tmp/npm";

/** The NixOS paths under /run that programs need; re-bound after the /run tmpfs when present. */
export const RUN_REBINDS: readonly string[] = ["/run/current-system", "/run/wrappers", "/run/opengl-driver", "/run/booted-system"];

/** System dirs a writable path may not be in, or hold. */
const SYSTEM_ROOTS: readonly string[] = ["/proc", "/sys", "/dev", "/run", "/tmp", "/var/tmp"];

/**
 * Folders under home that hold sockets to programs outside the box (a
 * terminal multiplexer, browsers, password managers, editors, flatpak apps,
 * rootless containers). Each is a tmpfs in the box when it exists. A socket
 * on a read-only mount still connects (probed 2026-11-02), so read-only is
 * not enough. A writable path or a work dir in one of them is refused.
 */
export const HIDDEN_HOME_DIRS: readonly string[] = [
  ".local/share/containers", ".var", ".config/herdr", ".config/herdr-app", ".local/state", ".mozilla",
  ".config/google-chrome", ".config/chromium", ".config/browser-harness", ".cache/com.bitwarden.desktop", ".local/share/zed",
];

/**
 * Paths under home a writable path may not be in, or hold: the harness config
 * and login, ssh, what starts processes in a later session (systemd, autostart,
 * the shell rc files, `~/.local/bin`, git config), and the default darius
 * store, config and app dirs (the real ones come in `ProtectedDirs` too).
 */
const HOME_PROTECTED: readonly string[] = [
  ".claude", ".claude.json", ".ssh", ".config/systemd", ".config/autostart", ".config/environment.d", ".pam_environment",
  ".bashrc", ".bash_profile", ".bash_login", ".bash_logout", ".profile",
  ".zshrc", ".zshenv", ".zprofile", ".zlogin", ".zlogout", ".config/fish",
  ".local/bin", ".gitconfig", ".config/git",
  ".local/share/darius", ".config/darius", ".local/opt/darius",
];

/** The env names the box sets itself, besides `LC_*`, `DARIUS_*` and the proxy variables. */
const FIXED_ENV: ReadonlySet<string> = new Set(["HOME", "USER", "LOGNAME", "PATH", "TERM", "LANG", "TZ", "XDG_RUNTIME_DIR", "SSH_AUTH_SOCK", "XDG_CACHE_HOME", "npm_config_cache", "NPM_CONFIG_CACHE"]);
const PROXY_ENV: ReadonlySet<string> = new Set(["HTTPS_PROXY", "HTTP_PROXY", "ALL_PROXY", "NO_PROXY", "NODE_USE_ENV_PROXY"]);
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;
const PORT = /^[1-9][0-9]{0,4}$/u;
const NAME_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;
const DOTTED_QUAD = /^(?:25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])(?:\.(?:25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])){3}$/u;
const NUMERIC_LABEL = /^(?:[0-9]+|0x[0-9a-f]*)$/u;
const LOOPBACK_NAMES: ReadonlySet<string> = new Set(["localhost", "localhost.localdomain", "ip6-localhost", "ip6-loopback"]);

/** A box plan that cannot be built: a refused path, a missing fact. The message names what and why. */
export class BoxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BoxError";
  }
}

// --- the marker and config keys ---------------------------------------------------

/** True when `child` is `parent` or lies below it. Both normalized and absolute. */
export function isWithin(child: string, parent: string): boolean {
  if (parent === "/") return true;
  return child === parent || child.startsWith(`${parent}/`);
}

/** `~` and `~/...` as the home folder; anything else as written. */
export function expandTilde(path: string, home: string): string {
  if (path === "~") return home;
  return path.startsWith("~/") ? join(home, path.slice(2)) : path;
}

/** The dirs a writable path is checked against: the real store, config and app dirs, the runtime dir, the runner's PATH. */
export interface ProtectedDirs {
  home: string;
  store: string;
  config: string;
  app: string;
  runtimeDir?: string;
  /** The runner's PATH entries. The plan passes them; a load check without them skips that rule. */
  pathEntries?: readonly string[];
}

/** Every path a writable path may not be in or hold, besides `/` and the system dirs. */
export function protectedPaths(dirs: ProtectedDirs): string[] {
  const paths = [dirs.store, dirs.config, dirs.app, ...HOME_PROTECTED.map((name) => join(dirs.home, name))];
  if (dirs.runtimeDir !== undefined) paths.push(dirs.runtimeDir);
  return [...new Set(paths.map((path) => normalize(path)))];
}

/** What a writable path is checked against. */
interface Guard {
  guarded: readonly string[];
  hidden: readonly string[];
  home: string;
  /** PATH entries, absolute: a later unboxed shell runs what is in them. */
  pathEntries: readonly string[];
}

/** The system roots the box puts a tmpfs on, where a test home may live. */
const TMP_ROOTS: readonly string[] = ["/tmp", "/var/tmp"];

/** The hidden folders of `home`, as paths. */
export function hiddenHomeDirs(home: string): string[] {
  return HIDDEN_HOME_DIRS.map((name) => join(home, name));
}

/**
 * Why `absolute` may not be bound writable, or undefined. `absolute` is
 * normalized. A path may hold a hidden folder (the tmpfs comes after the
 * writable binds), but not lie in one.
 */
function protectedProblem(absolute: string, guard: Guard): string | undefined {
  const { guarded, hidden } = guard;
  if (absolute === "/") return "it is the root";
  if (absolute === join(guard.home, ".cache")) return "it is the cache folder, which holds files shells and tools load later; name a folder in it";
  // A home under /tmp or /var/tmp (a throwaway one) is bound back read-only, so a path in it is a home path.
  const isInHome = isWithin(absolute, guard.home) && absolute !== guard.home;
  for (const root of SYSTEM_ROOTS) {
    if (isWithin(absolute, root) && !(isInHome && TMP_ROOTS.includes(root))) return `it is in ${root}`;
    if (isWithin(root, absolute)) return `it holds ${root}`;
  }
  for (const path of guarded) {
    if (isWithin(absolute, path)) return `it is in ${path}`;
    if (isWithin(path, absolute)) return `it holds ${path}`;
  }
  for (const path of guard.pathEntries) {
    if (isWithin(absolute, path)) return `it is in ${path}, a PATH entry`;
    if (isWithin(path, absolute)) return `it holds ${path}, a PATH entry`;
  }
  const inHidden = hidden.find((dir) => isWithin(absolute, dir));
  return inHidden === undefined ? undefined : `it is in ${inHidden}, which the box hides`;
}

/**
 * Why a `writable` entry as written is refused, or undefined: it must start
 * with `~/` or `/`, have no `..`, and not be in or hold a protected path.
 * The marker and config check this at load; the plan checks it again with
 * symlinks resolved.
 */
export function writableProblem(path: string, dirs: ProtectedDirs): string | undefined {
  if (path !== "~" && !path.startsWith("~/") && !path.startsWith("/")) return "it must start with ~/ or /";
  if (path.split("/").includes("..")) return "it must not contain ..";
  const home = normalize(dirs.home);
  return protectedProblem(normalize(expandTilde(path, home)), { guarded: protectedPaths(dirs), hidden: hiddenHomeDirs(home), home, pathEntries: absoluteEntries(dirs.pathEntries ?? []) });
}

/** The absolute entries of a PATH list, normalized. A relative entry is left out: the box drops it too. */
function absoluteEntries(entries: readonly string[]): string[] {
  return [...new Set(entries.filter((entry) => entry.startsWith("/")).map((entry) => normalize(entry)))];
}

/** A port as written in a `host:port` pair: 1 to 65535, decimal, no leading zero. */
function parsePort(text: string): number | undefined {
  if (!PORT.test(text)) return undefined;
  const port = Number(text);
  return port <= 65_535 ? port : undefined;
}

/** Why `host` (lower case, brackets removed) is not a host a `reach` entry may name, or undefined. */
function hostProblem(host: string, isBracketed: boolean): string | undefined {
  if (isBracketed) {
    if (isIP(host) !== 6) return "the part in brackets must be an IPv6 address";
    if (host === "::" || host === "::1" || host.startsWith("::ffff:")) return "the box never reaches this address";
    return undefined;
  }
  if (DOTTED_QUAD.test(host)) return host.startsWith("127.") || host === "0.0.0.0" ? "the box never reaches loopback" : undefined;
  if (host.length > 253) return "the name is longer than 253 characters";
  const labels = host.split(".");
  if (labels.some((label) => !NAME_LABEL.test(label))) return "a name is letters, digits, '-' and dots, with no trailing dot";
  if (labels.every((label) => NUMERIC_LABEL.test(label)) || NUMERIC_LABEL.test(labels.at(-1) ?? "")) {
    return "an IPv4 address must be four decimal numbers, like 192.0.2.10";
  }
  if (LOOPBACK_NAMES.has(host) || host.endsWith(".localhost")) return "the box never reaches loopback";
  return undefined;
}

/**
 * One `reach` entry: `host:port`, `[v6]:port`. The host is lower-cased.
 * Throws a plain Error that says what is wrong; the caller adds the file and line.
 */
export function parseHostPort(text: string): HostPort {
  const fail = (why: string): Error => new Error(`"${text}" is not host:port: ${why}`);
  const bracketed = /^\[([^\]]+)\]:([^:]+)$/u.exec(text);
  const plain = /^([^:[\]]+):([^:]+)$/u.exec(text);
  const match = bracketed ?? plain;
  if (match === null) throw fail("write it like git.example.com:22 or [2001:db8::1]:443");
  const host = (match[1] ?? "").toLowerCase();
  const port = parsePort(match[2] ?? "");
  if (port === undefined) throw fail("the port must be a number from 1 to 65535");
  const problem = hostProblem(host, bracketed !== null);
  if (problem !== undefined) throw fail(problem);
  return { host, port };
}

/** A HostPort as `host:port`, with brackets around an IPv6 address. */
export function hostPortText(target: HostPort): string {
  return isIP(target.host) === 6 ? `[${target.host}]:${String(target.port)}` : `${target.host}:${String(target.port)}`;
}

/** True for a name the box sets itself, so neither `env_pass` nor an adapter may pass it in. */
export function isBoxSetEnv(name: string): boolean {
  const upper = name.toUpperCase();
  return FIXED_ENV.has(name) || name.startsWith("LC_") || upper.startsWith("DARIUS_") || PROXY_ENV.has(upper);
}

/** Why `name` may not be in a profile's `env_pass`, or undefined. */
export function envPassProblem(name: string): string | undefined {
  if (!ENV_NAME.test(name)) return `"${name}" is not an environment variable name`;
  if (isBoxSetEnv(name)) return `"${name}" is set by the box itself`;
  return undefined;
}

// --- the plan ---------------------------------------------------------------------

/**
 * What is at a path, with symlinks followed: the real path and its type.
 * `link` is the symlink's own target text when the path itself is a symlink.
 * undefined when nothing is there, or a symlink points nowhere.
 */
export interface BoxEntry {
  real: string;
  kind: "file" | "dir" | "other";
  link?: string;
}

/** The host facts a plan is built from. `src/core/box-host.ts` reads them on a real host. */
export interface BoxFacts {
  home: string;
  user: string;
  uid: number;
  /** `$XDG_RUNTIME_DIR`: the box dir lives under it, and the box gets an empty one. */
  runtimeDir: string;
  /** The darius store dir (`stateDir()`). */
  store: string;
  /** The darius config dir (`configDir()`). */
  config: string;
  /** The darius app dir (`appDir()`). */
  app: string;
  /** The runner's environment, where TERM, LANG, LC_*, TZ, SSH_AUTH_SOCK, PATH and the passed names come from. */
  env: BoxEnv;
  /** The mask list of src/core/sandbox.ts, `maskedPaths()`. */
  masked: MaskedPaths;
  /** The gate's secret list, `secretPaths()` of src/harness/gate.ts. */
  secrets: SecretPaths;
  /** The socket scan of home (`scanSockets` in src/core/box-host.ts): each socket outside the hidden folders is masked. */
  sockets: SocketScan;
  entry(path: string): BoxEntry | undefined;
}

/** The sockets found under home. `timedOut`: the scan hit its time cap, so `found` may be short. */
export interface SocketScan {
  found: readonly string[];
  timedOut: boolean;
  /** How long the scan may take, for the warning. */
  capMs: number;
}

/** An environment: every variable a plain string. */
export interface BoxEnv {
  [name: string]: string;
}

/** A ritual's box keys from the marker. A RepoRitual fits; every key may be absent. */
export interface RitualBoxKeys {
  net?: BoxNet;
  /** `reach` entries as `host:port` text (marker.ts keeps them that way). */
  reach?: readonly string[];
  writable?: readonly string[];
  sshAgent?: boolean;
  tools?: readonly string[];
}

/** The host's `[box]` table. `writable` undefined means the default, an empty list. */
export interface HostBoxSettings {
  writable?: readonly string[];
  sshAgent: boolean;
}

/**
 * One path of the harness login or session state, bound over the read-only
 * `~/.claude` at its own path. A missing path is left out, unless
 * `isMadeWhenMissing`: then the launcher makes the folder, empty, before the
 * launch. `isReadOnly`: a read-only bind over a writable path listed before it
 * (Claude Code's memory folder in the projects folder); it must not be a link.
 */
export interface BoxHarnessPath {
  path: string;
  isReadOnly?: boolean;
  isMadeWhenMissing?: boolean;
}

/** What the plan needs of the harness adapter (src/harness/contract.ts). */
export interface BoxHarness {
  /** Persistent paths, in bind order. `workDir` is the work dir's real path, as the harness sees it. */
  boxWritable(home: string, workDir: string): BoxHarnessPath[];
  /** Per-run folders: an empty tmpfs over the real one, which the launcher makes when it is missing. */
  boxScratch(home: string): string[];
  boxCopies(home: string): string[];
  boxEnv: readonly string[];
}

export interface BoxPlanInput {
  /** The probed bwrap program (`probeBwrap()`). */
  bwrap: string;
  /** What runs inside: `darius box enter ... -- <harness argv>` from spec 03 on, or a test program. */
  command: readonly string[];
  run: { id: string; dir: string; policy: string; project: string };
  workDir: string;
  /** Report mode: the work dir is read-only. */
  isReport: boolean;
  /** The surface needs the terminal (herdr): no `--new-session`. */
  hasTty: boolean;
  /** The relay port inside the box (spec 03): the proxy variables point at `127.0.0.1:<port>`. */
  relayPort: number;
  ritual: RitualBoxKeys;
  host: HostBoxSettings;
  harness: BoxHarness;
  /** The profile's `env_pass`. */
  envPass: readonly string[];
  facts: BoxFacts;
}

/** A file the launcher copies before the run: `from` on the host to `to` in the box dir. */
export interface BoxCopy {
  from: string;
  to: string;
}

/** A file or dir the launcher creates, empty, before the run, when it is missing. */
export interface BoxCreate {
  path: string;
  kind: "file" | "dir";
  mode: number;
}

export interface BoxPlan {
  /** bwrap first, then its flags, `--`, and the command. */
  argv: string[];
  /** The environment inside the box: each name is one `--setenv` in `argv`. */
  env: BoxEnv;
  /** `<runtime dir>/darius-box/<run>`, mode 0700, bound read-only at /run/darius. */
  boxDir: string;
  copies: BoxCopy[];
  /** Made before the copies, in order: the box dir, `gate.jsonl`, `scratch/`. */
  creates: BoxCreate[];
  /** True when the ssh agent socket is bound in. */
  agent: boolean;
  /** What the launcher writes to `run.log` before the run: a socket scan that hit its cap. */
  warnings: string[];
}

/** A path with `~` expanded, normalized, and its facts. */
interface Resolved {
  path: string;
  entry: BoxEntry | undefined;
}

/** The work dir as bound: its real path, and whether the box sees it read-only. */
interface WorkBind {
  real: string;
  isReadOnly: boolean;
}

/** The harness binds, and the real paths they make writable (kept out of the masks). */
interface HarnessBinds {
  args: string[];
  writable: string[];
}

function resolvePath(path: string, facts: BoxFacts): Resolved {
  const absolute = normalize(expandTilde(path, facts.home));
  return { path: absolute, entry: facts.entry(absolute) };
}

/** Both spellings of each protected path: as configured and with symlinks resolved. */
function guardedPaths(facts: BoxFacts): string[] {
  const listed = protectedPaths({ home: facts.home, store: facts.store, config: facts.config, app: facts.app, runtimeDir: facts.runtimeDir });
  const real = listed.flatMap((path) => {
    const entry = facts.entry(path);
    return entry === undefined ? [] : [normalize(entry.real)];
  });
  return [...new Set([...listed, ...real])];
}

/**
 * The runner's PATH entries as written and with links resolved, plus
 * `~/.local/bin`, which the box adds. A later unboxed shell runs what is in
 * them, so no writable path may be in one or hold one.
 */
function pathGuards(facts: BoxFacts): string[] {
  const listed = absoluteEntries([...(facts.env.PATH ?? "").split(":"), join(facts.home, ".local", "bin")]);
  const real = listed.flatMap((path) => {
    const entry = facts.entry(path);
    return entry === undefined ? [] : [normalize(entry.real)];
  });
  return [...new Set([...listed, ...real])];
}

/** The rules a resolved writable path is held to. */
function resolvedGuard(facts: BoxFacts, guarded: readonly string[]): Guard {
  return { guarded, hidden: hiddenSpellings(facts), home: homeReal(facts), pathEntries: pathGuards(facts) };
}

/** The writable extras as real paths, refused with the source named. Missing paths are left out. */
function writableExtras(input: BoxPlanInput, guarded: readonly string[]): string[] {
  const { facts } = input;
  const host = input.host.writable;
  const sources: [string, readonly string[]][] = [
    [host === undefined ? "the default [box] writable" : "[box] writable", host ?? DEFAULT_BOX_WRITABLE],
    ["the ritual's writable", input.ritual.writable ?? []],
  ];
  const dirs: ProtectedDirs = { home: facts.home, store: facts.store, config: facts.config, app: facts.app, runtimeDir: facts.runtimeDir, pathEntries: (facts.env.PATH ?? "").split(":") };
  const guard = resolvedGuard(facts, guarded);
  const binds: string[] = [];
  for (const [source, paths] of sources) {
    for (const path of paths) {
      const asWritten = writableProblem(path, dirs);
      if (asWritten !== undefined) throw new BoxError(`${source} "${path}" is refused: ${asWritten}`);
      const { entry } = resolvePath(path, facts);
      if (entry === undefined) continue;
      const real = normalize(entry.real);
      const resolved = protectedProblem(real, guard);
      if (resolved !== undefined) throw new BoxError(`${source} "${path}" is refused: it resolves to ${real}, and ${resolved}`);
      if (!binds.includes(real)) binds.push(real);
    }
  }
  return binds;
}

/** The work dir's real path, and whether it must be read-only. Refused when it holds a protected path. */
function workDir(input: BoxPlanInput, guarded: readonly string[], hidden: readonly string[]): WorkBind {
  const entry = input.facts.entry(normalize(input.workDir));
  if (entry?.kind !== "dir") throw new BoxError(`the work dir ${input.workDir} is not a folder`);
  const real = normalize(entry.real);
  if (real === "/") throw new BoxError(`the work dir ${input.workDir} is refused: it is the root`);
  for (const root of ["/proc", "/sys", "/dev", "/run"]) {
    if (isWithin(real, root)) throw new BoxError(`the work dir ${input.workDir} is refused: it is in ${root}`);
  }
  // The work dir is bound after the hidden folders' tmpfs, so it may neither lie in one nor hold one.
  for (const dir of hidden) {
    if (isWithin(real, dir)) throw new BoxError(`the work dir ${input.workDir} is refused: it is in ${dir}, which the box hides`);
    if (isWithin(dir, real)) throw new BoxError(`the work dir ${input.workDir} is refused: it holds ${dir}, which the box hides`);
  }
  for (const path of guarded) {
    if (isWithin(path, real)) throw new BoxError(`the work dir ${input.workDir} is refused: it holds ${path}`);
  }
  const store = [normalize(input.facts.store), normalize(input.facts.entry(input.facts.store)?.real ?? input.facts.store)];
  const isInStore = store.some((dir) => isWithin(real, dir));
  for (const path of guarded) {
    if (!store.includes(path) && isWithin(real, path)) throw new BoxError(`the work dir ${input.workDir} is refused: it is in ${path}`);
  }
  // A project with no repo works in its store dir (src/core/workdir.ts): the box gives it that read-only.
  return { real, isReadOnly: input.isReport || isInStore };
}

/** The run dir and its two writable children. Refused when a child is a symlink or of the wrong type. */
function runDirArgs(input: BoxPlanInput, creates: BoxCreate[]): string[] {
  const entry = input.facts.entry(normalize(input.run.dir));
  if (entry?.kind !== "dir") throw new BoxError(`the run dir ${input.run.dir} is not a folder`);
  const real = normalize(entry.real);
  const store = normalize(input.facts.entry(input.facts.store)?.real ?? input.facts.store);
  if (!isWithin(real, store) || real === store) throw new BoxError(`the run dir ${input.run.dir} is not in the store ${input.facts.store}`);
  const args = ["--ro-bind", real, real];
  for (const [name, kind] of [["gate.jsonl", "file"], ["scratch", "dir"]] as const) {
    const path = join(real, name);
    const child = input.facts.entry(path);
    if (child !== undefined && (child.link !== undefined || child.kind !== kind || normalize(child.real) !== path)) {
      throw new BoxError(`${path} must be a plain ${kind === "file" ? "file" : "folder"}, not a link or anything else`);
    }
    if (child === undefined) creates.push({ path, kind, mode: kind === "file" ? 0o600 : 0o700 });
    args.push("--bind", path, path);
  }
  return args;
}

/** What the harness binds work from: `~/.claude` as a real folder, the rules, the plan's creates. */
interface HarnessContext {
  facts: BoxFacts;
  claudeReal: string;
  guard: Guard;
  creates: BoxCreate[];
}

/**
 * The real path of a harness path, or undefined when it is missing and is not
 * to be made. A missing folder to be made gets a create for it and for each
 * missing parent, top down, below the nearest folder that exists.
 */
function harnessReal(path: string, isMade: boolean, context: HarnessContext): string | undefined {
  const { facts } = context;
  const absolute = normalize(path);
  const entry = facts.entry(absolute);
  if (entry !== undefined) {
    if (isMade && entry.kind !== "dir") throw new BoxError(`the harness path ${path} must be a folder`);
    return normalize(entry.real);
  }
  if (!isMade) return undefined;
  const missing: string[] = [];
  let at = absolute;
  let found = facts.entry(dirname(at));
  missing.unshift(basename(at));
  // Bounded by the path's depth: dirname("/") is "/".
  while (found === undefined && dirname(at) !== at) {
    at = dirname(at);
    missing.unshift(basename(at));
    found = facts.entry(dirname(at));
  }
  if (found?.kind !== "dir") throw new BoxError(`the harness path ${path} cannot be made: no folder holds it`);
  let real = normalize(found.real);
  for (const name of missing) {
    real = join(real, name);
    if (!context.creates.some((create) => create.path === real)) context.creates.push({ path: real, kind: "dir", mode: 0o700 });
  }
  return real;
}

/** Why a harness path that resolves to `real` is refused, or undefined. A link out of `~/.claude` is held to the rules of any writable path. */
function harnessProblem(real: string, context: HarnessContext): string | undefined {
  const isInside = isWithin(real, context.claudeReal) && real !== context.claudeReal;
  return isInside ? undefined : protectedProblem(real, context.guard);
}

/**
 * `~/.claude` read-only; the adapter's persistent paths over it (writable, or
 * read-only over a writable one); an empty tmpfs on each per-run folder; the
 * per-run copies. Without a `~/.claude` folder only the copies are bound.
 */
function harnessArgs(input: BoxPlanInput, work: string, boxDir: string, plan: { copies: BoxCopy[]; creates: BoxCreate[] }): HarnessBinds {
  const { facts } = input;
  const { copies } = plan;
  const args: string[] = [];
  const writable: string[] = [];
  const claude = facts.entry(join(facts.home, ".claude"));
  if (claude?.kind === "dir") {
    const dirs: ProtectedDirs = { home: facts.home, store: facts.store, config: facts.config, app: facts.app, runtimeDir: facts.runtimeDir };
    const context: HarnessContext = { facts, claudeReal: normalize(claude.real), guard: resolvedGuard(facts, protectedPaths(dirs)), creates: plan.creates };
    args.push("--ro-bind", context.claudeReal, context.claudeReal);
    for (const item of input.harness.boxWritable(facts.home, work)) {
      const isMade = item.isMadeWhenMissing === true;
      const real = harnessReal(item.path, isMade, context);
      if (real === undefined) continue;
      const problem = harnessProblem(real, context);
      if (problem !== undefined) throw new BoxError(`the harness path ${item.path} is refused: it resolves to ${real}, and ${problem}`);
      if (item.isReadOnly !== true) {
        args.push("--bind", real, real);
        writable.push(real);
        continue;
      }
      // A link in a writable folder can be swapped after the mount, and bwrap mounts on its target.
      if (facts.entry(normalize(item.path))?.link !== undefined) throw new BoxError(`the harness path ${item.path} is a link; the box keeps it read-only only as a plain folder or file`);
      args.push("--ro-bind", real, real);
    }
    for (const path of input.harness.boxScratch(facts.home)) {
      const real = harnessReal(path, true, context) ?? normalize(path);
      const problem = harnessProblem(real, context);
      if (problem !== undefined) throw new BoxError(`the harness path ${path} is refused: it resolves to ${real}, and ${problem}`);
      args.push("--tmpfs", real);
      writable.push(real);
    }
  }
  input.harness.boxCopies(facts.home).forEach((path, index) => {
    const entry = facts.entry(normalize(path));
    if (entry?.kind !== "file") return;
    const real = normalize(entry.real);
    const to = join(boxDir, "copies", `${String(index)}-${basename(real)}`);
    copies.push({ from: real, to });
    args.push("--bind", to, real);
    writable.push(real);
  });
  return { args, writable };
}

/** The paths a mask must leave alone, and the sockets it must hide. */
interface MaskKeep {
  writable: readonly string[];
  /** The agent socket when it is bound: the one socket the scan does not mask. */
  boundAgent: string | undefined;
  /** The agent socket when it is not bound. */
  unboundAgent: string | undefined;
  hidden: readonly string[];
}

/**
 * Every socket under home outside the hidden folders, and the agent socket when
 * it is not bound, behind /dev/null: a connect then fails with ECONNREFUSED.
 * A socket on a read-only mount still connects, so read-only is not enough.
 */
function socketMasks(facts: BoxFacts, keep: MaskKeep): string[] {
  const sockets = new Set<string>();
  for (const path of [...facts.sockets.found, ...(keep.unboundAgent === undefined ? [] : [keep.unboundAgent])]) {
    const entry = facts.entry(normalize(path));
    if (entry === undefined) continue;
    const real = normalize(entry.real);
    if (real === keep.boundAgent || keep.hidden.some((dir) => isWithin(real, dir))) continue;
    sockets.add(real);
  }
  return [...sockets].flatMap((socket) => ["--ro-bind", "/dev/null", socket]);
}

/** The secret files and dirs to hide, as real paths, then the sockets. */
function maskArgs(input: BoxPlanInput, keep: MaskKeep): string[] {
  const { facts } = input;
  const configReal = normalize(facts.entry(facts.config)?.real ?? facts.config);
  const hasGh = (input.ritual.tools ?? []).includes("gh");
  const sshDir = normalize(facts.secrets.sshDir);
  const candidates = [
    ...facts.masked.dirs,
    ...facts.masked.files,
    ...facts.secrets.dirs,
    ...facts.secrets.files.filter((path) => !(hasGh && normalize(path).endsWith("/gh/hosts.yml"))),
    join(facts.home, ".npmrc"),
  ];
  const dirs = new Set<string>();
  const files = new Set<string>();
  for (const path of candidates) {
    if (isWithin(normalize(path), sshDir)) continue;
    const entry = facts.entry(normalize(path));
    if (entry === undefined) continue;
    const real = normalize(entry.real);
    // The harness login stays: the run is the harness.
    if (keep.writable.some((writable) => isWithin(real, writable))) continue;
    if (entry.kind === "dir") {
      // The active config dir keeps config.toml and links.toml; maskedPaths lists its files one by one.
      if (real !== configReal) dirs.add(real);
      continue;
    }
    files.add(real);
  }
  return [...[...dirs].flatMap((dir) => ["--tmpfs", dir]), ...[...files].flatMap((file) => ["--ro-bind", "/dev/null", file]), ...socketMasks(facts, keep)];
}

/** The home folder with links resolved. */
function homeReal(facts: BoxFacts): string {
  return normalize(facts.entry(facts.home)?.real ?? facts.home);
}

/** The hidden folders as written and with links resolved, for the writable checks. */
function hiddenSpellings(facts: BoxFacts): string[] {
  return [...new Set([...hiddenHomeDirs(facts.home), ...hiddenReal(facts)])];
}

/** The hidden folders that exist, as real paths: each becomes a tmpfs. */
function hiddenReal(facts: BoxFacts): string[] {
  return [...new Set(hiddenHomeDirs(facts.home).flatMap((path) => {
    const entry = facts.entry(path);
    return entry?.kind === "dir" ? [normalize(entry.real)] : [];
  }))];
}

/** The agent socket's real path when the run may use it: SSH_AUTH_SOCK is set, and the ritual has `reach` or someone set `ssh_agent`. */
function agentSocket(input: BoxPlanInput): { real: string; wanted: boolean } | undefined {
  const sock = input.facts.env.SSH_AUTH_SOCK;
  if (sock === undefined || sock === "" || !sock.startsWith("/")) return undefined;
  const entry = input.facts.entry(normalize(sock));
  if (entry?.kind !== "other") return undefined;
  const wanted = (input.ritual.reach ?? []).length > 0 || input.ritual.sshAgent === true || input.host.sshAgent;
  return { real: normalize(entry.real), wanted };
}

/** The PATH inside: /run/darius/bin first, then the runner's absolute entries, then ~/.local/bin. */
function boxPath(facts: BoxFacts): string {
  const parts = (facts.env.PATH ?? "").split(":").filter((part) => part.startsWith("/") && part !== BOX_BIN);
  const localBin = join(facts.home, ".local", "bin");
  if (!parts.includes(localBin)) parts.push(localBin);
  return [BOX_BIN, ...new Set(parts)].join(":");
}

/** The scrubbed environment: a fixed list, the adapter's names and the profile's `env_pass`. */
function boxEnv(input: BoxPlanInput, agent: string | undefined): BoxEnv {
  const { facts } = input;
  const proxy = `http://127.0.0.1:${String(input.relayPort)}`;
  const env: BoxEnv = { HOME: facts.home, USER: facts.user, LOGNAME: facts.user, PATH: boxPath(facts) };
  for (const name of ["TERM", "LANG", "TZ"]) {
    const value = facts.env[name];
    if (value !== undefined) env[name] = value;
  }
  for (const [name, value] of Object.entries(facts.env)) if (name.startsWith("LC_")) env[name] = value;
  env.XDG_RUNTIME_DIR = facts.runtimeDir;
  if (agent !== undefined) env.SSH_AUTH_SOCK = agent;
  env.DARIUS_RUN = input.run.id;
  env.DARIUS_RUN_POLICY = input.run.policy;
  env.DARIUS_PROJECT = input.run.project;
  // The gate and the broker client inside read the same store and config as the runner, also off the default paths.
  env.DARIUS_STATE_DIR = facts.store;
  env.DARIUS_CONFIG_DIR = facts.config;
  const runtime = facts.env.DARIUS_RUNTIME;
  if (runtime !== undefined) env.DARIUS_RUNTIME = runtime;
  // curl reads only the lower-case http_proxy; the upper case is the other tools' spelling.
  for (const name of ["HTTPS_PROXY", "HTTP_PROXY", "ALL_PROXY"]) {
    env[name] = proxy;
    env[name.toLowerCase()] = proxy;
  }
  env.NO_PROXY = "";
  env.no_proxy = "";
  env.NODE_USE_ENV_PROXY = "1";
  // Caches per run, on the /var/tmp tmpfs: a shared cache holds code that later unboxed runs load.
  env.XDG_CACHE_HOME = BOX_CACHE_HOME;
  env.npm_config_cache = BOX_NPM_CACHE;
  for (const [source, names] of [["the harness", input.harness.boxEnv], ["env_pass", input.envPass]] as const) {
    for (const name of names) {
      const problem = envPassProblem(name);
      if (problem !== undefined) throw new BoxError(`${source} names ${problem}`);
      const value = facts.env[name];
      if (value !== undefined) env[name] = value;
    }
  }
  return env;
}

/** The re-binds of the NixOS paths under /run: a symlink as a symlink, a dir as a read-only bind. */
function runRebinds(facts: BoxFacts): string[] {
  return RUN_REBINDS.flatMap((path) => {
    const entry = facts.entry(path);
    if (entry === undefined) return [];
    if (entry.link !== undefined) return ["--symlink", entry.link, path];
    return ["--ro-bind", entry.real, path];
  });
}

/** The work dir entries a later unboxed session trusts: git's own folder, Claude's project settings, the darius marker. */
const WORK_GUARDS: readonly string[] = [".git", ".claude", ".darius.toml"];

/**
 * The read-only binds over the work dir's `.git` (a folder, or the file of a
 * linked worktree), `.claude` and `.darius.toml`, each on its own path. A
 * mount point cannot be renamed or removed, so a run cannot move `.git` away
 * with its config, nor write `commondir`, nor raise its own `net`, `reach`,
 * `writable`, `ssh_agent` or `tools` for the next run. A link is refused:
 * bwrap would mount on its target, and the run could swap the link.
 *
 * A missing `.claude` gets an empty read-only folder from the box dir, so the
 * run cannot make `.claude/settings.json`. bwrap makes the mount point, so an
 * empty `.claude` folder stays in the checkout after the run; that is
 * accepted. A read-only work dir needs none: the run can make nothing there.
 */
function workGuards(work: WorkBind, facts: BoxFacts, empty: { dir: string; creates: BoxCreate[] }): string[] {
  return WORK_GUARDS.flatMap((name) => {
    const path = join(work.real, name);
    const entry = facts.entry(path);
    if (entry === undefined) {
      if (name !== ".claude" || work.isReadOnly) return [];
      empty.creates.push({ path: empty.dir, kind: "dir", mode: 0o500 });
      return ["--ro-bind", empty.dir, path];
    }
    if (entry.link !== undefined || normalize(entry.real) !== path) throw new BoxError(`${path} is a link; the box keeps it read-only only as a plain folder or file, so this run does not start`);
    return ["--ro-bind", path, path];
  });
}

function checkInput(input: BoxPlanInput): void {
  if (!RUN_ID.test(input.run.id)) throw new BoxError(`the run id "${input.run.id}" is not a run id`);
  if (!Number.isInteger(input.relayPort) || input.relayPort < 1 || input.relayPort > 65_535) throw new BoxError(`the relay port ${String(input.relayPort)} is not a port`);
  if (input.command.length === 0) throw new BoxError("the box needs a command to run");
  if (!input.facts.runtimeDir.startsWith("/")) throw new BoxError("the box needs XDG_RUNTIME_DIR, an absolute path");
  if (!input.facts.home.startsWith("/") || normalize(input.facts.home) === "/") throw new BoxError(`the home ${input.facts.home} is not a home folder`);
  for (const tool of input.ritual.tools ?? []) {
    if (!BOX_TOOLS.some((known) => known === tool)) throw new BoxError(`the ritual's tools names "${tool}"; known: ${BOX_TOOLS.join(", ")}`);
  }
}

/**
 * The bwrap argv and the environment of one run in the box. Pure: every
 * fact comes from `input.facts`. Throws a BoxError that names the refused
 * path or the missing fact; the launcher must then not run the harness.
 */
export function boxPlan(input: BoxPlanInput): BoxPlan {
  checkInput(input);
  const { facts } = input;
  const runtimeDir = normalize(facts.runtimeDir);
  const boxDir = join(runtimeDir, "darius-box", input.run.id);
  const guarded = guardedPaths(facts);
  const creates: BoxCreate[] = [{ path: boxDir, kind: "dir", mode: 0o700 }];
  const copies: BoxCopy[] = [];
  const agentFound = agentSocket(input);
  const agent = agentFound?.wanted === true ? agentFound.real : undefined;

  const args = ["--ro-bind", "/", "/", "--dev", "/dev", "--proc", "/proc", "--tmpfs", "/tmp", "--tmpfs", "/run", ...runRebinds(facts), "--tmpfs", "/var/tmp", "--dir", BOX_CACHE_HOME, "--dir", BOX_NPM_CACHE];
  // A home under a tmpfs root (a throwaway test home) stays visible, read-only, as on a real host.
  const home = homeReal(facts);
  if (TMP_ROOTS.some((root) => isWithin(home, root))) args.push("--ro-bind", home, home);
  args.push("--perms", "0700", "--tmpfs", runtimeDir, "--ro-bind", boxDir, BOX_MOUNT);
  for (const dir of [facts.store, facts.config]) {
    const entry = facts.entry(normalize(dir));
    if (entry?.kind === "dir") args.push("--ro-bind", normalize(entry.real), normalize(entry.real));
  }
  for (const path of writableExtras(input, guarded)) args.push("--bind", path, path);
  // After the writable extras, so a cache dir that holds one (~/.cache) cannot uncover it.
  const hidden = hiddenReal(facts);
  for (const dir of hidden) args.push("--tmpfs", dir);
  if (agent !== undefined) args.push("--bind", agent, agent);
  const work = workDir(input, guarded, hiddenSpellings(facts));
  const emptyDir = join(boxDir, "empty");
  args.push(work.isReadOnly ? "--ro-bind" : "--bind", work.real, work.real, ...workGuards(work, facts, { dir: emptyDir, creates }));
  args.push(...runDirArgs(input, creates));
  const harness = harnessArgs(input, work.real, boxDir, { copies, creates });
  args.push(...harness.args);
  // An agent socket that is not bound is masked: a socket on a read-only mount still connects.
  const unboundAgent = agentFound !== undefined && agent === undefined ? agentFound.real : undefined;
  args.push(...maskArgs(input, { writable: harness.writable, boundAgent: agent, unboundAgent, hidden }));
  args.push("--unshare-net", "--unshare-pid", "--die-with-parent");
  if (!input.hasTty) args.push("--new-session");
  const env = boxEnv(input, agent);
  args.push("--clearenv", ...Object.entries(env).flatMap(([name, value]) => ["--setenv", name, value]));
  const warnings = facts.sockets.timedOut
    ? [`box: the socket scan of ${facts.home} stopped after ${String(Math.round(facts.sockets.capMs / 1000))} s; the hidden folders are hidden, but a socket elsewhere in the home folder may still connect`]
    : [];
  return { argv: [input.bwrap, ...args, "--", ...input.command], env, boxDir, copies, creates, agent: agent !== undefined, warnings };
}
