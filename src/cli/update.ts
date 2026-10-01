/**
 * `darius update [vX.Y.Z] [--check] [--major] [--source URL] [--json]`
 * moves this host's app install (src/core/app.ts) to another release, and
 * `darius update --hosts h1,h2 [vX.Y.Z] [--major] [--source URL] [--json]`
 * pushes a release to other hosts over the operator's own SSH.
 *
 * This host, in order:
 *   1. darius must run from an app install (`<app>/versions/<tag>`). From
 *      the Nix store the flake input and `nixos-rebuild switch` own the
 *      version; from a checkout, `git` does, and the refusal names
 *      `scripts/install.sh`. Then take `<app>/update.lock`.
 *   2. The target is the argument, else the newest `vX.Y.Z` tag of the
 *      source (`git ls-remote`). `--check` prints current and newest and
 *      changes nothing. A newer MAJOR needs `--major`: the operator must
 *      change something first, and the release's CHANGELOG.md says what.
 *      An older version is allowed: a rollback by hand.
 *   3. Stage `versions/<tag>` (a shallow clone whose package.json must carry
 *      the tag's version), and preflight it: its `bin/darius --version`.
 *   4. Flip `current`, run the NEW version's `setup --systemd
 *      --keep-stopped` (units may change between versions, and `[setup]
 *      units` survives), restart `darius-web.service` when it is enabled.
 *      A timer the operator stopped stays stopped, one line each ("left
 *      stopped: ..."); an active one is restarted (0.42.3). The states are
 *      read before setup, and update stops a kept timer itself too, because
 *      an older version's setup (a rollback) ignores `--keep-stopped`.
 *   5. Health: `~/.local/bin/darius --version` names the new version, and
 *      with the web unit enabled, `/healthz` answers 200 within 30 s. On a
 *      failure flip back once, rerun the old version's setup, restart the
 *      web unit, record `rolled-back` and exit 1.
 *   6. Record `<app>/update.json`, then prune `versions/` to current plus
 *      the two newest others (the previous version first: it is the
 *      rollback target, and a timer that started before the flip still runs
 *      from it).
 *
 * The source: `--source`, else `DARIUS_SOURCE`, else the `origin` of the
 * current version's clone, else `https://github.com/AltanS/darius.git`.
 *
 * `--hosts`: the target is the argument, else THIS host's version, so the
 * peers level to the lead. Hosts go one after another, each over
 * `ssh -o BatchMode=yes -o ConnectTimeout=10` (the program is `DARIUS_SSH`,
 * default `ssh`) into a login bash, so a unit renders the host's login PATH.
 * A probe asks what the host has: with an app install, its own
 * `darius update <tag> --json` runs there; without one, this version's
 * `scripts/install.sh` is piped over (a bootstrap, which also adopts an old
 * checkout link); a darius from the Nix store is refused with the remedy.
 *
 * Exit codes: 0 ok, 1 refused or failed, 2 usage, 3 inconclusive (the source,
 * or with `--hosts` only some hosts, could not be reached).
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import {
  compareTags,
  currentTag,
  DEFAULT_SOURCE,
  flipCurrent,
  installKind,
  isMajorStep,
  newestTag,
  originUrl,
  pruneVersions,
  remoteTags,
  stageVersion,
  tagVersion,
  takeUpdateLock,
  toTag,
  versionDir,
  writeUpdateRecord,
  type UpdateOutcome,
} from "../core/app.ts";
import type { JsonValue } from "../core/model.ts";
import { appDir } from "../core/paths.ts";
import { ssh as sshRun, sshProgram, SSH_FAILED, type Ran } from "../core/ssh.ts";
import { errorMessage } from "../runtime.ts";
import { VERSION } from "../version.ts";
import { UsageError, type Command, type ParsedArgs } from "./registry.ts";
import { realSystemctl, timerPlan, timerStates, userUnitDir, type SystemctlRunner, type TimerPlan } from "./setup.ts";

const USAGE =
  "usage: darius update [vX.Y.Z] [--check] [--major] [--source URL] [--json]\n" +
  "       darius update --hosts h1,h2 [vX.Y.Z] [--major] [--source URL] [--json]";

const WEB_UNIT = "darius-web.service";
const DEFAULT_WEB_PORT = "4747";
const HEALTH_TIMEOUT_MS = 30_000;
const DARIUS_TIMEOUT_MS = 180_000;
const SSH_PROBE_TIMEOUT_MS = 60_000;
const SSH_UPDATE_TIMEOUT_MS = 900_000;

// --- deps -------------------------------------------------------------------------------

/** True once `url` answers 200, polling until `timeoutMs` passes. */
export type HealthProbe = (url: string, timeoutMs: number) => Promise<boolean>;

