/**
 * The pending-starts registry (src/web/pending.ts, 0.89.0): the file, the
 * resolve rules and the activity entries of the starts the web asked for.
 * The state dir is a throwaway directory; logs and ledger lines are written
 * by hand in the shape the CLI and the writers produce.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import type { JsonValue, LedgerLine } from "../src/core/model.ts";
import { pendingActivity } from "../src/web/activity.ts";
import {
  CLOCK_SKEW_MS,
  KEEP_MS,
  STARTING_MS,
  logSince,
  markEnded,
  pendingFile,
  pendingStarts,
  readRegistry,
  recordPending,
  resolvePending,
  type PendingInput,
  type PendingRequest,
} from "../src/web/pending.ts";

const sandbox = mkdtempSync(join(tmpdir(), "darius-web-pending-"));
process.env.DARIUS_STATE_DIR = join(sandbox, "state");
process.env.DARIUS_CONFIG_DIR = join(sandbox, "config");

const PROJECT = "shop";
const PARENT = "01JPARENT0000000000000000A";
const CHILD = "01JCHILD0000000000000000B";
const NOW = Date.parse("2026-10-15T10:00:00.000Z");
const ASKED = "2026-10-15T09:58:00.000Z";
let counter = 0;

function logFile(text: string): string {
  counter += 1;
  const file = join(sandbox, `log-${String(counter)}.log`);
  writeFileSync(file, text);
  return file;
}

function request(extra: Partial<PendingRequest> = {}): PendingRequest {
  return { id: `01JREQ${String(counter).padStart(20, "0")}`, at: ASKED, who: "web:altan", kind: "follow-up", project: PROJECT, ritual: "daily", parent: PARENT, host: "host-a", log: "/nowhere", offset: 0, ...extra };
}

function ledgerLine(type: string, who: string, at: string, extra: { [key: string]: JsonValue } = {}): LedgerLine {
  counter += 1;
  return { v: 1, id: `01JLINE${String(counter).padStart(19, "0")}`, at, host: "host-a", who, project: PROJECT, type, ...extra };
}

function resolve(req: PendingRequest, lines: LedgerLine[] = [], output = "", ended?: number | null, now = NOW) {
  return resolvePending(req, { lines, output, ended, now });
}

const STARTED_TEXT = `darius run follow-up: started run ${CHILD} on host-a\n`;

test("started: a follow-up, a run now, a resume and a vigil check each resolve from the ledger line they asked for", () => {
  const followUp = resolve(request(), [ledgerLine("run.started", "web:altan", "2026-10-15T09:58:02.000Z", { item: "ritual/daily", run: CHILD, follow_up_of: PARENT })]);
  assert.deepEqual([followUp.state, followUp.run], ["started", CHILD]);
  const runNow = resolve(request({ kind: "run-now" }), [ledgerLine("run.started", "web:altan", "2026-10-15T09:58:02.000Z", { item: "ritual/daily", run: CHILD })]);
  assert.deepEqual([runNow.state, runNow.run], ["started", CHILD]);
  const resume = resolve(request({ kind: "resume" }), [ledgerLine("run.resumed", "web:altan", "2026-10-15T09:58:02.000Z", { item: "ritual/daily", run: PARENT, fresh: true })]);
  assert.deepEqual([resume.state, resume.run], ["started", PARENT]);
  const check = resolve(request({ kind: "vigil-check", vigil: "queue" }), [ledgerLine("vigil.swept", "web:altan", "2026-10-15T09:58:09.000Z", { item: "vigil/queue", outcome: "held" })]);
  assert.equal(check.state, "started");
});

test("a line that is not the answer does not resolve: another ritual, another who, an older time, another parent", () => {
  const stray = [
    ledgerLine("run.started", "web:altan", "2026-10-15T09:58:02.000Z", { item: "ritual/other", run: CHILD }),
    ledgerLine("run.started", "timer", "2026-10-15T09:58:03.000Z", { item: "ritual/daily", run: CHILD }),
    ledgerLine("run.started", "web:altan", "2026-10-15T09:00:00.000Z", { item: "ritual/daily", run: CHILD }),
    ledgerLine("run.started", "web:altan", "2026-10-15T09:58:04.000Z", { item: "ritual/daily", run: CHILD, follow_up_of: "01JOTHER0000000000000000Z" }),
  ];
  assert.equal(resolve(request({ kind: "run-now" }), stray).state, "starting");
  assert.equal(resolve(request({ kind: "follow-up" }), stray).state, "starting");
  assert.equal(resolve(request({ kind: "resume" }), stray).state, "starting");
  const sweep = ledgerLine("vigil.swept", "web:altan", "2026-10-15T09:58:03.000Z", { item: "vigil/other", outcome: "held" });
  assert.equal(resolve(request({ kind: "vigil-check", vigil: "queue" }), [sweep]).state, "starting");
  const dry = ledgerLine("vigil.swept", "web:altan", "2026-10-15T09:58:03.000Z", { item: "vigil/queue", outcome: "held", dry_run: true });
  assert.equal(resolve(request({ kind: "vigil-check", vigil: "queue" }), [dry]).state, "starting");
});

test("the who of a forwarded verb ends with 'via ssh' and still matches; the clock window is two minutes, for a forwarded start only", () => {
  const forwarded = ledgerLine("run.started", "web:altan via ssh", "2026-10-15T09:58:02.000Z", { item: "ritual/daily", run: CHILD, follow_up_of: PARENT });
  assert.equal(resolve(request(), [forwarded]).state, "started");
  const skewed = ledgerLine("run.started", "web:altan", new Date(Date.parse(ASKED) - CLOCK_SKEW_MS + 1000).toISOString(), { item: "ritual/daily", run: CHILD, follow_up_of: PARENT });
  assert.equal(resolvePending(request(), { lines: [skewed], output: "", ended: undefined, now: NOW, isForwarded: true }).state, "started", "inside the window");
  assert.equal(resolve(request(), [skewed]).state, "starting", "on this host a line before the request is not its answer");
  const early = ledgerLine("run.started", "web:altan", new Date(Date.parse(ASKED) - CLOCK_SKEW_MS - 1000).toISOString(), { item: "ritual/daily", run: CHILD, follow_up_of: PARENT });
  assert.equal(resolvePending(request(), { lines: [early], output: "", ended: undefined, now: NOW, isForwarded: true }).state, "starting", "outside the window");
});

test("a second request within two minutes is not answered by the first one's line", () => {
  const first = ledgerLine("vigil.swept", "web:altan", "2026-10-15T09:57:30.000Z", { item: "vigil/queue", outcome: "skipped", reason: "manual only" });
  const check = request({ kind: "vigil-check", vigil: "queue" });
  assert.equal(resolve(check, [first]).state, "starting");
  const runNow = ledgerLine("run.started", "web:altan", "2026-10-15T09:57:40.000Z", { item: "ritual/daily", run: CHILD });
  assert.equal(resolve(request({ kind: "run-now" }), [runNow]).state, "starting");
});

test("a long sentence is cut", () => {
  const refused = resolve(request(), [], `darius run follow-up: ${"x".repeat(2000)}\n`, 1);
  assert.equal([...(refused.sentence ?? "")].length, 300);
  assert.ok((refused.sentence ?? "").endsWith("…"));
});

test("the run id in the log's started line finds the run whatever its time or who", () => {
  const odd = ledgerLine("run.started", "someone-else", "2026-10-15T08:00:00.000Z", { item: "ritual/daily", run: CHILD });
  const found = resolve(request(), [odd], STARTED_TEXT);
  assert.deepEqual([found.state, found.run], ["started", CHILD]);
  assert.equal(resolve(request({ kind: "resume" }), [odd], "").state, "starting", "a resume is not found by a run start");
});

test("a forwarded start resolves from the log line: run-now, resume and follow-up are started with the logged run, though the ledger has no line yet", () => {
  const forwarded = (extra: Partial<PendingRequest>): PendingRequest => request({ host: "host-b", ...extra });
  const text = (verb: string): string => `warning: ssh banner\ndarius ${verb}: started run ${CHILD} on host-b\n`;
  const cases: Array<[PendingRequest, string]> = [
    [forwarded({ kind: "run-now" }), text("run now")],
    [forwarded({ kind: "resume" }), text("run resume")],
    [forwarded({ kind: "follow-up" }), text("run follow-up")],
  ];
  for (const [req, output] of cases) {
    const found = resolvePending(req, { lines: [], output, ended: undefined, now: NOW, isForwarded: true });
    assert.deepEqual([req.kind, found.state, found.run], [req.kind, "started", CHILD]);
    const ended = resolvePending(req, { lines: [], output, ended: 0, now: NOW, isForwarded: true });
    assert.deepEqual([req.kind, ended.state, ended.run], [req.kind, "started", CHILD], "the spawn ended after the start line");
  }
});

test("a vigil check keeps its rule: the started line of the log is not enough, the sweep line is", () => {
  const check = request({ kind: "vigil-check", vigil: "queue", host: "host-b" });
  const output = "darius vigil sweep: started queue on host-b\n";
  assert.equal(resolvePending(check, { lines: [], output, ended: undefined, now: NOW, isForwarded: true }).state, "starting");
  assert.equal(resolvePending(check, { lines: [], output, ended: 0, now: NOW, isForwarded: true }).state, "starting");
  const swept = ledgerLine("vigil.swept", "web:altan via ssh", "2026-10-15T09:58:20.000Z", { item: "vigil/queue", outcome: "held" });
  assert.equal(resolvePending(check, { lines: [swept], output, ended: undefined, now: NOW, isForwarded: true }).state, "started");
});

test("a start knows where it came from without parsing who", () => {
  assert.equal(resolve(request()).from, "web");
  assert.equal(resolve(request({ who: "timer" })).from, "other");
  assert.equal(resolve(request({ who: "web:altan via the proxy" })).who, "web:altan via the proxy", "the raw who stays");
});

test("refused: an ended spawn without a start line says the CLI's sentence; no sentence says the exit code; null says it could not start", () => {
  const said = resolve(request(), [], "darius run follow-up: the checkout is dirty\n", 1);
  assert.deepEqual([said.state, said.sentence], ["refused", "the checkout is dirty"]);
  assert.equal(resolve(request(), [], "", 3).sentence, "darius ended with exit code 3 and no message");
  assert.equal(resolve(request(), [], "", 0).sentence, "darius ended with exit code 0 and no message");
  assert.equal(resolve(request(), [], "", null).sentence, "darius could not be started");
});

test("a warning before the start line, or text with no end, stays starting; after 15 minutes it is lost with the last line", () => {
  assert.equal(resolve(request(), [], "warning: ssh login banner\n").state, "starting");
  assert.equal(resolve(request(), [], `warning: ssh login banner\n${STARTED_TEXT}`, 0).state, "started", "ended, but it said started: the log names the run");
  const old = Date.parse(ASKED) + STARTING_MS + 1000;
  const lost = resolve(request(), [], "warning: still waiting\n", undefined, old);
  assert.deepEqual([lost.state, lost.sentence], ["lost", "warning: still waiting"]);
  assert.equal(resolve(request(), [], "", undefined, old).sentence, undefined);
});

test("a late start beats lost", () => {
  const old = Date.parse(ASKED) + STARTING_MS + 60_000;
  const late = ledgerLine("run.started", "web:altan", new Date(old - 1000).toISOString(), { item: "ritual/daily", run: CHILD, follow_up_of: PARENT });
  assert.equal(resolve(request(), [], "", undefined, old).state, "lost");
  assert.equal(resolve(request(), [late], "", undefined, old).state, "started");
});

test("a skipped sweep is refused with its reason: from the ledger line, and from the --json result after a start line", () => {
  const check = request({ kind: "vigil-check", vigil: "queue" });
  const skipped = ledgerLine("vigil.swept", "web:altan", "2026-10-15T09:58:09.000Z", { item: "vigil/queue", outcome: "skipped", reason: "the vigil is heavy; pass --include-heavy" });
  const fromLedger = resolve(check, [skipped]);
  assert.deepEqual([fromLedger.state, fromLedger.sentence], ["refused", "the vigil is heavy; pass --include-heavy"]);
  const log = `darius vigil sweep: started queue on host-a\n${JSON.stringify({ ok: true, skipped: { detail: "manual only" } })}\n`;
  const fromLog = resolve(check, [], log, 0);
  assert.deepEqual([fromLog.state, fromLog.sentence], ["refused", "manual only"]);
  assert.equal(resolve(check, [], log).state, "starting", "no end yet: the sweep may still be going");
});

test("every sentence is masked", () => {
  const token = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";
  const refused = resolve(request(), [], `darius run follow-up: push failed with token=${token}\n`, 1);
  assert.ok(!(refused.sentence ?? "").includes(token), refused.sentence);
  assert.ok((refused.sentence ?? "").includes("[masked]"));
  const skipped = ledgerLine("vigil.swept", "web:altan", "2026-10-15T09:58:09.000Z", { item: "vigil/queue", outcome: "skipped", reason: `held by ${token}` });
  assert.ok(!(resolve(request({ kind: "vigil-check", vigil: "queue" }), [skipped]).sentence ?? "").includes(token));
  const lost = resolve(request(), [], `api_key=${token}\n`, undefined, Date.parse(ASKED) + STARTING_MS + 1000);
  assert.ok(!(lost.sentence ?? "").includes(token));
});

test("logSince reads the text after the offset, and the whole log when it is shorter than the offset", () => {
  const file = logFile("old text\nnew text\n");
  assert.equal(logSince(file, 9), "new text\n");
  assert.equal(logSince(file, 0), "old text\nnew text\n");
  assert.equal(logSince(file, 5000), "old text\nnew text\n", "the log was cut: read it whole");
  assert.equal(logSince(join(sandbox, "missing.log"), 0), "");
});

// --- the file ------------------------------------------------------------------------------

function input(extra: Partial<PendingInput> = {}): PendingInput {
  return { at: new Date().toISOString(), who: "web:altan", kind: "follow-up", project: PROJECT, parent: PARENT, host: "host-a", log: "/nowhere", offset: 0, ...extra };
}

test("the registry is <state dir>/web/pending-starts.jsonl, outside every project folder", () => {
  assert.equal(pendingFile(), join(process.env.DARIUS_STATE_DIR ?? "", "web", "pending-starts.jsonl"));
  assert.deepEqual(readRegistry().requests, [], "a missing file is empty");
  const source = readFileSync(new URL("../src/web/pending.ts", import.meta.url), "utf8");
  assert.ok(source.includes('"web", "pending-starts.jsonl"'));
});

test("recordPending appends a request, markEnded appends the end, and the reader joins them", () => {
  const id = recordPending(input({ ritual: "daily", offset: 12 }));
  markEnded(id, 7);
  const other = recordPending(input({ kind: "vigil-check", vigil: "queue" }));
  const registry = readRegistry();
  const mine = registry.requests.find((one) => one.id === id);
  assert.deepEqual([mine?.kind, mine?.ritual, mine?.offset, mine?.parent], ["follow-up", "daily", 12, PARENT]);
  assert.equal(registry.ended.get(id), 7);
  assert.equal(registry.ended.has(other), false);
  markEnded(other, null);
  assert.equal(readRegistry().ended.get(other), null);
  const rows = readFileSync(pendingFile(), "utf8").split("\n").filter((row) => row !== "");
  assert.ok(rows.every((row) => !Number.isNaN(JSON.parse(row).id?.length)));
});

test("a torn or foreign line is skipped when reading", () => {
  const id = recordPending(input());
  appendFileSync(pendingFile(), '{"id": "01JTORN", "kind": "follow-up", "at"\n');
  appendFileSync(pendingFile(), '{"id": "01JNOKIND", "at": "2026-10-15T10:00:00.000Z"}\n');
  assert.ok(readRegistry().requests.some((one) => one.id === id));
  assert.ok(readRegistry().requests.every((one) => one.id !== "01JNOKIND" && one.id !== "01JTORN"));
});

test("compaction on the next write drops requests older than 24 hours with their ended lines, and keeps the rest", () => {
  const oldAt = new Date(Date.now() - KEEP_MS - 60_000).toISOString();
  const stale = recordPending(input({ at: oldAt }));
  markEnded(stale, 0);
  const fresh = recordPending(input({ at: new Date(Date.now() - 60_000).toISOString() }));
  // The stale request was only old when the next write came; this write compacts.
  recordPending(input());
  const registry = readRegistry();
  assert.ok(!registry.requests.some((one) => one.id === stale), "the stale request is gone");
  assert.equal(registry.ended.has(stale), false, "and its end");
  assert.ok(registry.requests.some((one) => one.id === fresh), "a young request stays");
  assert.ok(!readFileSync(pendingFile(), "utf8").includes(stale));
  assert.equal(existsSync(`${pendingFile()}.lock`), false, "the lock is released");
});

test("pendingStarts lists the last 24 hours, newest first, for one project or all, and resolves against the ledger view", () => {
  const dir = mkdtempSync(join(sandbox, "scope-"));
  process.env.DARIUS_STATE_DIR = join(dir, "state");
  try {
    const log = logFile(STARTED_TEXT);
    // Times relative to the clock: a write compacts requests older than 24 hours by the real time.
    const base = Date.now() - 60 * 60_000;
    const at = (offsetMs: number): string => new Date(base + offsetMs).toISOString();
    const first = recordPending(input({ project: "alpha", at: at(0), log: logFile(""), ritual: "daily" }));
    const second = recordPending(input({ project: "beta", at: at(30 * 60_000), log, ritual: "daily" }));
    const views: string[] = [];
    const view = (name: string): LedgerLine[] => {
      views.push(name);
      return name === "beta" ? [{ ...ledgerLine("run.started", "web:altan", at(30 * 60_000 + 5_000), { item: "ritual/daily", run: CHILD, follow_up_of: PARENT }), project: "beta" }] : [];
    };
    const all = pendingStarts(null, view, new Date(at(60 * 60_000)));
    assert.deepEqual(all.map((one) => [one.id, one.state]), [[second, "started"], [first, "lost"]]);
    assert.deepEqual(pendingStarts("alpha", view, new Date(at(60 * 60_000))).map((one) => one.id), [first]);
    assert.deepEqual(pendingStarts("alpha", view, new Date(at(49 * 60 * 60_000))), [], "older than 24 hours");
    assert.deepEqual(pendingStarts("nope", view), []);
  } finally {
    process.env.DARIUS_STATE_DIR = join(sandbox, "state");
  }
});

test("several processes write while another compacts: no line is lost", async () => {
  const dir = mkdtempSync(join(sandbox, "writers-"));
  const state = join(dir, "state");
  mkdirSync(state, { recursive: true });
  const script = join(dir, "writer.mjs");
  const url = pathToFileURL(join(import.meta.dirname, "../src/web/pending.ts")).href;
  writeFileSync(
    script,
    [
      `import { recordPending, markEnded } from ${JSON.stringify(url)};`,
      "const wait = Number(process.env.START_AT) - Date.now();",
      "if (wait > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, wait);",
      "for (let n = 0; n < 12; n += 1) {",
      '  const old = n % 3 === 0 ? new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString() : new Date().toISOString();',
      '  const id = recordPending({ at: old, who: "web:altan", kind: "follow-up", project: "p", parent: process.env.TAG + "-" + n, host: "h", log: "/x", offset: 0 });',
      "  markEnded(id, 0);",
      "}",
    ].join("\n"),
  );
  const startAt = String(Date.now() + 1500);
  const exits = await Promise.all(
    ["a", "b", "c"].map(
      (tag) =>
        new Promise<number | null>((done, reject) => {
          const child = spawn(process.execPath, ["--no-warnings", script], { env: { ...process.env, DARIUS_STATE_DIR: state, START_AT: startAt, TAG: tag }, stdio: ["ignore", "ignore", "inherit"] });
          child.on("error", reject);
          child.on("exit", (code) => {
            done(code);
          });
        }),
    ),
  );
  assert.deepEqual(exits, [0, 0, 0]);
  const rows = readFileSync(join(state, "web", "pending-starts.jsonl"), "utf8").split("\n").filter((row) => row !== "");
  for (const row of rows) JSON.parse(row);
  const requests = rows.map((row) => JSON.parse(row)).filter((row) => "kind" in row);
  // Every young request (n % 3 != 0) of every writer is there; an old one may be compacted away, but never a young one.
  for (const tag of ["a", "b", "c"]) {
    for (let n = 0; n < 12; n += 1) {
      if (n % 3 === 0) continue;
      assert.ok(requests.some((row) => row.parent === `${tag}-${String(n)}`), `${tag}-${String(n)} survived`);
    }
  }
  const ids = new Set(requests.map((row) => row.id));
  assert.equal(ids.size, requests.length, "no duplicate request");
  assert.equal(existsSync(join(state, "web", "pending-starts.jsonl.lock")), false);
});

// --- activity ------------------------------------------------------------------------------

test("pendingActivity: starting, refused and lost make entries; a started one does not; filters apply", () => {
  const starts = [
    resolve(request({ id: "01JA", kind: "follow-up" })),
    resolve(request({ id: "01JB", kind: "run-now", parent: undefined, at: "2026-10-15T09:50:00.000Z" }), [], "darius run now: the ritual is paused\n", 1),
    resolve(request({ id: "01JC", kind: "vigil-check", vigil: "queue", ritual: undefined, parent: undefined, at: "2026-10-15T09:40:00.000Z" }), [], "noise\n", undefined, NOW + STARTING_MS),
    resolve(request({ id: "01JD" }), [ledgerLine("run.started", "web:altan", "2026-10-15T09:58:02.000Z", { item: "ritual/daily", run: CHILD, follow_up_of: PARENT })]),
  ];
  const entries = pendingActivity(starts, { titleOf: (type, id) => (type === "ritual" && id === "daily" ? "Daily" : undefined) });
  assert.deepEqual(entries.map((entry) => entry.kind), ["start-requested", "start-refused", "start-lost"].toSorted((left, right) => entries.findIndex((one) => one.kind === left) - entries.findIndex((one) => one.kind === right)));
  assert.equal(entries.length, 3);
  const byKind = new Map(entries.map((entry) => [entry.kind, entry]));
  assert.equal(byKind.get("start-requested")?.text, "Follow-up of 01JPARENT0000000000000000A asked by web:altan on host-a: starting");
  assert.equal(byKind.get("start-requested")?.tone, "wait");
  assert.equal(byKind.get("start-refused")?.text, "Run now of daily refused for web:altan: the ritual is paused");
  assert.equal(byKind.get("start-refused")?.tone, "bad");
  assert.equal(byKind.get("start-refused")?.item.type, "ritual");
  assert.ok(byKind.get("start-lost")?.text.endsWith("no start seen after 15 minutes; last line: noise"));
  assert.equal(byKind.get("start-lost")?.item.type, "vigil");
  assert.equal(byKind.get("start-requested")?.run, PARENT);
  assert.ok(entries.every((entry, index) => index === 0 || (entries[index - 1]?.at ?? "") >= entry.at), "newest first");
  assert.equal(pendingActivity(starts, { vigil: "queue" }).length, 1);
  assert.equal(pendingActivity(starts, { run: PARENT }).length, 1);
  assert.equal(pendingActivity(starts, { finding: "x" }).length, 0);
  assert.equal(pendingActivity(starts, { since: "2026-10-15T09:55:00.000Z" }).length, 1);
});

test("WebContext.pending and WebContext.activity show a start that has no ledger line yet, and drop it from activity once it started", async () => {
  const { appendLine } = await import("../src/core/ledger.ts");
  const { openProject } = await import("../src/core/store.ts");
  const { webContext } = await import("../src/web/context.ts");
  const store = openProject("ctx-shop", { create: true });
  appendLine(store, { who: "timer", type: "run.started", item: "ritual/daily", run: PARENT });
  const id = recordPending(input({ project: "ctx-shop", ritual: "daily", log: logFile(""), at: new Date(Date.now() - 1000).toISOString() }));
  const ctx = webContext("test");
  assert.deepEqual(ctx.pending("ctx-shop").map((one) => [one.id, one.state]), [[id, "starting"]]);
  assert.deepEqual(ctx.pending("nope"), []);
  assert.ok(ctx.pending(null).some((one) => one.id === id));
  const waiting = ctx.activity("ctx-shop").filter((entry) => entry.kind === "start-requested");
  assert.equal(waiting.length, 1);
  assert.equal(waiting[0]?.project, "ctx-shop");
  assert.equal(ctx.activity("ctx-shop", { ritual: "other" }).filter((entry) => entry.kind === "start-requested").length, 0);

  appendLine(store, { who: "web:altan", type: "run.started", item: "ritual/daily", run: CHILD, follow_up_of: PARENT });
  assert.deepEqual(ctx.pending("ctx-shop").map((one) => [one.id, one.state, one.run]), [[id, "started", CHILD]]);
  assert.equal(ctx.activity("ctx-shop").filter((entry) => entry.kind === "start-requested").length, 0, "the ledger line is its entry now");
  assert.ok(ctx.activity("ctx-shop").some((entry) => entry.kind === "follow-up-started"));
});
