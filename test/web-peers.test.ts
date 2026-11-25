/**
 * The host strip's probe and `GET /api/host.json` (0.139.0). The probe runs
 * with an injected fetch and clock: no network. `/api/host.json` goes
 * through `respond()` without a socket, over a throwaway store.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SANDBOX = mkdtempSync(join(tmpdir(), "darius-web-peers-"));
process.env.DARIUS_STATE_DIR = join(SANDBOX, "state");
process.env.DARIUS_CONFIG_DIR = join(SANDBOX, "config");
process.env.DARIUS_TAILSCALE = join(SANDBOX, "no-tailscale");
mkdirSync(process.env.DARIUS_CONFIG_DIR, { recursive: true });
writeFileSync(join(process.env.DARIUS_CONFIG_DIR, "config.toml"), 'host = "host-a"\n');

const { PeerProbe, failedState, isShortHostName, peerUrl, scrubReason, parseHostLive, peerHosts, enablePeerProbe, SYNCING_WITHIN_MS } = await import("../src/web/peers.ts");
const { readWebPeers } = await import("../src/core/config.ts");
const { respond, WebApp } = await import("../src/cli/serve.ts");
const { appendLine } = await import("../src/core/ledger.ts");
const { openProject, GLOBAL_PROJECT } = await import("../src/core/store.ts");
const { collectFleet, runStates } = await import("../src/web/fleet.ts");
const { ulid } = await import("../src/core/ulid.ts");
import type { HostLive } from "../src/web/api.ts";
import type { KnownHost, ProbeFetch, ProbeResponse } from "../src/web/peers.ts";
import type { LedgerLine } from "../src/core/model.ts";

const NOW = Date.parse("2026-11-25T10:00:00.000Z");
const MINUTE = 60_000;

function live(host: string, version = "1.0.0"): HostLive {
  return { host, version, runtime: "bun", runtimeVersion: "1.3.0", serveStartedAt: null, now: new Date(NOW).toISOString(), uptimeSeconds: 10, load: [0, 0, 0], openRuns: [], boxCheck: null, nextDue: [] };
}

function answer(status: number, body: string): ProbeResponse {
  return { status, text: () => Promise.resolve(body) };
}

interface Asked {
  url: string;
  host: string | undefined;
}

/** A fetch that answers per host id, and records what it was asked. */
function fakeFetch(answers: Record<string, () => Promise<ProbeResponse>>): ProbeFetch & { asked: Asked[] } {
  const asked: Asked[] = [];
  const fetcher = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }): Promise<ProbeResponse> => {
    asked.push({ url, host: init.headers.host });
    const reply = answers[init.headers.host ?? ""];
    return reply === undefined ? Promise.reject(new Error("unexpected host")) : reply();
  };
  return Object.assign(fetcher, { asked });
}

const KNOWN: KnownHost[] = [
  { host: "host-a", self: true, lastSeen: new Date(NOW - MINUTE).toISOString(), version: "1.0.0" },
  { host: "host-b", self: false, lastSeen: new Date(NOW - 2 * MINUTE).toISOString(), version: "0.9.0" },
  { host: "host-c", self: false, lastSeen: new Date(NOW - 5 * MINUTE).toISOString(), version: "1.0.0" },
  { host: "host-d", self: false, lastSeen: new Date(NOW - 3 * 60 * MINUTE).toISOString(), version: null },
];

function probeWith(fetcher: ProbeFetch | null, options: { now?: () => number; overrides?: ReadonlyMap<string, string>; timeoutMs?: number; known?: KnownHost[] } = {}) {
  return new PeerProbe({ self: () => live("host-a"), known: () => options.known ?? KNOWN, port: () => 4747, overrides: () => options.overrides ?? new Map(), fetch: fetcher, now: options.now ?? (() => NOW), timeoutMs: options.timeoutMs ?? 50 });
}

