/**
 * The skill set of 0.60.0: the generated skill, 11 static procedure skills and
 * the darius agent. Install, uninstall, status and the setup refresh, each in
 * a throwaway CLAUDE_CONFIG_DIR.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PROCEDURE_SKILLS, readStamp, skillSourceDir } from "../src/cli/skill.ts";
import { VERSION } from "../src/version.ts";

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
  return [
    ...SKILL_NAMES.map((name) => join(claude, "skills", name, "SKILL.md")),
    join(claude, "agents", "darius.md"),
  ];
}

interface Entry {
  name: string;
  path: string;
  state: string;
  version: string | null;
}

test("the repo holds the static text: 11 skills and the agent, with no em dash and no plugin name left", () => {
  const dir = skillSourceDir();
  for (const name of [...PROCEDURE_SKILLS, "agent-darius"]) {
    const text = readFileSync(join(dir, `${name}.md`), "utf8");
    assert.ok(text.startsWith("---\n"), name);
    assert.ok(!text.includes("—"), `${name} has an em dash`);
    assert.doesNotMatch(text, /\/tracker:|\btracker:[a-z]|CLAUDE_PLUGIN_ROOT|delegation\.mts/u, name);
    assert.equal(readStamp(text), null, `${name} is unstamped source`);
  }
  for (const name of PROCEDURE_SKILLS) {
    assert.match(readFileSync(join(dir, `${name}.md`), "utf8"), new RegExp(`^---\\nname: darius-${name}\\n`, "u"), name);
  }
  assert.match(readFileSync(join(dir, "agent-darius.md"), "utf8"), /^---\nname: darius\ndescription: /u);
  assert.match(readFileSync(join(dir, "work.md"), "utf8"), /canonical schema: `darius delegation`/u);
});

test("install writes 13 stamped files; a second install writes none", () => {
  const { claude, env } = sandbox();
  const first = darius(env, ["skill", "install", "--json"]);
  assert.equal(first.code, 0, first.stderr);
  const files = JSON.parse(first.stdout).files;
  assert.equal(files.length, 13);
  assert.ok(files.every((entry: { result: string }) => entry.result === "written"));
  for (const path of allPaths(claude)) {
    assert.ok(existsSync(path), path);
    const stamp = readStamp(readFileSync(path, "utf8"));
    assert.equal(stamp?.version, VERSION, path);
  }
  const again = JSON.parse(darius(env, ["skill", "install", "--json"], "bun").stdout);
  assert.ok(again.files.every((entry: { result: string }) => entry.result === "unchanged"));
});

test("install refuses an unstamped file at one darius path, exit 1, and writes the rest", () => {
  const { claude, env } = sandbox();
  mkdirSync(join(claude, "agents"), { recursive: true });
  writeFileSync(join(claude, "agents", "darius.md"), "my own agent\n");
  const result = darius(env, ["skill", "install"]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /agents\/darius\.md exists and has no darius stamp/u);
  assert.equal(readFileSync(join(claude, "agents", "darius.md"), "utf8"), "my own agent\n");
  assert.ok(existsSync(join(claude, "skills", "darius-work", "SKILL.md")));
});

test("uninstall removes the 13 files and their dirs, keeps agents/, and leaves an unstamped file", () => {
  const { claude, env } = sandbox();
  darius(env, ["skill", "install"]);
  const mine = join(claude, "skills", "darius-sync", "SKILL.md");
  writeFileSync(mine, "my own sync\n");
  const result = darius(env, ["skill", "uninstall"]);
  assert.equal(result.code, 1, "an unstamped file is reported");
  assert.match(result.stderr, /darius-sync\/SKILL\.md has no darius stamp; left alone/u);
  assert.equal(readFileSync(mine, "utf8"), "my own sync\n");
  for (const gone of allPaths(claude).filter((other) => other !== mine)) assert.ok(!existsSync(gone), gone);
  assert.ok(existsSync(join(claude, "agents")), "the agents dir is never removed");
  assert.deepEqual(readdirSync(join(claude, "skills")), ["darius-sync"]);
  const clean = sandbox();
  darius(clean.env, ["skill", "install"]);
  const removed = darius(clean.env, ["skill", "uninstall", "--json"]);
  assert.equal(removed.code, 0, removed.stderr);
  assert.equal(JSON.parse(removed.stdout).files.filter((entry: { result: string }) => entry.result === "removed").length, 13);
  assert.deepEqual(readdirSync(join(clean.claude, "skills")), []);
});

test("status lists 13 files, one line each, all ok after install; --json is an array", () => {
  const { env } = sandbox();
  darius(env, ["skill", "install"]);
  for (const runtime of ["node", "bun"]) {
    const plain = darius(env, ["skill", "status"], runtime);
    assert.equal(plain.code, 0, plain.stderr);
    const lines = plain.stdout.trim().split("\n");
    assert.equal(lines.length, 13);
    assert.ok(lines.every((line) => line.startsWith("ok ")), plain.stdout);
    const entries: Entry[] = JSON.parse(darius(env, ["skill", "status", "--json"], runtime).stdout);
    assert.ok(Array.isArray(entries));
    assert.deepEqual(entries.map((entry) => entry.name), [...SKILL_NAMES, "agent darius"]);
    assert.ok(entries.every((entry) => entry.state === "ok" && entry.version === VERSION));
  }
});

test("status tells outdated, edited, unstamped and missing apart", () => {
  const { claude, env } = sandbox();
  darius(env, ["skill", "install"]);
  const work = join(claude, "skills", "darius-work", "SKILL.md");
  const plan = join(claude, "skills", "darius-work-plan", "SKILL.md");
  const sync = join(claude, "skills", "darius-sync", "SKILL.md");
  const agent = join(claude, "agents", "darius.md");
  const oldBody = "old text\n";
  writeFileSync(work, `${oldBody}<!-- darius-skill 0.1.0 ${createHash("sha256").update(oldBody).digest("hex").slice(0, 12)} -->\n`);
  writeFileSync(plan, readFileSync(plan, "utf8").replace("# ", "# patched by hand "));
  writeFileSync(sync, "my own sync\n");
  rmSync(join(claude, "skills", "darius-dream", "SKILL.md"));
  const entries: Entry[] = JSON.parse(darius(env, ["skill", "status", "--json"]).stdout);
  const state = (path: string): string | undefined => entries.find((entry) => entry.path === path)?.state;
  assert.equal(state(plan), "edited");
  assert.equal(state(sync), "unstamped");
  assert.equal(state(agent), "ok");
  assert.equal(state(join(claude, "skills", "darius-dream", "SKILL.md")), "missing");
  assert.equal(state(work), "outdated");
  assert.equal(entries.find((entry) => entry.path === work)?.version, "0.1.0");
});

test("setup refreshes a changed stamped file of the set, leaves an unstamped one, and installs nothing new", () => {
  const { claude, env } = sandbox();
  const fresh = JSON.parse(darius(env, ["setup", "--json"]).stdout);
  assert.equal(fresh.steps.find((step: { what: string }) => step.what === "skill").skipped, true);
  assert.ok(!existsSync(join(claude, "skills")), "setup installs nothing");

  darius(env, ["skill", "install"]);
  const commit = join(claude, "skills", "darius-commit", "SKILL.md");
  const agent = join(claude, "agents", "darius.md");
  const current = readFileSync(commit, "utf8");
  writeFileSync(commit, "old text\n<!-- darius-skill 0.1.0 0123456789ab -->\n");
  writeFileSync(agent, "my own agent\n");
  const setup = JSON.parse(darius(env, ["setup", "--json"]).stdout);
  const step = setup.steps.find((entry: { what: string }) => entry.what === "skill");
  assert.equal(step.skipped, false);
  assert.match(step.detail, /^refreshed .*darius-commit\/SKILL\.md/u);
  assert.match(step.detail, /agents\/darius\.md has no darius stamp; left alone/u);
  assert.equal(readFileSync(commit, "utf8"), current);
  assert.equal(readFileSync(agent, "utf8"), "my own agent\n");

  rmSync(join(claude, "skills", "darius-sync"), { recursive: true });
  darius(env, ["setup", "--json"]);
  assert.ok(!existsSync(join(claude, "skills", "darius-sync")), "a missing file is not installed by setup");
});
