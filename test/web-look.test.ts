/**
 * What needs a look (0.143.0): the items of a machine, each one sentence
 * with the cause and one button, in a fixed order; the headline of the
 * Machines page (machines, then rituals); the reasons of a workspace; and the words of the machine pages, one
 * word per thing, from web/app/lib/terms.ts, in step with docs/glossary.md.
 * Pure.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import type { FleetDjinn } from "../src/web/api.ts";
import type { Attention } from "../web/app/lib/machines.ts";
import type { LookItem } from "../web/app/lib/look.ts";
import type { Part } from "../web/app/lib/sentence.ts";

const look = await import("../web/app/lib/look.ts");
const terms = await import("../web/app/lib/terms.ts");
const { sentenceText } = await import("../web/app/lib/sentence.ts");
const { zoneName } = await import("../web/app/lib/format.ts");

const AGO = (iso: string): string => `<${iso}>`;

function ritual(slug: string, state: FleetDjinn["state"], change: Partial<FleetDjinn> = {}): FleetDjinn {
  return { slug, title: `Title ${slug}`, state, nextDueAt: null, nextDue: null, host: "host-b", why: "checkout", lastOutcome: null, lastAt: null, lastRun: null, ...change };
}

const UNREACHABLE: Attention = { key: "unreachable", lead: "Did not answer", text: "Its darius serve did not answer (timeout).", command: "darius setup --systemd" };
const SANDBOX: Attention = { key: "sandbox", lead: "Sandbox check failed", text: "Its last sandbox check failed.", command: "darius box check" };

/** One item as plain text: the lead, the sentence, the command, the next step. */
function say(item: LookItem): string {
  const command = item.command === null ? "" : ` Run ${item.command}.`;
  const action = item.action === null ? "" : ` ${item.action.text}`;
  return `${item.lead}: ${sentenceText(item.parts, AGO)}${command}${action}`;
}

function items(): LookItem[] {
  return look.lookItems({
    machine: "host-b",
    rituals: [
      { workspace: "example", ritual: ritual("integrity", "late", { title: "Daily integrity cycle", nextDueAt: "T-due", lastOutcome: "abandoned", lastAt: "T-last" }), ask: null },
      { workspace: "example", ritual: ritual("traffic", "idle", { title: "Weekly traffic summary", lastOutcome: "failed", lastAt: "T-failed", lastRun: "R-F" }), ask: null },
      { workspace: "example", ritual: ritual("seo", "idle", { title: "SEO steward", lastOutcome: "complete", lastAt: "T-asked", lastRun: "R-ASK" }), ask: { questions: 1, at: "T-asked" } },
      { workspace: "example", ritual: ritual("quiet", "idle", { lastOutcome: "complete" }), ask: null },
    ],
    attention: [SANDBOX],
    page: "machines",
  });
}

test("Needs a look: one item per problem, concrete with one action each, in order: waits for your answer, failed, late, the machine", () => {
  const list = items();
  assert.deepEqual(
    list.map((item) => item.kind),
    ["waits", "failed", "late", "machine"],
    "a ritual on schedule is not in it; workspace health stays in the table",
  );
  assert.deepEqual(list.map(say), [
    "Waits for your answer: SEO steward, example. It asked 1 question <T-asked>. Answer",
    "Failed: Weekly traffic summary, example. Its last run failed <T-failed>. Open run",
    "Late: Daily integrity cycle, example. Due <T-due>; its last run was abandoned <T-last>. Open ritual",
    "Sandbox check failed: Its last sandbox check failed. Run darius box check. Open machine",
  ]);
});

test("Needs a look: every button goes where the step is done; the sentences carry no link; each word is glossed once", () => {
  const [waits, failed, late, machine] = items();
  assert.deepEqual(waits?.action?.to, { to: "run", ws: "example", run: "R-ASK" });
  assert.deepEqual(failed?.action?.to, { to: "run", ws: "example", run: "R-F" });
  assert.deepEqual(late?.action?.to, { to: "ritual", ws: "example", slug: "integrity" });
  assert.deepEqual(machine?.action?.to, { to: "machine", host: "host-b", hash: "look" });
  assert.deepEqual(items().flatMap((item) => item.parts.filter((part: Part) => part.kind === "link")), [], "only the button is a link");
  assert.deepEqual(look.glossedTerms(items()), ["sandboxCheck"]);
  assert.equal(new Set(items().map((item) => item.id)).size, 4, "every anchor is unique");
});

