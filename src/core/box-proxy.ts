/**
 * The box proxy: the only way out of the box.
 *
 * A run in the box has no network of its own. This proxy runs outside, in the
 * runner process, on one Unix socket per run. It takes HTTP `CONNECT host:port`
 * and absolute-form plain HTTP (`GET http://host/...`), and nothing else.
 *
 * Each request is decided by `decide`, a pure function of the target and the
 * policy. The name is resolved once, every address is checked, and the
 * connection goes to a checked address. There is no second lookup, so a name
 * cannot rebind between the check and the connect.
 *
 * Always refused, even when listed: loopback, unspecified, link-local,
 * multicast, reserved, every address of this host, and the darius web ports on
 * any non-public address. Private ranges (10/8, 172.16/12, 192.168/16,
 * 100.64/10, fc00::/7) need a `reach` entry, and so does port 22 to any host:
 * the operator's ssh agent is in the box. Address parsing is strict: IPv4 is
 * dotted decimal only. IPv4-mapped IPv6 and NAT64 (`64:ff9b::/96`) are judged
 * as their IPv4, also against this host's addresses and the web hosts. The
 * local-use NAT64 prefix `64:ff9b:1::/48` can reach anything behind its
 * translator, so it is private: refused unless a `reach` entry names it.
 *
 * This host's addresses are read again for each decision and merged with the
 * policy's list, so an address that appears during a run is refused too. A
 * plain HTTP request gets one upstream connection: the proxy sends
 * `Connection: close`, forwards exactly the body its `Content-Length` names,
 * and passes nothing more of the client's bytes, so a second request cannot
 * ride on a checked connection. A chunked request body is refused.
 *
 * Design: the private workspace note "box design", section "Network".
 */

import { lookup } from "node:dns/promises";
import { chmodSync, unlinkSync } from "node:fs";
import { connect, createServer, isIPv6 } from "node:net";
import type { Server, Socket } from "node:net";
import { networkInterfaces } from "node:os";

import { errorMessage } from "../runtime.ts";

export interface HostPort {
  host: string;
  port: number;
}

export type NetMode = "public" | "listed" | "none";

export interface BoxPolicy {
  /** `public`: public addresses plus `reach` and `harnessHosts`. `listed`: those two. `none`: `harnessHosts` only. */
  net: NetMode;
  /** The ritual's `host:port` pairs. The only way to a private address. */
  reach: HostPort[];
  /** The harness API, as the adapter names it. Allowed in every mode, never to a private address. */
  harnessHosts: HostPort[];
  /** Every address of this host. Always refused. */
  ownAddresses: string[];
  /**
   * Every subnet of this host's interfaces, as `address/prefix` (v4 and v6).
   * An address inside one is private, public or not: a LAN device by its
   * global IPv6 needs a reach entry too.
   */
  ownSubnets: string[];
  /**
   * The darius web ports. An entry with host `""` is port only: that port on any
   * non-public address. An entry with a host also refuses that host (by name, or
   * by address for an address literal) on that port, public or not. The launch
   * adds each web host's addresses as entries of their own (`withWebAddresses`).
   */
  webPorts: HostPort[];
}

/** What the proxy was asked for, and every address the name resolved to. */
export interface Target {
  host: string;
  port: number;
  addresses: string[];
}

export type AllowRule = "public" | "reach" | "harness";

export type RefuseRule =
  | "bad-request"
  | "header-too-long"
  | "too-many-tunnels"
  | "bad-host"
  | "bad-port"
  | "ipv4-form"
  | "no-address"
  | "bad-address"
  | "loopback"
  | "unspecified"
  | "link-local"
  | "multicast"
  | "reserved"
  | "this-host"
  | "web-port"
  | "private"
  | "not-listed"
  | "ssh-not-listed"
  | "net-none";

export type Decision = { allow: true; rule: AllowRule; addresses: string[] } | { allow: false; rule: RefuseRule; reason: string };

export type Resolver = (name: string) => Promise<string[]>;

export type Decide = (target: Target, policy: BoxPolicy) => Decision;

export interface BoxProxyOptions {
  socketPath: string;
  policy: BoxPolicy;
  /** Takes one JSON line per decision, without the newline. */
  log: (line: string) => void;
  /** Tests inject one; the default asks the system resolver once. */
  resolve?: Resolver;
  /** Tests inject one for the end to end proof; the default is `decide`. */
  decide?: Decide;
  /** This host's addresses now, read for each decision. Tests inject one; the default reads the interfaces. */
  ownAddresses?: () => string[];
  /** This host's subnets now, read for each decision as `address/prefix`. Tests inject one; the default reads the interfaces. */
  ownSubnets?: () => string[];
  idleMs?: number;
  maxTunnels?: number;
}

