/**
 * The scope of a boxed launch (src/core/box-scope.ts, 0.124.0): the slice
 * name check, the unit name and the argv in front of bwrap. Pure; the launch
 * with a fake systemd-run is in test/box-launch.test.ts.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { findSystemdRun, randomTag, scopePrefix, scopeUnit, sliceProblem } from "../src/core/box-scope.ts";

test("sliceProblem: a name of unit characters that ends in .slice passes; anything else says why", () => {
  for (const name of ["agents.slice", "app-agents.slice", "a:b_c.d-e.slice"]) assert.equal(sliceProblem(name), undefined, name);
  for (const name of ["agents", ".slice", "-.slice", ".hidden.slice", "a b.slice", "a/b.slice", "a$b.slice", "agents.slice ", "agents.scope"]) {
    assert.match(sliceProblem(name) ?? "", /ends in \.slice/u, name);
  }
  assert.match(sliceProblem(`${"a".repeat(250)}.slice`) ?? "", /longer than 255/u);
});

test("scopeUnit: the last 8 characters of the run id, lower case, and the tag; randomTag is six hex digits and changes", () => {
  assert.equal(scopeUnit("01KA0000000000000000ABCDEF", "a1b2c3"), "darius-run-00abcdef-a1b2c3");
  assert.equal(scopeUnit("r1", "a1b2c3"), "darius-run-r1-a1b2c3");
  assert.match(randomTag(), /^[0-9a-f]{6}$/u);
  const tags = new Set(Array.from({ length: 20 }, () => randomTag()));
  assert.ok(tags.size > 1, "a fresh tag per launch");
});

test("scopePrefix: a user scope in the slice, quiet, named, collected, then -- before bwrap", () => {
  assert.deepEqual(scopePrefix({ systemdRun: "/usr/bin/systemd-run", slice: "agents.slice", unit: "darius-run-r1-a1b2c3" }), [
    "/usr/bin/systemd-run", "--user", "--scope", "-q", "--slice=agents.slice", "--unit=darius-run-r1-a1b2c3", "--collect", "--",
  ]);
});

test("findSystemdRun: DARIUS_SYSTEMD_RUN replaces the search; a missing one gives none", () => {
  const dir = mkdtempSync(join(tmpdir(), "darius-scope-"));
  const fake = join(dir, "systemd-run");
  writeFileSync(fake, "#!/bin/sh\nexit 0\n");
  chmodSync(fake, 0o755);
  const saved = process.env.DARIUS_SYSTEMD_RUN;
  try {
    process.env.DARIUS_SYSTEMD_RUN = fake;
    assert.equal(findSystemdRun(), fake);
    process.env.DARIUS_SYSTEMD_RUN = join(dir, "missing");
    assert.equal(findSystemdRun(), undefined);
  } finally {
    if (saved === undefined) delete process.env.DARIUS_SYSTEMD_RUN;
    else process.env.DARIUS_SYSTEMD_RUN = saved;
  }
});
