/**
 * `darius link` (src/cli/link.ts), the `max_mode` ceiling on
 * `ritual add|set --mode` (src/cli/ritual.ts), and the import's marker check
 * (src/cli/import.ts).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseArgs } from "../src/cli/args.ts";
import { importCommand } from "../src/cli/import.ts";
import { linkCommand } from "../src/cli/link.ts";
import { UsageError, type Command } from "../src/cli/registry.ts";
import { ritualCommand } from "../src/cli/ritual.ts";
import { readLedger } from "../src/core/ledger.ts";
import { readLinks } from "../src/core/links.ts";
import type { Ritual } from "../src/core/model.ts";
import { openProject } from "../src/core/store.ts";
import { LINKED_LINE } from "../src/core/workdir.ts";

const SANDBOX = mkdtempSync(join(tmpdir(), "darius-link-"));
process.env.DARIUS_STATE_DIR = join(SANDBOX, "state");
process.env.DARIUS_CONFIG_DIR = join(SANDBOX, "config");
delete process.env.DARIUS_PROJECT;

const FIXTURE = join(import.meta.dirname, "fixtures", "tracker-mini");

interface CliRun {
  code: number;
  stdout: string;
  stderr: string;
}

async function runCli(command: Command, argv: string[]): Promise<CliRun> {
  const args = parseArgs(argv);
  const out: string[] = [];
  const err: string[] = [];
  const { log, error } = console;
  console.log = (...parts: string[]) => out.push(parts.join(" "));
  console.error = (...parts: string[]) => err.push(parts.join(" "));
  try {
    const code = await command.run(args);
    return { code, stdout: out.join("\n"), stderr: err.join("\n") };
  } finally {
    console.log = log;
    console.error = error;
  }
}

function checkout(name: string, marker: string): string {
  const dir = join(SANDBOX, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, ".darius.toml"), marker);
  return dir;
}

function linkedLines(project: string): number {
  return readLedger(openProject(project)).filter((line) => line.type === LINKED_LINE).length;
}

// --- link -------------------------------------------------------------------------

test("link from a subdir records the checkout root, creates the project, and writes one ledger line", async () => {
  const dir = checkout("ws-a", 'v = 1\nproject = "ln-ws"\n');
  const sub = join(dir, "app", "apps");
  mkdirSync(sub, { recursive: true });
  const first = await runCli(linkCommand, [sub, "--json"]);
  assert.equal(first.code, 0, first.stderr);
  assert.deepEqual(JSON.parse(first.stdout), { project: "ln-ws", dir, outcome: "linked", recorded: true });
  assert.equal(readLinks().get("ln-ws"), dir);
  assert.equal(linkedLines("ln-ws"), 1);

  const again = await runCli(linkCommand, [dir, "--json"]);
  assert.equal(JSON.parse(again.stdout).outcome, "unchanged");
  assert.equal(linkedLines("ln-ws"), 1, "an unchanged link adds no second line");
});

test("link refuses to move a project to a second checkout without --force, and allows it once the old one is gone", async () => {
  const old = checkout("ws-b1", 'project = "ln-move"\n');
  const next = checkout("ws-b2", 'project = "ln-move"\n');
  assert.equal((await runCli(linkCommand, [old])).code, 0);
  await assert.rejects(runCli(linkCommand, [next]), /already linked to .*--force/u);
  assert.equal(readLinks().get("ln-move"), old);

  const forced = await runCli(linkCommand, [next, "--force", "--json"]);
  assert.equal(JSON.parse(forced.stdout).replaced, old);
  assert.equal(readLinks().get("ln-move"), next);
  assert.equal(linkedLines("ln-move"), 2);

  const third = checkout("ws-b3", 'project = "ln-move"\n');
  rmSync(next, { recursive: true });
  assert.equal((await runCli(linkCommand, [third])).code, 0);
  assert.equal(readLinks().get("ln-move"), third);
});

test("link without a .darius.toml is a usage error that names darius init", async () => {
  const bare = join(SANDBOX, "no-marker");
  mkdirSync(bare, { recursive: true });
  await assert.rejects(runCli(linkCommand, [bare]), (cause: Error) => cause instanceof UsageError && /Run darius init in the repo root/u.test(cause.message));
});

test("link --list shows each link and what is wrong with it", async () => {
  const listed = await runCli(linkCommand, ["--list", "--json"]);
  const links: { project: string; state: string }[] = JSON.parse(listed.stdout).links;
  assert.equal(links.find((one) => one.project === "ln-ws")?.state, "ok");
  assert.equal(links.find((one) => one.project === "ln-move")?.state, "ok");
});

// --- max_mode ---------------------------------------------------------------------

test("ritual add and set refuse a --mode above the checkout's max_mode, and allow one at or below it", async () => {
  const dir = checkout("ws-capped", 'project = "ln-capped"\nmax_mode = "report"\n');
  assert.equal((await runCli(linkCommand, [dir])).code, 0);
  const base = ["add", "beat", "--project", "ln-capped", "--title", "Beat", "--cadence", "1d"];
  await assert.rejects(runCli(ritualCommand, [...base, "--mode", "act"]), /refusing --mode act: .*max_mode = "report"/u);
  assert.equal((await runCli(ritualCommand, [...base, "--mode", "report"])).code, 0);
  await assert.rejects(runCli(ritualCommand, ["set", "beat", "--project", "ln-capped", "--mode", "act"]), /reviewed commit/u);
  // A set that does not touch --mode is not checked.
  assert.equal((await runCli(ritualCommand, ["set", "beat", "--project", "ln-capped", "--title", "Beat 2"])).code, 0);
  const doc = openProject("ln-capped").readItem<Ritual>("ritual", "beat");
  assert.equal(doc?.header.policy.mode, "report");
});

// --- import -----------------------------------------------------------------------

test("import takes the project from the source repo's marker and refuses a different one", async () => {
  const repo = checkout("imported", 'project = "ln-imported"\n');
  cpSync(FIXTURE, join(repo, ".tracker"), { recursive: true });
  await assert.rejects(runCli(importCommand, [join(repo, ".tracker"), "--project", "ln-other"]), (cause: Error) => cause instanceof UsageError && /says project = "ln-imported"/u.test(cause.message));
  const imported = await runCli(importCommand, [join(repo, ".tracker"), "--json"]);
  assert.equal(imported.code, 0, imported.stderr);
  assert.equal(JSON.parse(imported.stdout).project, "ln-imported");
});
