/**
 * The mail shell (src/core/mail-shell.ts, 0.131.0): one frame for candle and
 * report mails, the `[darius]` subject prefix, the logo pinned to the release
 * tag, `"logo": false`, and the mail-client rules. Pure: nothing is sent.
 *
 * SAFETY: no network, no store. The token and the addresses are placeholders.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { candleMessage, sampleCandleFacts } from "../src/core/candle-email.ts";
import { parseEmailInput, sendEmail, type EmailSettings } from "../src/core/email.ts";
import { logoUrl, MAIL_REPO, MARK_COLOR, markUrl, SEVERITY_COLOR, SUBJECT_PREFIX, THEME } from "../src/core/mail-shell.ts";
import { GLYPH_GRID, GLYPHS } from "../web/app/lib/glyphs.ts";
import { reportMessage, sampleReportFacts } from "../src/core/report-email.ts";
import { VERSION } from "../src/version.ts";

const ROOT = join(import.meta.dirname, "..");

function settings(more: Partial<EmailSettings> = {}): EmailSettings {
  return { url: "https://mail.example.com/v1/send", token: "your-token-here", from: "darius@example.com", to: ["ops@example.com"], web_url: "https://darius.example.com", since: "2026-01-01T00:00:00.000Z", ...more };
}

function candleHtml(more: Partial<EmailSettings> = {}): string {
  return candleMessage(settings(more), sampleCandleFacts("host-a"), "k").html ?? "";
}

function reportHtml(more: Partial<EmailSettings> = {}): string {
  return reportMessage(settings(more), { ...sampleReportFacts("host-a", new Date("2026-11-10T05:00:00.000Z")), url: "/w/example/runs/sample" }, "report:sample").html ?? "";
}

/** The HTML from the start to the end of the header row: the logo, the wordmark and the project line. */
function headerOf(html: string): string {
  return html.slice(0, html.indexOf("</tr>", html.indexOf(">darius</div>")));
}

test("every subject starts with [darius]: a candle digest, one candle, a report, a test and a plain retry", async (t) => {
  assert.equal(SUBJECT_PREFIX, "[darius] ");
  assert.equal(candleMessage(settings(), sampleCandleFacts("host-a"), "k").subject, "[darius] example, email test on host-a: 7 candles, 2 critical");
  const one = { ...sampleCandleFacts("host-a"), items: [{ key: "a", title: "One thing", severity: "high" as const, isRaised: true }] };
  assert.equal(candleMessage(settings(), one, "k").subject, "[darius] example, high, raised: One thing");
  assert.equal(reportMessage(settings(), sampleReportFacts("host-a", new Date(0)), "k").subject, "[darius] example, Sample report: a sample report from host-a");

  const bodies: string[] = [];
  t.mock.method(globalThis, "fetch", (_url: string, init: { body: string }) => {
    bodies.push(init.body);
    return Promise.resolve(new Response(null, { status: 202 }));
  });
  await sendEmail(settings(), { key: "k", title: "old subject", body: "b", url: "/" });
  await sendEmail(settings(), { key: "k", title: "[darius] demo, high: stored", body: "b", url: "/" });
  assert.deepEqual(bodies.map((body) => JSON.parse(body).subject), ["[darius] old subject", "[darius] demo, high: stored"], "a stored subject gets the prefix once");
});

test("the logo is the app's emblem on GitHub, pinned to the tag of this version", () => {
  assert.equal(MAIL_REPO, "AltanS/darius");
  assert.equal(logoUrl(), `https://raw.githubusercontent.com/AltanS/darius/v${VERSION}/assets/email/gem-96.png`);
  assert.equal(logoUrl("1.2.3"), "https://raw.githubusercontent.com/AltanS/darius/v1.2.3/assets/email/gem-96.png");
  const png = readFileSync(join(ROOT, "assets", "email", "gem-96.png"));
  assert.equal(png.subarray(1, 4).toString("latin1"), "PNG");
  assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [96, 96], "96 by 96, shown at 48");
  const img = /<img [^>]*>/u.exec(candleHtml())?.[0] ?? "";
  assert.ok(img.includes(`src="${logoUrl()}"`));
  for (const part of ['width="48"', 'height="48"', 'alt="darius"', "display:block;border:0"]) assert.ok(img.includes(part), `the img has ${part}`);
});

/** The `<img>` of the kind mark in the project line, or "" when there is none. */
function markOf(html: string): string {
  return /<div style="margin-top:4px;[^>]*>(<img [^>]*>)/u.exec(headerOf(html))?.[1] ?? "";
}

