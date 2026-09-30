/**
 * Single writer (docs/concept.md, "Risks"): each kind has one writer module.
 * darius's native code writes the store only and never a project's
 * `.tracker/`; the vendored legacy CLI owns `.tracker/`.
 *
 * The check: in a linked repo with a `.tracker/`, every native write verb
 * runs once, and the hash of `.tracker/` is the same before and after. Each
 * verb must succeed, so a verb that silently did nothing cannot pass.
 */

import { after, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

const BIN = join(import.meta.dirname, "..", "bin", "darius");
const FIXTURE = join(import.meta.dirname, "fixtures", "tracker-mini");
const SANDBOX = mkdtempSync(join(tmpdir(), "darius-single-writer-"));
after(() => rmSync(SANDBOX, { recursive: true, force: true }));
const PROJECT = "single-writer";

/** Every file under `dir`, its relative path, mode and bytes, in one sha256. */
function treeHash(dir: string): string {
  const hash = createHash("sha256");
  const walk = (at: string): void => {
    for (const name of readdirSync(at).toSorted()) {
      const path = join(at, name);
      const stat = statSync(path);
      hash.update(`${relative(dir, path)}\0${stat.mode}\0`);
      if (stat.isDirectory()) walk(path);
      else hash.update(readFileSync(path));
    }
  };
  walk(dir);
  return hash.digest("hex");
}

function darius(repo: string, argv: string[]): string {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DARIUS_STATE_DIR: join(SANDBOX, "state"),
    DARIUS_CONFIG_DIR: join(SANDBOX, "config"),
    // A native verb must not reach the legacy tree at all.
    DARIUS_LEGACY_ENTRY: join(SANDBOX, "no-legacy.mjs"),
  };
  delete env.DARIUS_PROJECT;
  const result = spawnSync(BIN, argv, { cwd: repo, env, encoding: "utf8", input: "", timeout: 30_000 });
  assert.equal(result.status, 0, `darius ${argv.join(" ")}: ${result.stderr}`);
  return result.stdout;
}

test("every native write verb leaves .tracker/ unchanged", () => {
  const repo = join(SANDBOX, "repo");
  mkdirSync(repo, { recursive: true });
  cpSync(FIXTURE, join(repo, ".tracker"), { recursive: true });
  writeFileSync(join(repo, ".darius.toml"), `project = "${PROJECT}"\n`);
  const tracker = join(repo, ".tracker");
  const before = treeHash(tracker);

  darius(repo, ["import", ".tracker", "--project", PROJECT]);
  darius(repo, ["link"]);
  darius(repo, ["ritual", "add", "heartbeat", "--title", "Heartbeat", "--cadence", "1d"]);
  darius(repo, ["ritual", "set", "heartbeat", "--title", "Heartbeat two"]);
  darius(repo, ["ritual", "pause", "heartbeat"]);
  darius(repo, ["ritual", "resume", "heartbeat"]);
  const run: string = JSON.parse(darius(repo, ["run", "start", "heartbeat", "--json"])).run;
  darius(repo, ["run", "hold", run, "--question", "go on?"]);
  darius(repo, ["run", "answer", run, "1", "yes"]);
  darius(repo, ["run", "complete", run, "--outcome", "failed"]);
  darius(repo, ["run", "ack", run, "--note", "seen"]);
  darius(repo, ["ritual", "retire", "heartbeat"]);
  darius(repo, ["profile", "add", "single-writer-profile", "--model", "opus"]);
  darius(repo, ["profile", "set", "single-writer-profile", "--model", "sonnet"]);
  darius(repo, ["vigil", "sweep", "--project", PROJECT, "--json"]);
  darius(repo, ["due", "--json"]);

  // The verbs wrote the store: the check is not vacuous.
  assert.ok(readdirSync(join(SANDBOX, "state", PROJECT)).length > 0);
  assert.equal(treeHash(tracker), before);
});
