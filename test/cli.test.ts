/**
 * The CLI contract a scheduler and the Claude Code skills depend on: the
 * version line, and exit code 2 for usage errors (the probe contract).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VERSION } from "../src/version.ts";

const BIN = join(import.meta.dirname, "..", "bin", "darius");

test("--version prints the version from src/version.ts", () => {
  const result = spawnSync(BIN, ["--version"], { encoding: "utf8" });
  assert.equal(result.status, 0);
  assert.match(result.stdout, new RegExp(`^darius ${VERSION.replaceAll(".", "\\.")} \\((bun|node)\\)`));
});

test("under bun, a bunfig.toml, tsconfig.json and .env in the cwd have no effect", (t) => {
  // A boxed run can write these into its work dir, and the next darius call
  // there runs outside the box. Bun loads all three from the cwd by default.
  if (spawnSync("bun", ["--version"], { encoding: "utf8" }).status !== 0) {
    t.skip("bun is not on PATH");
    return;
  }
  const cwd = mkdtempSync(join(tmpdir(), "darius-cwd-"));
  try {
    const home = join(cwd, "home");
    writeFileSync(join(cwd, "planted.ts"), 'console.log("PLANTED");\nexport const homedir = () => "/planted";\n');
    writeFileSync(join(cwd, "bunfig.toml"), 'preload = ["./planted.ts"]\n');
    writeFileSync(join(cwd, "tsconfig.json"), JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "node:os": ["./planted.ts"] } } }));
    // .env never overrides a set variable, so the planted one is left unset here.
    writeFileSync(join(cwd, ".env"), `DARIUS_STATE_DIR=${join(cwd, "planted-state")}\nDARIUS_RUN_SANDBOX=off\n`);
    writeFileSync(join(cwd, ".darius.toml"), 'v = 3\nproject = "probe"\ntz = "UTC"\nkinds = ["ritual", "vigil", "milestone"]\n');
    const env: NodeJS.ProcessEnv = { ...process.env, DARIUS_RUNTIME: "bun", HOME: home };
    delete env.DARIUS_STATE_DIR;
    const version = spawnSync(BIN, ["--version"], { cwd, env, encoding: "utf8" });
    assert.equal(version.status, 0, version.stderr);
    assert.doesNotMatch(version.stdout + version.stderr, /PLANTED/);
    assert.match(version.stdout, /\(bun\)/);
    // root --json names the store path, so it shows which DARIUS_STATE_DIR won.
    const root = spawnSync(BIN, ["root", "--json"], { cwd, env, encoding: "utf8" });
    assert.equal(root.status, 0, root.stderr);
    assert.doesNotMatch(root.stdout + root.stderr, /PLANTED|planted/);
    assert.equal(JSON.parse(root.stdout).trackerRoot, join(home, ".local", "share", "darius", "probe", "tracker"));
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
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

test("sync --reseed with --pull-only, or without a project selection, is a usage error, exit 2", () => {
  for (const argv of [["sync", "--reseed", "--pull-only", "--project", "demo"], ["sync", "--reseed"], ["sync", "--reseed", "--json"]]) {
    const result = spawnSync(BIN, argv, { encoding: "utf8" });
    assert.equal(result.status, 2, `argv=${JSON.stringify(argv)}: ${result.stderr}`);
    assert.match(result.stderr, /--reseed/);
  }
});
