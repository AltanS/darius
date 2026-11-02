/**
 * The mask (src/core/sandbox.ts): what it hides, how a host turns it off, what
 * happens when it fails, and the proof on the real bubblewrap: a masked file,
 * an exit code, a signal, and a timeout that ends the whole process tree. The
 * real-bwrap tests skip where bwrap is absent or user namespaces are off, as in
 * the Nix build sandbox. No test here reaches a real store, config or harness.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

import { loadConfig, loadConfigIfPresent } from "../src/core/config.ts";
import { appendLine, readLedger } from "../src/core/ledger.ts";
import { isInsideMask, maskedPaths, noteSandbox, probeBwrap, resolveSandbox, sandboxPrefix, sandboxWarning } from "../src/core/sandbox.ts";
import { openProject } from "../src/core/store.ts";
import { launchHeadless } from "../src/surface/headless.ts";
import { maskLine } from "../src/surface/herdr.ts";

const SANDBOX = realpathSync(mkdtempSync(join(tmpdir(), "darius-sandbox-")));
const CONFIG = join(SANDBOX, "config");
const STATE = join(SANDBOX, "state");
const REPO = join(import.meta.dirname, "..");
mkdirSync(CONFIG, { recursive: true });
mkdirSync(STATE, { recursive: true });
process.env.DARIUS_CONFIG_DIR = CONFIG;
process.env.DARIUS_STATE_DIR = STATE;
// The mask is opt-in since 0.114.1. These tests are about the mask, so this process turns it on.
process.env.DARIUS_RUN_SANDBOX = "mask";
delete process.env.DARIUS_RUN;
delete process.env.DARIUS_RUN_POLICY;

/** bash by full path. The Nix build sandbox has no /usr/bin/env for a shebang to use. */
const BASH =
  (process.env.PATH ?? "")
    .split(delimiter)
    .map((dir) => join(dir, "bash"))
    .find((candidate) => candidate.startsWith("/") && existsSync(candidate)) ?? "/bin/bash";

function script(name: string, body: string): string {
  const file = join(SANDBOX, name);
  writeFileSync(file, `#!${BASH}\n${body}\n`);
  chmodSync(file, 0o755);
  return file;
}

/** A bwrap that passes its probes and runs what follows its flags, without any mask. */
const FAKE_BWRAP = script("fake-bwrap", `while [ $# -gt 0 ] && [ "$1" != -- ] && [ "$1" != true ]; do shift; done\n[ "\${1:-}" = -- ] && shift\nexec "$@"`);

/** A real bwrap that works here, found without DARIUS_BWRAP, which the suite points at a missing file. */
const REAL_BWRAP = (process.env.PATH ?? "")
  .split(delimiter)
  .map((dir) => join(dir, "bwrap"))
  .find((candidate) => candidate.startsWith("/") && existsSync(candidate) && spawnSync(candidate, ["--dev-bind", "/", "/", "true"]).status === 0);
const NO_BWRAP = REAL_BWRAP === undefined ? "no working bwrap on this host" : false;

function withBwrap<T>(bin: string, run: () => T): T {
  const previous = process.env.DARIUS_BWRAP;
  process.env.DARIUS_BWRAP = bin;
  try {
    return run();
  } finally {
    if (previous === undefined) delete process.env.DARIUS_BWRAP;
    else process.env.DARIUS_BWRAP = previous;
  }
}

function realPrefix(): readonly string[] {
  const sandbox = withBwrap(REAL_BWRAP ?? "", () => resolveSandbox());
  assert.equal(sandbox.state, "mask", JSON.stringify(sandbox));
  return sandboxPrefix(sandbox) ?? [];
}

// --- config ----------------------------------------------------------------------------

function isolatedConfig(text: string, run: () => void): void {
  const dir = mkdtempSync(join(SANDBOX, "cfg-"));
  writeFileSync(join(dir, "config.toml"), text);
  const previous = process.env.DARIUS_CONFIG_DIR;
  process.env.DARIUS_CONFIG_DIR = dir;
  try {
    run();
  } finally {
    process.env.DARIUS_CONFIG_DIR = previous;
  }
}

