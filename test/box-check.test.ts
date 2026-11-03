/**
 * `darius box check`, `box.checked`, the run-due gate and `box status`
 * (src/runner/box-check.ts, 0.121.0).
 *
 * Unit tests drive the step judges, the ledger line and the gate with
 * injected facts. One test runs the whole check on the real bubblewrap of
 * this host, in a temp store, a temp config dir and a temp home under
 * /var/tmp, so nothing here reads or writes the operator's real store,
 * config or home. It skips where bwrap or user namespaces are missing. The
 * check's own CONNECTs to this host's addresses go only through the box
 * proxy, which refuses them; no paid call is made (DARIUS_CLAUDE points at a
 * missing file, so no harness ever starts).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { accessSync, constants, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { release, tmpdir } from "node:os";
import { delimiter, join } from "node:path";

import type { Ritual } from "../src/core/model.ts";
import type { Project } from "../src/core/store.ts";
import type { BoxCheck, Observed, StepFacts } from "../src/runner/box-check.ts";
import { readTiocsti } from "../src/core/sandbox.ts";

/** A real bwrap that runs the box's namespaces here, found without DARIUS_BWRAP, which the suite points at a missing file. */
const REAL_BWRAP = (process.env.PATH ?? "")
  .split(delimiter)
  .map((dir) => join(dir, "bwrap"))
  .find((candidate) => candidate.startsWith("/") && existsSync(candidate) && spawnSync(candidate, ["--ro-bind", "/", "/", "--dev", "/dev", "--proc", "/proc", "--unshare-net", "--unshare-pid", "--die-with-parent", "true"]).status === 0);
const SKIP_REAL = REAL_BWRAP === undefined ? "no working bwrap with user namespaces on this host" : false;

