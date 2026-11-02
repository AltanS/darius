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
import { accessSync, constants, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

import { boxPlan, type BoxPlan } from "../src/core/box.ts";
import { hostBoxFacts, prepareBox, removeBox } from "../src/core/box-host.ts";
import { claudeHarness } from "../src/harness/claude.ts";

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
function runInBox(plan: BoxPlan): Promise<Ran> {
  const [bin = "", ...args] = plan.argv;
  return new Promise((done) => {
    const child = spawn(bin, args, { cwd: WORK, env: { PATH: process.env.PATH ?? "" }, timeout: 30_000 });
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
  for (const name of ["GH_TOKEN", "AWS_SECRET_ACCESS_KEY", "DBUS_SESSION_BUS_ADDRESS", "DARIUS_BWRAP", "DARIUS_RUN_SANDBOX", "DARIUS_STATE_DIR", "DARIUS_CONFIG_DIR"]) {
    assert.equal(outcome.env[name], undefined, `${name} does not reach the box`);
  }
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
