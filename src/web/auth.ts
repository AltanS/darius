/**
 * Who may see the web page (docs/concept.md, "Web status page" >
 * "Access"). The page has no login of its own: identity comes from the
 * tailnet. For a caller on the tailnet, darius asks the local tailscaled who
 * it is (`tailscale whois --json <ip>`). The caller passes when its node is
 * owned by an allowed login and is not a tagged node (servers carry tags
 * and belong to no person). A caller on loopback is on this host and always
 * passes. Everything else, and every failure to ask, is refused: the check
 * fails closed.
 *
 * Allowed logins: `$DARIUS_WEB_ALLOW` (comma separated), else the login
 * that owns this host's own node.
 *
 * Behind a reverse proxy (0.30.0) every request comes from the proxy's
 * address, so `whois` would name the proxy, not the person. With
 * `$DARIUS_WEB_PROXY` set to the proxy's addresses, a request from one of
 * them passes only when the proxy names the calling device in a header
 * (`$DARIUS_WEB_PROXY_HEADER`, default `X-Tailnet-Device`) and that device
 * is in `$DARIUS_WEB_PROXY_DEVICES`. The header counts only from those
 * addresses: any other caller that sends it is judged as before, so it
 * cannot name itself. A proxy on this host (loopback) works the same way,
 * and then a loopback request without the header is refused.
 */

import { spawn } from "node:child_process";

import type { JsonValue } from "../core/model.ts";
import { errorMessage } from "../runtime.ts";

export interface Whois {
  /** The owning user's login name; tagged nodes have none. */
  login: string | null;
  node: string | null;
  tagged: boolean;
}

/** Asks tailscaled about one tailnet address; null when it does not know it. Throws when it cannot ask. */
export type WhoisLookup = (address: string) => Promise<Whois | null>;

export type Access = { allowed: true; who: string } | { allowed: false; reason: string };

const TAILSCALE_TIMEOUT_MS = 5_000;
const CACHE_MS = 60_000;

/** `::ffff:100.64.1.10` and `100.64.1.10` are one caller. */
export function normalizeAddress(address: string): string {
  return address.startsWith("::ffff:") ? address.slice("::ffff:".length) : address;
}

export function isLoopback(address: string): boolean {
  const plain = normalizeAddress(address);
  return plain === "::1" || plain.startsWith("127.");
}