test("[run] sandbox: off by default, mask with one line, an unknown value refused", () => {
  delete process.env.DARIUS_RUN_SANDBOX;
  try {
  isolatedConfig('host = "a"\n', () => {
    assert.equal(loadConfig().run.sandbox, "off");
    assert.deepEqual(resolveSandbox(), { state: "off" }, "the default never looks for bwrap");
  });
  isolatedConfig('host = "a"\n\n[run]\nsandbox = "mask"\n', () => assert.equal(loadConfig().run.sandbox, "mask"));
  isolatedConfig('host = "a"\n\n[run]\nsandbox = "off"\n', () => {
    assert.equal(loadConfig().run.sandbox, "off");
    assert.deepEqual(resolveSandbox(), { state: "off" }, "off never looks for bwrap");
    assert.equal(sandboxWarning(), undefined);
  });
  isolatedConfig('host = "a"\n\n[run]\nsandbox = "maybe"\n', () => {
    assert.throws(() => loadConfig(), /\[run\] sandbox must be "mask" or "off", found "maybe"/u);
    assert.throws(() => resolveSandbox(), /sandbox must be/u, "a bad value does not run unmasked in silence");
    assert.match(sandboxWarning() ?? "", /^WARN: cannot read the sandbox setting/u);
  });
  } finally {
    process.env.DARIUS_RUN_SANDBOX = "mask";
  }
});

test("DARIUS_RUN_SANDBOX overrides [run] sandbox for one process; another value is ignored", () => {
  isolatedConfig('host = "a"\n\n[run]\nsandbox = "mask"\n', () => {
    process.env.DARIUS_RUN_SANDBOX = "off";
    try {
      assert.deepEqual(resolveSandbox(), { state: "off" });
      process.env.DARIUS_RUN_SANDBOX = "maybe";
      assert.notEqual(resolveSandbox().state, "off", "an unknown value falls back to the file");
    } finally {
      process.env.DARIUS_RUN_SANDBOX = "mask";
    }
  });
});

// --- what is masked ---------------------------------------------------------------------

test("maskedPaths: every direct file but config.toml, links.toml and their backups, keys/, and credentials elsewhere; symlinks resolved", () => {
  const dir = mkdtempSync(join(SANDBOX, "mask-"));
  const elsewhere = mkdtempSync(join(SANDBOX, "secrets-"));
  for (const name of ["config.toml", "config.toml.bak", "links.toml", "links.toml.bak-2026-10-01", "credentials", "push.json", "email.json", "web.env", "next.env", "snapshot-credentials", "snapshot.json", "a-new-file"]) {
    writeFileSync(join(dir, name), "x\n");
  }
  mkdirSync(join(dir, "keys"));
  mkdirSync(join(dir, "other-dir"));
  writeFileSync(join(elsewhere, "linked"), "x\n");
  symlinkSync(join(elsewhere, "linked"), join(dir, "linked-secret"));
  symlinkSync(join(elsewhere, "missing"), join(dir, "dangling"));
  writeFileSync(join(elsewhere, "s3"), "x\n");
  const previous = process.env.DARIUS_CONFIG_DIR;
  process.env.DARIUS_CONFIG_DIR = dir;
  writeFileSync(join(dir, "config.toml"), `host = "a"\n\n[remote]\nendpoint = "https://s3.example.com"\nbucket = "b"\ncredentials = "${join(elsewhere, "s3")}"\n`);
  try {
    const { files, dirs } = maskedPaths(loadConfigIfPresent());
    assert.deepEqual(dirs, [join(dir, "keys")]);
    const masked = new Set(files);
    for (const name of ["credentials", "push.json", "email.json", "web.env", "next.env", "snapshot-credentials", "snapshot.json", "a-new-file"]) assert.ok(masked.has(join(dir, name)), name);
    assert.ok(masked.has(join(elsewhere, "linked")), "the target of a symlink");
    assert.ok(masked.has(join(elsewhere, "s3")), "remote.credentials elsewhere");
    for (const name of ["config.toml", "config.toml.bak", "links.toml", "links.toml.bak-2026-10-01", "other-dir", "dangling", "linked-secret"]) assert.equal(masked.has(join(dir, name)), false, name);
  } finally {
    process.env.DARIUS_CONFIG_DIR = previous;
  }
});

test("the mask argv: bwrap, the fixed head, the masks, then --", () => {
  const dir = mkdtempSync(join(SANDBOX, "argv-"));
  writeFileSync(join(dir, "push.json"), "{}\n");
  mkdirSync(join(dir, "keys"));
  const previous = process.env.DARIUS_CONFIG_DIR;
  process.env.DARIUS_CONFIG_DIR = dir;
  try {
    assert.deepEqual(sandboxPrefix(withBwrap(FAKE_BWRAP, () => resolveSandbox())), [
      FAKE_BWRAP, "--dev-bind", "/", "/", "--die-with-parent", "--tmpfs", join(dir, "keys"), "--ro-bind", "/dev/null", join(dir, "push.json"), "--",
    ]);
  } finally {
    process.env.DARIUS_CONFIG_DIR = previous;
  }
});

