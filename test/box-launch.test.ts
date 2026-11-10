/**
 * Every launch path goes through the box (src/runner/box-launch.ts, 0.120.0):
 * run-due headless, `run now`, `run resume`, a follow-up, a herdr tab, the
 * gate check per harness version, and the gate preflight of each. A fake
 * bwrap records each call, checks the box dir, skips `darius box enter`, and
 * runs the harness with the broker socket set, so `run complete` goes through
 * the broker. After each launch the box dir, with the proxy and broker
 * sockets, is gone, also on a throw and a timeout. Each fail-closed reason
 * skips the ritual as `box-broken` and starts no harness.
 *
 * Everything lives in a throwaway tree: HOME, the store, the config dir and
 * XDG_RUNTIME_DIR. No real bwrap, herdr, tailnet or harness is reached here;
 * test/box-real.test.ts proves the box on the real bwrap.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createServer } from "node:net";
import { join } from "node:path";

import { parseArgs } from "../src/cli/args.ts";
import { harnessCommand } from "../src/cli/harness.ts";
import { ritualCommand } from "../src/cli/ritual.ts";
import type { Command } from "../src/cli/registry.ts";
import { runCommand } from "../src/cli/run.ts";
import { runDueCommand } from "../src/cli/run-due.ts";
import { appendLine, hostId, readLedger } from "../src/core/ledger.ts";
import { ledgerAlerts } from "../src/core/alerts.ts";
import { writeLink } from "../src/core/links.ts";
import type { LedgerLine, Policy, Ritual } from "../src/core/model.ts";
import { openProject } from "../src/core/store.ts";
import { ulid } from "../src/core/ulid.ts";
import { claudeHarness } from "../src/harness/claude.ts";
import { clearStaleBox, webPorts, withRunSandbox, type PlantOwner, type SandboxRequest } from "../src/runner/box-launch.ts";
import { boxCommand } from "../src/cli/box.ts";
import { addTaint, clearTaint, readTaints } from "../src/core/box-taint.ts";
import { lockDir, pendingDir, selfProc, takeLock, writePending } from "../src/core/box-pending.ts";
import { scanWork, type PlantCheck } from "../src/core/box-work.ts";
import { runDue } from "../src/runner/run-due.ts";
import { maskLine, TAB_TERM } from "../src/surface/herdr.ts";
import { boxStack } from "../src/runner/box-check.ts";
import { VERSION } from "../src/version.ts";

// Short: the box dir's sockets live under the runtime dir, and a Unix socket path has at most 108 bytes.
const SANDBOX = mkdtempSync(join(tmpdir(), "dbl-"));
const HOME = join(SANDBOX, "h");
const RUNTIME = join(SANDBOX, "rt");
const BIN = join(SANDBOX, "bin");
const LOGS = join(SANDBOX, "logs");
for (const dir of [HOME, RUNTIME, BIN, LOGS]) mkdirSync(dir, { recursive: true, mode: 0o700 });
process.env.HOME = HOME;
process.env.XDG_RUNTIME_DIR = RUNTIME;
process.env.DARIUS_STATE_DIR = join(SANDBOX, "state");
process.env.DARIUS_CONFIG_DIR = join(SANDBOX, "config");
process.env.CLAUDE_CONFIG_DIR = join(SANDBOX, "claude");
process.env.DARIUS_HERDR = join(SANDBOX, "no-herdr");
process.env.DARIUS_TAILSCALE = join(SANDBOX, "no-tailscale");
process.env.DARIUS_RUN_SANDBOX = "box";
delete process.env.DARIUS_PROJECT;
delete process.env.DARIUS_RUN;
delete process.env.DARIUS_RUN_POLICY;
delete process.env.SSH_AUTH_SOCK;
mkdirSync(process.env.DARIUS_CONFIG_DIR, { recursive: true });

const REPO = join(import.meta.dirname, "..");
symlinkSync(join(REPO, "bin", "darius"), join(BIN, "darius"));

/** bash by full path. The Nix build sandbox has no /usr/bin/env for a shebang to use. */
const BASH =
  (process.env.PATH ?? "")
    .split(":")
    .map((dir) => join(dir, "bash"))
    .find((candidate) => candidate.startsWith("/") && existsSync(candidate)) ?? "/bin/bash";

function script(name: string, body: string): string {
  const file = join(BIN, name);
  writeFileSync(file, `#!${BASH}\n${body}`);
  chmodSync(file, 0o755);
  return file;
}

const BWRAP_LOG = join(LOGS, "bwrap");
/**
 * The fake bwrap. `--dev-bind / / true` is the probe. Otherwise it reads the
 * box dir from `--ro-bind <dir> /run/darius`, skips the flags; `true` alone is
 * the layout probe. It skips `darius box enter ... --`, writes one `launch`
 * line with whether both sockets are there, and runs the rest with the broker
 * socket set. FAKE_BWRAP_FAIL=probe|layout makes that step fail.
 */
const FAKE_BWRAP = script(
  "fake-bwrap",
  `[ "\${1:-}" = --version ] && { echo "bubblewrap 0.0.0-fake"; exit 0; }
printf 'call %s\\n' "$*" >> "${BWRAP_LOG}"
if [ "\${1:-}" = --dev-bind ]; then
  [ "\${FAKE_BWRAP_FAIL:-}" = probe ] && { echo "bwrap: No permissions to create a new namespace" >&2; exit 1; }
  exit 0
fi
box=""
while [ $# -gt 0 ] && [ "$1" != -- ]; do
  if [ "$1" = --ro-bind ] && [ "\${3:-}" = /run/darius ]; then box="$2"; fi
  shift
done
[ $# -gt 0 ] && shift
if [ "$*" = true ]; then
  [ "\${FAKE_BWRAP_FAIL:-}" = layout ] && { echo "bwrap: Can't find source path /nowhere: No such file or directory" >&2; exit 1; }
  exit 0
fi
if [ "\${2:-}" = box ] && [ "\${3:-}" = enter ]; then
  [ -e "$box/box.json" ] || { echo "fake bwrap: no box marker in $box" >&2; exit 1; }
  while [ $# -gt 0 ] && [ "$1" != -- ]; do shift; done
  shift
fi
p=no; b=no
[ -S "$box/proxy.sock" ] && p=yes
[ -S "$box/broker.sock" ] && b=yes
printf 'launch box=%s proxy=%s broker=%s %s\\n' "$box" "$p" "$b" "$*" >> "${BWRAP_LOG}"
export DARIUS_BOX_BROKER="$box/broker.sock"
exec "$@"
`,
);

const CLAUDE_LOG = join(LOGS, "claude");
mkdirSync(CLAUDE_LOG);
/** The fake harness: `complete` and `hold` call darius as a run does, `sleep` ignores SIGTERM. The gate check (project _global) obeys the gate. */
const FAKE_CLAUDE = script(
  "fake-claude",
  `set -euo pipefail
if [ "\${1:-}" = --version ]; then printf '%s (Claude Code)\\n' "\${FAKE_CLAUDE_VERSION:-2.1.999}"; exit 0; fi
printf '%s\\n' "$PWD" > "${CLAUDE_LOG}/\${DARIUS_RUN:-no-run}"
if [ "$DARIUS_PROJECT" = _global ]; then
  main="$(printf '%s' "\${2:-}" | grep -o 'touch [^ ]*' | sed -n 1p | cut -d' ' -f2)"
  if printf '{"tool_name":"Bash","tool_input":{"command":"touch %s"},"session_id":"fake-check"}' "$main" | darius policy-check --policy "$DARIUS_RUN_POLICY" >/dev/null; then touch "$main"; fi
  printf '{"type":"result","is_error":false,"session_id":"fake-check","total_cost_usd":0.0004,"result":"checked"}\\n'
  exit 0
fi
case "\${FAKE_CLAUDE_MODE:-complete}" in
  complete)
    printf 'box ok\\n\`\`\`darius-result\\n{"v":1,"status":"ok","summary":"box ok"}\\n\`\`\`\\n' \\
      | darius run complete "$DARIUS_RUN" --project "$DARIUS_PROJECT" --outcome complete --findings-stdin >/dev/null ;;
  hold) darius run hold "$DARIUS_RUN" --project "$DARIUS_PROJECT" --question "may I push?" >/dev/null ;;
  sleep) trap '' TERM; sleep 29.3 ;;
  plant-too-long)
    # A .git whose path is 4080 bytes: the check finds it, and its rename to a longer name fails (ENAMETOOLONG).
    p=""; while [ $(( \${#PWD} + \${#p} )) -lt 3900 ]; do p="$p/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"; done
    n=$(( 4080 - 5 - 1 - \${#PWD} - \${#p} )); last=""; while [ \${#last} -lt "$n" ]; do last="\${last}b"; done
    mkdir -p "$PWD$p/$last/.git" && printf '%s\\n' "$PWD$p/$last/.git" > long-plant
    printf 'planted\\n\`\`\`darius-result\\n{"v":1,"status":"ok","summary":"planted"}\\n\`\`\`\\n' \\
      | darius run complete "$DARIUS_RUN" --project "$DARIUS_PROJECT" --outcome complete --findings-stdin >/dev/null ;;
  plant)
    mkdir -p sub/.git && printf '[core]\\n\\tfsmonitor = "touch /tmp/pwned"\\n' > sub/.git/config
    printf 'planted\\n\`\`\`darius-result\\n{"v":1,"status":"ok","summary":"planted"}\\n\`\`\`\\n' \\
      | darius run complete "$DARIUS_RUN" --project "$DARIUS_PROJECT" --outcome complete --findings-stdin >/dev/null ;;
esac
printf '{"type":"result","is_error":false,"session_id":"fake-session","total_cost_usd":0.001,"result":"done"}\\n'
`,
);

