/**
 * The box plan on the real bubblewrap (src/core/box.ts, src/core/box-host.ts).
 * A fake harness runs inside a plan built from this host's facts, with HOME,
 * the store, the config dir, the app dir and XDG_RUNTIME_DIR all pointed at a
 * throwaway tree, so nothing here reads or writes the operator's real store,
 * config or home. It proves what the box refuses and what it allows. Skipped
 * where bwrap is absent or user namespaces are off, as in the Nix build sandbox.
 *
 * The throwaway tree lives under /var/tmp when it can: the box puts a tmpfs on
 * /tmp, and a home under /tmp would hide what the root bind shows on a real host.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { accessSync, chmodSync, constants, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { createServer, type AddressInfo, type Server } from "node:net";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

import { boxPlan, type BoxPlan } from "../src/core/box.ts";
import { boxEnterPlanFields, boxFiles, hostBoxFiles, writeBoxFiles } from "../src/core/box-files.ts";
import { hostBoxFacts, prepareBox, removeBox } from "../src/core/box-host.ts";
import { decide, startBoxProxy, type Decide } from "../src/core/box-proxy.ts";
import { appendLine, readLedger } from "../src/core/ledger.ts";
import type { Policy, Ritual } from "../src/core/model.ts";
import { openProject } from "../src/core/store.ts";
import { ulid } from "../src/core/ulid.ts";
import { dariusBin } from "../src/runner/launch.ts";
import type { RitualEntry } from "../src/runner/report.ts";
import { runDue } from "../src/runner/run-due.ts";
import { claudeHarness } from "../src/harness/claude.ts";
import { VERSION } from "../src/version.ts";

/** A real bwrap that runs the box's namespaces here, found without DARIUS_BWRAP, which the suite points at a missing file. */
const REAL_BWRAP = (process.env.PATH ?? "")
  .split(delimiter)
  .map((dir) => join(dir, "bwrap"))
  .find((candidate) => candidate.startsWith("/") && existsSync(candidate) && spawnSync(candidate, ["--ro-bind", "/", "/", "--dev", "/dev", "--proc", "/proc", "--unshare-net", "--unshare-pid", "--die-with-parent", "true"]).status === 0);
const SKIP = REAL_BWRAP === undefined ? "no working bwrap with user namespaces on this host" : false;

