/**
 * The installed app's assets (0.99.0, web/public): every file that the manifest,
 * `root.tsx` and the service worker name exists, each PNG has the pixel size its
 * name or manifest entry says, every iOS startup image is listed in
 * `web/app/lib/splash.ts` and linked from `root.tsx`, and the PNGs are as fresh as
 * their source: `bun run icons` (web/scripts/icons.ts) writes a fingerprint of the
 * emblem, the script and the size list, and this test computes it again. The
 * renderer is a dev dependency of `web/` only, so nothing here loads it, and
 * nothing in `src/` or the server bundle may name it.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const WEB = join(ROOT, "web");
const PUBLIC = join(WEB, "public");

const splash = await import("../web/app/lib/splash.ts");
const { iconsHash } = await import("../web/scripts/icons-hash.ts");

type Pixels = import("../web/app/lib/splash.ts").Pixels;

const read = (path: string): string => readFileSync(join(ROOT, path), "utf8");

/** The pixel size in the header of a PNG file. */
function pngSize(file: string): Pixels {
  const bytes = readFileSync(join(PUBLIC, file));
  assert.equal(bytes.subarray(1, 4).toString("latin1"), "PNG", `${file} is a PNG`);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/** The `/name.ext` paths a source text names. */
function namedAssets(text: string): string[] {
  return [...new Set([...text.matchAll(/["'`](\/[A-Za-z0-9._-]+\.(?:png|svg|webmanifest))["'`]/gu)].map((found) => found[1] ?? ""))];
}

interface ManifestIcon {
  src: string;
  sizes: string;
}

const MANIFEST: { icons: ManifestIcon[] } = JSON.parse(read("web/public/manifest.webmanifest"));

test("every file that the manifest, root.tsx and the service worker name exists in web/public", () => {
  const manifest = MANIFEST.icons.map((icon) => icon.src);
  const root = namedAssets(read("web/app/root.tsx"));
  const worker = namedAssets(read("web/public/sw.js"));
  assert.ok(manifest.length >= 3 && root.length >= 3 && worker.includes("/icon-192.png") && worker.includes("/badge-72.png"), "the three sources name their files");
  for (const name of [...manifest, ...root, ...worker, ...splash.SPLASH_SIZES.map((size) => `/${splash.splashFile(size)}`)]) {
    assert.ok(existsSync(join(PUBLIC, name)), `${name} is named but missing in web/public`);
  }
});

test("each icon has the pixel size its manifest entry or its name says", () => {
  for (const icon of MANIFEST.icons) {
    const [width, height] = icon.sizes.split("x").map(Number);
    assert.deepEqual(pngSize(icon.src.slice(1)), { width, height }, icon.src);
  }
  assert.deepEqual(pngSize("apple-touch-icon.png"), { width: 180, height: 180 });
  assert.deepEqual(pngSize("badge-72.png"), { width: 72, height: 72 });
});

test("the startup images: one for each listed size, in the size its name says, none unlisted", () => {
  const listed = splash.SPLASH_SIZES.map((size) => splash.splashFile(size));
  assert.equal(new Set(listed).size, listed.length, "no size twice");
  for (const size of splash.SPLASH_SIZES) {
    const { width, height } = splash.splashPixels(size);
    assert.deepEqual(pngSize(splash.splashFile(size)), { width, height }, splash.splashFile(size));
    assert.ok(width < height, `${splash.splashFile(size)} is portrait`);
  }
  const onDisk = readdirSync(PUBLIC).filter((name) => /^splash-.*\.png$/u.test(name));
  assert.deepEqual(onDisk.toSorted(), listed.toSorted(), "every splash PNG is listed, every listed one exists");
});

test("root.tsx links one startup image for each size, with the media query of splash.ts, and the queries differ", () => {
  const root = read("web/app/root.tsx");
  assert.match(root, /rel: "apple-touch-startup-image", href: `\/\$\{splashFile\(size\)\}`, media: splashMedia\(size\)/u);
  assert.match(root, /SPLASH_SIZES\.map\(/u);
  const queries = splash.SPLASH_SIZES.map((size) => splash.splashMedia(size));
  assert.equal(new Set(queries).size, queries.length, "each device size has its own query");
  for (const query of queries) assert.match(query, /^\(device-width: \d+px\) and \(device-height: \d+px\) and \(-webkit-device-pixel-ratio: [23]\) and \(orientation: portrait\)$/u);
});

test("the dark ground of the splash is the manifest's background colour", () => {
  assert.match(read("web/scripts/icons.ts"), /const NIGHT = "#15100b";/u);
  assert.match(read("web/public/manifest.webmanifest"), /"background_color": "#15100b"/u);
});

test("the PNGs are rendered from their sources: the fingerprint of the emblem, the script and the size list is current", () => {
  assert.equal(read("web/scripts/icons.sha256").trim(), iconsHash(WEB), "run `cd web && bun run icons` and commit the PNGs");
});

/** Every file below `dir`, as paths. */
function filesBelow(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesBelow(path) : [path];
  });
}

test("the renderer is a dev dependency of web/ only: no runtime dependency, and neither src/ nor the server bundle names it", () => {
  const pkg: { dependencies: Record<string, string>; devDependencies: Record<string, string> } = JSON.parse(read("web/package.json"));
  assert.ok(pkg.devDependencies["@resvg/resvg-js"] !== undefined, "a dev dependency of web/");
  assert.equal(pkg.dependencies["@resvg/resvg-js"], undefined, "not a runtime dependency");
  assert.equal(JSON.parse(read("package.json")).dependencies, undefined, "the CLI has no runtime dependency");
  assert.match(pkg.devDependencies["@resvg/resvg-js"] ?? "", /^\d+\.\d+\.\d+$/u, "pinned like the other packages of web/");
  for (const dir of ["src", "web/build/server"]) {
    for (const file of filesBelow(join(ROOT, dir))) assert.equal(readFileSync(file, "utf8").includes("resvg"), false, `${file} names the renderer`);
  }
  assert.equal(read("web/package.json").includes('"icons": "bun scripts/icons.ts"'), true);
});

test("the committed server build carries the startup image links and the whole size list", () => {
  const bundle = filesBelow(join(ROOT, "web/build/server")).filter((file) => file.endsWith(".js")).map((file) => readFileSync(file, "utf8")).join("\n");
  assert.ok(bundle.includes("apple-touch-startup-image"), "run `bun run web:build` after a change of root.tsx");
  for (const size of splash.SPLASH_SIZES) {
    assert.match(bundle, new RegExp(`cssWidth:\\s*${String(size.cssWidth)},\\s*cssHeight:\\s*${String(size.cssHeight)},\\s*ratio:\\s*${String(size.ratio)}`, "u"), `the build lists ${splash.splashFile(size)}`);
  }
});

test("no PNG is blank or cut short: a flat picture with the emblem is more than a few hundred bytes", () => {
  const files = readdirSync(PUBLIC).filter((name) => name.endsWith(".png"));
  assert.ok(files.length >= 5 + splash.SPLASH_SIZES.length);
  for (const name of files) assert.ok(statSync(join(PUBLIC, name)).size > (name === "badge-72.png" ? 500 : 1000), `${name} is too small to hold the emblem`);
});