test("probe: this host is self with no HTTP, an answer is online, a failure is unreachable within 20 min of the last line and offline after", async () => {
  const fetcher = fakeFetch({
    "host-b": () => Promise.resolve(answer(200, JSON.stringify(live("host-b", "1.1.0")))),
    "host-c": () => Promise.reject(Object.assign(new Error("connect ECONNREFUSED 100.64.1.2:4747"), { code: "ECONNREFUSED" })),
    "host-d": () => Promise.reject(new Error("getaddrinfo ENOTFOUND host-d")),
  });
  const hosts = await probeWith(fetcher).hosts();
  assert.deepEqual(
    hosts.map((host) => [host.host, host.state, host.version, host.reason]),
    [
      ["host-a", "self", "1.0.0", null],
      ["host-b", "online", "1.1.0", null],
      ["host-c", "unreachable", "1.0.0", "connection refused"],
      ["host-d", "offline", null, "name not found"],
    ],
  );
  assert.equal(hosts[1]?.live?.host, "host-b", "an online host carries what its serve said");
  assert.equal(hosts[2]?.live, null);
  assert.deepEqual(
    fetcher.asked.map((one) => one.host),
    ["host-b", "host-c", "host-d"],
    "this host is never asked over HTTP",
  );
  assert.deepEqual(fetcher.asked[0], { url: "http://host-b:4747/api/host.json", host: "host-b" }, "the URL and the Host header name the peer");
});

test("failedState: the 20 minute line, and no line at all", () => {
  assert.equal(failedState(new Date(NOW - SYNCING_WITHIN_MS).toISOString(), NOW), "unreachable");
  assert.equal(failedState(new Date(NOW - SYNCING_WITHIN_MS - 1).toISOString(), NOW), "offline");
  assert.equal(failedState(null, NOW), "offline");
  assert.equal(failedState("not a time", NOW), "offline");
});

test("probe: a peer that does not answer in time is a failure that says so, and the page waits no longer than the timeout", async () => {
  const fetcher = fakeFetch({ "host-b": () => new Promise<ProbeResponse>(() => undefined) });
  const started = Date.now();
  const hosts = await probeWith(fetcher, { known: KNOWN.slice(0, 2), timeoutMs: 60 }).hosts();
  const took = Date.now() - started;
  assert.deepEqual([hosts[1]?.state, hosts[1]?.reason], ["unreachable", "no answer in 0.1 s"]);
  assert.ok(took < 1000, `waited ${String(took)} ms`);
});

test("probe: the answer is kept for 30 s, then asked again; calls at once share one round", async () => {
  let clock = NOW;
  let calls = 0;
  const fetcher: ProbeFetch = () => {
    calls += 1;
    return Promise.resolve(answer(200, JSON.stringify(live("host-b"))));
  };
  const probe = probeWith(fetcher, { now: () => clock, known: KNOWN.slice(0, 2) });
  await Promise.all([probe.hosts(), probe.hosts()]);
  assert.equal(calls, 1, "two pages at once: one probe");
  clock += 29_999;
  await probe.hosts();
  assert.equal(calls, 1, "inside 30 s: the cache");
  clock += 1;
  await probe.hosts();
  assert.equal(calls, 2, "at 30 s: a new probe");
});

test("probe: [web.peers] overrides the URL of one host, and the Host header still names the peer", async () => {
  const fetcher = fakeFetch({ "host-b": () => Promise.resolve(answer(200, JSON.stringify(live("host-b")))) });
  await probeWith(fetcher, { known: KNOWN.slice(0, 2), overrides: new Map([["host-b", "http://peer-b.example:8080/"]]) }).hosts();
  assert.deepEqual(fetcher.asked, [{ url: "http://peer-b.example:8080/api/host.json", host: "host-b" }]);
  assert.equal(peerUrl("host-c", 4748, new Map([["host-b", "http://x"]])), "http://host-c:4748/api/host.json");
});

test("probe: a host id with a dot is asked only through a [web.peers] entry", async () => {
  const [self] = KNOWN;
  assert.ok(self !== undefined);
  const dotted: KnownHost = { host: "peer.example", self: false, lastSeen: new Date(NOW - MINUTE).toISOString(), version: "1.0.0" };
  const fetcher = fakeFetch({ "peer.example": () => Promise.resolve(answer(200, JSON.stringify(live("peer.example")))) });
  const [, shown] = await probeWith(fetcher, { known: [self, dotted] }).hosts();
  assert.deepEqual(fetcher.asked, [], "no override: nobody is asked");
  assert.equal(shown?.state, "unreachable");
  assert.equal(shown?.reason, "needs a [web.peers] entry");

  const withEntry = fakeFetch({ "peer.example": () => Promise.resolve(answer(200, JSON.stringify(live("peer.example")))) });
  const [, online] = await probeWith(withEntry, { known: [self, dotted], overrides: new Map([["peer.example", "http://peer.example:4747"]]) }).hosts();
  assert.equal(online?.state, "online");
  assert.equal(isShortHostName("host-b"), true);
  assert.equal(isShortHostName("evil.example.com"), false);
  assert.equal(isShortHostName("-x"), false);
});

