/**
 * The activity model (src/web/activity.ts, 0.88.0): ledger lines in, one
 * list of `ActivityEntry` rows out. The function is pure, so most tests build
 * lines by hand. The last tests go through the store (a throwaway directory)
 * to prove `WebContext.activity` and the new `RunRow` fields.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { JsonValue, LedgerLine } from "../src/core/model.ts";
import type { ActivityEntry, ActivityKind } from "../src/web/api.ts";
import { ackKindOf, activityOf, actorOf, startedByOf } from "../src/web/activity.ts";

const SANDBOX = mkdtempSync(join(tmpdir(), "darius-web-activity-"));
process.env.DARIUS_STATE_DIR = join(SANDBOX, "state");
process.env.DARIUS_CONFIG_DIR = join(SANDBOX, "config");

const PROJECT = "shop";
const RUN = "01JRUN0000000000000000000A";
const CHILD = "01JRUN0000000000000000000B";
let tick = 0;

/** A ledger line in the shape the writers produce. Lines get rising times, so the order is the ledger order. */
function line(type: string, who: string, extra: { [key: string]: JsonValue } = {}): LedgerLine {
  tick += 1;
  const at = new Date(Date.UTC(2026, 9, 14, 8, 0, tick)).toISOString();
  return { v: 1, id: `01ID${String(tick).padStart(22, "0")}`, at, host: "host-a", who, project: PROJECT, type, ...extra };
}

const RITUAL = "ritual/daily";
const VIGIL = "vigil/queue";

function only(lines: LedgerLine[], options = {}): ActivityEntry {
  const entries = activityOf(PROJECT, lines, options);
  assert.equal(entries.length, 1, JSON.stringify(entries));
  const [entry] = entries;
  assert.ok(entry);
  return entry;
}

test("actorOf and startedByOf parse who", () => {
  assert.equal(actorOf("web:altan"), "web");
  assert.equal(actorOf("timer"), "timer");
  assert.equal(actorOf(RUN), "run");
  assert.equal(actorOf("altan@host-a"), "cli");
  assert.equal(actorOf("import"), "system");
  assert.equal(actorOf("sweep"), "system");
  assert.equal(startedByOf("web:altan"), "web");
  assert.equal(startedByOf("timer"), "timer");
  assert.equal(startedByOf("altan@host-a"), "cli");
  assert.equal(startedByOf("import"), "cli");
  assert.equal(startedByOf(RUN), "cli");
});

