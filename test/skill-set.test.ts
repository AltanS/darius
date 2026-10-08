/**
 * The skill set: the generated skill and 11 static procedure skills. The
 * darius agent was retired in 0.71.0: install and setup remove a stamped
 * agents/darius.md and leave any other. Install, uninstall, status and the
 * setup refresh, each in a throwaway CLAUDE_CONFIG_DIR.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PROCEDURE_SKILLS, readStamp, skillSourceDir, stampText } from "../src/cli/skill.ts";
import { VERSION } from "../src/version.ts";

const EM_DASH = String.fromCodePoint(0x2014);
const BIN = join(import.meta.dirname, "..", "bin", "darius");
const SKILL_NAMES = ["darius", ...PROCEDURE_SKILLS.map((name) => `darius-${name}`)];

interface Sandbox {
  root: string;
  claude: string;
  env: NodeJS.ProcessEnv;
}

function sandbox(): Sandbox {
  const root = mkdtempSync(join(tmpdir(), "darius-skill-set-"));
  const claude = join(root, "claude");
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: join(root, "home"),
    CLAUDE_CONFIG_DIR: claude,
    DARIUS_STATE_DIR: join(root, "state"),
    DARIUS_CONFIG_DIR: join(root, "config"),
  };
  delete env.DARIUS_PROJECT;
  mkdirSync(join(root, "home"), { recursive: true });
  return { root, claude, env };
}

interface CliResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function darius(env: NodeJS.ProcessEnv, argv: string[], runtime = "node"): CliResult {
  const result = spawnSync(BIN, argv, { encoding: "utf8", env: { ...env, DARIUS_RUNTIME: runtime }, cwd: tmpdir(), timeout: 20_000 });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

function allPaths(claude: string): string[] {
  return SKILL_NAMES.map((name) => join(claude, "skills", name, "SKILL.md"));
}

/** Puts a darius-stamped agents/darius.md in place, as a 0.70 install left it. */
function writeOldAgent(claude: string): string {
  const path = join(claude, "agents", "darius.md");
  mkdirSync(join(claude, "agents"), { recursive: true });
  writeFileSync(path, stampText("---\nname: darius\n---\nold agent\n", "0.70.0"));
  return path;
}

interface Entry {
  name: string;
  path: string;
  state: string;
  version: string | null;
}

test("the repo holds the static text: 11 skills and no agent, with no em dash and no plugin name left", () => {
  const dir = skillSourceDir();
  for (const name of PROCEDURE_SKILLS) {
    const text = readFileSync(join(dir, `${name}.md`), "utf8");
    assert.ok(text.startsWith("---\n"), name);
    assert.ok(!text.includes(EM_DASH), `${name} has an em dash`);
    assert.doesNotMatch(text, /\/tracker:|\btracker:[a-z]|CLAUDE_PLUGIN_ROOT|delegation\.mts/u, name);
    assert.equal(readStamp(text), null, `${name} is unstamped source`);
  }
  for (const name of PROCEDURE_SKILLS) {
    assert.match(readFileSync(join(dir, `${name}.md`), "utf8"), new RegExp(`^---\\nname: darius-${name}\\n`, "u"), name);
  }
  assert.ok(!existsSync(join(dir, "agent-darius.md")), "the darius agent is retired");
  assert.match(readFileSync(join(dir, "work.md"), "utf8"), /canonical schema: `darius delegation`/u);
});

test("install writes 12 stamped files and no agent; a second install writes none", () => {
  const { claude, env } = sandbox();
  const first = darius(env, ["skill", "install", "--json"]);
  assert.equal(first.code, 0, first.stderr);
  const files = JSON.parse(first.stdout).files;
  assert.equal(files.length, 12);
  assert.ok(files.every((entry: { result: string }) => entry.result === "written"));
  for (const path of allPaths(claude)) {
    assert.ok(existsSync(path), path);
    const stamp = readStamp(readFileSync(path, "utf8"));
    assert.equal(stamp?.version, VERSION, path);
  }
  assert.ok(!existsSync(join(claude, "agents", "darius.md")), "install no longer writes the agent");
  assert.equal(JSON.parse(first.stdout).retired, "absent");
  const again = JSON.parse(darius(env, ["skill", "install", "--json"], "bun").stdout);
  assert.ok(again.files.every((entry: { result: string }) => entry.result === "unchanged"));
});

test("install refuses an unstamped file at one darius path, exit 1, and writes the rest", () => {
  const { claude, env } = sandbox();
  const mine = join(claude, "skills", "darius-sync", "SKILL.md");
  mkdirSync(join(claude, "skills", "darius-sync"), { recursive: true });
  writeFileSync(mine, "my own sync\n");
  const result = darius(env, ["skill", "install"]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /darius-sync\/SKILL\.md exists and has no darius stamp/u);
  assert.equal(readFileSync(mine, "utf8"), "my own sync\n");
  assert.ok(existsSync(join(claude, "skills", "darius-work", "SKILL.md")));
});

