/**
 * The host strip's probe (0.139.0): is each host of the synced store up,
 * and what does its own `darius serve` say?
 *
 * The hosts are the ones the ledgers here know (src/web/fleet.ts), less the
 * ones retired after 30 days. This host is `self`: its facts are read here,
 * with no HTTP. Every other host is asked `GET /api/host.json` on its own
 * serve, at `http://<host id>:<port>` (the port of this serve), or at the
 * base URL that `[web.peers]` in this host's config.toml names for it. The
 * request carries the host id as its Host header, so the peer's Host check
 * passes, and the peer's normal access check judges this host like any
 * caller: a tailnet device of an allowed login.
 *
 * All probes run at once, each gives up after 1.5 s, and the answer is kept
 * for 30 s. No page waits for a probe (0.140.0). Since 0.141.4 `darius serve`
 * probes on its own timer, every 20 s, so a page never starts one, and the
 * 1.5 s count only the time this process was free to read the answer: a page
 * that holds the event loop for 3 s does not make a healthy peer look silent.
 * A failed probe is `unreachable` when the host's ledger lines are at most
 * 20 minutes old (it syncs; its serve does not answer), else `offline`. The web app words both "unreachable". The reason is a few words, never a URL or an address.
 *
 * Only a process that turned the probe on asks the network: `darius serve`
 * does (`enablePeerProbe`). Anywhere else (tests, the CLI) the other hosts
 * show their ledger state with the reason "not probed here".
 */

import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

import { readWebPeers } from "../core/config.ts";
import { configDir, stateDir } from "../core/paths.ts";
import { errorMessage } from "../runtime.ts";
import type { JsonValue } from "../core/model.ts";
import type { HostBoxCheck, HostDue, HostLive, HostOpenRun, PeerHost, PeerState } from "./api.ts";
import { collectFleet, collectHostLive } from "./fleet.ts";

export const PROBE_TIMEOUT_MS = 1_500;
export const PEER_TTL_MS = 30_000;
/** How often `darius serve` probes on its own (0.141.4): below the TTL, so the cache stays fresh and no page starts a probe. */
export const PEER_REFRESH_MS = 20_000;
/** The tick of the probe's timeout clock. */
const TICK_MS = 100;
/** The most one tick counts: a tick that comes late because the event loop was busy counts this much, not the whole wait. */
const TICK_MAX_MS = 250;
/** However busy the event loop is, a probe gives up after this much wall time. */
const PROBE_WALL_MAX_MS = 15_000;
/** A host whose newest line is at most this old still syncs: its failed probe is `unreachable`, not `offline`. */
export const SYNCING_WITHIN_MS = 20 * 60_000;
export const HOST_JSON_PATH = "/api/host.json";
const REASON_MAX = 80;
const BODY_MAX = 256 * 1024;

/** What a probe needs of a response. `fetch` gives it; so does `hostFetch`. */
export interface ProbeResponse {
  status: number;
  text(): Promise<string>;
}

/** A fetch: the URL, the headers (`host` among them), and a signal that aborts at the timeout. */
export type ProbeFetch = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<ProbeResponse>;

/** A host the store knows, with what the ledgers say about it. */
export interface KnownHost {
  host: string;
  self: boolean;
  lastSeen: string | null;
  version: string | null;
}

export interface PeerProbeOptions {
  /** This host's facts. */
  self: () => HostLive;
  /** Every host of the store, this host among them. */
  known: () => KnownHost[];
  /** The port of the other hosts' serve: this serve's port. */
  port: () => number;
  /** `[web.peers]`: host id = base URL. */
  overrides: () => ReadonlyMap<string, string>;
  /** Null: do not probe; the other hosts show their ledger state. */
  fetch: ProbeFetch | null;
  now?: () => number;
  timeoutMs?: number;
  ttlMs?: number;
}

