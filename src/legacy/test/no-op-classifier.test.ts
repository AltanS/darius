/**
 * Pipeline-aware shell no-op classification (M315/07, patch 1).
 *
 * The old classifier read only the FIRST token of a Command, so
 * `echo "select …" | scripts/prod-psql.sh` — a real production query — was
 * filed as a placeholder and four armed vigils counted as unrunnable for that
 * reason alone. The rule now splits the Command into stages and calls it a
 * no-op only when every non-transparent stage is a no-op.
 *
 * pnpm exec vitest run test/no-op-classifier.test.ts
 */

import { describe, it, expect } from "vitest";
import {
  isTrivialCommand,
  splitShellStages,
  stageFirstToken,
} from "../lib/verification/runner.ts";

describe("splitShellStages", () => {
  it("splits on |, ||, && and ; outside quotes", () => {
    expect(splitShellStages("a | b")).toEqual(["a", "b"]);
    expect(splitShellStages("a && b")).toEqual(["a", "b"]);
    expect(splitShellStages("a || b")).toEqual(["a", "b"]);
    expect(splitShellStages("a; b")).toEqual(["a", "b"]);
    expect(splitShellStages("a; ")).toEqual(["a"]);
  });

  it("does not split on an operator inside quotes", () => {
    expect(splitShellStages(`echo "a | b; c && d"`)).toEqual([`echo "a | b; c && d"`]);
    expect(splitShellStages(`echo 'a | b'`)).toEqual([`echo 'a | b'`]);
  });

  it("keeps a backslash-escaped quote from ending the word", () => {
    // The live m312 vigil form: an embedded JSON predicate inside the SQL.
    const cmd = `printf "@> '[{\\"reason\\":\\"x\\"}]';\\n" | scripts/prod-psql.sh`;
    expect(splitShellStages(cmd)).toEqual([
      `printf "@> '[{\\"reason\\":\\"x\\"}]';\\n"`,
      "scripts/prod-psql.sh",
    ]);
  });

  it("does not split inside a command substitution or backticks", () => {
    expect(splitShellStages("echo $(grep -c x f | wc -l)")).toEqual([
      "echo $(grep -c x f | wc -l)",
    ]);
    expect(splitShellStages("echo `grep -c x f | wc -l`")).toEqual([
      "echo `grep -c x f | wc -l`",
    ]);
  });
});

describe("stageFirstToken", () => {
  it("is whole-token and strips leading assignments", () => {
    expect(stageFirstToken("echo hi")).toBe("echo");
    expect(stageFirstToken("  FOO=1 BAR='a b' true")).toBe("true");
    expect(stageFirstToken("/bin/echo hi")).toBe("/bin/echo");
    expect(stageFirstToken("")).toBe("");
  });
});

describe("isTrivialCommand — pipeline aware", () => {
  // The six cases the design names, plus the family they generalize.
  it("a no-op piped into a real command is EXECUTABLE", () => {
    expect(isTrivialCommand(`echo "select 1;" | ./scripts/prod-psql.sh`)).toBe(false);
    expect(
      isTrivialCommand(`cd acme-web && echo "select 1;" | ./scripts/prod-psql.sh`),
    ).toBe(false);
    expect(isTrivialCommand("printf '%s\\n' 'x' | tee /tmp/out")).toBe(false);
  });

  it("a bare no-op stays MANUAL", () => {
    expect(isTrivialCommand("echo manual")).toBe(true);
    expect(isTrivialCommand("echo manual: confirm the dashboard by hand")).toBe(true);
    expect(isTrivialCommand("true")).toBe(true);
    expect(isTrivialCommand(":")).toBe(true);
    expect(isTrivialCommand(": placeholder")).toBe(true);
    expect(isTrivialCommand("printf 'x'")).toBe(true);
  });

  it("an operator inside quotes does not turn a no-op into a check", () => {
    // The `|` is data, not a pipe: there is no second stage to do any work.
    expect(isTrivialCommand(`echo "run: a | b"`)).toBe(true);
    expect(isTrivialCommand(`echo 'todo; later'`)).toBe(true);
  });

  it("`cd` is transparent, so `cd x && echo y` stays MANUAL", () => {
    // Without this, `cd . && echo todo` is the one-keystroke evasion of the
    // whole classifier.
    expect(isTrivialCommand("cd x && echo y")).toBe(true);
    expect(isTrivialCommand("cd acme-web && true")).toBe(true);
    expect(isTrivialCommand("cd acme-web")).toBe(true);
    expect(isTrivialCommand("cd acme-web && pnpm test")).toBe(false);
  });

  it("every stage must be a no-op, not just the first", () => {
    expect(isTrivialCommand("echo hi && echo bye")).toBe(true);
    expect(isTrivialCommand("echo hi && test -f package.json")).toBe(false);
    expect(isTrivialCommand("test -f package.json && echo ok")).toBe(false);
  });

  it("an empty Command proves nothing and is MANUAL", () => {
    expect(isTrivialCommand("")).toBe(true);
    expect(isTrivialCommand("   ")).toBe(true);
  });

  // Regressions from the pre-pipeline classifier that must survive.
  it("keeps whole-token matching and assignment stripping", () => {
    expect(isTrivialCommand("echoserver --check")).toBe(false);
    expect(isTrivialCommand("truealike")).toBe(false);
    expect(isTrivialCommand("printfoo")).toBe(false);
    expect(isTrivialCommand("/bin/echo hi")).toBe(false);
    expect(isTrivialCommand("FOO=1 echo hi")).toBe(true);
    expect(isTrivialCommand(`FOO=1 BAR="a b" BAZ='c d' true`)).toBe(true);
    expect(isTrivialCommand("FOO=1 test -f x")).toBe(false);
  });

  it("classifies the live m312 vigil query as executable", () => {
    const cmd =
      `cd acme-web && printf "\\\\pset format csv\\nSELECT 1 WHERE g @> ` +
      `'[{\\"reason\\":\\"tip_prose_contradicts_widget\\"}]';\\n" | scripts/prod-psql.sh`;
    expect(isTrivialCommand(cmd)).toBe(false);
  });
});
