/**
 * `darius serve [--bind ADDR] [--port N]`: the web status page of this host
 * (docs/concept.md, "App design" > "Web status page"). It shows the local
 * store, the djinns, rituals, recent runs with their findings, held
 * questions and open vigils, and the machine and its snapshots. The pages only
 * read; the API prefixes below are the only writes. `setup --systemd` installs it as the user
 * service `darius-web.service`.
 *
 *   GET /healthz             "ok", without an access check
 *   GET /api/status.json     the status as JSON
 *   /api/push/...            the notification button's endpoints
 *                            (src/web/push-api.ts)
 *   /api/snapshots/...       the backup controls: run now, settings, key
 *                            pair, bucket check, delete (src/web/snapshot-api.ts)
 *   POST /api/run/follow-up  the run page's follow-up button (0.48.0,
 *                            src/web/action-api.ts)
 *   POST /api/finding/close  the findings page's close button (0.62.0,
 *                            src/web/action-api.ts)
 *   GET /api/workspace-icon/<project>
 *                            the image icon a project's marker names
 *                            (0.70.0, src/web/workspace-icon.ts); 404 for
 *                            anything that is not a checked image
 *   GET <file>               a file of the built app (web/build/client)
 *   GET anything else        the web app (web/, React Router framework
 *                            mode): darius imports its committed server
 *                            build and hands it a WebContext (src/web/api.ts)
 *
 * When `git pull` puts another version or web build on disk, the next
 * request gets a 503 and the process exits 75, so systemd restarts it with
 * the new code (a Bun process cannot re-import a changed module).
 *
 * `--bind` (`$DARIUS_WEB_BIND`) takes one address, a comma list, or `auto`
 * (the default): loopback plus this host's tailnet address. When Tailscale
 * is not up yet, `auto` listens on loopback and tries the tailnet address
 * again every 30 s. Port 4747 (`$DARIUS_WEB_PORT`). An address that listens
 * on every interface (`0.0.0.0`, `::`) is refused.
 *
 * Every request but /healthz passes src/web/auth.ts first: loopback always,
 * a tailnet caller only when its device belongs to an allowed login
 * (`$DARIUS_WEB_ALLOW`, else the owner of this host). The rest get 403.
 * Behind a reverse proxy, `$DARIUS_WEB_PROXY` names the proxy, and a request
 * from it passes by the device the proxy names (see src/web/auth.ts).
 * `$DARIUS_WEB_URL` is the address people open, for example the proxy's
 * HTTPS name; serve prints it at start.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { extname, join, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { errorMessage } from "../runtime.ts";
import { allowedLogins, authorizeRequest, cachedWhois, proxyTrust, tailnetAddress, tailscaleWhois, type ProxyTrust, type WhoisLookup } from "../web/auth.ts";
import { ACTION_API_PREFIX, FINDING_API_PREFIX, actionApi, findingApi } from "../web/action-api.ts";
import type { WebHandler } from "../web/api.ts";
import { webContext } from "../web/context.ts";
import { plainPage, renderForbidden } from "../web/html.ts";
import { MAX_BODY, PUSH_API_PREFIX, pushApi } from "../web/push-api.ts";
import { SNAPSHOT_API_PREFIX, snapshotApi } from "../web/snapshot-api.ts";
import { collectStatus } from "../web/status.ts";
import { WORKSPACE_ICON_PREFIX, workspaceIconReply } from "../web/workspace-icon.ts";
import { VERSION } from "../version.ts";
import { UsageError, type Command, type ParsedArgs } from "./registry.ts";

export const DEFAULT_WEB_BIND = "auto";
const LOOPBACK = "127.0.0.1";
const TAILNET_RETRY_MS = 30_000;

function noRetry(): void {
  // Nothing to stop: no tailnet retry is pending.
}
export const DEFAULT_WEB_PORT = 4747;
const ANY_ADDRESS: ReadonlySet<string> = new Set(["0.0.0.0", "::", "[::]", "*", ""]);

function stringFlag(args: ParsedArgs, name: string): string | undefined {
  const value = args.flags[name];
  if (value === undefined || value === false) return undefined;
  if (value === true) throw new UsageError(`--${name} needs a value`);
  return value;
}

/** The addresses to listen on, or "auto". Refuses any address that means every interface. */
export function webBind(flag: string | undefined): string[] | "auto" {
  const raw = flag ?? process.env.DARIUS_WEB_BIND ?? DEFAULT_WEB_BIND;
  if (raw === "auto") return "auto";
  const binds = raw.split(",").map((bind) => bind.trim());
  for (const bind of binds) {
    if (ANY_ADDRESS.has(bind)) {
      throw new UsageError(`--bind ${bind || '""'} would listen on every interface; use auto, 127.0.0.1 or this host's tailnet address`);
    }
  }
  return binds;
}

