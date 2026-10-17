/**
 * Sandboxed repos for the Work Loop tests (0.101.0): a store-mode repo and a
 * git-mode repo, each with two milestones. Every call gets its own state and
 * config dirs under a throwaway root, so a test never reads or writes the
 * operator's real store.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { commitAll, initRepo } from "./git.ts";

const BIN = join(import.meta.dirname, "..", "..", "bin", "darius");

/** A throwaway host: its own HOME, state dir and config dir. */
export interface Host {
  root: string;
  state: string;
  env: NodeJS.ProcessEnv;
}

export interface Run {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** Makes a host under a fresh temp dir. The caller removes `root` when done. */
export function makeHost(prefix: string): Host {
  const root = mkdtempSync(join(tmpdir(), `${prefix}-`));
  mkdirSync(join(root, "config"), { recursive: true });
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: root,
    CLAUDE_CONFIG_DIR: join(root, ".claude"),
    DARIUS_STATE_DIR: join(root, "state"),
    DARIUS_CONFIG_DIR: join(root, "config"),
    DARIUS_WHO: "dev@example.com",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
  };
  for (const name of ["DARIUS_PROJECT", "DARIUS_TRACKER_ROOT", "DARIUS_CHECKOUT_ROOT", "CLAUDE_CODE_SESSION_ID", "CLAUDE_SESSION_ID"]) delete env[name];
  return { root, state: join(root, "state"), env };
}

export function removeHost(host: Host): void {
  rmSync(host.root, { recursive: true, force: true });
}

/** Runs the darius CLI. `extraEnv` adds to the host env (a value of undefined removes it). `input` goes to stdin. */
export function darius(host: Host, argv: string[], cwd: string, extraEnv: Record<string, string | undefined> = {}, input = ""): Run {
  const env: NodeJS.ProcessEnv = { ...host.env, DARIUS_RUNTIME: "node" };
  for (const [name, value] of Object.entries(extraEnv)) {
    if (value === undefined) delete env[name];
    else env[name] = value;
  }
  const result = spawnSync(BIN, argv, { cwd, env, encoding: "utf8", timeout: 60_000, input });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** Runs the CLI and fails the test when the exit code is not 0. */
export function ok(host: Host, argv: string[], cwd: string): string {
  const run = darius(host, argv, cwd);
  if (run.code !== 0) throw new Error(`darius ${argv.join(" ")}: exit ${String(run.code)}\n${run.stdout}${run.stderr}`);
  return run.stdout;
}

/** The text of a spec with one runnable task (`test -f out.txt`). */
export function specText(title: string): string {
  return [
    "---",
    "updated: 2026-10-08",
    "depends_on: []",
    "agent: unassigned",
    "template: generic",
    "---",
    "",
    `# ${title}`,
    "",
    "## Goal",
    "",
    "Create `out.txt`.",
    "",
    "## Ground Truth",
    "",
    "The repo has README.md only.",
    "",
    "## Verification Checklist",
    "",
    "- [ ] Create `out.txt`",
    "  - Command: `test -f out.txt`",
    "  - Expected: `exit 0`",
    "",
  ].join("\n");
}

/** A repo with two milestones: `M1-alpha` (specs 01 and 02) and `M2-beta` (spec 01). */
export interface WorkRepo {
  dir: string;
  /** The tracker tree: the store tree, or `<dir>/.tracker` in git mode. */
  tree: string;
  /** Spec paths, tracker-relative. */
  alpha1: string;
  alpha2: string;
  beta1: string;
}

/**
 * Makes the repo. `mode` store: a `milestone` kind in the marker, the tree in
 * the store and no `.tracker` in the checkout. `mode` git: a v2 marker and a real
 * `.tracker/` folder.
 */
export function makeWorkRepo(host: Host, mode: "store" | "git", name: string): WorkRepo {
  const dir = join(host.root, name);
  mkdirSync(dir, { recursive: true });
  initRepo(dir);
  writeFileSync(join(dir, "README.md"), "# repo\n");
  if (mode === "git") writeFileSync(join(dir, ".darius.toml"), `v = 2\nproject = "${name}"\n`);
  ok(host, mode === "git" ? ["init"] : ["init", "--project", name], dir);
  commitAll(dir, "darius init");
  ok(host, ["add", "milestone", "--name", "Alpha", "--slug", "alpha", "--owner", "dev@example.com"], dir);
  ok(host, ["add", "spec", "--milestone", "alpha", "--name", "Spec one", "--template", "generic"], dir);
  ok(host, ["add", "spec", "--milestone", "alpha", "--name", "Spec two", "--template", "generic"], dir);
  ok(host, ["add", "milestone", "--name", "Beta", "--slug", "beta", "--owner", "dev@example.com"], dir);
  ok(host, ["add", "spec", "--milestone", "beta", "--name", "Spec one", "--template", "generic"], dir);
  const tree = mode === "git" ? join(dir, ".tracker") : join(host.state, name, "tracker");
  const repo: WorkRepo = { dir, tree, alpha1: "M1-alpha/01-spec-one.md", alpha2: "M1-alpha/02-spec-two.md", beta1: "M2-beta/01-spec-one.md" };
  writeFileSync(join(tree, repo.alpha1), specText("Spec one"));
  writeFileSync(join(tree, repo.alpha2), specText("Spec two"));
  writeFileSync(join(tree, repo.beta1), specText("Spec one"));
  ok(host, ["index", "--rebuild"], dir);
  return repo;
}