test("every kind of the union has an entry, with its who, actor and links", () => {
  const cases: Array<[ActivityKind, LedgerLine[]]> = [
    ["run-started", [line("run.started", "timer", { item: RITUAL, run: RUN })]],
    ["follow-up-started", [line("run.started", "web:altan", { item: RITUAL, run: CHILD, follow_up_of: RUN, approved: [2], items: ["x"], grants: ["git push"], note: "go on" })]],
    ["run-held", [line("run.started", "timer", { item: RITUAL, run: RUN }), line("run.held", "timer", { item: RITUAL, run: RUN, questions: ["May I push?"] })]],
    ["run-answered", [line("run.answered", "web:altan", { item: RITUAL, run: RUN, n: 1, text: "yes" })]],
    ["run-resumed", [line("run.resumed", "web:altan", { item: RITUAL, run: RUN, fresh: true })]],
    ["run-completed", [line("run.completed", "timer", { item: RITUAL, run: RUN, outcome: "complete" })]],
    ["run-failed", [line("run.completed", "timer", { item: RITUAL, run: RUN, outcome: "failed" })]],
    ["ack-answered", [line("run.acknowledged", "web:altan", { item: RITUAL, run: RUN, answers: [{ n: 1, text: "yes" }] })]],
    ["ack-dismissed", [line("run.acknowledged", "web:altan", { item: RITUAL, run: RUN })]],
    ["ack-note", [line("run.acknowledged", "altan", { item: RITUAL, run: RUN, note: "known outage" })]],
    ["ack-follow-up", [line("run.acknowledged", "web:altan", { item: RITUAL, run: RUN, note: "follow-up", follow_up: CHILD })]],
    ["vigil-swept", [line("vigil.swept", "sweep", { item: VIGIL, outcome: "failed", checks: [] })]],
    ["vigil-paused", [line("vigil.paused", "web:altan", { item: VIGIL, reason: "deploy", until: "2026-10-20" })]],
    ["vigil-resumed", [line("vigil.resumed", "web:altan", { item: VIGIL })]],
    ["vigil-closed", [line("vigil.closed", "web:altan", { item: VIGIL, verdict: "held", by: "sweep" })]],
    ["finding-closed", [line("finding.closed", "web:altan", { item: RITUAL, key: "post-12", note: "wontfix" })]],
    ["finding-reopened", [line("finding.reopened", "web:altan", { item: RITUAL, key: "post-12" })]],
    ["finding-reset", [line("finding.reset", "altan", { item: RITUAL, note: "start over" })]],
    ["flare-lit", [line("flare.lit", "altan", { key: "cert", title: "Certificate expires", severity: "high", source: "script" })]],
    ["flare-answered", [line("flare.answered", "web:altan", { key: "cert", note: "renewed", severity: "high" })]],
    ["flare-accepted", [line("flare.accepted", "web:altan", { key: "cert", severity: "high" })]],
    ["flare-cleared", [line("flare.cleared", "altan", { key: "cert" })]],
    ["flare-reopened", [line("flare.reopened", "altan", { key: "cert" })]],
    ["ritual-lifecycle", [line("ritual.lifecycle", "altan", { item: RITUAL, state: "paused" })]],
    ["ritual-rescheduled", [line("ritual.rescheduled", "altan", { item: RITUAL, due: "2026-10-20" })]],
  ];
  const seen = new Set<ActivityKind>();
  for (const [kind, lines] of cases) {
    const entries = activityOf(PROJECT, lines);
    const entry = entries[0];
    assert.ok(entry, kind);
    assert.equal(entry.kind, kind);
    assert.equal(entry.actor, actorOf(entry.who), kind);
    assert.ok(entry.text.includes(entry.who) || kind === "run-failed" || kind === "run-completed" || kind === "run-held", `${kind}: ${entry.text}`);
    seen.add(kind);
  }
  assert.equal(seen.size, 25, "the union has 25 kinds, each tried once");
  const source = readFileSync(new URL("../src/web/api.ts", import.meta.url), "utf8");
  for (const kind of seen) assert.ok(source.includes(`"${kind}"`), `${kind} is in the union`);
});

test("a run line is about the run; the ritual and the run are links; the title comes from titleOf", () => {
  const entry = only([line("run.started", "timer", { item: RITUAL, run: RUN })], { titleOf: (type: string, id: string) => (type === "ritual" && id === "daily" ? "Daily report" : undefined) });
  assert.deepEqual(entry.item, { type: "run", id: RUN, title: "Daily report" });
  assert.equal(entry.run, RUN);
  assert.deepEqual(entry.links, { ritual: "daily", run: RUN });
  assert.equal(entry.tone, "run");
  assert.equal(only([line("run.started", "timer", { item: RITUAL, run: RUN })]).item.title, "daily", "no titleOf: the slug");
});

test("a follow-up reads 'Follow-up of <parent> started by <who>: approved Q2, item x; note: ...'", () => {
  const entry = only([line("run.started", "web:altan", { item: RITUAL, run: CHILD, follow_up_of: RUN, approved: [2], items: ["x"], note: "push it" })]);
  assert.equal(entry.text, `Follow-up of ${RUN} started by web:altan: approved Q2, item x; note: push it`);
  assert.equal(entry.actor, "web");
  const granted = only([line("run.started", "web:altan", { item: RITUAL, run: CHILD, follow_up_of: RUN, approved: [1], grants: ["git push origin main"] })]);
  assert.ok(granted.text.endsWith("approved Q1, granted 1 line"), granted.text);
  assert.deepEqual(granted.detail, ["Granted: git push origin main"]);
});

