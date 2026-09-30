/**
 * Profile resolution (src/harness/profile.ts) and what a resolved profile
 * does to the Claude Code launch (src/harness/claude.ts).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Policy, ProfileFields, Ritual } from "../src/core/model.ts";
import { claudeHarness } from "../src/harness/claude.ts";
import type { ResolvedProfile } from "../src/harness/contract.ts";
import { resolveProfile, type ProfileSources, type RepoProfiles } from "../src/harness/profile.ts";

const BASE_POLICY: Policy = { mode: "report", may: ["Bash(date)"], hold: ["git push"] };

function sources(opts: { policy?: Partial<Policy>; repo?: Partial<RepoProfiles> | null; store?: Record<string, ProfileFields> }): ProfileSources {
  const store = opts.store ?? {};
  const repo = opts.repo === undefined || opts.repo === null ? null : { profiles: {}, file: "/repo/.darius.toml", ...opts.repo };
  return { policy: { ...BASE_POLICY, ...opts.policy }, repo, global: (name) => store[name] };
}

test("no profile anywhere resolves to the built-in: claude, permissions skipped, headless, the ritual's model and turns", () => {
  const { profile, harness } = resolveProfile(sources({ policy: { model: "haiku", max_turns: 6 } }));
  assert.equal(harness.id, "claude");
  assert.deepEqual(profile, { harness: "claude", permissions: "skip", surface: "headless", args: [], model: "haiku", maxTurns: 6 });
});

test("a named profile resolves field by field: store, then repo, then the ritual's own model and turns", () => {
  const store = { fast: { model: "sonnet", effort: "low", max_turns: 10, args: ["--verbose"] } };
  const repo = { profiles: { fast: { effort: "high", permissions: "skip" as const } } };
  const { profile } = resolveProfile(sources({ policy: { profile: "fast", max_turns: 30 }, repo, store }));
  assert.deepEqual(profile, {
    name: "fast",
    harness: "claude",
    permissions: "skip",
    surface: "headless",
    args: ["--verbose"],
    model: "sonnet",
    effort: "high",
    maxTurns: 30,
  });
});

test("the default profile: the repo's [defaults] ritual, else a profile called default, else built in", () => {
  const store = { default: { model: "opus" }, cheap: { model: "haiku" } };
  assert.equal(resolveProfile(sources({ store })).profile.name, "default");
  assert.equal(resolveProfile(sources({ store })).profile.model, "opus");
  const repo = { profiles: {}, defaultRitual: "cheap" };
  assert.equal(resolveProfile(sources({ store, repo })).profile.model, "haiku");
  assert.equal(resolveProfile(sources({ store, policy: { profile: "cheap" } })).profile.model, "haiku", "the ritual wins");
  assert.equal(resolveProfile(sources({ repo: { profiles: { default: { effort: "max" } } } })).profile.effort, "max");
});

test("a named profile nobody defines, a bad effort, an unknown harness and a reserved arg are refused", () => {
  assert.throws(() => resolveProfile(sources({ policy: { profile: "ghost" } })), /profile "ghost" is not defined in the store; add it with darius profile add ghost/u);
  assert.throws(
    () => resolveProfile(sources({ policy: { profile: "ghost" }, repo: {} })),
    /is not defined in the store or \/repo\/\.darius\.toml/u,
  );
  assert.throws(() => resolveProfile(sources({ repo: { defaultRitual: "ghost" } })), /profile "ghost" is not defined/u);
  assert.throws(() => resolveProfile(sources({ store: { default: { effort: "extreme" } } })), /claude takes effort low, medium/u);
  assert.throws(() => resolveProfile(sources({ store: { default: { harness: "emacs" } } })), /unknown harness "emacs"/u);
  for (const arg of ["--settings", "--settings=/tmp/x.json", "--dangerously-skip-permissions", "--allowedTools", "-p"]) {
    assert.throws(
      () => resolveProfile(sources({ store: { default: { args: ["--verbose", arg] } } })),
      /args may not contain/u,
      arg,
    );
  }
});

// --- what the profile does to the Claude launch ----------------------------------------

const RITUAL: Ritual = {
  id: "01R",
  kind: "ritual",
  slug: "heartbeat",
  title: "Heartbeat",
  created: "2026-09-28T00:00:00Z",
  updated: "2026-09-28T00:00:00Z",
  tags: [],
  anchor: "due",
  policy: BASE_POLICY,
};

interface PlannedLaunch {
  argv: string[];
  settings: { hooks: { PreToolUse: { matcher: string }[] } };
}

function plan(profile: ResolvedProfile): PlannedLaunch {
  const dir = mkdtempSync(join(tmpdir(), "darius-profile-"));
  const files = { dir, policy: join(dir, "policy.json"), prompt: join(dir, "prompt.md") };
  const scope = claudeHarness.gateScope(profile);
  const argv = claudeHarness.prepare({ ritual: RITUAL, run: "01RUN", files, profile, scope, gate: ["/bin/darius", "policy-check"] }).headless;
  return { argv, settings: JSON.parse(readFileSync(join(dir, "settings.json"), "utf8")) };
}

function after(argv: string[], flag: string): string[] {
  const start = argv.indexOf(flag);
  if (start === -1) return [];
  const rest = argv.slice(start + 1);
  const end = rest.findIndex((token) => token.startsWith("--"));
  return end === -1 ? rest : rest.slice(0, end);
}

const GATED: ResolvedProfile = { harness: "claude", permissions: "gated", surface: "headless", args: [] };

test("gated: the allowlist in dontAsk mode, no effort, the Bash matcher, gate scope shell", () => {
  const { argv, settings } = plan(GATED);
  assert.deepEqual(after(argv, "--permission-mode"), ["dontAsk"]);
  assert.deepEqual(after(argv, "--permission-prompts"), ["none"]);
  assert.deepEqual(after(argv, "--allowedTools"), ["Bash(date)", "Read", "Grep", "Glob"]);
  assert.equal(argv.includes("--effort"), false);
  assert.equal(argv.includes("--dangerously-skip-permissions"), false);
  assert.equal(settings.hooks.PreToolUse[0]?.matcher, "Bash");
  assert.equal(claudeHarness.gateScope(GATED), "shell");
});

test("gated in a herdr tab: dontAsk refuses instead of asking, and no print-mode flag", () => {
  const dir = mkdtempSync(join(tmpdir(), "darius-profile-"));
  const files = { dir, policy: join(dir, "policy.json"), prompt: join(dir, "prompt.md") };
  const launch = claudeHarness.prepare({ ritual: RITUAL, run: "01RUN", files, profile: GATED, scope: "shell", gate: ["/bin/darius", "policy-check"] });
  assert.deepEqual(after(launch.interactive, "--permission-mode"), ["dontAsk"]);
  assert.equal(launch.interactive.includes("--permission-prompts"), false);
  assert.equal(launch.interactive.includes("-p"), false);
});

test("skip: no allowlist, the every-tool matcher, Agent denied, gate scope full; effort and args are passed", () => {
  const skip: ResolvedProfile = { ...GATED, permissions: "skip", effort: "medium", model: "opus", args: ["--verbose"] };
  const { argv, settings } = plan(skip);
  assert.equal(argv.includes("--dangerously-skip-permissions"), true);
  assert.equal(argv.includes("--permission-mode"), false);
  assert.equal(argv.includes("--allowedTools"), false);
  assert.deepEqual(after(argv, "--disallowedTools"), ["NotebookEdit", "WebFetch", "WebSearch", "Agent"], "the gate decides Write and Edit: /tmp only");
  assert.deepEqual(after(argv, "--effort"), ["medium"]);
  assert.deepEqual(after(argv, "--model"), ["opus"]);
  assert.ok(argv.indexOf("--verbose") < argv.indexOf("--disallowedTools"), "args come before the variadic tool list");
  assert.equal(settings.hooks.PreToolUse[0]?.matcher, "*");
  assert.equal(claudeHarness.gateScope(skip), "full");
});
