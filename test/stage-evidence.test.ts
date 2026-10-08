/**
 * `darius worklog set-stage` evidence rules through the CLI (0.72.0), under
 * both runtimes: the exit codes of the probe contract and the stamp fields in
 * `worklog list --json`. The rule details are covered by the legacy suite.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BIN = join(import.meta.dirname, "..", "bin", "darius");
const RUNTIMES = ["node", "bun"] as const;

interface CliResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

interface Checkout {
  root: string;
  id: string;
}

function cli(argv: string[], cwd: string, runtime: string): CliResult {
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: join(cwd, ".home"), DARIUS_RUNTIME: runtime };
  delete env.CLAUDE_CODE_SESSION_ID;
  delete env.CLAUDE_SESSION_ID;
  const r = spawnSync(BIN, argv, { encoding: "utf8", env, cwd, timeout: 20_000 });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

function git(cwd: string, args: string[]): void {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
}

/** A checkout with milestone M1-t and one open thread at `planned`. */
function checkout(withGit: boolean, runtime: string): Checkout {
  const root = mkdtempSync(join(tmpdir(), "darius-stage-"));
  mkdirSync(join(root, ".tracker", "worklog"), { recursive: true });
  mkdirSync(join(root, ".tracker", "M1-t"), { recursive: true });
  writeFileSync(join(root, ".tracker", "M1-t", "01-a.md"), "# A\n");
  if (withGit) {
    git(root, ["init", "-q"]);
    git(root, ["-c", "user.email=t@example.com", "-c", "user.name=T", "-c", "commit.gpgsign=false", "commit", "-q", "--allow-empty", "-m", "base"]);
  }
  const opened = cli(["worklog", "open", "M1-t", "--spec", ".tracker/M1-t/01-a.md", "--stage", "planned", "--session", "s1"], root, runtime);
  assert.equal(opened.code, 0, opened.stderr);
  return { root, id: opened.stdout.trim() };
}

test("set-stage refuses with exit 1, and needs a reason for --force (exit 2), under both runtimes", () => {
  for (const runtime of RUNTIMES) {
    const { root, id } = checkout(true, runtime);
    const skip = cli(["worklog", "set-stage", id, "committed"], root, runtime);
    assert.equal(skip.code, 1, runtime);
    assert.match(skip.stderr, /skips verified/u);
    const verified = cli(["worklog", "set-stage", id, "verified"], root, runtime);
    assert.equal(verified.code, 1);
    assert.match(verified.stderr, /no passing ledger line/u);
    const bare = cli(["worklog", "set-stage", id, "verified", "--force"], root, runtime);
    assert.equal(bare.code, 2);
    assert.match(bare.stderr, /--force needs a non-empty --reason/u);
    const forced = cli(["worklog", "set-stage", id, "verified", "--force", "--reason", "smoke"], root, runtime);
    assert.equal(forced.code, 0, forced.stderr);
    assert.match(forced.stdout, /verified \(forced\)/u);
    // Since 0.76.0 committed needs artifacts touched by the commits, or --no-code.
    const noArtifacts = cli(["worklog", "set-stage", id, "committed"], root, runtime);
    assert.equal(noArtifacts.code, 1);
    assert.match(noArtifacts.stderr, /records no artifacts/u);
    const committed = cli(["worklog", "set-stage", id, "committed", "--no-code", "smoke test, no code"], root, runtime);
    assert.equal(committed.code, 0, committed.stderr);

    const list = JSON.parse(cli(["worklog", "list", "--json"], root, runtime).stdout);
    const thread = list.threads[0];
    assert.equal(thread.stageStamp.noCode, "smoke test, no code");
    assert.equal(thread.stage, "committed");
    assert.equal(thread.session, "s1");
    assert.match(thread.stageStamp.head, /^[0-9a-f]{40}$/u);
    assert.equal(thread.stageStamp.commit, thread.stageStamp.head);
    assert.ok(thread.stageStamp.host.length > 0);
    assert.deepEqual(thread.stamps.map((s: { stage: string }) => s.stage), ["planned", "verified", "committed"]);
  }
});

test("set-stage committed outside git exits 3 unless --no-git, under both runtimes", () => {
  for (const runtime of RUNTIMES) {
    const { root, id } = checkout(false, runtime);
    assert.equal(cli(["worklog", "set-stage", id, "verified", "--force", "--reason", "no ledger"], root, runtime).code, 0);
    const refused = cli(["worklog", "set-stage", id, "committed"], root, runtime);
    assert.equal(refused.code, 3, runtime);
    assert.match(refused.stderr, /--no-git/u);
    const ok = cli(["worklog", "set-stage", id, "committed", "--no-git"], root, runtime);
    assert.equal(ok.code, 0, ok.stderr);
    const thread = JSON.parse(cli(["worklog", "list", "--json"], root, runtime).stdout).threads[0];
    assert.equal(thread.stageStamp.commit, "none");
  }
});