const HERDR_DIR = join(LOGS, "herdr");
mkdirSync(HERDR_DIR);
/** A fake herdr: enough of the CLI for a tab. `agent prompt` runs the fake harness with the tab's env. */
const FAKE_HERDR = script(
  "fake-herdr",
  `set -euo pipefail
dir="${HERDR_DIR}"
printf '%s\\n' "$*" >> "$dir/calls"
case "$1 \${2:-}" in
  "status "*) printf 'server:\\n  status: running\\n' ;;
  "workspace list") printf '{"result":{"type":"workspace_list","workspaces":[]}}\\n' ;;
  "workspace create") printf '{"result":{"workspace":{"workspace_id":"w9"},"tab":{"tab_id":"w9:t1"},"root_pane":{"pane_id":"w9:p1"}}}\\n' ;;
  "tab create")
    : > "$dir/tab.env"
    while [ $# -gt 0 ]; do
      if [ "$1" = "--env" ]; then printf 'export %q\\n' "$2" >> "$dir/tab.env"; shift; fi
      shift
    done
    n=$(( $(cat "$dir/tab-count" 2>/dev/null || echo 1) + 1 )); echo "$n" > "$dir/tab-count"
    printf '{"result":{"tab":{"tab_id":"w9:t%s"},"root_pane":{"pane_id":"w9:p%s"}}}\\n' "$n" "$n" ;;
  "agent start") printf '{"result":{"type":"agent_started"}}\\n' ;;
  "agent prompt")
    ( set +u; . "$dir/tab.env"; "${FAKE_CLAUDE}" -p >/dev/null 2>&1 ) &
    printf '{"result":{"type":"agent_prompted"}}\\n' ;;
  "agent get") printf '{"result":{"agent":{"agent_status":"working"}}}\\n' ;;
  "tab close") printf '{"result":{"type":"ok"}}\\n' ;;
  "pane run") printf '{"result":{"type":"ok"}}\\n' ;;
  "pane wait-output")
    if [ -e "$dir/alias-lost" ]; then printf '{"error":{"code":"timeout","message":"no match"}}\\n' >&2; exit 1; fi
    printf '{"result":{"type":"ok"}}\\n' ;;
  "pane process-info")
    names="$(cat "$dir/foreground" 2>/dev/null || echo bwrap)"
    printf '{"result":{"process_info":{"foreground_processes":[{"name":"%s","pid":1}]}}}\\n' "$names" ;;
  *) printf '{"error":{"code":"unknown","message":"fake herdr: %s"}}\\n' "$*" >&2; exit 1 ;;
esac
`,
);

process.env.DARIUS_BWRAP = FAKE_BWRAP;
process.env.DARIUS_CLAUDE = FAKE_CLAUDE;
// A herdr launch reads the tiocsti knob each time: a stand-in at 0, so these tests do not hang on the host's.
const TIOCSTI = join(SANDBOX, "legacy_tiocsti");
writeFileSync(TIOCSTI, "0\n");
process.env.DARIUS_TIOCSTI = TIOCSTI;
process.env.PATH = `${BIN}:${process.env.PATH ?? ""}`;
// The fake's default version passed its gate check, and this darius version its box check, so a run starts at once.
appendLine(openProject("_global", { create: true }), { who: "test", type: "harness.checked", harness: "claude", version: "2.1.999", outcome: "passed" });
appendLine(openProject("_global"), { who: "test", type: "box.checked", darius: VERSION, ...boxStack(), outcome: "pass", failed: [], skipped: [] });

const REPORT_POLICY: Policy = { mode: "report", may: ["Bash(darius *)", "Bash(date)"], hold: ["git push"] };
const ACT_POLICY: Policy = { ...REPORT_POLICY, mode: "act" };

function seedRitual(project: string, policy: Policy = REPORT_POLICY): string {
  const now = new Date().toISOString();
  const header: Ritual = { id: ulid(), kind: "ritual", slug: "heartbeat", title: "Heartbeat", created: now, updated: now, tags: [], cadence: "1d", anchor: "due", policy };
  openProject(project, { create: true }).writeItem({ header, body: "Run `date`, then complete the run.\n" }, { who: "test" });
  return "heartbeat";
}

/** A checkout of `project`, linked on this host. */
function linkedCheckout(project: string, marker = ""): string {
  const dir = join(SANDBOX, `${project}-co`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, ".darius.toml"), `project = "${project}"\n${marker}`);
  writeLink(project, dir);
  return dir;
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

interface Entry {
  slug: string;
  action: string;
  reason?: string;
  detail?: string;
  run?: string;
  end?: string;
  timedOut?: boolean;
  surface?: string;
}

function entryOf(stdout: string): Entry | undefined {
  // SAFETY: run-due --json prints the batch report.
  const report = JSON.parse(stdout) as { projects: { rituals: Entry[] }[] };
  return report.projects[0]?.rituals[0];
}

async function runDueJson(project: string, extra: string[] = []): Promise<{ code: number; entry: Entry | undefined; stdout: string }> {
  const result = await runCli(runDueCommand, ["--unattended", "--json", "--project", project, ...extra]);
  return { code: result.code, entry: entryOf(result.stdout), stdout: result.stdout };
}

function bwrapLines(): string[] {
  return existsSync(BWRAP_LOG) ? readFileSync(BWRAP_LOG, "utf8").trim().split("\n") : [];
}

/** The launch lines since the log was cleared. */
function launches(): { box: string; proxy: boolean; broker: boolean; command: string }[] {
  return bwrapLines().flatMap((line) => {
    const match = /^launch box=(\S*) proxy=(yes|no) broker=(yes|no) (.*)$/u.exec(line);
    return match === null ? [] : [{ box: match[1] ?? "", proxy: match[2] === "yes", broker: match[3] === "yes", command: match[4] ?? "" }];
  });
}

/** The full bwrap argv of the call that ran `fragment`. */
function callWith(fragment: string): string {
  return bwrapLines().find((line) => line.startsWith("call ") && line.includes(fragment)) ?? "";
}

function linesOf(project: string, type: string): LedgerLine[] {
  return readLedger(openProject(project)).filter((line) => line.type === type);
}

function boxDirs(runtime = RUNTIME): string[] {
  const dir = join(runtime, "darius-box");
  return existsSync(dir) ? readdirSync(dir) : [];
}

function fresh(): void {
  rmSync(BWRAP_LOG, { force: true });
}

/** Each launch went through bwrap and `box enter` with both sockets up, and the box is gone now. */
function assertBoxedAndClosed(): void {
  const seen = launches();
  assert.ok(seen.length > 0, bwrapLines().join("\n"));
  for (const launch of seen) {
    assert.ok(launch.proxy && launch.broker, `the proxy and the broker listen during the launch: ${JSON.stringify(launch)}`);
    assert.equal(existsSync(launch.box), false, `the box dir ${launch.box} is removed, with both sockets`);
    assert.equal(existsSync(join(launch.box, "proxy.sock")), false);
    assert.equal(existsSync(join(launch.box, "broker.sock")), false);
  }
  assert.ok(bwrapLines().every((line) => !line.startsWith("call ") || line.startsWith("call --dev-bind") || line.includes(" box enter ") || line.endsWith(" -- true")), "every launch is box enter");
  assert.deepEqual(boxDirs(), [], "no box dir is left");
}

// --- every path goes through the box ---------------------------------------------------

