/**
 * Output over 64 KB reaches a slow reader whole, for every verb (0.142.0). The
 * legacy engine ends the process with `process.exit`, and a stream write that
 * `process.exit` follows loses what does not fit in the pipe. `scan stubs` is a
 * real legacy verb that does this when it finds stubs; `ritual show` is a native
 * verb with a large body. Each is read through a pipe whose reader waits first,
 * and compared with the same output written to a file.
 */

import { after, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ulid } from "../src/core/ulid.ts";
import { openProject } from "../src/core/store.ts";
import { commitAll, initRepo, NO_GIT } from "./helpers/git.ts";

const BIN = join(import.meta.dirname, "..", "bin", "darius");
const SANDBOX = mkdtempSync(join(tmpdir(), "darius-stdout-drain-"));
after(() => rmSync(SANDBOX, { recursive: true, force: true }));

type Runtime = "node" | "bun";

const OVER_PIPE = 65_536;

interface Repo {
  env: NodeJS.ProcessEnv;
  dir: string;
}

function hostEnv(home: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: home,
    CLAUDE_CONFIG_DIR: join(home, ".claude"),
    DARIUS_STATE_DIR: join(home, "state"),
    DARIUS_CONFIG_DIR: join(home, "config"),
    DARIUS_WHO: "dev@example.com",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    NO_COLOR: "1",
  };
  delete env.DARIUS_PROJECT;
  return env;
}

/** A store-mode repo. */
function storeRepo(name: string): Repo {
  const home = join(SANDBOX, `home-${name}`);
  const dir = join(home, name);
  mkdirSync(dir, { recursive: true });
  const env = hostEnv(home);
  initRepo(dir);
  writeFileSync(join(dir, "README.md"), "# repo\n");
  const init = spawnSync(BIN, ["init", "--project", name], { cwd: dir, env, encoding: "utf8", input: "" });
  assert.equal(init.status, 0, init.stderr);
  commitAll(dir, "marker");
  return { env, dir };
}

interface Reads {
  whole: string;
  slow: string;
}

/** The stdout of `darius argv` written to a file, then the same read through a pipe whose reader sleeps first. */
function bothReads(repo: Repo, argv: string[], runtime: Runtime): Reads {
  const env = { ...repo.env, DARIUS_RUNTIME: runtime };
  const file = join(SANDBOX, `out-${runtime}-${argv.join("-").replaceAll(/\W/gu, "")}.txt`);
  spawnSync("/bin/sh", ["-c", `"$0" "$@" > "${file}" 2>/dev/null`, BIN, ...argv], { cwd: repo.dir, env, input: "", timeout: 30_000 });
  const slow = spawnSync("/bin/sh", ["-c", `"$0" "$@" 2>/dev/null | { sleep 2; cat; }`, BIN, ...argv], {
    cwd: repo.dir,
    env,
    encoding: "utf8",
    input: "",
    timeout: 30_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  return { whole: readFileSync(file, "utf8"), slow: slow.stdout };
}

for (const runtime of ["node", "bun"] as const) {
  test(`a legacy verb that ends the process (scan stubs) gives a slow reader all of its output over 64 KB (${runtime})`, { skip: NO_GIT }, () => {
    const repo = storeRepo(`legacy-${runtime}`);
    const stubs = join(repo.dir, "stubs");
    mkdirSync(stubs);
    for (let index = 0; index < 1500; index += 1) {
      writeFileSync(join(stubs, `s${String(index)}.ts`), `export function f${String(index)}() {\n  // TODO: implement this thing\n  throw new Error("not implemented");\n}\n`);
    }
    const { whole, slow } = bothReads(repo, ["scan", "stubs", "stubs"], runtime);
    assert.ok(whole.length > OVER_PIPE, `the fixture must print more than a pipe holds, got ${String(whole.length)}`);
    assert.equal(slow.length, whole.length);
    assert.equal(slow, whole);
  });

  test(`a native verb (ritual show --json) gives a slow reader all of its output over 64 KB (${runtime})`, { skip: NO_GIT }, () => {
    const repo = storeRepo(`native-${runtime}`);
    const state = process.env.DARIUS_STATE_DIR;
    process.env.DARIUS_STATE_DIR = repo.env.DARIUS_STATE_DIR;
    try {
      const now = new Date().toISOString();
      openProject(`native-${runtime}`, { create: true }).writeItem(
        {
          header: { id: ulid(), kind: "ritual", slug: "big", title: "Big", created: now, updated: now, tags: [], cadence: "1d", anchor: "due", policy: { mode: "report", may: ["Bash(date)"], hold: [], model: "haiku", max_turns: 6 } },
          body: "a line of body text that fills the pipe\n".repeat(4000),
        },
        { who: "test" },
      );
    } finally {
      if (state === undefined) delete process.env.DARIUS_STATE_DIR;
      else process.env.DARIUS_STATE_DIR = state;
    }
    const { whole, slow } = bothReads(repo, ["ritual", "show", "big", "--json"], runtime);
    assert.ok(whole.length > OVER_PIPE, `the fixture must print more than a pipe holds, got ${String(whole.length)}`);
    assert.equal(slow, whole);
  });
}

test("a reader that goes away ends a legacy verb quietly, with no stack trace", { skip: NO_GIT }, () => {
  const repo = storeRepo("gone");
  const stubs = join(repo.dir, "stubs");
  mkdirSync(stubs);
  for (let index = 0; index < 1500; index += 1) writeFileSync(join(stubs, `s${String(index)}.ts`), `export function f() {\n  // TODO: implement this thing\n  throw new Error("not implemented");\n}\n`);
  for (const runtime of ["node", "bun"] as const) {
    const ran = spawnSync("/bin/sh", ["-c", `"$0" scan stubs stubs 2>"${join(SANDBOX, `err-${runtime}.txt`)}" | head -1`, BIN], { cwd: repo.dir, env: { ...repo.env, DARIUS_RUNTIME: runtime }, encoding: "utf8", input: "", timeout: 30_000 });
    assert.match(ran.stdout, /^.+\n$/u, runtime);
    assert.equal(readFileSync(join(SANDBOX, `err-${runtime}.txt`), "utf8"), "", `${runtime}: nothing on stderr`);
  }
});
