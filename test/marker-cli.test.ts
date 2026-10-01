/**
 * `darius marker check` (src/cli/marker.ts) and the v3 suffix of
 * `darius link --list` (src/cli/link.ts).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseArgs } from "../src/cli/args.ts";
import { linkCommand } from "../src/cli/link.ts";
import { markerCommand } from "../src/cli/marker.ts";
import { UsageError, type Command } from "../src/cli/registry.ts";

const SANDBOX = mkdtempSync(join(tmpdir(), "darius-marker-cli-"));
process.env.DARIUS_STATE_DIR = join(SANDBOX, "state");
process.env.DARIUS_CONFIG_DIR = join(SANDBOX, "config");
delete process.env.DARIUS_PROJECT;

const FIXTURE = join(import.meta.dirname, "fixtures", "marker-v3.toml");

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

let counter = 0;

function checkout(marker: string | null): string {
  counter += 1;
  const dir = join(SANDBOX, `repo-${String(counter)}`);
  mkdirSync(dir, { recursive: true });
  if (marker !== null) writeFileSync(join(dir, ".darius.toml"), marker);
  return dir;
}

function addSkill(dir: string, name: string): void {
  mkdirSync(join(dir, ".claude", "skills", name), { recursive: true });
  writeFileSync(join(dir, ".claude", "skills", name, "SKILL.md"), `---\nname: ${name}\ndescription: x\n---\n`);
}

function v3Checkout(): string {
  const dir = checkout(null);
  copyFileSync(FIXTURE, join(dir, ".darius.toml"));
  return dir;
}

test("marker check: a v3 file is ok and warns about each skill file missing here", async () => {
  const dir = v3Checkout();
  const run = await runCli(markerCommand, ["check", dir]);
  assert.equal(run.code, 0, run.stderr);
  assert.match(run.stdout, /ok: v3, 2 rituals, 1 policies/u);
  assert.match(run.stdout, /warning: \[rituals\.daily-report\] skill "daily-report" has no \.claude\/skills\/daily-report\/SKILL\.md in this checkout/u);
  assert.match(run.stdout, /warning: \[rituals\.weekly-audit\] skill "weekly-audit" has no/u);
  addSkill(dir, "daily-report");
  addSkill(dir, "weekly-audit");
  const clean = await runCli(markerCommand, ["check", dir]);
  assert.equal(clean.stdout, "ok: v3, 2 rituals, 1 policies");
});

test("marker check: a bad file prints file:line and exits 1; --json carries the same error", async () => {
  const dir = checkout('v = 3\nproject = "acme-web"\n');
  const run = await runCli(markerCommand, ["check", dir]);
  assert.equal(run.code, 1);
  assert.match(run.stderr, /\.darius\.toml:1: v = 3 needs tz/u);
  const json = JSON.parse((await runCli(markerCommand, ["check", dir, "--json"])).stdout);
  assert.equal(json.ok, false);
  assert.match(json.errors[0], /\.darius\.toml:1: v = 3 needs tz/u);
});

test("marker check: warns about an unused policy and an empty v3 marker", async () => {
  const dir = checkout('v = 3\nproject = "acme-web"\ntz = "UTC"\n[policies.spare]\nmode = "off"\n');
  const run = await runCli(markerCommand, ["check", dir]);
  assert.equal(run.code, 0);
  assert.match(run.stdout, /warning: no \[rituals\.<slug>\] tables/u);
  assert.match(run.stdout, /warning: \[policies\.spare\] is not used by any ritual/u);
  assert.match(run.stdout, /ok: v3, 0 rituals, 1 policies/u);
});

test("marker check: a v2 or v1 file is ok with no ritual counts", async () => {
  assert.equal((await runCli(markerCommand, ["check", checkout('v = 2\nproject = "acme-web"\n')])).stdout, "ok: v2");
  assert.equal((await runCli(markerCommand, ["check", checkout('project = "acme-web"\n')])).stdout, "ok: v1");
});

test("marker check: --json reports version, counts and warnings", async () => {
  const json = JSON.parse((await runCli(markerCommand, ["check", v3Checkout(), "--json"])).stdout);
  assert.equal(json.ok, true);
  assert.equal(json.version, 3);
  assert.equal(json.rituals, 2);
  assert.equal(json.policies, 1);
  assert.equal(json.warnings.length, 2);
});

test("marker check: no file is a usage error; a missing verb or extra argument too", async () => {
  await assert.rejects(runCli(markerCommand, ["check", checkout(null)]), (cause: Error) => cause instanceof UsageError && /no \.darius\.toml/u.test(cause.message));
  await assert.rejects(runCli(markerCommand, []), UsageError);
  await assert.rejects(runCli(markerCommand, ["check", "a", "b"]), UsageError);
});

test("link --list adds v3 (N rituals) to the ok line, and only for v3", async () => {
  const v3 = v3Checkout();
  const v2 = checkout('v = 2\nproject = "mc-v2"\n');
  assert.equal((await runCli(linkCommand, [v3])).code, 0);
  assert.equal((await runCli(linkCommand, [v2])).code, 0);
  const text = (await runCli(linkCommand, ["--list"])).stdout;
  assert.match(text, new RegExp(`acme-web +${v3.replaceAll("/", "\\/")}  v3 \\(2 rituals\\)$`, "mu"));
  assert.match(text, new RegExp(`mc-v2 +${v2.replaceAll("/", "\\/")}$`, "mu"));
  const links: { project: string; state: string; marker?: string }[] = JSON.parse((await runCli(linkCommand, ["--list", "--json"])).stdout).links;
  assert.deepEqual(links.find((one) => one.project === "acme-web"), { project: "acme-web", dir: v3, state: "ok", marker: "v3 (2 rituals)" });
  assert.equal(links.find((one) => one.project === "mc-v2")?.marker, undefined);
});