export function webPort(flag: string | undefined): number {
  const raw = flag ?? process.env.DARIUS_WEB_PORT ?? String(DEFAULT_WEB_PORT);
  if (!/^\d{1,5}$/u.test(raw) || Number(raw) < 1 || Number(raw) > 65_535) throw new UsageError(`--port must be 1 to 65535, got '${raw}'`);
  return Number(raw);
}

const PLAIN_CSP = "default-src 'none'; style-src 'unsafe-inline'";

/** The CSP of every page of the app: its own files, plus the inline scripts that carry this request's nonce. */
export function appCsp(nonce: string): string {
  return [
    "default-src 'none'",
    `script-src 'self' 'nonce-${nonce}'`,
    "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "manifest-src 'self'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

/** `web/build`: next to `src/` in a checkout and in the Nix package. */
export const WEB_BUILD = fileURLToPath(new URL("../../web/build/", import.meta.url));

const TYPES: ReadonlyMap<string, string> = new Map([
  [".js", "text/javascript"],
  [".css", "text/css"],
  [".html", "text/html"],
  [".json", "application/json"],
  [".webmanifest", "application/manifest+json"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".ico", "image/x-icon"],
  [".woff2", "font/woff2"],
  [".woff", "font/woff"],
  [".txt", "text/plain"],
]);

/** The answer to one request, before it goes on the socket. */
export interface WebReply {
  status: number;
  headers: Headers;
  body: string | Uint8Array;
}

function reply(status: number, type: string, body: string | Uint8Array, csp: string = PLAIN_CSP): WebReply {
  const headers = new Headers({ "content-type": type.startsWith("text/") || type.endsWith("json") ? `${type}; charset=utf-8` : type });
  headers.set("cache-control", "no-store");
  headers.set("content-security-policy", csp);
  return { status, headers, body };
}

/** A file under `<build>/client` for this path, or null. Never a path outside that directory. */
export function staticFile(build: string, path: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return null;
  }
  if (decoded.includes("\0") || decoded.endsWith("/")) return null;
  const root = join(build, "client");
  const file = join(root, decoded);
  if (!file.startsWith(`${root}${sep}`) || !existsSync(file) || !statSync(file).isFile()) return null;
  return file;
}

function fileReply(file: string, path: string): WebReply {
  const answer = reply(200, TYPES.get(extname(file)) ?? "application/octet-stream", readFileSync(file), "default-src 'none'");
  // Vite puts a content hash in every file name under /assets/, so such a file never changes.
  answer.headers.set("cache-control", path.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache");
  return answer;
}

/** What identifies the code this process runs: the version and the web build's source hash. */
function fingerprint(build: string): string {
  const info = join(build, "build-info.json");
  return `${VERSION} ${existsSync(info) ? readFileSync(info, "utf8").trim() : "no build"}`;
}

function versionOnDisk(): string {
  const manifest = fileURLToPath(new URL("../../package.json", import.meta.url));
  const parsed: { version?: string } = JSON.parse(readFileSync(manifest, "utf8"));
  return parsed.version ?? "?";
}

type LoadedApp = { ok: true; handler: WebHandler } | { ok: false; error: string };

/** The app's request handler from `<build>/server/index.js`, loaded once. */
export class WebApp {
  readonly build: string;
  readonly startedAs: string;
  /** Set when this process must exit 75 so systemd restarts it with the code on disk. */
  restart = false;
  private handler: Promise<LoadedApp> | undefined;

  constructor(build: string = WEB_BUILD) {
    this.build = build;
    this.startedAs = fingerprint(build);
  }

  /** True when a `git pull` put another version or another build on disk than this process started with. */
  isStale(): boolean {
    return versionOnDisk() !== VERSION || fingerprint(this.build) !== this.startedAs;
  }

  load(): Promise<LoadedApp> {
    this.handler ??= this.import();
    return this.handler;
  }

  private async import(): Promise<LoadedApp> {
    const entry = join(this.build, "server", "index.js");
    if (!existsSync(entry)) return { ok: false, error: `the web app is not built: ${entry} is missing` };
    let loaded: { default?: WebHandler };
    try {
      loaded = await import(pathToFileURL(entry).href);
    } catch (cause) {
      return { ok: false, error: `${entry} did not load: ${errorMessage(cause)}` };
    }
    return loaded.default === undefined ? { ok: false, error: `${entry} has no default export` } : { ok: true, handler: loaded.default };
  }
}

/** Only these request headers reach the app: it reads nothing else. */
const FORWARDED_HEADERS = ["accept", "accept-language", "if-none-match"];

/**
 * The one cookie the app may read: the operator's display settings (theme,
 * density, default workspace), so a page renders in the chosen theme with no
 * flash. Every other cookie stays out. The web app names it SETTINGS_COOKIE in
 * web/app/lib/settings.ts; test/web.test.ts keeps the two names equal.
 */
export const SETTINGS_COOKIE = "darius-settings";

/** The settings pair of a `Cookie` header, alone, or null when it has none. */
export function settingsCookie(header: string | null): string | null {
  if (header === null) return null;
  const pair = header
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SETTINGS_COOKIE}=`));
  return pair === undefined || pair.length > 512 ? null : pair;
}

/**
 * One request, already allowed. Exported for tests, which call it without a
 * socket. `requestHeaders` holds the raw request headers darius forwards.
 */
export async function respond(method: string, url: URL, requestHeaders: Headers, viewer: string, app: WebApp, local = false): Promise<WebReply> {
  if (method !== "GET" && method !== "HEAD") return reply(405, "text/plain", "read-only\n");
  const path = url.pathname;
  if (path === "/healthz") return reply(200, "text/plain", "ok\n");
  if (path === "/api/status.json") return reply(200, "application/json", `${JSON.stringify(collectStatus())}\n`, "default-src 'none'");
  // The path names the project only; the file comes from its marker (src/web/workspace-icon.ts).
  if (path.startsWith(WORKSPACE_ICON_PREFIX)) return workspaceIconReply(path, requestHeaders.get("if-none-match"));
  const file = staticFile(app.build, path);
  if (file !== null) return fileReply(file, path);
  const loaded = await app.load();
  if (!loaded.ok) return reply(503, "text/html", plainPage("not built", loaded.error, "Run `bun run web:build` in the darius checkout."));
  const context = webContext(viewer, undefined, local);
  const headers = new Headers();
  for (const name of FORWARDED_HEADERS) {
    const value = requestHeaders.get(name);
    if (value !== null) headers.set(name, value);
  }
  const settings = settingsCookie(requestHeaders.get("cookie"));
  if (settings !== null) headers.set("cookie", settings);
  const response = await loaded.handler(new Request(url.href, { method, headers }), context);
  const answer: WebReply = { status: response.status, headers: new Headers(response.headers), body: new Uint8Array(await response.arrayBuffer()) };
  answer.headers.set("content-security-policy", appCsp(context.nonce));
  if (!answer.headers.has("cache-control")) answer.headers.set("cache-control", "no-store");
  return answer;
}

function send(response: ServerResponse, answer: WebReply, isHead: boolean): void {
  answer.headers.set("x-content-type-options", "nosniff");
  answer.headers.set("referrer-policy", "no-referrer");
  answer.headers.delete("content-length");
  response.writeHead(answer.status, Object.fromEntries(answer.headers));
  response.end(isHead ? "" : answer.body);
}

interface Gate {
  allow: Set<string>;
  whois: WhoisLookup;
  proxy: ProxyTrust | null;
}

/** Allowed logins are read again while none are known: Tailscale may come up after darius. */
async function gateFor(gate: Gate): Promise<Gate> {
  if (gate.allow.size === 0) gate.allow = await allowedLogins(gate.whois);
  return gate;
}

function headersOf(request: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(", ") : value);
  }
  return headers;
}

/** The request body as text, cut off after MAX_BODY + 1 bytes: more is refused anyway. */
async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    chunks.push(part);
    size += part.length;
    if (size > MAX_BODY) break;
  }
  return Buffer.concat(chunks).toString("utf8").slice(0, MAX_BODY + 1);
}

async function handle(request: IncomingMessage, response: ServerResponse, gate: Gate, app: WebApp): Promise<void> {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "darius.invalid"}`);
  const isHead = request.method === "HEAD";
  try {
    if (url.pathname === "/healthz") {
      send(response, reply(200, "text/plain", "ok\n"), isHead);
      return;
    }
    const access = await authorizeRequest(request.socket.remoteAddress ?? "", headersOf(request), await gateFor(gate));
    if (!access.allowed) {
      console.error(`darius serve: refused ${url.pathname}: ${access.reason}`);
      send(response, reply(403, "text/html", renderForbidden(access.reason)), isHead);
      return;
    }
    if (app.isStale()) {
      send(response, reply(503, "text/html", plainPage("restarting", "darius was updated on this host, so the page restarts.", "Reload in a few seconds.")), isHead);
      console.error("darius serve: another version or web build is on disk; exiting so the service restarts with it");
      app.restart = true;
      process.emit("SIGTERM");
      return;
    }
    if (url.pathname.startsWith(PUSH_API_PREFIX)) {
      const body = await readBody(request);
      const answer = pushApi({ method: request.method ?? "GET", path: url.pathname, headers: headersOf(request), body }, access.who);
      send(response, reply(answer.status, "application/json", `${JSON.stringify(answer.body)}\n`, "default-src 'none'"), isHead);
      return;
    }
    if (url.pathname.startsWith(ACTION_API_PREFIX)) {
      const body = await readBody(request);
      const answer = await actionApi({ method: request.method ?? "GET", path: url.pathname, headers: headersOf(request), body }, { who: access.who, local: access.local === true });
      send(response, reply(answer.status, "application/json", `${JSON.stringify(answer.body)}\n`, "default-src 'none'"), isHead);
      return;
    }
    if (url.pathname.startsWith(FINDING_API_PREFIX)) {
      const body = await readBody(request);
      const answer = await findingApi({ method: request.method ?? "GET", path: url.pathname, headers: headersOf(request), body }, { who: access.who, local: access.local === true });
      send(response, reply(answer.status, "application/json", `${JSON.stringify(answer.body)}\n`, "default-src 'none'"), isHead);
      return;
    }
    if (url.pathname.startsWith(SNAPSHOT_API_PREFIX)) {
      const body = await readBody(request);
      const answer = await snapshotApi({ method: request.method ?? "GET", path: url.pathname, headers: headersOf(request), body });
      send(response, reply(answer.status, "application/json", `${JSON.stringify(answer.body)}\n`, "default-src 'none'"), isHead);
      return;
    }
    send(response, await respond(request.method ?? "GET", url, headersOf(request), access.who, app, access.local === true), isHead);
  } catch (cause) {
    console.error(`darius serve: ${url.pathname}: ${errorMessage(cause)}`);
    send(response, reply(500, "text/plain", "darius could not answer; see the journal\n"), isHead);
  }
}

