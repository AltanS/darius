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

import { DEFAULT_KINDS, kindOfVerb, LEGACY_VERBS, routeVerb, type OwnedKind } from "../src/core/kinds.ts";

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

const RITUAL_ONLY: ReadonlySet<OwnedKind> = DEFAULT_KINDS;
const WITH_VIGIL: ReadonlySet<OwnedKind> = new Set<OwnedKind>(["ritual", "vigil"]);

test("only rituals are a darius kind unless the marker says more", () => {
  assert.deepEqual([...DEFAULT_KINDS], ["ritual"]);
  assert.equal(kindOfVerb("ritual"), "ritual");
  assert.equal(kindOfVerb("run"), "ritual");
  assert.equal(kindOfVerb("vigil"), "vigil");
  assert.equal(kindOfVerb("status"), null);
});

test("routeVerb: darius verbs, legacy verbs, the vigil clash, and unknown verbs", () => {
  assert.equal(routeVerb("ritual", "list", isRegistered, RITUAL_ONLY), "darius");
  assert.equal(routeVerb("run", "start", isRegistered, RITUAL_ONLY), "darius");
  assert.equal(routeVerb("due", undefined, isRegistered, RITUAL_ONLY), "darius");
  assert.equal(routeVerb("sync", undefined, isRegistered, RITUAL_ONLY), "darius");
  for (const verb of LEGACY_VERBS) {
    if (verb === "vigil") continue;
    assert.equal(routeVerb(verb, undefined, isRegistered, RITUAL_ONLY), "legacy", verb);
  }
  // vigil is not a darius kind yet: its verbs go to the legacy writer even
  // though darius registers `vigil`. The daily timer's sweep stays native.
  for (const sub of ["add", "list", "close", "set-body", "show", undefined]) {
    assert.equal(routeVerb("vigil", sub, isRegistered, RITUAL_ONLY), "legacy", String(sub));
  }
  assert.equal(routeVerb("vigil", "sweep", isRegistered, RITUAL_ONLY), "darius");
  // With vigil owned, vigil verbs go to darius; verbs of no kind still go to legacy.
  for (const sub of ["add", "list", "close", "set-body", "show", "sweep", undefined]) {
    assert.equal(routeVerb("vigil", sub, isRegistered, WITH_VIGIL), "darius", String(sub));
  }
  assert.equal(routeVerb("status", undefined, isRegistered, WITH_VIGIL), "legacy");
  assert.equal(routeVerb("worklog", "list", isRegistered, WITH_VIGIL), "legacy");
  assert.equal(routeVerb("ritual", "list", isRegistered, WITH_VIGIL), "darius");
  assert.equal(routeVerb("init", undefined, isRegistered, RITUAL_ONLY), "unknown");
  assert.equal(routeVerb("no-such-verb", undefined, isRegistered, RITUAL_ONLY), "unknown");
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

/** A repo with a v3 marker whose `kinds` line is `kindsLine` (none when empty). */
function markerRepo(name: string, kindsLine: string): string {
  const repo = join(SANDBOX, name);
  mkdirSync(repo, { recursive: true });
  writeFileSync(join(repo, ".darius.toml"), `v = 3\nproject = "${name}"\ntz = "Europe/Berlin"\n${kindsLine}`);
  return repo;
}

test("vigil verbs follow the marker: kinds with vigil reaches the native command, none reaches legacy", () => {
  const owned = markerRepo("kinds-vigil", 'kinds = ["ritual", "vigil"]\n');
  const native = darius(["vigil", "list", "--json"], { cwd: owned });
  assert.doesNotMatch(native.stdout, /"argv"/u, "the fake legacy entry did not answer");
  assert.doesNotMatch(native.stderr, /fake legacy/u);

  const plain = markerRepo("kinds-none", "");
  const legacy = darius(["vigil", "list", "--json"], { cwd: plain });
  assert.equal(legacy.status, 0, legacy.stderr);
  assert.deepEqual(JSON.parse(legacy.stdout).argv, ["vigil", "list", "--json"]);
});

test("a broken marker stops a vigil verb with exit 1 and the marker error; sweep and others are not stopped", () => {
  const repo = markerRepo("kinds-broken", 'kinds = ["vigil"]\n');
  for (const argv of [["vigil", "list"], ["vigil", "add", "a-vigil"], ["vigil"]]) {
    const result = darius(argv, { cwd: repo });
    assert.equal(result.status, 1, argv.join(" "));
    assert.match(result.stderr, /^darius: .*\.darius\.toml:4: kinds must be one of/u);
    assert.doesNotMatch(result.stdout, /"argv"/u);
  }
  const legacyVerb = darius(["status"], { cwd: repo });
  assert.equal(legacyVerb.status, 0, legacyVerb.stderr);
  assert.deepEqual(JSON.parse(legacyVerb.stdout).argv, ["status"]);
  const sweep = darius(["vigil", "sweep", "--project", "no-such-project", "--json"], { cwd: repo });
  assert.doesNotMatch(sweep.stderr, /kinds must be one of/u);
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
