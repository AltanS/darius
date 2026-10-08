/**
 * `darius snapshot ...`: dated archives of this host's store, kept locally,
 * with an optional copy in an S3 bucket (src/core/snapshot.ts; docs/concept.md,
 * "Snapshots"). The settings come from the environment, the settings file and
 * config.toml (src/core/snapshot-settings.ts). Every write the web Backups page
 * makes has a verb here, through the same core functions.
 *
 *   snapshot create [--no-upload]   make a snapshot, copy it to the bucket, apply retention
 *   snapshot list [--remote]        the local snapshots, newest first; --remote lists the bucket too
 *   snapshot status [--hosts]       the settings summary, the timer, the last run, the bucket check;
 *                                   --hosts lists every host's last snapshot line from `_global`
 *   snapshot check                  list the bucket, write a probe object, try to delete it, and
 *                                   report whether the key may delete and the bucket keeps versions
 *   snapshot fetch <name> [--host <host>]
 *                                   copy a snapshot and its manifest from the bucket (GET only)
 *   snapshot delete <name> [--remote]
 *                                   delete one snapshot, here or in the bucket
 *   snapshot config                 every setting with its value and source
 *   snapshot config set <key> <value> [<key> <value> ...] | unset <key> [<key> ...]
 *                                   save or clear settings in snapshot.json in one write, as the
 *                                   page does; endpoint and bucket go together
 *   snapshot config push --hosts a,b [--overwrite]
 *                                   copy the settings (not dir, enabled) and the key pair to
 *                                   other hosts over ssh; the secret goes on ssh stdin only
 *                                   (src/cli/snapshot-push.ts, with its other half `receive`);
 *                                   exit 1 also for a host that timed out (state unknown)
 *   snapshot credentials [status]   which key pair wins and its key id; never the secret
 *   snapshot credentials set --key-id <id>
 *                                   save the key pair; the secret comes on stdin, never on the command line
 *   snapshot credentials clear      remove the saved key pair
 *
 * The verbs act on this host only and are not host-bound: there is no right
 * host to name and no `--on`. Each host has its own store, settings and key.
 *
 * `config` and `credentials` read `<config>/snapshot.env` under this shell's
 * variables (snapshotUnitEnv), so they see what the timer and the page see: a
 * key that file sets is refused, as the page refuses it.
 *
 * Exit codes (probe contract): 0 done; 1 refused or failed (a problem in the
 * settings, a key the environment sets, a bad value, a secret-looking name in
 * the store, a failed upload that is no network fault, no bucket for
 * `list --remote`); 2 usage (an unknown key, a secret on a terminal); 3 the
 * snapshot is local but the bucket could not be reached, or `list --remote`
 * could not reach it. The next run makes a new snapshot and uploads that one;
 * the missed one is not sent again. `create` with `enabled = false` makes no
 * snapshot and exits 0, so the timer does not show as failed.
 *
 * Every `create` run leaves one line in the `_global` ledger (snapshot.ok,
 * snapshot.failed or snapshot.off; src/core/backup-state.ts), so every host
 * can list every host's last backup. A ledger write that fails is a warning,
 * not a change of the exit code.
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

import { readBackupStates, recordSnapshotLine, snapshotLineFor, snapshotOffLine, STALE_AFTER_MS, type BackupState } from "../core/backup-state.ts";
import { loadConfigIfPresent } from "../core/config.ts";
import { hostId } from "../core/ledger.ts";
import { stateDir } from "../core/paths.ts";
import {
  checkRemote,
  checkVerdict,
  deleteLocalSnapshot,
  deleteRemoteSnapshot,
  describeSnapshotRun,
  fetchRemoteSnapshot,
  listLocalSnapshots,
  listRemoteSnapshots,
  parseSnapshotName,
  readSnapshotState,
  runningSnapshot,
  runSnapshot,
  type CheckRecord,
} from "../core/snapshot.ts";
import {
  applySnapshotSettings,
  credentialsEnvLock,
  credentialsSource,
  displaySnapshotValue,
  isSnapshotKey,
  maskPingUrl,
  readSnapshotEnvFile,
  removeSnapshotCredentials,
  resolveSnapshotSettings,
  saveSnapshotCredentials,
  snapshotCredentialsPath,
  snapshotEnvFilePath,
  snapshotEnvName,
  snapshotKeyId,
  snapshotUnitEnv,
  SNAPSHOT_KEYS,
  type ResolvedSnapshotSettings,
  type SnapshotKey,
} from "../core/snapshot-settings.ts";
import { VERSION } from "../version.ts";
import { readStdin } from "./args.ts";
import { pushConfig, receiveConfig } from "./snapshot-push.ts";
import { UsageError, type Command, type ParsedArgs } from "./registry.ts";

const VERBS = "create | list | status | check | fetch | delete | config | credentials";
const TIMER = "darius-snapshot.timer";
const PIPE_HINT = 'printf %s "$SECRET" | darius snapshot credentials set --key-id ID';

/** What the verbs need from the host, injected so a test never reaches systemd or a terminal. */
export interface SnapshotDeps {
  /** `systemctl --user <args>`, its stdout. Throws when systemctl is missing or fails. */
  systemctl(args: string[]): string;
  stdinIsTTY(): boolean;
  readStdin(): string;
}