function writableDir(path: string): boolean {
  try {
    accessSync(path, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/** Made only when the test runs; the test removes it. */
const BASE = SKIP === false ? realpathSync(mkdtempSync(join(writableDir("/var/tmp") ? "/var/tmp" : tmpdir(), "darius-box-real-"))) : join(tmpdir(), "darius-box-real-skipped");
const HOME = join(BASE, "home");
const STORE = join(HOME, ".local", "share", "darius");
const CONFIG = join(HOME, ".config", "darius");
const RUNTIME = join(BASE, "runtime");
const WORK = join(BASE, "work");
const RUN_DIR = join(STORE, "acme", "runs", "r1");
const REAL_DOCKER = "/run/docker.sock";
/** Only when the host has no docker socket: a stand-in in the fake runtime dir. Never connected to from outside the box. */
const FAKE_SOCKET = join(RUNTIME, "fake-docker.sock");
const HOME_SOCKET = join(HOME, ".config", "someapp", "app.sock");
const HIDDEN_SOCKET = join(HOME, ".config", "herdr", "herdr.sock");

function put(path: string, text: string): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text);
}

/** The fake harness: tries each write, read and connect, and prints one JSON object of outcomes. */
const HARNESS = `
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const paths = JSON.parse(process.argv[2]);
const outcome = (run) => { try { run(); return "ok"; } catch (error) { return error.code ?? String(error); } };
const write = (path) => outcome(() => fs.writeFileSync(path, "box\\n", { flag: "a" }));
const read = (path) => outcome(() => fs.readFileSync(path));
const connect = (path) => new Promise((done) => {
  const socket = net.connect(path);
  const timer = setTimeout(() => { socket.destroy(); done("timeout"); }, 3000);
  socket.on("connect", () => { clearTimeout(timer); socket.destroy(); done("ok"); });
  socket.on("error", (error) => { clearTimeout(timer); done(error.code); });
});
(async () => {
  const result = { writes: {}, reads: {}, connects: {}, homeConnects: {} };
  for (const [name, path] of Object.entries(paths.writes)) result.writes[name] = write(path);
  for (const [name, path] of Object.entries(paths.reads)) result.reads[name] = read(path);
  for (const [name, path] of Object.entries(paths.connects)) result.connects[name] = await connect(path);
  for (const [name, path] of Object.entries(paths.homeConnects)) result.homeConnects[name] = await connect(path);
  result.run = fs.readdirSync("/run").sort();
  result.boxMount = fs.readdirSync("/run/darius").sort();
  result.runtime = fs.readdirSync(process.env.XDG_RUNTIME_DIR).sort();
  result.env = process.env;
  result.interfaces = Object.keys(os.networkInterfaces()).sort();
  process.stdout.write(JSON.stringify(result));
})();
`;

interface Outcome {
  writes: Record<string, string>;
  reads: Record<string, string>;
  connects: Record<string, string>;
  homeConnects: Record<string, string>;
  run: string[];
  boxMount: string[];
  runtime: string[];
  env: Record<string, string>;
  interfaces: string[];
}

function buildTree(): void {
  put(join(CONFIG, "config.toml"), 'host = "box-test"\n');
  put(join(CONFIG, "alerts.json"), '{"token":"telegram-token-placeholder"}\n');
  put(join(STORE, "acme", "ledger.jsonl"), "");
  put(join(RUN_DIR, "policy.json"), '{"v":1}\n');
  put(join(RUN_DIR, "settings.json"), "{}\n");
  put(join(WORK, "README.md"), "work\n");
  put(join(WORK, ".git", "config"), "[core]\n");
  mkdirSync(join(WORK, ".git", "hooks"), { recursive: true });
  put(join(HOME, ".claude", "settings.json"), "{}\n");
  put(join(HOME, ".claude", ".credentials.json"), '{"login":"claude-login-placeholder"}\n');
  mkdirSync(join(HOME, ".claude", "projects"), { recursive: true });
  put(join(HOME, ".claude.json"), '{"original":true}\n');
  mkdirSync(join(HOME, ".cache"), { recursive: true });
  put(join(HOME, ".aws", "credentials"), "[default]\naws_secret_access_key = aws-secret-placeholder\n");
  put(join(HOME, ".config", "gh", "hosts.yml"), "github.com:\n  oauth_token: gh-token-placeholder\n");
  put(join(HOME, ".npmrc"), "//registry.example.com/:_authToken=npm-token-placeholder\n");
  put(join(HOME, ".ssh", "id_test"), "ssh-key-placeholder\n");
  put(join(HOME, ".bashrc"), "# rc\n");
  mkdirSync(join(HOME, ".config", "systemd", "user"), { recursive: true });
  mkdirSync(RUNTIME, { recursive: true, mode: 0o700 });
  mkdirSync(join(BASE, "app"), { recursive: true });
}

/** The env of this process for the plan: every darius and home path in the throwaway tree. */
function pointEnvAtTree(): void {
  process.env.HOME = HOME;
  process.env.DARIUS_STATE_DIR = STORE;
  process.env.DARIUS_CONFIG_DIR = CONFIG;
  process.env.DARIUS_APP_DIR = join(BASE, "app");
  process.env.XDG_RUNTIME_DIR = RUNTIME;
  delete process.env.XDG_CONFIG_HOME;
  delete process.env.CLAUDE_CONFIG_DIR;
  delete process.env.SSH_AUTH_SOCK;
  // Variables that must not reach the box.
  process.env.GH_TOKEN = "gh-token-placeholder";
  process.env.AWS_SECRET_ACCESS_KEY = "aws-secret-placeholder";
  process.env.DBUS_SESSION_BUS_ADDRESS = `unix:path=${RUNTIME}/bus`;
  process.env.DARIUS_RUN_SANDBOX = "box";
}

interface Ran {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** Runs the plan's argv without a shell, from the work dir. Async: the stand-in socket must stay served meanwhile. */
function runInBox(plan: BoxPlan, cwd: string = WORK, timeout = 30_000): Promise<Ran> {
  const [bin = "", ...args] = plan.argv;
  return new Promise((done) => {
    const child = spawn(bin, args, { cwd, env: { PATH: process.env.PATH ?? "" }, timeout });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString("utf8")));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));
    child.on("close", (code) => done({ code, stdout, stderr }));
  });
}

function listen(path: string): Promise<Server> {
  return new Promise((done, fail) => {
    const server = createServer((socket) => socket.end());
    server.on("error", fail);
    server.listen(path, () => done(server));
  });
}