/**
 * A host id the probe may turn into `http://<id>:<port>` without an override: one label of letters,
 * digits and `-`, as a tailnet short name is. An id with a dot could name a host outside the
 * tailnet, and the ids come from the synced ledgers, so such a host needs a `[web.peers]` entry.
 */
export function isShortHostName(host: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/iu.test(host);
}

/** The URL of a host's `/api/host.json`: its override, else `http://<host>:<port>`. */
export function peerUrl(host: string, port: number, overrides: ReadonlyMap<string, string>): string {
  const base = overrides.get(host);
  return `${base === undefined ? `http://${host}:${String(port)}` : base.replace(/\/+$/u, "")}${HOST_JSON_PATH}`;
}

/** The state of a host whose probe failed, from how old its newest line is. */
export function failedState(lastSeen: string | null, now: number): Exclude<PeerState, "self" | "online" | "checking"> {
  if (lastSeen === null) return "offline";
  const age = now - Date.parse(lastSeen);
  return Number.isFinite(age) && age <= SYNCING_WITHIN_MS ? "unreachable" : "offline";
}

const ERROR_WORDS: ReadonlyArray<readonly [RegExp, string]> = [
  [/ECONNREFUSED|connection refused/iu, "connection refused"],
  [/ENOTFOUND|EAI_AGAIN|EAI_NONAME|getaddrinfo|could not resolve|DNS/iu, "name not found"],
  [/EHOSTUNREACH|ENETUNREACH|no route/iu, "machine unreachable"],
  [/ECONNRESET|socket hang up|closed/iu, "connection closed"],
  [/certificate|TLS|SSL/iu, "TLS failed"],
];

/** A short reason with no URL, address or path in it. */
export function scrubReason(text: string): string {
  for (const [pattern, words] of ERROR_WORDS) if (pattern.test(text)) return words;
  const plain = text
    .replace(/[a-z][a-z0-9+.-]*:\/\/\S*/giu, "")
    .replace(/\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b/gu, "")
    .replace(/\[?[0-9a-f]{0,4}(?::[0-9a-f]{0,4}){2,7}\]?(?::\d+)?/giu, "")
    .replace(/(?:~|\.{0,2})\/[^\s,;:]*/gu, "")
    .replace(/\s+/gu, " ")
    .replace(/\s+([,.;:])/gu, "$1")
    .trim();
  const short = plain === "" ? "probe failed" : plain;
  return short.length > REASON_MAX ? `${short.slice(0, REASON_MAX - 1)}…` : short;
}

type JsonRecord = { readonly [key: string]: JsonValue };

function isRecord(value: JsonValue | undefined): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isText(value: JsonValue | undefined): value is string {
  return typeof value === "string";
}