test("the ack kind: answers, then follow-up, then dismissal, then a note alone", () => {
  const ack = (extra: { [key: string]: JsonValue }) => line("run.acknowledged", "web:altan", { item: RITUAL, run: RUN, ...extra });
  assert.equal(ackKindOf(ack({ answers: [{ n: 1, text: "yes" }], follow_up: CHILD, note: "x" })), "answered", "answers win over a follow-up");
  assert.equal(ackKindOf(ack({ follow_up: CHILD, note: "follow-up" })), "follow-up");
  assert.equal(ackKindOf(ack({ earlier_than: CHILD, note: "x" })), "dismissed", "earlier_than wins over a note");
  assert.equal(ackKindOf(ack({})), "dismissed", "no note");
  assert.equal(ackKindOf(ack({ note: "known" })), "note");
  assert.equal(ackKindOf(ack({ answers: [], note: "known" })), "note", "an empty answers list is no answers");
});

test("an answered ack lists each Q<n>: <answer> and shows a note built from answers once", () => {
  const entry = only([line("run.acknowledged", "web:altan", { item: RITUAL, run: RUN, carry: true, answers: [{ n: 1, text: "yes" }, { n: 3, text: "no" }], note: "Q1: yes / Q3: no", note_from_answers: true })]);
  assert.equal(entry.kind, "ack-answered");
  assert.deepEqual(entry.detail, ["Q1: yes", "Q3: no"]);
  assert.equal(entry.text, "Answered by web:altan", "the note built from the answers is not repeated");
  const noted = only([line("run.acknowledged", "web:altan", { item: RITUAL, run: RUN, answers: [{ n: 1, text: "yes" }], note: "also this" })]);
  assert.equal(noted.text, "Answered by web:altan; note: also this");
  const earlier = only([line("run.acknowledged", "web:altan", { item: RITUAL, run: RUN, earlier_than: CHILD })]);
  assert.equal(earlier.text, `Dismissed by web:altan as older than run ${CHILD}`);
});

test("run.completed: complete is run-completed, any other outcome is run-failed", () => {
  assert.equal(only([line("run.completed", "timer", { item: RITUAL, run: RUN, outcome: "complete" })]).kind, "run-completed");
  const waiting = only([line("run.completed", "timer", { item: RITUAL, run: RUN, outcome: "complete", result: { status: "attention", questions: 2, open: {}, fixed: 0 } })]);
  assert.equal(waiting.tone, "wait");
  assert.equal(waiting.text, "Run completed with 2 questions for you");
  const abandoned = only([line("run.completed", "timer", { item: RITUAL, run: RUN, outcome: "abandoned" })]);
  assert.equal(abandoned.kind, "run-failed");
  assert.equal(abandoned.tone, "bad");
  assert.equal(abandoned.text, "Run abandoned");
});

