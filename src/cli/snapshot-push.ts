/**
 * `darius snapshot config push --hosts a,b [--overwrite] [--json]` and its
 * other half, `darius snapshot config receive --json`
 * (src/core/snapshot-push.ts; docs/backups.md, "Set up every host at once").
 *
 * push: reads this host's settings and key pair, then for each host, one
 * after another, makes one call over the operator's own ssh
 * (src/core/ssh.ts: `<ssh> -o BatchMode=yes -o ConnectTimeout=10 <host>
 * bash -l -s --`). Its stdin is the one-line script REMOTE_RECEIVE_SCRIPT,
 * then the JSON document. bash reads its script from a pipe line by line, so
 * the `exec` on the first line hands the rest of stdin, the document, to the
 * host's darius. The secret is in that stdin and nowhere else: not on a command line,
 * not in an environment variable, not in a file. A host that cannot be
 * reached does not stop the others.
 *
 * A host whose name is this host (localhost, 127.x, this host name or host
 * id) is refused without a call. The receiver also refuses a document with
 * its own host id, which catches an alias of this host.
 *
 * receive: reads the document on stdin (never a terminal), applies it and
 * prints one JSON object. It is for push, not for a person.
 *
 * Every text that comes back from a host is cleaned of the secret before it
 * is printed, in case a host echoes its input.
 *
 * Exit codes: push 0 all applied; 1 any host refused, failed or timed out
 * (a host that timed out may have applied the settings), or nothing to push
 * here; 2 usage; 3 only unreachable hosts failed. receive 0 applied, 1
 * refused or failed, 2 stdin is a terminal.
 */

import { hostname } from "node:os";

import { hostId } from "../core/ledger.ts";
import type { JsonValue } from "../core/model.ts";
import {
  buildPushDocument,
  parsePushDocument,
  receivePushDocument,
  type CredentialsOutcome,
  type PushDocument,
  type ReceiveAnswer,
  type SettingChange,
} from "../core/snapshot-push.ts";
import { readSnapshotCredentials, resolveSnapshotSettings, snapshotUnitEnv } from "../core/snapshot-settings.ts";
import { ssh, sshProgram, SSH_FAILED, type Ran } from "../core/ssh.ts";
import { errorMessage } from "../runtime.ts";
import { UsageError, type ParsedArgs } from "./registry.ts";

/** Runs on the host in bash. The document follows on the next line of stdin. */
export const REMOTE_RECEIVE_SCRIPT = `exec "\${DARIUS_APP_DIR:-$HOME/.local/opt/darius}/current/bin/darius" snapshot config receive --json
`;

const SSH_RECEIVE_TIMEOUT_MS = 60_000;
const HOST_NAME = /^[A-Za-z0-9_][A-Za-z0-9._@-]*$/u;
/** ssh exits 2 on a usage error of the host's darius: an older darius has no receive verb. */
const USAGE_EXIT = 2;
/** bash exits 127 when the exec finds no darius at the app path. */
const NOT_FOUND_EXIT = 127;
const PUSH_USAGE = "snapshot config push --hosts <host>[,<host>...] [--overwrite] [--json]";

export type ConfigPushOutcome = "applied" | "unreachable" | "timed-out" | "refused" | "failed";

export interface ConfigPushReport {
  host: string;
  ok: boolean;
  outcome: ConfigPushOutcome;
  detail: string;
  applied: string[];
  changes: SettingChange[];
  env: string[];
  credentials: CredentialsOutcome | null;
  keyIdFrom: string | null;
  needsOverwrite: boolean;
}

export interface ConfigPushResult {
  code: number;
  /** Why nothing was sent, or null. */
  error: string | null;
  hosts: ConfigPushReport[];
}

export interface ConfigPushDeps {
  /** The ssh program: DARIUS_SSH, else ssh. */
  ssh: string;
  /** This host's id, read once. */
  hostId: string;
  /** The OS host name. */
  hostname: string;
  timeoutMs: number;
}

export function defaultConfigPushDeps(): ConfigPushDeps {
  return { ssh: sshProgram(), hostId: hostId(), hostname: hostname(), timeoutMs: SSH_RECEIVE_TIMEOUT_MS };
}

// --- the reports ---------------------------------------------------------------------------

function report(host: string, outcome: ConfigPushOutcome, detail: string, extra: Partial<ConfigPushReport> = {}): ConfigPushReport {
  return { host, ok: outcome === "applied", outcome, detail, applied: [], changes: [], env: [], credentials: null, keyIdFrom: null, needsOverwrite: false, ...extra };
}

/** `text` with every copy of the secret replaced. */
export function redact(text: string, secret: string): string {
  if (secret === "") return text;
  // Also the form the secret takes inside a JSON string, should a host echo the document.
  return text.replaceAll(secret, "[secret]").replaceAll(JSON.stringify(secret).slice(1, -1), "[secret]");
}