test("real bwrap: the box refuses store, run policy, harness settings, git config and host socket access, and allows the work dir, gate.jsonl, scratch and caches", { skip: SKIP }, async (t) => {
  t.after(() => rmSync(BASE, { recursive: true, force: true }));
  buildTree();
  pointEnvAtTree();
  const hasRealDocker = existsSync(REAL_DOCKER);
  const server = hasRealDocker ? undefined : await listen(FAKE_SOCKET);
  t.after(() => server?.close());
  // A program's socket in the fake home, and one in a folder the box always hides.
  mkdirSync(join(HOME, ".config", "someapp"), { recursive: true });
  mkdirSync(join(HOME, ".config", "herdr"), { recursive: true });
  const homeSocket = await listen(HOME_SOCKET);
  const hiddenSocket = await listen(HIDDEN_SOCKET);
  t.after(() => {
    homeSocket.close();
    hiddenSocket.close();
  });

  const facts = hostBoxFacts({ workDir: WORK });
  assert.equal(facts.home, HOME, "the facts come from the fake home");
  assert.equal(facts.store, STORE);
  assert.equal(facts.config, CONFIG);
  assert.equal(facts.runtimeDir, RUNTIME);
  assert.deepEqual(facts.sockets.found, [HOME_SOCKET], "the scan finds the home socket and skips the hidden folder");
  // In the fake home: /var/tmp, where the tree is, is a tmpfs in the box.
  const harness = join(HOME, "harness.cjs");
  writeFileSync(harness, HARNESS);
  const paths = {
    writes: {
      store: join(STORE, "acme", "forged.jsonl"),
      ledger: join(STORE, "acme", "ledger.jsonl"),
      policy: join(RUN_DIR, "policy.json"),
      runSettings: join(RUN_DIR, "settings.json"),
      claudeSettings: join(HOME, ".claude", "settings.json"),
      gitConfig: join(WORK, ".git", "config"),
      gitHook: join(WORK, ".git", "hooks", "post-checkout"),
      config: join(CONFIG, "config.toml"),
      bashrc: join(HOME, ".bashrc"),
      systemdUnit: join(HOME, ".config", "systemd", "user", "evil.service"),
      work: join(WORK, "out.txt"),
      gate: join(RUN_DIR, "gate.jsonl"),
      scratch: join(RUN_DIR, "scratch", "note.txt"),
      cache: join(HOME, ".cache", "pkg"),
      claudeProjects: join(HOME, ".claude", "projects", "session.jsonl"),
      claudeJson: join(HOME, ".claude.json"),
    },
    reads: {
      alerts: join(CONFIG, "alerts.json"),
      aws: join(HOME, ".aws", "credentials"),
      gh: join(HOME, ".config", "gh", "hosts.yml"),
      npmrc: join(HOME, ".npmrc"),
      configToml: join(CONFIG, "config.toml"),
      sshKey: join(HOME, ".ssh", "id_test"),
      claudeLogin: join(HOME, ".claude", ".credentials.json"),
    },
    connects: hasRealDocker ? { docker: REAL_DOCKER, hidden: HIDDEN_SOCKET } : { docker: REAL_DOCKER, fakeDocker: FAKE_SOCKET, hidden: HIDDEN_SOCKET },
    homeConnects: { home: HOME_SOCKET },
  };
  const plan = boxPlan({
    bwrap: REAL_BWRAP ?? "",
    command: [process.execPath, harness, JSON.stringify(paths)],
    run: { id: "r1", dir: RUN_DIR, policy: join(RUN_DIR, "policy.json"), project: "acme" },
    workDir: WORK,
    isReport: false,
    hasTty: false,
    relayPort: 18_080,
    ritual: {},
    host: { sshAgent: false },
    harness: claudeHarness,
    envPass: [],
    facts,
  });
  prepareBox(plan);
  const ran = await runInBox(plan);
  assert.equal(ran.code, 0, ran.stderr);
  // SAFETY: the fake harness above prints exactly this shape.
  const outcome = JSON.parse(ran.stdout) as Outcome;

  for (const name of ["store", "ledger", "policy", "runSettings", "claudeSettings", "gitConfig", "gitHook", "config", "bashrc", "systemdUnit"]) {
    assert.equal(outcome.writes[name], "EROFS", `${name} write is refused`);
  }
  for (const name of ["work", "gate", "scratch", "cache", "claudeProjects", "claudeJson"]) {
    assert.equal(outcome.writes[name], "ok", `${name} write works`);
  }
  for (const name of ["alerts", "aws", "gh", "npmrc"]) assert.equal(outcome.reads[name], "EACCES", `${name} is masked`);
  for (const name of ["configToml", "sshKey", "claudeLogin"]) assert.equal(outcome.reads[name], "ok", `${name} stays readable`);
  for (const [name, result] of Object.entries(outcome.connects)) assert.equal(result, "ENOENT", `${name} cannot be reached`);
  assert.equal(outcome.homeConnects.home, "ECONNREFUSED", "a socket in the home folder is masked: a connect is refused");

  assert.deepEqual(outcome.run, ["darius"], "/run holds only the box dir; no docker, tailscale or dbus socket");
  assert.deepEqual(outcome.runtime, [], "the runtime dir is empty: no session bus");
  assert.deepEqual(outcome.interfaces, ["lo"], "no network but loopback");
  for (const name of ["GH_TOKEN", "AWS_SECRET_ACCESS_KEY", "DBUS_SESSION_BUS_ADDRESS", "DARIUS_BWRAP", "DARIUS_RUN_SANDBOX"]) {
    assert.equal(outcome.env[name], undefined, `${name} does not reach the box`);
  }
  assert.equal(outcome.env.DARIUS_STATE_DIR, STORE, "the box reads the runner's store");
  assert.equal(outcome.env.HTTPS_PROXY, "http://127.0.0.1:18080");
  assert.equal(outcome.env.DARIUS_RUN, "r1");
  assert.match(outcome.env.PATH ?? "", /^\/run\/darius\/bin:/u);

  assert.equal(existsSync(join(STORE, "acme", "forged.jsonl")), false);
  assert.equal(readFileSync(join(RUN_DIR, "policy.json"), "utf8"), '{"v":1}\n');
  assert.equal(readFileSync(join(WORK, "out.txt"), "utf8"), "box\n");
  assert.equal(readFileSync(join(RUN_DIR, "gate.jsonl"), "utf8"), "box\n");
  assert.equal(readFileSync(join(RUN_DIR, "scratch", "note.txt"), "utf8"), "box\n");
  assert.equal(readFileSync(join(HOME, ".cache", "pkg"), "utf8"), "box\n");
  assert.equal(readFileSync(join(HOME, ".claude.json"), "utf8"), '{"original":true}\n', "the real ~/.claude.json is untouched");
  assert.equal(readFileSync(plan.copies[0]?.to ?? "", "utf8"), '{"original":true}\nbox\n', "the run wrote its copy");

  removeBox(plan);
  assert.equal(existsSync(plan.boxDir), false);
});

