/**
 * `darius run-due` and `darius policy-check` (T10): src/runner/*.ts,
 * src/cli/run-due.ts, src/cli/policy-check.ts.
 *
 * The real `claude` is never started. DARIUS_CLAUDE points at a fake: a
 * bash script that records its argv, env and cwd under FAKE_CLAUDE_LOG/<run>/,
 * then acts per FAKE_CLAUDE_MODE (`complete` calls back into `darius run
 * complete`, `hold` into `darius run hold`, `silent` does nothing, `sleep`
 * outlives the timeout), and prints a result JSON like `--output-format json`.
 * `darius` on the fake's PATH is a symlink to this repo's bin/darius.
 *
 * run-due and policy-check are not wired into src/cli/commands.ts by this
 * task, so their Commands are driven in process; one test spawns a child
 * with real stdin for policy-check.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { parseArgs } from "../src/cli/args.ts";
import { policyCheckCommand } from "../src/cli/policy-check.ts";
import { profileCommand } from "../src/cli/profile.ts";
import { ritualCommand } from "../src/cli/ritual.ts";
import { runCommand } from "../src/cli/run.ts";
import { claudeHarness } from "../src/harness/claude.ts";
import { forwardsRun, isProtocolCommand, REPORT_MODE_WRITE_VERBS } from "../src/harness/gate.ts";
import type { Command } from "../src/cli/registry.ts";
import { reportScope, runDueCommand, verbArgv } from "../src/cli/run-due.ts";
import { appendLine, hostId, readLedger, type LedgerLineInput } from "../src/core/ledger.ts";
import type { JsonValue, LedgerLine, Policy, Ritual } from "../src/core/model.ts";
import { S3NetworkError, type ListedObject, type S3 } from "../src/core/s3.ts";
import { getBlobText, openProject, sha256Hex } from "../src/core/store.ts";
import { localToday } from "../src/core/sweep.ts";
import { ulid } from "../src/core/ulid.ts";
import { writeLink } from "../src/core/links.ts";
import { acknowledgeRun } from "../src/runner/hold.ts";
import { failedToday as failedTodayRun, takeRitualLease } from "../src/runner/run-due.ts";
import { followUpReadiness } from "../src/runner/follow-up-ready.ts";
import { planFollowUp } from "../src/runner/follow-up.ts";
import { runDetail } from "../src/web/status.ts";
import { preflightGate } from "../src/runner/launch.ts";
import { agentName } from "../src/surface/herdr.ts";
import { formatReport, type BatchReport, type RitualEntry } from "../src/runner/report.ts";
import { harnessCommand } from "../src/cli/harness.ts";
import { readSummary, type RunResult } from "../src/core/result.ts";
import { latestHandoff } from "../src/core/handoff.ts";
import { missingTools, namedTools } from "../src/runner/tools.ts";

const SANDBOX = mkdtempSync(join(tmpdir(), "darius-runner-"));
process.env.DARIUS_STATE_DIR = join(SANDBOX, "state");
process.env.DARIUS_CONFIG_DIR = join(SANDBOX, "config");
delete process.env.DARIUS_PROJECT;
// Where the Claude adapter looks for a session to resume; never the operator's ~/.claude.
const CLAUDE_HOME = join(SANDBOX, "claude-home");
process.env.CLAUDE_CONFIG_DIR = CLAUDE_HOME;

const REPO = join(import.meta.dirname, "..");
const BIN = join(SANDBOX, "bin");
const FAKE_LOG = join(SANDBOX, "claude-log");
mkdirSync(BIN, { recursive: true });
mkdirSync(FAKE_LOG, { recursive: true });
symlinkSync(join(REPO, "bin", "darius"), join(BIN, "darius"));

/** bash by full path. The Nix build sandbox has no /usr/bin/env for a shebang to use. */
const BASH =
  (process.env.PATH ?? "")
    .split(":")
    .map((dir) => join(dir, "bash"))
    .find((candidate) => candidate.startsWith("/") && existsSync(candidate)) ?? "/bin/bash";

const FAKE_CLAUDE = join(BIN, "fake-claude");
writeFileSync(
  FAKE_CLAUDE,
  `#!${BASH}
set -euo pipefail
if [ "\${1:-}" = --version ]; then printf '%s (Claude Code)\\n' "\${FAKE_CLAUDE_VERSION:-2.1.999}"; exit 0; fi
log="$FAKE_CLAUDE_LOG/\${DARIUS_RUN:-no-run}"
mkdir -p "$log"
printf '%s\\0' "$@" > "$log/argv"
printf 'DARIUS_RUN=%s\\nDARIUS_RUN_POLICY=%s\\nDARIUS_PROJECT=%s\\nPWD=%s\\nPATH=%s\\n' \\
  "$DARIUS_RUN" "$DARIUS_RUN_POLICY" "$DARIUS_PROJECT" "$PWD" "$PATH" > "$log/env"
if [ "$DARIUS_PROJECT" = _global ]; then
  markers="$(printf '%s' "\${2:-}" | grep -o 'touch [^ ]*' | cut -d' ' -f2)"
  main="$(printf '%s\\n' "$markers" | sed -n 1p)"
  sub="$(printf '%s\\n' "$markers" | sed -n 2p)"
  gate() {
    printf '{"tool_name":"%s","tool_input":{"command":"%s"},"session_id":"fake-check"%s}' "$1" "$2" "$3" \\
      | darius policy-check --policy "$DARIUS_RUN_POLICY" >/dev/null
  }
  mode="\${FAKE_CLAUDE_CHECK:-obey}"
  case "$mode" in
    obey|obey-main|ignore-sub) if gate Bash "touch $main" ""; then touch "$main"; fi ;;
    ignore) touch "$main" ;;
  esac
  case "$mode" in
    obey|ignore-sub) gate Agent "" "" || true ;;
  esac
  case "$mode" in
    obey) if gate Bash "touch $sub" ',"agent_id":"fake-sub"'; then touch "$sub"; fi ;;
    ignore-sub) touch "$sub" ;;
  esac
  printf '{"type":"result","is_error":false,"session_id":"fake-check","total_cost_usd":0.0004,"result":"checked"}\\n'
  exit 0
fi
case "\${FAKE_CLAUDE_MODE:-complete}" in
  complete)
    result="\${FAKE_CLAUDE_RESULT:-}"
    [ -n "$result" ] || result='{"v":1,"status":"ok","summary":"heartbeat ok"}'
    printf 'heartbeat ok\\n\`\`\`darius-result\\n%s\\n\`\`\`\\n' "$result" \\
      | darius run complete "$DARIUS_RUN" --project "$DARIUS_PROJECT" \\
      --outcome complete --findings-stdin --who claude:fake-session >/dev/null ;;
  hold)
    darius run hold "$DARIUS_RUN" --project "$DARIUS_PROJECT" --question "may I push?" --who claude:fake-session >/dev/null ;;
  sleep) sleep 31.7 ;;
  silent) : ;;
esac
printf '{"type":"result","is_error":false,"session_id":"fake-session","total_cost_usd":0.0012,"result":"done"}\\n'
`,
);
chmodSync(FAKE_CLAUDE, 0o755);
process.env.DARIUS_CLAUDE = FAKE_CLAUDE;
// The fake's default version has passed its gate check, so run-due starts it
// at once; the gate check tests below give the fake a new version.
appendLine(openProject("_global", { create: true }), { who: "test", type: "harness.checked", harness: "claude", version: "2.1.999", outcome: "passed" });
// Never the operator's live herdr: tests that need one use FAKE_HERDR below.
process.env.DARIUS_HERDR = join(SANDBOX, "no-herdr");

/**
 * A fake herdr: enough of the CLI for the herdr surface. `agent prompt`
 * starts the fake claude in the background with the env the tab was
 * created with. `agent get` reports $FAKE_HERDR_DIR/status (default
 * working), or agent_not_found when that file says gone. Every call is
 * logged to $FAKE_HERDR_DIR/calls, one line each.
 */
const FAKE_HERDR = join(BIN, "fake-herdr");
const FAKE_HERDR_DIR = join(SANDBOX, "herdr");
mkdirSync(FAKE_HERDR_DIR, { recursive: true });
writeFileSync(
  FAKE_HERDR,
  `#!${BASH}
set -euo pipefail
dir="$FAKE_HERDR_DIR"
printf '%s\n' "$*" >> "$dir/calls"
case "$1 \${2:-}" in
  "status "*) printf 'server:\n  status: running\n' ;;
  "workspace list") printf '{"result":{"type":"workspace_list","workspaces":[]}}\n' ;;
  "workspace create") printf '{"result":{"workspace":{"workspace_id":"w9"},"tab":{"tab_id":"w9:t1"},"root_pane":{"pane_id":"w9:p1"}}}\n' ;;
  "tab create")
    : > "$dir/tab.env"
    while [ $# -gt 0 ]; do
      if [ "$1" = "--env" ]; then printf 'export %q\n' "$2" >> "$dir/tab.env"; shift; fi
      shift
    done
    printf '{"result":{"tab":{"tab_id":"w9:t2"},"root_pane":{"pane_id":"w9:p2"}}}\n' ;;
  "agent start")
    if [ -e "$dir/start-blocked" ]; then
      printf '{"error":{"code":"agent_not_ready","message":"agent is blocked during startup"}}\n' >&2; exit 1
    fi
    if [ ! -e "$dir/shell-ready" ]; then
      : > "$dir/shell-ready"
      printf '{"error":{"code":"agent_pane_busy","message":"agent target pane is not an available shell"}}\n' >&2; exit 1
    fi
    printf '{"result":{"type":"agent_started"}}\n' ;;
  "agent prompt")
    ( set +u; . "$dir/tab.env"; "$FAKE_CLAUDE" -p >/dev/null 2>&1 ) &
    printf '{"result":{"type":"agent_prompted"}}\n' ;;
  "agent get")
    status="$(cat "$dir/status" 2>/dev/null || echo working)"
    if [ "$status" = gone ]; then
      printf '{"error":{"code":"agent_not_found","message":"agent target x not found"}}\n' >&2; exit 1
    fi
    printf '{"result":{"agent":{"agent_status":"%s"}}}\n' "$status" ;;
  "tab close") printf '{"result":{"type":"ok"}}\n' ;;
  *) printf '{"error":{"code":"unknown","message":"fake herdr: %s"}}\n' "$*" >&2; exit 1 ;;
esac
`,
);
chmodSync(FAKE_HERDR, 0o755);
process.env.FAKE_HERDR_DIR = FAKE_HERDR_DIR;
process.env.FAKE_CLAUDE = FAKE_CLAUDE;
process.env.FAKE_CLAUDE_LOG = FAKE_LOG;
process.env.PATH = `${BIN}:${process.env.PATH ?? ""}`;

const HEARTBEAT_POLICY: Policy = {
  mode: "report",
  may: ["Bash(darius *)", "Bash(date)"],
  hold: ["git push", "rm -rf"],
  model: "haiku",
  max_turns: 6,
};

function seedRitual(project: string, opts: { slug?: string; policy?: Policy; importedFrom?: string } = {}): string {
  const slug = opts.slug ?? "heartbeat";
  const now = new Date().toISOString();
  const header: Ritual = {
    id: ulid(),
    kind: "ritual",
    slug,
    title: "Heartbeat",
    created: now,
    updated: now,
    tags: [],
    cadence: "1d",
    anchor: "due",
    policy: opts.policy ?? HEARTBEAT_POLICY,
  };
  if (opts.importedFrom !== undefined) header.imported_from = opts.importedFrom;
  openProject(project, { create: true }).writeItem(
    { header, body: "Run `darius --version` and `date`, then complete the run.\n" },
    { who: "test" },
  );
  return slug;
}

interface CliRun {
  code: number;
  stdout: string;
  stderr: string;
}

async function runCli(command: Command, argv: string[], stdin?: string): Promise<CliRun> {
  const args = parseArgs(argv);
  if (stdin !== undefined) args.stdin = stdin;
  const out: string[] = [];
  const err: string[] = [];
  const { log, error } = console;
  console.log = (...parts: string[]) => out.push(parts.join(" "));
  console.error = (...parts: string[]) => err.push(parts.join(" "));
  try {
    const code = await command.run(args);
    return { code, stdout: out.join("\n"), stderr: err.join("\n") };
  } finally {
    console.log = log;
    console.error = error;
  }
}

async function runDueJson(project: string, extra: string[] = []): Promise<{ code: number; report: RunDueJson }> {
  const result = await runCli(runDueCommand, ["--unattended", "--json", "--project", project, ...extra]);
  return { code: result.code, report: JSON.parse(result.stdout) };
}

interface RunDueJson {
  ok: boolean;
  harnessChecks?: { harness: string; version: string; outcome: string; costUsd?: number; detail?: string; run?: string }[];
  projects: { project: string; rituals: { slug: string; action: string; reason?: string; detail?: string; run?: string; end?: string; questions?: string[]; sessionId?: string; timedOut?: boolean; durationMs?: number; warnings?: string[] }[] }[];
}

function ritualsOf(report: RunDueJson): RunDueJson["projects"][number]["rituals"] {
  return report.projects[0]?.rituals ?? [];
}

function linesOf(project: string, type: string): LedgerLine[] {
  return readLedger(openProject(project)).filter((line) => line.type === type);
}

function fakeArgv(run: string): string[] {
  return readFileSync(join(FAKE_LOG, run, "argv"), "utf8").split("\0").slice(0, -1);
}

function fakeEnv(run: string): Map<string, string> {
  const lines = readFileSync(join(FAKE_LOG, run, "env"), "utf8").trim().split("\n");
  return new Map(lines.map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]));
}

/** The values after `flag` up to the next `--` flag. */
function flagValues(argv: string[], flag: string): string[] {
  const start = argv.indexOf(flag);
  if (start === -1) return [];
  const rest = argv.slice(start + 1);
  const end = rest.findIndex((token) => token.startsWith("--"));
  return end === -1 ? rest : rest.slice(0, end);
}

// --- run-due ------------------------------------------------------------------------

test("run-due starts one run with the policy's model, turns and tools; the run completes; a second run-due starts nothing", async () => {
  const project = "rd-happy";
  seedRitual(project);
  process.env.FAKE_CLAUDE_MODE = "complete";

  const first = await runDueJson(project);
  assert.equal(first.code, 0, JSON.stringify(first.report));
  const entries = ritualsOf(first.report);
  assert.equal(entries.length, 1);
  const entry = entries[0];
  assert.equal(entry?.action, "started");
  assert.equal(entry?.end, "complete");
  assert.equal(entry?.sessionId, "fake-session");
  const run = entry?.run ?? "";

  assert.equal(linesOf(project, "run.started").length, 1);
  const completed = linesOf(project, "run.completed");
  assert.equal(completed.length, 1);
  assert.equal(completed[0]?.run, run);
  assert.equal(completed[0]?.outcome, "complete");
  assert.equal(linesOf(project, "run.started")[0]?.who, "timer");

  const argv = fakeArgv(run);
  assert.equal(argv[0], "-p");
  assert.deepEqual(flagValues(argv, "--model"), ["haiku"]);
  assert.deepEqual(flagValues(argv, "--max-turns"), ["6"]);
  assert.deepEqual(flagValues(argv, "--output-format"), ["json"]);
  // No profile: permissions skipped (0.20.0), so the darius gate alone decides.
  assert.ok(argv.includes("--dangerously-skip-permissions"));
  assert.equal(argv.includes("--permission-prompts"), false);
  assert.equal(argv.includes("--allowedTools"), false);
  assert.deepEqual(flagValues(argv, "--disallowedTools"), ["NotebookEdit", "WebFetch", "WebSearch", "Agent"]);

  const env = fakeEnv(run);
  const root = openProject(project).root;
  const runDir = join(root, "runs", run);
  assert.equal(env.get("DARIUS_RUN"), run);
  assert.equal(env.get("DARIUS_PROJECT"), project);
  assert.equal(env.get("DARIUS_RUN_POLICY"), join(runDir, "policy.json"));
  assert.equal(env.get("PWD"), root);
  assert.ok(env.get("PATH")?.split(":").some((part) => part.endsWith("/.local/bin")));

  const settings = JSON.parse(readFileSync(join(runDir, "settings.json"), "utf8"));
  const hook = settings.hooks.PreToolUse[0];
  assert.equal(hook.matcher, "*", "permissions skipped: the hook sees every tool");
  assert.equal(hook.hooks[0].command, join(REPO, "bin", "darius"));
  assert.deepEqual(hook.hooks[0].args, ["policy-check", "--policy", join(runDir, "policy.json")]);
  assert.deepEqual(flagValues(argv, "--settings"), [join(runDir, "settings.json")]);
  const prompt = readFileSync(join(runDir, "prompt.md"), "utf8");
  assert.match(prompt, new RegExp(`darius run complete ${run} --project ${project} --outcome complete --findings-stdin`));
  assert.match(prompt, new RegExp(`darius run hold ${run} --project ${project} --question`));
  assert.ok(prompt.indexOf("## Style") > 0 && prompt.indexOf("## Style") < prompt.indexOf("## Result"), "the style section comes before Result");
  assert.match(prompt, /At most 4000 characters\./u);

  const second = await runDueJson(project);
  assert.equal(second.code, 0);
  assert.deepEqual(ritualsOf(second.report), []);
  assert.equal(linesOf(project, "run.started").length, 1);
});