export interface BoxProxy {
  close(): Promise<void>;
}

export const IDLE_MS = 10 * 60_000;
export const MAX_TUNNELS = 64;
export const MAX_HEADER_BYTES = 8 * 1024;
export const SSH_PORT = 22;
const RESOLVE_TIMEOUT_MS = 10_000;
const CONNECT_TIMEOUT_MS = 10_000;

// ---------------------------------------------------------------------------
// Addresses

type AddressClass = "public" | "private" | "loopback" | "unspecified" | "link-local" | "multicast" | "reserved";

const DOTTED_DECIMAL = /^(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/u;
const NUMERIC_LABEL = /^(?:0x[0-9a-f]*|\d+)$/u;
const NAME_LABEL = /^[a-z0-9_-]{1,63}$/u;
const HEX_GROUP = /^[0-9a-f]{1,4}$/u;

/** IPv4 in dotted decimal only: four parts, 0 to 255, no leading zeros. */
function parseIPv4(text: string): number[] | null {
  if (!DOTTED_DECIMAL.test(text)) return null;
  return text.split(".").map(Number);
}

function groupsOf(text: string): number[] | null {
  if (text === "") return [];
  const groups = text.split(":");
  if (!groups.every((group) => HEX_GROUP.test(group))) return null;
  return groups.map((group) => Number.parseInt(group, 16));
}

/** IPv6 as 16 bytes. No zone id. A dotted-decimal tail is allowed, strict as IPv4. */
function parseIPv6(input: string): number[] | null {
  const text = input.toLowerCase();
  if (!isIPv6(text) || text.includes("%")) return null;
  let head = text;
  let tail: number[] = [];
  const lastColon = text.lastIndexOf(":");
  if (text.slice(lastColon + 1).includes(".")) {
    const v4 = parseIPv4(text.slice(lastColon + 1));
    if (v4 === null) return null;
    tail = [((v4[0] ?? 0) << 8) | (v4[1] ?? 0), ((v4[2] ?? 0) << 8) | (v4[3] ?? 0)];
    head = text.slice(0, lastColon + 1);
    if (!head.endsWith("::")) head = head.slice(0, -1);
  }
  const want = 8 - tail.length;
  const halves = head.split("::");
  if (halves.length > 2) return null;
  const left = groupsOf(halves[0] ?? "");
  const right = halves.length === 2 ? groupsOf(halves[1] ?? "") : [];
  if (left === null || right === null) return null;
  if (halves.length === 1 && left.length !== want) return null;
  if (halves.length === 2 && left.length + right.length > want - 1) return null;
  const zeros = Array.from({ length: want - left.length - right.length }, () => 0);
  return [...left, ...zeros, ...right, ...tail].flatMap((group) => [group >> 8, group & 0xff]);
}

/** An address as bytes: 4 for IPv4, 16 for IPv6. IPv4-mapped and NAT64 IPv6 come back as their IPv4. */
function addressBytes(text: string): number[] | null {
  const v4 = parseIPv4(text);
  if (v4 !== null) return v4;
  const v6 = parseIPv6(text);
  if (v6 === null) return null;
  return unwrapIPv4(v6);
}

function isMapped(bytes: readonly number[]): boolean {
  return bytes.slice(0, 10).every((byte) => byte === 0) && bytes[10] === 0xff && bytes[11] === 0xff;
}

/** `::ffff:0:0/96`, IPv4-translated (RFC 2765): the last four bytes are the IPv4 it reaches. */
function isTranslated(bytes: readonly number[]): boolean {
  return bytes.slice(0, 8).every((byte) => byte === 0) && bytes[8] === 0xff && bytes[9] === 0xff && bytes[10] === 0 && bytes[11] === 0;
}

/** `64:ff9b::/96`, the well-known NAT64 prefix: the last four bytes are the IPv4 it reaches. */
function isNat64(bytes: readonly number[]): boolean {
  return bytes[0] === 0x00 && bytes[1] === 0x64 && bytes[2] === 0xff && bytes[3] === 0x9b && bytes.slice(4, 12).every((byte) => byte === 0);
}

/** `64:ff9b:1::/48`, the local-use NAT64 prefix (RFC 8215): what it reaches is up to the local translator. */
function isLocalNat64(bytes: readonly number[]): boolean {
  return bytes[0] === 0x00 && bytes[1] === 0x64 && bytes[2] === 0xff && bytes[3] === 0x9b && bytes[4] === 0x00 && bytes[5] === 0x01;
}

/** IPv6 bytes, or the IPv4 they carry for a mapped, translated or NAT64 address. */
function unwrapIPv4(bytes: number[]): number[] {
  return isMapped(bytes) || isTranslated(bytes) || isNat64(bytes) ? bytes.slice(12) : bytes;
}

function classifyIPv4(bytes: readonly number[]): AddressClass {
  const [a = 0, b = 0] = bytes;
  if (a === 0) return "unspecified";
  if (a === 127) return "loopback";
  if (a === 169 && b === 254) return "link-local";
  if (a >= 224 && a <= 239) return "multicast";
  if (a >= 240) return "reserved";
  if (a === 10) return "private";
  if (a === 172 && b >= 16 && b <= 31) return "private";
  if (a === 192 && b === 168) return "private";
  if (a === 100 && b >= 64 && b <= 127) return "private";
  // 198.18.0.0/15, benchmarking networks; 192.0.0.0/24, IETF protocol assignments.
  if (a === 198 && (b === 18 || b === 19)) return "private";
  if (a === 192 && b === 0 && bytes[2] === 0) return "private";
  return "public";
}

function classifyIPv6(bytes: readonly number[]): AddressClass {
  const [a = 0, b = 0] = bytes;
  const first12Zero = bytes.slice(0, 12).every((byte) => byte === 0);
  if (first12Zero && bytes.slice(12, 15).every((byte) => byte === 0) && bytes[15] === 0) return "unspecified";
  if (first12Zero && bytes.slice(12, 15).every((byte) => byte === 0) && bytes[15] === 1) return "loopback";
  // ::a.b.c.d, the old IPv4-compatible form. Nothing routes it.
  if (first12Zero) return "reserved";
  // NAT64 (64:ff9b::/96) and 6to4 (2002::/16) reach an embedded IPv4: judge that.
  if (isNat64(bytes)) return classifyIPv4(bytes.slice(12));
  if (isLocalNat64(bytes)) return "private";
  // Teredo (2001::/32) tunnels to an IPv4 the proxy cannot judge; 100::/64 is discard-only.
  if (a === 0x20 && b === 0x01 && bytes[2] === 0 && bytes[3] === 0) return "reserved";
  if (a === 0x01 && b === 0x00 && bytes.slice(2, 8).every((byte) => byte === 0)) return "reserved";
  if (a === 0x20 && b === 0x02) return classifyIPv4(bytes.slice(2, 6));
  if (a === 0xfe && (b & 0xc0) === 0x80) return "link-local";
  if (a === 0xfe && (b & 0xc0) === 0xc0) return "private";
  if (a === 0xff) return "multicast";
  if ((a & 0xfe) === 0xfc) return "private";
  return "public";
}

function classify(bytes: readonly number[]): AddressClass {
  return bytes.length === 4 ? classifyIPv4(bytes) : classifyIPv6(bytes);
}

function sameBytes(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}

/** A subnet as bytes and a prefix length. */
interface Subnet {
  bytes: number[];
  prefix: number;
}

/** `address/prefix`, or null when it does not parse. An IPv4-mapped v6 subnet counts as its IPv4. */
function parseSubnet(text: string): Subnet | null {
  const slash = text.lastIndexOf("/");
  if (slash < 0) return null;
  const prefixText = text.slice(slash + 1);
  const raw = parseIPv4(text.slice(0, slash)) ?? parseIPv6(text.slice(0, slash).toLowerCase());
  if (raw === null || !/^\d{1,3}$/u.test(prefixText)) return null;
  const prefix = Number(prefixText);
  if (prefix > raw.length * 8) return null;
  const bytes = unwrapIPv4(raw);
  return { bytes, prefix: bytes.length === raw.length ? prefix : Math.max(0, prefix - 96) };
}

function inSubnet(bytes: readonly number[], subnet: Subnet): boolean {
  if (bytes.length !== subnet.bytes.length) return false;
  for (let bit = 0; bit < subnet.prefix; bit += 1) {
    const mask = 0x80 >> (bit % 8);
    const index = Math.floor(bit / 8);
    if (((bytes[index] ?? 0) & mask) !== ((subnet.bytes[index] ?? 0) & mask)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Names

type Host = { kind: "address"; name: string; bytes: number[] } | { kind: "name"; name: string } | { kind: "bad"; rule: "bad-host" | "ipv4-form"; reason: string };

/**
 * The host as the proxy judges it. Lower case. An IPv6 literal comes without
 * brackets. One trailing dot on a name is dropped. A numeric last label that is
 * not strict dotted decimal (2130706433, 0177.0.0.1, 0x7f.1, 127.0.0.1.) is
 * refused before any lookup, because the system resolver reads those as IPv4.
 */
export function judgeHost(input: string): Host {
  const raw = input.toLowerCase();
  if (raw.includes(":")) {
    const bytes = parseIPv6(raw);
    return bytes === null ? { kind: "bad", rule: "bad-host", reason: `not an IPv6 address: ${input}` } : { kind: "address", name: raw, bytes: unwrapIPv4(bytes) };
  }
  const v4 = parseIPv4(raw);
  if (v4 !== null) return { kind: "address", name: raw, bytes: v4 };
  const trailingDot = raw.endsWith(".");
  const name = trailingDot ? raw.slice(0, -1) : raw;
  const labels = name.split(".");
  const last = labels.at(-1) ?? "";
  if (NUMERIC_LABEL.test(last)) {
    const why = trailingDot && parseIPv4(name) !== null ? "an IPv4 address with a trailing dot" : "IPv4 in a form other than dotted decimal";
    return { kind: "bad", rule: "ipv4-form", reason: `${input} is ${why}` };
  }
  if (name.length === 0 || name.length > 253 || !labels.every((label) => NAME_LABEL.test(label))) return { kind: "bad", rule: "bad-host", reason: `not a host name: ${input}` };
  return { kind: "name", name };
}

/** One canonical key for a host, so `[::1]`, `0:0::1` and `::1` match, and so do `Example.com.` and `example.com`. */
function hostKey(input: string): string {
  const host = judgeHost(input);
  if (host.kind === "address") return host.bytes.join(".");
  if (host.kind === "name") return host.name;
  return `bad:${input}`;
}

function listed(list: readonly HostPort[], key: string, port: number): boolean {
  return list.some((entry) => entry.port === port && hostKey(entry.host) === key);
}

/** Parses `host:port` or `[v6]:port`. The port is required. Throws on anything else. */
export function parseHostPort(text: string): HostPort {
  const bracketed = /^\[([^\]]+)\]:(\d+)$/u.exec(text);
  const plain = /^([^:[\]]+):(\d+)$/u.exec(text);
  const match = bracketed ?? plain;
  if (match === null) throw new Error(`not host:port (an IPv6 address needs brackets): ${text}`);
  const host = match[1] ?? "";
  const portText = match[2] ?? "";
  if (bracketed !== null && parseIPv6(host) === null) throw new Error(`not an IPv6 address in brackets: ${text}`);
  const port = Number(portText);
  if (!/^[1-9]\d{0,4}$/u.test(portText) || port > 65_535) throw new Error(`not a port from 1 to 65535: ${text}`);
  return { host: host.toLowerCase(), port };
}

// ---------------------------------------------------------------------------
// The decision

function refuse(rule: RefuseRule, reason: string): Decision {
  return { allow: false, rule, reason };
}

/** The rule that refuses an address class always, even when listed, or null for public and private. */
function alwaysRefused(kind: AddressClass): RefuseRule | null {
  switch (kind) {
    case "loopback":
    case "unspecified":
    case "link-local":
    case "multicast":
    case "reserved":
      return kind;
    case "public":
    case "private":
      return null;
  }
}

/**
 * The fixed rule for one target. Pure: the tests drive it without a socket.
 * The addresses are what the name resolved to; for an address literal the
 * literal itself is the only address, whatever `addresses` says.
 */
export function decide(target: Target, policy: BoxPolicy): Decision {
  const { port } = target;
  if (!Number.isInteger(port) || port < 1 || port > 65_535) return refuse("bad-port", `not a port from 1 to 65535: ${port}`);
  const host = judgeHost(target.host);
  if (host.kind === "bad") return refuse(host.rule, host.reason);
  if (host.kind === "name" && (host.name === "localhost" || host.name.endsWith(".localhost"))) return refuse("loopback", `${host.name} is this host`);
  const addresses = host.kind === "address" ? [host.name] : target.addresses;
  if (addresses.length === 0) return refuse("no-address", `${host.name} resolved to no address`);

  const own = policy.ownAddresses.map(addressBytes).filter((bytes) => bytes !== null);
  const subnets = policy.ownSubnets.map(parseSubnet).filter((subnet) => subnet !== null);
  const checked: { text: string; bytes: number[]; kind: AddressClass }[] = [];
  for (const text of addresses) {
    const bytes = addressBytes(text);
    if (bytes === null) return refuse("bad-address", `${host.name} resolved to something that is not an address: ${text}`);
    const classified = classify(bytes);
    const always = alwaysRefused(classified);
    if (always !== null) return refuse(always, `${host.name} resolves to ${text}, ${classified}`);
    if (own.some((mine) => sameBytes(mine, bytes))) return refuse("this-host", `${host.name} resolves to ${text}, an address of this host`);
    // A neighbour on one of this host's networks is private, whatever its class: a LAN device by its global IPv6, say.
    const kind = classified === "public" && subnets.some((subnet) => inSubnet(bytes, subnet)) ? "private" : classified;
    checked.push({ text, bytes, kind });
  }

  const key = hostKey(host.name);
  for (const web of policy.webPorts) {
    if (web.port !== port) continue;
    const named = web.host !== "" && (hostKey(web.host) === key || checked.some((entry) => hostKey(web.host) === entry.bytes.join(".")));
    if (named) return refuse("web-port", `${host.name}:${port} is the darius web page`);
    const inner = checked.find((entry) => entry.kind !== "public");
    if (inner !== undefined) return refuse("web-port", `port ${port} is a darius web port, and ${inner.text} is not public`);
  }

  const inReach = listed(policy.reach, key, port);
  const inHarness = listed(policy.harnessHosts, key, port);
  const inner = checked.find((entry) => entry.kind !== "public");
  if (inner !== undefined && !inReach) return refuse("private", `${host.name} resolves to ${inner.text}, a private address, and ${host.name}:${port} is not in reach`);

  // ssh goes through this proxy, and the operator's ssh agent is in the box. Port 22 to any host
  // would lend the operator's identity, so it passes only by a reach entry, in every net mode.
  if (port === SSH_PORT && !inReach) return refuse("ssh-not-listed", `port ${SSH_PORT} needs a reach entry, and ${host.name}:${port} is not in reach`);

  const allowed = checked.map((entry) => entry.text);
  if (policy.net === "none") return inHarness ? { allow: true, rule: "harness", addresses: allowed } : refuse("net-none", `net is none, and ${host.name}:${port} is not a harness host`);
  if (inReach) return { allow: true, rule: "reach", addresses: allowed };
  if (inHarness) return { allow: true, rule: "harness", addresses: allowed };
  if (policy.net === "listed") return refuse("not-listed", `net is listed, and ${host.name}:${port} is not in reach`);
  return { allow: true, rule: "public", addresses: allowed };
}

/** Every address of this host's interfaces, plus `extra` (the tailnet address). */
export function hostAddresses(extra: readonly string[] = []): string[] {
  const found = Object.values(networkInterfaces()).flatMap((entries) => (entries ?? []).map((entry) => entry.address));
  return [...new Set([...found, ...extra])];
}

/** Every subnet of this host's interfaces, as `address/prefix`. */
export function hostSubnets(): string[] {
  const found = Object.values(networkInterfaces()).flatMap((entries) => (entries ?? []).flatMap((entry) => (entry.cidr === null ? [] : [entry.cidr])));
  return [...new Set(found)];
}

/** The start list plus what `read` gives now. A read that fails, or an entry `isGood` rejects, adds nothing. */
function currentList(start: readonly string[], read: () => string[], isGood: (text: string) => boolean): string[] {
  let now: string[] = [];
  try {
    now = read().filter(isGood);
  } catch {
    // The start list still holds.
  }
  return [...new Set([...start, ...now])];
}

/** The start list plus the addresses this host has now. */
function currentOwnAddresses(start: readonly string[], read: () => string[]): string[] {
  return currentList(start, read, (address) => addressBytes(address) !== null);
}

/** The start list plus the subnets this host has now. */
function currentOwnSubnets(start: readonly string[], read: () => string[]): string[] {
  return currentList(start, read, (subnet) => parseSubnet(subnet) !== null);
}

/**
 * The web ports plus, for each entry that names a host, one entry per address
 * that name resolves to now, on the same port. So the web page is refused by
 * address too, also when the run asks for it under another name. A name that
 * does not resolve keeps its name entry only.
 */
export async function withWebAddresses(entries: readonly HostPort[], resolve: Resolver = systemResolve): Promise<HostPort[]> {
  const added: HostPort[] = [];
  for (const entry of entries) {
    const host = judgeHost(entry.host);
    if (host.kind !== "name") continue;
    const addresses = await resolve(host.name).catch((): string[] => []);
    for (const address of addresses) {
      if (judgeHost(address).kind === "address") added.push({ host: address.toLowerCase(), port: entry.port });
    }
  }
  const seen = new Set<string>();
  return [...entries, ...added].filter((entry) => {
    const key = `${entry.host}|${String(entry.port)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Throws on a policy the proxy cannot judge by, so a typo never widens it. */
export function checkPolicy(policy: BoxPolicy): void {
  if (!["public", "listed", "none"].includes(policy.net)) throw new Error(`net must be public, listed or none: ${policy.net}`);
  for (const entry of [...policy.reach, ...policy.harnessHosts]) {
    if (judgeHost(entry.host).kind === "bad") throw new Error(`not a host: ${entry.host}`);
    if (!Number.isInteger(entry.port) || entry.port < 1 || entry.port > 65_535) throw new Error(`not a port from 1 to 65535: ${entry.host}:${entry.port}`);
  }
  for (const address of policy.ownAddresses) {
    if (addressBytes(address) === null) throw new Error(`not an address of this host: ${address}`);
  }
  for (const subnet of policy.ownSubnets) {
    if (parseSubnet(subnet) === null) throw new Error(`not a subnet of this host: ${subnet}`);
  }
  for (const entry of policy.webPorts) {
    if (entry.host !== "" && judgeHost(entry.host).kind === "bad") throw new Error(`not a web host: ${entry.host}`);
    if (!Number.isInteger(entry.port) || entry.port < 1 || entry.port > 65_535) throw new Error(`not a web port: ${entry.port}`);
  }
}

// ---------------------------------------------------------------------------
// The request

export type ProxyRequest =
  | { kind: "connect"; host: string; port: number; rest: Buffer }
  | { kind: "http"; host: string; port: number; method: string; version: string; path: string; authority: string; headers: [string, string][]; bodyLength: number; rest: Buffer };

export type RequestError = { kind: "error"; status: 400 | 431; reason: string };

const METHODS = new Set(["GET", "HEAD", "POST", "PUT", "DELETE", "OPTIONS", "PATCH", "TRACE"]);
const TOKEN = /^[!#$%&'*+.^_`|~0-9a-z-]+$/iu;
const HOP_BY_HOP = new Set(["connection", "keep-alive", "proxy-connection", "proxy-authorization", "proxy-authenticate", "upgrade", "host", "te", "trailer"]);
const CONTENT_LENGTH = /^\d{1,15}$/u;

function bad(reason: string): RequestError {
  return { kind: "error", status: 400, reason };
}

/** The body length of a plain HTTP request: its one `Content-Length`, else 0. A chunked or unclear length is refused. */
function bodyLength(headers: readonly [string, string][]): { kind: "length"; bytes: number } | RequestError {
  if (headers.some(([name]) => name.toLowerCase() === "transfer-encoding")) return bad("a chunked request body is not taken: send Content-Length");
  const values = [...new Set(headers.filter(([name]) => name.toLowerCase() === "content-length").map(([, value]) => value))];
  if (values.length === 0) return { kind: "length", bytes: 0 };
  const [value = ""] = values;
  if (values.length > 1 || !CONTENT_LENGTH.test(value)) return bad("the request has more than one Content-Length, or one that is not a number");
  return { kind: "length", bytes: Number(value) };
}

/** The end of the header block, or -1 while it is not complete. Only CRLF line ends count. */
export function headerEnd(buffer: Buffer): number {
  return buffer.indexOf("\r\n\r\n");
}

/** Parses one complete header block (`head` without the blank line). `rest` is whatever followed it. */
export function parseRequest(head: string, rest: Buffer): ProxyRequest | RequestError {
  if (Buffer.byteLength(head) > MAX_HEADER_BYTES) return { kind: "error", status: 431, reason: `the header is over ${MAX_HEADER_BYTES} bytes` };
  const lines = head.split("\r\n");
  const parts = (lines[0] ?? "").split(" ");
  if (parts.length !== 3) return bad("the request line is not METHOD TARGET VERSION");
  const [method = "", target = "", version = ""] = parts;
  if (version !== "HTTP/1.1" && version !== "HTTP/1.0") return bad(`not HTTP/1.0 or HTTP/1.1: ${version}`);

  const headers: [string, string][] = [];
  for (const line of lines.slice(1)) {
    const colon = line.indexOf(":");
    const name = line.slice(0, colon);
    if (colon < 1 || !TOKEN.test(name)) return bad("a header line is not name: value");
    if (/[\0\r\n]/u.test(line)) return bad("a header line has a control character");
    headers.push([name, line.slice(colon + 1).trim()]);
  }

  if (method === "CONNECT") {
    try {
      const { host, port } = parseHostPort(target);
      return { kind: "connect", host, port, rest };
    } catch (cause) {
      return bad(errorMessage(cause));
    }
  }
  if (!METHODS.has(method)) return bad(`not a method this proxy takes: ${method}`);
  const absolute = /^http:\/\/([^/?#]+)([/?][^#]*)?$/iu.exec(target);
  if (absolute === null) return bad("plain HTTP needs the absolute form, http://host/path; use CONNECT for https");
  const authority = absolute[1] ?? "";
  if (authority.includes("@")) return bad("a user name in the URL is not taken");
  const withPort = /:\d+$/u.test(authority) ? authority : `${authority}:80`;
  const length = bodyLength(headers);
  if (length.kind === "error") return length;
  try {
    const { host, port } = parseHostPort(withPort);
    const raw = absolute[2] ?? "/";
    const path = raw.startsWith("?") ? `/${raw}` : raw;
    return { kind: "http", host, port, method, version, path, authority, headers, bodyLength: length.bytes, rest };
  } catch (cause) {
    return bad(errorMessage(cause));
  }
}

/** The request as the origin server gets it: origin form, hop-by-hop headers gone, one request per connection. */
function originRequest(request: Extract<ProxyRequest, { kind: "http" }>): string {
  const kept = request.headers.filter(([name]) => !HOP_BY_HOP.has(name.toLowerCase()));
  const lines = [`${request.method} ${request.path} ${request.version}`, `Host: ${request.authority}`, ...kept.map(([name, value]) => `${name}: ${value}`), "Connection: close"];
  return `${lines.join("\r\n")}\r\n\r\n`;
}

// ---------------------------------------------------------------------------
// The server

type Status = 400 | 403 | 431 | 502 | 503;

function statusText(status: Status): string {
  switch (status) {
    case 400:
      return "Bad Request";
    case 403:
      return "Forbidden";
    case 431:
      return "Request Header Fields Too Large";
    case 502:
      return "Bad Gateway";
    case 503:
      return "Service Unavailable";
  }
}

function reply(socket: Socket, status: Status, line: string): void {
  const body = `${line}\n`;
  socket.end(`HTTP/1.1 ${status} ${statusText(status)}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`);
}

async function systemResolve(name: string): Promise<string[]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`no answer for ${name} in ${RESOLVE_TIMEOUT_MS / 1000} s`)), RESOLVE_TIMEOUT_MS);
  });
  try {
    const found = await Promise.race([lookup(name, { all: true }), timeout]);
    return found.map((entry) => entry.address);
  } finally {
    clearTimeout(timer);
  }
}

/** Connects to the first checked address that answers, in the resolver's order. */
function connectFirst(addresses: readonly string[], port: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const attempt = (index: number, last: string): void => {
      const address = addresses[index];
      if (address === undefined) {
        reject(new Error(last));
        return;
      }
      const upstream = connect({ host: address, port });
      const fail = (reason: string): void => {
        upstream.destroy();
        attempt(index + 1, reason);
      };
      upstream.setTimeout(CONNECT_TIMEOUT_MS, () => fail(`${address}:${port} did not answer`));
      upstream.once("error", (cause) => fail(`${address}:${port}: ${errorMessage(cause)}`));
      upstream.once("connect", () => {
        upstream.setTimeout(0);
        upstream.removeAllListeners("error");
        resolve(upstream);
      });
    };
    attempt(0, "no address");
  });
}

