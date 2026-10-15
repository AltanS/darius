/**
 * The emblem loader's CSS (0.97.0, web/app/app.css): the `focus` keyframes,
 * the delay of each facet by class, how long each facet is in focus, and the
 * two reduced-motion switches that leave the full static emblem. The page
 * itself is checked in test/web-settings.test.ts.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** The sheet with every run of white space as one space, so a formatter cannot break a match. */
const CSS = readFileSync(fileURLToPath(new URL("../web/app/app.css", import.meta.url)), "utf8").replaceAll(/\s+/gu, " ");
const NAV_ICONS = readFileSync(fileURLToPath(new URL("../web/app/components/nav-icons.tsx", import.meta.url)), "utf8");
const LOOP = 1.8;

/** The declarations of the first rule whose selector is `selector`. */
function block(selector: string): string {
  const start = CSS.indexOf(`${selector} {`);
  assert.ok(start >= 0, `no rule for ${selector}`);
  return CSS.slice(start, CSS.indexOf("}", start));
}

/** The frames of a keyframes rule: the percentages of each frame group and its declarations. */
function frames(name: string): { at: number[]; body: string }[] {
  const start = CSS.indexOf(`@keyframes ${name} {`);
  assert.ok(start >= 0, `no keyframes ${name}`);
  const end = CSS.indexOf("} }", start);
  const inner = CSS.slice(start + `@keyframes ${name} {`.length, end + 1);
  return [...inner.matchAll(/([\d.%, ]+) \{([^}]*)\}/gu)].map((frame) => ({
    at: (frame[1] ?? "").split(",").map((percent) => Number.parseFloat(percent)),
    body: frame[2] ?? "",
  }));
}

/** Seconds a facet stays at full opacity: from its first full frame to its last. */
function litSeconds(name: string): number {
  const lit = frames(name).find((frame) => /opacity: 1;/u.test(frame.body));
  assert.ok(lit !== undefined, `${name} has a frame at full opacity`);
  return ((Math.max(...lit.at) - Math.min(...lit.at)) / 100) * LOOP;
}

test("focus: a facet in focus has full opacity and a light stroke, the others sit at 0.45", () => {
  for (const name of ["focus", "focus-heart"]) {
    const all = frames(name);
    assert.equal(all.length, 2, `${name}: a dim frame group and a lit one`);
    const dim = all.find((frame) => /opacity: 0\.45;/u.test(frame.body));
    const lit = all.find((frame) => /opacity: 1;/u.test(frame.body));
    assert.deepEqual(dim?.at, name === "focus" ? [0, 23, 100] : [0, 27, 100], name);
    assert.match(lit?.body ?? "", /stroke: var\(--gem-lit, /u, `${name}: the focus stroke is light`);
  }
  assert.match(block(".gem-busy path"), /animation: focus 1\.8s linear infinite backwards;/u, "a 1.8 s loop that waits dim for its slot");
});

test("the centre holds about 0.4 s, an outer facet less than its 0.35 s slot", () => {
  assert.ok(litSeconds("focus") < 0.35, `an outer facet is lit for ${String(litSeconds("focus"))} s`);
  const heart = litSeconds("focus-heart");
  assert.ok(heart > 0.3 && heart <= 0.4, `the centre is lit for ${String(heart)} s`);
  assert.ok(litSeconds("focus-heart") > litSeconds("focus"), "the centre holds longer than a facet");
});

test("the facets take their turn by class: top right, bottom right, bottom left, top left, then the centre", () => {
  const delays = [".gem-a", ".gem-b1", ".gem-c", ".gem-b2", ".gem-d"].map((facet) => Number.parseFloat(/animation-delay: ([\d.]+)s/u.exec(block(`.gem-busy ${facet}`))?.[1] ?? "NaN"));
  assert.deepEqual(delays, [0, 0.35, 0.7, 1.05, 1.4]);
  assert.ok(Math.abs(LOOP - delays[4]! - 0.4) < 1e-9, "the centre's slot is the last 0.4 s of the loop");
  assert.match(block(".gem-busy .gem-d"), /animation-name: focus-heart;/u);
  assert.ok(!/animation-delay:[^;]*var\(/u.test(CSS), "no delay depends on a variable that an inline style could set");
  for (const [facet, path] of [
    ["gem-a", "M16 2 30 16 22 16 16 10Z"],
    ["gem-b1", "M30 16 16 30 16 22 22 16Z"],
    ["gem-c", "M16 30 2 16 10 16 16 22Z"],
    ["gem-b2", "M2 16 16 2 16 10 10 16Z"],
    ["gem-d", "M16 10 22 16 16 22 10 16Z"],
  ] as const) {
    assert.ok(NAV_ICONS.includes(`<path d="${path}" className="${facet}" />`), `${facet} draws ${path}`);
  }
  assert.match(block(".gem-b1, .gem-b2"), /fill: var\(--gem-b,/u, "both split facets keep the colour variable --gem-b");
});

test("only the keyframes dim a facet, and both reduced-motion switches stop them", () => {
  assert.doesNotMatch(block(".gem-busy path"), /opacity/u, "no dim outside the animation");
  for (const marker of ["@media (prefers-reduced-motion: reduce) {", ':where([data-motion="reduce"]) {']) {
    const start = CSS.indexOf(marker);
    assert.ok(start >= 0, marker);
    assert.match(CSS.slice(start, start + 200), /animation: none !important;/u, marker);
  }
  assert.doesNotMatch(NAV_ICONS, /style=\{\{/u, "no inline style");
});

test("the light themes define the focus stroke", () => {
  assert.equal(CSS.match(/--gem-lit: #fffdf4;/gu)?.length, 2, "the light theme and its system twin");
});
