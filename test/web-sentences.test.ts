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
    djinns: 2,
    djinnsLate: 0,
    lastDjinnAt: "T-djinn",
    ...change,
  };
}

function say(one: Facts): string {
  return sentenceText(machines.machineSentence(one), AGO);
}

test("machine sentence: online, with workspaces, copies, no open run and djinns", () => {
  assert.equal(say(facts()), "host-b is online. It runs 2 workspaces (infra-notes, archive-2025) and shows a copy of 1. No run is open now. 2 djinns live here; the last one ran <T-djinn>.");
});

test("machine sentence: a machine that did not answer says why and how old its last ledger line is, and says nothing of open runs", () => {
  const text = say(facts({ name: "host-c", state: "unreachable", reason: "connection refused", openRuns: null, runs: ["status-page"], copies: [], djinns: 0, lastDjinnAt: null }));
  assert.equal(text, "host-c did not answer (connection refused). Its last ledger line is <T-seen> old. It runs 1 workspace (status-page). No djinn lives here.");
});

test("machine sentence: offline, checking and not asked, with and without a ledger line", () => {
  assert.equal(say(facts({ state: "offline", reason: "timeout", openRuns: null, runs: [], copies: [], djinns: 0 })), "host-b did not answer (timeout). Its last ledger line is <T-seen> old. It runs no workspace. No djinn lives here.");
  assert.equal(say(facts({ state: "offline", reason: "timeout", lastSeen: null, openRuns: null, runs: [], copies: [], djinns: 0 })), "host-b did not answer (timeout). It has no ledger line here. It runs no workspace. No djinn lives here.");
  assert.equal(say(facts({ state: "checking", openRuns: null, lastSeen: null, runs: [], copies: ["a", "b"], djinns: 0 })), "darius is still asking host-b. Its ledgers hold no line of it. It runs no workspace and shows a copy of 2. No djinn lives here.");
  assert.equal(say(facts({ state: null, openRuns: null, runs: [], copies: [], djinns: 0 })), "darius did not ask host-b. Its ledgers were last seen <T-seen>. It runs no workspace. No djinn lives here.");
});

test("machine sentence: this machine, one open run, many open runs, one djinn that never ran", () => {
  assert.equal(say(facts({ name: "demo", self: true, state: "self", openRuns: [{ run: "r", project: "p", item: "ritual/x", phase: "running", startedAt: "T" }], djinns: 1, lastDjinnAt: null })), "demo is this machine, the one that serves this page. It runs 2 workspaces (infra-notes, archive-2025) and shows a copy of 1. 1 run is open now. 1 djinn lives here; none has run yet.");
  const three: HostOpenRun[] = Array.from({ length: 3 }, (_, index) => ({ run: `r${String(index)}`, project: "p", item: "ritual/x", phase: "running", startedAt: "T" }));
  assert.match(say(facts({ openRuns: three })), / 3 runs are open now\. /u);
});

test("machine sentence: a djinn lives on a machine, for none, one and many", () => {
  assert.match(say(facts({ djinns: 0, lastDjinnAt: null })), / No djinn lives here\.$/u);
  assert.match(say(facts({ djinns: 1 })), / 1 djinn lives here; the last one ran <T-djinn>\.$/u);
  assert.match(say(facts({ djinns: 5 })), / 5 djinns live here; /u);
  assert.doesNotMatch(say(facts()), /djinns? runs? here/u);
});

test("machine sentence: more than four names show the first four, then and n more; every name links to its workspace", () => {
  const parts = machines.machineSentence(facts({ runs: ["a", "b", "c", "d", "e", "f"] }));
  assert.match(sentenceText(parts, AGO), /It runs 6 workspaces \(a, b, c, d and 2 more\)/u);
  assert.deepEqual(
    parts.flatMap((part) => (part.kind === "link" ? [part.text] : [])),
    ["a", "b", "c", "d"],
  );
  assert.deepEqual(
    parts.find((part) => part.kind === "link"),
    { kind: "link", text: "a", to: { to: "overview", ws: "a" } },
  );
  assert.match(say(facts({ runs: ["a", "b", "c", "d"] })), /\(a, b, c, d\)/u);
});

test("machine attention: did not answer, retired, version, box check, backup; nothing when all is well", () => {
  assert.deepEqual(machines.machineAttention(facts(), "1.0.0"), []);
  const all = machines.machineAttention(
    facts({ state: "unreachable", reason: "connection refused", retired: true, version: "0.9.0", differs: true, boxCheck: { outcome: "fail", at: "T", darius: "0.9.0" }, backup: { state: "stale", lastOkAt: "T", ageMs: 1, name: null, error: null, reason: "no upload for 50 h", bucket: null } }),
    "1.0.0",
  );
  assert.deepEqual(
    all.map((item) => [item.text, item.command]),
    [
      ["Its darius serve did not answer (connection refused). Live facts show only while darius serve runs on that machine, and [setup] units must list web there.", "darius setup --systemd"],
      ["It wrote no line in 30 days, so darius counts it as retired.", null],
      ["It runs darius 0.9.0, and this machine runs 1.0.0.", "darius update --hosts"],
      ["Its last box check failed.", "darius box check"],
      ["Its backup is stale: no upload for 50 h.", null],
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
  assert.equal(machines.openRunsLine([facts({ openRuns: [] }), facts({ openRuns: null })]), "No run is open now on the machines that answered.");
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

test("the block of the Machines page: the workspaces it runs with their health, the djinns that act first, at most eight", () => {
  const shop = workspace({
    places: [
      { host: "host-b", kind: "checkout", pinned: 0 },
      { host: "host-c", kind: "copy", pinned: 0 },
    ],
    djinns: [djinn("a-idle", "idle", { lastOutcome: "complete" }), djinn("b-late", "late"), djinn("c-run", "running"), djinn("d-elsewhere", "running", { host: "host-c" }), djinn("e-never", "idle"), djinn("f-due", "due"), djinn("g-held", "held"), djinn("h-fail", "idle", { lastOutcome: "failed" })],
  });
  const copy = workspace({ name: "archive", health: "quiet", places: [{ host: "host-b", kind: "copy", pinned: 0 }], djinns: [] });
  const block = machines.machineBlock({ name: "host-b", peer: undefined, host: undefined, workspaces: [shop, copy], selfVersion: null });
  assert.deepEqual(block.runs, [{ name: "demo-shop", health: { tone: "bad", label: "Failing" } }], "a copy is not in Runs");
  assert.deepEqual(
    block.djinns.map((one) => [one.slug, one.word.label]),
    [
      ["c-run", "running"],
      ["g-held", "held"],
      ["b-late", "late"],
      ["f-due", "due today"],
      ["a-idle", "complete"],
      ["e-never", "no run yet"],
      ["h-fail", "failed"],
    ],
    "state order, then the name; the machine's own djinns only",
  );
  assert.equal(block.moreDjinns, 0);
  assert.equal(block.facts.djinns, 7);
  const many = workspace({ places: shop.places, djinns: Array.from({ length: 11 }, (_, index) => djinn(`d${String(index).padStart(2, "0")}`, "idle")) });
  const big = machines.machineBlock({ name: "host-b", peer: undefined, host: undefined, workspaces: [many], selfVersion: null });
  assert.equal(big.djinns.length, 8);
  assert.equal(big.moreDjinns, 3);
  assert.deepEqual(machines.machineBlock({ name: "host-z", peer: undefined, host: undefined, workspaces: [shop], selfVersion: null }).runs, []);
});