test("probe: refusals, bad bodies and a host that answers with another name are failures with short reasons", async () => {
  const known: KnownHost[] = ["a", "b", "c", "d", "e"].map((name) => ({ host: `peer-${name}`, self: false, lastSeen: new Date(NOW).toISOString(), version: null }));
  const fetcher = fakeFetch({
    "peer-a": () => Promise.resolve(answer(403, "forbidden")),
    "peer-b": () => Promise.resolve(answer(421, "wrong host")),
    "peer-c": () => Promise.resolve(answer(200, "<html>not json</html>")),
    "peer-d": () => Promise.resolve(answer(200, JSON.stringify(live("someone-else")))),
    "peer-e": () => Promise.resolve(answer(404, "")),
  });
  const hosts = await probeWith(fetcher, { known }).hosts();
  assert.deepEqual(
    hosts.map((host) => host.reason),
    ["refused this host (403)", "refused the host name (421)", "answered no host facts", "answered as another host", "has no host facts (404, darius before 0.139.0)"],
  );
  assert.ok(hosts.every((host) => host.state === "unreachable" && host.live === null));
});

test("scrubReason drops URLs, addresses and paths, and keeps it short", () => {
  assert.equal(scrubReason("connect ECONNREFUSED 100.64.1.2:4747"), "connection refused");
  assert.equal(scrubReason("fetch failed for http://host-b:4747/api/host.json at 100.64.1.2:4747"), "fetch failed for at");
  assert.equal(scrubReason("bad thing in /home/user/.config/darius/config.toml"), "bad thing in");
  assert.equal(scrubReason("odd [fd7a:115c:a1e0::1]:4747 reply"), "odd reply");
  assert.equal(scrubReason(""), "probe failed");
  assert.ok(scrubReason("x".repeat(300)).length <= 80);
  for (const text of ["http://a.example/x", "10.0.0.1", "/etc/passwd"]) assert.equal(scrubReason(`see ${text}`).includes(text), false, text);
});

test("parseHostLive checks the shape and the host", () => {
  assert.deepEqual(parseHostLive(JSON.stringify(live("host-b")), "host-b"), live("host-b"));
  assert.equal(parseHostLive(JSON.stringify({ host: "host-b" }), "host-b"), "answered no host facts");
  assert.equal(parseHostLive("[]", "host-b"), "answered no host facts");
});

test("a broken [web.peers] does not stop the strip: the default URLs are asked", async () => {
  const fetcher = fakeFetch({ "host-b": () => Promise.resolve(answer(200, JSON.stringify(live("host-b")))) });
  const probe = new PeerProbe({
    self: () => live("host-a"),
    known: () => KNOWN.slice(0, 2),
    port: () => 4747,
    overrides: () => {
      throw new Error("/home/user/.config/darius/config.toml: [web.peers] key bad");
    },
    fetch: fetcher,
    now: () => NOW,
  });
  const hosts = await probe.hosts();
  assert.equal(hosts[1]?.state, "online");
  assert.equal(fetcher.asked[0]?.url, "http://host-b:4747/api/host.json");
});

test("readWebPeers: host id = base URL, a bad key or value is an error that names it", () => {
  const file = join(process.env.DARIUS_CONFIG_DIR ?? "", "config.toml");
  writeFileSync(file, 'host = "host-a"\n\n[web.peers]\n"host-b.lan" = "http://peer-b.example:4747/"\nhost-c = "https://peer-c.example"\n');
  assert.deepEqual([...readWebPeers()], [
    ["host-b.lan", "http://peer-b.example:4747"],
    ["host-c", "https://peer-c.example"],
  ]);
  writeFileSync(file, 'host = "host-a"\n\n[web.peers]\nhost-b = "ftp://x"\n');
  assert.throws(() => readWebPeers(), /\[web\.peers\] host-b must be an http or https URL/u);
  writeFileSync(file, 'host = "host-a"\n');
  assert.equal(readWebPeers().size, 0);
});

