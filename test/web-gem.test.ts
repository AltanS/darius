/**
 * The emblem loader's CSS (0.97.0, 0.104.0, web/app/app.css): one keyframes
 * block per element, a 2.6 s loop with no animation-delay, the first 1.8 s one
 * element at a time and the last 0.8 s all five blinking together twice, and
 * the two reduced-motion switches that leave the full static emblem. The page
 * itself is checked in test/web-settings.test.ts.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** The sheet with every run of white space as one space, so a formatter cannot break a match. */
const CSS = readFileSync(fileURLToPath(new URL("../web/app/app.css", import.meta.url)), "utf8").replaceAll(/\s+/gu, " ");
const NAV_ICONS = readFileSync(fileURLToPath(new URL("../web/app/components/nav-icons.tsx", import.meta.url)), "utf8");
const LOOP = 2.6;
/** Facet classes in the order they take their turn, with the start of each slot in seconds. */
const ORDER = [
  ["a", 0],
  ["b1", 0.35],
  ["c", 0.7],
  ["b2", 1.05],
  ["d", 1.4],
] as const;

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

/** The opacity of an element `seconds` into the loop, interpolated linearly between its frames. */
function opacityAt(name: string, seconds: number): number {
  const points = frames(name)
    .flatMap((frame) => frame.at.map((at) => ({ t: (at / 100) * LOOP, o: /opacity: 1;/u.test(frame.body) ? 1 : 0.45 })))
    .toSorted((x, y) => x.t - y.t);
  const after = points.findIndex((point) => point.t >= seconds - 1e-4);
  const next = points[after];
  const prev = points[after - 1];
  assert.ok(next !== undefined, `${name} has a frame at or after ${String(seconds)} s`);
  if (prev === undefined || Math.abs(next.t - seconds) < 1e-4) return next.o;
  return prev.o + ((next.o - prev.o) * (seconds - prev.t)) / (next.t - prev.t);
}