// --- inside the box: the relay, box connect, ssh and git (spec 03) ------------------

/** A throwaway tree for the tests below. Made only when they run; each test removes its own. */
interface Tree {
  base: string;
  home: string;
  store: string;
  config: string;
  runtime: string;
  work: string;
  runDir: string;
}

/** The tree, with this process's env pointed at it, as `pointEnvAtTree` does for the first test. */
function makeTree(): Tree {
  const base = realpathSync(mkdtempSync(join(writableDir("/var/tmp") ? "/var/tmp" : tmpdir(), "darius-box-inside-")));
  const home = join(base, "home");
  const store = join(home, ".local", "share", "darius");
  const tree: Tree = { base, home, store, config: join(home, ".config", "darius"), runtime: join(base, "runtime"), work: join(base, "work"), runDir: join(store, "acme", "runs", "r2") };
  put(join(tree.config, "config.toml"), 'host = "box-test"\n');
  put(join(tree.runDir, "policy.json"), '{"v":1}\n');
  put(join(tree.work, "README.md"), "work\n");
  put(join(home, ".claude", "settings.json"), "{}\n");
  // The fake user's ssh config. What the box keeps of it keeps ssh off every real key, agent and known_hosts file.
  put(
    join(home, ".ssh", "config"),
    [
      "Include ~/.ssh/config.d/*",
      "Host *",
      "  ProxyJump bastion.example.com",
      "  IdentityFile /dev/null",
      "  IdentitiesOnly yes",
      "  IdentityAgent none",
      "  UserKnownHostsFile /dev/null",
      "  GlobalKnownHostsFile /dev/null",
      "  StrictHostKeyChecking no",
      "  BatchMode yes",
      "",
    ].join("\n"),
  );
  mkdirSync(tree.runtime, { recursive: true, mode: 0o700 });
  mkdirSync(join(base, "app"), { recursive: true });
  process.env.HOME = home;
  process.env.DARIUS_STATE_DIR = store;
  process.env.DARIUS_CONFIG_DIR = tree.config;
  process.env.DARIUS_APP_DIR = join(base, "app");
  process.env.XDG_RUNTIME_DIR = tree.runtime;
  delete process.env.XDG_CONFIG_HOME;
  delete process.env.CLAUDE_CONFIG_DIR;
  delete process.env.SSH_AUTH_SOCK;
  return tree;
}

