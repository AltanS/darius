/**
 * The one-CLI dispatch (src/core/kinds.ts, src/cli.ts): which verbs darius
 * answers and which go to the vendored legacy CLI, that a legacy verb gets
 * the argv, stdin, output and exit code unchanged, and the refusal of a
 * store verb in a repo that has `.tracker/` but no `.darius.toml`.
 *
 * The legacy module is a fake here (`DARIUS_LEGACY_ENTRY`), so these tests
 * pin darius's side of the seam only. test/vigil-list-golden.test.ts runs the
 * real vendored tree.
 */

import { after, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";

import { DARIUS_KINDS, kindOfVerb, LEGACY_VERBS, routeVerb } from "../src/core/kinds.ts";

const BIN = join(import.meta.dirname, "..", "bin", "darius");
const SANDBOX = mkdtempSync(join(tmpdir(), "darius-dispatch-"));
after(() => rmSync(SANDBOX, { recursive: true, force: true }));

/** A stand-in for src/legacy/bin/tracker.mts: echoes what it got, exits with `--exit N`. */
const FAKE_LEGACY = join(SANDBOX, "fake-legacy.mjs");
writeFileSync(
  FAKE_LEGACY,
  `import { readFileSync } from "node:fs";
export async function main(argv) {
  const stdin = argv.includes("--stdin") ? readFileSync(0, "utf8") : null;
  process.stdout.write(JSON.stringify({ argv, stdin }) + "\\n");
  process.stderr.write("fake legacy stderr\\n");
  const at = argv.indexOf("--exit");
  return at === -1 ? 0 : Number(argv[at + 1]);
}
`,
);
const NO_MAIN = join(SANDBOX, "no-main.mjs");
writeFileSync(NO_MAIN, "export const other = 1;\n");

const registered = new Set(["due", "ritual", "run", "run-due", "vigil", "sync", "help"]);
const isRegistered = (name: string): boolean => registered.has(name);

interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
}

function darius(argv: string[], options: { cwd?: string; entry?: string; input?: string } = {}): Run {
  const env: NodeJS.ProcessEnv = { ...process.env, DARIUS_LEGACY_ENTRY: options.entry ?? FAKE_LEGACY };
  delete env.DARIUS_PROJECT;
  const result = spawnSync(BIN, argv, {
    cwd: options.cwd ?? SANDBOX,
    env,
    encoding: "utf8",
    input: options.input ?? "",
    timeout: 20_000,
  });
  // Bun colours console.error when the parent forces colour; compare plain text.
  return { status: result.status, stdout: result.stdout, stderr: stripVTControlCharacters(result.stderr) };
}

test("only rituals are a darius kind until phase 3", () => {
  assert.deepEqual([...DARIUS_KINDS], ["ritual"]);
  assert.equal(kindOfVerb("ritual"), "ritual");
  assert.equal(kindOfVerb("run"), "ritual");
  assert.equal(kindOfVerb("vigil"), "vigil");
  assert.equal(kindOfVerb("status"), null);
});

test("routeVerb: darius verbs, legacy verbs, the vigil clash, and unknown verbs", () => {
  assert.equal(routeVerb("ritual", "list", isRegistered), "darius");
  assert.equal(routeVerb("run", "start", isRegistered), "darius");
  assert.equal(routeVerb("due", undefined, isRegistered), "darius");
  assert.equal(routeVerb("sync", undefined, isRegistered), "darius");
  for (const verb of LEGACY_VERBS) {
    if (verb === "vigil") continue;
    assert.equal(routeVerb(verb, undefined, isRegistered), "legacy", verb);
  }
  // vigil is not a darius kind yet: its verbs go to the legacy writer even
  // though darius registers `vigil`. The daily timer's sweep stays native.
  for (const sub of ["add", "list", "close", "set-body", "show", undefined]) {
    assert.equal(routeVerb("vigil", sub, isRegistered), "legacy", String(sub));
  }
  assert.equal(routeVerb("vigil", "sweep", isRegistered), "darius");
  assert.equal(routeVerb("init", undefined, isRegistered), "unknown");
  assert.equal(routeVerb("no-such-verb", undefined, isRegistered), "unknown");
});

test("no legacy verb is also a registered darius verb, except vigil", () => {
  const result = darius(["help", "--json"]);
  assert.equal(result.status, 0, result.stderr);
  const names: string[] = JSON.parse(result.stdout).commands.map((command: { name: string }) => command.name);
  const clashes = names.filter((name) => LEGACY_VERBS.has(name));
  assert.deepEqual(clashes, ["vigil"]);
});

