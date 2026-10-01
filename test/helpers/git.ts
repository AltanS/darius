/**
 * Git checkouts for tests (docs/architecture/marker-v3.md, section 12).
 * A test that needs git passes `{ skip: NO_GIT }` so the suite still runs on
 * a machine without git.
 */

import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { join } from "node:path";

/** A reason string when `git` is not on PATH, else false: the `skip` option of node:test. */
export const NO_GIT: string | false = spawnSync("git", ["--version"]).status === 0 ? false : "git is not installed";

/** Fixed identity and no signing, so a commit never reads the operator's git config. */
const IDENTITY = ["-c", "user.name=darius-test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false"];

function git(dir: string, args: readonly string[]): string {
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
  const result = spawnSync("git", [...IDENTITY, ...args], { cwd: dir, env, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} in ${dir}: ${result.stderr}`);
  return result.stdout;
}

/** `git init` in `dir`, branch main. */
export function initRepo(dir: string): void {
  git(dir, ["init", "--quiet", "--initial-branch=main"]);
}

/** Stages everything and commits it. Returns `git rev-parse --short=12 HEAD`. */
export function commitAll(dir: string, message: string): string {
  git(dir, ["add", "--all"]);
  git(dir, ["commit", "--quiet", "--allow-empty", "--message", message]);
  return git(dir, ["rev-parse", "--short=12", "HEAD"]).trim();
}

/** Leaves an uncommitted change in `file`: appends a comment line, valid in TOML and most text. */
export function dirty(dir: string, file: string): void {
  appendFileSync(join(dir, file), "\n# uncommitted\n");
}
