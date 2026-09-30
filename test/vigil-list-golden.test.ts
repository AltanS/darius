/**
 * The `vigil list --json` contract. It is the one legacy field set a program
 * parses (the daily vigil sweep of a project's djinn), so its fields are
 * pinned here and must survive migration phase 3, when vigils move into the
 * store: slug, path, name, due, until, from, opened, resolved, verdict. New
 * fields may be added; none of these may be renamed, dropped or retyped.
 *
 * It runs the real vendored legacy CLI (src/core/legacy-entry.ts), through
 * `bin/darius`, in a throwaway repo. It skips only while the vendored tree
 * is absent, on a branch cut before it landed.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { legacyEntryPath } from "../src/core/legacy-entry.ts";

const BIN = join(import.meta.dirname, "..", "bin", "darius");
const ENTRY = legacyEntryPath();
const SKIP = existsSync(ENTRY) ? false : `the vendored legacy CLI is not here yet (${ENTRY})`;

const FIELDS = ["slug", "path", "name", "due", "until", "from", "opened", "resolved", "verdict"] as const;

/** The pinned part of one `vigil list --json` record. */
interface Golden {
  slug: string;
  path: string;
  name: string;
  due: string | null;
  until: string | null;
  from: string | null;
  opened: string | null;
  resolved: string | null;
  verdict: string | null;
}

function vigilFile(fields: Record<string, string>): string {
  const lines = Object.entries(fields).map(([key, value]) => `${key}: ${value}`);
  return ["---", "type: vigil", ...lines, "---", "", "## Verification Checklist", "", "- [ ] check", ""].join("\n");
}

function listJson(repo: string, extra: string[]): Golden[] {
  const env: NodeJS.ProcessEnv = { ...process.env, DARIUS_LEGACY_ENTRY: ENTRY };
  delete env.DARIUS_PROJECT;
  const result = spawnSync(BIN, ["vigil", "list", ...extra, "--json"], {
    cwd: repo,
    env,
    encoding: "utf8",
    timeout: 30_000,
  });
  assert.equal(result.status, 0, result.stderr);
  const parsed: unknown = JSON.parse(result.stdout);
  assert.ok(Array.isArray(parsed));
  return parsed;
}

/** The pinned fields of each record, in the pinned order; extra fields are allowed and dropped. */
function pinned(records: Golden[]): Golden[] {
  return records.map((record) => {
    for (const field of FIELDS) assert.ok(field in record, `field ${field} is missing`);
    const { slug, path, name, due, until, from, opened, resolved, verdict } = record;
    return { slug, path, name, due, until, from, opened, resolved, verdict };
  });
}

test("vigil list --json keeps the nine legacy fields, open and closed", { skip: SKIP }, (t) => {
  const repo = mkdtempSync(join(tmpdir(), "darius-vigil-golden-"));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  const vigils = join(repo, ".tracker", "vigils");
  mkdirSync(vigils, { recursive: true });
  writeFileSync(
    join(vigils, "guard-soak.md"),
    vigilFile({
      name: "Guard soak",
      due: "2026-10-05",
      until: "first real batch",
      from: "M1/S02",
      opened: "2026-09-28",
    }),
  );
  writeFileSync(
    join(vigils, "cache-check.md"),
    vigilFile({
      name: "Cache check",
      opened: "2026-09-01",
      resolved: "2026-09-10",
      verdict: "held",
    }),
  );

  const open: Golden = {
    slug: "guard-soak",
    path: join(vigils, "guard-soak.md"),
    name: "Guard soak",
    due: "2026-10-05",
    until: "first real batch",
    from: "M1/S02",
    opened: "2026-09-28",
    resolved: null,
    verdict: null,
  };
  const closed: Golden = {
    slug: "cache-check",
    path: join(vigils, "cache-check.md"),
    name: "Cache check",
    due: null,
    until: null,
    from: null,
    opened: "2026-09-01",
    resolved: "2026-09-10",
    verdict: "held",
  };

  assert.deepEqual(pinned(listJson(repo, [])), [open]);
  assert.deepEqual(pinned(listJson(repo, ["--all"])), [closed, open]);
});
