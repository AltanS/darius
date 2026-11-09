/**
 * The operator's config.toml: remote bucket settings, the notify webhook, and
 * the host id (docs/plan-tonight.md, "Config and paths").
 *
 * The file format is the TOML subset in src/core/toml.ts.
 *
 * `allow_http` is enforced IN CODE, not by trusting the operator's own
 * setting: an `http://` endpoint is refused unless its host is loopback or
 * the tailnet (100.64.0.0/10), even when `allow_http = true` is set, because
 * the point of the check is to stop that flag from being turned on for a
 * public endpoint by mistake (docs/concept.md, "Security").
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { hostname, homedir } from "node:os";
import { dirname, join } from "node:path";

import { errorMessage } from "../runtime.ts";
import { writableProblem, type ProtectedDirs } from "./box.ts";
import { RUN_BEHIND, type RunBehind } from "./checkout-behind.ts";
import { sliceProblem } from "./box-scope.ts";
import { appDir, configDir, stateDir } from "./paths.ts";
import { parseToml, type TomlValue } from "./toml.ts";

/**
 * `src/core/paths.ts` (a parallel task, per docs/plan-tonight.md's module
 * contracts) owns `configDir()`. Reading the same env var here, behind a tiny
 * local helper, keeps this file buildable and testable without a hard
 * dependency on that file landing first. The two implementations are expected
 * to be near-identical one-liners; report it if `configDir()` ends up doing
 * more than this.
 */
function configFilePath(): string {
  return join(configDir(), "config.toml");
}

function expandHome(path: string): string {
  if (path === "~") return homedir();
  return path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;
}

function shortHostname(): string {
  const name = hostname();
  const firstLabel = name.split(".")[0];
  return firstLabel !== undefined && firstLabel !== "" ? firstLabel : name;
}

export interface Config {
  host: string;
  remote?: {
    endpoint: string;
    bucket: string;
    region: string;
    path_style: boolean;
    allow_http: boolean;
    sse: boolean;
    credentials: string;
  };
  notify: { webhook: string };
  /**
   * `[runner] claude`: the Claude Code executable `run-due` launches. Empty
   * means "DARIUS_CLAUDE, else `claude` on PATH". A host that wraps Claude
   * Code (for example in its own cgroup scope) points this at the wrapper.
   */
  runner: { claude: string };
  /**
   * `[setup] units`: the systemd units `setup --systemd` installs and
   * enables on this host. All four when the key is absent. A sync-only host
   * sets `units = ["sync"]`; `setup --systemd` then disables and removes the
   * other units it wrote. `darius update` reruns setup, so the choice
   * survives updates.
   */
  setup: { units: readonly SetupUnit[] };
  /**
   * `[run] sandbox`: how this host launches an unattended run (0.114.0).
   * `mask` (opt-in since 0.114.1): in bubblewrap, with darius secret files hidden from the
   * run's process tree (src/core/sandbox.ts). `off` (default): without bubblewrap. Inside
   * the mask, no_new_privs is on, so sudo and rootless podman fail. `box` (0.117.0): the run's
   * own sandbox (src/core/box.ts). Every launch uses it since 0.120.0 (src/runner/box-launch.ts).
   * `[run] behind` (0.126.0): what run-due does with a due ritual whose checkout is behind its
   * upstream (src/core/checkout-behind.ts). `warn` (default): the run goes ahead and the report
   * says so. `refuse`: the ritual skips as `checkout-behind`.
   */
  run: { sandbox: RunSandbox; behind: RunBehind };
  /**
   * `[box]` (0.117.0): what a run in the box may write besides its work dir,
   * and whether it gets the ssh agent. `writable` undefined means the default,
   * an empty list since 0.122.0 (`DEFAULT_BOX_WRITABLE` in src/core/box.ts). Each
   * path is checked at load: a path in or holding the store, the config dir,
   * `~/.claude`, `~/.ssh` or another protected path, or `~/.cache` itself, is an
   * error. The plan also refuses a path in or holding a PATH entry of the runner.
   * `slice` (0.124.0): the systemd user slice each boxed launch starts in, as a
   * scope of its own (src/core/box-scope.ts); absent means no scope.
   */
  box: { writable?: readonly string[]; sshAgent: boolean; slice?: string };
  /**
   * `[snapshot]`: the raw table of the local snapshots and their S3 copy
   * (src/core/snapshot-settings.ts validates it and merges it with the
   * environment and the dashboard's file). Absent without the table.
   */
  snapshot?: Readonly<Record<string, TomlValue>>;
}

/**
 * The units `[setup] units` may name, in the order setup lists them. All of
 * them when the key is absent (src/cli/setup.ts).
 */