/** The darius CLI as the box runs it, resolved outside. */
function boxedDarius(tree: Tree): string {
  return hostBoxFiles({ run: "r2", dariusBin: dariusBin(), home: tree.home, runtimeDir: tree.runtime, env: {} }).darius;
}

/** The plan for `darius box enter -- <harness argv>` in `tree`, with the box dir and its files made. */
function boxedPlan(tree: Tree, harnessArgv: readonly string[]): BoxPlan {
  const facts = hostBoxFacts({ workDir: tree.work });
  const files = hostBoxFiles({ run: "r2", dariusBin: dariusBin(), home: facts.home, runtimeDir: facts.runtimeDir, env: facts.env });
  const plan = boxPlan({
    bwrap: REAL_BWRAP ?? "",
    ...boxEnterPlanFields(files.darius, harnessArgv),
    run: { id: "r2", dir: tree.runDir, policy: join(tree.runDir, "policy.json"), project: "acme" },
    workDir: tree.work,
    isReport: false,
    hasTty: false,
    ritual: {},
    host: { sshAgent: false },
    harness: claudeHarness,
    envPass: [],
    facts,
  });
  prepareBox(plan);
  writeBoxFiles(plan.boxDir, boxFiles(files));
  return plan;
}

function listenLocal(server: Server): Promise<number> {
  // SAFETY: a TCP server that listens has an AddressInfo address.
  return new Promise((done) => server.listen({ host: "127.0.0.1", port: 0 }, () => done((server.address() as AddressInfo).port)));
}

/** The fake harness for the network proof: one JSON object of outcomes on stdout. */
const NET_HARNESS = `
const fs = require("node:fs");
const net = require("node:net");
const { spawn } = require("node:child_process");
const args = JSON.parse(process.argv[2]);
const relay = new URL(process.env.HTTP_PROXY);
const exchange = (port, host, text) => new Promise((done) => {
  const socket = net.connect(port, host);
  let got = "";
  const timer = setTimeout(() => { socket.destroy(); done("timeout"); }, 10000);
  socket.on("connect", () => socket.write(text));
  socket.on("data", (chunk) => { got += chunk; });
  socket.on("close", () => { clearTimeout(timer); done(got); });
  socket.on("error", (error) => { clearTimeout(timer); done(error.code); });
});
const get = (port) => exchange(Number(relay.port), relay.hostname, "GET http://127.0.0.1:" + port + "/hello HTTP/1.1\\r\\nHost: 127.0.0.1:" + port + "\\r\\n\\r\\n");
const run = (program, argv, input) => new Promise((done) => {
  const child = spawn(program, argv, { stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  const timer = setTimeout(() => child.kill("SIGKILL"), 20000);
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
    if (input !== undefined && stdout === input) child.stdin.end();
  });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.on("error", (error) => { clearTimeout(timer); done({ code: error.code, stdout, stderr }); });
  child.on("close", (code) => { clearTimeout(timer); done({ code, stdout, stderr }); });
  if (input === undefined) child.stdin.end(); else child.stdin.write(input);
});
(async () => {
  const result = {};
  result.allowed = await get(args.http);
  result.refused = await get(args.closed);
  result.direct = await exchange(args.http, "127.0.0.1", "GET /hello HTTP/1.1\\r\\n\\r\\n");
  result.connect = await run(args.darius, ["box", "connect", "127.0.0.1", String(args.echo)], "ping through the box\\n");
  result.connectRefused = await run(args.darius, ["box", "connect", "10.0.0.1", "22"]);
  result.sshConfig = fs.readFileSync("/run/darius/ssh_config", "utf8");
  result.boxMount = fs.readdirSync("/run/darius").sort();
  if (args.ssh) {
    result.sshG = await run("ssh", ["-G", "-p", String(args.banner), "127.0.0.1"]);
    result.ssh = await run("ssh", ["-p", String(args.banner), "127.0.0.1", "true"]);
  }
  if (args.ssh && args.git) result.git = await run("git", ["ls-remote", "ssh://git@127.0.0.1:" + args.banner + "/repo.git"]);
  process.stdout.write(JSON.stringify(result));
})();
`;

interface Child {
  code: number | string | null;
  stdout: string;
  stderr: string;
}

interface NetOutcome {
  allowed: string;
  refused: string;
  direct: string;
  connect: Child;
  connectRefused: Child;
  sshConfig: string;
  boxMount: string[];
  sshG?: Child;
  ssh?: Child;
  git?: Child;
}