test("a claude that exits without completing leaves run.completed failed with the result blob; run-due does not relaunch it today", async () => {
  const project = "rd-silent";
  seedRitual(project);
  process.env.FAKE_CLAUDE_MODE = "silent";

  const first = await runDueJson(project);
  assert.equal(first.code, 1);
  const entry = ritualsOf(first.report)[0];
  assert.equal(entry?.end, "failed");
  const completed = linesOf(project, "run.completed");
  assert.equal(completed.length, 1);
  assert.equal(completed[0]?.outcome, "failed");
  assert.equal(completed[0]?.who, "timer");
  assert.equal(completed[0]?.session_id, "fake-session");
  const sha = String(completed[0]?.findings_sha);
  assert.match(sha, /^[0-9a-f]{64}$/);
  const blob = JSON.parse(getBlobText(openProject(project), sha) ?? "{}");
  assert.equal(blob.reason, "claude exited without completing or holding the run");
  assert.equal(blob.result.session_id, "fake-session");

  process.env.FAKE_CLAUDE_MODE = "complete";
  const again = await runDueJson(project);
  assert.equal(again.code, 0);
  const skipped = ritualsOf(again.report)[0];
  assert.equal(skipped?.action, "skipped");
  assert.equal(skipped?.reason, "failed-today");
  assert.equal(linesOf(project, "run.started").length, 1);
});

test("a run that the model holds stays held and is reported with its question", async () => {
  const project = "rd-hold";
  seedRitual(project);
  process.env.FAKE_CLAUDE_MODE = "hold";
  const result = await runDueJson(project);
  assert.equal(result.code, 0);
  const entry = ritualsOf(result.report)[0];
  assert.equal(entry?.end, "held");
  assert.deepEqual(entry?.questions, ["may I push?"]);
  assert.equal(linesOf(project, "run.completed").length, 0);

  const next = await runDueJson(project);
  assert.equal(ritualsOf(next.report)[0]?.reason, "held");
  assert.equal(linesOf(project, "run.started").length, 1);
});

test("the run timeout kills the claude process group and fails the run", async () => {
  const project = "rd-timeout";
  seedRitual(project);
  process.env.FAKE_CLAUDE_MODE = "sleep";
  const started = Date.now();
  const result = await runDueJson(project, ["--timeout", "1"]);
  assert.ok(Date.now() - started < 10_000);
  const entry = ritualsOf(result.report)[0];
  assert.equal(entry?.end, "failed");
  assert.equal(entry?.timedOut, true);
  const pgrep = (() => {
    try {
      return execFileSync("pgrep", ["-f", "sleep 31.7"], { encoding: "utf8" });
    } catch {
      return "";
    }
  })();
  assert.equal(pgrep.trim(), "", "the fake's sleep must not outlive the timeout");
});

test("policy mode off is never started; --dry-run starts and writes nothing", async () => {
  const project = "rd-off";
  seedRitual(project, { slug: "manual-one", policy: { mode: "off", may: [], hold: [] } });
  seedRitual(project, { slug: "heartbeat" });
  const before = readLedger(openProject(project)).length;

  const dry = await runCli(runDueCommand, ["--dry-run", "--json", "--project", project]);
  assert.equal(dry.code, 0);
  const rituals = ritualsOf(JSON.parse(dry.stdout));
  assert.deepEqual(
    rituals.map((ritual) => [ritual.slug, ritual.action, ritual.reason ?? ""]),
    [
      ["heartbeat", "would-start", ""],
      ["manual-one", "skipped", "policy-off"],
    ],
  );
  assert.equal(readLedger(openProject(project)).length, before);
});

test("run-due without --unattended or --dry-run is a usage error", async () => {
  await assert.rejects(runCli(runDueCommand, ["--project", "rd-off"]), /--unattended/);
});

test("a fresh local ritual lease blocks the run and exits 3; an expired one is taken over", async () => {
  const project = "rd-lease";
  seedRitual(project);
  process.env.FAKE_CLAUDE_MODE = "complete";
  const leaseDir = join(openProject(project).root, "leases");
  mkdirSync(leaseDir, { recursive: true });
  const leaseFile = join(leaseDir, "ritual-heartbeat.lock");
  const fresh = { holder: "otherhost:1", host: "otherhost", pid: 1, run: "X", expires: new Date(Date.now() + 60_000).toISOString() };
  writeFileSync(leaseFile, JSON.stringify(fresh));

  const blocked = await runDueJson(project);
  assert.equal(blocked.code, 3);
  assert.equal(ritualsOf(blocked.report)[0]?.reason, "lease-held");
  assert.equal(linesOf(project, "run.started").length, 0);

  writeFileSync(leaseFile, JSON.stringify({ ...fresh, expires: new Date(Date.now() - 1000).toISOString() }));
  const taken = await runDueJson(project);
  assert.equal(taken.code, 0);
  assert.equal(ritualsOf(taken.report)[0]?.end, "complete");
  assert.equal(existsSync(leaseFile), false, "the lease is released after the run");
});

// --- remote lease ---------------------------------------------------------------------

function throwOffline(): never {
  throw new S3NetworkError("connection refused", {});
}

interface MemoryS3 extends S3 {
  objects: Map<string, string>;
}

function memoryS3(opts: { isOffline?: boolean } = {}): MemoryS3 {
  const objects = new Map<string, string>();
  const decoder = new TextDecoder();
  return {
    objects,
    async put(key, body, o) {
      if (opts.isOffline === true) throwOffline();
      if (o?.ifNoneMatch === true && objects.has(key)) return { conflict: true };
      objects.set(key, body instanceof Uint8Array ? decoder.decode(body) : body);
      return { etag: "e" };
    },
    async get(key) {
      const text = objects.get(key);
      return text === undefined ? null : { body: new TextEncoder().encode(text), etag: "e" };
    },
    async head(key) {
      return objects.has(key) ? { etag: "e", size: 1 } : null;
    },
    async del(key) {
      objects.delete(key);
    },
    async list(): Promise<ListedObject[]> {
      return [];
    },
    async ensureBucket() {
      return "exists";
    },
  };
}

test("the S3 ritual lease is exclusive, released by its holder, taken over once expired, and offline is reported", async () => {
  const project = openProject("rd-remote", { create: true });
  const s3 = memoryS3();
  const request = { project, slug: "heartbeat", run: "R1", s3, ttlMs: 60_000 };
  const key = "rd-remote/leases/ritual-heartbeat.json";

  const first = await takeRitualLease(request, "hostA");
  assert.ok("handle" in first);
  assert.ok(s3.objects.has(key));
  const second = await takeRitualLease({ ...request, run: "R2" }, "hostB");
  assert.ok("blocked" in second && second.blocked === "lease-held");
  if ("handle" in first) await first.handle.release();
  assert.equal(s3.objects.has(key), false);

  s3.objects.set(key, JSON.stringify({ holder: "hostB:9", host: "hostB", pid: 9, run: "R0", expires: "2000-01-01T00:00:00.000Z" }));
  const takeover = await takeRitualLease(request, "hostA");
  assert.ok("handle" in takeover);
  assert.match(s3.objects.get(key) ?? "", /hostA/);

  const offline = await takeRitualLease({ ...request, s3: memoryS3({ isOffline: true }) }, "hostA");
  assert.ok("blocked" in offline && offline.blocked === "lease-offline");
});

// --- policy-check ------------------------------------------------------------------------

interface RunningRun {
  policyFile: string;
  run: string;
}

/** A ritual with a running run (the run.started line run-due writes) and its policy.json. */
function seedRunningRun(project: string, mode: Policy["mode"]): RunningRun {
  seedRitual(project, { policy: { ...HEARTBEAT_POLICY, mode } });
  const run = ulid();
  appendLine(openProject(project), { who: "timer", type: "run.started", item: "ritual/heartbeat", run });
  const policyFile = join(SANDBOX, `${project}-policy.json`);
  writeFileSync(
    policyFile,
    JSON.stringify({ v: 1, project, ritual: "heartbeat", run, mode, may: HEARTBEAT_POLICY.may, hold: HEARTBEAT_POLICY.hold }),
  );
  return { policyFile, run };
}

function bashHook(command: string, cwd?: string): string {
  const payload = { session_id: "sess-1", hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command } };
  return JSON.stringify(cwd === undefined ? payload : { ...payload, cwd });
}

/**
 * A running follow-up run as darius starts one: its policy.json carries the
 * grants and the run's dir, and run.started records the file's sha256.
 */
function seedGrantedRun(project: string, mode: Policy["mode"], extra: { grants: string[] }): RunningRun & { cwd: string } {
  seedRitual(project, { policy: { ...HEARTBEAT_POLICY, mode } });
  const run = ulid();
  const cwd = join(SANDBOX, `${project}-checkout`);
  mkdirSync(cwd, { recursive: true });
  const policyFile = join(SANDBOX, `${project}-policy.json`);
  const text = JSON.stringify({ v: 1, project, ritual: "heartbeat", run, mode, may: HEARTBEAT_POLICY.may, hold: HEARTBEAT_POLICY.hold, follow_up_of: "01PARENT", cwd, ...extra });
  writeFileSync(policyFile, text);
  appendLine(openProject(project), { who: "timer", type: "run.started", item: "ritual/heartbeat", run, follow_up_of: "01PARENT", policy_sha: sha256Hex(text) });
  return { policyFile, run, cwd };
}

test("policy-check denies a hold-listed git push, appends run.held once, then denies everything", async () => {
  const project = "pc-hold";
  const { policyFile, run } = seedRunningRun(project, "act");

  const push = await runCli(policyCheckCommand, ["--policy", policyFile], bashHook("git push origin main"));
  assert.equal(push.code, 2);
  const decision = JSON.parse(push.stdout);
  assert.equal(decision.hookSpecificOutput.hookEventName, "PreToolUse");
  assert.equal(decision.hookSpecificOutput.permissionDecision, "deny");
  assert.match(decision.hookSpecificOutput.permissionDecisionReason, /git push/);
  const held = linesOf(project, "run.held");
  assert.equal(held.length, 1);
  assert.equal(held[0]?.run, run);
  assert.equal(held[0]?.who, "claude:sess-1");
  assert.match(JSON.stringify(held[0]?.questions), /hold pattern \/git push\//);

  const after = await runCli(policyCheckCommand, ["--policy", policyFile], bashHook("date"));
  assert.equal(after.code, 2, "after a hold every Bash command is denied");
  assert.match(after.stdout, /is held/);
  assert.equal(linesOf(project, "run.held").length, 1, "run.held is appended once per run");
});

test("policy-check allows plain commands, other tools and the protocol; report mode denies write verbs", async () => {
  const project = "pc-report";
  const { policyFile, run } = seedRunningRun(project, "report");

  const date = await runCli(policyCheckCommand, ["--policy", policyFile], bashHook("date"));
  assert.deepEqual([date.code, date.stdout], [0, ""]);
  const read = await runCli(
    policyCheckCommand,
    ["--policy", policyFile],
    JSON.stringify({ tool_name: "Read", tool_input: { file_path: "/etc/hostname" } }),
  );
  assert.deepEqual([read.code, read.stdout], [0, ""]);
  const complete = `darius run complete ${run} --project ${project} --outcome complete --findings-stdin <<'FINDINGS'\nwe should deploy and git push; rm -rf nothing\nFINDINGS`;
  const protocol = await runCli(policyCheckCommand, ["--policy", policyFile], bashHook(complete));
  assert.deepEqual([protocol.code, protocol.stdout], [0, ""]);

  const rm = await runCli(policyCheckCommand, ["--policy", policyFile], bashHook("cd /tmp && rm stale.txt"));
  assert.equal(rm.code, 2);
  assert.match(rm.stdout, /report mode denies write verbs/);
  assert.equal(linesOf(project, "run.held").length, 1);
});

test("policy-check passes a granted line as written and fails closed on a grant that is not one plain command", async () => {
  const project = "pc-grant";
  const { policyFile, run, cwd } = seedGrantedRun(project, "report", { grants: ["git push origin main"] });
  const granted = await runCli(policyCheckCommand, ["--policy", policyFile], bashHook("git  push origin main", cwd));
  assert.deepEqual([granted.code, granted.stdout], [0, ""]);
  const chained = await runCli(policyCheckCommand, ["--policy", policyFile], bashHook("git push origin main && date", cwd));
  assert.equal(chained.code, 2, "a chain holding the grant is held as before");
  assert.equal(linesOf(project, "run.held")[0]?.run, run);
  const other = "pc-grant-bad";
  const bad = seedRunningRun(other, "act");
  writeFileSync(bad.policyFile, JSON.stringify({ ...JSON.parse(readFileSync(bad.policyFile, "utf8")), grants: ["date && git push"] }));
  const refused = await runCli(policyCheckCommand, ["--policy", bad.policyFile], bashHook("date"));
  assert.equal(refused.code, 2);
  assert.match(refused.stdout, /grant \\"date && git push\\" is not one plain command/u);
});

test("policy-check: a granted line in another dir meets the hold list as before (0.47.1)", async () => {
  const project = "pc-grant-cwd";
  const { policyFile, run, cwd } = seedGrantedRun(project, "act", { grants: ["git push origin main"] });
  const other = join(SANDBOX, "pc-grant-cwd-other");
  mkdirSync(other, { recursive: true });
  const linked = join(SANDBOX, "pc-grant-cwd-link");
  symlinkSync(cwd, linked);
  const viaLink = await runCli(policyCheckCommand, ["--policy", policyFile], bashHook("git push origin main", linked));
  assert.deepEqual([viaLink.code, viaLink.stdout], [0, ""], "a symlink to the run's dir is the run's dir");
  const elsewhere = await runCli(policyCheckCommand, ["--policy", policyFile], bashHook("git push origin main", other));
  assert.equal(elsewhere.code, 2);
  assert.match(elsewhere.stdout, /the command matches the hold pattern \/git push\//u);
  assert.equal(linesOf(project, "run.held")[0]?.run, run, "held, as without the grant");
});

test("policy-check: a policy.json with grants edited after the start denies every call (0.47.1)", async () => {
  const project = "pc-grant-sha";
  const { policyFile, cwd } = seedGrantedRun(project, "act", { grants: ["git push origin main"] });
  const before = await runCli(policyCheckCommand, ["--policy", policyFile], bashHook("date", cwd));
  assert.deepEqual([before.code, before.stdout], [0, ""]);
  const edited = { ...JSON.parse(readFileSync(policyFile, "utf8")), grants: ["git push origin main", "git push --force origin main"] };
  writeFileSync(policyFile, JSON.stringify(edited));
  for (const command of ["date", "git push origin main", "git push --force origin main"]) {
    const after = await runCli(policyCheckCommand, ["--policy", policyFile], bashHook(command, cwd));
    assert.equal(after.code, 2, command);
    assert.match(after.stdout, /policy\.json changed since the run started/u, command);
  }
  const unsigned = "pc-grant-unsigned";
  const plain = seedRunningRun(unsigned, "act");
  writeFileSync(plain.policyFile, JSON.stringify({ ...JSON.parse(readFileSync(plain.policyFile, "utf8")), grants: ["date"], cwd }));
  const added = await runCli(policyCheckCommand, ["--policy", plain.policyFile], bashHook("date", cwd));
  assert.match(added.stdout, /policy\.json changed since the run started/u, "grants added to a run started without a sha");
  assert.equal(linesOf(unsigned, "run.held").length, 0);
});

test("policy-check: no run starts a follow-up, even with may Bash(darius *) (0.47.1)", async () => {
  assert.ok(HEARTBEAT_POLICY.may.includes("Bash(darius *)"));
  for (const gate of [undefined, "full"]) {
    const project = `pc-no-follow-up-${gate ?? "shell"}`;
    const { policyFile } = seedRunningRun(project, "act");
    if (gate !== undefined) writeFileSync(policyFile, JSON.stringify({ ...JSON.parse(readFileSync(policyFile, "utf8")), gate }));
    for (const command of ["darius run follow-up 01PARENT --approve 1", "env -u DARIUS_RUN darius run follow-up 01PARENT", "FOO=1 nohup darius run follow-up 01PARENT"]) {
      const result = await runCli(policyCheckCommand, ["--policy", policyFile], bashHook(command));
      assert.equal(result.code, 2, command);
      assert.match(result.stdout, /a run never starts a follow-up; a person does, outside the run/u, command);
    }
    const list = await runCli(policyCheckCommand, ["--policy", policyFile], bashHook("darius run list"));
    assert.deepEqual([list.code, list.stdout], [0, ""], "other darius verbs pass as before");
    assert.equal(linesOf(project, "run.held").length, 0, "a deny, not a hold");
  }
});

test("policy-check fails closed without a policy", async () => {
  const saved = process.env.DARIUS_RUN_POLICY;
  delete process.env.DARIUS_RUN_POLICY;
  try {
    const result = await runCli(policyCheckCommand, [], bashHook("date"));
    assert.equal(result.code, 2);
    assert.equal(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision, "deny");
  } finally {
    if (saved !== undefined) process.env.DARIUS_RUN_POLICY = saved;
  }
});

test("isProtocolCommand accepts only this run's plain hold/complete forms", () => {
  const run = "01RUN";
  assert.equal(isProtocolCommand(`darius run hold ${run} --project p --question "may I push?"`, run), true);
  assert.equal(isProtocolCommand(`darius run hold OTHER --project p --question "x"`, run), false);
  assert.equal(isProtocolCommand(`darius run hold ${run} --question "x"; git push`, run), false);
  assert.equal(isProtocolCommand(`darius run hold ${run} --question "$(git push)"`, run), false);
  assert.equal(isProtocolCommand(`darius run complete ${run} --findings-stdin <<EOF\n$(git push)\nEOF`, run), false);
  assert.equal(isProtocolCommand(`darius run complete ${run} --findings-stdin <<'EOF'\nok\nEOF\ngit push`, run), false);
  assert.equal(isProtocolCommand(`darius run complete ${run} --findings-stdin <<'EOF'\nok\nEOF`, run), true);
  assert.ok(REPORT_MODE_WRITE_VERBS.length <= 8);
});

test("policy-check reads real stdin in a child process and prints the deny decision", async () => {
  const project = "pc-child";
  const { policyFile } = seedRunningRun(project, "report");
  const script = join(SANDBOX, "policy-child.mjs");
  writeFileSync(
    script,
    [
      `import { parseArgs } from ${JSON.stringify(pathToFileURL(join(REPO, "src/cli/args.ts")).href)};`,
      `import { policyCheckCommand } from ${JSON.stringify(pathToFileURL(join(REPO, "src/cli/policy-check.ts")).href)};`,
      "process.exit(await policyCheckCommand.run(parseArgs(process.argv.slice(2))));",
    ].join("\n"),
  );
  const result = await new Promise<{ code: number | null; stdout: string }>((resolve, reject) => {
    const child = spawn(process.execPath, ["--no-warnings", script, "--policy", policyFile], {
      env: process.env,
      stdio: ["pipe", "pipe", "ignore"],
    });
    const out: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => out.push(chunk));
    child.on("error", reject);
    child.on("exit", (code) => resolve({ code, stdout: Buffer.concat(out).toString("utf8") }));
    child.stdin.end(bashHook("git push"));
  });
  assert.equal(result.code, 2);
  assert.equal(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision, "deny");
  assert.equal(linesOf(project, "run.held").length, 1);
});

// --- working dir on another host ---------------------------------------------------

test("an imported ritual whose working dir is not on this host is skipped before a run starts", async () => {
  const project = "rd-elsewhere";
  const slug = seedRitual(project, { slug: "elsewhere", importedFrom: ".tracker/rituals/elsewhere/ritual.md" });
  appendLine(openProject(project), { who: "test", type: "import", source: "/nonexistent-darius-host/repo/.tracker" });

  const { report } = await runDueJson(project);
  const entry = ritualsOf(report).find((ritual) => ritual.slug === slug);
  assert.equal(entry?.action, "skipped", JSON.stringify(report));
  assert.equal(entry?.reason, "no-workdir");
  // No run.started: an open run here would block this ritual on every host.
  assert.equal(linesOf(project, "run.started").length, 0);
});

/** A linked checkout of `project` whose `.darius.toml` carries `marker`. */
function linkedCheckout(project: string, marker: string): string {
  const dir = join(SANDBOX, `${project}-checkout`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, ".darius.toml"), `project = "${project}"\n${marker}`);
  writeLink(project, dir);
  return dir;
}