test("maskLine types an alias that runs the harness in the mask, and a marker the echoed line does not hold", () => {
  const line = maskLine("claude", ["/x/bwrap", "--ro-bind", "/dev/null", "/a b/it's"]);
  assert.match(line, /^ alias claude='/u, "a leading blank, and the kind's own name");
  assert.equal(line.includes("darius-mask-ready"), false, "only the output holds the whole marker");
  assert.match(line, /; echo darius-mask''-ready$/u);
  const alias = spawnSync(BASH, ["-c", `shopt -s expand_aliases\n${line.split("; echo")[0] ?? ""}\nalias claude`], { encoding: "utf8" });
  assert.match(alias.stdout, /\/a b\/it/u, "the shell reads the quoted path");
});

// --- a sandbox failure never stops a ritual ------------------------------------------------

test("no bwrap: unmasked, with one line in the run's log and a doctor warning that names the fix", () => {
  withBwrap(join(SANDBOX, "no-bwrap"), () => {
    const sandbox = resolveSandbox();
    assert.equal(sandbox.state, "unmasked");
    assert.equal(sandboxPrefix(sandbox), undefined);
    assert.match(sandboxWarning() ?? "", /^WARN: unattended runs on this host start unmasked.*Install bubblewrap.*\[run\] sandbox = "off"/u);
    const runDir = mkdtempSync(join(SANDBOX, "run-"));
    noteSandbox(runDir, sandbox);
    const log = readFileSync(join(runDir, "run.log"), "utf8").trim().split("\n");
    assert.equal(log.length, 1);
    assert.match(log[0] ?? "", /sandbox: this run starts UNMASKED/u);
  });
});

test("a bwrap that fails its probe, as with user namespaces off: unmasked, and the reason names it", () => {
  const failing = script("failing-bwrap", 'echo "bwrap: setting up uid map: Permission denied" >&2\nexit 1');
  withBwrap(failing, () => {
    const sandbox = resolveSandbox();
    assert.equal(sandbox.state, "unmasked");
    assert.match(sandbox.state === "unmasked" ? sandbox.problem : "", /--dev-bind \/ \/ true failed \(exit 1: bwrap: setting up uid map/u);
    assert.deepEqual(probeBwrap(), { problem: `${failing} --dev-bind / / true failed (exit 1: bwrap: setting up uid map: Permission denied). Install bubblewrap and allow unprivileged user namespaces, or set [run] sandbox = "off" in config.toml.` });
  });
});

test("a bwrap that passes bare but fails with the masks: unmasked, not a broken launch", () => {
  const picky = script("picky-bwrap", '[ "$4" = true ] && exit 0\nexit 1');
  withBwrap(picky, () => assert.equal(resolveSandbox().state, "unmasked"));
});

test("a harness that cannot start keeps its failure text behind the mask", async () => {
  const prefix = sandboxPrefix(withBwrap(FAKE_BWRAP, () => resolveSandbox())) ?? [];
  const result = await launchHeadless({ bin: join(SANDBOX, "no-claude"), argv: [], cwd: SANDBOX, env: { PATH: process.env.PATH ?? "" }, timeoutMs: 5000, sandbox: prefix });
  assert.match(result.spawnError ?? "", /no-claude is not on PATH/u);
});

// --- the proof on the real bwrap ------------------------------------------------------------

function seedSecrets(): void {
  writeFileSync(join(CONFIG, "config.toml"), 'host = "h1"\n');
  writeFileSync(join(CONFIG, "credentials"), "[default]\naws_access_key_id = placeholder\naws_secret_access_key = placeholder\n", { mode: 0o600 });
  writeFileSync(join(CONFIG, "push.json"), JSON.stringify({ v: 1, subject: "mailto:a@example.com", public: "pub", private: "priv", since: "2026-01-01T00:00:00.000Z" }), { mode: 0o600 });
  writeFileSync(join(CONFIG, "email.json"), "{}\n", { mode: 0o600 });
  mkdirSync(join(CONFIG, "keys"), { recursive: true });
  writeFileSync(join(CONFIG, "keys", "one"), "placeholder\n");
}

test("real bwrap: a masked file cannot be opened, config.toml can, keys is empty, a later file is not masked, the exit code passes", { skip: NO_BWRAP }, async () => {
  seedSecrets();
  const probe = script(
    "probe",
    [
      `cat ${join(CONFIG, "credentials")} 2>/dev/null; echo "credentials=$?"`,
      `cat ${join(CONFIG, "config.toml")} >/dev/null; echo "config=$?"`,
      `ls ${join(CONFIG, "keys")} | wc -l | tr -d ' ' | sed 's/^/keys=/'`,
      `(echo x > ${join(CONFIG, "credentials")}) 2>/dev/null; echo "write=$?"`,
      "exit 42",
    ].join("\n"),
  );
  const result = await launchHeadless({ bin: probe, argv: [], cwd: SANDBOX, env: { PATH: process.env.PATH ?? "" }, timeoutMs: 20_000, sandbox: realPrefix() });
  assert.equal(result.exitCode, 42, result.stderrTail);
  assert.equal(result.signal, null);
  assert.equal(result.timedOut, false);
  assert.deepEqual(result.stdout.trim().split("\n"), ["credentials=1", "config=0", "keys=0", "write=1"]);
  assert.match(readFileSync(join(CONFIG, "credentials"), "utf8"), /aws_access_key_id/u, "the real file did not change");
});

test("real bwrap: a harness killed by a signal reads as exit 128 + the signal", { skip: NO_BWRAP }, async () => {
  const killed = script("killed", "kill -TERM $$");
  const result = await launchHeadless({ bin: killed, argv: [], cwd: SANDBOX, env: { PATH: process.env.PATH ?? "" }, timeoutMs: 20_000, sandbox: realPrefix() });
  assert.equal(result.exitCode, 143);
  assert.equal(result.timedOut, false);
});

/** Gone, or a zombie that only waits for its reaper: /proc says so. */
function isRunning(pid: number): boolean {
  try {
    return !/^\d+ \(.*\) Z /u.test(readFileSync(`/proc/${String(pid)}/stat`, "utf8"));
  } catch {
    return false;
  }
}

/** A killed process leaves the table a moment after its pipes close. */
async function stopsRunning(pid: number): Promise<boolean> {
  for (let tries = 0; tries < 30; tries += 1) {
    if (!isRunning(pid)) return true;
    await new Promise((resolve) => {
      setTimeout(resolve, 100);
    });
  }
  return false;
}

test("real bwrap: a timeout ends the whole tree, also children that ignore SIGTERM, with or without a pipe to darius", { skip: NO_BWRAP, timeout: 40_000 }, async () => {
  for (const [name, redirect] of [["piped", ""], ["pipeless", "exec >/dev/null 2>&1"]] as const) {
    const pids = join(SANDBOX, `tree-${name}`);
    const long = script(
      `long-${name}`,
      [
        `echo "$$" >> ${pids}`,
        `( trap '' TERM; ${redirect || ":"}; echo "$BASHPID" >> ${pids}; while :; do sleep 0.2; done ) &`,
        name === "piped" ? `sleep 300 & echo "$!" >> ${pids}` : `sleep 300 >/dev/null 2>&1 & echo "$!" >> ${pids}`,
        ...(name === "piped" ? [] : ["exec >/dev/null 2>&1"]),
        "wait",
      ].join("\n"),
    );
    const result = await launchHeadless({ bin: long, argv: [], cwd: SANDBOX, env: { PATH: process.env.PATH ?? "" }, timeoutMs: 1000, sandbox: realPrefix() });
    assert.equal(result.timedOut, true, name);
    const listed = readFileSync(pids, "utf8").trim().split("\n").map(Number);
    assert.equal(listed.length, 3, name);
    for (const pid of listed) assert.equal(await stopsRunning(pid), true, `${name}: pid ${String(pid)} still runs`);
  }
});

interface CliResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** The CLI in the mask, as a run calls it. */
function inMask(prefix: readonly string[], args: readonly string[], env: Record<string, string> = {}): CliResult {
  const [program = "", ...flags] = prefix;
  const done = spawnSync(program, [...flags, join(REPO, "bin", "darius"), ...args], {
    cwd: SANDBOX,
    encoding: "utf8",
    env: { ...process.env, DARIUS_CONFIG_DIR: CONFIG, DARIUS_STATE_DIR: STATE, ...env },
  });
  return { code: done.status, stdout: done.stdout, stderr: done.stderr };
}

test("real bwrap: the verbs a run calls work in the mask, under both runtimes; nothing there needs a masked file", { skip: NO_BWRAP, timeout: 120_000 }, () => {
  seedSecrets();
  const project = openProject("mask-verbs", { create: true });
  const prefix = realPrefix();
  for (const runtime of ["node", "bun"]) {
    const env = { DARIUS_RUNTIME: runtime, DARIUS_PROJECT: project.name, DARIUS_WHO: "claude:test" };
    const run = `01MASK${runtime.toUpperCase()}`;
    appendLine(project, { who: "test", type: "run.started", run, item: "ritual/heartbeat" });
    assert.equal(inMask(prefix, ["flare", "list", "--json", "--project", project.name], env).code, 0);

    const push = inMask(prefix, ["push", "status"], env);
    assert.equal(push.code, 0, push.stderr);
    assert.match(push.stdout, /the sandbox mask hides the push keys/u);
    assert.equal(inMask(prefix, ["push", "status", "--json"], env).code, 0);

    const email = inMask(prefix, ["email", "status"], env);
    assert.equal(email.code, 1, "a hidden file is a clean refusal");
    assert.match(email.stdout + email.stderr, /the sandbox mask hides email\.json/u);
    assert.equal(/0666|chmod/u.test(email.stdout + email.stderr), false, "not a wrong reason");

    const policy = join(SANDBOX, `policy-${runtime}.json`);
    writeFileSync(policy, JSON.stringify({ v: 1, project: project.name, ritual: "heartbeat", run, mode: "report", may: [], hold: [], gate: "full", grants: [] }));
    const hook = spawnSync(prefix[0] ?? "", [...prefix.slice(1), join(REPO, "bin", "darius"), "policy-check", "--policy", policy, "--preflight"], {
      cwd: SANDBOX,
      encoding: "utf8",
      input: JSON.stringify({ session_id: "s", tool_name: "Bash", tool_input: { command: "true" } }),
      env: { ...process.env, ...env, DARIUS_CONFIG_DIR: CONFIG, DARIUS_STATE_DIR: STATE },
    });
    assert.equal(hook.status, 2, hook.stderr);
    assert.match(hook.stdout, /deny/u);

    const held = inMask(prefix, ["run", "hold", run, "--project", project.name, "--question", "may I?", "--who", "claude:test"], env);
    assert.equal(held.code, 0, held.stderr);
  }
  const run = "01MASKDONE";
  appendLine(project, { who: "test", type: "run.started", run, item: "ritual/heartbeat" });
  const done = inMask(prefix, ["run", "complete", run, "--project", project.name, "--outcome", "complete", "--who", "claude:test"]);
  assert.equal(done.code, 0, done.stderr);
});

test("real bwrap: sync fails loudly and names the mask; a flush in the mask leaves no alert.failed line", { skip: NO_BWRAP, timeout: 60_000 }, () => {
  seedSecrets();
  writeFileSync(join(CONFIG, "config.toml"), `host = "h1"\n\n[remote]\nendpoint = "https://s3.example.com"\nbucket = "b"\ncredentials = "${join(CONFIG, "credentials")}"\n`);
  const project = openProject("mask-sync", { create: true });
  appendLine(project, { who: "test", type: "flare.lit", key: "k", title: "T", severity: "high", source: "script" });
  const prefix = realPrefix();
  const sync = inMask(prefix, ["sync", "--project", project.name]);
  assert.notEqual(sync.code, 0);
  assert.match(sync.stderr, /the sandbox mask hides this file/u);
  const flush = inMask(prefix, ["push", "flush"]);
  assert.equal(flush.code, 0, flush.stderr);
  assert.match(flush.stdout, /the runner sends after the run/u);
  assert.deepEqual(readLedger(project).filter((line) => line.type === "alert.failed"), [], "no try of a notice was used up");
  writeFileSync(join(CONFIG, "config.toml"), 'host = "h1"\n');
});

test("real bwrap: isInsideMask knows, from the file it sees; a process outside keeps its access", { skip: NO_BWRAP }, () => {
  seedSecrets();
  assert.equal(isInsideMask(), false, "this test runs outside, as the runner's flush does");
  assert.match(readFileSync(join(CONFIG, "push.json"), "utf8"), /"private"/u);
  const stat = spawnSync(realPrefix()[0] ?? "", [...realPrefix().slice(1), "stat", "-c", "%F", join(CONFIG, "push.json")], { encoding: "utf8" });
  assert.match(stat.stdout, /character special/u);
});
