/**
 * The check grammar, the no-op classifier and the executor.
 *
 * The grammar cases are the ones the old tracker CLI and djinn's sweep settled
 * on, so a body classifies the same way under darius and under `tracker verify`.
 * The executor cases prove the process-group kill: a timed-out Command must not
 * leave anything behind.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  classifyCommand,
  parseChecklist,
  parseExpectation,
  runCheck,
  splitShellStages,
  stageFirstToken,
  type Check,
} from "../src/core/checks.ts";

const VIGIL_BODY = [
  "# Vigil: sample",
  "",
  "## Checks",
  "",
  "- [ ] the service answers",
  "  - Command: `curl -fsS http://127.0.0.1:9910/status`",
  "  - Expected: `exit 0`",
  "- [x] the report names the batch",
  "  - Command: `cat report.txt`",
  '  - Expected: `stdout contains "batch 42"`',
  "- [ ] operator confirms the page",
  "  - Expected: `manual (owner: owner, expires: 2027-01-01)`",
  "- [~] unquoted command",
  "  - Command: test -f marker",
  "  - Expected: exit 0",
  "",
  "## Notes",
  "",
  "  - Command: `rm -rf /` must never attach to the last check above",
].join("\n");

function check(command: string, expected: string): Check {
  return { index: 0, text: "sample", command, expected };
}

function scratchDir(): string {
  return mkdtempSync(join(tmpdir(), "darius-checks-"));
}

// ---------------------------------------------------------------------------
// parseChecklist
// ---------------------------------------------------------------------------

test("parseChecklist reads items, Commands and Expected clauses in order", () => {
  const checks = parseChecklist(VIGIL_BODY);
  assert.equal(checks.length, 4);
  assert.deepEqual(checks[0], {
    index: 0,
    text: "the service answers",
    command: "curl -fsS http://127.0.0.1:9910/status",
    expected: "exit 0",
  });
  assert.equal(checks[1]?.expected, 'stdout contains "batch 42"');
  assert.equal(checks[3]?.command, "test -f marker");
  assert.equal(checks[3]?.expected, "exit 0");
});

test("parseChecklist parses the manual form into owner and expiry", () => {
  const manual = parseChecklist(VIGIL_BODY)[2];
  assert.equal(manual?.command, undefined);
  assert.deepEqual(manual?.manual, { owner: "owner", expires: "2027-01-01" });
});

test("a heading ends the current item, so a later Command never attaches to it", () => {
  const last = parseChecklist(VIGIL_BODY)[3];
  assert.equal(last?.command, "test -f marker");
});

test("an Expected that only says manual is still manual, with empty fields", () => {
  const [only] = parseChecklist("- [ ] eyeball it\n  - Expected: manual\n");
  assert.deepEqual(only?.manual, { owner: "", expires: "" });
});

// ---------------------------------------------------------------------------
// parseExpectation
// ---------------------------------------------------------------------------

test("parseExpectation accepts the four forms", () => {
  assert.deepEqual(parseExpectation("exit 0"), { kind: "exit", code: 0 });
  assert.deepEqual(parseExpectation("exit -1"), { kind: "exit", code: -1 });
  assert.deepEqual(parseExpectation('stdout contains "a b"'), { kind: "stdout-contains", needle: "a b" });
  assert.deepEqual(parseExpectation("file exists dist/app.js"), { kind: "file-exists", path: "dist/app.js" });
  const matches = parseExpectation("stdout matches /^ok$/im");
  assert.ok("kind" in matches && matches.kind === "stdout-matches");
  assert.equal(matches.pattern.source, "^ok$");
  assert.equal(matches.pattern.flags, "im");
});

test("parseExpectation refuses prose and bad regex flags without throwing", () => {
  assert.deepEqual(parseExpectation(""), { error: "empty expectation string" });
  assert.ok("error" in parseExpectation("context shows draftAndNotify: false"));
  assert.ok("error" in parseExpectation("stdout matches /x/q"));
  assert.ok("error" in parseExpectation("file exists two words"));
});

// ---------------------------------------------------------------------------
// classifyCommand
// ---------------------------------------------------------------------------

test("classifyCommand: missing and blank Commands are none", () => {
  assert.equal(classifyCommand(undefined), "none");
  assert.equal(classifyCommand("   "), "none");
});

test("classifyCommand: the no-op family, alone or behind cd, is noop", () => {
  for (const cmd of ["echo todo", "printf x", "true", ":", "cd . && echo todo", "cd app", "FOO=1 echo hi", "echo a; true"]) {
    assert.equal(classifyCommand(cmd), "noop", cmd);
  }
});

test("classifyCommand: a pipe into a real command is exec", () => {
  for (const cmd of ["echo x | real-cmd", "cd app && echo 'select 1' | scripts/db-query.sh", "echoserver", "/bin/echo x", "test -f /nonexistent"]) {
    assert.equal(classifyCommand(cmd), "exec", cmd);
  }
});

test("splitShellStages keeps an escaped quote inside a double-quoted word", () => {
  // The live vigil that a naive splitter called a no-op (tracker runner.ts ~92).
  const cmd = String.raw`cd app && printf "x @> '[{\"reason\":\"broken_link\"}]';\n" | scripts/db-query.sh`;
  assert.deepEqual(splitShellStages(cmd), [
    "cd app",
    String.raw`printf "x @> '[{\"reason\":\"broken_link\"}]';\n"`,
    "scripts/db-query.sh",
  ]);
  assert.equal(classifyCommand(cmd), "exec");
});

test("splitShellStages ignores operators inside $( ) and backticks", () => {
  assert.deepEqual(splitShellStages("echo $(a | b) && echo `c; d`"), ["echo $(a | b)", "echo `c; d`"]);
  assert.deepEqual(splitShellStages("a ;; b |"), ["a", "b"]);
});

test("stageFirstToken strips leading assignments", () => {
  assert.equal(stageFirstToken('A=1 B="x y" C=\'z\' echo hi'), "echo");
});

// ---------------------------------------------------------------------------
// runCheck
// ---------------------------------------------------------------------------

test("runCheck evaluates all four Expected forms", async () => {
  const cwd = scratchDir();
  writeFileSync(join(cwd, "present.txt"), "");
  const options = { cwd, timeoutMs: 20_000 };

  assert.equal((await runCheck(check("exit 3", "exit 3"), options)).outcome, "pass");
  assert.equal((await runCheck(check("exit 3", "exit 0"), options)).outcome, "fail");
  assert.equal((await runCheck(check("echo hello >&2", 'stdout contains "hello"'), options)).outcome, "pass");
  assert.equal((await runCheck(check("echo 17", "stdout matches /^[1-9][0-9]*$/"), options)).outcome, "pass");
  assert.equal((await runCheck(check("echo 0", "stdout matches /^[1-9]/"), options)).outcome, "fail");
  assert.equal((await runCheck(check("true", "file exists present.txt"), options)).outcome, "pass");
  assert.equal((await runCheck(check("true", "file exists absent.txt"), options)).outcome, "fail");
});

test("runCheck passes extra env and reports the exit code", async () => {
  const result = await runCheck(check('echo "$DARIUS_PROBE"; exit 4', 'stdout contains "marker-9"'), {
    cwd: scratchDir(),
    timeoutMs: 20_000,
    env: { DARIUS_PROBE: "marker-9" },
  });
  assert.equal(result.outcome, "pass");
  assert.equal(result.exit, 4);
});

test("runCheck keeps only the last 4 KB of output", async () => {
  const result = await runCheck(check("head -c 10000 /dev/zero | tr '\\0' a; echo END", "exit 0"), {
    cwd: scratchDir(),
    timeoutMs: 20_000,
  });
  assert.equal(result.outcome, "pass");
  assert.ok(Buffer.byteLength(result.output) <= 4096);
  assert.ok(result.output.endsWith("END\n"));
});

test("runCheck refuses a check that is not executable", async () => {
  const options = { cwd: scratchDir(), timeoutMs: 1000 };
  await assert.rejects(runCheck({ index: 2, text: "no command", expected: "exit 0" }, options), /no Command/);
  await assert.rejects(runCheck(check("true", "looks fine to me"), options), /unknown expectation form/);
  await assert.rejects(
    runCheck({ ...check("true", "manual (owner: a, expires: 2027-01-01)"), manual: { owner: "a", expires: "2027-01-01" } }, options),
    /no executable Expected/,
  );
});

/**
 * A 30 s sleeper whose command line carries `tag`, as bash's `$0`. Not
 * `exec -a tag sleep 30`: nixpkgs builds coreutils as one binary that picks
 * the program by argv[0], so a renamed `sleep` exits at once on NixOS. The
 * `; :` keeps bash from exec-ing into sleep and dropping the tag.
 */
