/**
 * The dev server: `bun run web:dev [--demo] [--bind ADDR]`. Vite in
 * middleware mode with hot reload, the real WebContext over the local store
 * (read-only; honours DARIUS_STATE_DIR).
 *
 * It listens on this host's tailnet address when Tailscale has one, so a
 * phone or another machine can open it and follow each edit live, and on
 * loopback otherwise. Tailnet callers pass the same check as `darius serve`
 * (a device of an allowed login), because this server also serves source
 * files. `--bind 127.0.0.1` (or DARIUS_WEB_DEV_BIND) keeps it on this host.
 * `--demo` swaps the store for demo data that shows every state
 * (web/server/demo.ts). No CSP here; darius serve sets it.
 *
 * Behind a reverse proxy it reads the same variables as `darius serve`:
 * `DARIUS_WEB_PROXY` (with `_HEADER` and `_DEVICES`) for who may call, and
 * `DARIUS_WEB_URL`, whose host name Vite then accepts. The next lane
 * starts it this way (its tooling lives in the private workspace repo).
 */

import { createServer } from "node:http";

import { createRequestHandler, type ServerBuild } from "react-router";
import { createServer as createVite } from "vite";

import { allowedLogins, authorizeRequest, cachedWhois, proxyTrust, runTailscale, tailnetAddress, tailscaleWhois } from "../../src/web/auth.ts";
import { webContext } from "../../src/web/context.ts";
import { collectStatus } from "../../src/web/status.ts";
import { demoContext, demoStatus } from "./demo.ts";
import { sendResponse, toRequest } from "./http.ts";
import { loadContext } from "./load-context.ts";

const LOOPBACK = "127.0.0.1";
const PORT = Number(process.env.DARIUS_WEB_DEV_PORT ?? "5747");
const ANY_ADDRESS = new Set(["0.0.0.0", "::", ""]);

function flag(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? undefined : (process.argv[at + 1] ?? "");
}

const demo = process.argv.includes("--demo");

/** Where to listen: the flag, else the tailnet address, else loopback. Never every interface. */
async function pickAddress(): Promise<string> {
  const wanted = flag("bind") ?? process.env.DARIUS_WEB_DEV_BIND;
  if (wanted !== undefined) {
    if (ANY_ADDRESS.has(wanted)) throw new Error(`--bind ${wanted || '""'} would listen on every interface; use 127.0.0.1 or this host's tailnet address`);
    return wanted;
  }
  return (await tailnetAddress()) ?? LOOPBACK;
}

/** This host's name on the tailnet, for the URL: the second column of `tailscale status --self`. The address when there is none. */
async function tailnetName(address: string): Promise<string> {
  try {
    const row = (await runTailscale(["status", "--self"])).trim().split("\n")[0] ?? "";
    return row.split(/\s+/u)[1] || address;
  } catch {
    return address;
  }
}

/** The host name of `DARIUS_WEB_URL`, the address people open; null without one. */
function publicHost(): string | null {
  const raw = process.env.DARIUS_WEB_URL?.trim();
  if (!raw) return null;
  try {
    return new URL(raw).hostname;
  } catch {
    throw new Error(`DARIUS_WEB_URL is not a URL: ${raw}`);
  }
}

const address = await pickAddress();
const host = address === LOOPBACK ? LOOPBACK : await tailnetName(address);
const proxied = publicHost();

const server = createServer();
const vite = await createVite({
  server: {
    middlewareMode: true,
    // The hot-reload socket rides the page's own port, so it works from another device.
    hmr: { server },
    // The tailnet name and the address in the URL; the caller check below is the real gate.
    allowedHosts: [host, address, ".ts.net", ...(proxied === null ? [] : [proxied])],
  },
  appType: "custom",
});

async function loadBuild(): Promise<ServerBuild> {
  // SAFETY: the react-router Vite plugin defines this virtual module as the app's ServerBuild.
  return (await vite.ssrLoadModule("virtual:react-router/server-build")) as ServerBuild;
}

const handle = createRequestHandler(loadBuild, "development");
const gate = { allow: new Set<string>(), whois: cachedWhois(tailscaleWhois), proxy: proxyTrust() };

server.on("request", (req, res) => {
  void (async () => {
    // Allowed logins are read again while none are known: Tailscale may come up after this server.
    if (gate.allow.size === 0) gate.allow = await allowedLogins(gate.whois);
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) {
      if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(", ") : value);
    }
    const access = await authorizeRequest(req.socket.remoteAddress ?? "", headers, gate);
    if (!access.allowed) {
      res.statusCode = 403;
      res.end(`darius web dev: ${access.reason}\n`);
      return;
    }
    vite.middlewares(req, res, () => {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? `${host}:${PORT}`}`);
      if (url.pathname === "/api/status.json") {
        res.setHeader("content-type", "application/json; charset=utf-8");
        res.end(`${JSON.stringify(demo ? demoStatus() : collectStatus(), null, 2)}\n`);
        return;
      }
      if (url.pathname.startsWith("/api/snapshots/")) {
        // The dev server has no writes: a stub answer, so the buttons of the status page work in the demo.
        res.setHeader("content-type", "application/json; charset=utf-8");
        res.statusCode = req.method === "POST" ? 200 : 405;
        res.end(req.method === "POST" ? `${JSON.stringify(url.pathname.endsWith("/check") ? { ok: true, count: 4 } : { ok: true })}\n` : `${JSON.stringify({ ok: false, error: "POST only" })}\n`);
        return;
      }
      const base = webContext(access.who);
      handle(toRequest(req, url.origin), loadContext(demo ? demoContext(base) : base))
        .then((response) => sendResponse(res, response))
        .catch((error: Error) => {
          vite.ssrFixStacktrace(error);
          console.error(error);
          res.statusCode = 500;
          res.end(error.stack ?? error.message);
        });
    });
  })().catch((error: Error) => {
    console.error(error);
    res.statusCode = 500;
    res.end("darius web dev: the access check failed\n");
  });
});

server.listen(PORT, address, () => {
  console.log(`darius web dev${demo ? " (demo data)" : ""}: http://${host}:${PORT}/ (Ctrl+C stops it)`);
  if (address !== LOOPBACK) console.log(`  on the tailnet; callers must be devices of an allowed login. Keep it on this host: --bind ${LOOPBACK}`);
  if (proxied !== null) console.log(`  opened as ${process.env.DARIUS_WEB_URL?.trim() ?? ""}${gate.proxy === null ? " (no DARIUS_WEB_PROXY set, so the proxy's own login check applies)" : ""}`);
});