test("run-due headless: the preflight and the harness run in the box with both sockets up, run complete goes through the broker, and the box is gone after", async () => {
  fresh();
  const project = "bx-headless";
  seedRitual(project);
  process.env.FAKE_CLAUDE_MODE = "complete";
  const { code, entry, stdout } = await runDueJson(project);
  assert.equal(code, 0, stdout);
  assert.equal(entry?.action, "started", stdout);
  assert.equal(entry?.end, "complete");
  const run = entry?.run ?? "";
  const seen = launches();
  assert.ok(seen.some((launch) => launch.command.includes("policy-check") && launch.command.endsWith("--preflight")), "the preflight runs in the box");
  assert.ok(seen.some((launch) => launch.command.startsWith(`${FAKE_CLAUDE} -p `)), "the harness runs in the box");
  assertBoxedAndClosed();
  const runDir = join(openProject(project).root, "runs", run);
  const broker = readFileSync(join(runDir, "broker.jsonl"), "utf8");
  assert.match(broker, /"argv":\["run","complete"/u, "run complete went through the broker");
  assert.equal(linesOf(project, "run.completed")[0]?.who, `claude:${run}`, "the broker names the run as who");
  const call = callWith(`${FAKE_CLAUDE} -p`);
  assert.ok(call.includes(" --new-session "), "headless: a new session");
  assert.ok(call.includes(" --unshare-net "));
  // No checkout: the run works in its store dir, which the box shows read-only.
  assert.ok(call.includes(` --ro-bind ${openProject(project).root} ${openProject(project).root} `), call);
  assert.equal(existsSync(join(runDir, "run.log")), false, "a boxed run has nothing to say");
});

test("report mode: the work dir is read-only in the box; act mode: writable", async () => {
  for (const [project, policy, flag] of [["bx-report", REPORT_POLICY, "--ro-bind"], ["bx-act", ACT_POLICY, "--bind"]] as const) {
    fresh();
    const dir = linkedCheckout(project);
    seedRitual(project, policy);
    process.env.FAKE_CLAUDE_MODE = "complete";
    const { entry, stdout } = await runDueJson(project);
    assert.equal(entry?.end, "complete", stdout);
    assert.equal(readFileSync(join(CLAUDE_LOG, entry?.run ?? ""), "utf8").trim(), dir, "the harness runs in the checkout");
    assert.ok(callWith(`${FAKE_CLAUDE} -p`).includes(` ${flag} ${dir} ${dir} `), `${project}: ${flag} ${dir}`);
    assertBoxedAndClosed();
  }
});

test("run now and run resume go through the box; a hold through the broker holds the run", async () => {
  fresh();
  const project = "bx-now";
  const slug = seedRitual(project);
  process.env.FAKE_CLAUDE_MODE = "hold";
  const now = await runCli(runCommand, ["now", slug, "--project", project, "--json"]);
  assert.equal(entryOf(now.stdout)?.end, "held", now.stdout + now.stderr);
  const run = entryOf(now.stdout)?.run ?? "";
  assertBoxedAndClosed();
  assert.match(readFileSync(join(openProject(project).root, "runs", run, "broker.jsonl"), "utf8"), /"argv":\["run","hold"/u);
  assert.equal(linesOf(project, "run.held")[0]?.who, `claude:${run}`);

  fresh();
  const answered = await runCli(runCommand, ["answer", run, "1", "yes", "--project", project]);
  assert.equal(answered.code, 0, answered.stdout + answered.stderr);
  process.env.FAKE_CLAUDE_MODE = "complete";
  const resumed = await runCli(runCommand, ["resume", run, "--project", project, "--json"]);
  assert.equal(resumed.code, 0, resumed.stdout + resumed.stderr);
  assert.equal(entryOf(resumed.stdout)?.end, "complete", resumed.stdout);
  assert.ok(launches().some((launch) => launch.command.startsWith(`${FAKE_CLAUDE} -p `)), bwrapLines().join("\n"));
  assertBoxedAndClosed();
});

test("a follow-up goes through the box", async () => {
  const project = "bx-follow";
  linkedCheckout(project);
  const slug = seedRitual(project, ACT_POLICY);
  process.env.FAKE_CLAUDE_MODE = "complete";
  const first = await runDueJson(project);
  const parent = first.entry?.run ?? "";
  assert.equal(first.entry?.end, "complete", first.stdout);
  fresh();
  const { report } = await runDue({ projects: [project], only: slug, isDryRun: false, who: "test", timeoutMs: 60_000, followUp: { parent, approved: [], grants: ["date"], headless: true } });
  const entry = report.projects[0]?.rituals[0];
  assert.equal(entry?.action, "started", JSON.stringify(report));
  assert.equal(entry?.followUpOf, parent);
  assert.equal(entry?.end, "complete");
  assertBoxedAndClosed();
});

test("the gate check per harness version runs in the box, with its work dir writable, and records sandbox box", async () => {
  fresh();
  process.env.FAKE_CLAUDE_VERSION = "2.1.900";
  try {
    const result = await runCli(harnessCommand, ["check", "claude", "--json"]);
    assert.equal(result.code, 0, result.stdout + result.stderr);
    const check = readLedger(openProject("_global")).findLast((line) => line.type === "harness.checked" && line.version === "2.1.900");
    assert.equal(check?.outcome, "passed", JSON.stringify(check));
    assert.equal(check?.sandbox, "box");
    const call = callWith(`${FAKE_CLAUDE} -p`);
    assert.match(call, / --bind (\S*darius-harness-check-\S*) \1 /u, "the check's work dir is writable: the gate, not the mount, must stop the marker");
    assertBoxedAndClosed();
  } finally {
    delete process.env.FAKE_CLAUDE_VERSION;
  }
});

// --- herdr ------------------------------------------------------------------------------

async function withHerdr<T>(files: Record<string, string>, fn: () => Promise<T>): Promise<T> {
  rmSync(join(HERDR_DIR, "calls"), { force: true });
  for (const [name, text] of Object.entries(files)) writeFileSync(join(HERDR_DIR, name), text);
  process.env.DARIUS_HERDR = FAKE_HERDR;
  process.env.DARIUS_HERDR_POLL_MS = "50";
  try {
    return await fn();
  } finally {
    process.env.DARIUS_HERDR = join(SANDBOX, "no-herdr");
    delete process.env.DARIUS_HERDR_POLL_MS;
    for (const name of Object.keys(files)) rmSync(join(HERDR_DIR, name), { force: true });
  }
}

function herdrCalls(): string[] {
  return readFileSync(join(HERDR_DIR, "calls"), "utf8").trim().split("\n");
}

const HERDR_MARKER = 'v = 2\n[profiles.watch]\nsurface = "herdr"\n[defaults]\nritual = "watch"\n';

test("herdr: the tab's alias runs bwrap and box enter, without --new-session and with the tab's TERM; the box closes after the run", async () => {
  fresh();
  const project = "bx-herdr";
  linkedCheckout(project, HERDR_MARKER);
  seedRitual(project);
  process.env.FAKE_CLAUDE_MODE = "complete";
  const { entry, stdout } = await withHerdr({}, () => runDueJson(project));
  assert.equal(entry?.surface, "herdr", stdout);
  assert.equal(entry?.end, "complete", stdout);
  const typed = herdrCalls().find((line) => line.startsWith("pane run ") && line.includes("alias claude='")) ?? "";
  // The alias text as the tab's shell stores it.
  const alias = typed.replaceAll(String.raw`'\''`, "'");
  assert.ok(alias.includes(`'${FAKE_BWRAP}' '--ro-bind' '/' '/'`), alias);
  assert.ok(alias.includes(" 'box' 'enter' "), alias);
  assert.ok(alias.endsWith(" '--' 'claude''; echo darius-mask''-ready"), "herdr types the harness argv after the alias");
  assert.ok(alias.includes(`'--setenv' 'TERM' ${TAB_TERM} `), "the tab's shell fills in its own TERM");
  assert.equal(alias.includes("--new-session"), false, "the TUI keeps its terminal");
  assert.ok(alias.includes("'--unshare-net'"));
  assert.deepEqual(boxDirs(), [], "the box is closed after the run");
});

test("herdr: bwrap not in the foreground closes the tab and skips as box-broken; the run is failed", async () => {
  const project = "bx-herdr-fg";
  linkedCheckout(project, HERDR_MARKER);
  seedRitual(project);
  const { entry, stdout } = await withHerdr({ foreground: "claude" }, () => runDueJson(project));
  assert.equal(entry?.action, "skipped", stdout);
  assert.equal(entry?.reason, "box-broken");
  assert.match(entry?.detail ?? "", /herdr shows no bwrap in the tab's foreground/u);
  assert.ok(herdrCalls().some((line) => line.startsWith("tab close ")), "the tab is closed");
  assert.equal(herdrCalls().some((line) => line.startsWith("agent prompt ")), false, "the harness gets no prompt");
  assert.equal(linesOf(project, "run.completed")[0]?.outcome, "failed", "the run does not stay open");
  assert.match(readFileSync(join(openProject(project).root, "runs", entry?.run ?? "", "run.log"), "utf8"), /box: the herdr tab was closed, herdr shows no bwrap/u);
  assert.deepEqual(boxDirs(), []);
});

test("herdr: an alias the tab's shell does not take closes the tab before the agent starts, as box-broken", async () => {
  const project = "bx-herdr-alias";
  linkedCheckout(project, HERDR_MARKER);
  seedRitual(project);
  const { entry, stdout } = await withHerdr({ "alias-lost": "" }, () => runDueJson(project));
  assert.equal(entry?.reason, "box-broken", stdout);
  assert.match(entry?.detail ?? "", /did not take the box alias/u);
  assert.equal(herdrCalls().some((line) => line.startsWith("agent start ")), false, "no agent starts unboxed");
  assert.ok(herdrCalls().some((line) => line.startsWith("tab close ")));
  assert.deepEqual(boxDirs(), []);
});

test("herdr: a tiocsti knob that is not 0 at launch skips as box-broken, whatever the box check said", async () => {
  const project = "bx-herdr-tiocsti";
  linkedCheckout(project, HERDR_MARKER);
  seedRitual(project);
  writeFileSync(TIOCSTI, "1\n");
  try {
    const { entry, stdout } = await withHerdr({}, () => runDueJson(project));
    assert.equal(entry?.reason, "box-broken", stdout);
    assert.match(entry?.detail ?? "", /legacy_tiocsti is 1, not 0/u);
    assert.equal(herdrCalls().some((line) => line.startsWith("agent start ")), false, "no agent starts");
  } finally {
    writeFileSync(TIOCSTI, "0\n");
  }
  assert.deepEqual(boxDirs(), []);
});

test("maskLine leaves the tab's TERM for the tab's shell and quotes every other word", () => {
  const line = maskLine("claude", ["/usr/bin/bwrap", "--setenv", "TERM", TAB_TERM, "--setenv", "X", "$HOME"]);
  // The alias text, as the shell stores it: words in single quotes, the tab's TERM in double quotes.
  const alias = /^ alias claude='(.*)'; echo darius-mask''-ready$/u.exec(line)?.[1]?.replaceAll(String.raw`'\''`, "'");
  assert.equal(alias, `'/usr/bin/bwrap' '--setenv' 'TERM' "$TERM" '--setenv' 'X' '$HOME' 'claude'`);
});

// --- closed on a throw and on a timeout --------------------------------------------------

function request(project: string): SandboxRequest {
  const root = openProject(project, { create: true }).root;
  const dir = join(root, "runs", ulid());
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "policy.json"), '{"v":1}\n');
  const run = dir.slice(dir.lastIndexOf("/") + 1);
  return { run: { id: run, dir, policy: join(dir, "policy.json"), project, who: `claude:${run}` }, workDir: root, isReport: true, hasTty: false, ritual: {}, harness: claudeHarness, envPass: [] };
}

test("withRunSandbox: a body that throws still closes the proxy and the broker and removes the box dir", async () => {
  const req = request("bx-throw");
  let seen = "";
  await assert.rejects(
    withRunSandbox(req, async (sandbox) => {
      assert.equal(sandbox.state, "box");
      assert.equal(sandbox.isBox, true);
      seen = join(RUNTIME, "darius-box", req.run.id);
      assert.ok(existsSync(join(seen, "proxy.sock")) && existsSync(join(seen, "broker.sock")) && existsSync(join(seen, "box.json")), "the box is up in the body");
      assert.equal(sandbox.prefix?.at(-1), "--", "the prefix ends with box enter's --");
      throw new Error("the launch broke");
    }),
    /the launch broke/u,
  );
  assert.notEqual(seen, "");
  assert.equal(existsSync(seen), false, "the box dir is gone after the throw");
});

test("withRunSandbox: after the box is closed it renames what the body planted in the work dir, logs it and hands it to onPlants; a pre-existing repo stays", async () => {
  const base = request("bx-plant");
  const work = join(SANDBOX, "bx-plant-work");
  mkdirSync(join(work, "old", ".git"), { recursive: true });
  writeFileSync(join(work, "old", ".git", "config"), "[core]\n");
  const checks: { blocked: string[]; unresolved: string[]; isBoxGone: boolean }[] = [];
  const boxDir = join(RUNTIME, "darius-box", base.run.id);
  const req: SandboxRequest = { ...base, workDir: work, isReport: false, onPlants: (check) => checks.push({ ...check, isBoxGone: !existsSync(boxDir) }) };
  const end = await withRunSandbox(req, async () => {
    mkdirSync(join(work, "sub", ".git"), { recursive: true });
    writeFileSync(join(work, "sub", ".git", "config"), '[core]\n\tfsmonitor = "touch /tmp/pwned"\n');
    mkdirSync(join(work, "sub", ".claude"), { recursive: true });
    writeFileSync(join(work, "sub", ".claude", "settings.json"), "{}\n");
    return "ran";
  });
  assert.deepEqual(end, { ran: "ran" });
  assert.equal(checks.length, 1, "onPlants is called once");
  assert.equal(checks[0]?.isBoxGone, true, "the check runs after the box is closed");
  assert.deepEqual(checks[0]?.unresolved, []);
  const blocked = [...(checks[0]?.blocked ?? [])].toSorted();
  assert.match(blocked[0] ?? "", new RegExp(`^${join(work, "sub", ".claude")}, a \\.claude made in the run, \\.claude renamed to \\.claude\\.darius-blocked-[0-9a-f]{8}$`, "u"));
  assert.match(blocked[1] ?? "", new RegExp(`^${join(work, "sub", ".git")}, a \\.git made in the run, \\.git renamed to \\.git\\.darius-blocked-[0-9a-f]{8}$`, "u"));
  assert.ok(!existsSync(join(work, "sub", ".git")) && readdirSync(join(work, "sub")).some((name) => name.startsWith(".git.darius-blocked-")));
  assert.ok(existsSync(join(work, "old", ".git", "config")), "a repo that was there at launch stays");
  const log = readFileSync(join(req.run.dir, "run.log"), "utf8");
  assert.match(log, /box: blocked \S*\/sub\/\.git, a \.git made in the run, \.git renamed to \.git\.darius-blocked-/u);

  // Report mode: the work dir was read-only, so there is no check.
  mkdirSync(join(work, "late", ".git"), { recursive: true });
  const report: SandboxRequest = { ...request("bx-plant-report"), workDir: work, isReport: true, onPlants: () => assert.fail("no check in report mode") };
  await withRunSandbox(report, async () => undefined);
  assert.ok(existsSync(join(work, "late", ".git")));

  // A throw from onPlants stays in run.log: it never leaves withRunSandbox.
  const throwing: SandboxRequest = { ...request("bx-plant-throw"), workDir: work, isReport: false, onPlants: () => { throw new Error("ledger down"); } };
  const ended = await withRunSandbox(throwing, async () => {
    mkdirSync(join(work, "again", ".git"), { recursive: true });
    return 1;
  });
  assert.deepEqual(ended, { ran: 1 });
  assert.match(readFileSync(join(throwing.run.dir, "run.log"), "utf8"), /could not be recorded on the run: ledger down/u);
});

test("an act run that plants a nested repo: the runner renames it, and run show lists it", async () => {
  fresh();
  const project = "bx-plant-run";
  const dir = linkedCheckout(project);
  seedRitual(project, ACT_POLICY);
  process.env.FAKE_CLAUDE_MODE = "plant";
  try {
    const { entry, stdout } = await runDueJson(project);
    assert.equal(entry?.end, "complete", stdout);
    assertBoxedAndClosed();
    const blockedName = readdirSync(join(dir, "sub")).find((name) => /^\.git\.darius-blocked-[0-9a-f]{8}$/u.test(name)) ?? "";
    const line = `${join(dir, "sub", ".git")}, a .git made in the run, .git renamed to ${blockedName}`;
    assert.ok(existsSync(join(dir, "sub", blockedName, "config")) && !existsSync(join(dir, "sub", ".git")));
    const recorded = linesOf(project, "run.box-blocked");
    assert.equal(recorded.length, 1);
    assert.deepEqual(recorded[0]?.blocked, [line]);
    assert.equal(recorded[0]?.run, entry?.run);
    const shown = await runCli(runCommand, ["show", entry?.run ?? "", "--project", project]);
    assert.ok(shown.stdout.includes(`box blocked: ${line}`), shown.stdout);
    const json = JSON.parse((await runCli(runCommand, ["show", entry?.run ?? "", "--project", project, "--json"])).stdout);
    assert.deepEqual(json.box_blocked, [line]);
    assert.equal(json.box_check_unfinished, undefined);
    assert.equal(json.box_unresolved, undefined);
    assert.equal(json.phase, "closed", "the record line does not change the run's phase");
  } finally {
    delete process.env.FAKE_CLAUDE_MODE;
  }
});

test("F1: what the check cannot settle taints the work dir: every later launch there skips as box-broken, boxed, on an off host and with sandbox = \"off\", until darius box clear", async () => {
  fresh();
  const project = "bx-taint";
  const dir = linkedCheckout(project);
  seedRitual(project, ACT_POLICY);
  process.env.FAKE_CLAUDE_MODE = "plant-too-long";
  try {
    const { entry, stdout } = await runDueJson(project);
    assert.equal(entry?.end, "complete", stdout);
    const plant = readFileSync(join(dir, "long-plant"), "utf8").trim();
    const reason = `${plant}, a .git made in the run, not renamed: ENAMETOOLONG`;
    const recorded = linesOf(project, "run.box-blocked");
    assert.equal(recorded.length, 1);
    assert.equal(recorded[0]?.unresolved, true);
    assert.deepEqual(recorded[0]?.reasons, [reason]);
    const tainted = readTaints();
    assert.equal(tainted.length, 1);
    assert.equal(tainted[0]?.workDir, dir);
    assert.equal(tainted[0]?.run, entry?.run);
    const shown = JSON.parse((await runCli(runCommand, ["show", entry?.run ?? "", "--project", project, "--json"])).stdout);
    assert.deepEqual(shown.box_unresolved, [reason]);
    const alerts = ledgerAlerts(openProject(project), readLedger(openProject(project)), "", hostId()).filter((alert) => alert.title.includes("tainted"));
    assert.equal(alerts.length, 1, "the taint goes out as an alert");
    assert.match(alerts[0]?.title ?? "", /^heartbeat tainted its work dir on /u);
    assert.equal(alerts[0]?.body.includes(dir), false, "the alert names no path");

    process.env.FAKE_CLAUDE_MODE = "complete";
    for (const mode of ["box", "off"]) {
      process.env.DARIUS_RUN_SANDBOX = mode;
      fresh();
      const again = await runCli(runCommand, ["now", "heartbeat", "--project", project, "--json"]);
      const skip = entryOf(again.stdout);
      assert.deepEqual([skip?.action, skip?.reason], ["skipped", "box-broken"], `${mode}: ${again.stdout}`);
      assert.ok(skip?.detail?.includes(`run ${entry?.run ?? ""}`) && skip.detail.includes(`darius box clear ${dir}`), skip?.detail);
      assert.equal(launches().length, 0, "no harness starts");
    }
    process.env.DARIUS_RUN_SANDBOX = "box";

    const status = await runCli(boxCommand, ["status", "--json"]);
    assert.equal(JSON.parse(status.stdout).tainted[0]?.workDir, dir);
    assert.match((await runCli(boxCommand, ["status"])).stdout, new RegExp(`! tainted ${dir}: run ${entry?.run ?? ""}`, "u"));
    process.env.DARIUS_RUN = "01JSOMERUN";
    try {
      assert.equal((await runCli(boxCommand, ["clear", dir])).code, 1, "a run cannot clear a taint");
    } finally {
      delete process.env.DARIUS_RUN;
    }
    const cleared = await runCli(boxCommand, ["clear", dir]);
    assert.equal(cleared.code, 0, cleared.stderr);
    assert.match(cleared.stdout, new RegExp(`cleared the taint of ${dir}: run ${entry?.run ?? ""}`, "u"));
    assert.equal((await runCli(boxCommand, ["clear", dir])).code, 1, "nothing left to clear");
    rmSync(join(dir, plant.slice(dir.length + 1).split("/")[0] ?? "missing"), { recursive: true, force: true });
    const after = await runCli(runCommand, ["now", "heartbeat", "--project", project, "--json"]);
    assert.equal(entryOf(after.stdout)?.end, "complete", after.stdout);
  } finally {
    delete process.env.FAKE_CLAUDE_MODE;
    process.env.DARIUS_RUN_SANDBOX = "box";
  }
});

test("a taint in a folder above or below the work dir blocks it too; a ritual with sandbox = \"off\" is blocked", async () => {
  const project = "bx-taint-off";
  const dir = optOutCheckout(project);
  addTaint({ workDir: join(dir, "deep"), run: "01JTAINTRUN", project: "elsewhere", at: new Date().toISOString(), reasons: ["a test"] });
  try {
    fresh();
    const due = await runDueJson(project);
    // SAFETY: run-due --json prints the batch report.
    const rituals = (JSON.parse(due.stdout) as { projects: { rituals: Entry[] }[] }).projects[0]?.rituals ?? [];
    for (const slug of ["unboxed", "boxed"]) {
      const entry = rituals.find((candidate) => candidate.slug === slug);
      assert.deepEqual([entry?.action, entry?.reason], ["skipped", "box-broken"], `${slug}: ${due.stdout}`);
      assert.match(entry?.detail ?? "", /tainted: .*run 01JTAINTRUN \(elsewhere\)/u);
    }
  } finally {
    clearTaint(join(dir, "deep"));
  }
});

test("H2: a launch holds its work dir's lock: a launch there or in a folder above or below is busy until it ends; an off host lets go before the body; run-due skips a busy one as lease-held", async () => {
  const work = join(SANDBOX, "bx-lock-work");
  mkdirSync(join(work, "sub"), { recursive: true });
  const tries: string[] = [];
  const end = await withRunSandbox({ ...request("bx-lock"), workDir: work }, async () => {
    for (const dir of [work, join(work, "sub"), SANDBOX]) {
      const other = await withRunSandbox({ ...request("bx-lock-2"), workDir: dir }, async () => "ran");
      tries.push("busy" in other ? `busy ${other.busy}` : JSON.stringify(other));
    }
    return "ran";
  });
  assert.deepEqual(end, { ran: "ran" });
  assert.equal(tries.length, 3);
  for (const entry of tries) assert.match(entry, new RegExp(`^busy the work dir \\S+ is in use: run \\S+ \\(pid ${String(process.pid)}\\) holds the box lock on ${work}`, "u"));
  assert.deepEqual(readdirSync(lockDir()), [], "the lock is gone after the launch");

  process.env.DARIUS_RUN_SANDBOX = "off";
  try {
    const inner = await withRunSandbox({ ...request("bx-lock-off"), workDir: work }, async () => withRunSandbox({ ...request("bx-lock-off-2"), workDir: work }, async () => "inner"));
    assert.deepEqual(inner, { ran: { ran: "inner" } }, "no box, no post-run check: the lock goes before the body");
  } finally {
    process.env.DARIUS_RUN_SANDBOX = "box";
  }

  const project = "bx-lock-due";
  const dir = linkedCheckout(project);
  seedRitual(project);
  const held = takeLock({ workDir: dir, run: "01JHELDRUN" });
  assert.ok("lock" in held);
  try {
    fresh();
    const { entry, stdout } = await runDueJson(project);
    assert.deepEqual([entry?.action, entry?.reason], ["skipped", "lease-held"], stdout);
    assert.match(entry?.detail ?? "", /run 01JHELDRUN/u);
    assert.equal(launches().length, 0, "no harness starts");
  } finally {
    if ("lock" in held) held.lock.release();
  }
});

/** A pid that is gone now: a child that ran and exited. */
function deadPid(): number {
  const ran = spawnSync("true");
  assert.ok(ran.pid !== undefined && ran.pid > 0);
  return ran.pid;
}

test("H1: the pending record of a dead runner: the next launch there, on an off host too, reaps its box, renames its plant by the launch's ids, logs to both runs, records on the owner and removes the record", async () => {
  const work = join(SANDBOX, "bx-pending-work");
  mkdirSync(join(work, "old", ".git"), { recursive: true });
  const launch = scanWork({ workDir: work, capMs: 30_000 });
  mkdirSync(join(work, "sub", ".git"), { recursive: true });
  const dead = request("bx-pending");
  const file = writePending({ run: dead.run.id, project: dead.run.project, runDir: dead.run.dir, workDir: work, ids: [...launch.ids], isBareTop: false, boxDir: join(RUNTIME, "darius-box", dead.run.id), isWorkReadOnly: false, pid: deadPid(), start: "1", at: new Date().toISOString() });
  // A live runner's record in the same work dir is not touched.
  const live = writePending({ run: "01JLIVERUN", project: "bx-pending", runDir: dead.run.dir, workDir: work, ids: [], isBareTop: false, boxDir: join(RUNTIME, "darius-box", "01JLIVERUN"), isWorkReadOnly: false, ...selfProc(), at: new Date().toISOString() });
  const owners: string[] = [];
  process.env.DARIUS_RUN_SANDBOX = "off";
  try {
    const next = { ...request("bx-pending"), workDir: join(work, "sub"), onPlants: (check: PlantCheck, owner: PlantOwner) => owners.push(`${owner.run} ${String(check.blocked.length)}`) };
    assert.deepEqual(await withRunSandbox(next, async () => "ran"), { ran: "ran" });
    assert.equal(existsSync(join(work, "sub", ".git")), false, "the dead run's plant is renamed");
    assert.ok(existsSync(join(work, "old", ".git")), "the repo of its launch stays");
    assert.equal(existsSync(file), false, "the record is gone");
    assert.ok(existsSync(live), "a live runner's record stays");
    assert.deepEqual(owners, [`${dead.run.id} 1`]);
    const deadLog = readFileSync(join(dead.run.dir, "run.log"), "utf8");
    assert.match(deadLog, /ended before its post-run check/u);
    assert.match(deadLog, /box: blocked \S*\/sub\/\.git, a \.git made in the run/u);
    assert.match(readFileSync(join(next.run.dir, "run.log"), "utf8"), new RegExp(`settled the box of run ${dead.run.id}, whose runner died: 1 blocked, 0 unresolved`, "u"));
  } finally {
    process.env.DARIUS_RUN_SANDBOX = "box";
    rmSync(live, { force: true });
  }

  // A damaged record taints every work dir, and moves aside so `darius box clear /` ends it.
  mkdirSync(pendingDir(), { recursive: true });
  writeFileSync(join(pendingDir(), "broken.json"), "{");
  const blocked = await withRunSandbox({ ...request("bx-pending"), workDir: work }, async () => "ran");
  assert.ok("boxBroken" in blocked && blocked.boxBroken.includes("broken.json does not parse"), JSON.stringify(blocked));
  assert.ok(existsSync(join(pendingDir(), "broken.json.damaged")));
  assert.equal(clearTaint("/").length, 1);
  rmSync(join(pendingDir(), "broken.json.damaged"));
});

test("L1: each taint is a file of its own: two taints of one work dir both stay; a damaged file and a folder that cannot be listed are a taint on /", { skip: process.getuid?.() === 0 }, () => {
  const dir = join(SANDBOX, "bx-taints");
  const at = new Date().toISOString();
  addTaint({ workDir: "/w/a", run: "01JRUNA", project: "p", at, reasons: ["one"] }, dir);
  addTaint({ workDir: "/w/a", run: "01JRUNB", project: "p", at, reasons: ["two"] }, dir);
  assert.deepEqual(readTaints(dir).map((taint) => taint.run).toSorted(), ["01JRUNA", "01JRUNB"]);
  writeFileSync(join(dir, "zz-damaged.json"), "not json");
  assert.deepEqual(readTaints(dir).filter((taint) => taint.workDir === "/").length, 1);
  assert.equal(clearTaint("/w/a", dir).length, 2);
  assert.equal(clearTaint("/", dir).length, 1, "clear / removes the damaged file");
  assert.deepEqual(readTaints(dir), []);
  chmodSync(dir, 0o000);
  try {
    const taints = readTaints(dir);
    assert.equal(taints.length, 1);
    assert.equal(taints[0]?.workDir, "/");
    assert.match(taints[0]?.reasons[0] ?? "", /cannot be listed/u);
  } finally {
    chmodSync(dir, 0o700);
  }
});

/** A folder outside /tmp and /var/tmp, which a writable extra may not be in: in the checkout, removed after. Undefined when it cannot be made. */
function outsideTmp(): string | undefined {
  try {
    const dir = mkdtempSync(join(process.cwd(), ".bx-extra-"));
    return ["/tmp/", "/var/tmp/"].some((root) => `${dir}/`.startsWith(root)) ? undefined : dir;
  } catch {
    return undefined;
  }
}

test("M2: a writable extra that holds a .git, .claude, .darius.toml, .mcp.json or bare repo refuses the launch, naming it; the work dir inside an extra is left to its own walk", async (t) => {
  const extra = outsideTmp();
  if (extra === undefined) {
    t.skip("no writable folder outside /tmp and /var/tmp");
    return;
  }
  t.after(() => rmSync(extra, { recursive: true, force: true }));
  mkdirSync(join(extra, "work", ".git"), { recursive: true });
  mkdirSync(join(extra, "cache"), { recursive: true });
  const ok = await withRunSandbox({ ...request("bx-extra"), workDir: join(extra, "work"), isReport: false, ritual: { writable: [extra] } }, async () => "ran");
  assert.deepEqual(ok, { ran: "ran" });
  for (const guard of [join("cache", "dep", ".git"), join("cache", ".claude"), join("cache", "x", ".darius.toml"), join("cache", ".mcp.json")]) {
    const path = join(extra, guard);
    if (guard.endsWith(".git") || guard.endsWith(".claude")) mkdirSync(path, { recursive: true });
    else {
      mkdirSync(join(path, ".."), { recursive: true });
      writeFileSync(path, "{}\n");
    }
    const end = await withRunSandbox({ ...request("bx-extra"), workDir: join(extra, "work"), isReport: false, ritual: { writable: [extra] } }, async () => "ran");
    assert.ok("boxBroken" in end && end.boxBroken.includes(`the writable extra ${extra} holds ${path}`), `${guard}: ${JSON.stringify(end)}`);
    rmSync(join(extra, "cache"), { recursive: true, force: true });
    mkdirSync(join(extra, "cache"));
  }
  // A bare-looking cache, the extra itself.
  for (const name of ["HEAD", "objects", "refs"]) mkdirSync(join(extra, "cache", name));
  const bare = await withRunSandbox({ ...request("bx-extra"), workDir: join(extra, "work"), isReport: false, ritual: { writable: [join(extra, "cache")] } }, async () => "ran");
  assert.ok("boxBroken" in bare && bare.boxBroken.includes(`holds ${join(extra, "cache")},`), JSON.stringify(bare));
});

test("a run that times out ends, and its box is closed", async () => {
  fresh();
  const project = "bx-timeout";
  seedRitual(project);
  process.env.FAKE_CLAUDE_MODE = "sleep";
  try {
    const { entry, stdout } = await runDueJson(project, ["--timeout", "1"]);
    assert.equal(entry?.end, "failed", stdout);
    assert.equal(entry?.timedOut, true);
    assertBoxedAndClosed();
  } finally {
    process.env.FAKE_CLAUDE_MODE = "complete";
  }
});

// --- fail closed ------------------------------------------------------------------------

/** A run-due that must skip as box-broken: no run starts, no harness runs, run.log in the run dir says why. */
async function assertBoxBroken(project: string, why: RegExp): Promise<void> {
  fresh();
  seedRitual(project);
  const before = readdirSync(CLAUDE_LOG).length;
  const { code, entry, stdout } = await runDueJson(project);
  assert.equal(code, 1, `a broken box fails the batch: ${stdout}`);
  assert.equal(entry?.action, "skipped", stdout);
  assert.equal(entry?.reason, "box-broken", stdout);
  assert.match(entry?.detail ?? "", why);
  assert.equal(linesOf(project, "run.started").length, 0, "no run started");
  assert.equal(readdirSync(CLAUDE_LOG).length, before, "no harness ran");
  assert.equal(launches().length, 0, "nothing launched in or out of a box");
  const runs = join(openProject(project).root, "runs");
  const dirs = existsSync(runs) ? readdirSync(runs) : [];
  assert.equal(dirs.length, 1, "the run dir stays, for run.log");
  assert.deepEqual(readdirSync(join(runs, dirs[0] ?? "")), ["run.log"], "only run.log is left");
  assert.match(readFileSync(join(runs, dirs[0] ?? "", "run.log"), "utf8"), /box: this run does not start, the box could not be built: /u);
  assert.deepEqual(boxDirs(), [], "no box dir is left");
}

test("box-broken: bwrap missing", async () => {
  process.env.DARIUS_BWRAP = join(SANDBOX, "no-bwrap");
  try {
    await assertBoxBroken("bx-no-bwrap", /bwrap is not on PATH/u);
  } finally {
    process.env.DARIUS_BWRAP = FAKE_BWRAP;
  }
});

test("box-broken: the bwrap probe fails, and the box layout is refused", async () => {
  for (const [fail, why] of [["probe", /No permissions to create a new namespace/u], ["layout", /bwrap refused the box layout .*Can't find source path/u]] as const) {
    process.env.FAKE_BWRAP_FAIL = fail;
    try {
      await assertBoxBroken(`bx-fail-${fail}`, why);
    } finally {
      delete process.env.FAKE_BWRAP_FAIL;
    }
  }
});

test("box-broken: a [box] writable path that resolves into ~/.ssh is refused", async () => {
  mkdirSync(join(HOME, ".ssh"), { recursive: true });
  symlinkSync(join(HOME, ".ssh"), join(HOME, "cachelink"));
  const config = join(process.env.DARIUS_CONFIG_DIR ?? "", "config.toml");
  writeFileSync(config, '[box]\nwritable = ["~/cachelink"]\n');
  try {
    await assertBoxBroken("bx-writable", /\[box\] writable "~\/cachelink" is refused: it resolves to .*\.ssh/u);
  } finally {
    rmSync(config, { force: true });
    rmSync(join(HOME, "cachelink"), { force: true });
  }
});

/** A runtime dir of `length` characters, so the box dir's socket paths have a known length. */
function runtimeOf(length: number): string | undefined {
  const base = join(SANDBOX, "r");
  if (base.length + 2 > length) return undefined;
  return join(base, "x".repeat(length - base.length - 1));
}

test("box-broken: a proxy or a broker that does not start", async (t) => {
  // <runtime>/darius-box/<26-character run id>/proxy.sock: 49 characters after the runtime dir. Linux takes 108.
  const cases = [
    { project: "bx-no-proxy", runtime: runtimeOf(60), why: /EINVAL|ENAMETOOLONG|too long/u },
    { project: "bx-no-broker", runtime: runtimeOf(59), why: /EINVAL|ENAMETOOLONG|too long/u },
  ];
  if (cases.some((one) => one.runtime === undefined)) {
    t.skip("the temp dir path is too long to aim the socket paths");
    return;
  }
  for (const one of cases) {
    const runtime = one.runtime ?? "";
    mkdirSync(runtime, { recursive: true, mode: 0o700 });
    process.env.XDG_RUNTIME_DIR = runtime;
    try {
      await assertBoxBroken(one.project, one.why);
      assert.deepEqual(boxDirs(runtime), []);
    } finally {
      process.env.XDG_RUNTIME_DIR = RUNTIME;
    }
  }
});

test("box-broken: no XDG_RUNTIME_DIR", async () => {
  delete process.env.XDG_RUNTIME_DIR;
  try {
    await assertBoxBroken("bx-no-runtime", /XDG_RUNTIME_DIR/u);
  } finally {
    process.env.XDG_RUNTIME_DIR = RUNTIME;
  }
});

test("box-broken before the gate check of a new harness version: no check line, and the ritual skips as box-broken", async () => {
  fresh();
  const project = "bx-check-broken";
  seedRitual(project);
  process.env.FAKE_CLAUDE_VERSION = "2.1.901";
  process.env.DARIUS_BWRAP = join(SANDBOX, "no-bwrap");
  try {
    const { entry, stdout } = await runDueJson(project);
    assert.equal(entry?.reason, "box-broken", stdout);
    assert.match(entry?.detail ?? "", /the gate check could not run: box-broken: bwrap is not on PATH/u);
    assert.equal(readLedger(openProject("_global")).some((line) => line.type === "harness.checked" && line.version === "2.1.901"), false, "nothing was checked, so nothing is recorded");
  } finally {
    delete process.env.FAKE_CLAUDE_VERSION;
    process.env.DARIUS_BWRAP = FAKE_BWRAP;
  }
});

// --- the proxy policy -------------------------------------------------------------------

test("webPorts: 4747 and 4748, DARIUS_WEB_URL of web.env and next.env by host and port, DARIUS_WEB_PORT", () => {
  const dir = join(SANDBOX, "webenv");
  mkdirSync(dir, { recursive: true });
  assert.deepEqual(webPorts(dir), [{ host: "", port: 4747 }, { host: "", port: 4748 }]);
  writeFileSync(join(dir, "web.env"), 'export DARIUS_WEB_URL="https://darius.example.com"\nDARIUS_WEB_PORT=4800\n');
  writeFileSync(join(dir, "next.env"), "DARIUS_WEB_URL=http://host.example.net:4749/\nDARIUS_WEB_URL=not a url\n");
  assert.deepEqual(webPorts(dir), [
    { host: "", port: 4747 },
    { host: "", port: 4748 },
    { host: "", port: 4800 },
    { host: "", port: 4749 },
    { host: "darius.example.com", port: 443 },
    { host: "host.example.net", port: 4749 },
  ]);
});

test("a launch whose box dir belongs to a live launch is box-broken, and leaves that box dir alone", async () => {
  const req = request("bx-live-dir");
  const live = join(RUNTIME, "darius-box", req.run.id);
  mkdirSync(live, { recursive: true, mode: 0o700 });
  writeFileSync(join(live, "box.json"), "{}\n");
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(join(live, "broker.sock"), resolve));
  try {
    let ran = false;
    const end = await withRunSandbox(req, async () => {
      ran = true;
    });
    assert.equal(ran, false);
    assert.ok("boxBroken" in end && /is there already/u.test(end.boxBroken), JSON.stringify(end));
    assert.ok(existsSync(join(live, "box.json")) && existsSync(join(live, "broker.sock")), "the live launch keeps its box dir");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(live, { recursive: true, force: true });
  }
});

test("a stale box dir from a dead runner is removed; a live one stays", async () => {
  const stale = join(SANDBOX, "stale-box");
  mkdirSync(stale, { recursive: true });
  writeFileSync(join(stale, "box.json"), "{}\n");
  writeFileSync(join(stale, "proxy.sock"), "");
  await clearStaleBox(stale);
  assert.equal(existsSync(stale), false);

  const live = join(SANDBOX, "live-box");
  mkdirSync(live, { recursive: true });
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(join(live, "broker.sock"), resolve));
  try {
    await clearStaleBox(live);
    assert.equal(existsSync(join(live, "broker.sock")), true);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  await clearStaleBox(join(SANDBOX, "no-such-box"));
});

// --- sandbox = "off" in the marker (0.124.0) --------------------------------------------

/** One act ritual table of a v3 marker, with `extra` lines. */
function ritualTable(slug: string, extra: string): string {
  return [`[rituals.${slug}]`, `title = "${slug}"`, 'cadence = "1d"', `skill = "${slug}"`, 'mode = "act"', 'may = ["Bash(darius *)", "Bash(date)"]', extra, ""].join("\n");
}

/** A v3 checkout with two act rituals: `unboxed` says `sandbox = "off"`, `boxed` does not. */
function optOutCheckout(project: string): string {
  const dir = join(SANDBOX, `${project}-co`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, ".darius.toml"), ["v = 3", `project = "${project}"`, 'max_mode = "act"', 'tz = "UTC"', "", ritualTable("unboxed", 'sandbox = "off"'), ritualTable("boxed", "")].join("\n"));
  for (const slug of ["unboxed", "boxed"]) {
    mkdirSync(join(dir, ".claude", "skills", slug), { recursive: true });
    writeFileSync(join(dir, ".claude", "skills", slug, "SKILL.md"), `---\nname: ${slug}\ndescription: ${slug}\n---\nRun date, then complete the run.\n`);
  }
  openProject(project, { create: true });
  writeLink(project, dir);
  return dir;
}

function runLog(project: string, run: string): string {
  const file = join(openProject(project).root, "runs", run, "run.log");
  return existsSync(file) ? readFileSync(file, "utf8") : "";
}

test("sandbox = \"off\": on a box host the ritual runs unboxed through run-due, run now, run resume and a follow-up, skips the box check gate, and says so", async () => {
  const project = "bx-off";
  optOutCheckout(project);
  // A box check that failed today: every boxed ritual skips as box-broken until it passes.
  appendLine(openProject("_global"), { who: "test", type: "box.checked", darius: VERSION, ...boxStack(), outcome: "fail", failed: ["store-write"], skipped: [] });
  try {
    fresh();
    process.env.FAKE_CLAUDE_MODE = "complete";
    const due = await runDueJson(project);
    // SAFETY: run-due --json prints the batch report.
    const rituals = (JSON.parse(due.stdout) as { projects: { rituals: Entry[] }[] }).projects[0]?.rituals ?? [];
    const boxed = rituals.find((entry) => entry.slug === "boxed");
    const unboxed = rituals.find((entry) => entry.slug === "unboxed");
    assert.deepEqual([boxed?.action, boxed?.reason], ["skipped", "box-broken"], due.stdout);
    assert.match(boxed?.detail ?? "", /box check .* failed today/u);
    assert.equal(unboxed?.end, "complete", due.stdout);
    // The boxed ritual's gate probes bwrap; nothing else calls it.
    assert.ok(bwrapLines().every((line) => line === "call --dev-bind / / true"), `no box, no layout probe, no mask: ${bwrapLines().join("\n")}`);
    const run = unboxed?.run ?? "";
    assert.match(runLog(project, run), /box: off for this ritual by the marker\n$/u);
    assert.equal(linesOf(project, "run.started").find((line) => line.run === run)?.sandbox, "off", "the run's start line records it");
    const shown = await runCli(runCommand, ["show", run, "--project", project, "--json"]);
    assert.equal(JSON.parse(shown.stdout).sandbox, "off", shown.stdout);
    const shownText = await runCli(runCommand, ["show", run, "--project", project]);
    assert.match(shownText.stdout, /sandbox off for this ritual by the marker/u);

    const listed = await runCli(ritualCommand, ["list", "--project", project, "--json"]);
    // SAFETY: ritual list --json prints the project and its rituals.
    const list = JSON.parse(listed.stdout) as { rituals: { slug: string; sandbox?: string }[] };
    assert.equal(list.rituals.find((entry) => entry.slug === "unboxed")?.sandbox, "off", listed.stdout);
    assert.equal(list.rituals.find((entry) => entry.slug === "boxed")?.sandbox, undefined);
    const listText = await runCli(ritualCommand, ["list", "--project", project]);
    assert.match(listText.stdout, /^unboxed .* sandbox=off /mu);
    assert.doesNotMatch(listText.stdout, /^boxed .*sandbox=/mu);

    process.env.FAKE_CLAUDE_MODE = "hold";
    const now = await runCli(runCommand, ["now", "unboxed", "--project", project, "--json"]);
    assert.equal(entryOf(now.stdout)?.end, "held", now.stdout + now.stderr);
    const held = entryOf(now.stdout)?.run ?? "";
    assert.match(runLog(project, held), /box: off for this ritual by the marker/u, "run now");
    assert.equal((await runCli(runCommand, ["answer", held, "1", "yes", "--project", project])).code, 0);
    process.env.FAKE_CLAUDE_MODE = "complete";
    const resumed = await runCli(runCommand, ["resume", held, "--project", project, "--json"]);
    assert.equal(entryOf(resumed.stdout)?.end, "complete", resumed.stdout + resumed.stderr);
    assert.equal(linesOf(project, "run.resumed").find((line) => line.run === held)?.sandbox, "off", "run resume");
    assert.equal(runLog(project, held).match(/box: off for this ritual by the marker/gu)?.length, 2, "one line per launch");

    const { report } = await runDue({ projects: [project], only: "unboxed", isDryRun: false, who: "test", timeoutMs: 60_000, followUp: { parent: run, approved: [], grants: ["date"], headless: true } });
    const follow = report.projects[0]?.rituals[0];
    assert.equal(follow?.end, "complete", JSON.stringify(report));
    assert.match(runLog(project, follow?.run ?? ""), /box: off for this ritual by the marker/u, "a follow-up");
    assert.ok(bwrapLines().every((line) => line === "call --dev-bind / / true"), `still no box: ${bwrapLines().join("\n")}`);
    assert.deepEqual(boxDirs(), []);
  } finally {
    appendLine(openProject("_global"), { who: "test", type: "box.checked", darius: VERSION, ...boxStack(), outcome: "pass", failed: [], skipped: [] });
  }
});

test("sandbox = \"off\" has no effect on a mask or off host: the run gets the host's sandbox and no line", async () => {
  const project = "bx-off-host";
  optOutCheckout(project);
  process.env.DARIUS_RUN_SANDBOX = "off";
  try {
    fresh();
    process.env.FAKE_CLAUDE_MODE = "complete";
    const { report } = await runDue({ projects: [project], only: "unboxed", isDryRun: false, who: "test", timeoutMs: 60_000 });
    const entry = report.projects[0]?.rituals[0];
    assert.equal(entry?.end, "complete", JSON.stringify(report));
    assert.equal(runLog(project, entry?.run ?? ""), "", "no opt-out line on an off host");
    assert.equal(linesOf(project, "run.started")[0]?.sandbox, undefined);
  } finally {
    process.env.DARIUS_RUN_SANDBOX = "box";
  }
});

// --- no [run] sandbox key: the box is the default (0.132.0) ----------------------------

/** Runs `fn` on a host with no DARIUS_RUN_SANDBOX and the given config.toml (none for undefined), then puts the file's setup back. */
async function onHost<T>(configText: string | undefined, fn: () => Promise<T>): Promise<T> {
  const config = join(process.env.DARIUS_CONFIG_DIR ?? "", "config.toml");
  delete process.env.DARIUS_RUN_SANDBOX;
  if (configText !== undefined) writeFileSync(config, configText);
  try {
    return await fn();
  } finally {
    rmSync(config, { force: true });
    process.env.DARIUS_RUN_SANDBOX = "box";
  }
}

test("no [run] sandbox key: a host with a passed box check launches run-due and run now in the box", async () => {
  for (const configText of [undefined, 'host = "box-default"\n', 'host = "box-default"\n\n[run]\nbehind = "warn"\n']) {
    await onHost(configText, async () => {
      fresh();
      const project = `bx-default-${String(configText?.length ?? 0)}`;
      seedRitual(project);
      process.env.FAKE_CLAUDE_MODE = "complete";
      const { entry, stdout } = await runDueJson(project);
      assert.equal(entry?.end, "complete", `${String(configText)}: ${stdout}`);
      assert.ok(launches().some((launch) => launch.command.startsWith(`${FAKE_CLAUDE} -p `)), "the harness ran in the box");
      assertBoxedAndClosed();
      fresh();
      const now = await runCli(runCommand, ["now", "heartbeat", "--project", project, "--json"]);
      assert.equal(entryOf(now.stdout)?.end, "complete", now.stdout + now.stderr);
      assertBoxedAndClosed();
    });
  }
});

test("no [run] sandbox key: fail closed. No bwrap, a failed probe or a failed box check skips as box-broken and names both ways out", async () => {
  const bothWays = /then run darius box check; or set \[run\] sandbox = "off" in config\.toml/u;
  await onHost('host = "box-default"\n', async () => {
    process.env.DARIUS_BWRAP = join(SANDBOX, "no-bwrap");
    try {
      await assertBoxBroken("bx-default-no-bwrap", /bwrap is not on PATH/u);
      await assertBoxBroken("bx-default-no-bwrap-2", bothWays);
    } finally {
      process.env.DARIUS_BWRAP = FAKE_BWRAP;
    }
    process.env.FAKE_BWRAP_FAIL = "probe";
    try {
      await assertBoxBroken("bx-default-probe", /No permissions to create a new namespace.*then run darius box check; or set \[run\] sandbox = "off"/u);
    } finally {
      delete process.env.FAKE_BWRAP_FAIL;
    }
    appendLine(openProject("_global"), { who: "test", type: "box.checked", darius: VERSION, ...boxStack(), outcome: "fail", failed: ["store-write"], skipped: [] });
    try {
      fresh();
      const project = "bx-default-check-failed";
      seedRitual(project);
      const { code, entry, stdout } = await runDueJson(project);
      assert.equal(code, 1, stdout);
      assert.deepEqual([entry?.action, entry?.reason], ["skipped", "box-broken"], stdout);
      assert.match(entry?.detail ?? "", /box check of darius .+ failed today: store-write\. /u);
      assert.match(entry?.detail ?? "", bothWays);
      assert.equal(launches().length, 0, "nothing launched, boxed or not");
      assert.equal(linesOf(project, "run.started").length, 0);
    } finally {
      appendLine(openProject("_global"), { who: "test", type: "box.checked", darius: VERSION, ...boxStack(), outcome: "pass", failed: [], skipped: [] });
    }
  });
});

test("no [run] sandbox key: sandbox = \"off\" in config.toml runs unboxed as before; the marker's per-ritual opt-out still works on a default host", async () => {
  await onHost('host = "box-default"\n\n[run]\nsandbox = "off"\n', async () => {
    fresh();
    const project = "bx-default-off";
    seedRitual(project);
    process.env.FAKE_CLAUDE_MODE = "complete";
    const { entry, stdout } = await runDueJson(project);
    assert.equal(entry?.end, "complete", stdout);
    assert.deepEqual(bwrapLines(), [], "an off host never calls bwrap");
  });
  await onHost(undefined, async () => {
    const project = "bx-default-optout";
    optOutCheckout(project);
    fresh();
    process.env.FAKE_CLAUDE_MODE = "complete";
    const due = await runDueJson(project);
    // SAFETY: run-due --json prints the batch report.
    const rituals = (JSON.parse(due.stdout) as { projects: { rituals: Entry[] }[] }).projects[0]?.rituals ?? [];
    const unboxed = rituals.find((entry) => entry.slug === "unboxed");
    const boxed = rituals.find((entry) => entry.slug === "boxed");
    assert.equal(unboxed?.end, "complete", due.stdout);
    assert.equal(boxed?.end, "complete", due.stdout);
    assert.match(runLog(project, unboxed?.run ?? ""), /box: off for this ritual by the marker/u);
    assert.equal(linesOf(project, "run.started").find((line) => line.run === unboxed?.run)?.sandbox, "off");
    assert.equal(linesOf(project, "run.started").find((line) => line.run === boxed?.run)?.sandbox, undefined);
    assert.ok(launches().some((launch) => launch.command.startsWith(`${FAKE_CLAUDE} -p `) && launch.command.includes("boxed")), "the other ritual ran in the box");
    assertBoxedAndClosed();
  });
});

// --- [box] slice: a systemd user scope per launch (0.124.0) -----------------------------

const SCOPE_LOG = join(LOGS, "systemd-run");
/** A fake systemd-run: logs its flags, fails on FAKE_SYSTEMD_FAIL=1, else runs what follows `--`, as --scope does. */
const FAKE_SYSTEMD_RUN = script(
  "fake-systemd-run",
  `flags=""
while [ $# -gt 0 ] && [ "$1" != -- ]; do flags="$flags $1"; shift; done
shift
printf 'scope%s :: %s\\n' "$flags" "$*" >> "${SCOPE_LOG}"
[ "\${FAKE_SYSTEMD_FAIL:-}" = 1 ] && { echo "Failed to connect to user scope bus via local transport" >&2; exit 1; }
exec "$@"
`,
);

function scopeLines(): string[] {
  return existsSync(SCOPE_LOG) ? readFileSync(SCOPE_LOG, "utf8").trim().split("\n") : [];
}

async function withSlice<T>(systemdRun: string, fn: () => Promise<T>): Promise<T> {
  const config = join(process.env.DARIUS_CONFIG_DIR ?? "", "config.toml");
  writeFileSync(config, '[box]\nslice = "agents.slice"\n');
  process.env.DARIUS_SYSTEMD_RUN = systemdRun;
  rmSync(SCOPE_LOG, { force: true });
  try {
    return await fn();
  } finally {
    rmSync(config, { force: true });
    delete process.env.DARIUS_SYSTEMD_RUN;
    delete process.env.FAKE_SYSTEMD_FAIL;
  }
}

test("[box] slice: the layout probe, the gate preflight and the harness each start in their own scope of the slice", async () => {
  await withSlice(FAKE_SYSTEMD_RUN, async () => {
    fresh();
    const project = "bx-slice";
    seedRitual(project);
    process.env.FAKE_CLAUDE_MODE = "complete";
    const { entry, stdout } = await runDueJson(project);
    assert.equal(entry?.end, "complete", stdout);
    const run = entry?.run ?? "";
    const scopes = scopeLines();
    assert.equal(scopes.length, 3, scopes.join("\n"));
    const short = run.slice(-8).toLowerCase();
    for (const line of scopes) {
      assert.match(line, new RegExp(`^scope --user --scope -q --slice=agents\\.slice --unit=darius-run-${short}-[0-9a-f]{6} --collect :: \\S*fake-bwrap `, "u"), line);
    }
    assert.match(scopes[0] ?? "", / -- true$/u, "the layout probe runs through the scope");
    assert.ok(scopes.some((line) => line.includes(" policy-check ") && line.endsWith("--preflight")), "the preflight");
    assert.ok(scopes.some((line) => line.includes(`${FAKE_CLAUDE} -p `)), "the harness");
    const units = scopes.map((line) => /--unit=(\S+)/u.exec(line)?.[1]);
    assert.equal(new Set(units).size, 3, `one unit per launch: ${units.join(", ")}`);
    assertBoxedAndClosed();
    assert.equal(runLog(project, run), "", "a scope that starts needs no line");
  });
});

test("[box] slice fails open: a scope that does not start, or no systemd-run, runs the box without it and says so once", async () => {
  for (const [project, systemdRun, fail, why] of [
    ["bx-slice-fail", FAKE_SYSTEMD_RUN, "1", /the layout probe failed in a scope of agents\.slice and passed without it \(exit 1: Failed to connect to user scope bus/u],
    ["bx-slice-none", join(SANDBOX, "no-systemd-run"), "", /systemd-run is not on PATH/u],
  ] as const) {
    await withSlice(systemdRun, async () => {
      fresh();
      if (fail !== "") process.env.FAKE_SYSTEMD_FAIL = fail;
      seedRitual(project);
      process.env.FAKE_CLAUDE_MODE = "complete";
      const { entry, stdout } = await runDueJson(project);
      assert.equal(entry?.end, "complete", stdout);
      const log = runLog(project, entry?.run ?? "");
      assert.equal(log.match(/box: no scope in agents\.slice, so this run has no \[box\] slice limits: /gu)?.length, 1, log);
      assert.match(log, why);
      assert.ok(launches().some((launch) => launch.command.startsWith(`${FAKE_CLAUDE} -p `)), "the harness still runs in the box");
      assert.ok(scopeLines().length <= 1, `only the probe tried the scope: ${scopeLines().join("\n")}`);
      assertBoxedAndClosed();
    });
  }
});

test("[box] slice: a layout bwrap refuses stays box-broken, scope or not", async () => {
  await withSlice(FAKE_SYSTEMD_RUN, async () => {
    process.env.FAKE_BWRAP_FAIL = "layout";
    try {
      await assertBoxBroken("bx-slice-layout", /bwrap refused the box layout/u);
    } finally {
      delete process.env.FAKE_BWRAP_FAIL;
    }
  });
});