test("evidence lines fold into the sweep that follows them and never show alone", () => {
  const lines = [
    line("evidence", "sweep", { item: VIGIL, check: `${VIGIL}#1`, exit: 0, outcome: "pass", command: "curl -sf http://localhost/" }),
    line("evidence", "sweep", { item: VIGIL, check: `${VIGIL}#2`, exit: 1, outcome: "fail", command: "test -z \"$(ls queue)\"" }),
    line("vigil.swept", "sweep", { item: VIGIL, outcome: "failed", checks: [] }),
    line("evidence", "sweep", { item: VIGIL, check: `${VIGIL}#1`, exit: 0, outcome: "pass", command: "curl -sf http://localhost/" }),
    line("vigil.swept", "sweep", { item: VIGIL, outcome: "finding", checks: [] }),
  ];
  const entries = activityOf(PROJECT, lines);
  assert.equal(entries.length, 2, "two sweeps, no evidence entry");
  assert.deepEqual(entries[1]?.detail, ["Check 1: pass, exit 0 (curl -sf http://localhost/)", "Check 2: fail, exit 1 (test -z \"$(ls queue)\")"]);
  assert.deepEqual(entries[0]?.detail, ["Check 1: pass, exit 0 (curl -sf http://localhost/)"], "the second sweep folds only its own evidence");
  assert.equal(entries[1]?.tone, "bad");
  assert.deepEqual(entries[1]?.item, { type: "vigil", id: "queue", title: "queue" });
  assert.deepEqual(entries[1]?.links, { vigil: "queue" });
});

test("types that are not activity are left out, and a dry-run sweep too", () => {
  const lines = [
    line("snapshot.ok", "timer", {}),
    line("alert.sent", "timer", { item: RITUAL }),
    line("push.sent", "timer", {}),
    line("harness.check", "timer", {}),
    line("tree.put", "altan", { path: "a.md" }),
    line("ritual.defined", "altan", { item: RITUAL }),
    line("vigil.swept", "sweep", { item: VIGIL, outcome: "held", dry_run: true }),
    line("something.new", "altan", { item: RITUAL }),
  ];
  assert.deepEqual(activityOf(PROJECT, lines), []);
});

test("the activity text masks secrets in notes, answers, reasons, grants and commands", () => {
  const token = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";
  const lines = [
    line("run.started", "web:altan", { item: RITUAL, run: CHILD, follow_up_of: RUN, note: `use ${token}`, grants: [`curl -H "Authorization: Bearer abc123def456ghi789"`] }),
    line("run.acknowledged", "web:altan", { item: RITUAL, run: RUN, answers: [{ n: 1, text: `password=hunter2hunter2` }] }),
    line("vigil.paused", "web:altan", { item: VIGIL, reason: `api_key=${token}` }),
    line("evidence", "sweep", { item: VIGIL, check: `${VIGIL}#1`, exit: 1, outcome: "fail", command: `deploy --token=${token}` }),
    line("vigil.swept", "sweep", { item: VIGIL, outcome: "failed" }),
  ];
  const everything = JSON.stringify(activityOf(PROJECT, lines));
  assert.ok(!everything.includes(token), everything);
  assert.ok(!everything.includes("hunter2"), everything);
  assert.ok(!everything.includes("abc123def456ghi789"), everything);
  assert.ok(everything.includes("[masked]"));
});

test("a note that looks like a 64-character hex sha is plain text on a run.started line", () => {
  const sha = "a".repeat(64);
  const entry = only([line("run.started", "web:altan", { item: RITUAL, run: CHILD, follow_up_of: RUN, note: sha })]);
  assert.equal(entry.kind, "follow-up-started");
  assert.ok(entry.text.endsWith(`note: ${sha}`), "the note shows as written; it is plain text, not a blob reference");
});

test("a resume in a new session shows the answers it read; an orphan evidence line shows nothing", () => {
  const resumed = only([line("run.resumed", "web:altan", { item: RITUAL, run: RUN, fresh: true, answers_read: ["01ACK1", "01ACK2"] })]);
  assert.equal(resumed.text, "Run resumed by web:altan in a new session");
  assert.deepEqual(resumed.detail, ["Read 2 answers"]);
  assert.equal(only([line("run.resumed", "web:altan", { item: RITUAL, run: RUN })]).text, "Run resumed by web:altan in the same session");
  assert.deepEqual(activityOf(PROJECT, [line("evidence", "sweep", { item: VIGIL, check: `${VIGIL}#1`, exit: 0, outcome: "pass" })]), []);
});

