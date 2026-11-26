/**
 * The sentences built from variables (0.141.0): the sentence at the top of a
 * machine page in each state, what needs attention there, the state split of
 * the Machines page, the Overview line and Places, and the status sentence of
 * a workspace. Pure: web/app/lib/machines.ts and web/app/lib/fleet.ts.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import type { FleetDjinn, FleetWorkspace, HostOpenRun, PeerHost } from "../src/web/api.ts";

const machines = await import("../web/app/lib/machines.ts");
const fleet = await import("../web/app/lib/fleet.ts");
const { sentenceText } = await import("../web/app/lib/sentence.ts");

type Facts = ReturnType<typeof machines.machineFacts>;

const AGO = (iso: string): string => `<${iso}>`;

function facts(change: Partial<Facts> = {}): Facts {
  return {
    name: "host-b",
    self: false,
    state: "online",
    reason: null,
    version: "1.0.0",
    differs: false,
    uptimeSeconds: 3600,
    load: [0.1, 0.2, 0.3],
    boxCheck: null,
    lastSeen: "T-seen",
    backup: null,
    retired: false,
    runs: ["infra-notes", "archive-2025"],
    copies: ["demo-shop"],
    openRuns: [],
    rituals: 2,
    ritualsLate: 0,
    lastRitualAt: "T-ritual",
    ...change,
  };
}

function say(one: Facts): string {
  return sentenceText(machines.machineSentence(one), AGO);
}

test("machine sentence: short sentences, one idea each: what it runs and starts, then what runs now", () => {
  assert.equal(say(facts()), "host-b runs 2 workspaces and starts 2 rituals for them. Nothing is running now; the last run started <T-ritual>.");
  assert.equal(say(facts({ runs: ["a"], rituals: 3 })), "host-b runs 1 workspace and starts 3 rituals for it. Nothing is running now; the last run started <T-ritual>.");
  assert.equal(say(facts({ rituals: 0, lastRitualAt: null })), "host-b runs 2 workspaces; darius starts no ritual for them. Nothing is running now.");
  assert.equal(say(facts({ runs: [], rituals: 0, lastRitualAt: null })), "host-b runs no workspace. Nothing is running now.");
  assert.doesNotMatch(say(facts()), /djinn|copy|online/u, "no djinn, the copies are under the table, the state word says online");
});

test("machine sentence: a machine that did not answer says why and how old its last activity is, and says nothing of open runs", () => {
  const text = say(facts({ name: "host-c", state: "unreachable", reason: "connection refused", openRuns: null, runs: ["status-page"], copies: [], rituals: 1, lastRitualAt: "T-r" }));
  assert.equal(text, "host-c did not answer (connection refused). Its last activity is <T-seen> old. host-c runs 1 workspace and starts 1 ritual for it. The last run started <T-r>.");
});

test("machine sentence: offline, checking and not asked, with and without activity", () => {
  assert.equal(say(facts({ state: "offline", reason: "timeout", openRuns: null, runs: [], rituals: 0, lastRitualAt: null })), "host-b did not answer (timeout). Its last activity is <T-seen> old. host-b runs no workspace.");
  assert.equal(say(facts({ state: "offline", reason: "timeout", lastSeen: null, openRuns: null, runs: [], rituals: 0, lastRitualAt: null })), "host-b did not answer (timeout). darius has seen no activity of it. host-b runs no workspace.");
  assert.equal(say(facts({ state: "checking", openRuns: null, lastSeen: null, runs: [], rituals: 0, lastRitualAt: null })), "darius is still asking host-b. darius has seen no activity of it. host-b runs no workspace.");
  assert.equal(say(facts({ state: null, openRuns: null, runs: [], rituals: 0, lastRitualAt: null })), "darius did not ask host-b. Its last activity was <T-seen>. host-b runs no workspace.");
});

function run(phase: HostOpenRun["phase"], index: number): HostOpenRun {
  return { run: `r${String(index)}`, project: "p", item: "ritual/x", phase, startedAt: "T" };
}

test("machine sentence: this machine says nothing of itself (its mark does); running and held runs, one and many", () => {
  assert.equal(say(facts({ name: "demo", self: true, state: "self", openRuns: [run("running", 0)], rituals: 1, lastRitualAt: null })), "demo runs 2 workspaces and starts 1 ritual for them. 1 run is running now.");
  assert.match(say(facts({ openRuns: [run("running", 0), run("running", 1), run("running", 2)] })), / 3 runs are running now; /u);
  assert.match(say(facts({ openRuns: [run("running", 0), run("held", 1)] })), / 1 run is running and 1 run waits for your answer now; /u);
  assert.match(say(facts({ openRuns: [run("held", 0), run("held", 1)] })), / 2 runs wait for your answer now; /u);
});

test("machine attention: did not answer, retired, version, sandbox check, backup, each with its lead; nothing when all is well", () => {
  assert.deepEqual(machines.machineAttention(facts(), "1.0.0"), []);
  const all = machines.machineAttention(
    facts({ state: "unreachable", reason: "connection refused", retired: true, version: "0.9.0", differs: true, boxCheck: { outcome: "fail", at: "T", darius: "0.9.0" }, backup: { state: "stale", lastOkAt: "T", ageMs: 1, name: null, error: null, reason: "no upload for 50 h", bucket: null } }),
    "1.0.0",
  );
  assert.deepEqual(
    all.map((item) => [item.key, item.lead, item.text, item.command]),
    [
      ["unreachable", "Did not answer", "Its darius serve did not answer (connection refused). Live facts show only while darius serve runs on that machine, and [setup] units must list web there.", "darius setup --systemd"],
      ["retired", "Retired", "It wrote no line in 30 days, so darius counts it as retired.", null],
      ["version", "Other darius version", "It runs darius 0.9.0, and this machine runs 1.0.0.", "darius update --hosts"],
      ["sandbox", "Sandbox check failed", "Its last sandbox check failed.", "darius box check"],
      ["backup-stale", "Backup stale", "Its backup is stale: no upload for 50 h.", null],
    ],
  );
  assert.deepEqual(
    machines.machineAttention(facts({ backup: { state: "failed", lastOkAt: null, ageMs: null, name: null, error: "disk full", reason: null, bucket: null } }), "1.0.0").map((item) => item.text),
    ["Its last backup failed: disk full."],
  );
});

test("state split: the Machines sentence, the Overview line and the Places row", () => {
  const split = machines.stateSplit(["self", "online", "unreachable"]);
  assert.equal(machines.stateLine(split), "3 machines: 2 online, 1 unreachable.");
  assert.equal(machines.machinesRowText(split, 3), "3, 1 unreachable");
  const fine = machines.stateSplit(["self", "online"]);
  assert.equal(machines.machinesRowText(fine, 2), "2");
  assert.equal(machines.stateLine(fine), "2 machines: 2 online.");
  const mixed = machines.stateSplit(["self", "unreachable", "offline"]);
  assert.equal(machines.stateLine(mixed), "3 machines: 1 online, 2 unreachable.");
  assert.equal(machines.machinesRowText(mixed, 3), "3, 2 unreachable");
});

function workspace(change: Partial<FleetWorkspace> = {}): FleetWorkspace {
  return {
    name: "demo-shop",
    icon: null,
    health: "failing",
    reasons: ["2 high candles lit", "2 vigils flagged"],
    places: [
      { host: "demo", kind: "checkout", pinned: 0 },
      { host: "host-b", kind: "copy", pinned: 1 },
      { host: "host-c", kind: "copy", pinned: 0 },
    ],
    here: "checkout",
    lastSync: "T-sync",
    counts: { djinns: 0, djinnsLate: 0, rituals: 0, ritualsLate: 0, vigilsOpen: 0, vigilsFlagged: 0, candlesLit: 0, findingsOpen: 0, findingsNeedYou: 0 },
    lastActivity: null,
    djinns: [],
    ...change,
  };
}

function status(one: FleetWorkspace, self = "demo"): string {
  return sentenceText(fleet.workspaceSentence(one, self), AGO);
}

test("workspace sentence: health and why, the machines that run it, the copies", () => {
  assert.equal(status(workspace()), "Failing: 2 high candles lit, 2 vigils flagged. Runs on demo. Copies on host-b and host-c.");
  assert.equal(status(workspace({ health: "ok", reasons: [], places: [{ host: "demo", kind: "checkout", pinned: 0 }] })), "OK: nothing needs you. Runs on demo.");
  assert.equal(status(workspace({ reasons: ["a", "b", "c", "d", "e"] })), "Failing: a, b, c and 2 more. Runs on demo. Copies on host-b and host-c.");
});

test("workspace sentence: a copy on this machine says when it synced; a workspace no machine runs says so", () => {
  const copy = workspace({ health: "needs-you", reasons: ["copy not synced in 45 min"], here: "copy", places: [{ host: "demo", kind: "copy", pinned: 0 }, { host: "host-b", kind: "checkout", pinned: 0 }] });
  assert.equal(status(copy), "Needs you: copy not synced in 45 min. Runs on host-b. This machine shows a copy, synced <T-sync>.");
  assert.equal(status({ ...copy, lastSync: null }), "Needs you: copy not synced in 45 min. Runs on host-b. This machine shows a copy and has not synced it yet.");
  const none = workspace({ health: "quiet", reasons: ["no activity in 14 days"], here: "copy", places: [{ host: "demo", kind: "copy", pinned: 0 }, { host: "host-c", kind: "copy", pinned: 0 }] });
  assert.equal(status(none), "Quiet: no activity in 14 days. No machine runs it. A copy on host-c. This machine shows a copy, synced <T-sync>.");
});

test("health split and copies mark: the Overview line and the Runs on column", () => {
  const split = fleet.healthSplit([{ health: "ok" }, { health: "ok" }, { health: "needs-you" }, { health: "failing" }, { health: "quiet" }]);
  assert.equal(split.lead, "5 workspaces");
  assert.deepEqual(
    split.parts.map((part) => part.text),
    ["2 OK", "1 needs you", "1 failing", "1 quiet"],
  );
  assert.deepEqual(fleet.copiesMark(["host-b", "host-c"]), { text: "+2 copies", title: "Copies on host-b and host-c" });
  assert.deepEqual(fleet.copiesMark(["host-b"]), { text: "+1 copy", title: "Copies on host-b" });
  assert.equal(fleet.copiesMark([]), null);
});

test("a machine in state offline shows unreachable, and its sentence says neither offline nor sync", async () => {
  const peers = await import("../web/app/lib/peers.ts");
  assert.equal(peers.peerWord("offline").label, "unreachable");
  assert.equal(peers.peerWord("unreachable").label, "unreachable");
  assert.notEqual(peers.peerWord("offline").tone, peers.peerWord("unreachable").tone, "the two states keep their tones");
  assert.equal(peers.machineWord("offline").label, "unreachable");
  const host = { host: "host-b", self: false, live: null, lastSeen: null, version: null, reason: "timeout", checkedAt: "T" } as const;
  for (const state of ["offline", "unreachable"] as const) {
    assert.doesNotMatch(peers.peerMeaning({ ...host, state }), /offline|sync/iu);
  }
  for (const lastSeen of ["T-seen", null]) {
    const text = say(facts({ state: "offline", reason: "timeout", lastSeen, openRuns: null }));
    assert.doesNotMatch(text, /offline|sync/iu);
  }
  const items = machines.machineAttention(facts({ state: "offline", reason: "timeout", openRuns: null }), "1.0.0");
  assert.match(items[0]?.text ?? "", /^Its darius serve did not answer \(timeout\)\. Live facts show only while darius serve runs on that machine/u);
  assert.equal(items[0]?.command, "darius setup --systemd");
  assert.doesNotMatch(items[0]?.text ?? "", /offline|does not sync/iu);
});

function peer(change: Partial<PeerHost> = {}): PeerHost {
  return { host: "host-b", self: false, state: "online", live: null, lastSeen: "T", version: "1.0.0", reason: null, checkedAt: "T", ...change };
}

function djinn(slug: string, state: FleetDjinn["state"], change: Partial<FleetDjinn> = {}): FleetDjinn {
  return { slug, title: slug, state, nextDueAt: null, nextDue: null, host: "host-b", why: "checkout", lastOutcome: null, lastAt: null, lastRun: null, ...change };
}

test("the lit chip: no chip is lit on a page that is not a machine page; the right one on /machines/<name>", async () => {
  const peers = await import("../web/app/lib/peers.ts");
  const hosts = ["demo", "host-a", "host-b"];
  const lit = (pathname: string): string[] => hosts.filter((host) => peers.chipLit(pathname, host));
  for (const pathname of ["/machines", "/machines/", "/all", "/w/x", "/w/host-b", "/w/x/rituals", "/workspaces", "/settings", "/"]) assert.deepEqual(lit(pathname), [], pathname);
  assert.deepEqual(lit("/machines/host-b"), ["host-b"]);
  assert.deepEqual(lit("/machines/host-b/"), ["host-b"]);
  assert.deepEqual(lit("/machines/demo"), ["demo"], "this machine is lit like any other, on its own page");
  assert.deepEqual(lit("/machines/nowhere"), [], "an unknown machine lights no chip");
  assert.deepEqual(lit("/machines/host-b/more"), []);
  assert.equal(peers.chipLit("/machines/host%2Db", "host-b"), true, "an escaped name reads back");
});

test("the mark of a chip: set when the probe data holds something to check, and not for a machine that is fine", async () => {
  assert.equal(machines.peerNeedsCheck(peer(), "1.0.0"), false);
  assert.equal(machines.peerNeedsCheck(peer({ self: true, state: "self" }), "1.0.0"), false);
  assert.equal(machines.peerNeedsCheck(peer({ version: "0.9.0" }), "1.0.0"), true, "another darius version");
  assert.equal(machines.peerNeedsCheck(peer({ state: "unreachable", reason: "timeout" }), "1.0.0"), true, "did not answer");
  assert.equal(machines.peerNeedsCheck(peer({ state: "unreachable", reason: "timeout", version: "0.9.0" }), "1.0.0"), true, "both");
  assert.equal(machines.peerNeedsCheck(peer({ version: "0.9.0" }), null), false, "no version of this machine: nothing to compare");
});

test("the block of the Machines page: the workspaces it runs worst first with their need-you count and reasons, Needs a look, then at most five rituals on schedule, next due first", () => {
  const shop = workspace({
    places: [
      { host: "host-b", kind: "checkout", pinned: 0 },
      { host: "host-c", kind: "copy", pinned: 0 },
    ],
    djinns: [
      djinn("a-idle", "idle", { lastOutcome: "complete", lastAt: "2026-11-20T08:00:00.000Z", lastRun: "R-A", nextDueAt: "2026-11-27T08:00:00.000Z" }),
      djinn("b-late", "late", { nextDue: "2026-11-20" }),
      djinn("c-run", "running", { nextDue: "2026-11-26" }),
      djinn("d-elsewhere", "running", { host: "host-c" }),
      djinn("e-never", "idle"),
      djinn("f-due", "due", { nextDue: "2026-11-25" }),
      djinn("g-held", "held", { nextDue: "2026-11-27", lastRun: "R-HELD" }),
      djinn("h-fail", "idle", { lastOutcome: "failed", lastAt: "2026-11-25T08:00:00.000Z", nextDue: "2026-11-28" }),
      djinn("i-asks", "idle", { lastOutcome: "complete", lastAt: "2026-11-24T08:00:00.000Z", lastRun: "R-ASK", nextDue: "2026-11-29" }),
      djinn("j-newer", "idle", { lastOutcome: "complete", lastAt: "2026-11-23T08:00:00.000Z", nextDue: "2026-11-30" }),
      djinn("k-later", "idle", { nextDue: "2026-12-01" }),
    ],
  });
  const ok = workspace({ name: "notes", health: "ok", reasons: [], places: [{ host: "host-b", kind: "checkout", pinned: 0 }], djinns: [] });
  const copy = workspace({ name: "archive", health: "quiet", places: [{ host: "host-b", kind: "copy", pinned: 0 }], djinns: [] });
  const asks = new Map([
    ["demo-shop/R-ASK", { questions: 1, at: "2026-11-24T09:00:00.000Z" }],
    ["demo-shop/R-HELD", { questions: 2, at: "2026-11-26T07:00:00.000Z" }],
  ]);
  const input = { name: "host-b", peer: undefined, host: undefined, selfVersion: null, lastRuns: [{ project: "demo-shop", item: "ritual/a-idle", host: "host-b", at: "2026-11-20T08:00:00.000Z", outcome: "complete", run: "R-A" }], openRuns: [], asks, needs: { "demo-shop": [{ kind: "answer" as const, count: 2 }, { kind: "vigil" as const, count: 3 }] } };
  const block = machines.machineBlock({ ...input, workspaces: [ok, shop, copy] });
  assert.deepEqual(
    block.runs.map((row) => [row.name, row.health.label, row.needs, row.reasons, row.rituals, row.lastRun?.run ?? null]),
    [
      ["demo-shop", "Failing", 5, ["2 high candles lit", "2 vigils flagged"], 10, "R-A"],
      ["notes", "OK", 0, [], 0, null],
    ],
    "worst health first, every reason; a copy is not in the list",
  );
  assert.deepEqual(
    block.look.map((item) => [item.kind, item.id]),
    [
      ["waits", "look-host-b-waits-demo-shop-g-held"],
      ["waits", "look-host-b-waits-demo-shop-i-asks"],
      ["failed", "look-host-b-failed-demo-shop-h-fail"],
      ["late", "look-host-b-late-demo-shop-b-late"],
    ],
    "waits, failed, late; workspace health stays in the table",
  );
  assert.deepEqual(
    block.onSchedule.map((one) => one.ritual.slug),
    ["f-due", "c-run", "a-idle", "j-newer", "k-later"],
    "next due first; running and due today are on schedule; never one of Needs a look",
  );
  assert.equal(block.onScheduleTotal, 6, "e-never, with no schedule, is the sixth");
  assert.equal(block.facts.rituals, 10);
  const many = Array.from({ length: 8 }, (_, index) => workspace({ name: `w${String(index)}`, places: [{ host: "host-b", kind: "checkout", pinned: 0 }], djinns: [] }));
  const big = machines.machineBlock({ ...input, workspaces: many });
  assert.equal(big.runs.length, 6);
  assert.equal(big.moreRuns, 2);
  assert.deepEqual(machines.machineBlock({ ...input, name: "host-z", workspaces: [shop] }).runs, []);
});
