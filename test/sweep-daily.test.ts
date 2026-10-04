/**
 * Where the vigil sweep runs its Commands (the project's working dir on this
 * host, src/core/workdir.ts) and `vigil sweep --daily`, the timer's sweep
 * behind the per-day lease (src/core/sweep-lease.ts). No config.toml here, so
 * the lease is a local file in the project's store.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseArgs } from "../src/cli/args.ts";
import { UsageError } from "../src/cli/registry.ts";
import { vigilCommand } from "../src/cli/vigil.ts";
import { appendLine } from "../src/core/ledger.ts";
import { writeLink } from "../src/core/links.ts";
import { openProject } from "../src/core/store.ts";
import { localToday } from "../src/core/sweep.ts";
import { LINKED_LINE } from "../src/core/workdir.ts";

const SANDBOX = mkdtempSync(join(tmpdir(), "darius-sweep-daily-"));
process.env.DARIUS_STATE_DIR = join(SANDBOX, "state");
process.env.DARIUS_CONFIG_DIR = join(SANDBOX, "config");
delete process.env.DARIUS_SWEEP_ACTIVE;
delete process.env.DARIUS_PROJECT;

interface CliRun {
  code: number;
  stdout: string;
  stderr: string;
}

async function runVigil(argv: string[], stdin?: string): Promise<CliRun> {
  const args = parseArgs(argv);
  if (stdin !== undefined) args.stdin = stdin;
  const out: string[] = [];
  const err: string[] = [];
  const { log, error } = console;
  console.log = (...parts: string[]) => out.push(parts.join(" "));
  console.error = (...parts: string[]) => err.push(parts.join(" "));
  try {
    const code = await vigilCommand.run(args);
    return { code, stdout: out.join("\n"), stderr: err.join("\n") };
  } finally {
    console.log = log;
    console.error = error;
  }
}

/** A vigil due today whose one check passes only in a dir holding `here.txt`. */
async function addHereVigil(project: string): Promise<void> {
  const body = "# checks\n\n## Verification Checklist\n\n- [ ] runs in the checkout\n  - Command: `test -f here.txt`\n  - Expected: `exit 0`\n";
  const added = await runVigil(["add", "here", "--project", project, "--title", "Runs in the checkout", "--due", localToday(), "--stdin"], body);
  assert.equal(added.code, 0, added.stderr);
}

/** A linked checkout of `project` holding `here.txt`. */
function linkedCheckout(project: string): string {
  const dir = join(SANDBOX, `${project}-checkout`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, ".darius.toml"), `v = 1\nproject = "${project}"\n`);
  writeFileSync(join(dir, "here.txt"), "");
  writeLink(project, dir);
  return dir;
}

test("the sweep runs Commands in the project's linked checkout, not in the store", async () => {
  const project = "sd-linked";
  const dir = linkedCheckout(project);
  await addHereVigil(project);
  const swept = await runVigil(["sweep", "--project", project, "--json"]);
  assert.equal(swept.code, 0, swept.stderr);
  const result = JSON.parse(swept.stdout);
  assert.equal(result.cwd, dir);
  assert.equal(result.vigils[0].outcome, "held", swept.stdout);
  assert.equal(result.vigils[0].closed, true);
});

test("--daily sweeps a project once per day: the second run skips it as swept-today", async () => {
  const project = "sd-daily";
  linkedCheckout(project);
  await addHereVigil(project);
  const first = await runVigil(["sweep", "--project", project, "--daily", "--json"]);
  assert.equal(first.code, 0, first.stderr);
  assert.equal(JSON.parse(first.stdout).vigils[0].closed, true);
  assert.ok(existsSync(join(openProject(project).root, "leases", `sweep-${localToday()}.lock`)));

  const second = await runVigil(["sweep", "--project", project, "--daily", "--json"]);
  assert.equal(second.code, 0, second.stderr);
  assert.deepEqual(JSON.parse(second.stdout).skipped.reason, "swept-today");

  // A manual sweep is not held back by the day's lease.
  const manual = await runVigil(["sweep", "--project", project, "--json"]);
  assert.equal(manual.code, 0, manual.stderr);
  assert.equal(JSON.parse(manual.stdout).vigils[0].bucket, "closed");
});

test("--daily is the whole sweep: no dry run, no classify-only, no --only", async () => {
  await assert.rejects(runVigil(["sweep", "--project", "sd-daily", "--daily", "--dry-run"]), UsageError);
  await assert.rejects(runVigil(["sweep", "--project", "sd-daily", "--daily", "--classify-only"]), UsageError);
  await assert.rejects(runVigil(["sweep", "--project", "sd-daily", "--daily", "--only", "here"]), UsageError);
});

test("a project that lives in a checkout on another host is skipped with --all-projects and refused alone", async () => {
  const project = "sd-elsewhere";
  await addHereVigil(project);
  appendLine(openProject(project), { who: "test", type: LINKED_LINE, path: "/nonexistent-darius/checkout" });

  const all = await runVigil(["sweep", "--all-projects", "--daily", "--json"]);
  assert.equal(all.code, 0, all.stderr);
  const report = JSON.parse(all.stdout);
  const skip = report.skipped.find((one: { project: string }) => one.project === project);
  assert.equal(skip?.reason, "no-workdir", all.stdout);
  assert.match(skip?.detail ?? "", /darius link/u);

  const alone = await runVigil(["sweep", "--project", project]);
  assert.equal(alone.code, 1);
  assert.match(alone.stderr, /not on this host/u);

  // Classifying runs nothing, so it needs no working dir.
  const classify = await runVigil(["sweep", "--project", project, "--classify-only", "--json"]);
  assert.equal(classify.code, 0, classify.stderr);
});