test("sweep outcomes map to tones", () => {
  const tone = (outcome: string) => only([line("vigil.swept", "sweep", { item: VIGIL, outcome })]).tone;
  assert.deepEqual(["held", "failed", "skipped", "finding", "pending", "awaiting-manual"].map(tone), ["ok", "bad", "idle", "wait", "wait", "wait"]);
});

test("filters: ritual, vigil, run, finding, since, limit; the list is newest first", () => {
  const lines = [
    line("run.started", "timer", { item: RITUAL, run: RUN }),
    line("run.completed", "timer", { item: RITUAL, run: RUN, outcome: "complete" }),
    line("run.started", "web:altan", { item: RITUAL, run: CHILD, follow_up_of: RUN }),
    line("run.acknowledged", "web:altan", { item: RITUAL, run: RUN, note: "follow-up", follow_up: CHILD }),
    line("run.started", "timer", { item: "ritual/other", run: "01JRUN0000000000000000000C" }),
    line("finding.closed", "web:altan", { item: RITUAL, key: "post-12" }),
    line("finding.closed", "web:altan", { item: "ritual/other", key: "post-99" }),
    line("vigil.paused", "web:altan", { item: VIGIL, reason: "deploy" }),
  ];
  const all = activityOf(PROJECT, lines);
  assert.equal(all.length, 8);
  assert.ok(all.every((entry, index) => index === 0 || (all[index - 1]?.at ?? "") >= entry.at), "newest first");
  assert.equal(activityOf(PROJECT, lines, { ritual: "daily" }).length, 5, "the ritual's runs, ack and finding");
  assert.equal(activityOf(PROJECT, lines, { vigil: "queue" }).length, 1);
  assert.deepEqual(activityOf(PROJECT, lines, { run: RUN }).map((entry) => entry.kind).toReversed(), ["run-started", "run-completed", "follow-up-started", "ack-follow-up"], "own lines, the follow-up it started, the ack that names it");
  assert.deepEqual(activityOf(PROJECT, lines, { finding: "post-12" }).map((entry) => entry.item.id), ["post-12"]);
  assert.equal(activityOf(PROJECT, lines, { limit: 3 }).length, 3);
  assert.equal(activityOf(PROJECT, lines, { limit: 3 })[0]?.kind, "vigil-paused");
  const cut = all[4]?.at ?? "";
  assert.equal(activityOf(PROJECT, lines, { since: cut }).length, 5);
  assert.deepEqual(activityOf(PROJECT, lines, { limit: 0 }), []);
});

test("lines of another project are ignored, and a run line with no item takes the item of its start", () => {
  const foreign: LedgerLine = { ...line("run.started", "timer", { item: RITUAL, run: RUN }), project: "other" };
  assert.deepEqual(activityOf(PROJECT, [foreign]), []);
  const entries = activityOf(PROJECT, [line("run.started", "timer", { item: RITUAL, run: RUN }), line("run.answered", "web:altan", { run: RUN, n: 1, text: "yes" })]);
  assert.deepEqual(entries[0]?.links, { ritual: "daily", run: RUN });
});

test("finding.reset names its ritual or all findings", () => {
  const scoped = only([line("finding.reset", "altan", { item: RITUAL })]);
  assert.deepEqual(scoped.item, { type: "ritual", id: "daily", title: "daily" });
  const everywhere = only([line("finding.reset", "altan", {})]);
  assert.equal(everywhere.item.type, "finding");
  assert.equal(everywhere.text, "Findings of every ritual reset by altan");
});