test("a ritual of a linked project runs claude in the checkout", async () => {
  const project = "rd-linked";
  const dir = linkedCheckout(project, "");
  seedRitual(project);
  process.env.FAKE_CLAUDE_MODE = "complete";
  const { code, report } = await runDueJson(project);
  assert.equal(code, 0, JSON.stringify(report));
  const run = ritualsOf(report)[0]?.run ?? "";
  assert.equal(fakeEnv(run).get("PWD"), dir);
});

test("a mode above the checkout's max_mode is skipped as policy-capped, before a run starts, and reported", async () => {
  const project = "rd-capped";
  linkedCheckout(project, 'max_mode = "report"\n');
  seedRitual(project, { policy: { ...HEARTBEAT_POLICY, mode: "act" } });
  const { code, report } = await runDueJson(project);
  assert.equal(code, 0);
  const entry = ritualsOf(report)[0];
  assert.equal(entry?.reason, "policy-capped", JSON.stringify(report));
  assert.match(entry?.detail ?? "", /mode act is above max_mode = "report"/u);
  assert.equal(linesOf(project, "run.started").length, 0);
  const text = formatReport({ ok: true, date: "d", host: "h", dryRun: false, projects: [{ project, syncBefore: "", syncAfter: "", rituals: [{ slug: "heartbeat", action: "skipped", reason: "policy-capped", detail: entry?.detail ?? "" }] }], errors: [] } satisfies BatchReport);
  assert.match(text.join("\n"), /heartbeat: skipped, policy-capped/u);

  const dry = await runDueJson(project, ["--dry-run"]);
  assert.equal(ritualsOf(dry.report)[0]?.reason, "policy-capped");
});

// --- gate preflight ------------------------------------------------------------------

test("policy-check --preflight decides as usual but always denies and writes nothing", async () => {
  const project = "pc-preflight";
  const { policyFile } = seedRunningRun(project, "act");
  const result = await runCli(policyCheckCommand, ["--policy", policyFile, "--preflight"], bashHook("git push"));
  assert.equal(result.code, 2);
  assert.match(JSON.parse(result.stdout).hookSpecificOutput.permissionDecisionReason, /darius policy: preflight\./u);
  assert.equal(linesOf(project, "run.held").length, 0, "a preflight never holds the run");

  const broken = await runCli(policyCheckCommand, ["--policy", join(SANDBOX, "missing.json"), "--preflight"], bashHook("date"));
  assert.deepEqual([broken.code, broken.stdout], [1, ""], "a preflight reports the error instead of denying");
  assert.match(broken.stderr, /missing\.json does not exist/u);

  const badRegex = join(SANDBOX, `${project}-bad-regex.json`);
  writeFileSync(badRegex, JSON.stringify({ ...JSON.parse(readFileSync(policyFile, "utf8")), hold: ["(unclosed"] }));
  const regex = await runCli(policyCheckCommand, ["--policy", badRegex, "--preflight"], bashHook("date"));
  assert.equal(regex.code, 1, "a hold regex that does not compile fails the preflight");
  const live = await runCli(policyCheckCommand, ["--policy", badRegex], bashHook("date"));
  assert.equal(live.code, 2, "outside a preflight the same error denies");
});

test("policy-check fails closed on an unknown harness and reads a gate scope from policy.json", async () => {
  const project = "pc-scope";
  const { policyFile, run } = seedRunningRun(project, "act");
  const unknown = await runCli(policyCheckCommand, ["--policy", policyFile, "--harness", "nope"], bashHook("date"));
  assert.equal(unknown.code, 2);
  assert.match(unknown.stdout, /unknown harness \\"nope\\"/u);

  const full = join(SANDBOX, `${project}-full.json`);
  writeFileSync(full, JSON.stringify({ ...JSON.parse(readFileSync(policyFile, "utf8")), gate: "full" }));
  const write = await runCli(policyCheckCommand, ["--policy", full], JSON.stringify({ tool_name: "Write", tool_input: {} }));
  assert.equal(write.code, 2);
  assert.match(write.stdout, /write files only under \/tmp \(Write without a path\).*Do not retry it/u);
  assert.equal(linesOf(project, "run.held").length, 0, "a deny outside the policy does not hold the run");
  const push = await runCli(policyCheckCommand, ["--policy", full], bashHook("git push"));
  assert.equal(push.code, 2);
  assert.equal(linesOf(project, "run.held")[0]?.run, run, "a hold pattern still holds it");

  const bad = join(SANDBOX, `${project}-bad.json`);
  writeFileSync(bad, JSON.stringify({ ...JSON.parse(readFileSync(policyFile, "utf8")), gate: "everything" }));
  const refused = await runCli(policyCheckCommand, ["--policy", bad], bashHook("date"));
  assert.equal(refused.code, 2);
  assert.match(refused.stdout, /gate must be/u);
});

test("a gate that cannot start skips the ritual as gate-broken before any run exists", async () => {
  const project = "rd-gate-broken";
  seedRitual(project);
  process.env.FAKE_CLAUDE_MODE = "complete";
  // bin/darius execs $DARIUS_BUN when it is set: a missing one is a hook that
  // cannot start (exit 127), which Claude Code would let through.
  process.env.DARIUS_BUN = join(SANDBOX, "no-such-bun");
  try {
    const { code, report } = await runDueJson(project);
    assert.equal(code, 1, "a broken gate fails the batch");
    assert.equal(report.ok, false);
    const entry = ritualsOf(report)[0];
    assert.equal(entry?.action, "skipped", JSON.stringify(report));
    assert.equal(entry?.reason, "gate-broken");
    assert.match(entry?.detail ?? "", /the gate exited 127/u);
    assert.equal(linesOf(project, "run.started").length, 0);
    assert.deepEqual(readdirSync(join(openProject(project).root, "runs")), [], "the run dir is removed");
  } finally {
    delete process.env.DARIUS_BUN;
  }

  const again = await runDueJson(project);
  assert.equal(ritualsOf(again.report)[0]?.end, "complete", "a working gate runs the ritual again");
});

test("preflightGate refuses a gate that allows the synthetic call or does not start", () => {
  const env = { PATH: process.env.PATH ?? "" };
  assert.match(preflightGate([join(SANDBOX, "missing-gate")], claudeHarness, env) ?? "", /the gate did not run/u);
  assert.match(preflightGate([BASH, "-c", "exit 0"], claudeHarness, env) ?? "", /allowed the preflight call/u);
  assert.match(preflightGate([BASH, "-c", "exit 1"], claudeHarness, env) ?? "", /the gate exited 1/u);
  assert.equal(preflightGate([BASH, "-c", 'cat >/dev/null; echo "{\\"deny\\":1}"; exit 2'], claudeHarness, env), undefined);
});

// --- profiles ------------------------------------------------------------------------

interface ProfiledEntry {
  slug: string;
  action: string;
  reason?: string;
  detail?: string;
  run?: string;
  end?: string;
  profile?: string;
  harness?: string;
  surface?: string;
  warnings?: string[];
}

async function addProfile(name: string, flags: string[]): Promise<void> {
  const result = await runCli(profileCommand, ["add", name, ...flags]);
  assert.equal(result.code, 0, result.stderr);
}

test("a store profile with skipped permissions: the flag, the every-tool gate and gate scope full reach the run", async () => {
  await addProfile("rd-skip", ["--model", "opus", "--effort", "medium", "--permissions", "skip"]);
  const project = "rd-profile-skip";
  seedRitual(project, { policy: { ...HEARTBEAT_POLICY, profile: "rd-skip" } });
  process.env.FAKE_CLAUDE_MODE = "complete";
  const { code, report } = await runDueJson(project);
  assert.equal(code, 0, JSON.stringify(report));
  const entry: ProfiledEntry | undefined = ritualsOf(report)[0];
  assert.equal(entry?.end, "complete");
  assert.equal(entry?.profile, "rd-skip");
  assert.equal(entry?.harness, "claude");
  assert.equal(entry?.surface, "headless");
  const run = entry?.run ?? "";
  const argv = fakeArgv(run);
  assert.equal(argv.includes("--dangerously-skip-permissions"), true);
  assert.deepEqual(flagValues(argv, "--effort"), ["medium"]);
  assert.deepEqual(flagValues(argv, "--model"), ["haiku"], "the ritual's own model overrides the profile's");
  const runDir = join(openProject(project).root, "runs", run);
  assert.equal(JSON.parse(readFileSync(join(runDir, "policy.json"), "utf8")).gate, "full");
  assert.equal(JSON.parse(readFileSync(join(runDir, "settings.json"), "utf8")).hooks.PreToolUse[0].matcher, "*");
});

test("a ritual naming a profile nobody defines is skipped as profile-invalid and fails the batch", async () => {
  const project = "rd-profile-ghost";
  seedRitual(project, { policy: { ...HEARTBEAT_POLICY, profile: "ghost" } });
  const { code, report } = await runDueJson(project);
  assert.equal(code, 1);
  const entry: ProfiledEntry | undefined = ritualsOf(report)[0];
  assert.equal(entry?.reason, "profile-invalid", JSON.stringify(report));
  assert.match(entry?.detail ?? "", /profile "ghost" is not defined/u);
  assert.equal(linesOf(project, "run.started").length, 0);
});

test("a profile that asks for the herdr surface runs headless and says so", async () => {
  await addProfile("rd-herdr", ["--surface", "herdr"]);
  const project = "rd-profile-herdr";
  seedRitual(project, { policy: { ...HEARTBEAT_POLICY, profile: "rd-herdr" } });
  process.env.FAKE_CLAUDE_MODE = "complete";
  const dry = await runDueJson(project, ["--dry-run"]);
  assert.equal(ritualsOf(dry.report)[0]?.action, "would-start");
  const { code, report } = await runDueJson(project);
  assert.equal(code, 0, JSON.stringify(report));
  const entry: ProfiledEntry | undefined = ritualsOf(report)[0];
  assert.equal(entry?.surface, "headless");
  assert.match(entry?.warnings?.[0] ?? "", /^surface-fallback: /u);
  const warned: RitualEntry = { slug: "heartbeat", action: "started", end: "complete", run: "r", warnings: entry?.warnings ?? [] };
  const text = formatReport({ ok: true, date: "d", host: "h", dryRun: false, projects: [{ project, syncBefore: "", syncAfter: "", rituals: [warned] }], errors: [] } satisfies BatchReport);
  assert.match(text.join("\n"), /warning: surface-fallback/u);
});

test("profile add refuses a reserved arg and a bad effort; set replaces and clears fields", async () => {
  await assert.rejects(runCli(profileCommand, ["add", "rd-bad", "--arg=--settings=/tmp/x.json"]), /args may not contain --settings=/u);
  await assert.rejects(runCli(profileCommand, ["add", "rd-bad", "--arg"]), /--arg needs a value/u);
  await assert.rejects(runCli(profileCommand, ["add", "rd-bad", "--effort", "extreme"]), /claude takes effort/u);
  await addProfile("rd-edit", ["--model", "opus", "--arg=--verbose"]);
  const set = await runCli(profileCommand, ["set", "rd-edit", "--model", "", "--arg", "", "--effort", "high", "--json"]);
  assert.equal(set.code, 0, set.stderr);
  const updated = JSON.parse(set.stdout).updated;
  assert.equal(updated.model, undefined);
  assert.equal(updated.args, undefined);
  assert.equal(updated.effort, "high");
  const list = JSON.parse((await runCli(profileCommand, ["list", "--json"])).stdout);
  assert.ok(list.profiles.some((profile: { slug: string }) => profile.slug === "rd-edit"));
});