/** `DARIUS_SYSTEMCTL`, else `systemctl`. The test script points it at a missing file. */
function systemctlProgram(): string {
  const program = process.env.DARIUS_SYSTEMCTL;
  return program === undefined || program === "" ? "systemctl" : program;
}

export const realSnapshotDeps: SnapshotDeps = {
  systemctl: (args) => execFileSync(systemctlProgram(), ["--user", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 10_000 }),
  stdinIsTTY: () => process.stdin.isTTY === true,
  readStdin,
};

function stringFlag(args: ParsedArgs, name: string): string | undefined {
  const value = args.flags[name];
  if (value === undefined || value === false) return undefined;
  if (value === true) throw new UsageError(`--${name} needs a value`);
  return value;
}

function mib(bytes: number): string {
  return `${(bytes / 1_048_576).toFixed(1)} MiB`;
}

// --- settings, shared by status and config ------------------------------------------------

/** Every key with its value and source: the `settings` object of `status --json` and `config --json`. */
function settingsView(resolved: ResolvedSnapshotSettings): Record<string, { value: string | number | boolean | undefined; source: string | undefined }> {
  return Object.fromEntries(SNAPSHOT_KEYS.map((key) => [key, { value: displaySnapshotValue(key, resolved.values.get(key)), source: resolved.sources.get(key) }]));
}

/** One setting for a person: `keep        = 7  (default)`; an env value names its variable. */
function settingLine(resolved: ResolvedSnapshotSettings, key: SnapshotKey): string {
  const value = displaySnapshotValue(key, resolved.values.get(key));
  const source = resolved.sources.get(key) ?? "default";
  return `${key.padEnd(12)} = ${JSON.stringify(value ?? null)}  (${source === "env" ? `env ${snapshotEnvName(key)}` : source})`;
}

// --- the timer ------------------------------------------------------------------------------

/** `darius-snapshot.timer` as `systemctl --user show` reports it. `known` is false without a user session. */
export interface SnapshotTimer {
  known: boolean;
  installed: boolean | null;
  enabled: boolean | null;
  active: boolean | null;
  /** The next run as systemctl prints it, or null. */
  next: string | null;
  /** What the operator should do, or null. */
  hint: string | null;
}

/** The fix for a missing timer: setup installs it, unless `[setup] units` leaves it out. */
function installHint(): string {
  let units: readonly string[] | undefined;
  try {
    units = loadConfigIfPresent()?.setup.units;
  } catch {
    units = undefined;
  }
  if (units !== undefined && !units.includes("snapshot")) return 'add "snapshot" to [setup] units in config.toml, then run darius setup --systemd';
  return "run darius setup --systemd to install it";
}

export function readSnapshotTimer(deps: SnapshotDeps): SnapshotTimer {
  const unknown: SnapshotTimer = { known: false, installed: null, enabled: null, active: null, next: null, hint: null };
  let text: string;
  try {
    text = deps.systemctl(["show", TIMER, "--property=LoadState,UnitFileState,ActiveState,NextElapseUSecRealtime"]);
  } catch {
    return unknown;
  }
  const props = new Map<string, string>();
  for (const line of text.split("\n")) {
    const at = line.indexOf("=");
    if (at > 0) props.set(line.slice(0, at).trim(), line.slice(at + 1).trim());
  }
  const load = props.get("LoadState");
  if (load === undefined) return unknown;
  if (load !== "loaded") return { known: true, installed: false, enabled: false, active: false, next: null, hint: installHint() };
  const enabled = (props.get("UnitFileState") ?? "").startsWith("enabled");
  const active = props.get("ActiveState") === "active";
  const next = props.get("NextElapseUSecRealtime") ?? "";
  return {
    known: true,
    installed: true,
    enabled,
    active,
    next: next === "" || next === "n/a" ? null : next,
    hint: enabled && active ? null : `start it: systemctl --user enable --now ${TIMER}`,
  };
}

