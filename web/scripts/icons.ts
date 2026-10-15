/**
 * Renders every icon and startup image of the installed app from the one emblem,
 * `web/public/favicon.svg`: `cd web && bun run icons`. The artwork has one source;
 * the PNGs in `web/public` are its output, and the file names stay what the manifest
 * and `root.tsx` name. The renderer, `@resvg/resvg-js`, is a dev dependency of `web/`
 * only: this script runs on the dev machine, and neither the CLI nor the server bundle
 * ever loads it. Commit the PNGs with the change that made them (`bun run web:build`
 * hashes `web/public`).
 *
 * Output:
 * - `icon-192.png`, `icon-512.png`: the emblem on the night ground, "any" purpose.
 * - `icon-maskable-512.png`: the same, smaller, inside the safe zone of a mask.
 * - `apple-touch-icon.png`: 180 px, the home screen icon on iOS.
 * - `badge-72.png`: the emblem as a white silhouette on transparent, for notification badges.
 * - `splash-<w>x<h>.png`: the iOS startup images (`app/lib/splash.ts` lists the devices).
 * - `scripts/icons.sha256`: the fingerprint of the sources (`icons-hash.ts`), which a test checks.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Resvg } from "@resvg/resvg-js";

import { SPLASH_SIZES, splashFile, splashPixels } from "../app/lib/splash.ts";
import { iconsHash } from "./icons-hash.ts";

const WEB = join(dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = join(WEB, "public");
/** The ground of the dark theme and of the manifest (`background_color`). */
const NIGHT = "#15100b";
/** The emblem spans 2 to 30 of its 32 unit grid. */
const GEM_SPAN = 28;
const GRID_CENTRE = 16;

/** The five facets of `favicon.svg`: the `<g>` that holds them, without the ground square. */
function emblemOf(svg: string): string {
  const found = /<g\b[\s\S]*<\/g>/u.exec(svg);
  if (found === null) throw new Error("favicon.svg has no <g> with the facets");
  return found[0];
}

/** An svg of `width` by `height` with the ground colour and the emblem centred, as wide as `share` of the shorter side. */
function composed(emblem: string, width: number, height: number, share: number, ground: string | null): string {
  const side = Math.min(width, height) * share;
  const scale = side / GEM_SPAN;
  const x = width / 2 - GRID_CENTRE * scale;
  const y = height / 2 - GRID_CENTRE * scale;
  const back = ground === null ? "" : `<rect width="${width}" height="${height}" fill="${ground}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${back}<g transform="translate(${x} ${y}) scale(${scale})">${emblem}</g></svg>`;
}

/** The silhouette: every facet white, the gaps between them transparent, nothing else. */
function badgeSvg(emblem: string, size: number): string {
  // The black edges eat a unit off the outside, so the share is a little more than the 67 percent of the old badge.
  const scale = (size * 0.74) / GEM_SPAN;
  const offset = size / 2 - GRID_CENTRE * scale;
  // In a mask white shows and black hides: the facets are white, and their edges (the stroke of the group) black.
  const facets = emblem.replaceAll(/fill="#[0-9a-f]{6}"/giu, 'fill="#fff"').replaceAll(/stroke="#[0-9a-f]{6}"/giu, 'stroke="#000"');
  const place = `translate(${offset} ${offset}) scale(${scale})`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><mask id="gaps"><rect width="${size}" height="${size}" fill="#000"/><g transform="${place}">${facets}</g></mask><rect width="${size}" height="${size}" fill="#fff" mask="url(#gaps)"/></svg>`;
}

function write(name: string, svg: string): void {
  const png = new Resvg(svg).render().asPng();
  writeFileSync(join(PUBLIC, name), png);
  console.log(`${name}  ${String(png.length)} bytes`);
}

const emblem = emblemOf(readFileSync(join(PUBLIC, "favicon.svg"), "utf8"));

write("icon-192.png", composed(emblem, 192, 192, 0.72, NIGHT));
write("icon-512.png", composed(emblem, 512, 512, 0.72, NIGHT));
write("icon-maskable-512.png", composed(emblem, 512, 512, 0.48, NIGHT));
write("apple-touch-icon.png", composed(emblem, 180, 180, 0.61, NIGHT));
write("badge-72.png", badgeSvg(emblem, 72));
for (const size of SPLASH_SIZES) {
  // The emblem is 30 percent of the width on a phone and 20 percent on a tablet.
  const { width, height } = splashPixels(size);
  write(splashFile(size), composed(emblem, width, height, size.cssWidth >= 600 ? 0.2 : 0.3, NIGHT));
}

// The fingerprint of the sources, so the suite fails when the artwork or this script changes without a render.
// The hash reads this file as it is on disk, so write it last and run the script again only after an edit.
writeFileSync(join(WEB, "scripts", "icons.sha256"), `${iconsHash(WEB)}\n`);
console.log("icons.sha256 written");