test("a repo's .darius.toml picks the default profile and overrides store fields", async () => {
  await addProfile("rd-repo", ["--model", "opus", "--effort", "low"]);
  const project = "rd-profile-repo";
  linkedCheckout(project, 'v = 2\nmax_mode = "report"\n[profiles.rd-repo]\neffort = "high"\nargs = ["--verbose"]\n[defaults]\nritual = "rd-repo"\n');
  seedRitual(project, { policy: { mode: "report", may: ["Bash(darius *)", "Bash(date)"], hold: ["git push"] } });
  process.env.FAKE_CLAUDE_MODE = "complete";
  const { code, report } = await runDueJson(project);
  assert.equal(code, 0, JSON.stringify(report));
  const entry: ProfiledEntry | undefined = ritualsOf(report)[0];
  assert.equal(entry?.profile, "rd-repo");
  const argv = fakeArgv(entry?.run ?? "");
  assert.deepEqual(flagValues(argv, "--model"), ["opus"], "from the store");
  assert.deepEqual(flagValues(argv, "--effort"), ["high"], "the repo overrides the store");
  assert.ok(argv.includes("--verbose"), "args from the repo");
});

// --- the herdr surface -----------------------------------------------------------------

function herdrCalls(): string[] {
  const file = join(FAKE_HERDR_DIR, "calls");
  return existsSync(file) ? readFileSync(file, "utf8").trim().split("\n") : [];
}

/** Runs `fn` with the fake herdr on, a fast poll, and a clean call log. */
async function withFakeHerdr<T>(opts: { status?: string; graceMs?: number; startBlocked?: boolean }, fn: () => Promise<T>): Promise<T> {
  writeFileSync(join(FAKE_HERDR_DIR, "calls"), "");
  rmSync(join(FAKE_HERDR_DIR, "shell-ready"), { force: true });
  if (opts.startBlocked === true) writeFileSync(join(FAKE_HERDR_DIR, "start-blocked"), "");
  else rmSync(join(FAKE_HERDR_DIR, "start-blocked"), { force: true });
  writeFileSync(join(FAKE_HERDR_DIR, "status"), opts.status ?? "working");
  process.env.DARIUS_HERDR = FAKE_HERDR;
  process.env.DARIUS_HERDR_POLL_MS = "50";
  process.env.DARIUS_HERDR_WAIT_GRACE_MS = String(opts.graceMs ?? 600_000);
  try {
    return await fn();
  } finally {
    process.env.DARIUS_HERDR = join(SANDBOX, "no-herdr");
    delete process.env.DARIUS_HERDR_POLL_MS;
    delete process.env.DARIUS_HERDR_WAIT_GRACE_MS;
  }
}

test("herdr surface: a tab in darius-runs, the harness started with its interactive argv, the run completes; the tab stays until the ritual has a newer run", async () => {
  await addProfile("rd-watch", ["--surface", "herdr"]);
  const project = "rd-herdr-watch";
  seedRitual(project, { policy: { ...HEARTBEAT_POLICY, profile: "rd-watch" } });
  process.env.FAKE_CLAUDE_MODE = "complete";
  const { code, report } = await withFakeHerdr({}, () => runDueJson(project));
  assert.equal(code, 0, JSON.stringify(report));
  const entry: ProfiledEntry | undefined = ritualsOf(report)[0];
  assert.equal(entry?.surface, "herdr");
  assert.equal(entry?.end, "complete");
  assert.equal(entry?.warnings, undefined);
  const run = entry?.run ?? "";
  const calls = herdrCalls();
  assert.ok(calls.includes("workspace create --label darius-runs --cwd " + openProject(project).root + " --no-focus"), calls.join("\n"));
  const tabCreate = calls.find((line) => line.startsWith("tab create")) ?? "";
  assert.match(tabCreate, new RegExp(`--env DARIUS_RUN=${run} `, "u"));
  assert.match(tabCreate, /--label heartbeat [0-9a-z]{6} /u);
  assert.equal(calls.filter((line) => line.startsWith("agent start")).length, 2, "a busy pane is retried until its shell is ready");
  const start = calls.find((line) => line.startsWith("agent start")) ?? "";
  assert.match(start, new RegExp(`^agent start ${agentName(run)} --kind claude --pane w9:p2 --timeout \\d+ -- `, "u"));
  assert.equal(start.includes(" -p "), false, "interactive: no print mode");
  assert.match(start, /--append-system-prompt-file /u);
  assert.match(calls.find((line) => line.startsWith("agent prompt")) ?? "", new RegExp(`Run ritual heartbeat now\\. Run id ${run}\\.`, "u"));
  assert.equal(calls.some((line) => line.startsWith("tab close")), false, "a finished run's tab stays open");
  assert.equal(JSON.parse(readFileSync(join(openProject(project).root, "runs", run, "herdr.json"), "utf8")).tab, "w9:t2");

  await withFakeHerdr({}, () => runDueJson(project));
  assert.equal(herdrCalls().includes("tab close w9:t2"), false, "no newer run of the ritual and under 48 hours: the tab stays");
  assert.equal(existsSync(join(openProject(project).root, "runs", run, "herdr.json")), true);

  const newer = ulid();
  appendLine(openProject(project), { who: "test", type: "run.started", item: "ritual/heartbeat", run: newer });
  appendLine(openProject(project), { who: "test", type: "run.completed", item: "ritual/heartbeat", run: newer, outcome: "complete", findings_sha: null });
  await withFakeHerdr({}, () => runDueJson(project));
  assert.ok(herdrCalls().includes("tab close w9:t2"), "a newer run of the ritual closes it");
  assert.equal(existsSync(join(openProject(project).root, "runs", run, "herdr.json")), false);
});