function onPath(name: string): boolean {
  return (process.env.PATH ?? "").split(delimiter).some((dir) => dir.startsWith("/") && existsSync(join(dir, name)));
}

test("real bwrap: in box enter, HTTP reaches an allowed local server only through the relay, a refused target gets the proxy's line, box connect tunnels bytes, and ssh and git use the wrapper", { skip: SKIP }, async (t) => {
  const tree = makeTree();
  t.after(() => rmSync(tree.base, { recursive: true, force: true }));
  const hasSsh = onPath("ssh");
  const hasGit = onPath("git");

  const http = createHttpServer((_request, response) => response.end("hello from the test server\n"));
  const echo = createServer((socket) => socket.pipe(socket));
  // Stands in for an sshd: it keeps the first line the client sends, then hangs up. No key exchange, no auth.
  const banners: string[] = [];
  const banner = createServer((socket) => {
    socket.once("data", (chunk: Buffer) => {
      banners.push(chunk.toString("latin1").split("\r\n")[0] ?? "");
      socket.destroy();
    });
  });
  const closed = createServer();
  const httpPort = await listenLocal(http);
  const echoPort = await listenLocal(echo);
  const bannerPort = await listenLocal(banner);
  const closedPort = await listenLocal(closed);
  await new Promise((done) => closed.close(done));
  t.after(() => {
    http.close();
    echo.close();
    banner.close();
  });

  const harness = join(tree.home, "net-harness.cjs");
  writeFileSync(harness, NET_HARNESS);
  const darius = boxedDarius(tree);
  const harnessArgs = { http: httpPort, closed: closedPort, echo: echoPort, banner: bannerPort, darius, ssh: hasSsh, git: hasGit };
  const plan = boxedPlan(tree, [process.execPath, harness, JSON.stringify(harnessArgs)]);

  // The real rule always refuses loopback. This decision allows exactly the three test servers and asks the real rule for the rest.
  const allowed = new Set([httpPort, echoPort, bannerPort]);
  const allowLocal: Decide = (target, rules) => (target.host === "127.0.0.1" && allowed.has(target.port) ? { allow: true, rule: "reach", addresses: ["127.0.0.1"] } : decide(target, rules));
  const netLines: string[] = [];
  const proxy = await startBoxProxy({ socketPath: join(plan.boxDir, "proxy.sock"), policy: { net: "public", reach: [], harnessHosts: [], ownAddresses: [], webPorts: [] }, log: (line) => netLines.push(line), decide: allowLocal });
  t.after(() => proxy.close());

  const ran = await runInBox(plan, tree.work, 60_000);
  assert.equal(ran.code, 0, ran.stderr);
  // SAFETY: NET_HARNESS prints exactly this shape.
  const outcome = JSON.parse(ran.stdout) as NetOutcome;

  assert.match(outcome.allowed, /^HTTP\/1\.1 200 /u);
  assert.match(outcome.allowed, /hello from the test server/u);
  assert.match(outcome.refused, /^HTTP\/1\.1 403 /u);
  assert.match(outcome.refused, new RegExp(`darius box: refused 127\\.0\\.0\\.1:${String(closedPort)} \\(loopback\\)`, "u"));
  assert.equal(outcome.direct, "ECONNREFUSED", "no direct way to the test server: the box has its own loopback");

  assert.equal(outcome.connect.code, 0, outcome.connect.stderr);
  assert.equal(outcome.connect.stdout, "ping through the box\n");
  assert.equal(outcome.connectRefused.code, 1);
  assert.equal(outcome.connectRefused.stdout, "");
  assert.match(outcome.connectRefused.stderr, /^darius box: refused 10\.0\.0\.1:22 \(private\)/u);

  assert.ok(["box.json", "proxy.sock", "ssh_config", "bin"].every((name) => outcome.boxMount.includes(name)), outcome.boxMount.join(" "));
  assert.ok(outcome.sshConfig.includes(`\nHost *\n  ProxyCommand ${darius} box connect %h %p\n`), outcome.sshConfig);
  assert.ok(outcome.sshConfig.includes("# darius box dropped: Include ~/.ssh/config.d/*"));
  assert.ok(outcome.sshConfig.includes("# darius box dropped: ProxyJump bastion.example.com"));

  if (hasSsh) {
    assert.equal(outcome.sshG?.code, 0, outcome.sshG?.stderr);
    assert.match(outcome.sshG?.stdout ?? "", /^proxycommand .*box connect/mu, "the wrapper hands ssh the box config");
    assert.match(outcome.sshG?.stdout ?? "", /^identitiesonly yes$/mu, "the user's config is in it");
    assert.doesNotMatch(outcome.sshG?.stdout ?? "", /^proxyjump /mu);
    assert.equal(outcome.ssh?.code, 255, "the stand-in hangs up after the banner");
  }
  if (hasSsh && hasGit) assert.notEqual(outcome.git?.code, 0);
  const sshBanners = banners.filter((line) => line.startsWith("SSH-2.0-"));
  const expected = (hasSsh ? 1 : 0) + (hasSsh && hasGit ? 1 : 0);
  assert.equal(sshBanners.length, expected, `ssh and git reach the stand-in through box connect: ${JSON.stringify(banners)}`);

  // SAFETY: the proxy logs one JSON object per decision with these fields.
  const decisions = netLines.map((line) => JSON.parse(line) as { port: number; decision: string; rule: string });
  assert.ok(decisions.some((line) => line.port === httpPort && line.decision === "allow"));
  assert.ok(decisions.some((line) => line.port === closedPort && line.decision === "refuse" && line.rule === "loopback"));
  assert.ok(decisions.some((line) => line.port === 22 && line.rule === "private"));

  removeBox(plan);
});