test("each mail starts its project line with the mark of its kind, pinned like the logo, decoration only", () => {
  assert.equal(markUrl("candle"), `https://raw.githubusercontent.com/AltanS/darius/v${VERSION}/assets/email/candle-40.png`);
  assert.equal(markUrl("ritual", "1.2.3"), "https://raw.githubusercontent.com/AltanS/darius/v1.2.3/assets/email/ritual-40.png");
  for (const [html, mark] of [
    [candleHtml(), "candle"],
    [reportHtml(), "ritual"],
  ] as const) {
    const img = markOf(html);
    assert.ok(img.includes(`src="${markUrl(mark)}"`), `the ${mark} mail carries the ${mark} mark`);
    for (const part of ['width="20"', 'height="20"', 'alt=""', "vertical-align:middle", "border:0", "width:20px;height:20px;"]) assert.ok(img.includes(part), `the mark has ${part}`);
    assert.equal(html.match(/<img [^>]*>/gu)?.length, 2, "the logo and one mark, no mark per row");
    const png = readFileSync(join(ROOT, "assets", "email", `${mark}-40.png`));
    assert.equal(png.subarray(1, 4).toString("latin1"), "PNG");
    assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [40, 40], "40 by 40, shown at 20");
  }
  assert.deepEqual(MARK_COLOR, { candle: "#d98b3a", ritual: "#4cc0c8" }, "the colours the app draws them in: --color-late and --color-ritual");
  const css = readFileSync(join(ROOT, "web", "app", "app.css"), "utf8");
  assert.ok(css.includes(`--color-late: ${MARK_COLOR.candle};`) && css.includes(`--color-ritual: ${MARK_COLOR.ritual};`), "the mark colours match the app's tokens");
  assert.equal(GLYPH_GRID, 16);
  assert.ok(GLYPHS.candle.length > 0 && GLYPHS.ritual.length > 0, "the mail marks come from the app's glyphs");
});

test("logo false sends no img, and the wordmark stays as text, in both mails", () => {
  for (const html of [candleHtml({ logo: false }), reportHtml({ logo: false })]) {
    assert.equal(html.includes("<img"), false);
    assert.equal(html.includes("raw.githubusercontent.com"), false, "no remote request at all");
    assert.match(html, />darius<\/div>/u);
  }
  assert.equal(parseEmailInput(JSON.stringify({ ...settings(), logo: false })).logo, false);
  assert.throws(() => parseEmailInput(JSON.stringify({ ...settings(), logo: "no" })), /logo must be true or false/u);
});

test("candle and report mails share one shell: the same page, card, header and footer frame", () => {
  const candle = candleHtml();
  const report = reportHtml();
  // The title, the hidden preview and the project line are the mail's own words; the rest of the header is the shell.
  const frame = (html: string): string =>
    headerOf(html)
      .replace(/<title>[^<]*<\/title>/u, "<title></title>")
      .replace(/(<div style="display:none[^>]*>)[^<]*/u, "$1")
      .replace(/(<div style="margin-top:4px;[^>]*>)(<img [^>]*>)?[^<]*/u, "$1");
  assert.ok(frame(candle).includes("<img "));
  assert.equal(frame(candle), frame(report), "the same page and header up to the project line");
  for (const html of [candle, report]) {
    assert.ok(html.startsWith('<!doctype html><html lang="en"><head>'));
    assert.ok(html.includes('<meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark">'));
    assert.ok(html.includes(`bgcolor="${THEME.page}" style="margin:0;padding:0;background-color:${THEME.page};`));
    assert.ok(html.includes("max-width:640px"));
    assert.ok(html.includes(`border-bottom:1px solid ${THEME.gold}`), "the gold hairline under the header");
    assert.match(html, /<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin:0 0 14px 0;"><tr><td style="border:1px solid #c8a24e;"><a href="https:\/\/darius\.example\.com\/w\/example\//u, "the outlined button");
  }
});

test("the html keeps to what mail clients render: no css they drop, no remote part but the logo, a colour on each text", () => {
  for (const html of [candleHtml(), reportHtml()]) {
    const lower = html.toLowerCase();
    for (const banned of ["display:flex", "display:grid", "position:", "var(--", "@font-face", "@import", "<style", "<script", "<link", "url(", "background-image", "border-radius", "border-left", "\u2014"]) {
      assert.equal(lower.includes(banned), false, `the html holds ${banned}`);
    }
    assert.equal(/(?<!text-)transform/u.test(lower), false, "no transform");
    const marks = new Set([markUrl("candle"), markUrl("ritual")]);
    assert.deepEqual(
      [...html.matchAll(/(?:src|href)="(https?:[^"]+)"/gu)].map((match) => match[1]).filter((url) => !url.startsWith("https://darius.example.com/") && url !== "https://example.com" && !marks.has(url ?? "")),
      [logoUrl()],
    );
    for (const tag of html.matchAll(/<(p|h[1-6]|a|span|li|th|td|pre|code|ul|ol)\b[^>]*>/gu)) {
      const element = tag[0];
      if (tag[1] === "td" && !element.includes("padding:4px 8px")) continue;
      assert.match(element, /color:#[0-9a-f]{6}/u, `${element} has a colour`);
    }
  }
});

/** The WCAG relative luminance of `#rrggbb`. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16) / 255).map((c) => (c <= 0.039_28 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
}

/** The WCAG contrast ratio of two colours. */
function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].toSorted((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}

test("the severity colours are the app's tones and pass AA on the card", () => {
  for (const color of [...Object.values(SEVERITY_COLOR), THEME.text, THEME.quiet, THEME.gold, THEME.goldHi]) assert.ok(ratio(color, THEME.card) >= 4.5, `${color} on ${THEME.card}`);
  assert.deepEqual(SEVERITY_COLOR, { critical: "#e8665a", high: "#d98b3a", medium: "#c8a24e", low: "#958d7d", info: "#a38f6b" });
});

test("the same input gives the same bytes in both mails", () => {
  assert.equal(candleHtml(), candleHtml());
  assert.equal(reportHtml(), reportHtml());
});