export const SETUP_UNITS = ["sync", "vigil-sweep", "run-due", "web", "snapshot"] as const;

export type SetupUnit = (typeof SETUP_UNITS)[number];

function isSetupUnit(name: string): name is SetupUnit {
  return SETUP_UNITS.some((unit) => unit === name);
}

/** The values `[run] sandbox` takes. */
export const RUN_SANDBOXES = ["mask", "off", "box"] as const;

export type RunSandbox = (typeof RUN_SANDBOXES)[number];

// --- typed field access -------------------------------------------------------

function isTomlString(value: TomlValue): value is string {
  return typeof value === "string";
}

function isTomlBoolean(value: TomlValue): value is boolean {
  return typeof value === "boolean";
}

function requireString(
  table: Record<string, TomlValue>,
  key: string,
  tableName: string,
  file: string,
): string {
  const value = table[key];
  if (value === undefined) {
    throw new Error(`${file}: [${tableName}] is missing the required key "${key}"`);
  }
  if (!isTomlString(value)) {
    throw new Error(`${file}: [${tableName}] "${key}" must be a string`);
  }
  return value;
}

function optionalString(
  table: Record<string, TomlValue>,
  key: string,
  fallback: string,
  tableName: string,
  file: string,
): string {
  const value = table[key];
  if (value === undefined) return fallback;
  if (!isTomlString(value)) {
    throw new Error(`${file}: [${tableName}] "${key}" must be a string`);
  }
  return value;
}

function optionalBoolean(
  table: Record<string, TomlValue>,
  key: string,
  fallback: boolean,
  tableName: string,
  file: string,
): boolean {
  const value = table[key];
  if (value === undefined) return fallback;
  if (!isTomlBoolean(value)) {
    throw new Error(`${file}: [${tableName}] "${key}" must be true or false`);
  }
  return value;
}

function setupUnits(table: Record<string, TomlValue>, file: string): readonly SetupUnit[] {
  const value = table.units;
  if (value === undefined) return SETUP_UNITS;
  const valid = SETUP_UNITS.map((unit) => `"${unit}"`).join(", ");
  if (!Array.isArray(value)) {
    throw new Error(`${file}: [setup] "units" must be an array of unit names (valid: ${valid})`);
  }
  const units: SetupUnit[] = [];
  for (const name of value) {
    if (!isSetupUnit(name)) throw new Error(`${file}: [setup] units names an unknown unit "${name}" (valid: ${valid})`);
    if (!units.includes(name)) units.push(name);
  }
  return SETUP_UNITS.filter((unit) => units.includes(unit));
}

function runSandbox(table: Record<string, TomlValue>, file: string): RunSandbox {
  const name = optionalString(table, "sandbox", "off", "run", file);
  const known = RUN_SANDBOXES.find((value) => value === name);
  if (known === undefined) throw new Error(`${file}: [run] sandbox must be "off", "mask" or "box", found "${name}"`);
  return known;
}

function runBehind(table: Record<string, TomlValue>, file: string): RunBehind {
  const name = optionalString(table, "behind", "warn", "run", file);
  const known = RUN_BEHIND.find((value) => value === name);
  if (known === undefined) throw new Error(`${file}: [run] behind must be "warn" or "refuse", found "${name}"`);
  return known;
}

const BOX_KEYS: ReadonlySet<string> = new Set(["writable", "ssh_agent", "slice"]);

/** The dirs a `writable` path is checked against on this host. */
export function hostProtectedDirs(): ProtectedDirs {
  const dirs: ProtectedDirs = { home: homedir(), store: stateDir(), config: configDir(), app: appDir() };
  const runtimeDir = process.env.XDG_RUNTIME_DIR;
  if (runtimeDir?.startsWith("/") === true) dirs.runtimeDir = runtimeDir;
  return dirs;
}

/** The `[box]` table. An unknown key, a bad type or a refused `writable` path is an error that names it. */
function boxSettings(table: Record<string, TomlValue>, file: string): Config["box"] {
  for (const key of Object.keys(table)) {
    if (!BOX_KEYS.has(key)) throw new Error(`${file}: [box] has an unknown key "${key}" (known: ${[...BOX_KEYS].join(", ")})`);
  }
  const sshAgent = optionalBoolean(table, "ssh_agent", false, "box", file);
  const settings: Config["box"] = { sshAgent };
  if (table.slice !== undefined) {
    const slice = optionalString(table, "slice", "", "box", file);
    const problem = sliceProblem(slice);
    if (problem !== undefined) throw new Error(`${file}: [box] slice "${slice}" is refused: ${problem}`);
    settings.slice = slice;
  }
  const value = table.writable;
  if (value === undefined) return settings;
  if (!Array.isArray(value)) throw new Error(`${file}: [box] writable must be a list of paths: writable = ["~/.cache/my-tool"]`);
  const dirs = hostProtectedDirs();
  for (const path of value) {
    const problem = writableProblem(path, dirs);
    if (problem !== undefined) throw new Error(`${file}: [box] writable "${path}" is refused: ${problem}`);
  }
  return { ...settings, writable: [...new Set(value)] };
}