test("real bwrap: box enter passes the exit code and a signal death out of the box", { skip: SKIP }, async (t) => {
  const tree = makeTree();
  t.after(() => rmSync(tree.base, { recursive: true, force: true }));
  const cases: [string[], number][] = [
    [["sh", "-c", "exit 7"], 7],
    [["sh", "-c", "kill -TERM $$"], 143],
    [["sh", "-c", "kill -HUP $$"], 129],
  ];
  for (const [argv, code] of cases) {
    const plan = boxedPlan(tree, argv);
    const ran = await runInBox(plan, tree.work, 60_000);
    assert.equal(ran.code, code, `${argv.join(" ")}: ${ran.stderr}`);
    removeBox(plan);
  }
});

// --- a ritual run in the box, end to end (spec 05) ---------------------------------

/**
 * The fake harness of the run-due proofs, a shell script in the fake home.
 * It first tries to forge a store file. `complete` then completes through the
 * broker; `hold` holds through the broker; `sleep` starts a child that ignores
 * SIGTERM and writes a heartbeat into the run's scratch dir, then ignores
 * SIGTERM itself.
 */
function fakeHarness(tree: Tree, bash: string): string {
  const path = join(tree.home, "fake-claude");
  writeFileSync(
    path,
    [
      `#!${bash}`,
      'if [ "${1:-}" = --version ]; then echo "2.1.999 (Claude Code)"; exit 0; fi',
      'scratch="$(dirname "$DARIUS_RUN_POLICY")/scratch"',
      'printf "%s\\n" "$PWD" > "$scratch/pwd"',
      `if touch ${join(tree.store, "acme-forged")} 2>/dev/null; then echo yes > "$scratch/forged"; fi`,
      // The box clears the env: the mode comes from a file in the fake home.
      'case "$(cat "$HOME/fake-mode")" in',
      "  complete)",
      "    printf 'boxed\\n```darius-result\\n{\"v\":1,\"status\":\"ok\",\"summary\":\"boxed run\"}\\n```\\n' \\",
      '      | darius run complete "$DARIUS_RUN" --project "$DARIUS_PROJECT" --outcome complete --findings-stdin > "$scratch/complete.out" 2>&1 ;;',
      '  hold) darius run hold "$DARIUS_RUN" --project "$DARIUS_PROJECT" --question "may I push?" > "$scratch/hold.out" 2>&1 ;;',
      "  sleep)",
      "    trap '' TERM",
      `    ( trap '' TERM; while :; do date +%s%N > "$scratch/beat"; sleep 0.1; done ) &`,
      "    sleep 60 ;;",
      "esac",
      `printf '{"type":"result","is_error":false,"session_id":"fake-session","total_cost_usd":0,"result":"done"}\\n'`,
      "",
    ].join("\n"),
  );
  chmodSync(path, 0o755);
  return path;
}