function writableDir(path: string): boolean {
  try {
    accessSync(path, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

// The box puts a tmpfs on /tmp; a home under /var/tmp shows in the box as a real home does.
const BASE = realpathSync(mkdtempSync(join(writableDir("/var/tmp") ? "/var/tmp" : tmpdir(), "dbc-")));
const HOME = join(BASE, "home");
const STORE = join(BASE, "state");
const CONFIG = join(BASE, "config");
const RUNTIME = join(BASE, "rt");
for (const dir of [HOME, STORE, CONFIG]) mkdirSync(dir, { recursive: true });
mkdirSync(RUNTIME, { mode: 0o700 });
process.env.HOME = HOME;
process.env.DARIUS_STATE_DIR = STORE;
process.env.DARIUS_CONFIG_DIR = CONFIG;
process.env.DARIUS_APP_DIR = join(BASE, "app");
process.env.XDG_RUNTIME_DIR = RUNTIME;
process.env.DARIUS_TAILSCALE = join(BASE, "no-tailscale");
process.env.DARIUS_HERDR = join(BASE, "no-herdr");
process.env.DARIUS_CLAUDE = join(BASE, "no-claude");
process.env.CLAUDE_CONFIG_DIR = join(BASE, "claude");
delete process.env.DARIUS_RUN_SANDBOX;
delete process.env.DARIUS_PROJECT;
delete process.env.DARIUS_RUN;
delete process.env.SSH_AUTH_SOCK;
writeFileSync(join(CONFIG, "config.toml"), 'host = "box-check-test"\n');
process.on("exit", () => rmSync(BASE, { recursive: true, force: true }));

const { appendLine, readLedger } = await import("../src/core/ledger.ts");
const { openProject } = await import("../src/core/store.ts");
const { ulid } = await import("../src/core/ulid.ts");
const { localToday } = await import("../src/core/sweep.ts");
const { VERSION } = await import("../src/version.ts");
const { runDue } = await import("../src/runner/run-due.ts");
const box = await import("../src/runner/box-check.ts");

const BIN = join(import.meta.dirname, "..", "bin", "darius");
const HOST = "box-check-test";

/** What a box that holds gives the fake harness. */
function goodObserved(): Observed {
  return {
    stores: [{ path: "/store/.darius-box-check-r1", result: "EROFS" }],
    policy: { path: "/store/p/runs/r1/policy.json", result: "EROFS" },
    claudeSettings: { path: "/home/u/.claude/settings.json", result: "EROFS" },
    secrets: [{ path: "/home/u/.aws/credentials", result: "EACCES" }],
    sockets: {
      "docker-socket": [{ path: "/run/docker.sock", result: "ENOENT" }],
      "tailscale-socket": [{ path: "/run/tailscale/tailscaled.sock", result: "ENOENT" }],
      "system-bus": [{ path: "/run/dbus/system_bus_socket", result: "ENOENT" }],
    },
    systemdRun: { result: "exit 1", stderr: "Failed to connect to bus" },
    web: [{ target: "192.0.2.10:4747", status: 403, body: "darius box: refused 192.0.2.10:4747 (this-host): an address of this host\n" }],
    ssh: [{ target: "192.0.2.10:22", status: 403, body: "darius box: refused 192.0.2.10:22 (this-host): an address of this host\n" }],
    public: { target: "api.example.com:443", status: 200, body: "" },
    broker: { exit: 0, stdout: "✓ completed run r1 (complete)\n", stderr: "" },
  };
}

function facts(observed: Observed, extra: Partial<StepFacts> = {}): StepFacts {
  return {
    box: { built: true },
    observed,
    tiocsti: { value: "0" },
    hostSockets: { "docker-socket": true, "tailscale-socket": false, "system-bus": true },
    brokerCompleted: true,
    ...extra,
  };
}

function outcomes(steps: readonly { name: string; outcome: string }[]): Record<string, string> {
  return Object.fromEntries(steps.map((entry) => [entry.name, entry.outcome]));
}

// --- the steps ----------------------------------------------------------------------

test("judgeSteps: a box that holds passes every step, each named once, in order", () => {
  const steps = box.judgeSteps(facts(goodObserved()));
  assert.deepEqual(steps.map((entry) => entry.name), [...box.BOX_STEPS]);
  assert.deepEqual(steps.filter((entry) => entry.outcome !== "pass"), []);
  assert.match(steps.find((entry) => entry.name === "docker-socket")?.reason ?? "", /this host has the socket/u);
  assert.match(steps.find((entry) => entry.name === "tailscale-socket")?.reason ?? "", /this host has no such socket/u);
  assert.match(steps.find((entry) => entry.name === "web-api")?.reason ?? "", /refused 1 target\(s\) \(this-host\)/u);
});

test("judgeSteps: each thing the box lets through fails its own step", () => {
  const seen = goodObserved();
  seen.stores = [...seen.stores, { path: "/real/store/.probe", result: "ok" }];
  seen.policy = { path: seen.policy.path, result: "ok" };
  seen.claudeSettings = { path: seen.claudeSettings.path, result: "ok" };
  seen.secrets = [{ path: "/home/u/.npmrc", result: "ok" }];
  seen.sockets["docker-socket"] = [{ path: "/run/docker.sock", result: "ok" }];
  seen.sockets["system-bus"] = [{ path: "/run/dbus/system_bus_socket", result: "timeout" }];
  seen.systemdRun = { result: "ok", stderr: "" };
  seen.web = [...seen.web, { target: "127.0.0.1:4748", status: 200, body: "" }];
  seen.ssh = [{ target: "192.0.2.10:22", status: 502, body: "did not connect" }];
  seen.broker = { exit: 1, stdout: "", stderr: "the box broker refused" };
  const result = outcomes(box.judgeSteps(facts(seen, { brokerCompleted: false })));
  for (const name of ["store-write", "policy-write", "claude-settings-write", "secret-masked", "docker-socket", "system-bus", "systemd-run", "web-api", "ssh-port", "broker-complete"]) {
    assert.equal(result[name], "fail", name);
  }
  assert.equal(result["tailscale-socket"], "pass");
  assert.equal(result.box, "pass");
});

test("judgeSteps: public HTTPS offline is a skip, never a fail; another refusal fails", () => {
  const target = "api.example.com:443";
  assert.equal(box.judgePublic({ target, status: 403, body: "darius box: refused api.example.com:443 (no-address): resolved to no address\n" }).outcome, "skip");
  assert.equal(box.judgePublic({ target, status: 502, body: "darius box: api.example.com:443 did not connect\n" }).outcome, "skip");
  assert.equal(box.judgePublic({ target, status: "timeout", body: "" }).outcome, "skip");
  assert.match(box.judgePublic({ target, status: "timeout", body: "" }).reason, /offline/u);
  assert.equal(box.judgePublic({ target, status: 403, body: "darius box: refused api.example.com:443 (net-none): net is none\n" }).outcome, "fail");
  assert.equal(box.judgePublic({ target, status: "error:ECONNREFUSED", body: "" }).outcome, "fail", "no relay is a broken box, not offline");
  const offline = goodObserved();
  offline.public = { target, status: "timeout", body: "" };
  const check = box.boxCheckOf({ host: HOST, bwrap: "0.11.0", kernel: "6.1.0", run: "r1" }, box.judgeSteps(facts(offline)));
  assert.equal(check.outcome, "pass", "offline alone never fails the check");
  assert.deepEqual(check.skipped, ["public-https"]);
});

test("judgeSteps: tiocsti must be 0; a kernel without the knob fails", () => {
  assert.equal(box.judgeTiocsti({ value: "0" }).outcome, "pass");
  assert.equal(box.judgeTiocsti({ value: "1" }).outcome, "fail");
  assert.match(box.judgeTiocsti({ missing: true }).reason, /--new-session/u);
  assert.equal(box.judgeTiocsti({ missing: true }).outcome, "fail");
  assert.equal(box.judgeTiocsti({ error: "EACCES" }).outcome, "fail");
  const knob = join(BASE, "legacy_tiocsti");
  writeFileSync(knob, "0\n");
  assert.deepEqual(readTiocsti(knob), { value: "0" });
  assert.deepEqual(readTiocsti(join(BASE, "no-knob")), { missing: true });
});

test("judgeSteps: a box that was not built fails `box` and skips the steps inside; tiocsti is still judged", () => {
  const steps = box.judgeSteps({ ...facts(goodObserved()), box: { built: false, reason: "bwrap is not on PATH" }, observed: undefined, tiocsti: { value: "1" } });
  const result = outcomes(steps);
  assert.equal(result.box, "fail");
  assert.equal(steps[0]?.reason, "bwrap is not on PATH");
  assert.equal(result.tiocsti, "fail");
  assert.deepEqual(steps.filter((entry) => entry.outcome === "skip").map((entry) => entry.name), box.BOX_STEPS.filter((name) => name !== "box" && name !== "tiocsti"));
  const silent = box.judgeSteps({ ...facts(goodObserved()), observed: { none: "the fake harness exited 1" } });
  assert.equal(silent[0]?.outcome, "fail");
  assert.match(silent[0]?.reason ?? "", /exited 1/u);
});

test("judgeSteps: no masked secret on the host skips that step", () => {
  const seen = goodObserved();
  seen.secrets = [];
  assert.equal(outcomes(box.judgeSteps(facts(seen)))["secret-masked"], "skip");
});

test("parseObserved reads the fake harness's report and refuses anything else", () => {
  const seen = goodObserved();
  assert.deepEqual(box.parseObserved(JSON.stringify(seen)), seen);
  assert.equal(box.parseObserved("not json"), undefined);
  assert.equal(box.parseObserved(JSON.stringify({ ...seen, web: [{ target: "x", status: true, body: "" }] })), undefined);
  assert.equal(box.parseObserved(JSON.stringify({ ...seen, sockets: {} })), undefined);
});

test("maskedSecrets and ownTargets read the plan's argv and the proxy policy", () => {
  const argv = ["bwrap", "--ro-bind", "/dev/null", "/c/alerts.json", "--tmpfs", "/c/keys", "--ro-bind", "/dev/null", "/h/app.sock", "--ro-bind", "/dev/null", "/c/alerts.json", "--", "darius", "--ro-bind", "/dev/null", "/after"];
  assert.deepEqual(box.maskedSecrets(argv, (path) => path.endsWith(".sock")), ["/c/alerts.json"]);
  const targets = box.ownTargets(["127.0.0.1", "2001:db8::1"], [{ host: "", port: 4747 }, { host: "darius.example.com", port: 443 }]);
  assert.deepEqual(targets.web, ["127.0.0.1:4747", "[2001:db8::1]:4747", "darius.example.com:443"]);
  assert.deepEqual(targets.ssh, ["127.0.0.1:22", "[2001:db8::1]:22"]);
});

// --- the ledger line ----------------------------------------------------------------

test("boxCheckedLine: host from the ledger, darius, bwrap and kernel versions, pass or fail, the failed steps", () => {
  const seen = goodObserved();
  seen.policy = { path: seen.policy.path, result: "ok" };
  const check = box.boxCheckOf({ host: HOST, bwrap: "0.11.0", kernel: "6.1.0-test", run: "r1" }, box.judgeSteps(facts(seen)));
  assert.equal(check.outcome, "fail");
  assert.deepEqual(check.failed, ["policy-write"]);
  const line = box.boxCheckedLine(check, "tester");
  assert.deepEqual({ ...line, detail: undefined }, {
    who: "tester",
    type: "box.checked",
    darius: VERSION,
    bwrap: "0.11.0",
    kernel: "6.1.0-test",
    outcome: "fail",
    failed: ["policy-write"],
    skipped: [],
    run: "r1",
    detail: undefined,
  });
  assert.match(String(line.detail), /^policy-write: policy\.json opened in the box/u);
  const global = openProject("ledger-line", { create: true });
  const written = appendLine(global, line);
  assert.equal(written.host, HOST);
  const pass = box.boxCheckedLine(box.boxCheckOf({ host: HOST, bwrap: "0.11.0", kernel: "6.1.0", run: "r2" }, box.judgeSteps(facts(goodObserved()))), "tester");
  assert.equal(pass.outcome, "pass");
  assert.equal(pass.detail, undefined);
});

// --- the gate -----------------------------------------------------------------------

/** A stand-in check: records that it ran, appends its line, passes or fails. */
function fakeCheck(outcome: "pass" | "fail", ran: string[]): (global: Project, who: string) => Promise<BoxCheck> {
  return (global, who) => {
    ran.push(who);
    const steps = box.judgeSteps(facts(goodObserved(), outcome === "pass" ? {} : { tiocsti: { value: "1" } }));
    const check = box.boxCheckOf({ host: HOST, bwrap: "0.11.0", kernel: "6.1.0", run: ulid() }, steps);
    appendLine(global, box.boxCheckedLine(check, who));
    return Promise.resolve(check);
  };
}

function seedCheck(global: Project, input: { darius: string; outcome: "pass" | "fail"; at?: string; kernel?: string; bwrap?: string }): void {
  const line = { who: "test", type: "box.checked", darius: input.darius, bwrap: input.bwrap ?? "0.11.0", kernel: input.kernel ?? "6.1.0", outcome: input.outcome, failed: input.outcome === "pass" ? [] : ["tiocsti"], skipped: [] };
  appendLine(global, input.at === undefined ? line : { ...line, at: input.at });
}

const STACK = { kernel: "6.1.0", bwrap: "0.11.0" };

async function gate(global: Project | null, ran: string[], options: { isDryRun?: boolean; outcome?: "pass" | "fail"; isBox?: boolean; stack?: { kernel: string; bwrap: string } } = {}): Promise<{ result: Awaited<ReturnType<typeof box.boxReadiness>>; heard: BoxCheck[] }> {
  const heard: BoxCheck[] = [];
  const result = await box.boxReadiness({
    today: localToday(),
    isDryRun: options.isDryRun ?? false,
    who: "gate-test",
    isBox: options.isBox ?? true,
    openGlobal: () => global,
    onCheck: (check) => heard.push(check),
    runCheck: fakeCheck(options.outcome ?? "pass", ran),
    stack: options.stack ?? STACK,
  });
  return { result, heard };
}

test("the gate: outside the box it is always ready and checks nothing", async () => {
  const ran: string[] = [];
  const { result } = await gate(openProject("gate-off", { create: true }), ran, { isBox: false });
  assert.deepEqual(result, { ready: true });
  assert.deepEqual(ran, []);
});

test("the gate: a fresh passing check for this host and version skips the check", async () => {
  const global = openProject("gate-fresh", { create: true });
  seedCheck(global, { darius: VERSION, outcome: "pass" });
  const ran: string[] = [];
  assert.deepEqual((await gate(global, ran)).result, { ready: true });
  assert.deepEqual(ran, [], "no check ran");
});

test("the gate: no check runs one first; a pass lets the runs start, and the next ask reads its line", async () => {
  const global = openProject("gate-none", { create: true });
  const ran: string[] = [];
  const first = await gate(global, ran);
  assert.deepEqual(first.result, { ready: true });
  assert.deepEqual(ran, ["gate-test"]);
  assert.equal(first.heard.length, 1);
  const again = await gate(global, ran);
  assert.deepEqual(again.result, { ready: true });
  assert.equal(ran.length, 1, "the pass is in the ledger now");
});

test("the gate: a failed check skips as box-broken, and one from today is not run again", async () => {
  const global = openProject("gate-failed", { create: true });
  const ran: string[] = [];
  const first = await gate(global, ran, { outcome: "fail" });
  assert.equal(first.result.ready, false);
  assert.match(first.result.ready ? "" : first.result.detail, /failed: tiocsti; run darius box check$/u);
  const today = await gate(global, ran, { outcome: "pass" });
  assert.equal(today.result.ready, false, "failed today: no second check this day");
  assert.match(today.result.ready ? "" : today.result.detail, /failed today: tiocsti/u);
  assert.equal(ran.length, 1);

  const older = openProject("gate-failed-yesterday", { create: true });
  seedCheck(older, { darius: VERSION, outcome: "fail", at: new Date(Date.now() - 2 * 86_400_000).toISOString() });
  const next = await gate(older, ran, { outcome: "pass" });
  assert.deepEqual(next.result, { ready: true }, "a failure from an earlier day is checked again");
  assert.equal(ran.length, 2);
});

test("the gate: a new darius version needs a new check, and another host's pass does not count", async () => {
  const global = openProject("gate-version", { create: true });
  seedCheck(global, { darius: "0.0.1", outcome: "pass" });
  const ran: string[] = [];
  assert.deepEqual((await gate(global, ran)).result, { ready: true });
  assert.equal(ran.length, 1, "0.0.1's pass is not this version's");
  assert.equal(box.latestBoxCheck(readLedger(global), { host: "other-host", darius: VERSION, ...STACK }), undefined);
  assert.equal(box.latestBoxCheck(readLedger(global), { host: HOST, darius: VERSION, ...STACK })?.outcome, "pass");
});

test("the gate: a new kernel release or bwrap version needs a new check", async () => {
  const global = openProject("gate-stack", { create: true });
  seedCheck(global, { darius: VERSION, outcome: "pass" });
  const ran: string[] = [];
  assert.deepEqual((await gate(global, ran)).result, { ready: true });
  assert.equal(ran.length, 0, "the same kernel and bwrap: the pass holds");
  const kernel = await gate(global, ran, { isDryRun: true, stack: { ...STACK, kernel: "6.2.0" } });
  assert.match(kernel.result.ready ? (kernel.result.pending ?? "") : "", /would run darius box check for darius .*, kernel 6\.2\.0, bwrap 0\.11\.0 first/u);
  await gate(global, ran, { stack: { ...STACK, kernel: "6.2.0" } });
  assert.equal(ran.length, 1, "a kernel update runs the check");
  await gate(global, ran, { stack: { ...STACK, bwrap: "0.12.0" } });
  assert.equal(ran.length, 2, "a bwrap update runs the check");
});

test("the gate: a dry run with no check says it would check first, and runs nothing", async () => {
  const ran: string[] = [];
  const { result } = await gate(openProject("gate-dry", { create: true }), ran, { isDryRun: true });
  assert.equal(result.ready, true);
  assert.match(result.ready ? (result.pending ?? "") : "", /would run darius box check/u);
  assert.deepEqual(ran, []);
});

// --- run-due --------------------------------------------------------------------------

function seedRitual(project: string): void {
  const now = new Date().toISOString();
  const header: Ritual = { id: ulid(), kind: "ritual", slug: "heartbeat", title: "Heartbeat", created: now, updated: now, tags: [], cadence: "1d", anchor: "due", policy: { mode: "report", may: [], hold: [] } };
  openProject(project, { create: true }).writeItem({ header, body: "Complete the run.\n" }, { who: "test" });
}

test("run-due in the box: a failed check from today skips the ritual as box-broken; a pass reaches the harness gate", async (t) => {
  process.env.DARIUS_RUN_SANDBOX = "box";
  // A stand-in bwrap that passes the probe and names a version, so the gate keys on this kernel and it.
  const fakeBwrap = join(BASE, "fake-bwrap");
  writeFileSync(fakeBwrap, '#!/bin/sh\n[ "$1" = --version ] && echo "bubblewrap 9.9.9"\nexit 0\n', { mode: 0o755 });
  const before = process.env.DARIUS_BWRAP;
  process.env.DARIUS_BWRAP = fakeBwrap;
  t.after(() => {
    delete process.env.DARIUS_RUN_SANDBOX;
    process.env.DARIUS_BWRAP = before;
  });
  const global = openProject("_global", { create: true });
  const stack = box.boxStack();
  assert.deepEqual(stack, { kernel: release(), bwrap: "9.9.9" });
  seedCheck(global, { darius: VERSION, outcome: "fail", ...stack });
  seedRitual("rd-broken");
  const broken = await runDue({ projects: ["rd-broken"], isDryRun: false, who: "test", timeoutMs: 60_000, now: {} });
  const entry = broken.report.projects[0]?.rituals[0];
  assert.equal(entry?.action, "skipped", JSON.stringify(entry));
  assert.equal(entry?.reason, "box-broken");
  assert.match(entry?.detail ?? "", /box check of darius .+ failed today/u);
  assert.equal(broken.report.ok, false, "box-broken fails the batch");
  assert.equal(broken.report.boxChecks, undefined, "no check ran");

  seedCheck(global, { darius: VERSION, outcome: "pass", ...stack });
  seedRitual("rd-ready");
  const ready = await runDue({ projects: ["rd-ready"], isDryRun: false, who: "test", timeoutMs: 60_000, now: {} });
  const next = ready.report.projects[0]?.rituals[0];
  assert.equal(next?.reason, "harness-unchecked", "past the box gate, the harness version cannot be read here");
  assert.equal(ready.report.boxChecks, undefined);
  assert.equal(readLedger(global).filter((line) => line.type === "box.checked").length, 2, "no check was added");
});

// --- the CLI ----------------------------------------------------------------------

/** What one CLI call gave. */
interface CliRun {
  status: number | null;
  stdout: string;
  stderr: string;
}

function cli(args: readonly string[], cwd: string): CliRun {
  const env = { ...process.env, DARIUS_BOX_MARKER: join(BASE, "no-box-marker") };
  const ran = spawnSync(BIN, args, { cwd, env, encoding: "utf8", timeout: 60_000 });
  return { status: ran.status, stdout: ran.stdout, stderr: ran.stderr };
}

test("cli: box enter and box connect read no marker, link or store; box status takes the normal path", () => {
  const checkout = join(BASE, "checkout");
  mkdirSync(checkout, { recursive: true });
  writeFileSync(join(checkout, ".darius.toml"), 'v = 3\nproject = "cli-box"\ntz = "UTC"\nkinds = ["ritual", "vigil", "milestone"]\n');
  const tree = join(STORE, "cli-box", "tracker");
  mkdirSync(join(tree, "M1-alpha"), { recursive: true });
  writeFileSync(join(tree, "M1-alpha", "01-one.md"), "# One\n");
  const link = join(checkout, ".tracker");
  symlinkSync(tree, link);

  const enter = cli(["box", "enter", "--relay-port", "3128", "--", "true"], checkout);
  assert.equal(enter.status, 1, enter.stderr);
  assert.match(enter.stderr, /not in a box/u);
  const connect = cli(["box", "connect", "192.0.2.1", "22", "--proxy", join(BASE, "no-proxy.sock")], checkout);
  assert.equal(connect.status, 1, connect.stderr);
  for (const ran of [enter, connect]) assert.doesNotMatch(ran.stderr, /removed the old \.tracker link/u);
  assert.ok(lstatSync(link, { throwIfNoEntry: false })?.isSymbolicLink(), "enter and connect left the old link alone: they read nothing");

  const status = cli(["box", "status"], checkout);
  assert.equal(status.status, 0, status.stderr);
  assert.match(status.stderr, /removed the old \.tracker link/u, "status runs on the normal path");
  assert.match(status.stdout, /darius /u);
  const json = cli(["box", "status", "--json"], checkout);
  const parsed: { checks: { host: string; darius: string; outcome: string }[] } = JSON.parse(json.stdout);
  assert.ok(parsed.checks.some((entry) => entry.host === HOST && entry.darius === VERSION && entry.outcome === "pass"), json.stdout);
});

test("doctor lines: the box state and the newest check of this host", () => {
  const ledger = readLedger(openProject("_global"));
  const lines = box.boxDoctorLines(ledger, true);
  assert.match(lines[0] ?? "", /sandbox = "box"/u);
  assert.match(lines[1] ?? "", new RegExp(`newest box check: ✓ ${HOST}, darius ${VERSION.replaceAll(".", "\\.")}: pass`, "u"));
  assert.deepEqual(box.boxDoctorLines([], false), [], "no box and no check: nothing to say");
  assert.match(box.boxDoctorLines([], true).join("\n"), /WARN: no box check on box-check-test yet/u);
});

// --- the real box -------------------------------------------------------------------

test("real bwrap: the whole box check on this host, in a temp store and a temp home", { skip: SKIP_REAL, timeout: 300_000 }, async (t) => {
  process.env.DARIUS_BWRAP = REAL_BWRAP ?? "";
  // A harness login and two secrets the box must mask, all placeholders.
  mkdirSync(join(HOME, ".claude", "projects"), { recursive: true });
  writeFileSync(join(HOME, ".claude", "settings.json"), "{}\n");
  mkdirSync(join(HOME, ".aws"), { recursive: true });
  writeFileSync(join(HOME, ".aws", "credentials"), "[default]\naws_secret_access_key = aws-secret-placeholder\n");
  writeFileSync(join(CONFIG, "alerts.json"), '{"token":"telegram-token-placeholder"}\n');
  const global = openProject("real-global", { create: true });
  const before = readdirSync(tmpdir()).filter((name) => name.startsWith("darius-box-check-"));

  const check = await box.runBoxCheck({ global, who: "real-test" });
  for (const entry of check.steps) t.diagnostic(`${entry.name}: ${entry.outcome}, ${entry.reason}`);
  t.diagnostic(`outcome ${check.outcome}, darius ${check.darius}, bwrap ${check.bwrap}, kernel ${check.kernel}`);

  const result = outcomes(check.steps);
  for (const name of ["box", "store-write", "policy-write", "claude-settings-write", "secret-masked", "docker-socket", "tailscale-socket", "system-bus", "systemd-run", "web-api", "ssh-port", "broker-complete"]) {
    assert.equal(result[name], "pass", `${name}: ${check.steps.find((entry) => entry.name === name)?.reason ?? ""}`);
  }
  assert.notEqual(result["public-https"], "fail", "online it opens, offline it is skipped");
  assert.equal(result.tiocsti, box.judgeTiocsti(readTiocsti()).outcome, "the knob of this kernel");
  assert.equal(check.outcome, result.tiocsti === "pass" ? "pass" : "fail");
  assert.notEqual(check.bwrap, "none");

  const lines = readLedger(global).filter((line) => line.type === "box.checked");
  assert.equal(lines.length, 1);
  assert.equal(lines[0]?.host, HOST);
  assert.equal(lines[0]?.darius, VERSION);
  assert.equal(lines[0]?.outcome, check.outcome);
  assert.equal(lines[0]?.run, check.run);

  const after = readdirSync(tmpdir()).filter((name) => name.startsWith("darius-box-check-"));
  assert.deepEqual(after, before, "the temp store and work dir are gone");
  const boxes = join(RUNTIME, "darius-box");
  assert.deepEqual(existsSync(boxes) ? readdirSync(boxes) : [], [], "the box dir is gone");
  assert.equal(existsSync(join(STORE, "box-check")), false, "the throwaway project lived in the temp store only");
});
