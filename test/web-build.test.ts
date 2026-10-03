/**
 * The committed web build (web/build) must match its source. Hosts and the
 * Nix package never build the app, so a stale build would ship old pages
 * without a word (docs/concept.md, "Web status page" > "Build").
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const { sourceHash } = await import("../web/source-hash.ts");

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const BUILD = fileURLToPath(new URL("../web/build/", import.meta.url));

test("web/build is committed and built from the current source", () => {
  assert.ok(existsSync(`${BUILD}server/index.js`), "web/build/server/index.js is missing: run `bun run web:build`");
  const info: { sourceHash?: string } = JSON.parse(readFileSync(`${BUILD}build-info.json`, "utf8"));
  assert.equal(info.sourceHash, sourceHash(ROOT), "web/build is older than its source: run `bun run web:build` and commit web/build");
});

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? filesUnder(`${dir}${entry.name}/`) : [`${dir}${entry.name}`]));
}

test("every file of web/build is committed, none is git-ignored", () => {
  const paths = filesUnder(BUILD).map((path) => path.slice(ROOT.length));
  // `git check-ignore` exits 1 when no path is ignored.
  const run = spawnSync("git", ["check-ignore", "--stdin"], { cwd: ROOT, input: paths.join("\n"), encoding: "utf8" });
  assert.ok(run.status === 0 || run.status === 1, `git check-ignore failed: ${run.stderr}`);
  assert.equal(run.stdout.trim(), "", "a .gitignore rule hides these build files from the commit; hosts would miss them");
});