function tagged(tag: string): string {
  return `exec bash -c 'sleep 30; :' ${tag}`;
}

function survivors(tag: string): string {
  return spawnSync("pgrep", ["-f", tag], { encoding: "utf8" }).stdout.trim();
}

test("a check keeps the caller's PATH dirs after a login profile replaces PATH, as NixOS does", async () => {
  // NixOS's /etc/profile sets PATH outright; a ~/.bash_profile that does the
  // same stands in for it here, on any host.
  const home = scratchDir();
  writeFileSync(join(home, ".bash_profile"), "export PATH=/usr/bin:/bin\n");
  const extra = scratchDir();
  const saved = process.env.PATH;
  process.env.PATH = `${extra}:${saved ?? ""}`;
  try {
    const command = [
      `case ":$PATH:" in *":${extra}:"*) echo kept ;; *) echo lost ;; esac`,
      'echo "parent=${DARIUS_PARENT_PATH-unset}"',
      'echo "first=${PATH%%:*}"',
    ].join("; ");
    const result = await runCheck(check(command, "exit 0"), { cwd: home, timeoutMs: 10_000, env: { HOME: home } });
    assert.equal(result.outcome, "pass", result.output);
    assert.match(result.output, /^kept$/m);
    assert.match(result.output, /^parent=unset$/m);
    assert.match(result.output, /^first=\/usr\/bin$/m, "the login PATH must still come first");
  } finally {
    process.env.PATH = saved;
  }
});