test("activity.ts is pure: no node:fs import", () => {
  const source = readFileSync(new URL("../src/web/activity.ts", import.meta.url), "utf8");
  assert.ok(!source.includes("node:fs"));
  assert.ok(!/from "node:/u.test(source));
});

// --- through the store ---------------------------------------------------------------------

const { appendLine, readLedger } = await import("../src/core/ledger.ts");
const { openProject } = await import("../src/core/store.ts");
const { runRows } = await import("../src/web/status.ts");
const { webContext, collectActivity } = await import("../src/web/context.ts");

test("WebContext.activity merges over projects, newest first, and runRows carries followUpOf, startedBy and ackKind", () => {
  const shop = openProject("act-shop", { create: true });
  const blog = openProject("act-blog", { create: true });
  appendLine(shop, { who: "timer", type: "run.started", item: RITUAL, run: RUN });
  appendLine(shop, { who: "timer", type: "run.completed", item: RITUAL, run: RUN, outcome: "complete" });
  appendLine(blog, { who: "web:altan", type: "run.started", item: RITUAL, run: CHILD, follow_up_of: RUN, note: "go" });
  appendLine(shop, { who: "web:altan", type: "run.acknowledged", item: RITUAL, run: RUN, note: "follow-up", follow_up: CHILD });

  const ctx = webContext("test");
  const merged = ctx.activity(null);
  assert.deepEqual(merged.map((entry) => `${entry.project}:${entry.kind}`).toSorted(), ["act-blog:follow-up-started", "act-shop:ack-follow-up", "act-shop:run-completed", "act-shop:run-started"]);
  assert.ok(merged.every((entry, index) => index === 0 || (merged[index - 1]?.at ?? "") >= entry.at), "newest first over projects");
  assert.deepEqual(ctx.activity("act-shop").map((entry) => entry.kind), ["ack-follow-up", "run-completed", "run-started"]);
  assert.deepEqual(ctx.activity("act-blog").map((entry) => entry.kind), ["follow-up-started"]);
  assert.deepEqual(ctx.activity("nope"), []);
  assert.equal(ctx.activity(null, { limit: 1 }).length, 1);
  assert.equal(collectActivity("act-shop", { ritual: "other" }).length, 0);

  const parent = runRows(readLedger(shop)).find((row) => row.run === RUN);
  assert.equal(parent?.startedBy, "timer");
  assert.equal(parent?.followUpOf, null);
  assert.equal(parent?.ackKind, "follow-up");
  const child = runRows(readLedger(blog)).find((row) => row.run === CHILD);
  assert.equal(child?.startedBy, "web");
  assert.equal(child?.followUpOf, RUN);
  assert.equal(child?.ackKind, null);
});

test("flare lines make flare entries: the flare is the item, its key is the link, and the title comes from the report", () => {
  const entries = activityOf(PROJECT, [
    line("flare.lit", "ci", { key: "cert", title: "Certificate expires", severity: "high", source: "ci:nightly", target: "shop.example.com" }),
    line("flare.answered", "web:altan", { key: "cert", note: "renewed on the 3rd", severity: "high" }),
  ]);
  assert.deepEqual(entries.map((entry) => entry.kind), ["flare-answered", "flare-lit"], "newest first");
  const [answered, lit] = entries;
  assert.deepEqual(answered?.item, { type: "flare", id: "cert", title: "Certificate expires" }, "the title of the report, not the key");
  assert.deepEqual(answered?.links, { flare: "cert" });
  assert.equal(answered?.text, "Flare answered by web:altan: renewed on the 3rd");
  assert.equal(lit?.text, "Flare lit by ci: Certificate expires, high");
  assert.deepEqual(lit?.detail, ["Target: shop.example.com", "Source: ci:nightly"]);
  assert.equal(lit?.tone, "wait");
});

test("a report of a flare that is lit already is not news; a worse one, or one after it closed, is", () => {
  const lit = (severity: string) => line("flare.lit", "ci", { key: "cert", title: "Certificate expires", severity, source: "ci" });
  const kinds = (lines: LedgerLine[]): string[] => activityOf(PROJECT, lines).map((entry) => `${entry.kind}:${entry.text.split(" by ")[0]}`);
  assert.deepEqual(kinds([lit("high"), lit("high"), lit("low")]), ["flare-lit:Flare lit"], "seen again, or less bad: no entry");
  assert.deepEqual(kinds([lit("medium"), lit("high")]), ["flare-lit:Flare raised at high", "flare-lit:Flare lit"], "a higher severity is news");
  assert.deepEqual(
    kinds([lit("high"), line("flare.accepted", "web:altan", { key: "cert", severity: "high" }), lit("high"), lit("critical")]),
    ["flare-lit:Flare lit again at critical", "flare-accepted:Flare accepted", "flare-lit:Flare lit"],
    "a report at the closed severity stays closed; a worse one lights it again",
  );
  assert.deepEqual(kinds([lit("high"), line("flare.cleared", "altan", { key: "cert" }), lit("low")]), ["flare-lit:Flare lit", "flare-cleared:Flare cleared", "flare-lit:Flare lit"], "after gone any report lights it");
});

test("flare notes are masked like every operator text, and a flare line with no key is left out", () => {
  const entries = activityOf(PROJECT, [line("flare.accepted", "web:altan", { key: "cert", severity: "low", note: "token sk-or-v1-abcdefghijklmnopqrstuvwxyz0123456789 is fine" }), line("flare.answered", "web:altan", { note: "no key", severity: "low" })]);
  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.text.includes("sk-or-v1-abcdefghijklmnopqrstuvwxyz0123456789"), false);
});