test("Needs a look: the other wordings, and a machine page links no machine item to itself", () => {
  const one = (placed: Parameters<typeof look.lookItems>[0]["rituals"][number]): string => look.lookItems({ machine: "m", rituals: [placed], attention: [], page: "machine" }).map(say).join("");
  assert.equal(one({ workspace: "w", ritual: ritual("h", "held"), ask: null }), "Waits for your answer: Title h, w. Its run stopped to ask you. Answer");
  assert.equal(one({ workspace: "w", ritual: ritual("h", "held", { lastRun: "R" }), ask: { questions: 2, at: "T" } }), "Waits for your answer: Title h, w. It asked 2 questions <T>. Answer");
  assert.equal(one({ workspace: "w", ritual: ritual("l", "late", { nextDue: "2026-11-24" }), ask: null }), "Late: Title l, w. It was due on 24 Nov; it has not run yet. Open ritual");
  assert.equal(one({ workspace: "w", ritual: ritual("l", "late", { nextDueAt: "T-due", lastOutcome: "complete", lastAt: "T" }), ask: null }), "Late: Title l, w. Due <T-due>; its last run completed <T>. Open ritual");
  assert.equal(one({ workspace: "w", ritual: ritual("f", "idle", { lastOutcome: "failed", lastAt: "T" }), ask: null }), "Failed: Title f, w. Its last run failed <T>. Open ritual", "no run id: open the ritual");
  assert.equal(one({ workspace: "w", ritual: ritual("f", "late", { lastOutcome: "failed", lastAt: "T", lastRun: "R", nextDueAt: "T-due" }), ask: null }), "Failed: Title f, w. Its last run failed <T>, and it has been late for <T-due>. Open run", "failed and late: one item, the worse word, both facts");
  assert.equal(one({ workspace: "w", ritual: ritual("f", "late", { lastOutcome: "failed", lastAt: "T", nextDue: "2026-11-03" }), ask: null }), "Failed: Title f, w. Its last run failed <T>, and it has been late for <2026-11-03T00:00:00.000Z>. Open ritual");
  const page = look.lookItems({ machine: "m", rituals: [], attention: [UNREACHABLE], page: "machine" });
  assert.deepEqual(page.map(say), ["Did not answer: Its darius serve did not answer (timeout). Run darius setup --systemd."]);
  const held = look.reasonParts(["1 run waits for your answer", "2 runs wait for your answer"], "w");
  assert.equal(sentenceText(held.parts, AGO), "1 run waits for your answer and 2 runs wait for your answer", "a held run says the word of these lists");
});

function headline(list: readonly LookItem[], states: Parameters<typeof look.machinesHeadline>[0]["states"], onSchedule = 19): string {
  return sentenceText(look.machinesHeadline({ items: list, states, onSchedule }), AGO);
}

test("the headline: nothing wrong says the machines, then that every ritual is on schedule", () => {
  assert.equal(headline([], ["self", "online"]), "Both machines are online. All 19 rituals are on schedule.");
  assert.equal(headline([], ["self"], 1), "The machine is online. The 1 ritual is on schedule.");
  assert.equal(headline([], ["self", "online", "online"], 0), "All 3 machines are online. darius starts no ritual.");
  assert.equal(headline([], ["self", "checking"], 4), "1 of 2 machines is online. All 4 rituals are on schedule.");
});

test("the headline: machines first, then the rituals by machine, each part a link to that block; the kinds are read in the block", () => {
  const list = items().filter((item) => item.kind !== "machine");
  assert.equal(headline(list, ["self", "online"]), "Both machines are online. 3 rituals need a look, all on host-b.");
  assert.equal(headline(list, ["self"]), "The machine is online. 3 rituals need a look.");
  assert.equal(headline(list.filter((item) => item.kind === "late"), ["self"]), "The machine is online. 1 ritual needs a look.");
  const other = items().filter((item) => item.kind === "failed").map((item) => Object.assign(item, { machine: "host-a", id: `${item.id}-a` }));
  const both = [...other, ...list];
  assert.equal(headline(both, ["self", "online"]), "Both machines are online. 4 rituals need a look: 1 on host-a, 3 on host-b.");
  const parts = look.machinesHeadline({ items: both, states: ["self", "online"], onSchedule: 0 });
  assert.deepEqual(
    parts.flatMap((part) => (part.kind === "link" ? [[part.text, part.to]] : [])),
    [
      ["1 on host-a", { to: "host", page: "machines", hash: "machine-host-a" }],
      ["3 on host-b", { to: "host", page: "machines", hash: "machine-host-b" }],
    ],
  );
  assert.doesNotMatch(headline(both, ["self", "online"]), /thing|workspace|waits|failed|late/u, "no rival total, no workspace count, no kinds");
});

