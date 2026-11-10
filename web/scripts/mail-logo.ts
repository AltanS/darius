/**
 * Renders the mail logo (0.131.0) from the one emblem, `web/public/favicon.svg`:
 * `cd web && bun scripts/mail-logo.ts`. The candle and report mails show it from
 * raw.githubusercontent.com, pinned to the release tag (src/core/mail-shell.ts),
 * because a mail client renders no inline SVG and Gmail blocks `data:` images.
 *
 * The same renderer as `scripts/icons.ts`, `@resvg/resvg-js`, a dev dependency of
 * `web/` only, so the same source gives the same bytes. The emblem keeps its
 * colours and its dark edges, on a transparent ground, for the dark mail card.
 * Commit the PNGs with the change that made them.
 *
 * Output, in `assets/email/` at the repo root:
 * - `gem-96.png`: 96 by 96, shown at 48 by 48 (2x).
 * - `gem-48.png`: 48 by 48, the 1x.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Resvg } from "@resvg/resvg-js";

const WEB = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(WEB, "..", "assets", "email");
/** The emblem spans 2 to 30 of its 32 unit grid. */
const GEM_SPAN = 28;
const GRID_CENTRE = 16;
/** The share of the side the emblem fills, so its edge stroke stays inside the image. */
const SHARE = 0.9;

/** The five facets of `favicon.svg`: the `<g>` that holds them, without the ground square. */
function emblemOf(svg: string): string {
  const found = /<g\b[\s\S]*<\/g>/u.exec(svg);
  if (found === null) throw new Error("favicon.svg has no <g> with the facets");
  return found[0];
}

function logoSvg(emblem: string, size: number): string {
  const scale = (size * SHARE) / GEM_SPAN;
  const offset = size / 2 - GRID_CENTRE * scale;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${String(size)}" height="${String(size)}" viewBox="0 0 ${String(size)} ${String(size)}"><g transform="translate(${String(offset)} ${String(offset)}) scale(${String(scale)})">${emblem}</g></svg>`;
}

const emblem = emblemOf(readFileSync(join(WEB, "public", "favicon.svg"), "utf8"));
mkdirSync(OUT, { recursive: true });
for (const size of [96, 48]) {
  const png = new Resvg(logoSvg(emblem, size)).render().asPng();
  writeFileSync(join(OUT, `gem-${String(size)}.png`), png);
  console.log(`assets/email/gem-${String(size)}.png  ${String(png.length)} bytes`);
}