test("install removes an old darius-owned agents/darius.md and keeps the agents dir", () => {
  const { claude, env } = sandbox();
  const agent = writeOldAgent(claude);
  const result = darius(env, ["skill", "install", "--json"]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).retired, "removed");
  assert.ok(!existsSync(agent));
  assert.ok(existsSync(join(claude, "agents")), "the agents dir is never removed");
  assert.ok(existsSync(join(claude, "skills", "darius", "SKILL.md")));
});

test("install leaves an agents/darius.md that is not darius-owned alone, exit 0", () => {
  const { claude, env } = sandbox();
  const agent = join(claude, "agents", "darius.md");
  mkdirSync(join(claude, "agents"), { recursive: true });
  writeFileSync(agent, "my own agent\n");
  const result = darius(env, ["skill", "install", "--json"]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).retired, "kept");
  assert.equal(readFileSync(agent, "utf8"), "my own agent\n");
});

test("uninstall removes the 12 files and their dirs, also an old stamped agent, keeps agents/, and leaves an unstamped file", () => {
  const { claude, env } = sandbox();
  darius(env, ["skill", "install"]);
  const oldAgent = writeOldAgent(claude);
  const mine = join(claude, "skills", "darius-sync", "SKILL.md");
  writeFileSync(mine, "my own sync\n");
  const result = darius(env, ["skill", "uninstall"]);
  assert.equal(result.code, 1, "an unstamped file is reported");
  assert.match(result.stderr, /darius-sync\/SKILL\.md has no darius stamp; left alone/u);
  assert.equal(readFileSync(mine, "utf8"), "my own sync\n");
  for (const gone of allPaths(claude).filter((other) => other !== mine)) assert.ok(!existsSync(gone), gone);
  assert.ok(!existsSync(oldAgent), "a stamped old agent goes with the rest");
  assert.ok(existsSync(join(claude, "agents")), "the agents dir is never removed");
  assert.deepEqual(readdirSync(join(claude, "skills")), ["darius-sync"]);
  const clean = sandbox();
  darius(clean.env, ["skill", "install"]);
  const removed = darius(clean.env, ["skill", "uninstall", "--json"]);
  assert.equal(removed.code, 0, removed.stderr);
  assert.equal(JSON.parse(removed.stdout).files.filter((entry: { result: string }) => entry.result === "removed").length, 12);
  assert.deepEqual(readdirSync(join(clean.claude, "skills")), []);
});

test("status lists 12 files, one line each, all ok after install; --json is an array", () => {
  const { env } = sandbox();
  darius(env, ["skill", "install"]);
  for (const runtime of ["node", "bun"]) {
    const plain = darius(env, ["skill", "status"], runtime);
    assert.equal(plain.code, 0, plain.stderr);
    const lines = plain.stdout.trim().split("\n");
    assert.equal(lines.length, 12 + 3 + 1, "12 files, 3 hooks, the fix line");
    assert.ok(lines.slice(0, 12).every((line) => line.startsWith("ok ")), plain.stdout);
    assert.match(lines[12] ?? "", /^missing +hook SessionStart +.*settings\.json$/u);
    const entries: Entry[] = JSON.parse(darius(env, ["skill", "status", "--json"], runtime).stdout);
    assert.ok(Array.isArray(entries));
    assert.deepEqual(entries.map((entry) => entry.name), [...SKILL_NAMES, "hook SessionStart", "hook Stop", "hook PostToolUse"]);
    assert.ok(entries.slice(0, 12).every((entry) => entry.state === "ok" && entry.version === VERSION));
  }
});

test("status tells outdated, edited, unstamped and missing apart", () => {
  const { claude, env } = sandbox();
  darius(env, ["skill", "install"]);
  const work = join(claude, "skills", "darius-work", "SKILL.md");
  const plan = join(claude, "skills", "darius-work-plan", "SKILL.md");
  const sync = join(claude, "skills", "darius-sync", "SKILL.md");
  const oldBody = "old text\n";
  writeFileSync(work, `${oldBody}<!-- darius-skill 0.1.0 ${createHash("sha256").update(oldBody).digest("hex").slice(0, 12)} -->\n`);
  writeFileSync(plan, readFileSync(plan, "utf8").replace("# ", "# patched by hand "));
  writeFileSync(sync, "my own sync\n");
  rmSync(join(claude, "skills", "darius-dream", "SKILL.md"));
  const entries: Entry[] = JSON.parse(darius(env, ["skill", "status", "--json"]).stdout);
  const state = (path: string): string | undefined => entries.find((entry) => entry.path === path)?.state;
  assert.equal(state(plan), "edited");
  assert.equal(state(sync), "unstamped");
  assert.equal(state(join(claude, "skills", "darius-dream", "SKILL.md")), "missing");
  assert.equal(state(work), "outdated");
  assert.equal(entries.find((entry) => entry.path === work)?.version, "0.1.0");
});

