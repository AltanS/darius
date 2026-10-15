/**
 * The fingerprint of what the icons are made from: the emblem, the render script and the
 * list of startup image sizes. `bun run icons` writes it to `scripts/icons.sha256`, and
 * test/web-assets.test.ts computes it again. A change to any of the three without a new
 * render fails the suite, so the PNGs in `web/public` never fall behind their source. It
 * uses `node:crypto` only: the test runs without the renderer.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Paths below `web/`, in hash order. */
export const ICON_SOURCES: readonly string[] = ["public/favicon.svg", "scripts/icons.ts", "app/lib/splash.ts"];

export function iconsHash(webDir: string): string {
  const hash = createHash("sha256");
  for (const path of ICON_SOURCES) {
    hash.update(path);
    hash.update("\0");
    hash.update(readFileSync(join(webDir, path)));
    hash.update("\0");
  }
  return hash.digest("hex");
}