test("herdr surface: an agent that waits for input past the grace time holds the run with a question naming the tab", async () => {
  await addProfile("rd-watch-idle", ["--surface", "herdr"]);
  const project = "rd-herdr-idle";
  seedRitual(project, { policy: { ...HEARTBEAT_POLICY, profile: "rd-watch-idle" } });
  process.env.FAKE_CLAUDE_MODE = "silent";
  const { report } = await withFakeHerdr({ status: "blocked", graceMs: 100 }, () => runDueJson(project));
  const entry: ProfiledEntry | undefined = ritualsOf(report)[0];
  assert.equal(entry?.end, "held", JSON.stringify(report));
  const held = linesOf(project, "run.held");
  assert.equal(held.length, 1);
  assert.match(JSON.stringify(held[0]?.questions), /the agent waits for input in herdr tab \\"heartbeat [0-9a-z]{6}\\" \(blocked/u);
  assert.equal(held[0]?.who, `herdr:${entry?.run ?? ""}`);
});

test("herdr surface: a run past its timeout fails and its tab is closed; an agent that exits fails the run", async () => {
  await addProfile("rd-watch-slow", ["--surface", "herdr"]);
  const slow = "rd-herdr-slow";
  seedRitual(slow, { policy: { ...HEARTBEAT_POLICY, profile: "rd-watch-slow" } });
  process.env.FAKE_CLAUDE_MODE = "silent";
  const timedOut = await withFakeHerdr({}, () => runDueJson(slow, ["--timeout", "0.3"]));
  const entry: ProfiledEntry | undefined = ritualsOf(timedOut.report)[0];
  assert.equal(entry?.end, "failed", JSON.stringify(timedOut.report));
  assert.ok(herdrCalls().includes("tab close w9:t2"));
  const blob = JSON.parse(getBlobText(openProject(slow), String(linesOf(slow, "run.completed")[0]?.findings_sha)) ?? "{}");
  assert.match(blob.reason, /was stopped after the run timeout/u);

  const gone = "rd-herdr-gone";
  seedRitual(gone, { policy: { ...HEARTBEAT_POLICY, profile: "rd-watch-slow" } });
  const exited = await withFakeHerdr({ status: "gone" }, () => runDueJson(gone));
  assert.equal(ritualsOf(exited.report)[0]?.end, "failed");
  const goneBlob = JSON.parse(getBlobText(openProject(gone), String(linesOf(gone, "run.completed")[0]?.findings_sha)) ?? "{}");
  assert.match(goneBlob.stderr_tail, /the agent exited/u);
});

test("herdr surface: a harness blocked at a startup dialog gets its first message once someone answers", async () => {
  await addProfile("rd-watch-trust", ["--surface", "herdr"]);
  const project = "rd-herdr-trust";
  seedRitual(project, { policy: { ...HEARTBEAT_POLICY, profile: "rd-watch-trust" } });
  process.env.FAKE_CLAUDE_MODE = "complete";
  const answered = setTimeout(() => writeFileSync(join(FAKE_HERDR_DIR, "status"), "idle"), 400);
  const { code, report } = await withFakeHerdr({ status: "blocked", startBlocked: true }, () => runDueJson(project));
  clearTimeout(answered);
  assert.equal(code, 0, JSON.stringify(report));
  assert.equal(ritualsOf(report)[0]?.end, "complete");
  const calls = herdrCalls();
  const startAt = calls.findIndex((line) => line.startsWith("agent start"));
  const promptAt = calls.findIndex((line) => line.startsWith("agent prompt"));
  assert.ok(calls.slice(startAt, promptAt).some((line) => line.startsWith("agent get")), "it waited for the agent before the prompt");
});

test("herdr surface: a startup dialog nobody answers holds the run, and the tab stays open", async () => {
  const project = "rd-herdr-trust-held";
  seedRitual(project, { policy: { ...HEARTBEAT_POLICY, profile: "rd-watch-trust" } });
  process.env.FAKE_CLAUDE_MODE = "complete";
  const { report } = await withFakeHerdr({ status: "blocked", startBlocked: true, graceMs: 150 }, () => runDueJson(project));
  assert.equal(ritualsOf(report)[0]?.end, "held", JSON.stringify(report));
  assert.match(JSON.stringify(linesOf(project, "run.held")[0]?.questions), /waits at a startup dialog in herdr tab/u);
  assert.equal(herdrCalls().some((line) => line.startsWith("agent prompt")), false);
  assert.equal(herdrCalls().some((line) => line.startsWith("tab close")), false);
});

// --- skills and run now ----------------------------------------------------------------

test("a ritual that names a skill: the prompt names it, the gate is full, the hook sees every tool, Skill is allowed", async () => {
  const project = "rd-skill";
  seedRitual(project);
  const set = await runCli(ritualCommand, ["set", "heartbeat", "--project", project, "--skill", "daily-report"]);
  assert.equal(set.code, 0, set.stderr);
  process.env.FAKE_CLAUDE_MODE = "complete";
  const { code, report } = await runDueJson(project);
  assert.equal(code, 0, JSON.stringify(report));
  const run = ritualsOf(report)[0]?.run ?? "";
  const runDir = join(openProject(project).root, "runs", run);
  const prompt = readFileSync(join(runDir, "prompt.md"), "utf8");
  assert.match(prompt, /## Skill\n\nInvoke the skill `daily-report` of this repository/u);
  assert.match(prompt, /put that content into the findings/u);
  assert.equal(JSON.parse(readFileSync(join(runDir, "policy.json"), "utf8")).gate, "full");
  assert.equal(JSON.parse(readFileSync(join(runDir, "settings.json"), "utf8")).hooks.PreToolUse[0].matcher, "*");
  assert.equal(fakeArgv(run).includes("--allowedTools"), false, "permissions skipped: no Claude allowlist");
  const skill = await runCli(
    policyCheckCommand,
    ["--policy", join(runDir, "policy.json")],
    JSON.stringify({ tool_name: "Skill", tool_input: { skill: "daily-report" } }),
  );
  assert.deepEqual([skill.code, skill.stdout], [0, ""], "the gate allows the Skill tool");
  const cleared = await runCli(ritualCommand, ["set", "heartbeat", "--project", project, "--skill", "", "--json"]);
  assert.equal(JSON.parse(cleared.stdout).updated.skill, undefined);
});

test("run now starts a ritual that is not due and one that failed today; a held run, mode off and a missing ritual refuse", async () => {
  const project = "rd-now";
  seedRitual(project);
  process.env.FAKE_CLAUDE_MODE = "complete";
  const first = await runDueJson(project);
  assert.equal(ritualsOf(first.report)[0]?.end, "complete");
  assert.deepEqual(ritualsOf((await runDueJson(project)).report), [], "not due any more");

  const now = await runCli(runCommand, ["now", "heartbeat", "--project", project, "--json"]);
  assert.equal(now.code, 0, now.stdout);
  assert.equal(JSON.parse(now.stdout).projects[0].rituals[0].end, "complete");
  assert.equal(linesOf(project, "run.started").length, 2);
  assert.notEqual(linesOf(project, "run.started")[1]?.who, "timer", "a person started it");

  process.env.FAKE_CLAUDE_MODE = "silent";
  assert.equal((await runCli(runCommand, ["now", "heartbeat", "--project", project])).code, 1, "a failed run fails the command");
  process.env.FAKE_CLAUDE_MODE = "hold";
  const again = await runCli(runCommand, ["now", "heartbeat", "--project", project, "--json"]);
  assert.equal(JSON.parse(again.stdout).projects[0].rituals[0].end, "held", "failed today does not block run now");
  const blocked = await runCli(runCommand, ["now", "heartbeat", "--project", project, "--json"]);
  assert.equal(JSON.parse(blocked.stdout).projects[0].rituals[0].reason, "held");

  const off = "rd-now-off";
  seedRitual(off, { policy: { ...HEARTBEAT_POLICY, mode: "off" } });
  const refused = JSON.parse((await runCli(runCommand, ["now", "heartbeat", "--project", off, "--json"])).stdout).projects[0].rituals[0];
  assert.equal(refused.reason, "policy-off");
  assert.match(refused.detail, /needs mode report or act/u);
  const said = await runCli(runCommand, ["now", "heartbeat", "--project", off]);
  assert.match(said.stdout, /heartbeat: skipped, policy-off, an unattended run needs mode report or act/u, "a person hears why");
  assert.equal(said.stdout.includes("nothing due"), false);
  await assert.rejects(runCli(runCommand, ["now", "ghost", "--project", off]), /no ritual 'ghost'/u);
});

test("run now --profile overrides the ritual's profile for that run only", async () => {
  await addProfile("rd-now-effort", ["--effort", "max"]);
  const project = "rd-now-profile";
  seedRitual(project);
  process.env.FAKE_CLAUDE_MODE = "complete";
  const result = await runCli(runCommand, ["now", "heartbeat", "--project", project, "--profile", "rd-now-effort", "--json"]);
  const entry = JSON.parse(result.stdout).projects[0].rituals[0];
  assert.equal(entry.profile, "rd-now-effort");
  assert.deepEqual(flagValues(fakeArgv(entry.run), "--effort"), ["max"]);
  assert.equal(openProject(project).readItem<Ritual>("ritual", "heartbeat")?.header.policy.profile, undefined);
});

// --- run resume (0.16.0) ---------------------------------------------------------------

/** Holds a fresh run of `heartbeat` in `project` through run-due and returns its id. */
async function heldRun(project: string): Promise<string> {
  seedRitual(project);
  process.env.FAKE_CLAUDE_MODE = "hold";
  const entry = ritualsOf((await runDueJson(project)).report)[0];
  assert.equal(entry?.end, "held");
  return entry?.run ?? "";
}

/** The `-p` message of the fake's last launch for `run`. */
function fakeMessage(run: string): string {
  return flagValues(fakeArgv(run), "-p")[0] ?? "";
}

test("run resume goes on with the session: answers in the message, --resume, run.resumed; it refuses before an answer", async () => {
  const project = "rd-resume";
  const run = await heldRun(project);
  const note = JSON.parse(readFileSync(join(openProject(project).root, "runs", run, "session.json"), "utf8"));
  assert.deepEqual(note, { harness: "claude", session_id: "fake-session" }, "run-due notes the session id");

  const early = await runCli(runCommand, ["resume", run, "--project", project, "--json"]);
  assert.equal(early.code, 1);
  assert.match(JSON.parse(early.stdout).error, /no answer since it was held: darius run answer/u);
  await assert.rejects(runCli(runCommand, ["answer", run, "2", "no", "--project", project]), /there is no question 2/u);
  assert.equal((await runCli(runCommand, ["answer", run, "1", "yes,", "push", "it", "--project", project])).code, 0);

  mkdirSync(join(CLAUDE_HOME, "projects", "-some-checkout"), { recursive: true });
  writeFileSync(join(CLAUDE_HOME, "projects", "-some-checkout", "fake-session.jsonl"), "{}\n");
  process.env.FAKE_CLAUDE_MODE = "complete";
  const resumed = await runCli(runCommand, ["resume", run, "--project", project, "--json"]);
  assert.equal(resumed.code, 0, resumed.stdout);
  const entry = JSON.parse(resumed.stdout).projects[0].rituals[0];
  assert.equal(entry.resumed, true);
  assert.equal(entry.end, "complete");
  assert.equal(entry.run, run, "the same run id");
  assert.deepEqual(flagValues(fakeArgv(run), "--resume"), ["fake-session"]);
  assert.match(fakeMessage(run), /answered the questions of run .*\n\n1\. may I push\?\n   Answer: yes, push it\n/su);
  assert.match(fakeMessage(run), /hold list still applies/u);
  const [line] = linesOf(project, "run.resumed");
  assert.equal(line?.session_id, "fake-session");
  assert.equal(line?.fresh, undefined);
  assert.equal(linesOf(project, "run.started").length, 1, "no new run");

  const closed = await runCli(runCommand, ["resume", run, "--project", project]);
  assert.equal(closed.code, 1);
  assert.match(closed.stdout, /is not held \(phase: closed\)/u);
  await assert.rejects(runCli(runCommand, ["resume", "01NOPE", "--project", project]), /no run '01NOPE'/u);
  rmSync(join(CLAUDE_HOME, "projects"), { recursive: true, force: true });
});

test("run resume without the session starts fresh with the questions; a hold in the resumed run is recorded again", async () => {
  const project = "rd-resume-fresh";
  const run = await heldRun(project);
  assert.equal((await runCli(runCommand, ["answer", run, "1", "no", "--project", project])).code, 0);

  // FAKE_CLAUDE_MODE is still "hold": the resumed session holds once more.
  const resumed = await runCli(runCommand, ["resume", run, "--project", project, "--json"]);
  assert.equal(resumed.code, 0, resumed.stdout);
  const entry = JSON.parse(resumed.stdout).projects[0].rituals[0];
  assert.equal(entry.end, "held");
  assert.deepEqual(entry.questions, ["may I push?", "may I push?"], "questions number on across holds");
  assert.deepEqual(flagValues(fakeArgv(run), "--resume"), [], "this host has no such session");
  assert.match(fakeMessage(run), /^Run ritual heartbeat now\. Run id .*this is a new session.*1\. may I push\?\n   Answer: no\n/su);
  assert.equal(linesOf(project, "run.resumed")[0]?.fresh, true);
  assert.equal(linesOf(project, "run.held").length, 2);

  const again = await runCli(runCommand, ["resume", run, "--project", project]);
  assert.equal(again.code, 1, "the second hold has no answer yet");
  assert.equal((await runCli(runCommand, ["answer", run, "2", "still", "no", "--project", project])).code, 0);
  process.env.FAKE_CLAUDE_MODE = "complete";
  assert.equal((await runCli(runCommand, ["resume", run, "--project", project])).code, 0);
  assert.match(fakeMessage(run), /2\. may I push\?\n   Answer: still no/u);
});

test("the report says a run was resumed", () => {
  const lines = formatReport(batch([{ slug: "heartbeat", action: "started", resumed: true, run: "R1", end: "complete" }]));
  assert.ok(lines.includes("  ✓ heartbeat: resumed, complete (run R1)"), lines.join("\n"));
});

test("a profile may not carry the session flags darius sets for a resume", async () => {
  await assert.rejects(runCli(profileCommand, ["add", "rd-bad-resume", "--arg=--resume=abc"]), /args may not contain --resume=/u);
  await assert.rejects(runCli(profileCommand, ["add", "rd-bad-continue", "--arg=--continue"]), /args may not contain --continue/u);
});

// --- tools and report scopes (0.12.0) --------------------------------------------------

test("namedTools reads the program of each Bash rule; builtins, patterns and other tools are not programs", () => {
  assert.deepEqual(
    namedTools(["Bash(cd djinn)", "Bash(pnpm cli *)", "Bash(pnpm install)", "Bash(FOO=1 curl *)", "Bash(*)", "Read", "Bash(date)", "Bash(/opt/x/bin/tool --y)"]),
    ["pnpm", "curl", "date", "/opt/x/bin/tool"],
  );
  const dirs = new Set(["/a/pnpm", "/b/curl"]);
  assert.deepEqual(missingTools(["Bash(pnpm cli *)", "Bash(curl *)", "Bash(jq .)", "Bash(cd x)"], "/a:/b:relative", (path) => dirs.has(path)), ["jq"]);
});

test("a ritual whose may names a program the runner PATH lacks is skipped as tool-missing, before any run, and fails the batch", async () => {
  const project = "rd-tool-missing";
  seedRitual(project, { policy: { ...HEARTBEAT_POLICY, may: [...HEARTBEAT_POLICY.may, "Bash(no-such-tool-7x cli *)"] } });
  const { code, report } = await runDueJson(project);
  assert.equal(code, 1, JSON.stringify(report));
  const entry = ritualsOf(report)[0];
  assert.equal(entry?.reason, "tool-missing");
  assert.equal(linesOf(project, "run.started").length, 0);
  const dry = await runDueJson(project, ["--dry-run"]);
  assert.equal(ritualsOf(dry.report)[0]?.reason, "tool-missing", "the dry run shows it too");
});

function batch(rituals: RitualEntry[]): BatchReport {
  return { ok: true, date: "2026-09-29", host: "host-a", dryRun: false, projects: [{ project: "p", syncBefore: "", syncAfter: "", rituals }], errors: [] };
}

test("report scopes: the digest lists held and failed-today and says all quiet; news lists only runs and failures", () => {
  const held: RitualEntry = { slug: "a", action: "skipped", reason: "held", detail: "run R" };
  const failedToday: RitualEntry = { slug: "b", action: "skipped", reason: "failed-today" };
  const missing: RitualEntry = { slug: "c", action: "skipped", reason: "tool-missing", detail: "pnpm" };
  const off: RitualEntry = { slug: "d", action: "skipped", reason: "policy-off" };
  const digest = formatReport(batch([held, failedToday, off]), "digest").join("\n");
  assert.match(digest, /a: skipped, held/u);
  assert.match(digest, /b: skipped, failed-today/u);
  assert.equal(formatReport(batch([held, failedToday]), "news").length, 0, "no hourly repeat of a held run");
  assert.match(formatReport(batch([held, missing]), "news").join("\n"), /c: skipped, tool-missing/u);
  assert.deepEqual(formatReport(batch([off]), "digest"), ["darius run-due on host-a, 2026-09-29: all quiet, 1 project(s), nothing due, held or failed"]);
  assert.match(formatReport(batch([off]), "all").join("\n"), /d: skipped, policy-off/u, "a person who asked hears every skip");
});

// --- acknowledge (0.18.0) --------------------------------------------------------------

/** Appends the lines of one run of `heartbeat`, as the runner would. */
function fakeRun(project: string, types: readonly string[]): string {
  const store = openProject(project);
  const run = ulid();
  for (const type of types) {
    const [kind = "", outcome] = type.split(":");
    const line: LedgerLineInput = { who: "timer", type: kind, item: "ritual/heartbeat", run };
    if (outcome !== undefined) line.outcome = outcome;
    if (kind === "run.held") line.questions = ["may I push?"];
    appendLine(store, line);
  }
  return run;
}

test("run ack accepts a failed or abandoned run once; it refuses a held, running or complete run and a second ack", () => {
  const project = "rd-ack";
  seedRitual(project);
  const store = openProject(project);
  const failed = fakeRun(project, ["run.started", "run.completed:failed"]);
  const first = acknowledgeRun(store, { run: failed, who: "tester", note: "known outage" });
  assert.deepEqual(first, { ok: true, outcome: "failed" });
  const [line] = linesOf(project, "run.acknowledged");
  assert.deepEqual([line?.run, line?.who, line?.note, line?.item], [failed, "tester", "known outage", "ritual/heartbeat"]);
  const second = acknowledgeRun(store, { run: failed, who: "tester" });
  assert.equal(second.ok, false);
  assert.match(second.ok ? "" : second.error, /already acknowledged by tester/u);

  const abandoned = fakeRun(project, ["run.started", "run.completed:abandoned"]);
  assert.deepEqual(acknowledgeRun(store, { run: abandoned, who: "tester", note: "" }), { ok: true, outcome: "abandoned" });
  assert.equal(linesOf(project, "run.acknowledged")[1]?.note, undefined, "an empty note is no note");

  const refusals: ReadonlyArray<readonly [string[], RegExp]> = [
    [["run.started", "run.held"], /is held: answer and resume it/u],
    [["run.started"], /is running; only a failed or abandoned run can be acknowledged/u],
    [["run.started", "run.completed:complete"], /is closed \(complete\); only a failed or abandoned run/u],
  ];
  for (const [types, reason] of refusals) {
    const result = acknowledgeRun(store, { run: fakeRun(project, types), who: "tester" });
    assert.equal(result.ok, false, types.join(" "));
    assert.match(result.ok ? "" : result.error, reason);
    assert.equal(result.ok ? true : result.isUnknown, false);
  }
  const unknown = acknowledgeRun(store, { run: "01NOPE", who: "tester" });
  assert.equal(unknown.ok ? false : unknown.isUnknown, true);
  assert.equal(linesOf(project, "run.acknowledged").length, 2, "no refusal writes a line");
});

test("an acknowledged failure still skips failed-today, and the digest names who saw it", async () => {
  const project = "rd-ack-digest";
  seedRitual(project);
  process.env.FAKE_CLAUDE_MODE = "silent";
  const failed = ritualsOf((await runDueJson(project)).report)[0]?.run ?? "";
  process.env.FAKE_CLAUDE_MODE = "complete";

  const before = ritualsOf((await runDueJson(project)).report)[0];
  assert.equal(before?.reason, "failed-today");
  assert.equal(before?.detail, `run ${failed}; darius run ack ${failed} or darius run now heartbeat`);

  assert.equal((await runCli(runCommand, ["ack", failed, "--project", project, "--who", "tester"])).code, 0);
  const after = await runDueJson(project);
  const entry = ritualsOf(after.report)[0];
  assert.equal(entry?.reason, "failed-today", "an acknowledgement does not bring the retry back");
  assert.equal(entry?.detail, `run ${failed}; acknowledged by tester`);
  assert.equal(linesOf(project, "run.started").length, 1);
  const digest = formatReport(batch([{ slug: "heartbeat", action: "skipped", reason: "failed-today", detail: entry?.detail ?? "" }]), "digest").join("\n");
  assert.match(digest, new RegExp(`heartbeat: skipped, failed-today, run ${failed}; acknowledged by tester`, "u"));
});

test("the first unattended batch of a day sends the digest, later ones news; a dry run shows all", async () => {
  const project = "rd-digest";
  seedRitual(project, { policy: { ...HEARTBEAT_POLICY, mode: "off" } });
  rmSync(join(process.env.DARIUS_STATE_DIR ?? "", "run-due-digest.json"), { force: true });
  const first = await runCli(runDueCommand, ["--unattended", "--project", project]);
  assert.match(first.stdout, /all quiet/u, first.stdout);
  const second = await runCli(runDueCommand, ["--unattended", "--project", project]);
  assert.match(second.stdout, /nothing due/u, "no digest twice a day");
  assert.equal(second.stdout.includes("all quiet"), false);
  assert.equal(reportScope({ ...batch([]), dryRun: true }), "all");
  assert.equal(reportScope({ ...batch([]), date: "2099-01-01" }), "digest", "a new day brings a new digest");
});

// --- host pin (0.18.0) -----------------------------------------------------------------

test("a ritual pinned to another host is skipped as other-host, quietly; on its own host it runs", async () => {
  const project = "rd-pin";
  seedRitual(project);
  process.env.FAKE_CLAUDE_MODE = "complete";
  assert.equal((await runCli(ritualCommand, ["set", "heartbeat", "--project", project, "--host", "host-b"])).code, 0);

  const other = await runDueJson(project);
  assert.equal(other.code, 0, JSON.stringify(other.report));
  const entry = ritualsOf(other.report)[0];
  assert.deepEqual([entry?.action, entry?.reason, entry?.detail], ["skipped", "other-host", "pinned to host-b"]);
  assert.equal(linesOf(project, "run.started").length, 0, "no run exists");
  const skip: RitualEntry = { slug: "heartbeat", action: "skipped", reason: "other-host", detail: "pinned to host-b" };
  assert.deepEqual(formatReport(batch([skip]), "digest"), ["darius run-due on host-a, 2026-09-29: all quiet, 1 project(s), nothing due, held or failed"]);
  assert.equal(formatReport(batch([skip]), "news").length, 0);

  const now = await runCli(runCommand, ["now", "heartbeat", "--project", project]);
  assert.equal(now.code, 1, "run now by hand on the wrong host refuses (0.50.0)");
  assert.equal(now.stdout, `! heartbeat runs on host-b (pinned): ssh host-b darius run now heartbeat --project ${project}`);
  assert.equal(linesOf(project, "run.started").length, 0);

  assert.equal((await runCli(ritualCommand, ["set", "heartbeat", "--project", project, "--host", hostId()])).code, 0);
  const own = await runDueJson(project);
  assert.equal(ritualsOf(own.report)[0]?.end, "complete", "the pinned host runs it");
  assert.equal(linesOf(project, "run.started").length, 1);
});

// --- the right host (0.50.0) ---------------------------------------------------------------

/** One ledger line from another host, as a sync brings it: `ledger/<host>/open.jsonl`. */
function lineFrom(project: string, host: string, payload: Record<string, JsonValue>): void {
  const ms = Date.now();
  const line = { v: 1, id: ulid(ms), at: new Date(ms).toISOString(), host, who: "test", project, ...payload };
  const dir = join(openProject(project).root, "ledger", host);
  mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, "open.jsonl"), `${JSON.stringify(line)}\n`);
}

test("run now on the wrong host refuses with exit 1 and the ssh command, with --dry-run and --json too; the timer still skips quietly", async () => {
  const project = "rh-now";
  seedRitual(project);
  assert.equal((await runCli(ritualCommand, ["set", "heartbeat", "--project", project, "--host", "host-b"])).code, 0);
  const dry = await runCli(runCommand, ["now", "heartbeat", "--project", project, "--dry-run", "--profile", "fast"]);
  assert.equal(dry.code, 1);
  assert.equal(dry.stdout, `! heartbeat runs on host-b (pinned): ssh host-b darius run now heartbeat --project ${project} --dry-run --profile fast`);
  const json = await runCli(runCommand, ["now", "heartbeat", "--project", project, "--json"]);
  assert.equal(json.code, 1);
  assert.deepEqual(JSON.parse(json.stdout), { ok: false, ritual: "heartbeat", host: "host-b", why: "pinned", command: `ssh host-b darius run now heartbeat --project ${project} --json` });

  assert.equal((await runCli(ritualCommand, ["set", "heartbeat", "--project", project, "--host", ""])).code, 0);
  lineFrom(project, "host-b", { type: "project.linked", path: "/srv/checkouts/rh-now" });
  const linked = await runCli(runCommand, ["now", "heartbeat", "--project", project]);
  assert.equal(linked.code, 1);
  assert.equal(linked.stdout, `! heartbeat runs on host-b (its checkout is linked there): ssh host-b darius run now heartbeat --project ${project}`);
  const timer = await runDueJson(project);
  assert.equal(timer.code, 0, "the timer's no-workdir skip stays quiet");
  assert.equal(ritualsOf(timer.report)[0]?.reason, "no-workdir");
  assert.equal(linesOf(project, "run.started").length, 0, "no run exists");
});

test("run now by hand with no checkout here and no known right host exits 1 (no-workdir)", async () => {
  const project = "rh-nowhere";
  seedRitual(project);
  appendLine(openProject(project), { who: "test", type: "import", source: "/nonexistent-darius/repo/.tracker" });
  const now = await runCli(runCommand, ["now", "heartbeat", "--project", project, "--dry-run"]);
  assert.equal(now.code, 1, now.stdout);
  assert.match(now.stdout, /heartbeat: skipped, no-workdir, /u);
});

test("run resume on the wrong host refuses with the ssh command for the held run", async () => {
  const project = "rh-resume";
  seedRitual(project);
  const run: string = JSON.parse((await runCli(runCommand, ["start", "heartbeat", "--project", project, "--json"])).stdout).run;
  assert.equal((await runCli(runCommand, ["hold", run, "--project", project, "--question", "push?"])).code, 0);
  assert.equal((await runCli(runCommand, ["answer", run, "1", "yes", "--project", project])).code, 0);
  assert.equal((await runCli(ritualCommand, ["set", "heartbeat", "--project", project, "--host", "host-b"])).code, 0);
  const resumed = await runCli(runCommand, ["resume", run, "--project", project]);
  assert.equal(resumed.code, 1);
  assert.equal(resumed.stdout, `! heartbeat runs on host-b (pinned): ssh host-b darius run resume ${run} --project ${project}`);
  assert.equal(linesOf(project, "run.resumed").length, 0);
});

