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
import { configDir } from "./paths.ts";
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

// --- allow_http rule ----------------------------------------------------------

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);
const IPV4 = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/;

/** Loopback, or inside the tailnet range 100.64.0.0/10 (docs/concept.md, "Security"). */
function isLoopbackOrTailnet(host: string): boolean {
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

  const snapshot = document.sections.snapshot;

  return { host, remote, notify: { webhook }, runner: { claude }, setup: { units }, snapshot };
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