test("setup refreshes a changed stamped file of the set, leaves an unstamped one, and installs nothing new", () => {
  const { claude, env } = sandbox();
  const fresh = JSON.parse(darius(env, ["setup", "--json"]).stdout);
  assert.equal(fresh.steps.find((step: { what: string }) => step.what === "skill").skipped, true);
  assert.ok(!existsSync(join(claude, "skills")), "setup installs nothing without the generated skill");

  darius(env, ["skill", "install"]);
  const commit = join(claude, "skills", "darius-commit", "SKILL.md");
  const sync = join(claude, "skills", "darius-sync", "SKILL.md");
  const current = readFileSync(commit, "utf8");
  writeFileSync(commit, "old text\n<!-- darius-skill 0.1.0 0123456789ab -->\n");
  writeFileSync(sync, "my own sync\n");
  const setup = JSON.parse(darius(env, ["setup", "--json"]).stdout);
  const step = setup.steps.find((entry: { what: string }) => entry.what === "skill");
  assert.equal(step.skipped, false);
  assert.match(step.detail, /^refreshed .*darius-commit\/SKILL\.md/u);
  assert.match(step.detail, /darius-sync\/SKILL\.md has no darius stamp; left alone/u);
  assert.equal(readFileSync(commit, "utf8"), current);
  assert.equal(readFileSync(sync, "utf8"), "my own sync\n");
});

test("setup removes an old stamped agents/darius.md and leaves one that is not darius-owned", () => {
  const { claude, env } = sandbox();
  darius(env, ["skill", "install"]);
  const agent = writeOldAgent(claude);
  const step = (): { skipped: boolean; detail: string } =>
    JSON.parse(darius(env, ["setup", "--json"]).stdout).steps.find((entry: { what: string }) => entry.what === "skill");
  const removed = step();
  assert.equal(removed.skipped, false);
  assert.match(removed.detail, /removed .*agents\/darius\.md/u);
  assert.ok(!existsSync(agent));
  assert.ok(existsSync(join(claude, "agents")));

  writeFileSync(agent, "my own agent\n");
  step();
  assert.equal(readFileSync(agent, "utf8"), "my own agent\n");
});

test("setup installs a missing file of the set when the generated skill is stamped", () => {
  const { claude, env } = sandbox();
  darius(env, ["skill", "install"]);
  const sync = join(claude, "skills", "darius-sync", "SKILL.md");
  const commit = join(claude, "skills", "darius-commit", "SKILL.md");
  rmSync(join(claude, "skills", "darius-sync"), { recursive: true });
  writeFileSync(commit, "my own commit\n");
  const setup = JSON.parse(darius(env, ["setup", "--json"]).stdout);
  const step = setup.steps.find((entry: { what: string }) => entry.what === "skill");
  assert.equal(step.skipped, false);
  assert.match(step.detail, /^installed .*darius-sync\/SKILL\.md; /u);
  assert.match(step.detail, /darius-commit\/SKILL\.md has no darius stamp; left alone/u);
  assert.ok(existsSync(sync));
  assert.equal(readFileSync(commit, "utf8"), "my own commit\n", "an unstamped file stays");
  assert.doesNotMatch(step.detail, /refreshed/u);
});

test("setup installs nothing when the generated skill is absent or unstamped", () => {
  const { claude, env } = sandbox();
  darius(env, ["skill", "install"]);
  rmSync(join(claude, "skills", "darius"), { recursive: true });
  rmSync(join(claude, "skills", "darius-sync"), { recursive: true });
  darius(env, ["setup", "--json"]);
  assert.ok(!existsSync(join(claude, "skills", "darius")));
  assert.ok(!existsSync(join(claude, "skills", "darius-sync")));

  mkdirSync(join(claude, "skills", "darius"), { recursive: true });
  writeFileSync(join(claude, "skills", "darius", "SKILL.md"), "my own darius skill\n");
  darius(env, ["setup", "--json"]);
  assert.ok(!existsSync(join(claude, "skills", "darius-sync")), "an unstamped generated skill is not an opt-in");
  assert.equal(readFileSync(join(claude, "skills", "darius", "SKILL.md"), "utf8"), "my own darius skill\n");
});

const SESSION = "command -v darius >/dev/null 2>&1 && darius due --brief || true";
const STOP = "command -v darius >/dev/null 2>&1 && darius hook-stop || true";
const DRIFT = "command -v darius >/dev/null 2>&1 && darius hook-drift || true";

