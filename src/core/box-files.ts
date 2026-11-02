/**
 * The box dir contents (M4 box, spec 03), written OUTSIDE, before the launch.
 *
 * The box dir is bound read-only at /run/darius. Besides the proxy and broker
 * sockets it holds:
 *
 *   box.json     the box marker: `darius box enter` refuses to run without it
 *   bin/ssh      `exec <real ssh> -F /run/darius/ssh_config "$@"`, and the same
 *   bin/scp      for scp and sftp. The box PATH starts with /run/darius/bin, so
 *   bin/sftp     git over ssh uses the wrapper too; GIT_SSH_COMMAND stays unset.
 *   ssh_config   `Host *` with `ProxyCommand <darius> box connect %h %p` first,
 *                then the user's ~/.ssh/config without Include, ProxyCommand,
 *                ProxyJump and Match exec. Mode 0600.
 *
 * Why a wrapper: in a user namespace a root-owned file reads as owned by
 * nobody, and ssh refuses such a config ("Bad owner or permissions"). `-F`
 * skips the system config, and the box config is the user's own file (probed
 * on both hosts, 2026-11-02). An absolute `/usr/bin/ssh` in the box has no
 * config with a ProxyCommand and no network: it fails closed.
 *
 * The real program paths and the darius path are resolved here, outside, and
 * each must be a path the box shows. The text builders are pure; the tests
 * drive them without a host.
 */

import { accessSync, chmodSync, constants, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { join, normalize } from "node:path";

import { BOX_BIN, BOX_MOUNT, BOX_PROXY_SOCKET, BoxError, hiddenHomeDirs, isWithin, RUN_REBINDS, type BoxEnv, type BoxPlanInput } from "./box.ts";
import { errorMessage } from "../runtime.ts";
import { VERSION } from "../version.ts";

/** The ssh config inside the box. */
export const BOX_SSH_CONFIG = `${BOX_MOUNT}/ssh_config`;
/** The box marker file, inside. */
export const BOX_MARKER = `${BOX_MOUNT}/box.json`;
/**
 * The relay port inside the box. The box has its own network namespace, so
 * nothing on the host competes for it. The proxy variables point here.
 */
export const BOX_RELAY_PORT = 3128;
/** The programs that get a wrapper. Each takes `-F`. */
export const SSH_TOOLS = ["ssh", "scp", "sftp"] as const;
export type SshTool = (typeof SSH_TOOLS)[number];

/** The user's ssh config is read up to this size; a bigger one is refused. */
const SSH_CONFIG_MAX = 1024 * 1024;
/** Keywords dropped from the user's config, lower case. */
const DROPPED_KEYWORDS: ReadonlySet<string> = new Set(["include", "proxycommand", "proxyjump"]);
/** A word the shell reads as itself, with no quotes. */
const SHELL_PLAIN = /^[A-Za-z0-9_@%+=:,./-]+$/u;
const KEYWORD = /^([A-Za-z]+)(?:\s*=\s*|\s+|$)(.*)$/u;

/** The box marker, as `box.json` holds it. */
export interface BoxMarker {
  v: 1;
  run: string;
  darius: string;
}

/** One file to write into the box dir, relative to it. */
export interface BoxFile {
  path: string;
  text: string;
  mode: number;
}

/** A program found outside, as it is written into its wrapper. */
export interface BoxTool {
  name: SshTool;
  path: string;
}

export interface BoxFilesInput {
  run: string;
  /** The darius CLI as the box sees it: absolute, resolved outside. */
  darius: string;
  /** The ssh programs found on this host. A missing one gets no wrapper. */
  tools: readonly BoxTool[];
  /** The text of the user's ~/.ssh/config, or undefined when there is none. */
  userSshConfig: string | undefined;
}

// --- the text --------------------------------------------------------------------

/** `word` as one shell word: as is when it is plain, else in single quotes. */
export function shellWord(word: string): string {
  if (SHELL_PLAIN.test(word)) return word;
  return `'${word.replaceAll("'", `'\\''`)}'`;
}

/** The wrapper script for one program. */
export function wrapperScript(realPath: string): string {
  if (!realPath.startsWith("/")) throw new BoxError(`the wrapped program ${realPath} is not an absolute path`);
  if (/[\n\r\0]/u.test(realPath)) throw new BoxError("the wrapped program path has a line break");
  return [
    "#!/bin/sh",
    "# darius box: ssh in the box reaches hosts only through the box proxy.",
    `exec ${shellWord(realPath)} -F ${BOX_SSH_CONFIG} "$@"`,
    "",
  ].join("\n");
}

/** True when a `Match` line has an `exec` criterion (also `!exec`). */
function isMatchExec(rest: string): boolean {
  return rest.split(/\s+/u).some((word) => word.replace(/^!/u, "").toLowerCase() === "exec");
}

/**
 * The user's ssh config without the lines that would run a command or reach
 * past the proxy: `Include`, `ProxyCommand` and `ProxyJump` lines, and each
 * `Match exec` block up to the next `Host` or `Match` line. A dropped line
 * stays as a comment, so the file reads line for line as the original.
 */
export function filterSshConfig(text: string): string {
  const out: string[] = [];
  let isDropping = false;
  for (const line of text.split(/\r?\n/u)) {
    const match = KEYWORD.exec(line.trim());
    const keyword = match?.[1]?.toLowerCase();
    if (keyword === "host" || keyword === "match") isDropping = keyword === "match" && isMatchExec(match?.[2] ?? "");
    if (isDropping || (keyword !== undefined && DROPPED_KEYWORDS.has(keyword))) {
      out.push(line.trim() === "" ? "" : `# darius box dropped: ${line.trim()}`);
      continue;
    }
    out.push(line);
  }
  return out.join("\n");
}

