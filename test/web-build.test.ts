/**
 * The committed web build (web/build) must match its source. Hosts and the
 * Nix package never build the app, so a stale build would ship old pages
 * without a word (docs/concept.md, "Web status page" > "Build").
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const { sourceHash } = await import("../web/source-hash.ts");

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const BUILD = fileURLToPath(new URL("../web/build/", import.meta.url));

test("web/build is committed and built from the current source", () => {
  assert.ok(existsSync(`${BUILD}server/index.js`), "web/build/server/index.js is missing: run `bun run web:build`");
  const info: { sourceHash?: string } = JSON.parse(readFileSync(`${BUILD}build-info.json`, "utf8"));
  assert.equal(info.sourceHash, sourceHash(ROOT), "web/build is older than its source: run `bun run web:build` and commit web/build");
});