function isNumber(value: JsonValue | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function textOrNull(value: JsonValue | undefined): string | null {
  return isText(value) ? value : null;
}

function openRunOf(value: JsonValue): HostOpenRun[] {
  if (!isRecord(value) || !isText(value.run) || !isText(value.project) || !isText(value.item) || !isText(value.startedAt)) return [];
  return [{ run: value.run, project: value.project, item: value.item, phase: value.phase === "held" ? "held" : "running", startedAt: value.startedAt }];
}

function dueOf(value: JsonValue): HostDue[] {
  if (!isRecord(value) || !isText(value.project) || !isText(value.slug)) return [];
  return [{ project: value.project, slug: value.slug, nextDueAt: textOrNull(value.nextDueAt) }];
}

function boxCheckOf(value: JsonValue | undefined): HostBoxCheck | null {
  if (!isRecord(value) || !isText(value.outcome) || !isText(value.at) || !isText(value.darius)) return null;
  return { outcome: value.outcome, at: value.at, darius: value.darius };
}

/** The body of a peer's `/api/host.json`, parsed field by field; a reason when it is not one. */
export function parseHostLive(text: string, host: string): HostLive | string {
  let body: JsonValue;
  try {
    body = JSON.parse(text);
  } catch {
    return "answered no machine facts";
  }
  if (!isRecord(body) || !isText(body.host) || !isText(body.version) || !isText(body.now) || !Array.isArray(body.openRuns) || !Array.isArray(body.nextDue) || !Array.isArray(body.load)) return "answered no machine facts";
  if (body.host !== host) return "answered as another machine";
  const [one, five, fifteen] = body.load;
  return {
    host: body.host,
    version: body.version,
    runtime: body.runtime === "node" ? "node" : "bun",
    runtimeVersion: textOrNull(body.runtimeVersion) ?? "",
    serveStartedAt: textOrNull(body.serveStartedAt),
    now: body.now,
    uptimeSeconds: isNumber(body.uptimeSeconds) ? body.uptimeSeconds : 0,
    load: [isNumber(one) ? one : 0, isNumber(five) ? five : 0, isNumber(fifteen) ? fifteen : 0],
    openRuns: body.openRuns.flatMap(openRunOf),
    boxCheck: boxCheckOf(body.boxCheck),
    nextDue: body.nextDue.flatMap(dueOf),
  };
}

function isReason(answer: HostLive | string): answer is string {
  return typeof answer === "string";
}

function statusReason(status: number): string {
  if (status === 421) return "refused the host name (421)";
  if (status === 403) return "refused this machine (403)";
  if (status === 404) return "has no machine facts (404, darius before 0.139.0)";
  return `answered ${String(status)}`;
}

function timeoutReason(timeoutMs: number): string {
  return `no answer in ${(timeoutMs / 1000).toFixed(1)} s`;
}

function noCancel(): void {
  // nothing to cancel yet
}

/**
 * Calls `expire` once `ms` of free event loop time has passed (0.141.4), and returns a cancel.
 * A timer that fires late, because a page build held the event loop, counts at most
 * TICK_MAX_MS for that wait: while the loop is held, no answer can be read, so that time is
 * not the peer's silence. After PROBE_WALL_MAX_MS of wall time it expires all the same.
 */
export function loopTimeout(ms: number, expire: () => void, clock: () => number = () => performance.now()): () => void {
  const started = clock();
  let last = started;
  let counted = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const tick = (): void => {
    const now = clock();
    counted += Math.min(Math.max(0, now - last), TICK_MAX_MS);
    last = now;
    if (counted >= ms || now - started >= Math.max(ms, PROBE_WALL_MAX_MS)) {
      timer = undefined;
      expire();
      return;
    }
    timer = setTimeout(tick, Math.min(TICK_MS, ms - counted));
  };
  timer = setTimeout(tick, Math.min(TICK_MS, ms));
  return () => clearTimeout(timer);
}

/**
 * A fetch over node:http and node:https that sends the Host header as given.
 * Node's own fetch drops a Host header, so the peer's Host check would see the
 * URL's host instead; this behaves the same under Bun and Node.
 */
export const hostFetch: ProbeFetch = (url, init) =>
  new Promise((resolve, reject) => {
    const target = new URL(url);
    const send = target.protocol === "https:" ? httpsRequest : httpRequest;
    const outgoing = send(target, { method: "GET", headers: init.headers, signal: init.signal }, (incoming) => {
      const chunks: Buffer[] = [];
      let size = 0;
      incoming.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > BODY_MAX) {
          incoming.destroy(new Error("answer too large"));
          return;
        }
        chunks.push(chunk);
      });
      incoming.on("error", reject);
      incoming.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve({ status: incoming.statusCode ?? 0, text: () => Promise.resolve(text) });
      });
    });
    outgoing.on("error", reject);
    outgoing.end();
  });

/** The probes of the hosts of one store, cached. */
export class PeerProbe {
  private readonly options: PeerProbeOptions;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private readonly ttlMs: number;
  private cache: { at: number; value: PeerHost[] } | null = null;
  private running: Promise<PeerHost[]> | null = null;

