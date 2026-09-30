/**
 * Verification grammar integration tests.
 *
 * Satisfies the spec 01 verification check:
 *   `pnpm vitest run verification` must exit 0
 *
 * This file re-exports the grammar tests as a named suite so the
 * `verification` filter matches. It also adds a round-trip test that
 * exercises the full parse → VerificationStep pipeline.
 */

import { describe, it, expect } from "vitest";
import {
  parseExpectation,
  isGrammarError,
  isVerificationStep,
  type VerificationStep,
} from "../lib/verification/grammar.js";
import { runVerification, isTrivialCommand } from "../lib/verification/runner.ts";

describe("verification grammar — discriminated union correctness", () => {
  it("exit form produces kind: exit", () => {
    const result = parseExpectation("exit 0");
    expect(isVerificationStep(result)).toBe(true);
    if (isVerificationStep(result)) {
      expect(result.kind).toBe("exit");
    }
  });

  it("stdout-contains form produces kind: stdout-contains", () => {
    const result = parseExpectation('stdout contains "hello"');
    expect(isVerificationStep(result)).toBe(true);
    if (isVerificationStep(result)) {
      expect(result.kind).toBe("stdout-contains");
    }
  });

  it("stdout-matches form produces kind: stdout-matches", () => {
    const result = parseExpectation("stdout matches /\\d+/");
    expect(isVerificationStep(result)).toBe(true);
    if (isVerificationStep(result)) {
      expect(result.kind).toBe("stdout-matches");
    }
  });

  it("file-exists form produces kind: file-exists", () => {
    const result = parseExpectation("file exists /path/to/file.ts");
    expect(isVerificationStep(result)).toBe(true);
    if (isVerificationStep(result)) {
      expect(result.kind).toBe("file-exists");
    }
  });

  it("all four kinds are the only valid discriminants", () => {
    const validKinds = new Set<VerificationStep["kind"]>([
      "exit",
      "stdout-contains",
      "stdout-matches",
      "file-exists",
    ]);

    const testCases = [
      "exit 0",
      "exit 1",
      'stdout contains "foo"',
      "stdout matches /bar/",
      "file exists /tmp/x",
    ];

    for (const input of testCases) {
      const result = parseExpectation(input);
      if (isVerificationStep(result)) {
        expect(validKinds.has(result.kind)).toBe(true);
      }
    }
  });

  it("returns a grammar error (not throws) for unknown forms", () => {
    const result = parseExpectation("unknown form");
    expect(isGrammarError(result)).toBe(true);
    expect(isVerificationStep(result)).toBe(false);
  });

  it("parses the spec 01 fixture expected values correctly", () => {
    // From the actual spec verification checklist
    const specExpectations = [
      "exit 0",
      "exit 1",
      "stdout matches /\\d+/",
    ];

    for (const exp of specExpectations) {
      const result = parseExpectation(exp);
      expect(isVerificationStep(result)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Runner regression: trailing-newline stdout vs end-anchored regexes
// ---------------------------------------------------------------------------

// These three used to drive the runner with `printf`. `printf` is now a
// TRIVIAL command (see the trivial-classification suite below) and short-circuits
// to `manual` before anything executes, so the fixtures moved to `awk`, which
// emits the identical bytes through a command that actually runs.
describe("runVerification — stdout-matches vs trailing newline", () => {
  it("end-anchored count regex passes despite the shell's trailing newline", () => {
    // Regression: `grep -c`-style output ("6\n") used to fail /^[5-9]$|^[1-9][0-9]+$/
    // because `$` without /m never matches past the trailing newline.
    const result = runVerification({
      command: `awk 'BEGIN{printf "6\\n"}'`,
      expected: "stdout matches /^[5-9]$|^[1-9][0-9]+$/",
      index: 0,
      label: "count check",
    });
    expect(result.outcome).toBe("pass");
  });

  it("still fails when the trimmed output genuinely does not match", () => {
    const result = runVerification({
      command: `awk 'BEGIN{printf "4\\n"}'`,
      expected: "stdout matches /^[5-9]$/",
      index: 0,
      label: "count check",
    });
    expect(result.outcome).toBe("fail");
  });

  it("an explicit /m flag now survives parsing for multi-line output", () => {
    const result = runVerification({
      command: `awk 'BEGIN{printf "noise\\nok\\nmore\\n"}'`,
      expected: "stdout matches /^ok$/m",
      index: 0,
      label: "line anchor check",
    });
    expect(result.outcome).toBe("pass");
  });
});

// ---------------------------------------------------------------------------
// Trivial-command classification (M247/0a)
// ---------------------------------------------------------------------------

describe("isTrivialCommand", () => {
  it("classifies the four shell no-ops", () => {
    for (const cmd of [
      "echo hello",
      "echo manual: confirm by hand",
      "true",
      "printf 'x'",
      ":",
      ": placeholder",
      "  echo indented",
    ]) {
      expect(isTrivialCommand(cmd), cmd).toBe(true);
    }
  });

  it("does not classify real commands", () => {
    for (const cmd of [
      "test -f package.json",
      "pnpm test",
      "grep -c foo bar.txt",
      "node -e \"process.exit(0)\"",
      // Prefix match must be whole-token: these only START with the letters.
      "echoserver --check",
      "truealike",
      "printfoo",
      "/bin/echo hi",
    ]) {
      expect(isTrivialCommand(cmd), cmd).toBe(false);
    }
  });

  it("strips leading VAR=val assignments before classifying", () => {
    expect(isTrivialCommand("FOO=1 echo hi")).toBe(true);
    expect(isTrivialCommand(`FOO=1 BAR="a b" BAZ='c d' true`)).toBe(true);
    expect(isTrivialCommand("FOO=1 test -f x")).toBe(false);
  });
});

describe("runVerification — trivial commands never pass", () => {
  it("returns manual for a no-op command that would otherwise exit 0", () => {
    const result = runVerification({
      command: "echo manual: I checked the dashboard",
      expected: "exit 0",
      index: 3,
      label: "dashboard reviewed",
    });
    expect(result.outcome).toBe("manual");
    expect(result.exitCode).toBeNull();
  });

  it("returns manual even when the assertion would have matched the output", () => {
    const result = runVerification({
      command: "echo hello",
      expected: 'stdout contains "hello"',
      index: 0,
      label: "echo check",
    });
    expect(result.outcome).toBe("manual");
  });

  it("returns manual even when Expected is file-exists (which ignores the command)", () => {
    // The file genuinely exists — the point is that a no-op Command paired with
    // an assertion that never runs it must not earn a tick either.
    const result = runVerification({
      command: "echo n/a",
      expected: "file exists package.json",
      index: 0,
      label: "package manifest present",
    });
    expect(result.outcome).toBe("manual");
  });

  it("still reports a grammar error rather than manual when both are wrong", () => {
    const result = runVerification({
      command: "echo hi",
      expected: "wat",
      index: 0,
      label: "bad grammar",
    });
    expect(result.outcome).toBe("error");
  });

  it("a real command with the same assertion still passes", () => {
    const result = runVerification({
      command: `awk 'BEGIN{print "hello"}'`,
      expected: 'stdout contains "hello"',
      index: 0,
      label: "awk check",
    });
    expect(result.outcome).toBe("pass");
    expect(result.exitCode).toBe(0);
  });
});
