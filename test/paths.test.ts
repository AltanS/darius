/**
 * Path resolution and project resolution (docs/plan-tonight.md, "Config and
 * paths"). Every case here runs inside a throwaway `DARIUS_CONFIG_DIR` /
 * `DARIUS_STATE_DIR` (`scripts/test.sh` sets these for the whole suite; the
 * per-test `mkdtemp` calls below are for the filesystem-walk cases, which
 * need their own scratch directory tree rather than the shared one).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configDir, projectDir, resolveProject, stateDir } from "../src/core/paths.ts";
import { UsageError } from "../src/core/model.ts";

test("configDir and stateDir honour their env overrides", () => {
  assert.equal(configDir(), process.env.DARIUS_CONFIG_DIR);
  assert.equal(stateDir(), process.env.DARIUS_STATE_DIR);
});

test("projectDir joins the state dir with the project name", () => {
  assert.equal(projectDir("darius-selftest"), join(stateDir(), "darius-selftest"));
});

test("resolveProject prefers the --project flag over everything else", () => {
  const previous = process.env.DARIUS_PROJECT;
  process.env.DARIUS_PROJECT = "from-env";
  try {
    assert.equal(resolveProject("from-flag"), "from-flag");
  } finally {
    if (previous === undefined) delete process.env.DARIUS_PROJECT;
    else process.env.DARIUS_PROJECT = previous;
  }
});

test("resolveProject falls back to DARIUS_PROJECT when no flag is given", () => {
  const previous = process.env.DARIUS_PROJECT;
  process.env.DARIUS_PROJECT = "from-env";
  try {
    assert.equal(resolveProject(), "from-env");
  } finally {
    if (previous === undefined) delete process.env.DARIUS_PROJECT;
    else process.env.DARIUS_PROJECT = previous;
  }
});

test("resolveProject walks up to a .darius.toml marker when no flag or env is set", () => {
  const previous = process.env.DARIUS_PROJECT;
  delete process.env.DARIUS_PROJECT;
  const root = mkdtempSync(join(tmpdir(), "darius-paths-test-"));
  const nested = join(root, "a", "b", "c");
  mkdirSync(nested, { recursive: true });
  writeFileSync(join(root, ".darius.toml"), 'project = "acme-web"\n');
  try {
    assert.equal(resolveProject(undefined, nested), "acme-web");
  } finally {
    rmSync(root, { recursive: true, force: true });
    if (previous === undefined) delete process.env.DARIUS_PROJECT;
    else process.env.DARIUS_PROJECT = previous;
  }
});

test("resolveProject refuses with a UsageError when nothing resolves", () => {
  const previous = process.env.DARIUS_PROJECT;
  delete process.env.DARIUS_PROJECT;
  const root = mkdtempSync(join(tmpdir(), "darius-paths-test-"));
  try {
    assert.throws(() => resolveProject(undefined, root), UsageError);
  } finally {
    rmSync(root, { recursive: true, force: true });
    if (previous === undefined) delete process.env.DARIUS_PROJECT;
    else process.env.DARIUS_PROJECT = previous;
  }
});