test("verbArgv rebuilds the verb for another host: --on left out, --project set, repeated flags kept in order", () => {
  const args = parseArgs(["follow-up", "01RUN", "--on", "host-b", "--approve", "1", "--json", "--approve", "2", "--note", "it's \"done\""]);
  assert.deepEqual(verbArgv(args, "acme-web", { who: "me@host-a via ssh" }), [
    "run", "follow-up", "01RUN", "--approve", "1", "--approve", "2", "--json", "--note", "it's \"done\"", "--project", "acme-web", "--who", "me@host-a via ssh",
  ]);
  assert.deepEqual(verbArgv(parseArgs(["now", "--", "--odd"]), "p"), ["run", "--project", "p", "--", "now", "--odd"]);
});

const FAKE_SSH = join(BIN, "fake-ssh");
const FAKE_SSH_LOG = join(SANDBOX, "ssh-log");
writeFileSync(
  FAKE_SSH,
  `#!${BASH}
# A fake ssh: ssh -o X -o Y <host> <words...>. It logs its argv, then parses the
# remote line the way a login shell would and logs those words, so a test sees
# what the remote darius would get. It never runs them.
printf '%s\\0' "$@" > "${FAKE_SSH_LOG}.argv"
shift 4
host="$1"; shift
eval "set -- $*"
printf '%s\\0' "$host" "$@" > "${FAKE_SSH_LOG}.words"
echo "remote output from $host"
exit "\${FAKE_SSH_EXIT:-0}"
`,
);
chmodSync(FAKE_SSH, 0o755);

function sshWords(): string[] {
  return readFileSync(`${FAKE_SSH_LOG}.words`, "utf8").split("\0").slice(0, -1);
}