function timerLine(timer: SnapshotTimer): string {
  if (!timer.known) return "· timer: unknown (no systemd user session)";
  if (timer.installed !== true) return `· timer: not installed; ${timer.hint ?? ""}`;
  const state = `${timer.enabled === true ? "enabled" : "disabled"}, ${timer.active === true ? "active" : "inactive"}`;
  const next = timer.next === null ? "" : `, next run ${timer.next}`;
  return `· timer: ${state}${next}${timer.hint === null ? "" : `; ${timer.hint}`}`;
}

// --- create, list, status, check, delete ---------------------------------------------------------

async function create(args: ParsedArgs): Promise<number> {
  const resolved = resolveSnapshotSettings();
  // Off on purpose is not a failure: the timer must not show as failed every night.
  if (resolved.problems.length === 0 && !resolved.settings.enabled) {
    // The line keeps the other hosts from calling this host stale.
    const warning = recordSnapshotLine(snapshotOffLine());
    const warnings = warning === null ? [] : [warning];
    if (args.json) console.log(JSON.stringify({ code: 0, ok: true, name: null, skipped: "off", warnings }));
    else console.log("· snapshots are off (enabled = false), nothing done");
    if (warning !== null) console.error(`darius snapshot: ${warning}`);
    return 0;
  }
  const result = await runSnapshot({
    resolved,
    host: hostId(),
    version: VERSION,
    stateDir: stateDir(),
    upload: args.flags["no-upload"] !== true,
  });
  // One line per run, after the archive and the upload. A refused run (another run holds the lock) made nothing and writes none.
  if (!result.busy) {
    const warning = recordSnapshotLine(snapshotLineFor(result, resolved, VERSION));
    if (warning !== null) result.warnings.push(warning);
  }
  if (args.json) console.log(JSON.stringify(result));
  else console.log(describeSnapshotRun(result));
  for (const warning of result.warnings) console.error(`darius snapshot: ${warning}`);
  return result.code;
}

async function list(args: ParsedArgs): Promise<number> {
  const resolved = resolveSnapshotSettings();
  const { dir } = resolved.settings;
  if (args.flags.remote === true) return listRemote(args, resolved);
  const rows = listLocalSnapshots(dir);
  if (args.json) {
    console.log(JSON.stringify({ snapshots: rows }));
    return 0;
  }
  if (rows.length === 0) console.log("· no local snapshots yet");
  for (const row of rows) console.log(`${row.name}  ${mib(row.bytes)}${row.remote ? "  in the bucket" : ""}`);
  return 0;
}

/** `list --remote`: the bucket's snapshots of this host next to the local ones. 1 without a bucket, 3 when it cannot be reached. */
async function listRemote(args: ParsedArgs, resolved: ResolvedSnapshotSettings): Promise<number> {
  const { dir } = resolved.settings;
  const fail = (error: string, code: number): number => {
    if (args.json) console.log(JSON.stringify({ ok: false, error, local: listLocalSnapshots(dir), remote: [] }));
    else console.log(`! ${error}`);
    return code;
  };
  if (resolved.settings.remote === null) {
    return fail("no bucket is set up: darius snapshot config set endpoint <url>, then darius snapshot config set bucket <name>", 1);
  }
  const listed = await listRemoteSnapshots(resolved, hostId());
  if (!listed.ok) return fail(`the bucket could not be listed: ${listed.error}`, listed.offline ? 3 : 1);
  // Read after the listing: it refreshed the "in the bucket" marks of the local rows.
  const local = listLocalSnapshots(dir);
  const here = new Set(local.map((row) => row.name));
  const row = (object: { name: string; bytes: number }, monthly: boolean) => ({
    name: monthly ? `monthly/${object.name}` : object.name,
    at: parseSnapshotName(object.name)?.at ?? "",
    bytes: object.bytes,
    local: here.has(object.name),
    monthly,
  });
  const remote = [...listed.objects.map((object) => row(object, false)), ...listed.monthly.map((object) => row(object, true))];
  if (args.json) {
    console.log(JSON.stringify({ ok: true, local, remote }));
    return 0;
  }
  if (remote.length === 0) console.log("· no snapshots of this host in the bucket");
  for (const found of remote) console.log(`${found.name}  ${mib(found.bytes)}  ${found.local ? "also here" : "bucket only"}${found.monthly ? "  monthly" : ""}`);
  return 0;
}

