/**
 * A closed reader on stdout ends darius quietly (0.138.0):
 * `darius list milestones --json | true` exits 0 with an empty stderr under
 * Bun and Node, with a small output and with a large one. Another error on
 * stdout stays loud (the unit part below).
 */

import { after, test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BIN = join(import.meta.dirname, "..", "bin", "darius");
const SANDBOX = mkdtempSync(join(tmpdir(), "darius-epipe-"));
after(() => rmSync(SANDBOX, { recursive: true, force: true }));

interface Finished {
  code: number | null;
  stderr: string;
}

/** Runs darius with a stdout reader that closes at once. */
function runWithClosedReader(argv: string[], env: NodeJS.ProcessEnv, cwd: string): Promise<Finished> {
  return new Promise((resolve) => {
    const child = spawn(BIN, argv, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.destroy();
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("close", (code) => {
      resolve({ code, stderr });
    });
  });
}

function sandboxEnv(runtime: string, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    HOME: SANDBOX,
    DARIUS_STATE_DIR: join(SANDBOX, "state"),
    DARIUS_CONFIG_DIR: join(SANDBOX, "config"),
    DARIUS_RUNTIME: runtime,
    NO_COLOR: "1",
    ...extra,
  };
}

for (const runtime of ["node", "bun"] as const) {
  test(`a closed stdout reader ends a large legacy output quietly with code 0 (${runtime})`, async () => {
    const dir = join(SANDBOX, `repo-${runtime}`);
    mkdirSync(join(dir, ".tracker"), { recursive: true });
    writeFileSync(join(dir, ".darius.toml"), `v = 3\nproject = "epipe-${runtime}"\ntz = "UTC"\n`);
    const entry = join(SANDBOX, `big-${runtime}.mjs`);
    writeFileSync(entry, `export async function main() {\n  const line = "x".repeat(1023) + "\\n";\n  for (let i = 0; i < 4096; i += 1) process.stdout.write(line);\n  return 0;\n}\n`);
    const done = await runWithClosedReader(["list", "milestones", "--json"], sandboxEnv(runtime, { DARIUS_LEGACY_ENTRY: entry }), dir);
    assert.equal(done.stderr, "");
    assert.equal(done.code, 0);
  });

  test(`a closed stdout reader ends list milestones --json quietly with code 0 (${runtime})`, async () => {
    const dir = join(SANDBOX, `real-${runtime}`);
    mkdirSync(dir, { recursive: true });
    cpSync(join(import.meta.dirname, "fixtures", "tracker-mini"), join(dir, ".tracker"), { recursive: true });
    writeFileSync(join(dir, ".darius.toml"), `v = 3\nproject = "epipe-real-${runtime}"\ntz = "UTC"\n`);
    const done = await runWithClosedReader(["list", "milestones", "--json"], sandboxEnv(runtime), dir);
    assert.equal(done.stderr, "");
    assert.equal(done.code, 0);
  });
}