test("--on forwards the verb over ssh: quoted words, output streamed, exit code passed through, --who names the caller", () => {
  rmSync(`${FAKE_SSH_LOG}.words`, { force: true });
  const env = { ...process.env, DARIUS_SSH: FAKE_SSH, FAKE_SSH_EXIT: "3", USER: "op", DARIUS_RUN: "", DARIUS_RUN_POLICY: "" };
  const note = `it's "done" now`;
  const ran = spawnSync(join(BIN, "darius"), ["run", "follow-up", "01RUNID", "--on", "host-b", "--project", "rh-on", "--approve", "1", "--note", note], { env, encoding: "utf8" });
  assert.equal(ran.status, 3, ran.stderr);
  assert.match(ran.stdout, /remote output from host-b/u, "the remote output streams through");
  const argv = readFileSync(`${FAKE_SSH_LOG}.argv`, "utf8").split("\0").slice(0, 6);
  assert.deepEqual(argv, ["-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "host-b", "bash"]);
  assert.deepEqual(sshWords(), [
    "host-b", "bash", "-l", "-c", 'exec darius "$@"', "darius",
    "run", "follow-up", "01RUNID", "--project", "rh-on", "--approve", "1", "--note", note, "--who", `op@${hostId()} via ssh`,
  ]);

  const given = spawnSync(join(BIN, "darius"), ["run", "now", "heartbeat", "--project", "rh-on", "--on", "host-c", "--who", "o'brien"], { env: { ...env, FAKE_SSH_EXIT: "0" }, encoding: "utf8" });
  assert.equal(given.status, 0, given.stderr);
  assert.deepEqual(sshWords().slice(6), ["run", "now", "heartbeat", "--project", "rh-on", "--who", "o'brien"], "a given --who stays");
});

test("--on is refused inside a run and never reaches ssh; --on naming this host runs here", async () => {
  const project = "rh-on-run";
  seedRitual(project);
  rmSync(`${FAKE_SSH_LOG}.words`, { force: true });
  process.env.DARIUS_SSH = FAKE_SSH;
  process.env.DARIUS_RUN = "01INSIDE";
  try {
    const inside = await runCli(runCommand, ["now", "heartbeat", "--project", project, "--on", "host-b"]);
    assert.equal(inside.code, 1);
    assert.equal(inside.stdout, "! run now --on is for a person; a run darius started does not reach other hosts");
    delete process.env.DARIUS_RUN;
    process.env.DARIUS_RUN_POLICY = "/tmp/policy.json";
    assert.equal((await runCli(runCommand, ["resume", "01X", "--project", project, "--on", "host-b"])).code, 1);
    delete process.env.DARIUS_RUN_POLICY;
    assert.equal(existsSync(`${FAKE_SSH_LOG}.words`), false, "no ssh call");

    assert.equal((await runCli(ritualCommand, ["set", "heartbeat", "--project", project, "--host", "host-b"])).code, 0);
    const here = await runCli(runCommand, ["now", "heartbeat", "--project", project, "--on", hostId()]);
    assert.equal(here.code, 1);
    assert.equal(here.stdout, `! heartbeat runs on host-b (pinned): ssh host-b darius run now heartbeat --project ${project}`);
    assert.equal(existsSync(`${FAKE_SSH_LOG}.words`), false, "this host needs no ssh");
  } finally {
    delete process.env.DARIUS_RUN;
    delete process.env.DARIUS_RUN_POLICY;
    process.env.DARIUS_SSH = join(SANDBOX, "no-ssh");
  }
});

test("the gate denies a run verb with --on in every run (0.50.0)", () => {
  for (const line of ["darius run now heartbeat --on host-b", "darius run resume 01X --project p --on=host-b", "env FOO=1 darius run 'now' x --on host-b"]) {
    assert.equal(forwardsRun(line), true, line);
  }
  for (const line of ["darius run now heartbeat", "darius run list --on", "echo run now --only x"]) assert.equal(forwardsRun(line), false, line);
});

// --- gate check per harness version ------------------------------------------------

function checksOf(version: string): LedgerLine[] {
  return linesOf("_global", "harness.checked").filter((line) => line.version === version);
}

async function withFake<T>(env: { version: string; check?: string }, body: () => Promise<T>): Promise<T> {
  process.env.FAKE_CLAUDE_VERSION = env.version;
  if (env.check === undefined) delete process.env.FAKE_CLAUDE_CHECK;
  else process.env.FAKE_CLAUDE_CHECK = env.check;
  try {
    return await body();
  } finally {
    delete process.env.FAKE_CLAUDE_VERSION;
    delete process.env.FAKE_CLAUDE_CHECK;
  }
}

test("run-due checks a new harness version once before its first run; a passed check lets the ritual run", async () => {
  process.env.FAKE_CLAUDE_MODE = "complete";
  await withFake({ version: "2.1.901", check: "obey" }, async () => {
    seedRitual("hc-pass");
    const first = await runDueJson("hc-pass");
    assert.equal(first.code, 0, JSON.stringify(first.report));
    assert.equal(ritualsOf(first.report)[0]?.end, "complete");
    assert.equal(first.report.harnessChecks?.[0]?.outcome, "passed");
    const checks = checksOf("2.1.901");
    assert.equal(checks.length, 1);
    assert.equal(checks[0]?.outcome, "passed");
    assert.equal(checks[0]?.subagents, "passed", "the gate judged the subagent's call");
    assert.equal(checks[0]?.host, hostId());
    assert.equal(checks[0]?.cost_usd, 0.0004);

    const checkRun = String(checks[0]?.run);
    const argv = fakeArgv(checkRun);
    assert.ok(argv.includes("--dangerously-skip-permissions"), "the check runs with permissions skipped");
    assert.deepEqual(flagValues(argv, "--model"), ["haiku"]);
    assert.match(argv[1] ?? "", /touch \/\S+\/marker .*Agent tool.*touch \/\S+\/marker-subagent/u);
    const gateLog = readFileSync(join(openProject("_global").root, "runs", checkRun, "gate.jsonl"), "utf8");
    assert.match(gateLog, /"class":"shell","verdict":"deny"/u, "the gate log shows the denied touch");
    assert.match(gateLog, /"tool":"Agent","class":"agent","verdict":"allow"/u, "the check may start its subagent");
    assert.match(gateLog, /"verdict":"deny".*"agent":"fake-sub"/u, "and the gate judged the subagent's touch");

    seedRitual("hc-pass-2");
    const second = await runDueJson("hc-pass-2");
    assert.equal(ritualsOf(second.report)[0]?.end, "complete");
    assert.equal(second.report.harnessChecks, undefined);
    assert.equal(checksOf("2.1.901").length, 1, "a passed version is not checked again");
  });
});

test("a harness that ignores its gate fails the check: its rituals skip as harness-unchecked, no retry the same day, a check by hand unlocks it", async () => {
  process.env.FAKE_CLAUDE_MODE = "complete";
  await withFake({ version: "2.1.902", check: "ignore" }, async () => {
    seedRitual("hc-fail");
    const first = await runDueJson("hc-fail");
    assert.equal(first.report.ok, false);
    const entry = ritualsOf(first.report)[0];
    assert.equal(entry?.reason, "harness-unchecked");
    assert.match(entry?.detail ?? "", /claude 2\.1\.902: the gate check was failed: the marker exists, and the gate saw no shell call; run darius harness check claude/u);
    assert.equal(linesOf("hc-fail", "run.started").length, 0, "no run starts");

    const again = await runDueJson("hc-fail");
    assert.match(ritualsOf(again.report)[0]?.detail ?? "", /was failed today/u);
    assert.equal(checksOf("2.1.902").length, 1, "run-due does not check again the same day");

    process.env.FAKE_CLAUDE_CHECK = "obey";
    const byHand = await runCli(harnessCommand, ["check", "claude"]);
    assert.equal(byHand.code, 0, byHand.stdout);
    assert.match(byHand.stdout, /✓ claude 2\.1\.902: gate check passed, subagents passed on /u);
    const after = await runDueJson("hc-fail");
    assert.equal(ritualsOf(after.report)[0]?.end, "complete");
  });
});

test("harness check: a model that never calls the tool is inconclusive (exit 3); harness list shows the latest check per version", async () => {
  await withFake({ version: "2.1.903", check: "silent" }, async () => {
    const result = await runCli(harnessCommand, ["check", "--json"]);
    assert.equal(result.code, 3);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.outcome, "inconclusive");
    assert.match(parsed.detail, /the model made no shell call/u);
    const listed = await runCli(harnessCommand, ["list"]);
    assert.match(listed.stdout, /! claude 2\.1\.903 on \S+: inconclusive/u);
    const unknown = await runCli(harnessCommand, ["check", "codex"]).catch((cause: unknown) => cause);
    assert.match(String(unknown), /unknown harness "codex"/u);
  });
});

test("a dry run names the pending check and spends nothing; an unreadable version skips as harness-unchecked", async () => {
  await withFake({ version: "2.1.904" }, async () => {
    seedRitual("hc-dry");
    const dry = await runDueJson("hc-dry", ["--dry-run"]);
    const entry = ritualsOf(dry.report)[0];
    assert.equal(entry?.action, "would-start");
    assert.deepEqual(entry?.warnings, ["would check claude 2.1.904 first"]);
    assert.equal(checksOf("2.1.904").length, 0);
    const text = await runCli(runDueCommand, ["--unattended", "--project", "hc-dry", "--dry-run"]);
    assert.match(text.stdout, /heartbeat: due, would start with claude, built-in profile, headless \(dry run\); warning: would check claude 2\.1\.904 first/u);
  });
  await withFake({ version: "garbage" }, async () => {
    seedRitual("hc-garbage");
    const report = await runDueJson("hc-garbage");
    const entry = ritualsOf(report.report)[0];
    assert.equal(entry?.reason, "harness-unchecked");
    assert.match(entry?.detail ?? "", /cannot read the claude version: .* gave no version/u);
  });
});

test("policy-check writes every decision to gate.jsonl next to the policy file", async () => {
  const project = "pc-gate-log";
  const { policyFile } = seedRunningRun(project, "report");
  const dir = mkdtempSync(join(SANDBOX, "gate-log-"));
  const moved = join(dir, "policy.json");
  writeFileSync(moved, readFileSync(policyFile, "utf8"));
  await runCli(policyCheckCommand, ["--policy", moved], bashHook("date"));
  await runCli(policyCheckCommand, ["--policy", moved], bashHook("git commit -m x"));
  await runCli(policyCheckCommand, ["--policy", moved, "--preflight"], bashHook("date"));
  const lines = readFileSync(join(dir, "gate.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(lines.length, 2, "the preflight writes nothing");
  assert.deepEqual([lines[0].tool, lines[0].class, lines[0].verdict, lines[0].command], ["Bash", "shell", "allow", "date"]);
  assert.equal(lines[1].verdict, "hold");
  assert.match(lines[1].reason, /report mode denies write verbs/u);
});

test("the text report names each gate check, and a check is never all quiet", () => {
  const report: BatchReport = {
    ok: false,
    date: "2026-09-30",
    host: "host-a",
    dryRun: false,
    projects: [],
    errors: [],
    harnessChecks: [
      { harness: "claude", version: "2.1.905", outcome: "passed", subagents: "passed", costUsd: 0.004 },
      { harness: "claude", version: "2.1.906", outcome: "failed", subagents: "inconclusive", detail: "the harness ran a shell call its gate denied" },
    ],
  };
  const text = formatReport(report, "digest").join("\n");
  assert.match(text, /✓ claude 2\.1\.905: gate check passed, subagents passed on host-a \(\$0\.0040\)/u);
  assert.match(text, /! claude 2\.1\.906: gate check failed on host-a: the harness ran a shell call its gate denied/u);
  assert.doesNotMatch(text, /all quiet/u);
});

function policyOf(project: string, run: string): { may: string[]; gate?: string } {
  return JSON.parse(readFileSync(join(openProject(project).root, "runs", run, "policy.json"), "utf8"));
}

test("a subagent that escapes its gate fails the check; a check without the subagent step passes with subagents not proven", async () => {
  await withFake({ version: "2.1.908", check: "ignore-sub" }, async () => {
    const failed = await runCli(harnessCommand, ["check", "--json"]);
    assert.equal(failed.code, 1);
    assert.match(JSON.parse(failed.stdout).detail, /a subagent created its marker, and the gate saw no shell call from it/u);
  });
  await withFake({ version: "2.1.909", check: "obey-main" }, async () => {
    const main = await runCli(harnessCommand, ["check"]);
    assert.equal(main.code, 0);
    assert.match(main.stdout, /✓ claude 2\.1\.909: gate check passed, subagents not proven on /u);
  });
});

test("a ritual whose may names Agent gets subagents only after a check proved them on this host", async () => {
  process.env.FAKE_CLAUDE_MODE = "complete";
  const withAgent: Policy = { ...HEARTBEAT_POLICY, may: [...HEARTBEAT_POLICY.may, "Agent"] };

  // The seeded check of the default version has no subagent proof.
  seedRitual("sa-unproven", { policy: withAgent });
  const unproven = await runDueJson("sa-unproven");
  const first = ritualsOf(unproven.report)[0];
  assert.equal(first?.end, "complete");
  assert.match(first?.warnings?.join(" ") ?? "", /subagents off: the gate check of claude 2\.1\.999 on this host did not prove them; run darius harness check claude/u);
  const run1 = first?.run ?? "";
  assert.deepEqual(policyOf("sa-unproven", run1).may, HEARTBEAT_POLICY.may, "the run's policy drops Agent");
  assert.ok(flagValues(fakeArgv(run1), "--disallowedTools").includes("Agent"));
  assert.doesNotMatch(readFileSync(join(openProject("sa-unproven").root, "runs", run1, "prompt.md"), "utf8"), /## Subagents/u);

  await withFake({ version: "2.1.910", check: "obey" }, async () => {
    seedRitual("sa-proven", { policy: withAgent });
    const proven = await runDueJson("sa-proven");
    const entry = ritualsOf(proven.report)[0];
    assert.equal(entry?.end, "complete");
    assert.equal(entry?.warnings, undefined);
    const run2 = entry?.run ?? "";
    const runPolicy = policyOf("sa-proven", run2);
    assert.ok(runPolicy.may.includes("Agent"));
    assert.equal(runPolicy.gate, "full");
    assert.equal(flagValues(fakeArgv(run2), "--disallowedTools").includes("Agent"), false);
    const prompt = readFileSync(join(openProject("sa-proven").root, "runs", run2, "prompt.md"), "utf8");
    assert.match(prompt, /## Subagents\n\nYou may start subagents with the Agent tool/u);
    assert.match(prompt, /Wait for the result of every subagent before you run `darius run complete`/u);
  });
});

// --- run results (0.22.0) -------------------------------------------------------------

function completedLine(project: string, run: string): LedgerLine | undefined {
  return linesOf(project, "run.completed").find((line) => line.run === run);
}

test("a launched run hands in a result: the block leaves the findings, the counts go on the ledger line", async () => {
  process.env.FAKE_CLAUDE_MODE = "complete";
  seedRitual("res-ok");
  const { report } = await runDueJson("res-ok");
  const run = ritualsOf(report)[0]?.run ?? "";
  const runDir = join(openProject("res-ok").root, "runs", run);
  assert.equal(JSON.parse(readFileSync(join(runDir, "policy.json"), "utf8")).result, "required");
  const prompt = readFileSync(join(runDir, "prompt.md"), "utf8");
  assert.match(prompt, /## Result\n\nEnd your findings with exactly one fenced block whose info string is `darius-result`/u);
  const line = completedLine("res-ok", run);
  assert.deepEqual(line?.result, { status: "ok", questions: 0, open: { critical: 0, high: 0, medium: 0, low: 0, info: 0 }, fixed: 0 });
  const project = openProject("res-ok");
  assert.equal(getBlobText(project, String(line?.findings_sha)), "heartbeat ok\n", "the block is cut out of the findings");
  assert.equal(JSON.parse(getBlobText(project, String(line?.result_sha)) ?? "{}").summary, "heartbeat ok");
});

test("a result with a question: the report says so, and run ack records the decision", async () => {
  process.env.FAKE_CLAUDE_MODE = "complete";
  process.env.FAKE_CLAUDE_RESULT = JSON.stringify({ v: 1, status: "ok", summary: "one card to decide", questions: [{ text: "Delete the card?", recommendation: "Yes." }] });
  try {
    seedRitual("res-asks");
    const { report } = await runDueJson("res-asks");
    const entry = ritualsOf(report)[0];
    assert.equal(entry?.end, "complete");
    const run = entry?.run ?? "";
    const summary = readSummary(completedLine("res-asks", run)?.result);
    assert.equal(summary?.status, "attention", "a question raises the status");
    const started: RitualEntry = { slug: "heartbeat", action: "started", run, end: "complete" };
    if (summary !== null) started.result = summary;
    const asked: BatchReport = {
      ok: true,
      date: "2026-09-30",
      host: "host-a",
      dryRun: false,
      errors: [],
      projects: [{ project: "res-asks", syncBefore: "ok", syncAfter: "ok", rituals: [started] }],
    };
    const text = formatReport(asked, "news").join("\n");
    assert.match(text, /complete, asks 1 question: read them on the run page, then darius run ack \S+ --note "your decision" --project res-asks/u);
    const ack = await runCli(runCommand, ["ack", run, "--project", "res-asks", "--note", "deleted it"]);
    assert.equal(ack.code, 0, ack.stdout);
    assert.equal(linesOf("res-asks", "run.acknowledged")[0]?.note, "deleted it");
  } finally {
    delete process.env.FAKE_CLAUDE_RESULT;
  }
});

test("a handoff note and the operator's answer reach the next run's prompt; a crashed run leaves them in place", async () => {
  const project = "res-handoff";
  const note = "Check post 7 again. The card on post 9 waits for the operator.";
  const promptOf = (run: string): string => readFileSync(join(openProject(project).root, "runs", run, "prompt.md"), "utf8");
  const runNow = async (): Promise<string> =>
    JSON.parse((await runCli(runCommand, ["now", "heartbeat", "--project", project, "--json"])).stdout).projects[0].rituals[0].run;
  process.env.FAKE_CLAUDE_MODE = "complete";
  process.env.FAKE_CLAUDE_RESULT = JSON.stringify({ v: 1, status: "ok", summary: "one card to decide", questions: [{ text: "Delete the card?" }], handoff: note });
  try {
    seedRitual(project);
    const first = ritualsOf((await runDueJson(project)).report)[0]?.run ?? "";
    assert.equal(completedLine(project, first)?.handoff, note, "the note goes on the ledger line");
    assert.doesNotMatch(promptOf(first), /## Handoff/u, "the first run gets nothing");
    assert.equal((await runCli(runCommand, ["ack", first, "--project", project, "--note", "yes, delete it"])).code, 0);

    process.env.FAKE_CLAUDE_MODE = "silent";
    const crashed = await runNow();
    assert.equal(completedLine(project, crashed)?.outcome, "failed");
    process.env.FAKE_CLAUDE_MODE = "complete";
    delete process.env.FAKE_CLAUDE_RESULT;
    const third = await runNow();
    for (const run of [crashed, third]) {
      const prompt = promptOf(run);
      assert.match(prompt, new RegExp(`## Handoff from the previous run\n\nThe previous run of this ritual \\(run ${first}, completed `, "u"));
      assert.match(prompt, /Its note: Check post 7 again\. The card on post 9 waits for the operator\./u);
      assert.match(prompt, /Its questions for the operator:\n1\. Delete the card\?/u);
      assert.match(prompt, /The operator's answer \([^)]+\): yes, delete it/u);
      assert.ok(prompt.indexOf("## Handoff") < prompt.indexOf("## Protocol"), "the handoff comes before the protocol");
    }
    const store = openProject(project);
    assert.equal(latestHandoff(store, readLedger(store), "heartbeat"), null, "a result without a note passes nothing on");
  } finally {
    delete process.env.FAKE_CLAUDE_RESULT;
  }
});

test("an invalid block keeps the run open; if the model gives up, the failure keeps what it sent", async () => {
  process.env.FAKE_CLAUDE_MODE = "complete";
  process.env.FAKE_CLAUDE_RESULT = '{"v": 1, "status": "fine"}';
  try {
    seedRitual("res-bad");
    const { report } = await runDueJson("res-bad");
    const entry = ritualsOf(report)[0];
    assert.equal(entry?.end, "failed", "the fake gave up after the refusal");
    const run = entry?.run ?? "";
    const runDir = join(openProject("res-bad").root, "runs", run);
    assert.match(readFileSync(join(runDir, "findings-rejected.md"), "utf8"), /heartbeat ok/u);
    const blob = JSON.parse(getBlobText(openProject("res-bad"), String(completedLine("res-bad", run)?.findings_sha)) ?? "{}");
    assert.match(blob.rejected_findings, /"status": "fine"/u);
  } finally {
    delete process.env.FAKE_CLAUDE_RESULT;
  }
});

test("a by-hand run may hand in a block, which must then be valid; a failed run is recorded whatever its block says", async () => {
  seedRitual("res-hand");
  const start = async (): Promise<string> => JSON.parse((await runCli(runCommand, ["start", "heartbeat", "--project", "res-hand", "--json"])).stdout).run;
  const plain = await start();
  const done = await runCli(runCommand, ["complete", plain, "--project", "res-hand", "--outcome", "complete", "--findings-stdin"], "no block\n");
  assert.equal(done.code, 0, "no block is fine by hand");
  const bad = await start();
  const refused = await runCli(runCommand, ["complete", bad, "--project", "res-hand", "--outcome", "complete", "--findings-stdin"], "x\n```darius-result\n{}\n```\n");
  assert.equal(refused.code, 1);
  assert.match(refused.stdout, /refused the findings of run \S+: the run stays open/u);
  assert.match(refused.stdout, /- v: must be 1/u);
  assert.match(refused.stdout, /- result.summary: needs a non-empty string/u);
  const failed = await runCli(runCommand, ["complete", bad, "--project", "res-hand", "--outcome", "failed", "--findings-stdin"], "x\n```darius-result\n{}\n```\n");
  assert.equal(failed.code, 0, "a failure is recorded whatever its block says");
  assert.match(getBlobText(openProject("res-hand"), String(completedLine("res-hand", bad)?.findings_sha)) ?? "", /darius-result/u);
});

test("an act ritual with subagents skips as subagents-unproven when the check did not prove them", async () => {
  process.env.FAKE_CLAUDE_MODE = "complete";
  seedRitual("sa-act", { policy: { ...HEARTBEAT_POLICY, mode: "act", may: [...HEARTBEAT_POLICY.may, "Agent"] } });
  const { report } = await runDueJson("sa-act");
  const entry = ritualsOf(report)[0];
  assert.equal(entry?.reason, "subagents-unproven");
  assert.match(entry?.detail ?? "", /needs the gate check of claude 2\.1\.999 to prove them on this host; run darius harness check claude/u);
  assert.equal(report.ok, false, "a failing skip");
});

test("run show prints a run's facts, its result and its findings; run list carries the result counts", async () => {
  seedRitual("res-show");
  const run = JSON.parse((await runCli(runCommand, ["start", "heartbeat", "--project", "res-show", "--json"])).stdout).run;
  const findings = [
    "# Check",
    "",
    "One card is stale.",
    "",
    "```darius-result",
    JSON.stringify({ v: 1, status: "ok", summary: "one stale card", items: [{ title: "Stale card", severity: "medium", state: "needs-decision", group: "site-c", target: "post 32454" }], questions: [{ text: "Delete it?", recommendation: "Yes.", commands: ["pnpm -C tools cli cards delete 32454"] }] }),
    "```",
  ].join("\n");
  const chained = findings.replace("pnpm -C tools cli cards delete 32454", "cd tools && pnpm cli cards delete 32454");
  const refusedChain = await runCli(runCommand, ["complete", run, "--project", "res-show", "--outcome", "complete", "--findings-stdin"], chained);
  assert.equal(refusedChain.code, 1, "a command line that is not one plain command is refused");
  assert.match(refusedChain.stdout, /questions\[0\]\.commands\[0\]: not one plain command/u);
  const done = await runCli(runCommand, ["complete", run, "--project", "res-show", "--outcome", "complete", "--findings-stdin"], findings);
  assert.equal(done.code, 0, done.stdout);
  assert.match(done.stdout, /result attention, 1 question\(s\) for the operator, 1 open item\(s\)/u);
  const text = await runCli(runCommand, ["show", run, "--project", "res-show"]);
  assert.match(text.stdout, /Result: attention\. one stale card/u);
  assert.match(text.stdout, /question 1: Delete it\? \(recommended: Yes\.\)\n {4}run: pnpm -C tools cli cards delete 32454\n/u);
  assert.match(text.stdout, /medium needs-decision: Stale card \[site-c, post 32454\]/u);
  assert.match(text.stdout, /# Check\n\nOne card is stale\./u);
  assert.doesNotMatch(text.stdout, /```darius-result/u, "the block is not in the findings");
  const json = JSON.parse((await runCli(runCommand, ["show", run, "--project", "res-show", "--json"])).stdout);
  assert.equal(json.result.items[0].target, "post 32454");
  const listed = JSON.parse((await runCli(runCommand, ["list", "--project", "res-show", "--json"])).stdout);
  assert.equal(listed.runs[0].result.questions, 1);
  await assert.rejects(runCli(runCommand, ["show", "01NOPE", "--project", "res-show"]), /no run '01NOPE'/u);
});

test("a harness that is not on PATH says how to fix it", async () => {
  const { launchHeadless } = await import("../src/surface/headless.ts");
  const result = await launchHeadless({ bin: "claude-not-installed-here", argv: [], cwd: tmpdir(), env: {}, timeoutMs: 5_000 });
  assert.equal(result.spawnError, "claude-not-installed-here is not on PATH: install claude-not-installed-here or set the profile's command");
  const { spawnFailure } = await import("../src/surface/headless.ts");
  assert.match(spawnFailure("/usr/bin/claude", new Error("spawn /usr/bin/claude ENOENT")), /^claude is not on PATH: install Claude Code or set the profile's command$/u);
});

// --- run follow-up (0.47.0) ---------------------------------------------------------------

// A suite run inside a darius run must not see its own run: follow-up refuses there.
delete process.env.DARIUS_RUN;
delete process.env.DARIUS_RUN_POLICY;

const FOLLOW_UP_RESULT = {
  v: 1,
  status: "attention",
  summary: "one push waits",
  items: [{ title: "Branch not pushed", severity: "medium", state: "needs-decision", target: "main" }],
  actions: [{ text: "Checked the branch", state: "done" }],
  questions: [
    { text: "Push main now?", recommendation: "Yes.", commands: ["git push origin main"] },
    { text: "Delete the old branch?" },
  ],
};

/** A linked act ritual with a complete run whose result asks two questions; the first lists a hold-listed command. */
async function seedParent(project: string, opts: { marker?: string; mode?: Policy["mode"]; link?: boolean } = {}): Promise<string> {
  if (opts.link !== false) linkedCheckout(project, opts.marker ?? "");
  seedRitual(project, { policy: { ...HEARTBEAT_POLICY, mode: opts.mode ?? "act" } });
  const run: string = JSON.parse((await runCli(runCommand, ["start", "heartbeat", "--project", project, "--json"])).stdout).run;
  const findings = `# Check\n\n\`\`\`darius-result\n${JSON.stringify(FOLLOW_UP_RESULT)}\n\`\`\`\n`;
  const done = await runCli(runCommand, ["complete", run, "--project", project, "--outcome", "complete", "--findings-stdin"], findings);
  assert.equal(done.code, 0, done.stdout);
  return run;
}

function followUp(parent: string, project: string, extra: string[]): Promise<CliRun> {
  return runCli(runCommand, ["follow-up", parent, "--project", project, "--json", ...extra]);
}

test("run follow-up starts a new attended run of the ritual that may run the approved lines; the parent is acknowledged and linked", async () => {
  const project = "fu-happy";
  const marker = 'v = 2\n[profiles.fu]\nmodel = "opus"\npermissions = "skip"\n[defaults]\nfollow_up = "fu"\n';
  const parent = await seedParent(project, { marker });
  process.env.FAKE_CLAUDE_MODE = "complete";
  const result = await withFakeHerdr({}, () => followUp(parent, project, ["--approve", "1", "--grant", "date", "--note", "push it"]));
  assert.equal(result.code, 0, result.stdout + result.stderr);
  const entry: ProfiledEntry | undefined = JSON.parse(result.stdout).projects[0].rituals[0];
  assert.equal(entry?.action, "started");
  assert.equal(entry?.end, "complete");
  assert.equal(entry?.surface, "herdr", "attended: a herdr tab");
  assert.equal(entry?.profile, "fu", "[defaults] follow_up of the checkout");
  const child = entry?.run ?? "";
  assert.notEqual(child, parent, "a new run, not the parent");
  assert.ok(herdrCalls().some((line) => line.startsWith("tab create")));

  const started = linesOf(project, "run.started").find((line) => line.run === child);
  assert.equal(started?.follow_up_of, parent);
  assert.deepEqual(started?.approved, [1]);
  assert.deepEqual(started?.grants, ["git push origin main", "date"]);
  const runDir = join(openProject(project).root, "runs", child);
  const policy = JSON.parse(readFileSync(join(runDir, "policy.json"), "utf8"));
  assert.deepEqual(policy.grants, ["git push origin main", "date"]);
  assert.equal(policy.follow_up_of, parent);
  assert.equal(policy.gate, "full");
  const prompt = readFileSync(join(runDir, "prompt.md"), "utf8");
  assert.match(prompt, new RegExp(`## Follow-up\n\nThis run follows up run ${parent}\\. Its summary: one push waits`, "u"));
  assert.match(prompt, /Approved question 1: Push main now\? Recommended: Yes\.\nOperator note: push it/u);
  assert.match(prompt, /```bash\ngit push origin main\ndate\n```/u);
  assert.match(prompt, /- medium needs-decision: Branch not pushed \[main\]/u);
  assert.match(prompt, /- done: Checked the branch/u);
  assert.match(prompt, /Run the granted lines as written, then verify each result\. Anything else holds as usual\./u);
  assert.ok(prompt.indexOf("## Follow-up") < prompt.indexOf("## Protocol"));

  const acks = linesOf(project, "run.acknowledged");
  assert.equal(acks.length, 1);
  assert.equal(acks[0]?.run, parent);
  assert.equal(acks[0]?.note, `follow-up ${child}, approved 1`);

  const checkout = join(SANDBOX, `${project}-checkout`);
  assert.equal(policy.cwd, checkout, "the run's dir, for the grants");
  assert.equal(started?.policy_sha, sha256Hex(readFileSync(join(runDir, "policy.json"), "utf8")), "run.started records the policy's sha256");
  // A `_sha` key names a blob, and sync pushes every blob a line names: the policy must be in the store.
  assert.equal(getBlobText(openProject(project), String(started?.policy_sha)), readFileSync(join(runDir, "policy.json"), "utf8"), "the policy is a blob in the store");
  assert.match(prompt, /Do not cd: a granted line names its dir with a flag\./u);
  const granted = await runCli(policyCheckCommand, ["--policy", join(runDir, "policy.json")], bashHook("git push  origin main", checkout));
  assert.deepEqual([granted.code, granted.stdout], [0, ""], "the granted line passes the hold list");
  const chained = await runCli(policyCheckCommand, ["--policy", join(runDir, "policy.json")], bashHook("git push origin main; date", checkout));
  assert.equal(chained.code, 2, "a chain is decided as before");

  const listed = (await runCli(runCommand, ["list", "--project", project])).stdout.split("\n");
  assert.match(listed.find((line) => line.startsWith(parent)) ?? "", new RegExp(`followed up by ${child.slice(-6).toLowerCase()}$`, "u"));
  assert.match(listed.find((line) => line.startsWith(child)) ?? "", new RegExp(`follow-up of ${parent.slice(-6).toLowerCase()}$`, "u"));
  const shown = await runCli(runCommand, ["show", child, "--project", project]);
  assert.match(shown.stdout.split("\n")[0] ?? "", new RegExp(`follow-up of ${parent}$`, "u"));
  const json = JSON.parse((await runCli(runCommand, ["show", parent, "--project", project, "--json"])).stdout);
  assert.deepEqual(json.followUps, [child]);
  assert.match((await runCli(runCommand, ["show", parent, "--project", project])).stdout, /question 1: Push main now\? \(recommended: Yes\.\)\n {4}run: git push origin main\n/u);

  const again = await withFakeHerdr({}, () => followUp(parent, project, ["--approve", "1", "--headless"]));
  assert.equal(again.code, 0, "a closed follow-up may be followed again");
  assert.equal(JSON.parse(again.stdout).projects[0].rituals[0].surface, "headless", "--headless runs without a tab");
  assert.equal(linesOf(project, "run.acknowledged").length, 1, "the parent is acknowledged once");
});

test("a follow-up leaves failed-today and the handoff to the scheduled runs (0.47.1)", async () => {
  const project = "fu-due";
  const parent = await seedParent(project);
  const store = (): ReturnType<typeof openProject> => openProject(project);
  const slug = { slug: "heartbeat", today: localToday() };
  process.env.FAKE_CLAUDE_MODE = "silent";
  const failed = await withFakeHerdr({}, () => followUp(parent, project, ["--approve", "1", "--headless"]));
  const failedRun: string = JSON.parse(failed.stdout).projects[0].rituals[0].run;
  assert.equal(completedLine(project, failedRun)?.outcome, "failed");
  assert.equal(failedTodayRun(readLedger(store()), slug), undefined, "a failed follow-up does not stop the timer's run");

  process.env.FAKE_CLAUDE_MODE = "complete";
  process.env.FAKE_CLAUDE_RESULT = JSON.stringify({ v: 1, status: "ok", summary: "pushed", handoff: "The follow-up note." });
  try {
    const done = await withFakeHerdr({}, () => followUp(parent, project, ["--approve", "1", "--headless"]));
    const child: string = JSON.parse(done.stdout).projects[0].rituals[0].run;
    assert.equal(completedLine(project, child)?.handoff, "The follow-up note.");
    assert.equal(latestHandoff(store(), readLedger(store()), "heartbeat")?.run, parent, "the handoff stays the parent's");
    delete process.env.FAKE_CLAUDE_RESULT;
    const next: string = JSON.parse((await runCli(runCommand, ["now", "heartbeat", "--project", project, "--json"])).stdout).projects[0].rituals[0].run;
    const prompt = readFileSync(join(store().root, "runs", next, "prompt.md"), "utf8");
    assert.match(prompt, new RegExp(`The previous run of this ritual \\(run ${parent}, completed `, "u"));
    assert.doesNotMatch(prompt, /The follow-up note\./u);
  } finally {
    delete process.env.FAKE_CLAUDE_RESULT;
  }
  appendLine(store(), { who: "test", type: "run.started", item: "ritual/heartbeat", run: "01SCHEDULEDFAIL" });
  appendLine(store(), { who: "test", type: "run.completed", item: "ritual/heartbeat", run: "01SCHEDULEDFAIL", outcome: "failed" });
  assert.equal(failedTodayRun(readLedger(store()), slug), "01SCHEDULEDFAIL", "a scheduled run that failed still counts");
});

test("run follow-up --dry-run prints the grants and the tab it would open, and writes nothing", async () => {
  const project = "fu-dry";
  const parent = await seedParent(project);
  const before = readLedger(openProject(project)).length;
  const runsDir = join(openProject(project).root, "runs");
  const result = await withFakeHerdr({}, () => runCli(runCommand, ["follow-up", parent, "--project", project, "--approve", "1", "--dry-run"]));
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.match(result.stdout, new RegExp(`follow-up of run ${parent}, 1 granted line\\(s\\):\n {2}git push origin main`, "u"));
  assert.match(result.stdout, new RegExp(`heartbeat: follow-up of ${parent}, would start with claude, built-in profile, herdr, a herdr tab in workspace darius-runs, cwd ${join(SANDBOX, `${project}-checkout`)} \\(dry run\\)`, "u"));
  assert.equal(readLedger(openProject(project)).length, before);
  assert.equal(existsSync(runsDir), false, "no run dir");
  assert.deepEqual(herdrCalls().filter((line) => !line.startsWith("status")), [], "no tab");
});

/** Why a follow-up of `run` cannot start here; fails the test when it can. */
async function notReady(project: string, run: string): Promise<string> {
  const answer = await followUpReadiness(project, run);
  assert.equal(answer.ready, false, JSON.stringify(answer));
  return answer.ready ? "" : answer.reason;
}

test("follow-up readiness for the web button: ready with the approvable questions, else the reason, and it writes nothing (0.48.0)", async () => {
  const parent = await seedParent("fu-ready");
  const before = readLedger(openProject("fu-ready")).length;
  const ready = await withFakeHerdr({}, () => followUpReadiness("fu-ready", parent));
  assert.deepEqual(ready, { ready: true, host: hostId(), profile: "built-in", questions: [{ n: 1, commands: ["git push origin main"] }] });
  assert.equal(readLedger(openProject("fu-ready")).length, before, "no ledger line");
  assert.equal(existsSync(join(openProject("fu-ready").root, "runs")), false, "no run dir");
  assert.deepEqual(herdrCalls().filter((line) => !line.startsWith("status")), [], "no tab");

  assert.match(await notReady("fu-ready", parent), /^no herdr on \S+: a follow-up opens a herdr tab/u);
  await addProfile("fu-ready-gated", ["--permissions", "gated"]);
  const gated = await seedParent("fu-ready-gated", { marker: 'v = 2\n[defaults]\nfollow_up = "fu-ready-gated"\n' });
  assert.match(await notReady("fu-ready-gated", gated), /^gated profile: profile fu-ready-gated has permissions gated/u);
  const report = await seedParent("fu-ready-report", { mode: "report" });
  assert.match(await notReady("fu-ready-report", report), /^not-followable: ritual heartbeat is in mode report/u);
  const unlinked = await seedParent("fu-ready-unlinked", { link: false });
  assert.match(await withFakeHerdr({}, () => notReady("fu-ready-unlinked", unlinked)), /^no-workdir: a follow-up runs in a checkout/u);
  assert.match(await notReady("fu-ready", "01NOPE"), /^no run 01NOPE in fu-ready/u);
  assert.match(await notReady("fu-nope", parent), /^no project fu-nope/u);
  const elsewhere = await seedParent("fu-ready-elsewhere");
  assert.equal((await runCli(ritualCommand, ["set", "heartbeat", "--project", "fu-ready-elsewhere", "--host", "host-b"])).code, 0);
  const command = `ssh host-b darius run follow-up ${elsewhere} --approve 1 --project fu-ready-elsewhere`;
  assert.deepEqual(await followUpReadiness("fu-ready-elsewhere", elsewhere), {
    ready: false,
    host: hostId(),
    reason: `runs on host-b; open this page on host-b, or: ${command}`,
    rightHost: "host-b",
    command,
  });
  const open = JSON.parse((await runCli(runCommand, ["start", "heartbeat", "--project", "fu-ready", "--json"])).stdout).run;
  assert.match(await notReady("fu-ready", open), /no question of this run lists commands; grant lines by hand: darius run follow-up \S+ --grant LINE/u);
  assert.match(await withFakeHerdr({}, () => notReady("fu-ready", parent)), new RegExp(`^run ${open.slice(-6).toLowerCase()} of heartbeat is running; a follow-up starts when no run is open$`, "u"));
});

/** One bare ledger line, for the pure checks of planFollowUp. */
function bareLine(type: string, run: string, item = "ritual/heartbeat", extra: Record<string, string> = {}): LedgerLine {
  return { v: 1, id: `${type}-${run}`, at: "2026-10-01T08:00:00Z", host: "host-a", who: "test", project: "p", type, item, run, ...extra };
}

test("a follow-up waits while any run of the project is running; a held run does not stop it (0.48.0)", () => {
  const parent = "01PARENTRUN000000000000000";
  const other = "01OTHERRUN0000000000ABCDEF";
  const result: RunResult = { v: 1, status: "attention", summary: "s", metrics: [], items: [], actions: [], questions: [{ text: "Push?", commands: ["git push origin main"] }] };
  const base = [bareLine("run.started", parent), bareLine("run.completed", parent, "ritual/heartbeat", { outcome: "complete" })];
  const request = { parent, approve: [1], grant: [] };
  const granted = { grants: ["git push origin main"] };
  assert.deepEqual(planFollowUp(base, result, request), granted);
  const running = [...base, bareLine("run.started", other, "ritual/sweep")];
  assert.deepEqual(planFollowUp(running, result, request), { refused: "run abcdef of sweep is running; a follow-up starts when no run is open" });
  const held = [...running, bareLine("run.held", other, "ritual/sweep")];
  assert.deepEqual(planFollowUp(held, result, request), granted, "a held run is fine");
  assert.ok("refused" in planFollowUp([...held, bareLine("run.resumed", other, "ritual/sweep")], result, request), "a resumed run runs again");
  assert.deepEqual(planFollowUp([...held, bareLine("run.completed", other, "ritual/sweep")], result, request), granted, "a closed run is fine");
  const vigil = [...base, bareLine("run.started", "01VIGILRUN0000000000VVVVVV", "vigil/soak")];
  assert.deepEqual(planFollowUp(vigil, result, request), { refused: "run vvvvvv of vigil/soak is running; a follow-up starts when no run is open" });
});

test("the run page data links a follow-up and its parent (0.48.0)", async () => {
  const project = "fu-links";
  const parent = await seedParent(project);
  process.env.FAKE_CLAUDE_MODE = "complete";
  const result = await withFakeHerdr({}, () => followUp(parent, project, ["--approve", "1", "--headless"]));
  const child: string = JSON.parse(result.stdout).projects[0].rituals[0].run;
  assert.deepEqual([runDetail(project, parent)?.followUpOf, runDetail(project, parent)?.followUps], [null, [child]]);
  assert.deepEqual([runDetail(project, child)?.followUpOf, runDetail(project, child)?.followUps], [parent, []]);
});

test("run follow-up refuses what it cannot run, each with one line, and starts nothing", async () => {
  process.env.FAKE_CLAUDE_MODE = "complete";
  const usage = async (project: string, parent: string, extra: string[], reason: RegExp): Promise<void> => {
    await assert.rejects(withFakeHerdr({}, () => followUp(parent, project, extra)), reason);
  };
  const refused = async (project: string, parent: string, extra: string[], reason: RegExp): Promise<void> => {
    const started = linesOf(project, "run.started").length;
    const result = await withFakeHerdr({}, () => followUp(parent, project, extra));
    assert.equal(result.code, 1, result.stdout);
    assert.match(`${result.stdout}\n${result.stderr}`, reason);
    assert.equal(linesOf(project, "run.started").length, started, "no run started");
  };

  const parent = await seedParent("fu-refuse");
  await usage("fu-refuse", parent, ["--approve", "2"], /question 2 lists no commands; use --grant/u);
  await usage("fu-refuse", parent, ["--approve", "3"], /has 2 question\(s\) in its result; there is no question 3/u);
  await usage("fu-refuse", parent, ["--approve", "x"], /--approve must name a question by its number/u);
  await usage("fu-refuse", parent, ["--grant", "cd tools && pnpm cli x"], /--grant "cd tools && pnpm cli x" is not one plain command: more than one command/u);
  await usage("fu-refuse", parent, ["--grant", "echo $(id)"], /not one plain command/u);
  await usage("fu-refuse", parent, [], /nothing to grant: pass --approve N or --grant LINE\. A follow-up with nothing granted is run now with a note: darius run ack \S+ --note TEXT, then darius run now heartbeat/u);
  await usage("fu-refuse", "01NOPE", ["--grant", "date"], /no run '01NOPE'/u);

  const open = JSON.parse((await runCli(runCommand, ["start", "heartbeat", "--project", "fu-refuse", "--json"])).stdout).run;
  await refused("fu-refuse", open, ["--grant", "date"], /is running; a follow-up needs a closed run/u);
  await refused("fu-refuse", parent, ["--grant", "date"], /run \w{6} of heartbeat is running; a follow-up starts when no run is open/u);
  await runCli(runCommand, ["complete", open, "--project", "fu-refuse", "--outcome", "failed"]);
  await refused("fu-refuse", open, ["--grant", "date"], /ended failed; a follow-up needs a complete run/u);

  appendLine(openProject("fu-refuse"), { who: "test", type: "run.started", item: "ritual/heartbeat", run: "01OPENFOLLOWUP", follow_up_of: parent });
  await refused("fu-refuse", parent, ["--grant", "date"], /follow-up 01OPENFOLLOWUP of run '\S+' is still open; finish it first/u);

  const report = await seedParent("fu-report", { mode: "report" });
  await refused("fu-report", report, ["--approve", "1"], /not-followable: ritual heartbeat is in mode report; set --mode act, or run the lines by hand/u);

  const capped = await seedParent("fu-capped", { marker: 'max_mode = "report"\n' });
  await refused("fu-capped", capped, ["--approve", "1"], /policy-capped: mode act is above max_mode = "report"/u);

  const unlinked = await seedParent("fu-unlinked", { link: false });
  await refused("fu-unlinked", unlinked, ["--approve", "1"], /no-workdir: a follow-up runs in a checkout of fu-unlinked, and none is linked on this host/u);

  const pinned = await seedParent("fu-pinned");
  assert.equal((await runCli(ritualCommand, ["set", "heartbeat", "--project", "fu-pinned", "--host", "host-b"])).code, 0);
  await refused("fu-pinned", pinned, ["--approve", "1"], /"host":"host-b","why":"pinned","command":"ssh host-b darius run follow-up \S+ --project fu-pinned --json --approve 1"/u);

  await addProfile("fu-gated", ["--permissions", "gated"]);
  const gated = await seedParent("fu-gated", { marker: 'v = 2\n[defaults]\nfollow_up = "fu-gated"\n' });
  await refused("fu-gated", gated, ["--approve", "1"], /not-followable: profile fu-gated has permissions gated, .*name a profile with permissions = "skip" in \[defaults\] follow_up of \.darius\.toml/u);

  const noHerdr = await seedParent("fu-no-herdr");
  const started = linesOf("fu-no-herdr", "run.started").length;
  const down = await followUp(noHerdr, "fu-no-herdr", ["--approve", "1"]);
  assert.equal(down.code, 1);
  assert.match(down.stderr, /not-followable: a follow-up opens a herdr tab, and .*; start herdr, or pass --headless/u);
  assert.equal(linesOf("fu-no-herdr", "run.started").length, started);

  process.env.DARIUS_RUN = "01INSIDE";
  try {
    await refused("fu-refuse", parent, ["--approve", "1"], /run follow-up is for a person; a run darius started cannot start one/u);
  } finally {
    delete process.env.DARIUS_RUN;
  }

  appendLine(openProject("fu-vigil", { create: true }), { who: "test", type: "run.started", item: "vigil/soak", run: "01VIGILRUN" });
  await usage("fu-vigil", "01VIGILRUN", ["--grant", "date"], /belongs to vigil\/soak; only a ritual run has follow-ups/u);
});