  constructor(options: PeerProbeOptions) {
    this.options = options;
    this.now = options.now ?? Date.now;
    this.timeoutMs = options.timeoutMs ?? PROBE_TIMEOUT_MS;
    this.ttlMs = options.ttlMs ?? PEER_TTL_MS;
  }

  /** Every host with its state: from the cache while it is younger than the TTL, else probed now (one probe round at a time). */
  hosts(): Promise<PeerHost[]> {
    const now = this.now();
    if (this.cache !== null && now >= this.cache.at && now - this.cache.at < this.ttlMs) return Promise.resolve(this.cache.value);
    return this.round();
  }

  /** A probe round now, whatever the cache holds. `darius serve` calls it on its own timer. */
  refresh(): Promise<PeerHost[]> {
    if (this.options.fetch === null) return Promise.resolve(this.unprobedAll());
    return this.round();
  }

  /** The probe round that runs, or a new one: one round at a time. */
  private round(): Promise<PeerHost[]> {
    this.running ??= this.probeAll().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  /**
   * Every host with its state, at once (0.140.0): no page waits for a probe. A fresh cache
   * answers; a stale one answers too and starts a new probe in the background; with no cache
   * yet the probe starts in the background and the other hosts say `checking`. With the probe
   * off (no fetch) the answer needs no network, so it is computed here and now.
   */
  current(): PeerHost[] {
    const now = this.now();
    const cached = this.cache;
    if (cached !== null && now >= cached.at && now - cached.at < this.ttlMs) return cached.value;
    if (this.options.fetch === null) return this.unprobedAll();
    this.hosts().catch(() => undefined);
    return cached?.value ?? this.checkingAll();
  }

  private unprobedAll(): PeerHost[] {
    const checkedAt = new Date(this.now()).toISOString();
    const live = this.options.self();
    const value = this.options.known().map((host): PeerHost => (host.self ? { host: host.host, self: true, state: "self", live, lastSeen: host.lastSeen, version: live.version, reason: null, checkedAt } : this.unprobed(host, checkedAt, "not probed here")));
    this.cache = { at: this.now(), value };
    return value;
  }

  private checkingAll(): PeerHost[] {
    const checkedAt = new Date(this.now()).toISOString();
    const live = this.options.self();
    return this.options.known().map((host): PeerHost => (host.self ? { host: host.host, self: true, state: "self", live, lastSeen: host.lastSeen, version: live.version, reason: null, checkedAt } : { host: host.host, self: false, state: "checking", live: null, lastSeen: host.lastSeen, version: host.version, reason: "first probe running", checkedAt }));
  }

  private async probeAll(): Promise<PeerHost[]> {
    const started = this.now();
    const checkedAt = new Date(started).toISOString();
    const known = this.options.known();
    let overrides: ReadonlyMap<string, string> = new Map();
    let configProblem: string | null = null;
    try {
      overrides = this.options.overrides();
    } catch (cause) {
      configProblem = `[web.peers] not read: ${scrubReason(errorMessage(cause))}`;
    }
    const live = this.options.self();
    const port = this.options.port();
    const value = await Promise.all(
      known.map((host): Promise<PeerHost> => {
        if (host.self) return Promise.resolve({ host: host.host, self: true, state: "self", live, lastSeen: host.lastSeen, version: live.version, reason: null, checkedAt });
        if (!overrides.has(host.host) && !isShortHostName(host.host)) return Promise.resolve(this.unprobed(host, checkedAt, "needs a [web.peers] entry"));
        return this.probeOne(host, peerUrl(host.host, port, overrides), checkedAt, configProblem);
      }),
    );
    this.cache = { at: started, value };
    return value;
  }

  private unprobed(host: KnownHost, checkedAt: string, reason: string): PeerHost {
    return { host: host.host, self: false, state: failedState(host.lastSeen, this.now()), live: null, lastSeen: host.lastSeen, version: host.version, reason, checkedAt };
  }

  private async probeOne(host: KnownHost, url: string, checkedAt: string, configProblem: string | null): Promise<PeerHost> {
    const failed = (reason: string): PeerHost => ({ host: host.host, self: false, state: failedState(host.lastSeen, this.now()), live: null, lastSeen: host.lastSeen, version: host.version, reason, checkedAt });
    const fetcher = this.options.fetch;
    if (fetcher === null) return failed(configProblem ?? "not probed here");
    const controller = new AbortController();
    let cancel = noCancel;
    const timeout = new Promise<"timeout">((resolve) => {
      cancel = loopTimeout(this.timeoutMs, () => {
        controller.abort();
        resolve("timeout");
      });
    });
    try {
      const asked = (async (): Promise<HostLive | string> => {
        const response = await fetcher(url, { headers: { host: host.host, accept: "application/json" }, signal: controller.signal });
        if (response.status !== 200) return statusReason(response.status);
        return parseHostLive(await response.text(), host.host);
      })();
      const answer = await Promise.race([asked, timeout]);
      if (answer === "timeout") {
        asked.catch(() => undefined);
        return failed(timeoutReason(this.timeoutMs));
      }
      if (isReason(answer)) return failed(answer);
      return { host: host.host, self: false, state: "online", live: answer, lastSeen: host.lastSeen, version: answer.version, reason: null, checkedAt };
    } catch (cause) {
      return failed(controller.signal.aborted ? timeoutReason(this.timeoutMs) : scrubReason(errorMessage(cause)));
    } finally {
      cancel();
    }
  }
}

// --- the probe of this process ------------------------------------------------------------

let probePort: number | null = null;
let probe: { key: string; probe: PeerProbe } | null = null;
let refresher: ReturnType<typeof setInterval> | undefined;
let firstRefresh: ReturnType<typeof setTimeout> | undefined;

function stopRefresh(): void {
  clearInterval(refresher);
  clearTimeout(firstRefresh);
  refresher = undefined;
  firstRefresh = undefined;
}

/** One probe round of this process, in the background: a failure is already a host state. */
function refreshNow(): void {
  peerProbe()
    .refresh()
    .catch(() => undefined);
}

/**
 * `darius serve` turns the probe on with its own port: the other hosts are asked on the same port.
 * With `refreshMs` (serve passes PEER_REFRESH_MS) it also probes on its own: once at the start,
 * then every `refreshMs`, so pages only read the cache. Null turns the probe and the timer off.
 * The timer does not keep the process alive.
 */
export function enablePeerProbe(port: number | null, refreshMs: number | null = null): void {
  stopRefresh();
  probePort = port;
  probe = null;
  if (port === null || refreshMs === null) return;
  firstRefresh = setTimeout(refreshNow, 0);
  firstRefresh.unref();
  refresher = setInterval(refreshNow, refreshMs);
  refresher.unref();
}

/** The hosts the ledgers here know, for the probe. */
export function knownHosts(): KnownHost[] {
  return collectFleet()
    .hosts.filter((host) => !host.retired)
    .map((host) => ({ host: host.host, self: host.self, lastSeen: host.lastSeen, version: host.version }));
}

function peerProbe(): PeerProbe {
  const key = `${stateDir()}\u0000${configDir()}\u0000${String(probePort)}`;
  if (probe?.key !== key) {
    const port = probePort;
    probe = {
      key,
      probe: new PeerProbe({ self: () => collectHostLive(), known: knownHosts, port: () => port ?? 0, overrides: readWebPeers, fetch: port === null ? null : hostFetch }),
    };
  }
  return probe.probe;
}

/** Every host of this store with its state, from the probe of this process; waits for a probe when the cache is old. */
export function peerHosts(): Promise<PeerHost[]> {
  return peerProbe().hosts();
}

/** Every host of this store with its state, at once: the cache, else `checking` while the first probe runs (0.140.0). */
export function currentPeerHosts(): PeerHost[] {
  return peerProbe().current();
}
