/**
 * Tests for the verification grammar parser.
 *
 * Covers all four discriminant kinds: exit | stdout-contains |
 * stdout-matches | file-exists, plus error cases.
 */

import { describe, it, expect } from "vitest";
import {
  parseExpectation,
  isGrammarError,
  isVerificationStep,
} from "../lib/verification/grammar.js";

describe("parseExpectation — exit form", () => {
  it("parses exit 0", () => {
    const result = parseExpectation("exit 0");
    expect(isVerificationStep(result)).toBe(true);
    if (isVerificationStep(result)) {
      expect(result.kind).toBe("exit");
      if (result.kind === "exit") {
        expect(result.code).toBe(0);
      }
    }
  });

  it("parses exit 1", () => {
    const result = parseExpectation("exit 1");
    expect(isVerificationStep(result)).toBe(true);
    if (isVerificationStep(result) && result.kind === "exit") {
      expect(result.code).toBe(1);
    }
  });

  it("parses negative exit codes", () => {
    const result = parseExpectation("exit -1");
    expect(isVerificationStep(result)).toBe(true);
    if (isVerificationStep(result) && result.kind === "exit") {
      expect(result.code).toBe(-1);
    }
  });

  it("parses exit with extra whitespace", () => {
    const result = parseExpectation("  exit 2  ");
    expect(isVerificationStep(result)).toBe(true);
    if (isVerificationStep(result) && result.kind === "exit") {
      expect(result.code).toBe(2);
    }
  });
});

describe("parseExpectation — stdout-contains form", () => {
  it("parses plain string without quotes", () => {
    const result = parseExpectation("stdout contains hello world");
    expect(isVerificationStep(result)).toBe(true);
    if (isVerificationStep(result)) {
      expect(result.kind).toBe("stdout-contains");
      if (result.kind === "stdout-contains") {
        expect(result.needle).toBe("hello world");
      }
    }
  });

  it("parses double-quoted string", () => {
    const result = parseExpectation('stdout contains "hello world"');
    expect(isVerificationStep(result)).toBe(true);
    if (isVerificationStep(result) && result.kind === "stdout-contains") {
      expect(result.needle).toBe("hello world");
    }
  });

  it("is case-sensitive (does not alter needle)", () => {
    const result = parseExpectation("stdout contains Hello");
    if (isVerificationStep(result) && result.kind === "stdout-contains") {
      expect(result.needle).toBe("Hello");
    }
  });
});

describe("parseExpectation — stdout-matches form", () => {
  it("parses a simple regex literal", () => {
    const result = parseExpectation("stdout matches /\\d+/");
    expect(isVerificationStep(result)).toBe(true);
    if (isVerificationStep(result)) {
      expect(result.kind).toBe("stdout-matches");
      if (result.kind === "stdout-matches") {
        expect(result.pattern.test("42")).toBe(true);
        expect(result.pattern.test("abc")).toBe(false);
      }
    }
  });

  it("parses a regex with flags", () => {
    const result = parseExpectation("stdout matches /hello/i");
    expect(isVerificationStep(result)).toBe(true);
    if (isVerificationStep(result) && result.kind === "stdout-matches") {
      expect(result.pattern.flags).toBe("i");
      expect(result.pattern.test("HELLO")).toBe(true);
    }
  });

  it("preserves the /m flag so ^/$ anchor per line", () => {
    const result = parseExpectation("stdout matches /^ok$/m");
    expect(isVerificationStep(result)).toBe(true);
    if (isVerificationStep(result) && result.kind === "stdout-matches") {
      expect(result.pattern.flags).toBe("m");
      expect(result.pattern.test("noise\nok\nmore")).toBe(true);
    }
  });

  it("returns grammar error for invalid flags", () => {
    const result = parseExpectation("stdout matches /hello/q");
    expect(isGrammarError(result)).toBe(true);
  });

  it("returns grammar error for invalid regex", () => {
    const result = parseExpectation("stdout matches /[invalid/");
    expect(isGrammarError(result)).toBe(true);
  });

  it("parses undelimited regex pattern", () => {
    const result = parseExpectation("stdout matches [0-9]+");
    expect(isVerificationStep(result)).toBe(true);
    if (isVerificationStep(result) && result.kind === "stdout-matches") {
      expect(result.pattern.test("42")).toBe(true);
    }
  });
});

describe("parseExpectation — file-exists form", () => {
  it("parses a simple path", () => {
    const result = parseExpectation("file exists /tmp/test.txt");
    expect(isVerificationStep(result)).toBe(true);
    if (isVerificationStep(result)) {
      expect(result.kind).toBe("file-exists");
      if (result.kind === "file-exists") {
        expect(result.path).toBe("/tmp/test.txt");
      }
    }
  });

  it("parses a relative path", () => {
    const result = parseExpectation("file exists fixtures/foo.md");
    expect(isVerificationStep(result)).toBe(true);
    if (isVerificationStep(result) && result.kind === "file-exists") {
      expect(result.path).toBe("fixtures/foo.md");
    }
  });
});

describe("parseExpectation — error cases", () => {
  it("returns error for empty string", () => {
    const result = parseExpectation("");
    expect(isGrammarError(result)).toBe(true);
  });

  it("returns error for whitespace-only string", () => {
    const result = parseExpectation("   ");
    expect(isGrammarError(result)).toBe(true);
  });

  it("returns error for unknown form", () => {
    const result = parseExpectation("banana is yellow");
    expect(isGrammarError(result)).toBe(true);
  });

  it("produces discriminated union — four distinct kinds only", () => {
    const validKinds = new Set(["exit", "stdout-contains", "stdout-matches", "file-exists"]);
    const inputs = [
      "exit 0",
      'stdout contains "foo"',
      "stdout matches /bar/",
      "file exists /tmp/x",
    ];
    for (const input of inputs) {
      const result = parseExpectation(input);
      if (isVerificationStep(result)) {
        expect(validKinds.has(result.kind)).toBe(true);
      }
    }
  });
});