test("the headline: each machine problem is named in a short sentence, a link to its item; more than two name the machines", () => {
  const down = look.lookItems({ machine: "host-c", rituals: [], attention: [UNREACHABLE], page: "machines" });
  assert.equal(headline(down, ["self", "unreachable"], 5), "1 of 2 machines is online. host-c did not answer. All 5 rituals are on schedule.");
  const parts = look.machinesHeadline({ items: down, states: ["self", "unreachable"], onSchedule: 5 });
  assert.deepEqual(parts[2], { kind: "link", text: "host-c did not answer", to: { to: "host", page: "machines", hash: "look-host-c-unreachable" } });
  const version: Attention = { key: "version", lead: "Other darius version", text: "", command: null };
  const b = look.lookItems({ machine: "host-b", rituals: [], attention: [version], page: "machines" });
  assert.equal(headline(b, ["self", "online"], 0), "Both machines are online. host-b runs another darius version. darius starts no ritual.");
  const many = [...down, ...look.lookItems({ machine: "host-b", rituals: [], attention: [version, SANDBOX], page: "machines" })];
  assert.equal(headline(many, ["self", "online", "unreachable"], 2), "2 of 3 machines are online. 3 machine problems need a look: host-c, host-b. All 2 rituals are on schedule.");
  assert.equal(headline(down, ["unreachable"], 0), "The machine is not online. host-c did not answer. darius starts no ritual.");
});

test("the Why of a workspace that needs you: the count and exactly its parts, each a link; the parts sum to the count", () => {
  const why = look.needParts([{ kind: "answer", count: 2 }, { kind: "vigil", count: 2 }, { kind: "candle", count: 1 }], "w");
  assert.equal(sentenceText(why.parts, AGO), "5 items need you: 2 runs to answer, 2 flagged vigils, 1 lit candle");
  assert.deepEqual(why.parts[3], { kind: "link", text: "2 flagged vigils", to: { to: "section", ws: "w", section: "vigils" } });
  assert.deepEqual(why.glossed, ["vigil", "candle"]);
  assert.equal(sentenceText(look.needParts([{ kind: "failed", count: 1 }], "w").parts, AGO), "1 item needs you: 1 failed ritual");
  assert.deepEqual(look.needParts([], "w").parts, []);
});

test("the reasons of a workspace: at most the three worst, in the order of the health rules; the caller shows and n more", () => {
  const reasons = ["1 high candle lit", "3 vigils flagged", "2 rituals failed twice", "2 runs failed", "1 candle lit", "2 open findings"];
  const shown = look.reasonParts(reasons, "w");
  assert.equal(sentenceText(shown.parts, AGO), "1 high candle lit, 3 vigils flagged, 2 rituals failed twice");
  assert.equal(shown.more, 3);
  assert.equal(look.reasonParts(reasons.slice(0, 3), "w").more, 0);
  assert.equal(sentenceText(look.reasonParts(reasons.slice(0, 3), "w").parts, AGO), "1 high candle lit, 3 vigils flagged and 2 rituals failed twice");
  const links = shown.parts.flatMap((part: Part) => (part.kind === "link" ? [part] : []));
  assert.deepEqual(links[1], { kind: "link", text: "3 vigils flagged", to: { to: "section", ws: "w", section: "vigils" }, title: "vigil: a one-time check that waits for a date or an event" });
  assert.deepEqual(look.reasonParts(["2 open findings", "1 candle lit", "1 vigil due"], "w").glossed, ["finding", "candle", "vigil"], "the words the shown reasons use");
});

test("the words: one module, a plain definition each; the headings take their words from it; the glossary names every term", () => {
  const { TERMS, LABELS, STATE_WORDS, MACHINE_PAGE_TERMS } = terms;
  assert.equal(TERMS.djinn.definition, "the unattended session darius starts to perform a ritual");
  assert.equal(TERMS.ritual.definition, "recurring work that darius starts by itself, on a schedule");
  assert.equal(LABELS.ritualsHere, "Rituals that darius starts here");
  assert.equal(LABELS.columnRituals, "Rituals");
  assert.equal(LABELS.sandboxCheck, "Sandbox check");
  assert.equal(STATE_WORDS.waits, "waits for your answer");
  assert.equal(STATE_WORDS.onSchedule, "on schedule");
  for (const label of Object.values(LABELS)) assert.doesNotMatch(label, /djinn|pinned|ledger|\bbox check|asks you/iu, label);
  assert.equal(terms.termCount("ritual", 1), "1 ritual");
  assert.equal(terms.termCount("ritual", 11), "11 rituals");
  assert.equal(terms.definitionLine("vigil"), "A vigil is a one-time check that waits for a date or an event.");
  assert.equal(terms.definitionLine("sandboxCheck"), "A sandbox check is a test that the run sandbox on this machine works.");
  assert.deepEqual([...MACHINE_PAGE_TERMS].toSorted(), Object.keys(TERMS).toSorted(), "the machine pages explain every term");
  const glossary = readFileSync(new URL("../docs/glossary.md", import.meta.url), "utf8").toLowerCase();
  for (const term of Object.values(TERMS)) assert.ok(glossary.includes(`**${term.word}`), `docs/glossary.md has an entry for ${term.word}`);
});

test("the zone of the time note: UTC and the offset of the machine", () => {
  assert.equal(zoneName(60), "UTC+01:00");
  assert.equal(zoneName(0), "UTC+00:00");
  assert.equal(zoneName(-330), "UTC-05:30");
});