// --- allow_http rule ----------------------------------------------------------

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);
const IPV4 = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/;

/** Loopback, or inside the tailnet range 100.64.0.0/10 (docs/concept.md, "Security"). */
export function isLoopbackOrTailnet(host: string): boolean {
  if (LOOPBACK_HOSTS.has(host)) return true;
  const match = IPV4.exec(host);
  if (match === null) return false;
  const first = Number.parseInt(match[1] ?? "", 10);
  const second = Number.parseInt(match[2] ?? "", 10);
  return first === 100 && second >= 64 && second <= 127;
}

export function checkEndpointAllowed(endpoint: string, allowHttp: boolean, file: string): void {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch (cause) {
    throw new Error(`${file}: remote.endpoint "${endpoint}" is not a valid URL, ${errorMessage(cause)}`, {
      cause,
    });
  }
  if (url.protocol !== "http:") return;
  if (!allowHttp) {
    throw new Error(
      `${file}: remote.endpoint "${endpoint}" uses http, but remote.allow_http is not true. ` +
        "darius refuses plain HTTP without allow_http = true.",
    );
  }
  if (!isLoopbackOrTailnet(url.hostname)) {
    throw new Error(
      `${file}: allow_http is limited to loopback (127.0.0.1) or the tailnet (100.64.0.0/10). ` +
        `Refusing endpoint "${endpoint}".`,
    );
  }
}

// --- Config assembly -----------------------------------------------------------

function buildRemote(
  table: Record<string, TomlValue>,
  file: string,
): NonNullable<Config["remote"]> {
  const endpoint = requireString(table, "endpoint", "remote", file);
  const bucket = requireString(table, "bucket", "remote", file);
  const region = optionalString(table, "region", "us-east-1", "remote", file);
  const pathStyle = optionalBoolean(table, "path_style", true, "remote", file);
  const allowHttp = optionalBoolean(table, "allow_http", false, "remote", file);
  const sse = optionalBoolean(table, "sse", true, "remote", file);
  const credentials = expandHome(
    optionalString(table, "credentials", "~/.config/darius/credentials", "remote", file),
  );

  checkEndpointAllowed(endpoint, allowHttp, file);

  return {
    endpoint,
    bucket,
    region,
    path_style: pathStyle,
    allow_http: allowHttp,
    sse,
    credentials,
  };
}

/** Reads and validates `<configDir>/config.toml`. Throws when it is missing or malformed. */
export function loadConfig(): Config {
  const file = configFilePath();
  if (!existsSync(file)) {
    throw new Error(`${file}: no config found. Run "darius setup" first.`);
  }

  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (cause) {
    throw new Error(`${file}: cannot read config, ${errorMessage(cause)}`, { cause });
  }

  const document = parseToml(text, file);
  const host = optionalString(document.root, "host", shortHostname(), "root", file);
  const remoteTable = document.sections.remote;
  const remote = remoteTable === undefined ? undefined : buildRemote(remoteTable, file);
  const notifyTable = document.sections.notify ?? {};
  const webhook = optionalString(notifyTable, "webhook", "", "notify", file);

  const runnerTable = document.sections.runner ?? {};
  const claude = expandHome(optionalString(runnerTable, "claude", "", "runner", file));

  const units = setupUnits(document.sections.setup ?? {}, file);

  const sandbox = runSandbox(document.sections.run ?? {}, file);
  const behind = runBehind(document.sections.run ?? {}, file);
  const box = boxSettings(document.sections.box ?? {}, file);

  const snapshot = document.sections.snapshot;

  return { host, remote, notify: { webhook }, runner: { claude }, setup: { units }, run: { sandbox, behind }, box, snapshot };
}

/** config.toml, or null when there is none (a fresh host, or a test). A malformed file throws. */
export function loadConfigIfPresent(): Config | null {
  return existsSync(configFilePath()) ? loadConfig() : null;
}

/** Writes a minimal config.toml if none exists yet. Never overwrites one that is already there. */
export function writeConfigSkeleton(): "written" | "exists" {
  const file = configFilePath();
  if (existsSync(file)) return "exists";

  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `host = "${shortHostname()}"\n\n[notify]\nwebhook = ""\n`);
  } catch (cause) {
    throw new Error(`${file}: cannot write config skeleton, ${errorMessage(cause)}`, { cause });
  }
  return "written";
}
