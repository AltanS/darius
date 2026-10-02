/**
 * `darius finding list|show|close|reopen` (src/cli/finding.ts).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseArgs } from "../src/cli/args.ts";
import { findingCommand } from "../src/cli/finding.ts";
import type { Command } from "../src/cli/registry.ts";
import { readLedger } from "../src/core/ledger.ts";
import { UsageError } from "../src/core/model.ts";
import { Seeder } from "./helpers/finding-seed.ts";

const SANDBOX = mkdtempSync(join(tmpdir(), "darius-finding-cli-"));
process.env.DARIUS_STATE_DIR = join(SANDBOX, "state");
process.env.DARIUS_CONFIG_DIR = join(SANDBOX, "config");

interface CliRun {
  code: number;
  stdout: string;
}

async function runCli(command: Command, argv: string[]): Promise<CliRun> {
  const out: string[] = [];
  const { log } = console;
  console.log = (...parts: string[]) => out.push(parts.join(" "));
  try {
    const code = await command.run(parseArgs(argv));
    return { code, stdout: out.join("\n") };
  } finally {
    console.log = log;
  }
}

function finding(project: string, argv: string[]): Promise<CliRun> {
  return runCli(findingCommand, [...argv, "--project", project]);
}

/** A project with one ritual: a high needs-code finding, a medium open one, a low open one and a fixed one. */
function seeded(project: string): Seeder {
  const seed = new Seeder(project);
  seed.run("check", [
    { key: "link-12", title: "Broken link", severity: "high", state: "needs-code", group: "site-a", target: "page 12" },
    { key: "banner-3", title: "Old banner", severity: "medium" },
    { key: "typo-1", title: "Typo", severity: "low" },
    { key: "done-1", title: "Done thing", severity: "low", state: "fixed" },
  ]);
  return seed;
}

test("finding list shows only what needs the operator by default; --open and --all show more", async () => {
  seeded("fc-list");
  const needs = await finding("fc-list", ["list"]);
  assert.equal(needs.code, 0);
  assert.match(needs.stdout, /^needs-you high needs-code: Broken link \[site-a, page 12\] \{link-12\} since 2026-10-01 in check$/u);

  const open = (await finding("fc-list", ["list", "--open"])).stdout.split("\n");
  assert.deepEqual(open.map((line) => line.split(" ")[0]), ["needs-you", "open", "open"]);
  assert.match(open[1] ?? "", /^open medium open: Old banner \{banner-3\} since/u);

  const all = (await finding("fc-list", ["list", "--all"])).stdout.split("\n");
  assert.equal(all.length, 4);
  assert.match(all[3] ?? "", /^fixed low fixed: Done thing \{done-1\}/u);

  const json = JSON.parse((await finding("fc-list", ["list", "--all", "--json"])).stdout);
  assert.equal(json.project, "fc-list");
  assert.equal(json.findings.length, 4);
  assert.equal(json.findings[0].key, "link-12");
  assert.equal(json.findings[0].status, "needs-you");
  assert.equal(JSON.parse((await finding("fc-list", ["list", "--json"])).stdout).findings.length, 1);
});

test("finding list marks stale and reopened findings, filters by ritual and says when it is empty", async () => {
  const seed = seeded("fc-tags");
  seed.run("check", [{ key: "link-12", title: "Broken link", severity: "high", state: "needs-code" }, { key: "done-1", severity: "low" }]);
  seed.run("other", []);
  const lines = (await finding("fc-tags", ["list", "--all"])).stdout.split("\n");
  assert.match(lines.find((line) => line.includes("{done-1}")) ?? "", /\{done-1\} reopened since/u);
  assert.match(lines.find((line) => line.includes("{typo-1}")) ?? "", /\{typo-1\} stale since/u);
  assert.equal((await finding("fc-tags", ["list", "--all", "--ritual", "other"])).stdout, "no findings");
  assert.equal((await finding("fc-tags", ["list", "--ritual", "check"])).stdout.split("\n").length, 1);
});