test("a legacy verb gets the whole argv, and its stdout, stderr and exit code pass through", () => {
  const ok = darius(["next", "--json"]);
  assert.equal(ok.status, 0, ok.stderr);
  assert.deepEqual(JSON.parse(ok.stdout), { argv: ["next", "--json"], stdin: null });
  assert.equal(ok.stderr, "fake legacy stderr\n");

  for (const code of [1, 2, 3]) {
    const failed = darius(["loop-check", "--exit", String(code)]);
    assert.equal(failed.status, code);
    assert.deepEqual(JSON.parse(failed.stdout).argv, ["loop-check", "--exit", String(code)]);
  }
});

test("vigil add|list|close go to the legacy CLI; vigil sweep does not", () => {
  const list = darius(["vigil", "list", "--json"]);
  assert.equal(list.status, 0, list.stderr);
  assert.deepEqual(JSON.parse(list.stdout).argv, ["vigil", "list", "--json"]);

  const close = darius(["vigil", "close", "a-vigil", "--verdict", "held"]);
  assert.deepEqual(JSON.parse(close.stdout).argv, ["vigil", "close", "a-vigil", "--verdict", "held"]);

  const sweep = darius(["vigil", "sweep", "--project", "no-such-project", "--json"]);
  assert.doesNotMatch(sweep.stdout, /"argv"/u);
  assert.doesNotMatch(sweep.stderr, /fake legacy/u);
});

test("--stdin on a legacy verb reaches the legacy CLI unread", () => {
  const result = darius(["vigil", "add", "a-vigil", "--stdin"], { input: "## Verification Checklist\n" });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    argv: ["vigil", "add", "a-vigil", "--stdin"],
    stdin: "## Verification Checklist\n",
  });
});

test("a legacy entry that cannot load, or has no main, fails with exit 1 and one line", () => {
  const missing = darius(["status"], { entry: join(SANDBOX, "missing.mjs") });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /^darius: cannot load the legacy tracker CLI at /u);

  const noMain = darius(["status"], { entry: NO_MAIN });
  assert.equal(noMain.status, 1);
  assert.match(noMain.stderr, /exports no main\(\)/u);
});

test("init is darius's own verb, never a legacy one", () => {
  assert.ok(!LEGACY_VERBS.has("init"));
  const repo = join(SANDBOX, "init-own");
  mkdirSync(join(repo, ".git"), { recursive: true });
  const result = darius(["init", "--json"], { cwd: repo });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).project, "init-own", "the fake legacy entry never answered");
});

test("a ritual or run verb in an unlinked tracker repo exits 1 with one line", () => {
  const repo = join(SANDBOX, "unlinked");
  mkdirSync(join(repo, ".tracker", "vigils"), { recursive: true });
  const nested = join(repo, "src", "deep");
  mkdirSync(nested, { recursive: true });

  for (const argv of [["ritual", "list"], ["run", "list"], ["ritual", "add", "x", "--title", "X", "--cadence", "1d"]]) {
    for (const cwd of [repo, nested]) {
      const result = darius(argv, { cwd });
      assert.equal(result.status, 1, `${argv.join(" ")} in ${cwd}`);
      assert.equal(result.stderr, "darius: this repo is not linked: run darius init\n");
      assert.equal(result.stdout, "");
    }
  }
});

test("the refusal does not fire with --project, with a marker, or without .tracker/", () => {
  const repo = join(SANDBOX, "linked");
  mkdirSync(join(repo, ".tracker"), { recursive: true });
  const named = darius(["ritual", "list", "--project", "dispatch-named"], { cwd: repo });
  assert.doesNotMatch(named.stderr, /not linked/u);

  writeFileSync(join(repo, ".darius.toml"), 'project = "dispatch-linked"\n');
  const linked = darius(["ritual", "list"], { cwd: repo });
  assert.doesNotMatch(linked.stderr, /not linked/u);

  const plain = join(SANDBOX, "plain");
  mkdirSync(plain, { recursive: true });
  const noTracker = darius(["ritual", "list"], { cwd: plain });
  assert.equal(noTracker.status, 2);
  assert.match(noTracker.stderr, /no project/u);
});

test("legacy verbs never meet the refusal: they work in an unlinked tracker repo", () => {
  const repo = join(SANDBOX, "unlinked-legacy");
  mkdirSync(join(repo, ".tracker"), { recursive: true });
  const result = darius(["status"], { cwd: repo });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).argv, ["status"]);
});