function hookStates(env: NodeJS.ProcessEnv): Record<string, string> {
  const entries: Entry[] = JSON.parse(darius(env, ["skill", "status", "--json"]).stdout);
  return Object.fromEntries(entries.filter((entry) => entry.name.startsWith("hook ")).map((entry) => [entry.name, entry.state]));
}

test("status reports each hook state: ok, differs, missing, unreadable, no file", () => {
  const { claude, env } = sandbox();
  const file = join(claude, "settings.json");
  mkdirSync(claude, { recursive: true });
  const none = { "hook SessionStart": "missing", "hook Stop": "missing", "hook PostToolUse": "missing" };
  assert.deepEqual(hookStates(env), none, "no settings.json");

  const snippet = JSON.parse(darius(env, ["skill", "hook"]).stdout);
  writeFileSync(file, JSON.stringify({ model: "x", ...snippet }));
  assert.deepEqual(hookStates(env), { "hook SessionStart": "ok", "hook Stop": "ok", "hook PostToolUse": "ok" });
  const okText = darius(env, ["skill", "status"]).stdout;
  assert.doesNotMatch(okText, /To fix the hooks/u);

  writeFileSync(file, JSON.stringify({
    hooks: {
      SessionStart: [{ hooks: [{ type: "command", command: "darius due --brief" }] }],
      PostToolUse: [{ matcher: "Edit", hooks: [{ type: "command", command: DRIFT }] }],
      Stop: [{ hooks: [{ type: "command", command: "echo done" }] }],
    },
  }));
  assert.deepEqual(hookStates(env), { "hook SessionStart": "differs", "hook Stop": "missing", "hook PostToolUse": "differs" });
  const text = darius(env, ["skill", "status"]);
  assert.match(text.stdout, /^differs +hook SessionStart +\S*settings\.json$/mu);
  assert.match(text.stdout, /^missing +hook Stop /mu);
  assert.match(text.stdout, new RegExp(`^To fix the hooks, paste the output of darius skill hook into ${file.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}$`, "mu"));

  writeFileSync(file, JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: "command", command: SESSION }] }], Stop: [{ hooks: [{ command: STOP }] }], PostToolUse: [{ matcher: "Write|Edit", hooks: [{ command: DRIFT }] }] } }));
  assert.deepEqual(hookStates(env), { "hook SessionStart": "ok", "hook Stop": "ok", "hook PostToolUse": "ok" });

  writeFileSync(file, "{ not json");
  assert.deepEqual(hookStates(env), { "hook SessionStart": "unreadable", "hook Stop": "unreadable", "hook PostToolUse": "unreadable" });
  assert.match(darius(env, ["skill", "status"]).stdout, /^unreadable +hook Stop /mu);
});

test("status never writes settings.json, and hooks do not change the exit code", () => {
  const { claude, env } = sandbox();
  const file = join(claude, "settings.json");
  mkdirSync(claude, { recursive: true });
  writeFileSync(file, '{"hooks":{"Stop":[]}}');
  const before = statSync(file);
  const bytes = readFileSync(file, "utf8");
  assert.equal(darius(env, ["skill", "status"]).code, 1, "no skill installed");
  darius(env, ["skill", "install"]);
  assert.equal(darius(env, ["skill", "status"]).code, 0, "hooks missing, skill installed");
  darius(env, ["setup", "--json"]);
  assert.equal(readFileSync(file, "utf8"), bytes);
  assert.equal(statSync(file).mtimeMs, before.mtimeMs);
  const absent = sandbox();
  darius(absent.env, ["skill", "status"]);
  darius(absent.env, ["setup", "--json"]);
  assert.ok(!existsSync(join(absent.claude, "settings.json")), "no settings.json is created");
});

test("setup says which hooks are not ok, and nothing when all three are", () => {
  const { claude, env } = sandbox();
  mkdirSync(claude, { recursive: true });
  const skillDetail = (): string => JSON.parse(darius(env, ["setup", "--json"]).stdout).steps.find((entry: { what: string }) => entry.what === "skill").detail;
  assert.doesNotMatch(skillDetail(), /hooks:/u, "a host that never installed the skill hears nothing about hooks");
  darius(env, ["skill", "install"]);
  assert.match(skillDetail(), /hooks: missing SessionStart, missing Stop, missing PostToolUse; see darius skill hook$/u);
  writeFileSync(join(claude, "settings.json"), JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ command: SESSION }] }], PostToolUse: [{ matcher: "Edit", hooks: [{ command: DRIFT }] }] } }));
  assert.match(skillDetail(), /hooks: missing Stop, differs PostToolUse; see darius skill hook$/u);
  writeFileSync(join(claude, "settings.json"), darius(env, ["skill", "hook"]).stdout);
  assert.doesNotMatch(skillDetail(), /hooks:/u);
});
