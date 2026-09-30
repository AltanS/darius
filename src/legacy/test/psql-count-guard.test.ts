/**
 * A production count paired with `exit 0` (M316/19).
 *
 * `prod-psql.sh <<< "SELECT count(*) FROM creations WHERE ..."` with
 * `Expected: exit 0` asserts that psql ran, never what it answered. It passes
 * on 0 rows and on 703 rows alike.
 *
 * Measured 2026-09-20 across `.tracker`: four such items were ticked and all
 * four were false — `squad_provenance` is not a table, `content_selections`
 * has no `website_id` column, and the two real counts were 703 and 592.
 *
 * The guard refuses the item at CLASSIFICATION time, so `--dry-run` and a real
 * run agree and nothing is spawned.
 *
 * pnpm exec vitest run test/psql-count-guard.test.ts
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { classifyItem, queryAnswerDiscarded } from "../lib/verification/runner.ts";

const item = (command: string, expected: string) => ({
  command,
  expected,
  index: 2,
  label: "a production check",
});

/** The real Command from M345/05 that ticked green while production held 703 rows. */
const M345_COMMAND =
  `cd acme-web && ./scripts/prod-psql.sh <<< "SELECT count(*) FROM creations WHERE ` +
  `status='published' AND context->'integrityChecks'->'bettingTipSlateMismatch'->>'passed'='false';"`;

describe("queryAnswerDiscarded", () => {
  it("catches a counting query through the production wrapper", () => {
    expect(queryAnswerDiscarded(M345_COMMAND)).toBe(true);
  });

  it("catches the heredoc and the pipe spelling alike", () => {
    expect(
      queryAnswerDiscarded(`echo "SELECT count(*) FROM creations;" | acme-web/scripts/prod-psql.sh`),
    ).toBe(true);
    expect(
      queryAnswerDiscarded(`cd acme-web && ./scripts/prod-psql.sh <<< "SELECT COUNT (1) FROM jobs;"`),
    ).toBe(true);
  });

  it("leaves a constant connectivity probe alone", () => {
    expect(
      queryAnswerDiscarded(`cd acme-web && echo "SELECT 1;" | ./scripts/prod-psql.sh >/dev/null 2>&1`),
    ).toBe(false);
  });

  it("leaves a deliberately negated command alone — there the exit IS the assertion", () => {
    expect(
      queryAnswerDiscarded(
        `cd acme-web && ! (echo "SELECT count(*) FROM a_table_that_does_not_exist;" | ` +
          `./scripts/prod-psql.sh >/dev/null 2>&1)`,
      ),
    ).toBe(false);
  });

  it("leaves a non-SQL command alone", () => {
    expect(queryAnswerDiscarded(`cd acme-web && rg -q "ON_ERROR_STOP" scripts/prod-psql.sh`)).toBe(
      false,
    );
  });

  it("leaves a listing query alone — it has no count to discard", () => {
    expect(
      queryAnswerDiscarded(`echo "SELECT id, status FROM creations LIMIT 5;" | scripts/prod-psql.sh`),
    ).toBe(false);
  });
});

describe("classifyItem — a discarded count is refused, not executed", () => {
  it("refuses the M345/05 pair as a grammar error", () => {
    const result = classifyItem(item(M345_COMMAND, "exit 0"));
    expect(result.kind).toBe("grammar-error");
    if (result.kind !== "grammar-error") throw new Error("unreachable");
    expect(result.reason).toContain("asks production for a count");
    expect(result.reason).toContain("703");
  });

  it("accepts the same Command once it asserts the number", () => {
    const result = classifyItem(
      item(
        `cd acme-web && printf "\\\\t on\\nSELECT count(*) FROM creations;\\n" | ./scripts/prod-psql.sh`,
        "stdout matches /^\\s*0\\s*$/",
      ),
    );
    expect(result.kind).toBe("would-execute");
  });

  it("still accepts the connectivity probe with exit 0", () => {
    const result = classifyItem(
      item(`cd acme-web && echo "SELECT 1;" | ./scripts/prod-psql.sh >/dev/null 2>&1`, "exit 0"),
    );
    expect(result.kind).toBe("would-execute");
  });

  it("still accepts the negated non-existent-relation check", () => {
    const result = classifyItem(
      item(
        `cd acme-web && ! (echo "SELECT count(*) FROM a_table_that_does_not_exist;" | ` +
          `./scripts/prod-psql.sh >/dev/null 2>&1)`,
        "exit 0",
      ),
    );
    expect(result.kind).toBe("would-execute");
  });
});

describe("a real assertion after the wrapper stands the guard down", () => {
  it("leaves `| grep -q TOKEN` alone — grep carries the status", () => {
    const command =
      `cd acme-web && ./scripts/prod-psql.sh <<< "select case when count(*) > 0 then 'PRESENT' ` +
      `else 'ABSENT' end from podcast_facts" | grep -q PRESENT`;
    expect(queryAnswerDiscarded(command)).toBe(false);
    expect(classifyItem(item(command, "exit 0")).kind).toBe("would-execute");
  });

  it("still catches the wrapper as the last stage", () => {
    const command = `echo "SELECT count(*) FROM operations;" | acme-web/scripts/prod-psql.sh`;
    expect(queryAnswerDiscarded(command)).toBe(true);
  });
});