function listen(address: string, port: number, gate: Gate, app: WebApp): Promise<Server> {
  const server = createServer((request, response) => {
    void handle(request, response, gate, app);
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, address, () => {
      server.off("error", reject);
      const host = address.includes(":") ? `[${address}]` : address;
      console.log(`✓ darius web on http://${host}:${String(port)}/`);
      resolve(server);
    });
  });
}

/** `auto`: loopback now, the tailnet address as soon as Tailscale has one. */
async function listenAuto(port: number, gate: Gate, app: WebApp, servers: Server[]): Promise<() => void> {
  servers.push(await listen(LOOPBACK, port, gate, app));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const tryTailnet = async (): Promise<void> => {
    const address = await tailnetAddress();
    try {
      if (address === null) throw new Error("Tailscale has no address here yet");
      servers.push(await listen(address, port, gate, app));
    } catch (cause) {
      console.error(`darius serve: not on the tailnet yet (${errorMessage(cause)}); trying again in 30 s`);
      timer = setTimeout(() => void tryTailnet(), TAILNET_RETRY_MS);
    }
  };
  await tryTailnet();
  return () => {
    if (timer !== undefined) clearTimeout(timer);
  };
}

export const serveCommand: Command = {
  name: "serve",
  summary: "serve this host's read-only status page: --bind auto|127.0.0.1|<tailnet ip>[,...], --port 4747",
  async run(args: ParsedArgs): Promise<number> {
    const binds = webBind(stringFlag(args, "bind"));
    const port = webPort(stringFlag(args, "port"));
    const gate: Gate = { allow: new Set(), whois: cachedWhois(tailscaleWhois), proxy: proxyTrust() };
    const app = new WebApp();
    const servers: Server[] = [];
    let stopRetry: () => void = noRetry;
    try {
      if (binds === "auto") stopRetry = await listenAuto(port, gate, app, servers);
      else for (const bind of binds) servers.push(await listen(bind, port, gate, app));
    } catch (cause) {
      console.error(`darius serve: ${errorMessage(cause)}`);
      for (const server of servers) server.close();
      return 1;
    }
    const loaded = await app.load();
    if (!loaded.ok) console.error(`darius serve: ${loaded.error}; every page but /healthz and /api/status.json answers 503`);
    const allowed = [...(await gateFor(gate)).allow];
    console.log(`  tailnet callers allowed: ${allowed.length === 0 ? "none known yet" : allowed.join(", ")}; stop: Ctrl-C, or systemctl --user stop darius-web`);
    if (gate.proxy !== null) {
      const devices = gate.proxy.devices.size === 0 ? "none yet, so every proxied request is refused (DARIUS_WEB_PROXY_DEVICES)" : [...gate.proxy.devices].join(", ");
      console.log(`  proxy at ${[...gate.proxy.addresses].join(", ")}; devices it may name: ${devices}`);
    }
    const publicUrl = process.env.DARIUS_WEB_URL?.trim();
    if (publicUrl) console.log(`  opened as ${publicUrl}`);
    return new Promise((resolve) => {
      const stop = (): void => {
        stopRetry();
        const code = app.restart ? 75 : 0;
        let open = servers.length;
        if (open === 0) resolve(code);
        for (const server of servers) server.close(() => (open -= 1) === 0 && resolve(code));
        for (const server of servers) server.closeIdleConnections();
      };
      process.once("SIGTERM", stop);
      process.once("SIGINT", stop);
    });
  },
};