/** Runs `tailscale <args>` and returns its stdout. Throws with its stderr on a non-zero exit. */
export function runTailscale(args: readonly string[]): Promise<string> {
  const bin = process.env.DARIUS_TAILSCALE ?? "tailscale";
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), TAILSCALE_TIMEOUT_MS);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (cause) => {
      clearTimeout(timer);
      reject(new Error(`tailscale did not run: ${errorMessage(cause)}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(`tailscale ${args.join(" ")} exited ${String(code)}: ${stderr.trim().slice(0, 200)}`));
    });
  });
}

function isRecord(value: JsonValue | undefined): value is { readonly [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isText(value: JsonValue | undefined): value is string {
  return typeof value === "string" && value !== "";
}

function field(record: JsonValue | undefined, key: string): JsonValue | undefined {
  return isRecord(record) ? record[key] : undefined;
}

/** Parses `tailscale whois --json`. Exported for tests. */
export function parseWhois(stdout: string): Whois {
  const parsed: JsonValue = JSON.parse(stdout);
  const node = field(parsed, "Node");
  const tags = field(node, "Tags");
  const tagged = Array.isArray(tags) && tags.length > 0;
  const login = field(field(parsed, "UserProfile"), "LoginName");
  const computed = field(node, "ComputedName");
  const name = field(node, "Name");
  return {
    login: tagged || !isText(login) ? null : login,
    node: isText(computed) ? computed : isText(name) ? name : null,
    tagged,
  };
}

/** The real lookup, through the tailscale CLI. An unknown address comes back as null. */
export async function tailscaleWhois(address: string): Promise<Whois | null> {
  try {
    return parseWhois(await runTailscale(["whois", "--json", address]));
  } catch (cause) {
    if (/no match|not found|unknown/iu.test(errorMessage(cause))) return null;
    throw cause;
  }
}

/** This host's tailnet IPv4 address, or null when Tailscale is not up here. */
export async function tailnetAddress(): Promise<string | null> {
  try {
    const first = (await runTailscale(["ip", "-4"])).trim().split("\n")[0]?.trim() ?? "";
    return /^\d{1,3}(\.\d{1,3}){3}$/u.test(first) ? first : null;
  } catch {
    return null;
  }
}

/** Remembers answers for a minute, so a page load with its reload costs one lookup, not one per request. */
export function cachedWhois(lookup: WhoisLookup, now: () => number = Date.now): WhoisLookup {
  const cache = new Map<string, { at: number; whois: Whois | null }>();
  return async (address) => {
    const hit = cache.get(address);
    if (hit !== undefined && now() - hit.at < CACHE_MS) return hit.whois;
    const whois = await lookup(address);
    cache.set(address, { at: now(), whois });
    return whois;
  };
}

/** Whether `remote` may see the page. Never throws: a failed lookup refuses. */
export async function authorize(remote: string, context: { allow: ReadonlySet<string>; whois: WhoisLookup }): Promise<Access> {
  if (isLoopback(remote)) return { allowed: true, who: "this host" };
  const address = normalizeAddress(remote);
  let whois: Whois | null;
  try {
    whois = await context.whois(address);
  } catch (cause) {
    return { allowed: false, reason: `darius could not ask Tailscale who ${address} is (${errorMessage(cause)})` };
  }
  if (whois === null) return { allowed: false, reason: `${address} is not a device on this tailnet` };
  const node = whois.node ?? address;
  if (whois.tagged) return { allowed: false, reason: `${node} is a tagged device; tagged devices belong to no person` };
  if (whois.login === null || !context.allow.has(whois.login)) {
    return { allowed: false, reason: `${node} belongs to ${whois.login ?? "nobody"}, who is not allowed here` };
  }
  return { allowed: true, who: `${whois.login} on ${node}` };
}

/** A reverse proxy whose device header darius believes. */
export interface ProxyTrust {
  /** The proxy's own addresses, as the socket sees them. */
  addresses: ReadonlySet<string>;
  /** Lower case, as `Headers` stores it. */
  header: string;
  /** Device names the proxy may vouch for. */
  devices: ReadonlySet<string>;
}

export const DEFAULT_PROXY_HEADER = "X-Tailnet-Device";

function listOf(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item !== "");
}

/** The proxy from `$DARIUS_WEB_PROXY`, `$DARIUS_WEB_PROXY_HEADER` and `$DARIUS_WEB_PROXY_DEVICES`; null when no proxy is set. */
export function proxyTrust(env: NodeJS.ProcessEnv = process.env): ProxyTrust | null {
  const addresses = listOf(env.DARIUS_WEB_PROXY).map((address) => normalizeAddress(address));
  if (addresses.length === 0) return null;
  return {
    addresses: new Set(addresses),
    header: (env.DARIUS_WEB_PROXY_HEADER?.trim() || DEFAULT_PROXY_HEADER).toLowerCase(),
    devices: new Set(listOf(env.DARIUS_WEB_PROXY_DEVICES)),
  };
}

/**
 * Whether one request may see the page: through the proxy by its device
 * header, else by `authorize`. Never throws.
 */
export async function authorizeRequest(remote: string, headers: Headers, context: { allow: ReadonlySet<string>; whois: WhoisLookup; proxy: ProxyTrust | null }): Promise<Access> {
  const proxy = context.proxy;
  if (proxy === null || !proxy.addresses.has(normalizeAddress(remote))) return authorize(remote, context);
  const device = headers.get(proxy.header)?.trim() ?? "";
  if (device === "" || device === "unknown") return { allowed: false, reason: `the proxy at ${normalizeAddress(remote)} named no device (${proxy.header})` };
  if (!proxy.devices.has(device)) return { allowed: false, reason: `${device} is not in DARIUS_WEB_PROXY_DEVICES` };
  return { allowed: true, who: `${device} via the proxy` };
}

/** `$DARIUS_WEB_ALLOW`, else the login that owns this host's own node. Empty when neither is known. */
export async function allowedLogins(lookup: WhoisLookup = tailscaleWhois): Promise<Set<string>> {
  const fromEnv = listOf(process.env.DARIUS_WEB_ALLOW);
  if (fromEnv.length > 0) return new Set(fromEnv);
  const self = await tailnetAddress();
  if (self === null) return new Set();
  try {
    const whois = await lookup(self);
    return whois?.login === null || whois === null ? new Set() : new Set([whois.login]);
  } catch {
    return new Set();
  }
}