/** Every side effect of an update, injectable so a test never touches a real host. */
export interface UpdateDeps {
  /** darius's own root: the dir it runs from. */
  root: string;
  /** The app dir, `~/.local/opt/darius` or `DARIUS_APP_DIR`. */
  app: string;
  home: string;
  systemctl: SystemctlRunner;
  health: HealthProbe;
  healthTimeoutMs: number;
  now: () => Date;
  /** The ssh program for `--hosts`: `DARIUS_SSH`, else `ssh`. */
  ssh: string;
}

async function httpHealth(url: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (response.status === 200) return true;
    } catch {
      // Not listening yet: the restart is still under way.
    }
    await sleep(500);
  }
  return false;
}

/** The real host: this root, the real home, `systemctl --user`, HTTP against loopback. */
export function defaultUpdateDeps(): UpdateDeps {
  return {
    root: fileURLToPath(new URL("../../", import.meta.url)),
    app: appDir(),
    home: homedir(),
    systemctl: realSystemctl,
    health: httpHealth,
    healthTimeoutMs: HEALTH_TIMEOUT_MS,
    now: () => new Date(),
    ssh: sshProgram(),
  };
}

// --- reports ------------------------------------------------------------------------------

export type ReportOutcome = UpdateOutcome | "up-to-date" | "available" | "refused" | "unreachable";

/** What one run of `darius update` did. `--json` prints it as it is. */
export interface UpdateReport {
  ok: boolean;
  outcome: ReportOutcome;
  /** The version before, such as "0.16.0". With `--check`, the current one. */
  from: string | null;
  /** The version after, or the one asked for. With `--check`, the newest. */
  to: string | null;
  detail: string;
  /** Version dirs the prune removed. */
  pruned: string[];
  /** Timers that were stopped before the update and stay stopped (0.42.3). */
  leftStopped: string[];
}

export interface UpdateResult {
  code: number;
  report: UpdateReport;
}

function versionOf(tag: string | undefined): string | null {
  return tag === undefined ? null : tagVersion(tag);
}

function result(code: number, outcome: ReportOutcome, from: string | undefined, to: string | undefined, detail: string): UpdateResult {
  return { code, report: { ok: code === 0, outcome, from: versionOf(from), to: versionOf(to), detail, pruned: [], leftStopped: [] } };
}

/** The lines a person reads for one report. */
export function updateLines(report: UpdateReport): string[] {
  const from = report.from ?? "?";
  const to = report.to ?? "?";
  switch (report.outcome) {
    case "updated": {
      const lines = [`✓ updated ${from} -> ${to}`];
      if (report.detail !== "") lines.push(`· ${report.detail}`);
      if (report.pruned.length > 0) lines.push(`· removed old versions: ${report.pruned.join(", ")}`);
      for (const unit of report.leftStopped) lines.push(`· left stopped: ${unit}`);
      return lines;
    }
    case "up-to-date":
      return [`· up to date (${to})`];
    case "available":
      return [`current  ${from}`, `newest   ${to}`, `· ${report.detail}`];
    default:
      return [`! ${report.detail}`];
  }
}

// --- this host ----------------------------------------------------------------------------

export interface UpdateRequest {
  /** The tag to move to; undefined means the newest. */
  target: string | undefined;
  check: boolean;
  major: boolean;
  /** `--source`; undefined falls back to DARIUS_SOURCE, the clone's origin, the default. */
  source: string | undefined;
}

