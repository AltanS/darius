/**
 * The CLI contract a scheduler and the Claude Code skills depend on: the
 * version line, and exit code 2 for usage errors (the probe contract).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { VERSION } from "../src/version.ts";

const BIN = join(import.meta.dirname, "..", "bin", "darius");

test("--version prints the version from src/version.ts", () => {
  const result = spawnSync(BIN, ["--version"], { encoding: "utf8" });
  assert.equal(result.status, 0);
  assert.match(result.stdout, new RegExp(`^darius ${VERSION.replaceAll(".", "\\.")} \\((bun|node)\\)`));
});

test("an unknown command is a usage error, exit 2, not a failure", () => {
  // A scheduler treats 1 as "the work failed" and 2 as "the caller is wrong".
  // Mixing them up pages the operator for a typo.
  const result = spawnSync(BIN, ["no-such-command"], { encoding: "utf8" });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /unknown command/);
});

test("help lists registered commands", () => {
  const result = spawnSync(BIN, ["help"], { encoding: "utf8" });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Commands:/);
  assert.match(result.stdout, /darius help\s+list every registered command/);
});

test("bare invocation and --help are the same as help", () => {
  for (const argv of [[], ["--help"], ["-h"]]) {
    const result = spawnSync(BIN, argv, { encoding: "utf8" });
    assert.equal(result.status, 0, `argv=${JSON.stringify(argv)}`);
    assert.match(result.stdout, /Commands:/);
  }
});

test("--json on help prints exactly one JSON object on stdout", () => {
  const result = spawnSync(BIN, ["help", "--json"], { encoding: "utf8" });
  assert.equal(result.status, 0);
  // "nothing else on stdout" -- one line, and it parses.
  const lines = result.stdout.split("\n").filter((line) => line.length > 0);
  assert.equal(lines.length, 1);
  const parsed = JSON.parse(lines[0] ?? "");
  assert.equal(parsed.version, VERSION);
  assert.ok(Array.isArray(parsed.commands));
  assert.ok(parsed.commands.some((command: { name: string }) => command.name === "help"));
});

test("--stdin reads to EOF without hanging, and does not break the command", () => {
  const result = spawnSync(BIN, ["help", "--stdin", "--json"], {
    encoding: "utf8",
    input: "piped input the command never reads back\n",
    timeout: 5000,
  });
  assert.equal(result.status, 0);
  assert.doesNotThrow(() => JSON.parse(result.stdout.trim()));
});

test("an unregistered flag on help is simply ignored, not a crash", () => {
  // help does not read flags.stdin unless --stdin is given, so an unrelated
  // repeatable flag must not affect it.
  const result = spawnSync(BIN, ["help", "--question", "a", "--question", "b"], { encoding: "utf8" });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Commands:/);
});