/** The ProxyCommand line: the darius path as one shell word, `%` doubled for ssh's own expansion. */
export function proxyCommandLine(darius: string): string {
  if (!darius.startsWith("/")) throw new BoxError(`the darius path ${darius} is not absolute`);
  if (/[\n\r\0]/u.test(darius)) throw new BoxError("the darius path has a line break");
  return `ProxyCommand ${shellWord(darius).replaceAll("%", "%%")} box connect %h %p`;
}

/**
 * The box ssh config. ssh takes the first value it reads for each option, so
 * the `Host *` block first wins over anything in the user's part.
 * `ControlPath none` keeps ssh off a master connection outside the box.
 */
export function boxSshConfig(darius: string, userConfig: string | undefined): string {
  const head = [
    "# darius box: written for one run. ssh reaches hosts only through the box proxy.",
    "Host *",
    `  ${proxyCommandLine(darius)}`,
    "  ControlMaster no",
    "  ControlPath none",
    "",
  ];
  if (userConfig === undefined) return `${head.join("\n")}\n`;
  const body = filterSshConfig(userConfig);
  return `${[...head, "# From ~/.ssh/config, without Include, ProxyCommand, ProxyJump and Match exec.", body].join("\n").trimEnd()}\n`;
}

/** Every file of the box dir that this spec writes, in the order to write them. */
export function boxFiles(input: BoxFilesInput): BoxFile[] {
  const marker: BoxMarker = { v: 1, run: input.run, darius: VERSION };
  const files: BoxFile[] = [{ path: "box.json", text: `${JSON.stringify(marker)}\n`, mode: 0o600 }];
  for (const tool of input.tools) files.push({ path: `bin/${tool.name}`, text: wrapperScript(tool.path), mode: 0o700 });
  files.push({ path: "ssh_config", text: boxSshConfig(input.darius, input.userSshConfig), mode: 0o600 });
  return files;
}

/**
 * `darius box enter ... --`: the command the box runs, without the harness.
 * A launch puts the harness after it, as it does after the mask's prefix.
 */
export function boxEnterPrefix(darius: string, relayPort: number = BOX_RELAY_PORT): string[] {
  return [darius, "box", "enter", "--relay-port", String(relayPort), "--proxy", BOX_PROXY_SOCKET, "--"];
}

/** The command the box runs: `darius box enter`, which starts the relay and then the harness. */
export function boxEnterCommand(darius: string, harnessArgv: readonly string[], relayPort: number = BOX_RELAY_PORT): string[] {
  if (harnessArgv.length === 0) throw new BoxError("the box needs a harness command to run");
  return [...boxEnterPrefix(darius, relayPort), ...harnessArgv];
}

// --- where the box can see a path -------------------------------------------------

/** What `boxPathProblem` checks a path against. */
export interface BoxView {
  home: string;
  runtimeDir: string;
}

/**
 * Why the box cannot run `path` as it is written outside, or undefined. The
 * box puts a tmpfs on /tmp, /var/tmp, /run (except the re-binds), the runtime
 * dir and the hidden home folders.
 */
