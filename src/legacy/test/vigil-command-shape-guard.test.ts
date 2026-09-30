/**
 * M346/03 — a `Command:` the PARSER cannot run must never be armed.
 *
 * Both the tracker runner and a project's own sweep script read ONLY THE FIRST LINE of a `Command:`.
 * A multi-line Command therefore reaches the shell truncated and dies on an unterminated quote or
 * heredoc, and the sweep files that as an ordinary failure. A check that has NEVER EXECUTED then
 * looks exactly like a check that ran and failed.
 *
 * Measured 2026-09-10 across 222 vigil files on this estate: 13 carried a `<<` heredoc and 18
 * carried an unquoted `<placeholder>`. `m320-09` carried both, and every daily sweep since it was
 * armed had run `/bin/sh: unexpected EOF` for it.
 *
 * pnpm exec vitest run test/vigil-command-shape-guard.test.ts
 */

import { describe, it, expect } from "vitest";
import { findUnrunnableCommandShapes } from "../lib/tracker-writer.ts";

function body(command: string): string {
  return ["## Verification Checklist", "", `- [ ] a check`, `  - Command: ${command}`, "  - Expected: `exit 0`", ""].join("\n");
}

describe("findUnrunnableCommandShapes", () => {
  it("passes a plain one-line Command", () => {
    expect(findUnrunnableCommandShapes(body("`cd acme-web && ./scripts/prod-psql.sh < q.sql`"))).toEqual([]);
  });

  it("refuses an unbalanced backtick, which is what a multi-line Command looks like", () => {
    const reasons = findUnrunnableCommandShapes(
      ["## Verification Checklist", "", "- [ ] a check", "  - Command: `cd acme-web && psql", "SELECT 1;", "`", ""].join("\n"),
    );
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toContain("unbalanced backtick");
  });

  it("refuses a heredoc, whose body lives on lines the parser never reads", () => {
    const reasons = findUnrunnableCommandShapes(body("`cd acme-web && cat <<'SQL' | ./scripts/prod-psql.sh`"));
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toContain("heredoc");
  });

  it("refuses a quoteless heredoc too", () => {
    expect(findUnrunnableCommandShapes(body("`cat <<SQL | psql`"))[0]).toContain("heredoc");
  });

  it("refuses an unquoted <placeholder>, which the shell reads as a redirect", () => {
    const reasons = findUnrunnableCommandShapes(body("`psql -c \"select 1\" > <deploy-timestamp>`"));
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toContain("placeholder");
  });

  it("ALLOWS a placeholder inside quotes, because the shell never interprets it", () => {
    // This is the correct way to leave a token for a human to substitute later.
    expect(findUnrunnableCommandShapes(body("`psql -c \"select 1 where t > '<deploy-ts>'\"`"))).toEqual([]);
  });

  it("does not mistake SQL comparison operators for a placeholder", () => {
    expect(findUnrunnableCommandShapes(body("`psql -c 'select count(*) from t where a < 5 and b <> 2'`"))).toEqual([]);
  });

  it("does not mistake a redirect or process substitution for a placeholder", () => {
    expect(findUnrunnableCommandShapes(body("`psql < q.sql 2>&1`"))).toEqual([]);
    expect(findUnrunnableCommandShapes(body("`diff <(a) <(b)`"))).toEqual([]);
  });

  it("reports one reason per offending Command", () => {
    const two = [
      "## Verification Checklist",
      "",
      "- [ ] one",
      "  - Command: `cat <<'SQL' | psql`",
      "- [ ] two",
      "  - Command: `psql > <ts>`",
      "",
    ].join("\n");
    expect(findUnrunnableCommandShapes(two)).toHaveLength(2);
  });

  it("finds nothing in a body with no Command lines at all", () => {
    expect(findUnrunnableCommandShapes("## Verification Checklist\n\n- [ ] manual thing\n")).toEqual([]);
  });
});