// --- status --hosts ---------------------------------------------------------------------------------

/** `5h`, `2d 3h`, `12m`: a span for a person. */
function spanWords(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${String(minutes)}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${String(hours)}h`;
  return `${String(Math.floor(hours / 24))}d ${String(hours % 24)}h`;
}

function bucketWords(state: BackupState): string {
  if (state.remote === null) return "no bucket copy";
  return state.remote.ok ? "bucket ok" : `bucket failed: ${state.remote.error ?? "unknown"}`;
}

/** One row: host, state, age of the last good snapshot, what it was, and what the bucket did. */
function hostRow(state: BackupState): string {
  const age = state.age_ms === null ? "no good snapshot" : `${spanWords(state.age_ms)} ago`;
  const what = state.name === null ? "" : `  ${state.name}  ${mib(state.bytes ?? 0)}  ${bucketWords(state)}`;
  const failure = state.error === null ? "" : `  last run failed: ${state.error}`;
  const stale = state.reason === null ? "" : `  ${state.reason}`;
  const note = state.state === "off" ? "  snapshots are off on purpose" : `${stale}${failure}`;
  return `${state.host.padEnd(16)} ${state.state.padEnd(7)} ${age}${what}${note}`;
}

/** `status --hosts`: the newest snapshot line of every host that wrote one, from the synced `_global` ledger. Always 0. */
function statusHosts(args: ParsedArgs): number {
  const states = readBackupStates();
  if (args.json) {
    console.log(JSON.stringify({ hosts: states, stale_after_ms: STALE_AFTER_MS }));
    return 0;
  }
  if (states.length === 0) {
    console.log("· no host has written a snapshot line yet");
    return 0;
  }
  const silent = states.filter((state) => state.state === "silent");
  for (const state of states) if (state.state !== "silent") console.log(hostRow(state));
  if (silent.length > 0) console.log(`· silent for over 30 days, not counted as stale: ${silent.map((state) => state.host).join(", ")}`);
  return 0;
}

function status(args: ParsedArgs, deps: SnapshotDeps): number {
  if (args.flags.hosts === true) return statusHosts(args);
  const resolved = resolveSnapshotSettings();
  const state = readSnapshotState(resolved.settings.dir);
  const running = runningSnapshot(resolved.settings.dir);
  const timer = readSnapshotTimer(deps);
  if (args.json) {
    console.log(
      JSON.stringify({
        enabled: resolved.settings.enabled,
        settings: settingsView(resolved),
        credentials: credentialsSource(),
        problems: resolved.problems,
        running,
        last: state.last,
        remote: state.remote,
        check: state.check,
        timer,
      }),
    );
    return resolved.problems.length === 0 ? 0 : 1;
  }
  console.log(`snapshots ${resolved.settings.enabled ? "on" : "off"}, folder ${resolved.settings.dir}, keep ${String(resolved.settings.keep)}`);
  const remote = resolved.settings.remote;
  const keepRemote = resolved.settings.remotePrune ? `keep ${String(resolved.settings.keepRemote)}` : "remote: kept by the bucket (remote_prune off)";
  console.log(remote === null ? "· no remote copy" : `· remote copy: ${remote.endpoint} bucket ${remote.bucket}, ${keepRemote}, key pair from ${credentialsSource()}`);
  if (remote !== null && !resolved.settings.remotePrune) console.log(`· keep_remote (${String(resolved.settings.keepRemote)}) is ignored: darius never deletes in the bucket`);
  if (resolved.settings.pingUrl !== null) console.log(`· dead-man ping: ${maskPingUrl(resolved.settings.pingUrl)}`);
  console.log(timerLine(timer));
  if (running !== null) console.log(`· running now (pid ${String(running.pid)})`);
  if (state.last !== null) console.log(`· last run ${state.last.at}: ${state.last.ok ? "ok" : `failed, ${state.last.error ?? ""}`}`);
  // A run can make its local snapshot (ok) and still fail to reach the bucket, so the bucket gets its own line.
  if (state.remote !== null) console.log(`· bucket, last contact ${state.remote.at}: ${state.remote.ok ? `ok, ${String(state.remote.objects.length)} snapshots` : `failed, ${state.remote.error ?? ""}`}`);
  const newestMonthly = state.remote?.monthly?.[0];
  if (remote !== null && resolved.settings.keepMonthly > 0) console.log(`· monthly copies: ${resolved.settings.remotePrune ? `keep ${String(resolved.settings.keepMonthly)}` : "kept by the bucket (remote_prune off)"}, newest ${newestMonthly === undefined ? "none yet" : `monthly/${newestMonthly.name}`}`);
  if (remote !== null && state.check !== null) for (const line of checkLines(state.check, resolved.settings.remotePrune)) console.log(line);
  for (const problem of resolved.problems) console.log(`! ${problem}`);
  return resolved.problems.length === 0 ? 0 : 1;
}

/** The stored check in `status`: its facts, its warnings, and a note when remote_prune changed since. */
function checkLines(record: CheckRecord, remotePrune: boolean): string[] {
  const lines = [`· bucket check ${record.at}: delete ${record.delete}, versioning ${record.versioning}`, ...record.warnings.map((warning) => `! ${warning}`)];
  if (record.remotePrune !== remotePrune) lines.push("! remote_prune changed since the last check: run darius snapshot check again");
  return lines;
}

async function check(args: ParsedArgs): Promise<number> {
  const result = await checkRemote(resolveSnapshotSettings(), hostId());
  if (args.json) {
    console.log(JSON.stringify(result));
    return result.ok ? 0 : 1;
  }
  if (!result.ok) {
    console.log(`! ${result.error ?? "the check failed"}`);
    return 1;
  }
  const probe = result.probe ?? "";
  console.log(`✓ the bucket answers, ${String(result.objects.length)} snapshots of this host`);
  console.log(`· write: ok (probe ${probe})`);
  console.log(result.delete === "refused" ? `· delete: refused (HTTP 403). The probe ${probe} stays; the next check overwrites it` : "· delete: allowed, the probe is gone");
  console.log(`· versioning: ${result.versioning ?? "unknown"}`);
  console.log(`· remote_prune: ${result.remotePrune ? "on, darius deletes old snapshots in the bucket" : "off, darius never deletes in the bucket"}`);
  for (const warning of result.warnings) console.log(`! ${warning}`);
  console.log(checkVerdict(result));
  return 0;
}

/** `fetch <name> [--host <host>]`: the archive and its manifest from the bucket, for `darius restore`. */
async function fetchOne(args: ParsedArgs): Promise<number> {
  const name = args.positional[1];
  if (name === undefined || args.positional.length > 2) throw new UsageError("snapshot fetch needs one snapshot name; darius snapshot list --remote shows them");
  const done = await fetchRemoteSnapshot(resolveSnapshotSettings(), name, stringFlag(args, "host"));
  if (args.json) console.log(JSON.stringify(done));
  else if (!done.ok) console.log(`! ${done.error}`);
  else console.log(done.already ? `· ${done.path} is already here` : `✓ fetched ${done.path} (${mib(done.bytes)}); restore it: darius restore ${done.name}`);
  return done.code;
}

async function remove(args: ParsedArgs): Promise<number> {
  const name = args.positional[1];
  if (name === undefined) throw new UsageError("snapshot delete needs a snapshot name");
  const resolved = resolveSnapshotSettings();
  const done = args.flags.remote === true ? await deleteRemoteSnapshot(resolved, hostId(), name) : deleteLocalSnapshot(resolved.settings.dir, name);
  if (args.json) console.log(JSON.stringify(done));
  else console.log(done.ok ? `✓ deleted ${name}` : `! ${done.error}`);
  return done.ok ? 0 : 1;
}

// --- config -----------------------------------------------------------------------------------------

function showConfig(args: ParsedArgs): number {
  const resolved = resolveSnapshotSettings({ env: snapshotUnitEnv() });
  if (args.json) {
    console.log(JSON.stringify({ settings: settingsView(resolved), problems: resolved.problems }));
  } else {
    for (const key of SNAPSHOT_KEYS) console.log(settingLine(resolved, key));
    for (const problem of resolved.problems) console.log(`! ${problem}`);
  }
  return resolved.problems.length === 0 ? 0 : 1;
}

function keyOf(name: string): SnapshotKey {
  if (!isSnapshotKey(name)) throw new UsageError(`unknown key "${name}"; keys: ${SNAPSHOT_KEYS.join(", ")}`);
  return name;
}

/** `set <key> <value> [<key> <value> ...]`: the pairs, keys checked. */
function setPairs(words: readonly string[]): Map<SnapshotKey, string> {
  if (words.length === 0 || words.length % 2 !== 0) throw new UsageError(`snapshot config set needs <key> <value> pairs; keys: ${SNAPSHOT_KEYS.join(", ")}`);
  const pairs = new Map<SnapshotKey, string>();
  for (let at = 0; at < words.length; at += 2) pairs.set(keyOf(words[at] ?? ""), words[at + 1] ?? "");
  return pairs;
}

/** `unset <key> [<key> ...]`: the keys, checked. */
function unsetKeys(words: readonly string[]): Map<SnapshotKey, null> {
  if (words.length === 0) throw new UsageError(`snapshot config unset needs a key: ${SNAPSHOT_KEYS.join(", ")}`);
  return new Map(words.map((word) => [keyOf(word), null]));
}

/** Why a save failed, with the file a variable comes from and the fix for a half-set bucket. */
function saveError(errors: readonly string[], keys: readonly SnapshotKey[]): string {
  const fromFile = readSnapshotEnvFile();
  const notes = keys
    .map(snapshotEnvName)
    .filter((name) => (process.env[name] ?? "") === "" && (fromFile[name] ?? "") !== "" && errors.some((error) => error.includes(name)))
    .map((name) => ` (${name} is in ${snapshotEnvFilePath()})`);
  const half = errors.some((error) => error.includes("needs both an endpoint and a bucket")) ? "; set both in one call: darius snapshot config set endpoint <url> bucket <name>" : "";
  return `${errors.join("; ")}${notes.join("")}${half}`;
}

/**
 * Saves (text) or clears (null) the given keys in one write, through the
 * page's own save (applySnapshotSettings). One key prints `{ok, key, value,
 * source}` with --json; several print `{ok, changed: [{key, value, source}]}`.
 */
function changeConfig(args: ParsedArgs, patch: ReadonlyMap<SnapshotKey, string | null>): number {
  const keys = [...patch.keys()];
  const applied = applySnapshotSettings(patch, snapshotUnitEnv());
  if (!applied.ok) {
    const error = saveError(applied.errors, keys);
    if (args.json) console.log(JSON.stringify(keys.length === 1 ? { ok: false, key: keys[0], error } : { ok: false, keys, error }));
    else console.log(`! ${error}`);
    return 1;
  }
  const changed = keys.map((key) => ({ key, value: displaySnapshotValue(key, applied.resolved.values.get(key)), source: applied.resolved.sources.get(key) ?? "default" }));
  if (args.json) console.log(JSON.stringify(changed.length === 1 ? { ok: true, ...changed[0] } : { ok: true, changed }));
  else for (const key of keys) console.log(`✓ ${settingLine(applied.resolved, key)}`);
  return 0;
}

function config(args: ParsedArgs, deps: SnapshotDeps): number {
  const verb = args.positional[1];
  const words = args.positional.slice(2);
  if (verb === undefined) return showConfig(args);
  if (verb === "set") return changeConfig(args, setPairs(words));
  if (verb === "unset") return changeConfig(args, unsetKeys(words));
  if (verb === "push") return pushConfig(args, words);
  if (verb === "receive") return receiveConfig(deps.stdinIsTTY, deps.readStdin);
  throw new UsageError("snapshot config takes no verb, set <key> <value> [<key> <value> ...], unset <key> [<key> ...], or push --hosts <host>[,<host>...]");
}

// --- credentials ---------------------------------------------------------------------------------------

function credentialsStatus(args: ParsedArgs): number {
  const env = snapshotUnitEnv();
  const { source, keyId, error } = snapshotKeyId(env);
  const file = snapshotCredentialsPath();
  const stored = existsSync(file);
  if (args.json) {
    console.log(JSON.stringify({ source, stored, keyId, file, error }));
    return error === null ? 0 : 1;
  }
  if (source === "none") console.log(`· no key pair; save one: ${PIPE_HINT}`);
  else if (source === "env") console.log(`key pair from the environment (${credentialsEnvLock(env) ?? ""}), key id ${keyId ?? "unreadable"}`);
  else console.log(`key pair from ${file}, key id ${keyId ?? "unreadable"}`);
  if (source === "env" && stored) console.log(`· the saved pair in ${file} is not used while the environment sets one`);
  if (error !== null) console.log(`! ${error}`);
  return error === null ? 0 : 1;
}

function credentialsSet(args: ParsedArgs, deps: SnapshotDeps): number {
  // The secret is refused anywhere it would be seen: on the command line, in a flag. Neither is echoed.
  if (args.positional.length > 2) throw new UsageError(`the secret never goes on the command line; pipe it on stdin: ${PIPE_HINT}`);
  if (Object.keys(args.flags).some((name) => name.includes("secret"))) throw new UsageError(`the secret never goes in a flag; pipe it on stdin: ${PIPE_HINT}`);
  const keyId = stringFlag(args, "key-id");
  if (keyId === undefined || keyId.trim() === "") throw new UsageError(`snapshot credentials set needs --key-id <id>, and the secret on stdin: ${PIPE_HINT}`);
  const env = snapshotUnitEnv();
  // Refused before stdin is read when the environment sets the pair; the same check runs again in the save.
  const locked = credentialsEnvLock(env) !== null;
  let secret = locked ? "" : args.stdin;
  if (secret === undefined) {
    if (deps.stdinIsTTY()) throw new UsageError(`snapshot credentials set reads the secret from stdin, not a terminal: ${PIPE_HINT}`);
    secret = deps.readStdin();
  }
  const saved = saveSnapshotCredentials(keyId, secret.replace(/\r?\n$/u, ""), env);
  if (!saved.ok) return refuse(args, saved.error);
  const file = snapshotCredentialsPath();
  if (args.json) console.log(JSON.stringify({ ok: true, keyId: keyId.trim(), file }));
  else console.log(`✓ the key pair is saved in ${file} (mode 0600), key id ${keyId.trim()}`);
  return 0;
}

/** A refused change of the key pair: the message of the shared save, which names no key value. */
function refuse(args: ParsedArgs, error: string): number {
  if (args.json) console.log(JSON.stringify({ ok: false, error }));
  else console.log(`! ${error}`);
  return 1;
}

function credentialsClear(args: ParsedArgs): number {
  const cleared = removeSnapshotCredentials(snapshotUnitEnv());
  if (!cleared.ok) return refuse(args, cleared.error);
  if (args.json) console.log(JSON.stringify({ ok: true, removed: cleared.removed }));
  else console.log(cleared.removed ? "✓ the saved key pair is removed" : "· no saved key pair");
  return 0;
}

function credentials(args: ParsedArgs, deps: SnapshotDeps): number {
  const verb = args.positional[1];
  if (verb === undefined || verb === "status") return credentialsStatus(args);
  if (verb === "set") return credentialsSet(args, deps);
  if (verb === "clear") return credentialsClear(args);
  throw new UsageError("snapshot credentials takes status, set --key-id <id> (the secret on stdin), or clear");
}

// --- dispatch ------------------------------------------------------------------------------------------

export async function runSnapshotCommand(args: ParsedArgs, deps: SnapshotDeps): Promise<number> {
  const verb = args.positional[0];
  if (verb === "create") return create(args);
  if (verb === "list") return list(args);
  if (verb === "status") return status(args, deps);
  if (verb === "check") return check(args);
  if (verb === "fetch") return fetchOne(args);
  if (verb === "delete") return remove(args);
  if (verb === "config") return config(args, deps);
  if (verb === "credentials") return credentials(args, deps);
  throw new UsageError(`snapshot needs a verb: ${VERBS}`);
}

export const snapshotCommand: Command = {
  name: "snapshot",
  summary: "archive this host's store into a local folder and an optional S3 bucket (create, list, status, check, fetch, delete, config, credentials)",
  usage: `snapshot ${VERBS}`,
  run: (args: ParsedArgs): Promise<number> => runSnapshotCommand(args, realSnapshotDeps),
};