/** The run-due env for `tree`: the box, the real bwrap, the fake harness, darius on PATH in the fake home. */
function boxedRunEnv(tree: Tree): void {
  const bash = (process.env.PATH ?? "").split(delimiter).map((dir) => join(dir, "bash")).find((candidate) => candidate.startsWith("/") && existsSync(candidate)) ?? "/bin/bash";
  const localBin = join(tree.home, ".local", "bin");
  mkdirSync(localBin, { recursive: true });
  symlinkSync(dariusBin(), join(localBin, "darius"));
  process.env.PATH = `${localBin}${delimiter}${process.env.PATH ?? ""}`;
  process.env.DARIUS_CLAUDE = fakeHarness(tree, bash);
  process.env.DARIUS_BWRAP = REAL_BWRAP ?? "";
  process.env.DARIUS_RUN_SANDBOX = "box";
  process.env.DARIUS_TAILSCALE = join(tree.base, "no-tailscale");
  delete process.env.DARIUS_PROJECT;
  delete process.env.DARIUS_RUN;
  delete process.env.DARIUS_RUN_POLICY;
  // The fake's version passed its gate check on this host.
  appendLine(openProject("_global", { create: true }), { who: "test", type: "harness.checked", harness: "claude", version: "2.1.999", outcome: "passed" });
  // test/box-check.test.ts runs the box check itself; here it passed.
  appendLine(openProject("_global"), { who: "test", type: "box.checked", darius: VERSION, bwrap: "0.0.0", kernel: "test", outcome: "pass", failed: [], skipped: [] });
}

function seedBoxedRitual(project: string): void {
  const now = new Date().toISOString();
  const policy: Policy = { mode: "report", may: ["Bash(darius *)"], hold: ["git push"] };
  const header: Ritual = { id: ulid(), kind: "ritual", slug: "heartbeat", title: "Heartbeat", created: now, updated: now, tags: [], cadence: "1d", anchor: "due", policy };
  openProject(project, { create: true }).writeItem({ header, body: "Complete the run.\n" }, { who: "test" });
}

async function boxedRun(project: string, mode: string, timeoutMs = 120_000): Promise<RitualEntry | undefined> {
  writeFileSync(join(process.env.HOME ?? "", "fake-mode"), mode);
  seedBoxedRitual(project);
  const { report } = await runDue({ projects: [project], isDryRun: false, who: "test", timeoutMs, now: {} });
  return report.projects[0]?.rituals[0];
}

test("real bwrap: a ritual run in the box completes through the broker, a hold through the broker holds it, a timeout ends the tree, and each box is gone after", { skip: SKIP, timeout: 300_000 }, async (t) => {
  const tree = makeTree();
  t.after(() => rmSync(tree.base, { recursive: true, force: true }));
  boxedRunEnv(tree);

  const done = await boxedRun("acme-done", "complete");
  assert.equal(done?.action, "started", JSON.stringify(done));
  assert.equal(done?.end, "complete", JSON.stringify(done));
  const doneDir = join(tree.store, "acme-done", "runs", done?.run ?? "");
  assert.match(readFileSync(join(doneDir, "broker.jsonl"), "utf8"), /"argv":\["run","complete".*"exit":0/u, "run complete went through the broker");
  assert.equal(existsSync(join(doneDir, "scratch", "forged")), false, "the store is read-only in the box");
  assert.equal(existsSync(join(tree.store, "acme-forged")), false);
  assert.equal(readFileSync(join(doneDir, "scratch", "pwd"), "utf8").trim(), join(tree.store, "acme-done"), "no checkout: the run works in its store dir");
  const completed = readLedger(openProject("acme-done")).find((line) => line.type === "run.completed");
  assert.equal(completed?.who, `claude:${done?.run ?? ""}`);
  assert.equal(completed?.outcome, "complete");

  const held = await boxedRun("acme-hold", "hold");
  assert.equal(held?.end, "held", JSON.stringify(held));
  const heldLine = readLedger(openProject("acme-hold")).find((line) => line.type === "run.held");
  assert.deepEqual(heldLine?.questions, ["may I push?"]);
  assert.match(readFileSync(join(tree.store, "acme-hold", "runs", held?.run ?? "", "broker.jsonl"), "utf8"), /"argv":\["run","hold"/u);

  const started = Date.now();
  const slow = await boxedRun("acme-slow", "sleep", 2_000);
  assert.equal(slow?.timedOut, true, JSON.stringify(slow));
  assert.equal(slow?.end, "failed");
  assert.ok(Date.now() - started < 30_000, "the timeout ends the run, not the 60 s sleep");
  const beat = join(tree.store, "acme-slow", "runs", slow?.run ?? "", "scratch", "beat");
  assert.ok(existsSync(beat), "the child ran in the box");
  const last = readFileSync(beat, "utf8");
  await new Promise((wait) => setTimeout(wait, 600));
  assert.equal(readFileSync(beat, "utf8"), last, "the child that ignored SIGTERM is gone: the tree ended with the box");

  const boxes = join(tree.runtime, "darius-box");
  assert.deepEqual(existsSync(boxes) ? readdirSync(boxes) : [], [], "every box dir is removed, with its sockets");
});