test("focus: an element in focus has full opacity and a light stroke, the others sit at 0.45", () => {
  for (const [facet] of ORDER) {
    const all = frames(`focus-${facet}`);
    assert.equal(all.length, 2, `focus-${facet}: a dim frame group and a lit one`);
    const dim = all.find((frame) => /opacity: 0\.45;/u.test(frame.body));
    const lit = all.find((frame) => /opacity: 1;/u.test(frame.body));
    assert.equal(Math.min(...(dim?.at ?? [NaN])), 0, `focus-${facet} starts dim`);
    assert.equal(Math.max(...(dim?.at ?? [NaN])), 100, `focus-${facet} ends dim`);
    assert.match(dim?.body ?? "", /stroke: var\(--gem-edge, /u, `focus-${facet}: the dim stroke is the edge`);
    assert.match(lit?.body ?? "", /stroke: var\(--gem-lit, /u, `focus-${facet}: the focus stroke is light`);
  }
  assert.match(block(".gem-busy path"), /animation: focus-a 2\.6s linear infinite;/u, "a 2.6 s linear loop, forever");
});

test("the first 1.8 s light one element at a time, in order, each at the middle of its slot", () => {
  ORDER.forEach(([facet, slot], index) => {
    const middle = slot + 0.18;
    for (const [other] of ORDER) {
      const want = other === facet ? 1 : 0.45;
      assert.ok(Math.abs(opacityAt(`focus-${other}`, middle) - want) < 1e-3, `at ${String(middle)} s ${other} is ${String(want)} (${facet}'s turn ${String(index)})`);
    }
  });
  for (const [facet, slot] of ORDER.slice(0, 4)) {
    const lit = frames(`focus-${facet}`).find((frame) => /opacity: 1;/u.test(frame.body));
    const own = (lit?.at ?? []).filter((at) => (at / 100) * LOOP < 1.7).map((at) => (at / 100) * LOOP);
    assert.ok(Math.min(...own) >= slot && Math.max(...own) < slot + 0.35, `${facet} is lit inside its 0.35 s slot`);
  }
  const heart = frames("focus-d").find((frame) => /opacity: 1;/u.test(frame.body));
  const heartStart = Math.min(...(heart?.at ?? [NaN])) * LOOP / 100;
  assert.ok(heartStart >= 1.4 && heartStart < 1.5, `the centre is lit from ${String(heartStart)} s`);
});

test("from 1.8 s to 2.6 s all five elements blink together twice: lit 0.2 s, dim 0.2 s, lit 0.2 s, dim 0.2 s", () => {
  for (const [facet] of ORDER) {
    const name = `focus-${facet}`;
    assert.ok(Math.abs(opacityAt(name, 1.8) - 0.45) < 1e-3, `${name} is dim at 1.8 s`);
    for (const lit of [1.85, 1.95, 2.25, 2.35]) assert.equal(opacityAt(name, lit), 1, `${name} is lit at ${String(lit)} s`);
    for (const dim of [2.05, 2.15, 2.45, 2.55, 2.6]) assert.ok(Math.abs(opacityAt(name, dim) - 0.45) < 1e-3, `${name} is dim at ${String(dim)} s`);
  }
});

test("the facets take their turn by keyframes, never by delay: top right, bottom right, bottom left, top left, then the centre", () => {
  assert.ok(!/animation-delay/u.test(CSS.slice(CSS.indexOf("@keyframes focus-a"), CSS.indexOf("The gem inside a button"))), "no delay in the loader");
  assert.ok(!/animation-delay:[^;]*var\(/u.test(CSS), "no delay depends on a variable that an inline style could set");
  for (const [facet] of ORDER.slice(1)) assert.match(block(`.gem-busy .gem-${facet}`), new RegExp(`animation-name: focus-${facet};`, "u"));
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

test("the light themes define a dark focus stroke: a near-white one vanished on the parchment (0.98.0)", () => {
  assert.equal(CSS.match(/--gem-lit: #3a2a12;/gu)?.length, 2, "the light theme and its system twin");
  assert.equal(CSS.includes("--gem-lit: #fffdf4;"), false);
});

// --- where the busy gem shows (0.98.0, web/app/components) -------------------------------------

const COMPONENTS = fileURLToPath(new URL("../web/app/components/", import.meta.url));
const source = (name: string): string => readFileSync(`${COMPONENTS}${name}`, "utf8");

test("BusyButton draws a 14 px busy gem before the label only while busy, and hides it from screen readers", () => {
  const code = source("busy-button.tsx");
  assert.match(code, /\{busy \? <Gem size=\{14\} busy \/> : null\}\s*\{children\}/u);
  assert.equal(/<Gem[^>]*label=/u.test(code), false, "decoration: no name");
  assert.match(CSS, /\.st-btn > \.gem,\s*\.st-link > \.gem \{ display: inline-block;/u, "the gem sits in the line of the label");
});

test("every button that posts uses BusyButton, with the words of its busy state kept", () => {
  for (const [file, words] of [
    ["findings.tsx", ["Closing…", "Reopening…"]],
    ["ack.tsx", ["Acknowledging…"]],
    ["ask-form.tsx", ["Sending…", "Dismissing…"]],
    ["follow-up.tsx", ["Starting…"]],
    ["check-now.tsx", ["Checking…"]],
    ["backups.tsx", ["Starting…", "Testing…"]],
  ] as const) {
    const code = source(file);
    assert.ok(code.includes("<BusyButton"), `${file} uses BusyButton`);
    for (const word of words) assert.ok(code.includes(word), `${file} keeps "${word}"`);
  }
  assert.equal(/<button[^>]*onClick=\{\(\) => void (send|start|dismiss|test|submit|save)\b/u.test(source("ask-form.tsx")), false, "no plain post button is left in the answer forms");
});

test("a gem line has the busy gem; the wait line under a button is text only, and the frame's gems follow navigation alone", () => {
  const wait = source("wait-line.tsx");
  assert.match(wait, /<Gem size=\{14\} busy \/>/u, "GemLine keeps its gem");
  const waitLine = wait.slice(wait.indexOf("export function WaitLine"));
  assert.equal(waitLine.includes("<Gem"), false, "WaitLine has no gem: the button already animates");
  assert.match(waitLine, /useAfter\(active, WAIT_LINE_AFTER_MS\)/u, "and it shows only after 2 s");
  const shell = source("shell.tsx");
  assert.match(shell, /useNavigation\(\)/u);
  assert.equal(/useRevalidator/u.test(shell), false, "a reload of the data never lights the shell gem");
  assert.match(shell, /navigation\.location \?\? location/u, "the tab lights from the page the tap goes to");
  assert.match(shell, /<Gem size=\{28\} busy=\{busy\} \/>/u);
  assert.match(source("places.tsx"), /<Gem size=\{28\} busy=\{busy\} \/>/u);
});

test("the error pages carry a still gem", () => {
  assert.match(source("route-error.tsx"), /<Gem size=\{32\} \/>/u);
  assert.match(readFileSync(fileURLToPath(new URL("../web/app/root.tsx", import.meta.url)), "utf8"), /<Gem size=\{32\} \/>/u);
});

test("a busy gem inside the solid main button takes the label's colour and the button fades less (light theme: gold on gold vanished)", () => {
  const main = block(".st-btn-main > .gem");
  for (const name of ["--gem-a", "--gem-b", "--gem-c", "--gem-d", "--gem-edge"]) assert.match(main, new RegExp(`${name}: var\\(--on-solid\\);`, "u"), name);
  assert.match(block(".st-btn:disabled:has(> .gem-busy)"), /opacity: 0\.8;/u);
});
