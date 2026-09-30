/**
 * The hash of every input of the web build. `bun run build` writes it to
 * `build/build-info.json`; test/web-build.test.ts computes it again and
 * fails when the committed build is older than its source (docs/concept.md,
 * "Web status page" > "Build"). Runs under Bun and Node, no dependency.
 */

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/** Paths relative to the repo root. A directory counts with every file below it. */
export const WEB_INPUTS: readonly string[] = [
  "src/web/api.ts",
  "web/app",
  "web/server",
  "web/public",
  "web/package.json",
  "web/bun.lock",
  "web/react-router.config.ts",
  "web/vite.config.ts",
  "web/tsconfig.json",
];

function files(root: string, path: string): string[] {
  const full = join(root, path);
  if (!existsSync(full)) return [];
  if (!statSync(full).isDirectory()) return [path];
  return readdirSync(full)
    .toSorted()
    .flatMap((name) => files(root, relative(root, join(full, name))));
}

export function sourceHash(repoRoot: string): string {
  const hash = createHash("sha256");
  for (const path of WEB_INPUTS.flatMap((input) => files(repoRoot, input)).toSorted()) {
    hash.update(path.replaceAll("\\", "/"));
    hash.update("\0");
    hash.update(readFileSync(join(repoRoot, path)));
    hash.update("\0");
  }
  return hash.digest("hex");
}