function realOrSame(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/** Where releases come from: `--source`, `DARIUS_SOURCE`, the current clone's origin, or GitHub. */
export function resolveSource(flag: string | undefined, app: string): string {
  if (flag !== undefined && flag !== "") return flag;
  const fromEnv = process.env.DARIUS_SOURCE;
  if (fromEnv !== undefined && fromEnv !== "") return fromEnv;
  return originUrl(join(app, "current")) ?? DEFAULT_SOURCE;
}

function majorRefusal(from: string, target: string, tags: readonly string[]): string {
  const same = parseMajor(from);
  const stay = newestTag(tags.filter((tag) => parseMajor(tag) === same && compareTags(tag, from) > 0));
  const stayHint = stay === undefined ? "" : ` To stay on ${same}.x, run darius update ${stay}.`;
  return (
    `${tagVersion(target)} is a new major: you must change something before you run it. ` +
    `Read CHANGELOG.md for ${target}, then run darius update ${target} --major.${stayHint}`
  );
}

function parseMajor(tag: string): number {
  return Number.parseInt(tagVersion(tag).split(".")[0] ?? "", 10);
}

type Target = { ok: true; tag: string; tags: readonly string[] } | { ok: false; outcome: UpdateResult };

/** The tag to move to. An explicit tag that is already staged needs no network. */
function findTarget(request: UpdateRequest, from: string, source: string, app: string): Target {
  if (request.target !== undefined && existsSync(versionDir(app, request.target))) {
    return { ok: true, tag: request.target, tags: [request.target] };
  }
  const listed = remoteTags(source);
  if (!listed.ok) return { ok: false, outcome: result(3, "unreachable", from, request.target, `cannot reach ${source}: ${listed.detail}`) };
  if (request.target !== undefined) {
    if (!listed.tags.includes(request.target)) {
      return { ok: false, outcome: result(1, "refused", from, request.target, `${source} has no tag ${request.target}`) };
    }
    return { ok: true, tag: request.target, tags: listed.tags };
  }
  const newest = newestTag(listed.tags);
  if (newest === undefined) return { ok: false, outcome: result(1, "failed", from, undefined, `${source} has no vX.Y.Z tag`) };
  return { ok: true, tag: newest, tags: listed.tags };
}

/** Runs a darius binary with this host's home and app dir, so a subprocess sees the same layout. */
function runDarius(bin: string, args: readonly string[], deps: UpdateDeps): Ran {
  const ran = spawnSync(bin, [...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: DARIUS_TIMEOUT_MS,
    env: { ...process.env, HOME: deps.home, DARIUS_APP_DIR: deps.app },
  });
  return { status: ran.status, stdout: ran.stdout, stderr: ran.stderr, error: ran.error === undefined ? undefined : errorMessage(ran.error) };
}

function printsVersion(ran: Ran, tag: string): boolean {
  const first = ran.stdout.trim().split("\n")[0] ?? "";
  const expected = `darius ${tagVersion(tag)}`;
  return ran.status === 0 && (first === expected || first.startsWith(`${expected} `));
}

function said(ran: Ran): string {
  if (ran.error !== undefined) return ran.error;
  const lines = `${ran.stdout}\n${ran.stderr}`.split("\n").map((line) => line.trim());
  const marked = lines.filter((line) => line.startsWith("!")).map((line) => line.replace(/^!\s*/u, ""));
  const last = (marked.length > 0 ? marked : lines.filter((line) => line !== "")).slice(-3);
  return last.length > 0 ? last.join(" / ") : `exit ${String(ran.status)}`;
}

function webEnabled(systemctl: SystemctlRunner): boolean {
  try {
    systemctl(["is-enabled", "--quiet", WEB_UNIT]);
    return true;
  } catch {
    return false;
  }
}

/** The port `darius-web.service` listens on: `DARIUS_WEB_PORT` in `~/.config/darius/web.env`, else 4747. */
export function webHealthUrl(home: string): string {
  let port = DEFAULT_WEB_PORT;
  try {
    const text = readFileSync(join(home, ".config", "darius", "web.env"), "utf8");
    for (const line of text.split("\n")) {
      const match = /^\s*(?:export\s+)?DARIUS_WEB_PORT\s*=\s*["']?(\d{1,5})["']?\s*$/u.exec(line);
      if (match?.[1] !== undefined) port = match[1];
    }
  } catch {
    // No web.env: the unit runs on the default port.
  }
  return `http://127.0.0.1:${port}/healthz`;
}

/**
 * Keeps each timer as the operator left it (timerPlan): a stopped one is
 * stopped again (a no-op unless an older setup started it), an active one
 * is restarted. Returns the timers left stopped, or why it failed.
 */
function keepTimerStates(plan: TimerPlan, deps: UpdateDeps): { leftStopped: string[] } | { failure: string } {
  try {
    for (const unit of plan.keepStopped) deps.systemctl(["stop", unit]);
    for (const unit of plan.restart) deps.systemctl(["restart", unit]);
  } catch (cause) {
    return { failure: `could not keep the timer states: ${errorMessage(cause)}` };
  }
  return { leftStopped: plan.keepStopped };
}

/** What `activate` found: why it failed (undefined when it did not), and the timers it left stopped. */
interface Activation {
  failure: string | undefined;
  leftStopped: string[];
}

/**
 * Makes `tag` (already behind `current`) the live version: its setup, the
 * timer states, a web restart, the health checks.
 */
async function activate(tag: string, deps: UpdateDeps): Promise<Activation> {
  const plan = timerPlan(timerStates(deps.systemctl, userUnitDir(deps.home)));
  const setup = runDarius(join(versionDir(deps.app, tag), "bin", "darius"), ["setup", "--systemd", "--keep-stopped"], deps);
  if (setup.status !== 0) return { failure: `setup --systemd of ${tagVersion(tag)} failed: ${said(setup)}`, leftStopped: [] };
  const kept = keepTimerStates(plan, deps);
  if ("failure" in kept) return { failure: kept.failure, leftStopped: [] };
  return { failure: await checkLive(tag, deps), leftStopped: kept.leftStopped };
}

/** The web restart and the health checks of `activate`. Returns why it failed, or undefined. */
async function checkLive(tag: string, deps: UpdateDeps): Promise<string | undefined> {
  const web = webEnabled(deps.systemctl);
  if (web) {
    try {
      deps.systemctl(["restart", WEB_UNIT]);
    } catch (cause) {
      return `could not restart ${WEB_UNIT}: ${errorMessage(cause)}`;
    }
  }
  const bin = join(deps.home, ".local", "bin", "darius");
  const version = runDarius(bin, ["--version"], deps);
  if (!printsVersion(version, tag)) {
    return `${bin} --version printed "${version.stdout.trim() || said(version)}", not darius ${tagVersion(tag)}`;
  }
  if (web) {
    const url = webHealthUrl(deps.home);
    if (!(await deps.health(url, deps.healthTimeoutMs))) {
      return `${WEB_UNIT} did not answer ${url} within ${Math.round(deps.healthTimeoutMs / 1000)} s`;
    }
  }
  return undefined;
}

function record(deps: UpdateDeps, from: string, to: string, outcome: UpdateOutcome, detail: string): void {
  writeUpdateRecord(deps.app, { from: tagVersion(from), to: tagVersion(to), at: deps.now().toISOString(), outcome, detail });
}

function checkOnly(request: UpdateRequest, from: string, source: string): UpdateResult {
  const listed = remoteTags(source);
  if (!listed.ok) return result(3, "unreachable", from, undefined, `cannot reach ${source}: ${listed.detail}`);
  const newest = newestTag(listed.tags);
  if (newest === undefined) return result(1, "failed", from, undefined, `${source} has no vX.Y.Z tag`);
  if (compareTags(newest, from) <= 0) return result(0, "up-to-date", from, from, "");
  const detail = isMajorStep(from, newest) && !request.major ? majorRefusal(from, newest, listed.tags) : "run darius update to take it";
  return result(0, "available", from, newest, detail);
}

async function updateLocked(request: UpdateRequest, from: string, source: string, deps: UpdateDeps): Promise<UpdateResult> {
  const target = findTarget(request, from, source, deps.app);
  if (!target.ok) return target.outcome;
  const to = target.tag;
  if (to === from) return result(0, "up-to-date", from, to, "");
  if (isMajorStep(from, to) && !request.major) return result(1, "refused", from, to, majorRefusal(from, to, target.tags));
  const older = compareTags(to, from) < 0 ? `${tagVersion(to)} is older than ${tagVersion(from)}: a rollback by hand` : "";

  const staged = stageVersion(deps.app, to, source);
  if (!staged.ok) {
    record(deps, from, to, "failed", staged.detail);
    return result(1, "failed", from, to, staged.detail);
  }
  const preflight = runDarius(join(versionDir(deps.app, to), "bin", "darius"), ["--version"], deps);
  if (!printsVersion(preflight, to)) {
    const detail = `${tagVersion(to)} did not start (bin/darius --version: ${said(preflight)}), so ${tagVersion(from)} stays`;
    record(deps, from, to, "failed", detail);
    return result(1, "failed", from, to, detail);
  }

  flipCurrent(deps.app, to);
  const { failure, leftStopped } = await activate(to, deps);
  if (failure === undefined) {
    record(deps, from, to, "updated", older);
    const outcome = result(0, "updated", from, to, older);
    outcome.report.pruned = pruneVersions(deps.app, to, from);
    outcome.report.leftStopped = leftStopped;
    return outcome;
  }

  // One rollback, never two: the previous version goes back behind `current`.
  flipCurrent(deps.app, from);
  const { failure: again } = await activate(from, deps);
  const detail =
    `${tagVersion(to)} failed its checks (${failure}), so ${tagVersion(from)} is back` +
    (again === undefined ? "" : `, but ${tagVersion(from)} failed its checks too (${again}). Look at the host by hand.`);
  record(deps, from, to, "rolled-back", detail);
  return result(1, "rolled-back", from, to, detail);
}

/** `darius update` on this host. */
export async function runUpdate(request: UpdateRequest, deps: UpdateDeps): Promise<UpdateResult> {
  const kind = installKind(realOrSame(deps.root), realOrSame(deps.app));
  if (kind.kind === "nix") {
    return result(1, "refused", `v${VERSION}`, request.target, "darius runs from the Nix store here: the flake input and nixos-rebuild switch own its version");
  }
  if (kind.kind === "checkout") {
    const root = realOrSame(deps.root);
    return result(
      1,
      "refused",
      `v${VERSION}`,
      request.target,
      `darius runs from a checkout (${root}), not from an app install, so git owns its version. Install the app with: bash ${join(root, "scripts", "install.sh")}`,
    );
  }
  const from = currentTag(deps.app) ?? kind.tag;
  const source = resolveSource(request.source, deps.app);
  if (request.check) return checkOnly(request, from, source);

  const lock = takeUpdateLock(deps.app);
  if (lock.held) return result(1, "refused", from, request.target, `another update runs (pid ${lock.pid}); try again when it ends`);
  try {
    return await updateLocked(request, from, source, deps);
  } finally {
    lock.release();
  }
}

// --- other hosts --------------------------------------------------------------------------

/** What the probe script learns about a host: its app install, a darius from Nix, another darius, or none. */
export type ProbeKind = "app" | "nix" | "other" | "none";

/**
 * Runs on the host, in bash. One line answers: `darius-probe <kind> <what>`.
 * The app comes first: a host with both an app install and a Nix darius
 * updates the app.
 */
const PROBE_SCRIPT = `app="\${DARIUS_APP_DIR:-$HOME/.local/opt/darius}"
if [ -x "$app/current/bin/darius" ]; then
  echo "darius-probe app $("$app/current/bin/darius" --version </dev/null 2>/dev/null || true)"
  exit 0
fi
found="$(command -v darius 2>/dev/null || true)"
if [ -n "$found" ]; then
  real="$(readlink -f "$found" 2>/dev/null || printf '%s' "$found")"
  case "$real" in
    /nix/store/*) echo "darius-probe nix $real" ;;
    *) echo "darius-probe other $real" ;;
  esac
  exit 0
fi
echo "darius-probe none"
`;

/** Runs on a host with an app install: its own `darius update`, whose JSON comes back. */
const REMOTE_UPDATE_SCRIPT = `exec "\${DARIUS_APP_DIR:-$HOME/.local/opt/darius}/current/bin/darius" update "$@" --json </dev/null
`;

/** The probe's answer, or null when no line of `stdout` is one. */
export function parseProbe(stdout: string): { kind: ProbeKind; what: string } | null {
  for (const line of stdout.split("\n")) {
    const match = /^darius-probe (app|nix|other|none)(?: (.*))?$/u.exec(line.trim());
    const kind = match?.[1];
    if (kind === "app" || kind === "nix" || kind === "other" || kind === "none") return { kind, what: match?.[2] ?? "" };
  }
  return null;
}

export type HostOutcome = "updated" | "up-to-date" | "installed" | "unreachable" | "refused" | "failed";

export interface HostReport {
  host: string;
  ok: boolean;
  outcome: HostOutcome;
  from: string | null;
  to: string | null;
  detail: string;
}

export interface PushRequest {
  hosts: readonly string[];
  target: string;
  major: boolean;
  /** `--source` or DARIUS_SOURCE, passed on to a host's own update. */
  source: string | undefined;
}

export interface PushResult {
  code: number;
  to: string;
  hosts: HostReport[];
}

function ssh(deps: UpdateDeps, host: string, args: readonly string[], input: string, timeoutMs: number): Ran {
  return sshRun(deps.ssh, host, ["bash", "-l", "-s", "--", ...args], input, timeoutMs);
}

function isRecord(value: JsonValue): value is { readonly [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isText(value: JsonValue | undefined): value is string {
  return typeof value === "string";
}

function textField(object: { readonly [key: string]: JsonValue }, key: string): string | null {
  const value = object[key];
  return isText(value) ? value : null;
}

/** The last line of `stdout` that is a JSON object, or null. */
function lastJsonObject(stdout: string): { readonly [key: string]: JsonValue } | null {
  const lines = stdout.split("\n").map((line) => line.trim()).filter((line) => line.startsWith("{")).toReversed();
  for (const line of lines) {
    try {
      const parsed: JsonValue = JSON.parse(line);
      if (isRecord(parsed)) return parsed;
    } catch {
      // Not JSON: a login script's own output. Keep looking.
    }
  }
  return null;
}

function hostReport(host: string, outcome: HostOutcome, from: string | null, to: string | null, detail: string): HostReport {
  return { host, ok: outcome === "updated" || outcome === "up-to-date" || outcome === "installed", outcome, from, to, detail };
}

function updateHost(host: string, request: PushRequest, deps: UpdateDeps): HostReport {
  const args = [request.target, ...(request.major ? ["--major"] : []), ...(request.source === undefined ? [] : ["--source", request.source])];
  const ran = ssh(deps, host, args, REMOTE_UPDATE_SCRIPT, SSH_UPDATE_TIMEOUT_MS);
  const answer = lastJsonObject(ran.stdout);
  if (answer === null) {
    if (ran.status === SSH_FAILED) return hostReport(host, "unreachable", null, null, said(ran));
    return hostReport(host, "failed", null, tagVersion(request.target), `no answer from darius update there: ${said(ran)}`);
  }
  const outcome = textField(answer, "outcome");
  const from = textField(answer, "from");
  const to = textField(answer, "to") ?? tagVersion(request.target);
  const detail = textField(answer, "detail") ?? "";
  if (ran.status === 0 && outcome === "updated") return hostReport(host, "updated", from, to, detail);
  if (ran.status === 0 && outcome === "up-to-date") return hostReport(host, "up-to-date", from, to, detail);
  return hostReport(host, outcome === "refused" ? "refused" : "failed", from, to, detail === "" ? said(ran) : detail);
}

function bootstrapHost(host: string, request: PushRequest, source: string, deps: UpdateDeps): HostReport {
  const script = join(deps.root, "scripts", "install.sh");
  let text: string;
  try {
    text = readFileSync(script, "utf8");
  } catch (cause) {
    return hostReport(host, "failed", null, tagVersion(request.target), `cannot read ${script}: ${errorMessage(cause)}`);
  }
  const ran = ssh(deps, host, ["--tag", request.target, "--source", source], text, SSH_UPDATE_TIMEOUT_MS);
  if (ran.status === 0) return hostReport(host, "installed", null, tagVersion(request.target), "");
  return hostReport(host, "failed", null, tagVersion(request.target), `install.sh failed: ${said(ran)}`);
}

function pushHost(host: string, request: PushRequest, source: string, deps: UpdateDeps): HostReport {
  const probed = ssh(deps, host, [], PROBE_SCRIPT, SSH_PROBE_TIMEOUT_MS);
  const probe = parseProbe(probed.stdout);
  if (probe === null) {
    if (probed.status === SSH_FAILED || probed.error !== undefined) return hostReport(host, "unreachable", null, null, said(probed));
    return hostReport(host, "failed", null, null, `the probe did not answer: ${said(probed)}`);
  }
  if (probe.kind === "nix") {
    return hostReport(
      host,
      "refused",
      null,
      tagVersion(request.target),
      `darius runs from the Nix store there (${probe.what}). Remove the home-manager module (services.darius) and switch first, then push again.`,
    );
  }
  if (probe.kind === "app") return updateHost(host, request, deps);
  return bootstrapHost(host, request, source, deps);
}

/** The exit code for a push: 1 when any host failed or refused, else 3 when any was unreachable, else 0. */
export function pushExitCode(hosts: readonly HostReport[]): number {
  if (hosts.some((host) => host.outcome === "failed" || host.outcome === "refused")) return 1;
  return hosts.some((host) => host.outcome === "unreachable") ? 3 : 0;
}

function ignoreHost(): void {
  // No one reads the hosts one by one: the caller prints them all at the end.
}

/** `darius update --hosts`: one host after another, never in parallel. `onHost` hears each as it ends. */
export function runPush(request: PushRequest, deps: UpdateDeps, onHost: (report: HostReport) => void = ignoreHost): PushResult {
  const source = request.source ?? resolveSource(undefined, deps.app);
  const hosts: HostReport[] = [];
  for (const host of request.hosts) {
    const report = pushHost(host, request, source, deps);
    hosts.push(report);
    onHost(report);
  }
  return { code: pushExitCode(hosts), to: tagVersion(request.target), hosts };
}

function printHost(report: HostReport): void {
  console.log(hostLine(report));
}

/** One line per host. */
export function hostLine(report: HostReport): string {
  switch (report.outcome) {
    case "updated":
      return `✓ ${report.host} ${report.from ?? "?"} -> ${report.to ?? "?"}`;
    case "up-to-date":
      return `· ${report.host} up to date`;
    case "installed":
      return `✓ ${report.host} installed ${report.to ?? "?"}`;
    case "unreachable":
      return `! ${report.host} unreachable`;
    default:
      return `! ${report.host}: ${report.detail}`;
  }
}

// --- the command --------------------------------------------------------------------------

function stringFlag(args: ParsedArgs, name: string): string | undefined {
  const value = args.flags[name];
  if (value === undefined || value === false) return undefined;
  if (value === true) throw new UsageError(`--${name} needs a value\n${USAGE}`);
  return value;
}

function targetArg(args: ParsedArgs): string | undefined {
  if (args.positional.length > 1) throw new UsageError(`one version at most\n${USAGE}`);
  const raw = args.positional[0];
  if (raw === undefined) return undefined;
  const tag = toTag(raw);
  if (tag === null) throw new UsageError(`'${raw}' is not a version such as v0.17.0\n${USAGE}`);
  return tag;
}

const HOST_NAME = /^[A-Za-z0-9_][A-Za-z0-9._@-]*$/u;

function hostsArg(raw: string): string[] {
  const hosts = raw
    .split(",")
    .map((host) => host.trim())
    .filter((host) => host !== "");
  if (hosts.length === 0) throw new UsageError(`--hosts needs at least one host\n${USAGE}`);
  for (const host of hosts) {
    if (!HOST_NAME.test(host)) throw new UsageError(`'${host}' is not a host name\n${USAGE}`);
  }
  return hosts;
}

export const updateCommand: Command = {
  name: "update",
  summary: "move this host's darius to another release, or push one to other hosts (--hosts)",
  async run(args: ParsedArgs): Promise<number> {
    if (args.flags.help === true) {
      console.log(USAGE);
      return 0;
    }
    const target = targetArg(args);
    const major = args.flags.major === true;
    const check = args.flags.check === true;
    const source = stringFlag(args, "source");
    const hosts = stringFlag(args, "hosts");
    const deps = defaultUpdateDeps();

    if (hosts !== undefined) {
      if (check) throw new UsageError(`--check works on this host only\n${USAGE}`);
      const fromEnv = process.env.DARIUS_SOURCE;
      const pushed = runPush(
        { hosts: hostsArg(hosts), target: target ?? `v${VERSION}`, major, source: source ?? (fromEnv === undefined || fromEnv === "" ? undefined : fromEnv) },
        deps,
        args.json ? ignoreHost : printHost,
      );
      if (args.json) console.log(JSON.stringify({ ok: pushed.code === 0, to: pushed.to, hosts: pushed.hosts }));
      return pushed.code;
    }

    const updated = await runUpdate({ target, check, major, source }, deps);
    if (args.json) console.log(JSON.stringify(updated.report));
    else for (const line of updateLines(updated.report)) console.log(line);
    return updated.code;
  },
};
