/**
 * `darius skill` and `darius due --brief` (0.38.0): the generated skill file,
 * its install and uninstall, the SessionStart hook snippet, and the one-line
 * brief. Every run points CLAUDE_CONFIG_DIR, DARIUS_STATE_DIR and
 * DARIUS_CONFIG_DIR at a throwaway dir, and runs the CLI under both runtimes.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { briefLine } from "../src/cli/due.ts";
import { readStamp, renderSkill, SKILL_MAX_BYTES, TRACKER_VERB_GROUPS } from "../src/cli/skill.ts";
import { LEGACY_VERBS } from "../src/core/kinds.ts";
import { VERSION } from "../src/version.ts";

const BIN = join(import.meta.dirname, "..", "bin", "darius");
const RUNTIMES = ["node", "bun"] as const;
const SESSION_VERBS = ["due", "finding", "init", "marker", "ritual", "run"];

interface Sandbox {
  root: string;
  env: NodeJS.ProcessEnv;
}

interface CliResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function sandbox(): Sandbox {
  const root = mkdtempSync(join(tmpdir(), "darius-skill-"));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: join(root, "home"),
    CLAUDE_CONFIG_DIR: join(root, "claude"),
    DARIUS_STATE_DIR: join(root, "state"),
    DARIUS_CONFIG_DIR: join(root, "config"),
  };
  delete env.DARIUS_PROJECT;
  mkdirSync(join(root, "home"), { recursive: true });
  return { root, env };
}

function darius(env: NodeJS.ProcessEnv, argv: string[], opts: { runtime?: string; cwd?: string } = {}): CliResult {
  const result = spawnSync(BIN, argv, {
    encoding: "utf8",
    env: { ...env, DARIUS_RUNTIME: opts.runtime ?? "node" },
    cwd: opts.cwd ?? tmpdir(),
    timeout: 20_000,
  });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

test("the skill stays under 7168 bytes, and its stamp names this version and hashes the body", () => {
  const { env } = sandbox();
  for (const runtime of RUNTIMES) {
    const result = darius(env, ["skill"], { runtime });
    assert.equal(result.code, 0, result.stderr);
    assert.ok(Buffer.byteLength(result.stdout) < SKILL_MAX_BYTES, `${runtime}: ${String(Buffer.byteLength(result.stdout))} bytes`);
    const stamp = readStamp(result.stdout);
    assert.ok(stamp !== null);
    assert.equal(stamp.version, VERSION);
    const body = result.stdout.slice(0, result.stdout.indexOf("<!-- darius-skill"));
    assert.equal(stamp.hash, createHash("sha256").update(body).digest("hex").slice(0, 12));
    assert.ok(result.stdout.startsWith("---\nname: darius\ndescription: "));
    assert.equal(darius(env, ["--skill"], { runtime }).stdout, result.stdout, "--skill is an alias");
  }
});

test("the skill names may_extra, hold_extra, marker check --resolved and marker factor", () => {
  const { env } = sandbox();
  const text = darius(env, ["skill"]).stdout;
  assert.match(text, /`may_extra` and `hold_extra`/u);
  assert.match(text, /`marker check --resolved <slug>`/u);
  assert.match(text, /; marker factor \[--write\] moves rules that rituals share into \[policies\.\*\] \|/u);
  assert.match(text, /input to the skill with `args`/u);
  assert.match(text, /\| `darius marker check \[dir\] \[--resolved <slug>\]` \|/u);
});

test("the verb table lists the session verbs only, in registry order", () => {
  const { env } = sandbox();
  const text = darius(env, ["skill"]).stdout;
  const listed = [...text.matchAll(/^\| `darius (\S+)/gmu)].map((match) => match[1]);
  assert.deepEqual(listed, SESSION_VERBS);
  for (const hidden of ["setup", "update", "serve", "tui", "selftest", "harness", "push", "link", "profile", "policy-check", "import", "sync", "vigil", "skill"]) {
    assert.doesNotMatch(text, new RegExp(`\\| \`darius ${hidden}\\b`, "u"), hidden);
  }
  const help = darius(env, ["help"]).stdout;
  assert.match(help, /darius setup/, "help still lists every command");
});

test("the skill states the one decision rule and lists only real tracker verbs, one group per line", () => {
  const { env } = sandbox();
  const text = darius(env, ["skill"]).stdout;
  assert.match(text, /darius owns every tracker verb\. Rituals and runs live in the darius store; the rest is in the store or git, as `kinds` in \.darius\.toml says\./u);
  assert.match(text, /imported open ones are heavy \(the sweep skips them\) until `vigil set <slug> --no-heavy`/u);
  assert.match(text, /With `milestone`, the tracker tree is in the store and \.tracker\/ in the checkout is a link to it;/u);
  assert.match(text, /so never `git add` it\./u);
  assert.match(text, /moved by `darius onboard`/u);
  for (const [group, verbs] of TRACKER_VERB_GROUPS) {
    assert.ok(text.includes(`- ${group}: ${verbs}\n`), group);
    for (const match of verbs.matchAll(/`([a-z-]+)/gu)) {
      assert.ok(LEGACY_VERBS.has(match[1] ?? ""), `${group}: ${match[1] ?? ""} is not a tracker verb`);
    }
  }
});

test("skill status: exit 1 and the fix with no skill, exit 0 for a user-level or a plugin's stamped skill", () => {
  const { root, env } = sandbox();
  const none = darius(env, ["skill", "status"]);
  assert.equal(none.code, 1);
  assert.match(none.stdout, /darius skill install/u);

  const plugin = join(root, "claude", "plugins", "cache", "market", "tracker", "11.0.0");
  mkdirSync(join(plugin, "skills", "darius"), { recursive: true });
  writeFileSync(join(plugin, "skills", "darius", "SKILL.md"), darius(env, ["skill"]).stdout);
  const listed = { version: 2, plugins: { "tracker@market": [{ scope: "user", installPath: plugin }] } };
  writeFileSync(join(root, "claude", "plugins", "installed_plugins.json"), JSON.stringify(listed));
  const fromPlugin = darius(env, ["skill", "status", "--json"], { runtime: "bun" });
  assert.equal(fromPlugin.code, 0, fromPlugin.stderr);
  const [generated, ...others] = JSON.parse(fromPlugin.stdout);
  assert.deepEqual(generated, { name: "darius", path: join(plugin, "skills", "darius", "SKILL.md"), state: "ok", version: VERSION, source: "plugin" });
  assert.equal(others.length, 11 + 3, "11 files and 3 hooks");
  assert.ok(others.every((entry: { state: string; source: string }) => entry.state === "missing" && entry.source === "user"));
  const setup = JSON.parse(darius(env, ["setup", "--json"]).stdout);
  const step = setup.steps.find((entry: { what: string }) => entry.what === "skill");
  assert.match(step.detail, /a plugin teaches/u);
  assert.doesNotMatch(step.detail, /skill install/u);

  assert.equal(darius(env, ["skill", "install"]).code, 0);
  assert.equal(JSON.parse(darius(env, ["skill", "status", "--json"]).stdout)[0].source, "user");
});

test("setup names darius skill install when no skill teaches darius", () => {
  const { env } = sandbox();
  const setup = JSON.parse(darius(env, ["setup", "--json"]).stdout);
  const step = setup.steps.find((entry: { what: string }) => entry.what === "skill");
  assert.match(step.detail, /darius skill install/u);
});

test("renderSkill is pure: an unmarked command is hidden, a marked one shows its usage", () => {
  const text = renderSkill(
    [
      { name: "alpha", summary: "a session verb", audience: "session", usage: "alpha one|two" },
      { name: "beta", summary: "an operator verb" },
    ],
    "9.9.9",
  );
  assert.match(text, /\| `darius alpha one\\\|two` \| a session verb \|/u);
  assert.doesNotMatch(text, /beta/u);
  assert.equal(readStamp(text)?.version, "9.9.9");
});

test("the skill teaches backups: the snapshot verbs, the secret on stdin only, and never in argv or the repo", () => {
  const text = renderSkill([], "9.9.9");
  assert.match(text, /^## Backups$/mu);
  assert.match(text, /printf %s "\$SECRET" \| darius snapshot credentials set --key-id ID/u);
  assert.match(text, /Never put the secret in a command line, a flag, or a file in the repo\./u);
  assert.match(text, /snapshot list \[--remote\]/u);
  assert.match(text, /Exit 3: the bucket could not be reached/u);
});

test("install writes the file and prints its path; a second install writes nothing", () => {
  const { root, env } = sandbox();
  const file = join(root, "claude", "skills", "darius", "SKILL.md");
  const first = darius(env, ["skill", "install"]);
  assert.equal(first.code, 0, first.stderr);
  assert.equal(first.stdout.trim().split("\n")[0], file, "the generated skill comes first, then the other 12 paths");
  assert.equal(readFileSync(file, "utf8"), darius(env, ["skill"]).stdout);
  const second = darius(env, ["skill", "install", "--json"], { runtime: "bun" });
  assert.equal(second.code, 0, second.stderr);
  assert.equal(JSON.parse(second.stdout).result, "unchanged");
  assert.ok(JSON.parse(second.stdout).files.every((entry: { result: string }) => entry.result === "unchanged"));
});

test("install refuses a file without a darius stamp, exit 1, and leaves it alone", () => {
  const { root, env } = sandbox();
  const file = join(root, "claude", "skills", "darius", "SKILL.md");
  mkdirSync(join(root, "claude", "skills", "darius"), { recursive: true });
  writeFileSync(file, "the operator's own skill\n");
  const result = darius(env, ["skill", "install"]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /no darius stamp/u);
  assert.equal(readFileSync(file, "utf8"), "the operator's own skill\n");
  assert.equal(darius(env, ["skill", "uninstall"]).code, 1, "uninstall refuses it too");
  assert.ok(existsSync(file));
});

test("install replaces an older stamped file, and uninstall removes it and its dir", () => {
  const { root, env } = sandbox();
  const dir = join(root, "claude", "skills", "darius");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), "old text\n<!-- darius-skill 0.1.0 0123456789ab -->\n");
  assert.equal(JSON.parse(darius(env, ["skill", "install", "--json"]).stdout).result, "written");
  const removed = darius(env, ["skill", "uninstall"]);
  assert.equal(removed.code, 0, removed.stderr);
  assert.ok(!existsSync(dir));
  assert.ok(existsSync(join(root, "claude", "skills")), "only the darius dir goes");
  assert.equal(darius(env, ["skill", "uninstall"]).code, 0, "nothing to remove is fine");
});

test("setup refreshes a stamped skill file and installs none", () => {
  const { root, env } = sandbox();
  const file = join(root, "claude", "skills", "darius", "SKILL.md");
  const fresh = JSON.parse(darius(env, ["setup", "--json"]).stdout);
  assert.equal(fresh.steps.find((step: { what: string }) => step.what === "skill").skipped, true);
  assert.ok(!existsSync(file));
  mkdirSync(join(root, "claude", "skills", "darius"), { recursive: true });
  writeFileSync(file, "old text\n<!-- darius-skill 0.1.0 0123456789ab -->\n");
  darius(env, ["setup", "--json"]);
  assert.equal(readFileSync(file, "utf8"), darius(env, ["skill"]).stdout);
});

test("the hook snippet is valid JSON: SessionStart (5 s), Stop (15 s) and PostToolUse on Edit|Write|MultiEdit (10 s)", () => {
  const { env } = sandbox();
  const parsed = JSON.parse(darius(env, ["skill", "hook"]).stdout);
  assert.deepEqual(Object.keys(parsed.hooks), ["SessionStart", "Stop", "PostToolUse"]);
  const hook = parsed.hooks.SessionStart[0].hooks[0];
  assert.equal(hook.type, "command");
  assert.equal(hook.command, "command -v darius >/dev/null 2>&1 && darius due --brief || true");
  assert.equal(hook.timeout, 5);
  assert.equal(parsed.hooks.Stop[0].matcher, undefined);
  assert.deepEqual(parsed.hooks.Stop[0].hooks, [{ type: "command", command: "command -v darius >/dev/null 2>&1 && darius hook-stop || true", timeout: 15 }]);
  assert.equal(parsed.hooks.PostToolUse[0].matcher, "Edit|Write|MultiEdit");
  assert.deepEqual(parsed.hooks.PostToolUse[0].hooks, [{ type: "command", command: "command -v darius >/dev/null 2>&1 && darius hook-drift || true", timeout: 10 }]);
});

test("due --brief is silent outside a project, exit 0", () => {
  const { root, env } = sandbox();
  for (const runtime of RUNTIMES) {
    const result = darius(env, ["due", "--brief"], { runtime, cwd: root });
    assert.equal(result.code, 0);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "");
  }
});

test("due --brief is silent in a marked checkout whose project has no store yet", () => {
  const { root, env } = sandbox();
  const repo = join(root, "repo");
  mkdirSync(repo);
  writeFileSync(join(repo, ".darius.toml"), 'project = "acme-web"\n');
  const result = darius(env, ["due", "--brief"], { cwd: repo });
  assert.equal(result.code, 0);
  assert.equal(result.stdout, "");
});

test("due --brief: one line when a ritual is due, nothing once it is done", () => {
  const { root, env } = sandbox();
  const repo = join(root, "repo");
  mkdirSync(join(repo, "sub"), { recursive: true });
  writeFileSync(join(repo, ".darius.toml"), 'project = "acme-web"\n');
  const added = darius(env, ["ritual", "add", "weekly-report", "--title", "Weekly report", "--cadence", "1w"], { cwd: repo });
  assert.equal(added.code, 0, added.stderr);
  for (const runtime of RUNTIMES) {
    const result = darius(env, ["due", "--brief"], { runtime, cwd: join(repo, "sub") });
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stdout, "darius: weekly-report due, run: darius run start weekly-report\n");
  }
  const started = JSON.parse(darius(env, ["run", "start", "weekly-report", "--json"], { cwd: repo }).stdout);
  darius(env, ["run", "complete", started.run, "--outcome", "complete"], { cwd: repo });
  assert.equal(darius(env, ["due", "--brief"], { cwd: repo }).stdout, "");
  assert.match(darius(env, ["due"], { cwd: repo }).stdout, /acme-web\/weekly-report/u, "plain due output is unchanged");
});

test("briefLine names run now for a ritual with a policy, and the answer verb for a held run", () => {
  assert.equal(briefLine([]), null);
  assert.equal(briefLine([{ slug: "weekly-report", isDue: false, heldRun: null, mode: "report" }]), null);
  assert.equal(
    briefLine([{ slug: "weekly-report", isDue: true, heldRun: null, mode: "report" }]),
    "darius: weekly-report due, run: darius run now weekly-report",
  );
  assert.equal(
    briefLine([{ slug: "nightly-check", isDue: false, heldRun: "01RUN", mode: "act" }]),
    "darius: nightly-check held with questions for the operator, run: darius run answer 01RUN <n> <text>",
  );
  const many = ["a", "b", "c", "d", "e"].map((slug) => ({ slug, isDue: true, heldRun: null, mode: "report" as const }));
  assert.equal(briefLine(many), "darius: a, b, c and 2 more due, run: darius run now a");
});
