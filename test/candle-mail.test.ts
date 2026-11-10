/**
 * The candle mail (src/core/candle-email.ts, 0.130.0): grouping, order, the
 * cap, the HTML rules, the scrub and stable bytes. Pure: nothing is sent.
 *
 * SAFETY: no network, no store. The token and the addresses are placeholders.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { CANDLE_MAIL_MAX, candleMailSubject, candleMessage, candlePath, sampleCandleFacts, type CandleMailFacts, type CandleMailItem } from "../src/core/candle-email.ts";
import { emailBody, type EmailSettings } from "../src/core/email.ts";
import { SEVERITIES } from "../src/core/result.ts";

const TOKEN = "your-token-here";
const FROM = "darius@example.com";
const TO = ["ops@example.com"];
const PROJECT_TO = ["team@example.com"];
const PROVIDER = "https://mail.example.com/v1/private-path/send";

function settings(more: Partial<EmailSettings> = {}): EmailSettings {
  return { url: PROVIDER, token: TOKEN, from: FROM, to: TO, web_url: "https://darius.example.com", since: "2026-01-01T00:00:00.000Z", ...more };
}

function item(key: string, severity: CandleMailItem["severity"], more: Partial<CandleMailItem> = {}): CandleMailItem {
  return { key, title: `Problem ${key}`, severity, isRaised: false, ...more };
}

function facts(items: CandleMailItem[], more: Partial<CandleMailFacts> = {}): CandleMailFacts {
  return { project: "demo", source: "scan", turnOff: "Turn it off: candle_deliver on the ritual scan.", items, ...more };
}

function assertClean(text: string, label: string): void {
  for (const secret of [TOKEN, FROM, ...TO, ...PROJECT_TO, "private-path"]) assert.equal(text.toLowerCase().includes(secret), false, `${label} holds ${secret}`);
}

test("the cap: at most 50 candles, worst first, then one line for the rest, in text and html", () => {
  const items = Array.from({ length: 60 }, (_, index) => item(`k-${String(index).padStart(2, "0")}`, index < 45 ? "high" : "low"));
  const message = candleMessage(settings(), facts(items), "line:L:email");
  assert.equal(CANDLE_MAIL_MAX, 50);
  assert.equal([...message.text.matchAll(/^- Problem /gmu)].length, 50);
  assert.match(message.text, /^High \(45\)$/mu);
  assert.match(message.text, /^Low \(15\)$/mu, "a cut group still counts all its candles");
  assert.match(message.text, /^- Problem k-49$/mu);
  assert.equal(message.text.includes("Problem k-50"), false);
  assert.match(message.text, /^and 10 more in darius$/mu);
  assert.equal([...(message.html ?? "").matchAll(/>Problem k-/gu)].length, 50);
  assert.match(message.html ?? "", />and 10 more in darius<\/a>/u);
  assert.equal(message.subject, "[darius] demo, scan: 60 candles, 45 high");
});

test("a group past the cap is left out, and so is an empty one", () => {
  const items = [...Array.from({ length: 50 }, (_, index) => item(`c-${String(index).padStart(2, "0")}`, "critical")), item("i-1", "info")];
  const message = candleMessage(settings(), facts(items), "k");
  assert.equal(message.text.includes("Info ("), false);
  assert.match(message.text, /^and 1 more in darius$/mu);
  const two = candleMessage(settings(), facts([item("a", "critical"), item("b", "low")]), "k");
  assert.deepEqual([...two.text.matchAll(/^(\w+) \(\d+\)$/gmu)].map((match) => match[1]), ["Critical", "Low"]);
});

test("one candle: the subject names its severity and title, capped; the body has the same layout", () => {
  const one = candleMessage(settings(), facts([item("only", "medium", { target: "web/package.json" })]), "k");
  assert.equal(one.subject, "[darius] demo, medium: Problem only");
  assert.match(one.text, /^A medium candle was lit in demo, from scan\.$/mu);
  assert.match(one.text, /^Medium \(1\)\n- Problem only\n {4}web\/package\.json$/mu);
  const long = candleMessage(settings(), facts([item("long", "high", { title: "x".repeat(500) })]), "k");
  assert.equal(long.subject.length, 200);
  assert.ok(long.subject.endsWith("..."));
  assert.match(long.text, /^- x{297}\.\.\.$/mu, "a title line is cut at 300 characters, as before");
  assert.equal(candleMailSubject(facts([item("r", "critical", { isRaised: true })])), "[darius] demo, critical, raised: Problem r");
});

test("html false sends no html, and the provider gets no html field", () => {
  const off = settings({ html: false });
  const message = candleMessage(off, facts([item("a", "high")]), "k");
  assert.equal(message.html, undefined);
  assert.equal("html" in JSON.parse(emailBody(off, message)), false);
  assert.match(JSON.parse(emailBody(settings(), candleMessage(settings(), facts([item("a", "high")]), "k"))).html, /^<!doctype html>/u);
});

test("the html escapes a title with a script tag and quotes, and holds no active or remote part", () => {
  const evil = `<script>alert("x")</script> & 'q' <img src=x onerror=1>`;
  const message = candleMessage(settings(), facts([item(`k"><script>`, "critical", { title: evil, target: `<b>"t"</b>` })]), "k");
  const html = message.html ?? "";
  assert.ok(html.includes("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;q&#39; &lt;img src=x onerror=1&gt;"));
  assert.ok(html.includes("&lt;b&gt;&quot;t&quot;&lt;/b&gt;"));
  assert.ok(html.includes('href="https://darius.example.com/w/demo/candles/k%22%3E%3Cscript%3E"'), "the key is encoded in the href");
  for (const banned of ["<script", "<img src=x", "<link", "<style", "@import", "url(", "border-radius", "border-left", "http://", "\u2014"]) {
    assert.equal(html.toLowerCase().includes(banned), false, `the html holds ${banned}`);
  }
  assert.deepEqual(html.match(/<img [^>]*>/gu)?.length, 1, "one image: the logo");
  assert.equal(message.text.includes("\u2014"), false, "no em dash in the text");
});

test("without web_url there is no link at all", () => {
  const message = candleMessage(settings({ web_url: undefined }), facts([item("a", "high")]), "k");
  assert.equal(message.html?.includes("<a "), false);
  assert.equal(message.text.includes("http"), false);
});

test("the same facts give the same bytes, whatever order the candles came in", () => {
  const items = SEVERITIES.flatMap((severity, index) => [item(`${severity}-b`, severity), item(`${severity}-a`, severity, { target: `t-${String(index)}` })]);
  const first = candleMessage(settings(), facts(items), "line:L:email", PROJECT_TO);
  const again = candleMessage(settings(), facts(items), "line:L:email", PROJECT_TO);
  const shuffled = candleMessage(settings(), facts(items.toReversed()), "line:L:email", PROJECT_TO);
  assert.deepEqual(again, first);
  assert.deepEqual(shuffled, first);
  assert.equal(emailBody(settings(), again, PROJECT_TO), emailBody(settings(), first, PROJECT_TO));
});

test("no token, address or provider url reaches the subject, the text or the html, also a resolved project address", () => {
  const sneaky = `leak ${TOKEN} ${FROM.toUpperCase()} ${PROJECT_TO[0] ?? ""} ops%40example.com ${PROVIDER}`;
  const message = candleMessage(settings(), facts([item("a", "critical", { title: sneaky, target: sneaky }), item("b", "low")], { project: "demo", source: sneaky }), "k", PROJECT_TO);
  for (const [label, text] of Object.entries({ subject: message.subject, text: message.text, html: message.html ?? "" })) assertClean(text, label);
  assert.match(message.text, /\[token\]/u);
  assert.match(message.text, /\[address\]/u);
});

test("the item link is the candle page path the web app uses", () => {
  assert.equal(candlePath("my project", "dep/cve 1"), "/w/my%20project/candles/dep%2Fcve%201");
  assert.equal(candlePath("demo"), "/w/demo/candles");
});

test("the sample spans three severities and no real name", () => {
  const sample = sampleCandleFacts("host-a");
  assert.deepEqual([...new Set(sample.items.map((one) => one.severity))], ["critical", "high", "medium"]);
  const message = candleMessage(settings(), sample, "email-test:x");
  assert.match(message.subject, /^\[darius\] example, email test on host-a: 7 candles, 2 critical$/u);
  assertClean(`${message.text}${message.html ?? ""}`, "the sample");
});
