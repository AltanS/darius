/**
 * The run page's links (0.92.0): `RunDetail.origin` says where a run came from,
 * `RunDetail.readBy` says which runs took its answers, and the words of
 * web/app/lib/run-origin.ts turn both, and the activity entries of the run,
 * into the header, the "Then" lines and the trail. The first tests go through
 * a throwaway store; the last ones are pure.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { JsonValue, LedgerLine } from "../src/core/model.ts";
import type { ActivityEntry, FollowUpChild, RunOrigin, RunRow } from "../src/web/api.ts";
import { activityOf } from "../src/web/activity.ts";
import { originView, thenLines, trailLines, type TrailLine } from "../web/app/lib/run-origin.ts";

const SANDBOX = mkdtempSync(join(tmpdir(), "darius-web-run-detail-"));
process.env.DARIUS_STATE_DIR = join(SANDBOX, "state");
process.env.DARIUS_CONFIG_DIR = join(SANDBOX, "config");

const { appendLine } = await import("../src/core/ledger.ts");
const { openProject } = await import("../src/core/store.ts");
const { runDetail } = await import("../src/web/status.ts");

const ITEM = "ritual/daily";
const TOKEN = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";
const project = openProject("run-detail", { create: true });

let serial = 0;
function newRun(): string {
  serial += 1;
  return `01JRD${String(serial).padStart(21, "0")}`;
}

function start(run: string, who: string, extra: Record<string, string | number | boolean | string[] | number[]> = {}): { at: string } {
  return appendLine(project, { who, type: "run.started", item: ITEM, run, ...extra });
}

function complete(run: string): void {
  appendLine(project, { who: "claude:x", type: "run.completed", item: ITEM, run, outcome: "complete" });
}

function detail(run: string): NonNullable<ReturnType<typeof runDetail>> {
  const found = runDetail("run-detail", run);
  assert.ok(found !== null, run);
  return found;
}

// --- the five kinds of origin -----------------------------------------------------------

test("origin: a timer start is a schedule, a hand start is manual, and neither says more", () => {
  const timer = newRun();
  start(timer, "timer");
  const hand = newRun();
  start(hand, "altan@host-a");
  assert.deepEqual(detail(timer).origin, { kind: "schedule", who: "timer" });
  assert.deepEqual(detail(hand).origin, { kind: "manual", who: "altan@host-a" });
  assert.deepEqual(detail(timer).readBy, []);
});

test("origin: a follow-up names its parent, what was approved, the granted lines and the note, all masked", () => {
  const parent = newRun();
  start(parent, "timer");
  complete(parent);
  const kid = newRun();
  start(kid, "web:altan", { follow_up_of: parent, approved: [2], items: ["seo-3"], grants: [`curl -H "Authorization: Bearer abc123def456ghi789"`, "git push"], note: `use ${TOKEN}` });
  const { origin } = detail(kid);
  assert.equal(origin.kind, "follow-up");
  assert.equal(origin.run, parent);
  assert.equal(origin.who, "web:altan");
  assert.deepEqual(origin.approved?.questions, [2]);
  assert.deepEqual(origin.approved?.items, ["seo-3"]);
  assert.equal(origin.approved?.grants.length, 2);
  assert.equal(origin.approved?.grants[1], "git push");
  const shown = JSON.stringify(origin);
  assert.ok(!shown.includes(TOKEN) && !shown.includes("abc123def456ghi789"), shown);
  assert.ok(shown.includes("[masked]"), shown);
  assert.deepEqual(detail(parent).followUps, [kid]);
});

test("origin: a follow-up without a note, grants or items has an empty approval, not a missing one", () => {
  const parent = newRun();
  start(parent, "timer");
  complete(parent);
  const kid = newRun();
  start(kid, "web:altan", { follow_up_of: parent, approved: [1] });
  assert.deepEqual(detail(kid).origin.approved, { questions: [1], items: [], grants: [], note: null });
});

test("origin: a run that read an answer says which run was answered and by whom, and the parent says who read it", () => {
  const asked = newRun();
  start(asked, "timer");
  complete(asked);
  const ack = appendLine(project, { who: "web:altan", type: "run.acknowledged", item: ITEM, run: asked, answers: [{ n: 1, text: "yes" }] });
  const reader = newRun();
  const readerStart = start(reader, "web:altan", { answers_read: [ack.id] });
  complete(reader);
  const { origin } = detail(reader);
  assert.equal(origin.kind, "after-answer");
  assert.equal(origin.who, "web:altan");
  assert.deepEqual(origin.answersRead, [{ run: asked, at: ack.at, who: "web:altan" }]);
  assert.deepEqual(detail(asked).readBy, [{ run: reader, at: readerStart.at }]);
});

test("origin: a run with no start line but a resume is a resume", () => {
  const orphan = newRun();
  appendLine(project, { who: "web:altan", type: "run.resumed", item: ITEM, run: orphan, fresh: true });
  assert.deepEqual(detail(orphan).origin, { kind: "resume", who: "web:altan" });
});

// --- readBy follows the handoff rule -----------------------------------------------------

test("readBy: a follow-up never consumes an answer, a fresh resume does, and each run shows once with its earliest line", () => {
  const asked = newRun();
  start(asked, "timer");
  complete(asked);
  const ack = appendLine(project, { who: "web:altan", type: "run.acknowledged", item: ITEM, run: asked, answers: [{ n: 1, text: "go" }] });
  const otherRun = newRun();
  const other = appendLine(project, { who: "web:altan", type: "run.acknowledged", item: ITEM, run: otherRun, answers: [{ n: 1, text: "elsewhere" }] });

  const followUp = newRun();
  start(followUp, "web:altan", { follow_up_of: asked, answers_read: [ack.id] });

  const held = newRun();
  start(held, "timer");
  appendLine(project, { who: "claude:x", type: "run.held", item: ITEM, run: held, questions: ["which?"] });
  const first = appendLine(project, { who: "web:altan", type: "run.resumed", item: ITEM, run: held, fresh: true, answers_read: [ack.id] });
  appendLine(project, { who: "web:altan", type: "run.resumed", item: ITEM, run: held, fresh: true, answers_read: [ack.id, other.id] });

  assert.deepEqual(detail(asked).readBy, [{ run: held, at: first.at }], "the follow-up is left out, the resumed run shows once");
  assert.deepEqual(detail(followUp).origin.kind, "follow-up", "a follow-up that names answers is still a follow-up");
  assert.equal(detail(followUp).origin.answersRead, undefined, "and it shows no answer read");
  const resumed = detail(held).origin;
  assert.equal(resumed.kind, "schedule", "the start was the timer's");
  assert.deepEqual(resumed.answersRead, [
    { run: asked, at: ack.at, who: "web:altan" },
    { run: otherRun, at: other.at, who: "web:altan" },
  ], "the reads of both fresh resumes show, so the reader links back to what it read");
  assert.deepEqual(detail(followUp).readBy, []);
});

test("readBy: a reader that failed did not take the answer, a reader still open is listed (the handoff offers a failed run's answers again)", () => {
  const asked = newRun();
  start(asked, "timer");
  complete(asked);
  const ack = appendLine(project, { who: "web:altan", type: "run.acknowledged", item: ITEM, run: asked, answers: [{ n: 1, text: "go" }] });
  const failed = newRun();
  start(failed, "timer", { answers_read: [ack.id] });
  appendLine(project, { who: "timer", type: "run.completed", item: ITEM, run: failed, outcome: "failed" });
  assert.deepEqual(detail(asked).readBy, [], "the failed reader is left out");
  const open = newRun();
  const openStart = start(open, "timer", { answers_read: [ack.id] });
  assert.deepEqual(detail(asked).readBy, [{ run: open, at: openStart.at }], "a reader that is still running is listed");
  assert.equal(detail(failed).origin.kind, "after-answer", "the failed run still says where it came from");
});

test("runDetail: an unknown run is null, and the detail has no events list any more", () => {
  assert.equal(runDetail("run-detail", "NOPE"), null);
  assert.equal(runDetail("ghost", "NOPE"), null);
  const run = newRun();
  start(run, "timer");
  assert.equal("events" in detail(run), false);
});

// --- the words ---------------------------------------------------------------------------

const CLOCK = { today: "2026-10-15", offset: 0 };

test("originView: a follow-up header names the parent, the approval, the granted lines and the note", () => {
  const origin: RunOrigin = { kind: "follow-up", run: "01PARENT0000000000000000AB", who: "web:altan", approved: { questions: [2], items: ["seo-3"], grants: ["git push"], note: "careful" } };
  const view = originView(origin, "2026-10-15T09:12:00.000Z", CLOCK);
  assert.deepEqual(view.leads, [{ before: "Follow-up of ", run: "01PARENT0000000000000000AB", linkText: "000000AB", after: ", started by web:altan at 09:12." }]);
  assert.equal(view.approved, "Q2, item seo-3");
  assert.deepEqual(view.grants, ["git push"]);
  assert.equal(view.note, "careful");
  assert.equal(originView(origin, "2026-10-14T09:12:00.000Z", CLOCK).leads[0]?.after, ", started by web:altan at 14 Oct 09:12.", "another day names the date");
  const bare = originView({ ...origin, approved: { questions: [], items: [], grants: [], note: null } }, "2026-10-15T09:12:00.000Z", CLOCK);
  assert.deepEqual([bare.approved, bare.grants, bare.note], [null, [], null], "nothing approved draws nothing");
});

test("originView: an after-answer header links each answered run once; a schedule or a hand start says nothing", () => {
  const origin: RunOrigin = {
    kind: "after-answer",
    who: "web:altan",
    answersRead: [
      { run: "RUN-A", at: "2026-10-15T08:50:00.000Z", who: "web:altan" },
      { run: "RUN-A", at: "2026-10-15T08:55:00.000Z", who: "web:altan" },
      { run: "RUN-B", at: "2026-10-14T07:00:00.000Z", who: "web:altan" },
    ],
  };
  const view = originView(origin, "2026-10-15T09:00:00.000Z", CLOCK);
  assert.deepEqual(view.leads.map((lead) => `${lead.before}[${lead.run}]${lead.after}`), ["Started after your answer of 08:55 on run [RUN-A].", "Started after your answer of 14 Oct 07:00 on run [RUN-B]."]);
  const resumed = originView({ kind: "schedule", who: "timer", answersRead: [{ run: "RUN-A", at: "2026-10-15T08:50:00.000Z", who: "web:altan" }] }, "2026-10-15T07:00:00.000Z", CLOCK);
  assert.deepEqual(resumed.leads.map((lead) => `${lead.before}[${lead.run}]${lead.after}`), ["Resumed with your answer of 08:50 on run [RUN-A]."], "a run resumed with an answer links the answered run too");
  assert.deepEqual(originView({ kind: "schedule", who: "timer" }, "2026-10-15T09:00:00.000Z", CLOCK).leads, []);
  assert.deepEqual(originView({ kind: "manual", who: "altan" }, "2026-10-15T09:00:00.000Z", CLOCK).leads, []);
  assert.deepEqual(originView({ kind: "resume", who: "web:altan" }, "2026-10-15T09:00:00.000Z", CLOCK).leads.map((lead) => lead.before), ["Resumed by web:altan at 09:00."]);
});

function row(run: string, extra: Partial<RunRow> = {}): RunRow {
  return { run, item: ITEM, phase: "closed", outcome: "complete", startedAt: "2026-10-15T09:12:00.000Z", endedAt: "2026-10-15T09:40:00.000Z", who: "web:altan", questions: [], findingsSha: null, result: null, acknowledged: null, followUpOf: "P", startedBy: "web", ackKind: null, ...extra };
}

function child(run: string, extra: Partial<RunRow> = {}): FollowUpChild {
  return { row: row(run, extra), approved: [], items: [], result: null };
}

test("thenLines: each follow-up with how it stands, and each run that read the answer", () => {
  const changed = child("01CHILD00000000000000000AA", { result: { status: "ok", questions: 0, open: { critical: 0, high: 0, medium: 0, low: 0, info: 0 }, fixed: 2 } });
  const lines = thenLines(
    [changed, child("01CHILD00000000000000000BB", { phase: "running", outcome: null, endedAt: null }), child("01CHILD00000000000000000CC", { phase: "held", outcome: null, endedAt: null }), child("01CHILD00000000000000000DD", { outcome: "failed" }), child("01CHILD00000000000000000EE")],
    [
      { run: "READER", at: "2026-10-13T05:00:00.000Z" },
      { run: "TODAY", at: "2026-10-15T05:00:00.000Z" },
      { run: "OLD", at: "2026-09-30T05:00:00.000Z" },
    ],
    CLOCK,
  );
  assert.deepEqual(
    lines.map((line) => `${line.before}${line.linkText}${line.after}`),
    [
      "Then: follow-up 000000AA, done 09:40, 2 changed",
      "Then: follow-up 000000BB, running",
      "Then: follow-up 000000CC, waiting for you",
      "Then: follow-up 000000DD, failed 09:40",
      "Then: follow-up 000000EE, done 09:40",
      "Your answer was read by the run of Tue 05:00",
      "Your answer was read by the run of 05:00",
      "Your answer was read by the run of 30 Sep 05:00",
    ],
  );
  assert.deepEqual(lines.map((line) => line.run), ["01CHILD00000000000000000AA", "01CHILD00000000000000000BB", "01CHILD00000000000000000CC", "01CHILD00000000000000000DD", "01CHILD00000000000000000EE", "READER", "TODAY", "OLD"]);
  assert.deepEqual(thenLines([], [], CLOCK), [], "a run nothing came of draws nothing");
});

function entry(kind: ActivityEntry["kind"], at: string, text: string, extra: Partial<ActivityEntry> = {}): ActivityEntry {
  return { at, who: "web:altan", actor: "web", kind, item: { type: "run", id: "R", title: "Daily" }, run: "R", text, links: { ritual: "daily", run: "R" }, tone: "ok", ...extra };
}

test("trailLines: oldest first; an answer shows its answers in full, a dismissal and a chosen follow-up say what they did", () => {
  const newestFirst = [
    entry("ack-follow-up", "2026-10-15T10:00:00.000Z", "Follow-up 01CHILD00000000000000000AA chosen by web:altan; note: go on"),
    entry("ack-dismissed", "2026-10-15T09:50:00.000Z", "Dismissed by web:altan as older than run 01NEWER00000000000000000ZZ"),
    entry("ack-answered", "2026-10-15T09:40:00.000Z", "Answered by web:altan", { detail: ["Q1: yes", "Q2: no"] }),
    entry("run-held", "2026-10-15T09:20:00.000Z", "Run held with 1 question", { tone: "wait", detail: ["which branch?"] }),
    entry("run-started", "2026-10-15T09:10:00.000Z", "Run started by timer"),
  ];
  const lines = trailLines(newestFirst);
  assert.deepEqual(
    lines.map((line) => line.text),
    ["Run started by timer", "Run held with 1 question", "Answered by web:altan", "Dismissed by web:altan (earlier than 000000ZZ)", "Follow-up 000000AA started instead of answering, by web:altan; note: go on"],
  );
  assert.deepEqual(lines[2]?.inline, ["Q1: yes", "Q2: no"]);
  assert.deepEqual(lines[2]?.folded, []);
  assert.deepEqual(lines[1]?.inline, []);
  assert.deepEqual(lines[1]?.folded, ["which branch?"], "questions sit behind a fold");
  assert.deepEqual(trailLines([]), []);
});

function trail(one: LedgerLine): TrailLine[] {
  return trailLines(activityOf("trail", [one]));
}

test("trailLines: the sentences hold for the real output of activityOf, so a change of its wording fails here", () => {
  const run = "01JTRAIL000000000000000000";
  const newer = "01JTRAIL00000000000000000N";
  const chosenRun = "01JTRAIL00000000000000000C";
  let tick = 0;
  const line = (type: string, extra: { [key: string]: JsonValue }): LedgerLine => {
    tick += 1;
    return { v: 1, id: `01ID${String(tick).padStart(22, "0")}`, at: new Date(Date.UTC(2026, 9, 15, 9, 0, tick)).toISOString(), host: "h", who: "web:altan", project: "trail", type, item: ITEM, run, ...extra };
  };
  assert.equal(trail(line("run.acknowledged", { earlier_than: newer }))[0]?.text, `Dismissed by web:altan (earlier than ${newer.slice(-8)})`);
  assert.equal(trail(line("run.acknowledged", { follow_up: chosenRun, note: "go on" }))[0]?.text, `Follow-up ${chosenRun.slice(-8)} started instead of answering, by web:altan; note: go on`);
  const answered = trail(line("run.acknowledged", { answers: [{ n: 1, text: "yes" }] }))[0];
  assert.deepEqual([answered?.text, answered?.inline], ["Answered by web:altan", ["Q1: yes"]]);
});
