/**
 * Rendering the systemd unit templates in `systemd/` for this host.
 *
 * The service templates carry two placeholders. `@PATH@` becomes the PATH the
 * unit runs with, and `@DARIUS@` the darius binary its ExecStart calls. A
 * static PATH cannot work everywhere: on NixOS `/usr/bin` holds only `env`,
 * and bash, node, bun and claude live in profile dirs. systemd also never
 * searches `Environment=PATH` for ExecStart, so the binary needs a full path.
 *
 * Everything here is pure. The host facts (PATH, user, which dirs exist,
 * where a link resolves) come in through `UnitHost`, so a test can fake them.
 */

import { posix } from "node:path";

/** The Nix store. A dir under it is garbage-collected once nothing roots it. */
const NIX_STORE = "/nix/store";

/**
 * Only these characters may appear in a unit PATH entry or ExecStart path.
 * A space, quote, `%` or `\` would break the line or be expanded by systemd.
 */
const SAFE_UNIT_PATH = /^\/[A-Za-z0-9._/+@-]*$/u;

/** What ExecStart calls when darius runs from a checkout: the link `setup` writes. */
export const CHECKOUT_DARIUS = "%h/.local/bin/darius";

/** The host facts rendering reads, apart from home and root, which setup already carries. */
export interface UnitHost {
  /** The login name, for `/etc/profiles/per-user/<user>/bin`. */
  user: string;
  /** The setup-time `PATH`, `:`-separated. */
  envPath: string;
  /** The OS temp dir. Entries under it are dropped. */
  tmpDir: string;
  /** `$XDG_RUNTIME_DIR`, if set. Entries under it are dropped. */
  runtimeDir: string | undefined;
  isDir: (path: string) => boolean;
  isFile: (path: string) => boolean;
  /** The fully resolved path, or undefined when it cannot be resolved. */
  realpath: (path: string) => string | undefined;
}

/** What `unitPath` needs: the home dir plus the PATH-related host facts. */
export interface UnitPathInput {
  home: string;
  user: string;
  envPath: string;
  tmpDir: string;
  runtimeDir: string | undefined;
  isDir: (path: string) => boolean;
  isFile: (path: string) => boolean;
}

/**
 * The programs a unit must find the way the operator's shell finds them: bash
 * runs vigil checks, bun or node runs darius, claude runs rituals, and pnpm
 * runs the repo CLIs that djinns call (`pnpm cli ...` in acme-web).
 * A ritual whose `may` names a program the unit PATH lacks is skipped as
 * `tool-missing` (src/runner/tools.ts).
 */
export const UNIT_TOOLS: readonly string[] = ["bash", "bun", "node", "claude", "pnpm"];

/** What `unitDarius` needs: darius's own root plus the lookup host facts. */
export interface DariusLookupInput {
  root: string;
  envPath: string;
  isFile: (path: string) => boolean;
  realpath: (path: string) => string | undefined;
}

/** A path with `.`, `..`, `//` and any trailing slash removed. `/` stays `/`. */
function tidy(path: string): string {
  const normal = posix.normalize(path);
  return normal.length > 1 && normal.endsWith("/") ? normal.slice(0, -1) : normal;
}

/** True when `path` is `base` or lies below it. An empty or root `base` matches nothing. */
function under(path: string, base: string | undefined): boolean {
  if (base === undefined || base === "") return false;
  const root = tidy(base);
  if (root === "/") return false;
  return path === root || path.startsWith(`${root}/`);
}

/** True when `path` lies in the Nix store. */
export function isNixStorePath(path: string): boolean {
  return under(tidy(path), NIX_STORE);
}

/** True when `path` is absolute, in the safe character set, and outside the Nix store. */
function safeOutsideStore(path: string): boolean {
  return SAFE_UNIT_PATH.test(path) && !under(path, NIX_STORE);
}

/**
 * The `:`-joined PATH a rendered unit runs with. In order, first occurrence
 * wins: `<home>/.local/bin`, `<home>/.bun/bin`, the setup-time PATH dirs that
 * hold one of `UNIT_TOOLS` (a node from nvm, say), then the dirs where NixOS
 * and other hosts keep profile and system binaries, in their usual order.
 *
 * Only those tool dirs come from the setup-time PATH, not the whole of it. A
 * login PATH can put a coreutils replacement or a whole package manager ahead
 * of /usr/bin; the unit must not inherit that by accident.
 *
 * Dropped: relative entries, anything in the Nix store (a devShell or
 * `nix run` path that garbage collection deletes later), anything under the
 * temp dir or `$XDG_RUNTIME_DIR`, entries with characters unsafe in a unit
 * file, and dirs that do not exist. `<home>/.local/bin` is kept even when
 * missing, because setup creates it.
 */
export function unitPath(input: UnitPathInput): string {
  const localBin = tidy(`${input.home}/.local/bin`);
  const wellKnown = [
    "/run/wrappers/bin",
    `${input.home}/.nix-profile/bin`,
    ...(input.user === "" || input.user.includes("/") ? [] : [`/etc/profiles/per-user/${input.user}/bin`]),
    `${input.home}/.local/state/nix/profile/bin`,
    "/nix/var/nix/profiles/default/bin",
    "/run/current-system/sw/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
  ].map(tidy);

  const usable = (dir: string): boolean =>
    safeOutsideStore(dir) && !under(dir, input.tmpDir) && !under(dir, input.runtimeDir);
  const setupDirs = input.envPath
    .split(":")
    .filter((entry) => entry.startsWith("/"))
    .map(tidy)
    .filter(usable);
  const toolDirs = UNIT_TOOLS.flatMap((tool) => {
    const found = setupDirs.find((dir) => input.isDir(dir) && input.isFile(`${dir === "/" ? "" : dir}/${tool}`));
    return found === undefined || wellKnown.includes(found) ? [] : [found];
  });
  const candidates = [localBin, tidy(`${input.home}/.bun/bin`), ...toolDirs, ...wellKnown];

  const kept: string[] = [];
  for (const dir of candidates) {
    if (kept.includes(dir) || !usable(dir)) continue;
    if (dir !== localBin && !input.isDir(dir)) continue;
    kept.push(dir);
  }
  return kept.join(":");
}

/**
 * The binary a rendered unit's ExecStart calls, or undefined when there is none.
 *
 * From a checkout it is `%h/.local/bin/darius`, the link setup writes. From
 * the Nix store that link is not written, since the store path changes on
 * every upgrade. Instead it is the first `<dir>/darius` on the setup-time
 * PATH where `<dir>` is outside the store and the file resolves into the
 * store: a profile link such as `~/.nix-profile/bin/darius`, which follows
 * upgrades.
 */
export function unitDarius(input: DariusLookupInput): string | undefined {
  if (!isNixStorePath(input.root)) return CHECKOUT_DARIUS;
  for (const entry of input.envPath.split(":")) {
    if (!entry.startsWith("/")) continue;
    const dir = tidy(entry);
    if (!safeOutsideStore(dir)) continue;
    const candidate = dir === "/" ? "/darius" : `${dir}/darius`;
    if (!input.isFile(candidate)) continue;
    const target = input.realpath(candidate);
    if (target !== undefined && isNixStorePath(target)) return candidate;
  }
  return undefined;
}

/**
 * A unit template with `@PATH@` and `@DARIUS@` filled in. One pass, so a
 * value that happens to contain a placeholder is never substituted twice.
 */
export function renderUnit(template: string, path: string, darius: string): string {
  return template.replaceAll(/@(PATH|DARIUS)@/gu, (_match, name: string) => (name === "PATH" ? path : darius));
}