test("sleep 30 with a 500 ms budget returns timeout in under 2 s", async () => {
  // The plan's done-when case. `bash -lc` needs about 0.55 s to load the login
  // profile on host-a, so the kill may land before `sleep` starts; the next
  // test covers grandchildren that are certainly running.
  const tag = `darius-check-short-${process.pid}-${Date.now()}`;
  const result = await runCheck(check(tagged(tag), "exit 0"), { cwd: scratchDir(), timeoutMs: 500 });
  assert.equal(result.outcome, "timeout");
  assert.equal(result.exit, null);
  assert.ok(result.durationMs < 2000, `took ${result.durationMs} ms`);
  assert.equal(survivors(tag), "", "a process of the timed-out group survived");
});

test("a timeout kills the whole process group, background grandchildren included", async () => {
  // Killing only the shell wrapper left 16 nested sweeps alive on 2026-09-03
  // (legacy vigil sweep). `tagged` puts the tag in each
  // grandchild's own command line, so pgrep sees them and nothing else.
  const tag = `darius-check-group-${process.pid}-${Date.now()}`;
  const command = `(${tagged(`${tag}-bg`)}) & (${tagged(`${tag}-sub`)}) & ${tagged(`${tag}-fg`)}`;
  const result = await runCheck(check(command, "exit 0"), { cwd: scratchDir(), timeoutMs: 2500 });
  assert.equal(result.outcome, "timeout");
  assert.ok(result.durationMs < 4000, `took ${result.durationMs} ms`);
  assert.equal(survivors(tag), "", "a process of the timed-out group survived");
});