/** The last lines a failed call printed, cleaned of the secret. */
function said(ran: Ran, secret: string): string {
  if (ran.error !== undefined) return redact(ran.error, secret);
  const lines = `${ran.stdout}\n${ran.stderr}`
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
  return lines.length > 0 ? redact(lines.slice(-3).join(" / "), secret) : `exit ${String(ran.status)}`;
}

function isRecord(value: JsonValue | undefined): value is { readonly [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The last line of `stdout` that is a JSON object, or null. A login script may print other lines first. */
function lastJsonObject(stdout: string): { readonly [key: string]: JsonValue } | null {
  const lines = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("{"))
    .toReversed();
  for (const line of lines) {
    try {
      const parsed: JsonValue = JSON.parse(line);
      if (isRecord(parsed)) return parsed;
    } catch {
      // Not JSON. Keep looking.
    }
  }
  return null;
}

function isText(value: JsonValue | undefined): value is string {
  return typeof value === "string";
}

function isScalar(value: JsonValue | undefined): value is number | boolean {
  return typeof value === "number" || typeof value === "boolean";
}

function textOf(value: JsonValue | undefined, secret: string): string {
  return isText(value) ? redact(value, secret) : "";
}

function wordsOf(value: JsonValue | undefined, secret: string): string[] {
  return Array.isArray(value) ? value.filter(isText).map((item) => redact(item, secret)) : [];
}

function settingOf(value: JsonValue | undefined, secret: string): string | number | boolean | null {
  if (isText(value)) return redact(value, secret);
  return isScalar(value) ? value : null;
}

function changesOf(value: JsonValue | undefined, secret: string): SettingChange[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((item) => ({
    key: textOf(item.key, secret),
    from: settingOf(item.from, secret),
    to: settingOf(item.to, secret) ?? "",
    source: textOf(item.source, secret),
  }));
}

function credentialsOf(value: JsonValue | undefined): CredentialsOutcome | null {
  return value === "created" || value === "replaced" || value === "env" ? value : null;
}

/** The host's answer as a report. Every text in it is cleaned of the secret. */
function fromAnswer(host: string, status: number | null, found: { readonly [key: string]: JsonValue }, secret: string): ConfigPushReport {
  const detail = textOf(found.detail, secret);
  const outcome: ConfigPushOutcome = found.outcome === "applied" && status === 0 ? "applied" : found.outcome === "refused" ? "refused" : "failed";
  return report(host, outcome, outcome === "failed" && detail === "" ? `exit ${String(status)}` : detail, {
    applied: wordsOf(found.applied, secret),
    changes: changesOf(found.changes, secret),
    env: wordsOf(found.env, secret),
    credentials: credentialsOf(found.credentials),
    keyIdFrom: isText(found.keyIdFrom) ? redact(found.keyIdFrom, secret) : null,
    needsOverwrite: found.needsOverwrite === true,
  });
}

// --- push ---------------------------------------------------------------------------------------

/** True when `host` names this host: a loopback name or address, the OS host name, or this host's darius id. */
export function isThisHost(host: string, deps: Pick<ConfigPushDeps, "hostId" | "hostname">): boolean {
  const name = (host.split("@").at(-1) ?? host).toLowerCase();
  const os = deps.hostname.toLowerCase();
  const local = new Set(["localhost", "localhost.localdomain", "ip6-localhost", os, os.split(".")[0] ?? os, deps.hostId.toLowerCase()]);
  return local.has(name) || local.has(name.split(".")[0] ?? name) || /^127\.\d+\.\d+\.\d+$/u.test(name) || name === "0.0.0.0";
}

function pushHost(host: string, document: PushDocument, deps: ConfigPushDeps): ConfigPushReport {
  if (isThisHost(host, deps)) return report(host, "refused", "this is the local host; a push goes to other hosts only");
  const input = `${REMOTE_RECEIVE_SCRIPT}${JSON.stringify(document)}\n`;
  const ran = ssh(deps.ssh, host, ["bash", "-l", "-s", "--"], input, deps.timeoutMs);
  const found = lastJsonObject(ran.stdout);
  if (found !== null) return fromAnswer(host, ran.status, found, document.secret);
  if (ran.timedOut === true) return report(host, "timed-out", `timed out, state unknown: run darius snapshot config on ${host}`);
  if (ran.status === SSH_FAILED || ran.error !== undefined) return report(host, "unreachable", said(ran, document.secret));
  if (ran.status === USAGE_EXIT) return report(host, "failed", `no receive verb there: run darius update --hosts ${host} first`);
  if (ran.status === NOT_FOUND_EXIT) return report(host, "failed", `no darius app install there: run darius update --hosts ${host} first`);
  return report(host, "failed", `no answer from darius there: ${said(ran, document.secret)}`);
}

/** The exit code: 1 when any host refused, failed or timed out, else 3 when any was unreachable, else 0. */
export function configPushExitCode(hosts: readonly ConfigPushReport[]): number {
  if (hosts.some((host) => host.outcome === "failed" || host.outcome === "refused" || host.outcome === "timed-out")) return 1;
  return hosts.some((host) => host.outcome === "unreachable") ? 3 : 0;
}

function ignoreHost(): void {
  // The caller prints all hosts at the end.
}

/** Pushes this host's settings and key pair to `hosts`, one after another. */
export function runConfigPush(hosts: readonly string[], overwrite: boolean, deps: ConfigPushDeps, onHost: (report: ConfigPushReport) => void = ignoreHost): ConfigPushResult {
  const env = snapshotUnitEnv();
  const keyPair = readSnapshotCredentials(env);
  if (!keyPair.ok) return { code: 1, error: `no key pair to push: ${keyPair.error}`, hosts: [] };
  const built = buildPushDocument(resolveSnapshotSettings({ env }), keyPair.credentials, deps.hostId, overwrite);
  if (!built.ok) return { code: 1, error: built.error, hosts: [] };
  const reports: ConfigPushReport[] = [];
  for (const host of hosts) {
    const done = pushHost(host, built.document, deps);
    reports.push(done);
    onHost(done);
  }
  return { code: configPushExitCode(reports), error: null, hosts: reports };
}

function changeLine(change: SettingChange): string {
  return `    ${change.key}: ${JSON.stringify(change.from)} -> ${JSON.stringify(change.to)}${change.source === "default" ? "" : `  (was from ${change.source})`}`;
}

function keyPairWords(done: ConfigPushReport): string {
  if (done.credentials === "env") return "key pair set by the environment there, same key id";
  return done.credentials === "created" ? "key pair saved" : "key pair replaced";
}

/** The lines for one host. */
export function configPushLines(done: ConfigPushReport): string[] {
  const head = (() => {
    if (done.outcome === "applied") return `✓ ${done.host}: ${String(done.applied.length)} settings changed, ${keyPairWords(done)}`;
    if (done.outcome === "unreachable") return `! ${done.host} unreachable`;
    return `! ${done.host}: ${done.detail}`;
  })();
  const lines = [head, ...done.changes.map(changeLine)];
  if (done.keyIdFrom !== null) lines.push(`    key id: ${done.keyIdFrom} -> the pushed one`);
  for (const key of done.env) lines.push(`    · ${key} is set by the environment there, same value`);
  return lines;
}

function printHost(done: ConfigPushReport): void {
  for (const line of configPushLines(done)) console.log(line);
}

function hostsArg(raw: string | boolean | undefined): string[] {
  if (raw === undefined || raw === true || raw === false) throw new UsageError(`snapshot config push needs --hosts\n  ${PUSH_USAGE}`);
  const hosts = raw
    .split(",")
    .map((host) => host.trim())
    .filter((host) => host !== "");
  if (hosts.length === 0) throw new UsageError(`--hosts needs at least one host\n  ${PUSH_USAGE}`);
  for (const host of hosts) {
    if (!HOST_NAME.test(host)) throw new UsageError(`'${host}' is not a host name\n  ${PUSH_USAGE}`);
  }
  return hosts;
}

/** `snapshot config push`. `words` are the positionals after `push`. */
export function pushConfig(args: ParsedArgs, words: readonly string[], deps: () => ConfigPushDeps = defaultConfigPushDeps): number {
  if (words.length > 0) throw new UsageError(`snapshot config push takes no positional words; the key pair is read here, never from argv\n  ${PUSH_USAGE}`);
  if (Object.keys(args.flags).some((name) => name.includes("secret"))) throw new UsageError(`the secret never goes in a flag\n  ${PUSH_USAGE}`);
  const hosts = hostsArg(args.flags.hosts);
  const pushed = runConfigPush(hosts, args.flags.overwrite === true, deps(), args.json ? ignoreHost : printHost);
  if (args.json) console.log(JSON.stringify({ ok: pushed.code === 0, error: pushed.error, hosts: pushed.hosts }));
  else if (pushed.error !== null) console.log(`! ${pushed.error}`);
  return pushed.code;
}

// --- receive -------------------------------------------------------------------------------------

function printAnswer(found: ReceiveAnswer): number {
  console.log(JSON.stringify(found));
  return found.ok ? 0 : 1;
}

function refusedAnswer(detail: string, outcome: "refused" | "failed" = "refused"): ReceiveAnswer {
  return { ok: false, outcome, applied: [], changes: [], env: [], credentials: null, keyIdFrom: null, needsOverwrite: false, detail };
}

/** `snapshot config receive`: the document on stdin, one JSON answer on stdout. */
export function receiveConfig(stdinIsTTY: () => boolean, readStdin: () => string): number {
  if (stdinIsTTY()) throw new UsageError("snapshot config receive reads a document from stdin, not a terminal; darius snapshot config push sends it");
  const parsed = parsePushDocument(readStdin().trim());
  if (!parsed.ok) return printAnswer(refusedAnswer(parsed.error));
  let here: string;
  try {
    here = hostId();
  } catch (cause) {
    return printAnswer(refusedAnswer(`this host has no valid host id: ${redact(errorMessage(cause), parsed.document.secret)}`, "failed"));
  }
  const found = receivePushDocument(parsed.document, here, snapshotUnitEnv());
  return printAnswer({ ...found, detail: redact(found.detail, parsed.document.secret) });
}