export function boxPathProblem(path: string, view: BoxView): string | undefined {
  const absolute = normalize(path);
  if (!absolute.startsWith("/")) return "it is not an absolute path";
  if (isWithin(absolute, normalize(view.runtimeDir))) return `it is in ${view.runtimeDir}, which the box empties`;
  const hidden = hiddenHomeDirs(view.home).find((dir) => isWithin(absolute, dir));
  if (hidden !== undefined) return `it is in ${hidden}, which the box hides`;
  if (isWithin(absolute, "/run") && !RUN_REBINDS.some((dir) => isWithin(absolute, dir))) return "it is in /run, which the box empties";
  // A home under /tmp or /var/tmp is bound back (src/core/box.ts), so a path in it shows.
  const isInHome = isWithin(absolute, normalize(view.home));
  for (const root of ["/tmp", "/var/tmp"]) {
    if (isWithin(absolute, root) && !isInHome) return `it is in ${root}, which the box empties`;
  }
  return undefined;
}

// --- the host side ----------------------------------------------------------------

function isExecutableFile(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/**
 * The first program `name` on `pathText` that the box can see (with `view`;
 * without it, any), skipping the box's own bin dir and relative entries.
 */
export function findOnPath(name: string, pathText: string, view?: BoxView): string | undefined {
  for (const dir of pathText.split(":")) {
    if (!dir.startsWith("/") || normalize(dir) === BOX_BIN) continue;
    const candidate = join(dir, name);
    if (!isExecutableFile(candidate)) continue;
    if (view === undefined || boxPathProblem(candidate, view) === undefined) return candidate;
  }
  return undefined;
}

/** The darius CLI as the box runs it: the real path of `bin`, refused when the box cannot see it. */
export function boxDarius(bin: string, view: BoxView): string {
  let real: string;
  try {
    real = realpathSync(bin);
  } catch (cause) {
    throw new BoxError(`cannot find the darius CLI at ${bin}: ${errorMessage(cause)}`);
  }
  const problem = boxPathProblem(real, view);
  if (problem !== undefined) throw new BoxError(`the darius CLI ${real} cannot run in the box: ${problem}`);
  return real;
}

/** The text of `~/.ssh/config` (a link is followed), or undefined when there is none. */
export function readUserSshConfig(home: string): string | undefined {
  const path = join(home, ".ssh", "config");
  let real: string;
  try {
    real = realpathSync(path);
  } catch {
    return undefined;
  }
  if (!statSync(real).isFile()) return undefined;
  if (statSync(real).size > SSH_CONFIG_MAX) throw new BoxError(`${path} is over ${String(SSH_CONFIG_MAX / 1024)} KB`);
  return readFileSync(real, "utf8");
}

/** What the box dir files need of the host: the darius CLI, the ssh programs on PATH, the user's ssh config. */
export interface BoxFilesHost {
  run: string;
  /** `dariusBin()` of src/runner/launch.ts. */
  dariusBin: string;
  home: string;
  runtimeDir: string;
  /** The runner's environment: PATH is searched for ssh, scp and sftp. */
  env: BoxEnv;
}

/**
 * The box dir inputs, read on this host. Each wrapper runs the first program
 * on PATH that the box can see. With none there is no wrapper, and the
 * program fails closed in the box. The darius CLI must be visible.
 */
export function hostBoxFiles(host: BoxFilesHost): BoxFilesInput {
  const view: BoxView = { home: host.home, runtimeDir: host.runtimeDir };
  const tools: BoxTool[] = [];
  for (const name of SSH_TOOLS) {
    const path = findOnPath(name, host.env.PATH ?? "", view);
    if (path !== undefined) tools.push({ name, path });
  }
  return { run: host.run, darius: boxDarius(host.dariusBin, view), tools, userSshConfig: readUserSshConfig(host.home) };
}

/** The input a plan needs to run `darius box enter` around the harness. */
export function boxEnterPlanFields(darius: string, harnessArgv: readonly string[]): Pick<BoxPlanInput, "command" | "relayPort"> {
  return { command: boxEnterCommand(darius, harnessArgv), relayPort: BOX_RELAY_PORT };
}

/**
 * Writes the files into the box dir, which `prepareBox` made (mode 0700).
 * Each file is new: one that is there already is a BoxError.
 */
export function writeBoxFiles(boxDir: string, files: readonly BoxFile[]): void {
  for (const file of files) {
    const path = join(boxDir, file.path);
    if (file.path.includes("/")) mkdirSync(join(path, ".."), { recursive: true, mode: 0o700 });
    try {
      writeFileSync(path, file.text, { flag: "wx", mode: file.mode });
      chmodSync(path, file.mode);
    } catch (cause) {
      throw new BoxError(`cannot write ${path}: ${errorMessage(cause)}`);
    }
  }
}
