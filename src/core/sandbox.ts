/**
 * The mask: an unattended run's whole process tree cannot open darius secret
 * files (docs/concept.md, "The mask"). A run starts through bubblewrap, which
 * gives it a private mount namespace with those files hidden. This is about
 * the launch only. The harness and the gate do not know about it.
 *
 *   bwrap --dev-bind / / --die-with-parent
 *         --ro-bind /dev/null <file> ... --tmpfs <dir> ... -- <argv>
 *
 * A masked file cannot be opened at all: `--ro-bind` mounts it without device
 * access, so a read of the bound /dev/null gets EACCES, not an empty file.
 *
 * The mask is not a boundary. `systemd-run --user`, or ssh to the same host,
 * starts a process outside it. A file the operator replaces by rename during
 * a run, or a new file, is not masked for that run. A sandbox failure never
 * stops a ritual: the run starts unmasked and says so in its log. bwrap creates
 * a bind target that is missing, so a file removed between the listing and the
 * launch comes back empty and read-only; that window is short and the file's
 * reader then refuses it loudly.
 */

import { spawnSync } from "node:child_process";
import { accessSync, appendFileSync, constants, readdirSync, realpathSync, statSync } from "node:fs";
import { userInfo } from "node:os";
import { delimiter, join } from "node:path";

import { loadConfigIfPresent, type Config } from "./config.ts";
import { isMaskedFile } from "./credentials.ts";
import { configDir } from "./paths.ts";

/** How this launch runs: masked behind `prefix`, off by the host's choice, or unmasked because the sandbox failed. */
export type Sandbox = { state: "mask"; prefix: string[] } | { state: "off" } | { state: "unmasked"; problem: string };

/** What the mask hides: files behind the bound /dev/null, folders behind a tmpfs. */
export interface MaskedPaths {
  files: string[];
  dirs: string[];
}

const PROBE_TIMEOUT_MS = 10_000;
const BASE_ARGS: readonly string[] = ["--dev-bind", "/", "/"];
/** What stays visible in the config dir: a run needs the host id and its checkout links. `config.toml` can hold `notify.webhook`, a URL that may act as a key; the gate's text rule is all that stands before it. */
const KEPT_FILE = /^(?:config|links)\.toml(?:$|[.~])/u;
const KEYS_DIR = "keys";
/** Where a run's launcher writes what the report does not need. */
const RUN_LOG = "run.log";
const FIX = 'Install bubblewrap and allow unprivileged user namespaces, or set [run] sandbox = "off" in config.toml.';

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function runsTrue(bin: string, args: readonly string[]): string | undefined {
  const probe = spawnSync(bin, [...args, "true"], { encoding: "utf8", timeout: PROBE_TIMEOUT_MS });
  if (probe.error === undefined && probe.status === 0) return undefined;
  const stderr = (probe.stderr ?? "").trim().slice(-200);
  return `${bin} ${args.join(" ")} true failed (${probe.error?.message ?? `exit ${String(probe.status ?? probe.signal)}`}${stderr === "" ? "" : `: ${stderr}`})`;
}

/**
 * The bwrap program of this host, proved to work, or what is wrong: PATH
 * first, then the NixOS profiles, which a systemd unit's PATH may leave out.
 * `$DARIUS_BWRAP` replaces the search; the test suite points it at a missing
 * file or a fake.
 */
export function probeBwrap(): { bin: string } | { problem: string } {
  const override = process.env.DARIUS_BWRAP;
  const isOverridden = override !== undefined && override !== "";
  const dirs = (process.env.PATH ?? "").split(delimiter).filter((dir) => dir.startsWith("/"));
  const user = process.env.USER ?? userInfo().username;
  const candidates = isOverridden ? [override] : [...dirs, `/etc/profiles/per-user/${user}/bin`, "/run/current-system/sw/bin"].map((dir) => join(dir, "bwrap"));
  const bin = candidates.find((candidate) => isExecutable(candidate));
  if (bin === undefined) return { problem: `bwrap is not on PATH or in the NixOS profiles. ${FIX}` };
  const failed = runsTrue(bin, BASE_ARGS);
  return failed === undefined ? { bin } : { problem: `${failed}. ${FIX}` };
}