/**
 * Sends upstream exactly the body that the request's Content-Length names, and
 * nothing after it: one request per upstream connection. The upstream got
 * `Connection: close`, so it closes after its response, and the client
 * connection closes with it. A byte the client sends after the body is a next
 * request: the proxy then closes both connections, and the client starts a
 * new one, which is checked again.
 */
function forwardBody(client: Socket, upstream: Socket, request: Extract<ProxyRequest, { kind: "http" }>): void {
  let left = request.bodyLength;
  const send = (chunk: Buffer): void => {
    const part = chunk.subarray(0, left);
    left -= part.length;
    if (part.length > 0) upstream.write(part);
    if (chunk.length > part.length) {
      upstream.destroy();
      client.destroy();
    }
  };
  send(request.rest);
  client.on("data", send);
  client.resume();
}

interface Logged {
  host: string;
  port: number;
  addresses: string[];
  decision: Decision;
}

/**
 * Starts the proxy on `socketPath`, mode 0600. The socket must not exist yet.
 * `close` stops it, ends every tunnel and removes the socket.
 */
export async function startBoxProxy(options: BoxProxyOptions): Promise<BoxProxy> {
  const { socketPath, policy, log } = options;
  checkPolicy(policy);
  const resolve = options.resolve ?? systemResolve;
  const judge = options.decide ?? decide;
  const readOwn = options.ownAddresses ?? (() => hostAddresses());
  const readSubnets = options.ownSubnets ?? hostSubnets;
  const idleMs = options.idleMs ?? IDLE_MS;
  const maxTunnels = options.maxTunnels ?? MAX_TUNNELS;
  const open = new Set<Socket>();
  // The tunnel limit counts the client connections in this set: taken at accept,
  // given back once, when the request is refused or the connection closes. A
  // Set cannot count a connection twice or go below zero.
  const slots = new Set<Socket>();

  const record = ({ host, port, addresses, decision }: Logged): void => {
    log(JSON.stringify({ time: new Date().toISOString(), host, port, addresses, decision: decision.allow ? "allow" : "refuse", rule: decision.rule }));
  };

  const track = (socket: Socket): void => {
    open.add(socket);
    socket.setTimeout(idleMs, () => socket.destroy());
    socket.once("close", () => open.delete(socket));
    socket.on("error", () => socket.destroy());
  };

  /**
   * The last answer on a client connection: its slot is free at once, the
   * reply goes out, and what the client still sends is read and dropped, so the
   * client's close is seen and the socket ends. A paused socket with unread
   * bytes never sees that close, under node or bun.
   */
  const finish = (client: Socket, status: Status, line: string): void => {
    slots.delete(client);
    reply(client, status, line);
    client.resume();
  };

  const refuseRequest = (client: Socket, status: Status, logged: Logged): void => {
    record(logged);
    const target = logged.host === "" ? "" : ` ${logged.host}:${logged.port}`;
    const reason = logged.decision.allow ? "" : `: ${logged.decision.reason}`;
    finish(client, status, `darius box: refused${target} (${logged.decision.rule})${reason}`);
  };

  const serve = async (client: Socket, request: ProxyRequest): Promise<void> => {
    const host = judgeHost(request.host);
    let addresses: string[] = [];
    if (host.kind === "address") addresses = [host.name];
    if (host.kind === "name") addresses = await resolve(host.name).catch(() => []);
    const decision = judge({ host: request.host, port: request.port, addresses }, {
      ...policy,
      ownAddresses: currentOwnAddresses(policy.ownAddresses, readOwn),
      ownSubnets: currentOwnSubnets(policy.ownSubnets, readSubnets),
    });
    const logged = { host: request.host, port: request.port, addresses, decision };
    if (!decision.allow) {
      refuseRequest(client, 403, logged);
      return;
    }
    record(logged);
    let upstream: Socket;
    try {
      upstream = await connectFirst(decision.addresses, request.port);
    } catch (cause) {
      finish(client, 502, `darius box: ${request.host}:${request.port} did not connect: ${errorMessage(cause)}`);
      return;
    }
    if (client.destroyed) {
      upstream.destroy();
      return;
    }
    track(upstream);
    upstream.once("close", () => client.destroy());
    client.once("close", () => upstream.destroy());
    upstream.pipe(client);
    if (request.kind === "http") {
      upstream.write(originRequest(request));
      forwardBody(client, upstream, request);
      return;
    }
    client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    if (request.rest.length > 0) upstream.write(request.rest);
    client.pipe(upstream);
    client.resume();
  };

  const accept = (client: Socket): void => {
    track(client);
    // The limit is judged at accept, so a burst gets the free slots in order. A
    // connection over it takes no slot, and is refused once its header names the target.
    const hasSlot = slots.size < maxTunnels;
    if (hasSlot) {
      slots.add(client);
      client.once("close", () => slots.delete(client));
    }
    let buffer = Buffer.alloc(0);
    const onData = (chunk: Buffer): void => {
      buffer = Buffer.concat([buffer, chunk]);
      const end = headerEnd(buffer);
      if (end === -1) {
        if (buffer.length > MAX_HEADER_BYTES) {
          client.off("data", onData);
          refuseRequest(client, 431, { host: "", port: 0, addresses: [], decision: refuse("header-too-long", `the header is over ${MAX_HEADER_BYTES} bytes`) });
        }
        return;
      }
      client.off("data", onData);
      client.pause();
      const request = parseRequest(buffer.subarray(0, end).toString("latin1"), buffer.subarray(end + 4));
      if (request.kind === "error") {
        const rule = request.status === 431 ? "header-too-long" : "bad-request";
        refuseRequest(client, request.status, { host: "", port: 0, addresses: [], decision: refuse(rule, request.reason) });
        return;
      }
      if (!hasSlot) {
        refuseRequest(client, 503, { host: request.host, port: request.port, addresses: [], decision: refuse("too-many-tunnels", `at most ${maxTunnels} open tunnels`) });
        return;
      }
      serve(client, request).catch((cause) => {
        finish(client, 502, `darius box: ${errorMessage(cause)}`);
      });
    };
    client.on("data", onData);
  };

  const server: Server = createServer({ allowHalfOpen: false, pauseOnConnect: false }, accept);
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(socketPath, () => {
      server.off("error", rejectListen);
      resolveListen();
    });
  });
  try {
    chmodSync(socketPath, 0o600);
  } catch (cause) {
    server.close();
    throw cause;
  }

  return {
    close: () =>
      new Promise<void>((resolveClose) => {
        server.close(() => {
          try {
            unlinkSync(socketPath);
          } catch {
            // Already gone: node removes a Unix socket it listened on when the server closes.
          }
          resolveClose();
        });
        for (const socket of open) socket.destroy();
      }),
  };
}