// --- a flare that a run reports (0.113.4) ---------------------------------------------------

const { putBlob } = await import("../src/core/store.ts");

let flareRuns = 0;

/** A completed run of the `daily` ritual whose result holds these flagged items. */
function reportRun(project: ReturnType<typeof openProject>, items: ReadonlyArray<{ key: string; title?: string; severity?: string; target?: string }>, resultSha?: string): string {
  flareRuns += 1;
  const run = `01JFLR${String(flareRuns).padStart(20, "0")}`;
  const filled = items.map((item) => ({ title: `Flare ${item.key}`, severity: "high", state: "needs-decision", ...item, flare: true }));
  const sha = resultSha ?? putBlob(project, `${JSON.stringify({ v: 1, status: "ok", summary: "s", items: filled })}\n`);
  appendLine(project, { who: "timer", type: "run.started", item: RITUAL, run });
  appendLine(project, { who: "timer", type: "run.completed", item: RITUAL, run, outcome: "complete", result_sha: sha });
  return run;
}

test("a flare that a run reports shows as a lit row, a repeat shows none, and a rise or a relight reads like an operator's", () => {
  const project = openProject("act-run-flare", { create: true });
  const first = reportRun(project, [{ key: "cert", title: "Certificate expires", severity: "high", target: "shop.example.com" }, { key: "disk", title: "Disk is full", severity: "medium" }]);
  const ctx = webContext("test");
  const rows = ctx.activity("act-run-flare");
  assert.deepEqual(rows.map((row) => row.kind), ["run-completed", "flare-lit", "flare-lit", "run-started"], "the run row first, then what it lit, in the order of the result");
  const [, cert, disk] = rows;
  assert.equal(cert?.text, "Flare lit by daily: Certificate expires, high");
  assert.equal(disk?.text, "Flare lit by daily: Disk is full, medium");
  assert.equal(cert?.tone, "wait");
  assert.deepEqual(cert?.item, { type: "flare", id: "cert", title: "Certificate expires" });
  assert.equal(cert?.links.flare, "cert");
  assert.equal(cert?.links.run, first);
  assert.deepEqual(cert?.detail, ["Target: shop.example.com"]);

  reportRun(project, [{ key: "cert", title: "Certificate expires", severity: "high" }]);
  assert.equal(ctx.activity("act-run-flare").filter((row) => row.kind === "flare-lit").length, 2, "a re-report of a lit flare is no row");

  reportRun(project, [{ key: "cert", title: "Certificate expires", severity: "critical" }]);
  assert.equal(ctx.activity("act-run-flare")[1]?.text, "Flare raised at critical by daily");

  appendLine(project, { who: "web:altan", type: "flare.accepted", key: "cert", severity: "critical" });
  reportRun(project, [{ key: "cert", title: "Certificate expires", severity: "critical" }]);
  assert.equal(ctx.activity("act-run-flare").filter((row) => row.kind === "flare-lit").length, 3, "a report at the closed severity stays closed");
  const lines = readLedger(project);
  const completed = lines.filter((entry) => entry.type === "run.completed");
  assert.equal(completed.length, 4);
});