/** The target of a path with symlinks resolved, and its type; undefined when nothing is there. */
function realEntry(path: string): { real: string; isFile: boolean; isDir: boolean } | undefined {
  try {
    const real = realpathSync(path);
    const stat = statSync(real);
    return { real, isFile: stat.isFile(), isDir: stat.isDirectory() };
  } catch {
    return undefined;
  }
}

/**
 * What the mask hides, listed now, so a new file is masked by default: every
 * regular file directly in the config dir but config.toml, links.toml and
 * their backups, `<config>/keys/`, and `remote.credentials` wherever it lies.
 * `~/.ssh` and `~/.claude` stay: runs need ssh, and the harness its login.
 */
export function maskedPaths(cfg: Config | null): MaskedPaths {
  const files = new Set<string>();
  const dirs = new Set<string>();
  let names: string[] = [];
  try {
    names = readdirSync(configDir());
  } catch {
    // No config dir, nothing in it to mask.
  }
  for (const name of names) {
    if (KEPT_FILE.test(name)) continue;
    const entry = realEntry(join(configDir(), name));
    if (entry?.isFile === true) files.add(entry.real);
    if (entry?.isDir === true && name === KEYS_DIR) dirs.add(entry.real);
  }
  const credentials = cfg?.remote === undefined ? undefined : realEntry(cfg.remote.credentials);
  if (credentials?.isFile === true) files.add(credentials.real);
  if (credentials?.isDir === true) dirs.add(credentials.real);
  return { files: [...files], dirs: [...dirs] };
}

/**
 * How to launch a run on this host now. Never throws for a sandbox failure: a
 * bwrap that is missing or fails its probe, with or without the masks, gives
 * `unmasked`. An unknown `[run] sandbox` throws in loadConfig, as any bad key.
 */
export function resolveSandbox(): Sandbox {
  const cfg = loadConfigIfPresent();
  if (cfg?.run.sandbox === "off") return { state: "off" };
  const probe = probeBwrap();
  if ("problem" in probe) return { state: "unmasked", problem: probe.problem };
  const { files, dirs } = maskedPaths(cfg);
  const args = [...BASE_ARGS, "--die-with-parent", ...dirs.flatMap((dir) => ["--tmpfs", dir]), ...files.flatMap((file) => ["--ro-bind", "/dev/null", file]), "--"];
  const failed = runsTrue(probe.bin, args);
  if (failed !== undefined) return { state: "unmasked", problem: `${failed}. ${FIX}` };
  return { state: "mask", prefix: [probe.bin, ...args] };
}

/** The argv prefix of a masked launch, else undefined. */
export function sandboxPrefix(sandbox: Sandbox): readonly string[] | undefined {
  return sandbox.state === "mask" ? sandbox.prefix : undefined;
}

/** One line in `<run>/run.log`. Best effort: a full disk must not stop the run. */
export function appendRunLog(runDir: string, line: string): void {
  try {
    appendFileSync(join(runDir, RUN_LOG), `${new Date().toISOString()} ${line}\n`);
  } catch {
    // The run matters more than its log.
  }
}

/** The one line a run gets when it starts without the mask it should have. */
export function noteSandbox(runDir: string, sandbox: Sandbox): void {
  if (sandbox.state === "unmasked") appendRunLog(runDir, `sandbox: this run starts UNMASKED, it can read darius secret files. ${sandbox.problem}`);
}

/** What `darius doctor` warns about on this host, or undefined. */
export function sandboxWarning(): string | undefined {
  try {
    const sandbox = resolveSandbox();
    return sandbox.state === "unmasked" ? `WARN: unattended runs on this host start unmasked and can read darius secret files. ${sandbox.problem}` : undefined;
  } catch (cause) {
    return `WARN: cannot read the sandbox setting: ${cause instanceof Error ? cause.message : String(cause)}`;
  }
}

/**
 * True when this process runs inside the mask: a direct file of the config dir
 * is the bound /dev/null. Alerts must not flush here. The channels look "not
 * set up", which would use up a notice's tries. The runner flushes after the
 * run, outside the mask.
 */
export function isInsideMask(): boolean {
  try {
    return readdirSync(configDir()).some((name) => isMaskedFile(join(configDir(), name)));
  } catch {
    return false;
  }
}