test("finding show prints the detail and the history; an unknown key is a usage error", async () => {
  const seed = seeded("fc-show");
  seed.run("check", [{ key: "link-12", title: "Broken link", severity: "high", state: "needs-code", detail: "The link goes to a 404." }]);
  const shown = (await finding("fc-show", ["show", "link-12"])).stdout;
  assert.match(shown, /^needs-you high needs-code: Broken link \{link-12\}/u);
  assert.match(shown, /detail: The link goes to a 404\./u);
  assert.match(shown, /reported in 2 run\(s\)/u);
  assert.equal(shown.split("\n").filter((line) => /^ {4}\S+ run RUN\d+: high needs-code$/u.test(line)).length, 2, "the history lists both runs");
  const json = JSON.parse((await finding("fc-show", ["show", "link-12", "--json"])).stdout);
  assert.equal(json.finding.runs, 2);
  assert.equal(json.finding.history.length, 2);
  await assert.rejects(finding("fc-show", ["show", "nope"]), UsageError);
  await assert.rejects(finding("fc-show", ["show", "link-12", "--ritual", "other"]), /no finding 'link-12' in ritual 'other'/u);
  await assert.rejects(finding("fc-show", ["show"]), /missing <key>/u);
  await assert.rejects(finding("fc-show", ["frob"]), /needs a verb/u);
});

test("a key in more than one ritual needs --ritual; the usage error names the rituals", async () => {
  const seed = seeded("fc-ambiguous");
  seed.run("other", [{ key: "link-12", title: "Same key elsewhere", severity: "low" }]);
  await assert.rejects(finding("fc-ambiguous", ["show", "link-12"]), /finding 'link-12' is in 2 rituals \((check, other|other, check)\); pass --ritual SLUG/u);
  await assert.rejects(finding("fc-ambiguous", ["close", "link-12"]), UsageError);
  const shown = JSON.parse((await finding("fc-ambiguous", ["show", "link-12", "--ritual", "other", "--json"])).stdout);
  assert.equal(shown.finding.title, "Same key elsewhere");
  assert.equal(readLedger(seed.project).filter((line) => line.type === "finding.closed").length, 0, "the refused close wrote nothing");
});

test("finding close writes one ledger line; list hides it; a second close and a close of a fixed finding are refused", async () => {
  const seed = seeded("fc-close");
  const closed = await finding("fc-close", ["close", "banner-3", "--note", "tracked elsewhere", "--who", "tester"]);
  assert.equal(closed.code, 0);
  assert.match(closed.stdout, /^✓ closed finding 'banner-3' of ritual 'check'$/u);
  const lines = readLedger(seed.project).filter((line) => line.type === "finding.closed");
  assert.equal(lines.length, 1);
  assert.equal(lines[0]?.item, "ritual/check");
  assert.equal(lines[0]?.key, "banner-3");
  assert.equal(lines[0]?.who, "tester");
  assert.equal(lines[0]?.note, "tracked elsewhere");
  assert.doesNotMatch((await finding("fc-close", ["list", "--open"])).stdout, /banner-3/u);
  assert.match((await finding("fc-close", ["list", "--all"])).stdout, /^closed medium open: Old banner \{banner-3\}/mu);
  assert.match((await finding("fc-close", ["show", "banner-3"])).stdout, /closed by tester at .* at severity medium: tracked elsewhere/u);

  const again = await finding("fc-close", ["close", "banner-3"]);
  assert.equal(again.code, 1);
  assert.match(again.stdout, /^! finding 'banner-3' of ritual 'check' is already closed by tester$/u);
  const fixed = await finding("fc-close", ["close", "done-1", "--json"]);
  assert.equal(fixed.code, 1);
  assert.equal(JSON.parse(fixed.stdout).ok, false);
  assert.match(JSON.parse(fixed.stdout).error, /is fixed; there is nothing to close/u);
  assert.equal(readLedger(seed.project).filter((line) => line.type === "finding.closed").length, 1, "refusals write nothing");
});

test("finding reopen ends a close; it refuses a finding that is not closed", async () => {
  const seed = seeded("fc-reopen");
  const notClosed = await finding("fc-reopen", ["reopen", "banner-3"]);
  assert.equal(notClosed.code, 1);
  assert.match(notClosed.stdout, /^! finding 'banner-3' of ritual 'check' is not closed \(status: open\)$/u);
  await finding("fc-reopen", ["close", "banner-3"]);
  const reopened = await finding("fc-reopen", ["reopen", "banner-3", "--json"]);
  assert.equal(reopened.code, 0);
  assert.deepEqual(JSON.parse(reopened.stdout), { ok: true, ritual: "check", key: "banner-3" });
  assert.equal(readLedger(seed.project).filter((line) => line.type === "finding.reopened").length, 1);
  assert.match((await finding("fc-reopen", ["list", "--open"])).stdout, /^open medium open: Old banner \{banner-3\}/mu);
  assert.equal((await finding("fc-reopen", ["reopen", "banner-3"])).code, 1, "no longer closed");
});

test("the finding verb is registered and listed for sessions", async () => {
  const { registerCommands } = await import("../src/cli/commands.ts");
  const { getCommand } = await import("../src/cli/registry.ts");
  registerCommands();
  assert.equal(getCommand("finding")?.audience, "session");
});
