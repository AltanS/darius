/**
 * Done lately and the Now labels of the Overview (0.90.0): `doneLately` in
 * web/app/lib/home.ts turns the status, the pending starts and the activity
 * entries into rows, newest first, with the starts that show no run on top.
 * Pure data in, plain data out: the same input gives the same rows.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import type { HostStatus, PendingStart, ProjectActivityEntry, ProjectStatus, RitualRow, RunRow, VigilRow } from "../src/web/api.ts";
import { doneLately, homeView, type DonePending, type DoneReceipt, type DoneRow } from "../web/app/lib/home.ts";
import { pendingText, receiptText, NO_FACTS } from "../web/app/lib/receipt.ts";

const NOW = Date.parse("2026-10-15T09:30:00.000Z");
const TODAY = "2026-10-15";

function ritual(slug: string, extra: Partial<RitualRow> = {}): RitualRow {
  return {
    slug,
    title: `Title of ${slug}`,
    lifecycle: "active",
    mode: "report",
    cadence: "1d",
    nextDue: "2026-10-16",
    isDue: false,
    overdueDays: 0,
    skill: slug,
    profile: null,
    host: null,
    lastCompleted: null,
    heldRun: null,
    openRun: null,
    failedToday: null,
    source: null,
    defCommit: null,
    defHost: null,
    defAt: null,
    defDirty: false,
    at: null,
    zone: null,
    args: null,
    timeout: null,
    nextDueAt: "2026-10-16T05:00:00.000Z",
    warnings: [],
    ...extra,
  };
}

function vigil(slug: string): VigilRow {
  return { slug, title: `Vigil ${slug}`, state: "armed", verdict: null, flagged: false, lastOutcome: null, due: null, until: null, lastFailure: null, failKind: null, paused: false, pausedUntil: null };
}

function run(id: string, item: string, startedAt: string, extra: Partial<RunRow> = {}): RunRow {
  return { run: id, item, phase: "closed", outcome: "complete", startedAt, endedAt: startedAt, who: "timer", questions: [], findingsSha: null, result: null, acknowledged: null, followUpOf: null, startedBy: "timer", ackKind: null, ...extra };
}

function project(name: string, rituals: RitualRow[], runs: RunRow[] = [], vigils: VigilRow[] = []): ProjectStatus {
  return { name, icon: null, checkout: null, maxMode: null, lastSync: null, rituals, runs, vigils, milestones: [], milestonesArchived: 0, findings: { needsYou: 0, open: 0 }, error: null };
}

function status(projects: ProjectStatus[]): HostStatus {
  return { host: "testhost", version: "9.9.9", generatedAt: new Date(NOW).toISOString(), today: TODAY, utcOffset: 0, profiles: [], projects };
}

function entry(kind: ProjectActivityEntry["kind"], at: string, extra: Partial<ProjectActivityEntry> = {}): ProjectActivityEntry {
  const slug = extra.links?.ritual ?? "report";
  return {
    project: "shop",
    at,
    who: "web:altan",
    actor: "web",
    kind,
    item: { type: "run", id: extra.run ?? "01RUN", title: `Title of ${slug}` },
    text: "",
    links: { ritual: slug, run: extra.run ?? "01RUN" },
    tone: "ok",
    ...extra,
  };
}

function start(extra: Partial<PendingStart> = {}): PendingStart {
  return { id: "p1", at: "2026-10-15T09:12:00.000Z", who: "web:altan", kind: "follow-up", project: "shop", ritual: "report", parent: "01PARENT", host: "host-b", state: "starting", ...extra };
}

const REPORT = ritual("report");
const SHOP = project("shop", [REPORT]);

const receipts = (rows: readonly DoneRow[]): DoneReceipt[] => rows.filter((row) => row.kind === "receipt");
const pendings = (rows: readonly DoneRow[]): DonePending[] => rows.filter((row) => row.kind === "pending");

test("an answer reads who, when, how many answers wait and when the next run is", () => {
  const answered = entry("ack-answered", "2026-10-15T09:12:00.000Z", { text: "Answered by web:altan", detail: ["Q1: yes", "Q2: no"], run: "01ASKED" });
  const [row] = receipts(doneLately(status([SHOP]), [], [answered], NOW));
  assert.ok(row);
  assert.match(row.text, /^Answered by web:altan at 09:12, 2 answers wait for the next run, /u);
  assert.match(row.text, /16 Oct 05:00/u, "the next run of the ritual");
  assert.equal(row.href, "/w/shop/runs/01ASKED", "the row opens the answered run");
  assert.deepEqual(row.links, [{ text: "History", href: "/w/shop/rituals/report" }]);
  assert.equal(row.title, "Title of report");
});

test("an answer on a ritual darius does not run (no skill, mode off) still leaves a receipt", () => {
  const manual = ritual("hand", { mode: "off", skill: null });
  const answered = entry("ack-answered", "2026-10-15T08:00:00.000Z", { text: "Answered by cli", who: "cli", actor: "cli", detail: ["Q1: ok"], links: { ritual: "hand", run: "01HAND" } });
  const [row] = receipts(doneLately(status([project("shop", [manual])]), [], [answered], NOW));
  assert.ok(row);
  assert.equal(row.manual, true);
  assert.match(row.text, /^Answered by cli at 08:00, 1 answer waits for the next run/u);
});

test("close dismissals of one ritual by one person read as one row: Dismissed 3 asks", () => {
  const dismissals = ["09:00:00", "09:00:20", "09:00:40"].map((time, index) => entry("ack-dismissed", `2026-10-15T${time}.000Z`, { text: `Dismissed by web:altan`, tone: "idle", run: `01ASK${index}` }));
  const lone = entry("ack-dismissed", "2026-10-15T07:00:00.000Z", { text: "Dismissed by web:altan", tone: "idle", run: "01LONE" });
  const rows = receipts(doneLately(status([SHOP]), [], [...dismissals, lone], NOW));
  assert.equal(rows.length, 2);
  assert.match(rows[0]?.text ?? "", /^Dismissed 3 asks by web:altan at 09:00/u);
  assert.match(rows[1]?.text ?? "", /^Dismissed by web:altan at 07:00/u);
});

test("a note on a failed run leaves a receipt with the note", () => {
  const noted = entry("ack-note", "2026-10-15T09:00:00.000Z", { text: "Noted by web:altan: disk was full", tone: "idle" });
  const [row] = receipts(doneLately(status([SHOP]), [], [noted], NOW));
  assert.equal(row?.text, "Noted by web:altan at 09:00: disk was full");
});

test("a follow-up says where it runs, then that it is done and how many things changed", () => {
  const followed = entry("follow-up-started", "2026-10-15T09:12:00.000Z", { text: "Follow-up of 01PARENT started by web:altan: approved Q2", run: "01CHILD", item: { type: "run", id: "01CHILD", title: "Title of report" } });
  const started = start({ state: "started", run: "01CHILD" });
  const running = project("shop", [REPORT], [run("01CHILD", "ritual/report", "2026-10-15T09:12:00.000Z", { phase: "running", outcome: null, endedAt: null, followUpOf: "01PARENT" })]);
  assert.equal(receipts(doneLately(status([running]), [started], [followed], NOW))[0]?.text, "Follow-up of 01PARENT started by web:altan at 09:12: approved Q2, running on host-b");
  const finished = project("shop", [REPORT], [run("01CHILD", "ritual/report", "2026-10-15T09:12:00.000Z", { followUpOf: "01PARENT", result: { status: "ok", questions: 0, open: { critical: 0, high: 0, medium: 0, low: 0, info: 0 }, fixed: 2 } })]);
  assert.equal(receipts(doneLately(status([finished]), [started], [followed], NOW))[0]?.text, "Follow-up of 01PARENT started by web:altan at 09:12: approved Q2, done, 2 changed");
  assert.equal(pendings(doneLately(status([finished]), [started], [followed], NOW)).length, 0, "a start that has its run is not shown twice");
});

test("a run started by Send and run now joins the answer's receipt and shows once", () => {
  const answered = entry("ack-answered", "2026-10-15T09:12:00.000Z", { text: "Answered by web:altan", detail: ["Q1: yes"], run: "01ASKED" });
  const started = entry("run-started", "2026-10-15T09:12:03.000Z", { text: "Run started by web:altan", detail: ["Read 1 answer"], run: "01NEW", tone: "run" });
  const rows = doneLately(status([SHOP]), [], [started, answered], NOW);
  const found = receipts(rows);
  assert.equal(found.length, 1);
  assert.equal(found[0]?.text, "Answered by web:altan at 09:12, run 01NEW started with it");
  assert.deepEqual(found[0]?.links.map((link) => link.href), ["/w/shop/rituals/report", "/w/shop/runs/01NEW"]);
});

test("a run the web started after an answer, apart from the answer, says so", () => {
  const started = entry("run-started", "2026-10-15T09:12:03.000Z", { text: "Run started by web:altan", detail: ["Read 1 answer"], run: "01NEW", tone: "run" });
  assert.equal(receipts(doneLately(status([SHOP]), [], [started], NOW))[0]?.text, "Run started by web:altan at 09:12, after your answer");
});

test("a run that read a dismissal, started by the timer or the CLI, is not a decision and shows no row", () => {
  const byTimer = entry("run-started", "2026-10-15T09:00:00.000Z", { text: "Run started by timer", who: "timer", actor: "timer", detail: ["Read 1 answer"], run: "01TIMED" });
  const byCli = entry("run-started", "2026-10-15T09:01:00.000Z", { text: "Run started by altan", who: "altan", actor: "cli", detail: ["Read 1 answer"], run: "01HAND" });
  assert.deepEqual(receipts(doneLately(status([SHOP]), [], [byTimer, byCli], NOW)), []);
});

test("a run id in a sentence shows its last eight characters", () => {
  const followed = entry("follow-up-started", "2026-10-15T09:12:00.000Z", { text: "Follow-up of 01M4ZKEABA7FKHCP8XSJBSBDCF started by web:altan", run: "01CHILD" });
  assert.equal(receipts(doneLately(status([SHOP]), [], [followed], NOW))[0]?.text, "Follow-up of SJBSBDCF started by web:altan at 09:12");
});

test("a check and a finding close by a person show; a check by the timer does not", () => {
  const checkedByPerson = entry("vigil-swept", "2026-10-15T09:00:00.000Z", { text: "Checked by web:altan: held", item: { type: "vigil", id: "soak", title: "Vigil soak" }, links: { vigil: "soak" }, run: undefined });
  const checkedByTimer = entry("vigil-swept", "2026-10-15T08:00:00.000Z", { text: "Checked by timer: held", who: "timer", actor: "timer", item: { type: "vigil", id: "soak", title: "Vigil soak" }, links: { vigil: "soak" }, run: undefined });
  const closed = entry("finding-closed", "2026-10-15T07:00:00.000Z", { text: "Finding abc closed by web:altan: fixed", item: { type: "finding", id: "abc", title: "abc" }, links: { finding: "abc" }, run: undefined, tone: "idle" });
  const rows = receipts(doneLately(status([project("shop", [REPORT], [], [vigil("soak")])]), [], [checkedByTimer, checkedByPerson, closed], NOW));
  assert.deepEqual(rows.map((row) => row.text), ["Checked by web:altan at 09:00: held", "Finding abc closed by web:altan at 07:00: fixed"]);
  assert.equal(rows[0]?.item, "vigil");
  assert.equal(rows[0]?.href, "/w/shop/vigils/soak");
  assert.equal(rows[1]?.href, "/w/shop/findings");
});

test("a start without a run sits on top with its sentence, whatever the other rows say", () => {
  const answered = entry("ack-answered", "2026-10-15T09:20:00.000Z", { text: "Answered by web:altan", detail: ["Q1: y"] });
  const rows = doneLately(status([SHOP]), [start({ at: "2026-10-15T09:12:00.000Z" })], [answered], NOW);
  assert.deepEqual(rows.map((row) => row.kind), ["pending", "receipt"]);
  const top = pendings(rows)[0];
  assert.equal(top?.text, "Starting a follow-up on host-b, asked 09:12 by web:altan");
  assert.deepEqual(top?.word, { tone: "run", label: "Starting" });
  assert.equal(top?.retry, null);
});

test("a refused or lost start shows the sentence and a Try again link to the parent run", () => {
  const refused = start({ id: "r", state: "refused", sentence: "darius run follow-up: run is still running" });
  const lost = start({ id: "l", at: "2026-10-15T08:00:00.000Z", state: "lost", sentence: "waiting for a slot", kind: "run-now" });
  const rows = pendings(doneLately(status([SHOP]), [lost, refused], [], NOW));
  assert.deepEqual(rows.map((row) => row.id), ["pending-r", "pending-l"], "newest first");
  assert.equal(rows[0]?.text, "A follow-up was not started: darius run follow-up: run is still running. Asked 09:12 by web:altan.");
  assert.deepEqual(rows[0]?.retry, { text: "Try again", href: "/w/shop/runs/01PARENT" });
  assert.deepEqual(rows[0]?.word, { tone: "bad", label: "Not started" });
  assert.equal(rows[1]?.text, "A run on host-b, asked 08:00 by web:altan, shows no start after 15 minutes. Last line: waiting for a slot");
  const check = pendings(doneLately(status([project("shop", [REPORT], [], [vigil("soak")])]), [start({ kind: "vigil-check", vigil: "soak", ritual: undefined, parent: undefined, state: "refused", sentence: "no slot" })], [], NOW))[0];
  assert.equal(check?.retry?.href, "/w/shop/vigils/soak");
  assert.equal(check?.item, "vigil");
});

test("only the last 24 hours show, newest first", () => {
  const old = entry("ack-note", "2026-10-14T09:00:00.000Z", { text: "Noted by web:altan: old", tone: "idle" });
  const edge = entry("ack-note", "2026-10-14T09:31:00.000Z", { text: "Noted by web:altan: edge", tone: "idle" });
  const fresh = entry("ack-note", "2026-10-15T09:00:00.000Z", { text: "Noted by web:altan: fresh", tone: "idle" });
  const rows = receipts(doneLately(status([SHOP]), [], [fresh, old, edge], NOW));
  assert.deepEqual(rows.map((row) => row.text.split(": ")[1]), ["fresh", "edge"]);
  assert.equal(pendings(doneLately(status([SHOP]), [start({ at: "2026-10-14T09:00:00.000Z" })], [], NOW)).length, 0);
});

test("the self-test workspace is left out unless the scope shows it, and a workspace scope keeps only its own rows", () => {
  const selftest = project("darius-selftest", [REPORT]);
  const note = (name: string) => entry("ack-note", "2026-10-15T09:00:00.000Z", { project: name, text: "Noted by web:altan: x", tone: "idle" });
  const all = status([SHOP, selftest]);
  assert.deepEqual(receipts(doneLately(all, [], [note("shop"), note("darius-selftest")], NOW)).map((row) => row.project), ["shop"]);
  assert.deepEqual(receipts(doneLately(all, [], [note("shop"), note("darius-selftest")], NOW, { scope: { workspace: "darius-selftest", includeSelftest: false } })).map((row) => row.project), ["darius-selftest"]);
});

test("a finished run keeps its card; a decision on that run replaces the card with the receipt", () => {
  const finished = run("01DONE", "ritual/report", "2026-10-15T05:00:00.000Z");
  const withRun = project("shop", [REPORT], [finished]);
  assert.deepEqual(doneLately(status([withRun]), [], [], NOW).map((row) => row.kind), ["run"]);
  const dismissed = entry("ack-dismissed", "2026-10-15T09:00:00.000Z", { text: "Dismissed by web:altan", tone: "idle", run: "01DONE" });
  assert.deepEqual(doneLately(status([withRun]), [], [dismissed], NOW).map((row) => row.kind), ["receipt"]);
});

test("a receipt depends on its inputs alone: the same input gives the same rows", () => {
  const answered = entry("ack-answered", "2026-10-15T09:12:00.000Z", { text: "Answered by web:altan", detail: ["Q1: yes"] });
  const input = [status([SHOP]), [start()], [answered], NOW] as const;
  assert.deepEqual(doneLately(...input), doneLately(...input));
});

test("receiptText and pendingText name no one but the ledger's who", () => {
  const answered = entry("ack-answered", "2026-10-15T09:12:00.000Z", { text: "Answered by web:altan; note: later", detail: [] });
  assert.equal(receiptText(answered, NO_FACTS, { offset: 120 }), "Answered by web:altan at 11:12; note: later");
  assert.equal(pendingText(start({ kind: "resume" }), { offset: 0 }), "Starting a resume on host-b, asked 09:12 by web:altan");
});

// --- Now ----------------------------------------------------------------------------------

test("Now labels a follow-up with its parent run and a run an answer started with the answered run", () => {
  const follow = run("01FOLLOWCHILD0000000000AA", "ritual/report", "2026-10-15T09:20:00.000Z", { phase: "running", outcome: null, endedAt: null, followUpOf: "01PARENT0000000000000000AA", who: "web:altan", startedBy: "web" });
  const after = run("01AFTERANSWER00000000000AA", "ritual/report", "2026-10-15T09:25:00.000Z", { phase: "running", outcome: null, endedAt: null, who: "web:altan", startedBy: "web" });
  const answered = entry("ack-answered", "2026-10-15T09:24:50.000Z", { text: "Answered by web:altan", detail: ["Q1: y"], run: "01ASKED" });
  const started = entry("run-started", "2026-10-15T09:25:00.000Z", { text: "Run started by web:altan", detail: ["Read 1 answer"], run: after.run, tone: "run" });
  const view = homeView(status([project("shop", [REPORT], [follow, after])]), () => null, undefined, { activity: [started, answered], pending: [] });
  const notes = Object.fromEntries(view.now.map((row) => [row.id, row.note]));
  assert.deepEqual(notes[follow.run], { text: "follow-up of 000000AA", href: "/w/shop/runs/01PARENT0000000000000000AA" });
  assert.deepEqual(notes[after.run], { text: "after your answer", href: "/w/shop/runs/01ASKED" });
});

test("homeView without a feed has an empty Done lately and no Now notes", () => {
  const running = run("01RUNNING", "ritual/report", "2026-10-15T09:20:00.000Z", { phase: "running", outcome: null, endedAt: null });
  const view = homeView(status([project("shop", [REPORT], [running])]), () => null);
  assert.deepEqual(view.doneLately, []);
  assert.equal(view.now[0]?.note, null);
});

// --- one row per run, the sentence of a refusal, a skewed clock ----------------------------

test("a finished follow-up and a finished run-now run have no card besides their receipt", () => {
  const parentRun = run("01PARENT", "ritual/report", "2026-10-15T05:00:00.000Z");
  const childRun = run("01CHILD", "ritual/report", "2026-10-15T09:12:00.000Z", { followUpOf: "01PARENT" });
  const followed = entry("follow-up-started", "2026-10-15T09:12:00.000Z", { text: "Follow-up of 01PARENT started by web:altan", run: "01CHILD" });
  assert.deepEqual(doneLately(status([project("shop", [REPORT], [childRun, parentRun])]), [], [followed], NOW).map((row) => row.kind), ["receipt"], "the child is the newest run, and its receipt stands for it");
  assert.deepEqual(doneLately(status([project("shop", [REPORT], [childRun, parentRun])]), [], [], NOW).map((row) => row.kind), ["run"], "without the receipt the card shows");
  const answered = entry("ack-answered", "2026-10-15T09:12:00.000Z", { text: "Answered by web:altan", detail: ["Q1: y"], run: "01ASKED" });
  const started = entry("run-started", "2026-10-15T09:12:03.000Z", { text: "Run started by web:altan", detail: ["Read 1 answer"], run: "01NEW", tone: "run" });
  const newest = run("01NEW", "ritual/report", "2026-10-15T09:12:03.000Z");
  const rows = doneLately(status([project("shop", [REPORT], [newest])]), [], [started, answered], NOW);
  assert.deepEqual(rows.map((row) => row.kind), ["receipt"], "the run the answer started shows once, in the answer's receipt");
});

test("a refusal sentence that ends in a period does not get a second one", () => {
  const refused = start({ state: "refused", sentence: "run 01PARENT is still running." });
  assert.equal(pendings(doneLately(status([SHOP]), [refused], [], NOW))[0]?.text, "A follow-up was not started: run 01PARENT is still running. Asked 09:12 by web:altan.");
});

test("a run whose start line was written by a clock a little behind still counts as the reader of the answer", () => {
  const answered = entry("ack-answered", "2026-10-15T09:12:00.000Z", { text: "Answered by web:altan", detail: ["Q1: y"], run: "01ASKED" });
  const started = entry("run-started", "2026-10-15T09:11:50.000Z", { text: "Run started by web:altan", detail: ["Read 1 answer"], run: "01NEW", tone: "run" });
  assert.equal(receipts(doneLately(status([SHOP]), [], [started, answered], NOW))[0]?.text, "Answered by web:altan at 09:12, run 01NEW started with it");
  const running = run("01NEW", "ritual/report", "2026-10-15T09:11:50.000Z", { phase: "running", outcome: null, endedAt: null, who: "web:altan", startedBy: "web" });
  const view = homeView(status([project("shop", [REPORT], [running])]), () => null, undefined, { activity: [started, answered], pending: [] });
  assert.deepEqual(view.now[0]?.note, { text: "after your answer", href: "/w/shop/runs/01ASKED" });
});