test("outside darius serve the probe asks nobody: the other hosts show their ledger state, not probed here", async () => {
  enablePeerProbe(null);
  const global = openProject(GLOBAL_PROJECT, { create: true });
  appendLine(global, { who: "sync", type: "host.version", version: "1.0.0", compat: 1 });
  const hostB = join(process.env.DARIUS_STATE_DIR ?? "", GLOBAL_PROJECT, "ledger", "host-b");
  mkdirSync(hostB, { recursive: true });
  const time = Date.now() - 5 * MINUTE;
  writeFileSync(join(hostB, "open.jsonl"), `${JSON.stringify({ v: 1, id: ulid(time), at: new Date(time).toISOString(), host: "host-b", who: "sync", project: GLOBAL_PROJECT, type: "host.version", version: "0.9.0", compat: 1 })}\n`);
  const hosts = await peerHosts();
  const b = hosts.find((host) => host.host === "host-b");
  assert.equal(hosts[0]?.state, "self");
  assert.equal(hosts[0]?.host, "host-a");
  assert.deepEqual([b?.state, b?.version, b?.reason], ["unreachable", "0.9.0", "not probed here"]);
  const fleet = collectFleet();
  assert.deepEqual(
    fleet.hosts.map((host) => [host.host, host.version, host.retired]),
    [
      ["host-a", "1.0.0", false],
      ["host-b", "0.9.0", false],
    ],
  );
});

function line(type: string, run: string, host: string, extra: Partial<LedgerLine> = {}): LedgerLine {
  return { v: 1, id: `${run}-${type}`, at: "2026-11-25T09:00:00.000Z", host, who: "timer", project: "p", type, item: "ritual/r", run, ...extra };
}

test("runStates: a run is open until run.completed; held and resumed move it, the host is the one of its newest start", () => {
  const states = runStates([line("run.started", "a", "host-a"), line("run.held", "a", "host-a"), line("run.started", "b", "host-a"), line("run.resumed", "b", "host-b"), line("run.started", "c", "host-a"), line("run.completed", "c", "host-a", { outcome: "complete" })]);
  assert.deepEqual(
    states.map((state) => [state.run, state.phase, state.host, state.outcome]),
    [
      ["a", "held", "host-a", null],
      ["b", "running", "host-b", null],
      ["c", "closed", "host-a", "complete"],
    ],
  );
});

const APP = new WebApp(join(SANDBOX, "no-build"));

test("GET /api/host.json: this host's live facts, with its open runs; no path, no env", async () => {
  const project = openProject("peer-demo", { create: true });
  appendLine(project, { who: "timer", type: "run.started", item: "ritual/nightly", run: "01KRUNOPEN0000000000000000" });
  const reply = await respond("GET", new URL("http://host-a:4747/api/host.json"), new Headers(), "owner on host-b", APP);
  assert.equal(reply.status, 200);
  assert.match(reply.headers.get("content-type") ?? "", /^application\/json/u);
  const text = reply.body instanceof Uint8Array ? new TextDecoder().decode(reply.body) : reply.body;
  const body: HostLive = JSON.parse(text);
  assert.deepEqual(Object.keys(body).toSorted(), ["boxCheck", "host", "load", "nextDue", "now", "openRuns", "runtime", "runtimeVersion", "serveStartedAt", "uptimeSeconds", "version"]);
  assert.equal(body.host, "host-a");
  assert.ok(body.runtime === "bun" || body.runtime === "node");
  assert.deepEqual(body.openRuns, [{ run: "01KRUNOPEN0000000000000000", project: "peer-demo", item: "ritual/nightly", phase: "running", startedAt: body.openRuns[0]?.startedAt ?? "" }]);
  assert.equal(text.includes(SANDBOX), false, "no path of the store or the config");
  assert.equal(text.includes(process.env.HOME ?? "/nonexistent-home"), false, "no home path");
  assert.equal(/DARIUS_|"env"/u.test(text), false, "no environment");
});