test("a rise after an accept reads 'lit again', and the rows of a run follow the ritual and run filters", () => {
  const project = openProject("act-run-flare-2", { create: true });
  const run = reportRun(project, [{ key: "cert", severity: "medium" }]);
  appendLine(project, { who: "web:altan", type: "flare.accepted", key: "cert", severity: "medium" });
  reportRun(project, [{ key: "cert", severity: "high" }]);
  const ctx = webContext("test");
  const rows = ctx.activity("act-run-flare-2");
  assert.deepEqual(rows.map((row) => row.kind), ["run-completed", "flare-lit", "run-started", "flare-accepted", "run-completed", "flare-lit", "run-started"]);
  assert.equal(rows[1]?.text, "Flare lit again at high by daily");
  assert.equal(ctx.activity("act-run-flare-2", { run }).filter((row) => row.kind === "flare-lit").length, 1, "the run's own timeline holds its flare row");
  assert.equal(ctx.activity("act-run-flare-2", { ritual: "daily" }).filter((row) => row.kind === "flare-lit").length, 2);
  assert.equal(ctx.activity("act-run-flare-2", { finding: "cert" }).length, 0);
});

test("flare text from a run is plain text, masked, and a malformed or missing result gives no row and no error", () => {
  const project = openProject("act-run-flare-3", { create: true });
  const hostile = "<img src=x onerror=alert(1)> token sk-or-v1-abcdefghijklmnopqrstuvwxyz0123456789";
  reportRun(project, [{ key: "xss", title: hostile, severity: "low", target: hostile }]);
  reportRun(project, [], putBlob(project, "this is not json\n"));
  reportRun(project, [], "0".repeat(64));
  appendLine(project, { who: "timer", type: "run.started", item: RITUAL, run: "01JFLRNOBLOB0000000000000A" });
  appendLine(project, { who: "timer", type: "run.completed", item: RITUAL, run: "01JFLRNOBLOB0000000000000A", outcome: "complete" });
  const rows = webContext("test").activity("act-run-flare-3");
  const flareRows = rows.filter((row) => row.kind === "flare-lit");
  assert.equal(flareRows.length, 1);
  const shown = JSON.stringify(flareRows[0]);
  assert.equal(shown.includes("sk-or-v1-abcdefghijklmnopqrstuvwxyz0123456789"), false, "a secret in the title is masked");
  assert.ok(flareRows[0]?.text.includes("<img src=x onerror=alert(1)>"), "kept as plain text: the page renders it as text, never as HTML");
  assert.equal(rows.filter((row) => row.kind === "run-completed").length, 4, "every run still has its own row");
});

test("a window with no completed run reads no result, and one with a completed run gets the flare rows", () => {
  const project = openProject("act-run-flare-4", { create: true });
  reportRun(project, [{ key: "cert", severity: "high" }]);
  appendLine(project, { who: "web:altan", type: "run.acknowledged", item: RITUAL, run: "01JFLR00000000000000000001", note: "seen" });
  const ctx = webContext("test");
  assert.deepEqual(ctx.activity("act-run-flare-4", { limit: 1 }).map((row) => row.kind), ["ack-note"]);
  assert.deepEqual(ctx.activity("act-run-flare-4", { limit: 3 }).map((row) => row.kind), ["ack-note", "run-completed", "flare-lit"]);
});
