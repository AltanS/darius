/*
 * The darius service worker. It does three things:
 *
 * 1. Web Push. It shows a push notice and opens its page. A payload is JSON
 *    { title, body, url, tag } (src/core/push.ts). `url` is a path on this
 *    origin; anything else opens the home page. `tag` replaces an earlier
 *    notice with the same tag instead of stacking a second one.
 * 2. The shell. Files under /assets/ (their names carry a hash), the icons,
 *    the manifest, the splash images and fonts come from the cache first. A
 *    file goes into the cache the first time the page asks for it.
 * 3. The last copy of each page. A navigation, a `.data` read and
 *    `/__manifest` go to the network first. When the network fails, answers
 *    502, 503 or 504, or takes longer than 8 s, the saved copy of the same
 *    address answers. A navigation with no copy goes to the last saved page,
 *    else to /offline.html.
 *
 * Only a complete 200 answer to a GET is saved: never a POST, a 204, a
 * redirect, /api/* or /healthz. A saved copy carries `x-darius-saved-at`.
 * When a copy answers, the worker posts { type: "stale", savedAt } to the
 * page; when the network answers a read, it posts { type: "fresh" }
 * (web/app/lib/connection.ts listens).
 *
 * The page registers /sw.js?v=<version> (web/app/lib/sw.ts). The caches are
 * named with that version, and a new version deletes the old caches.
 *
 * This file is served as it is from web/public: plain JS, no build step, no
 * imports. The rules are small pure functions; test/web-sw.test.ts runs this
 * file against fakes.
 */

const HOME = "/";
const VERSION = new URL(self.location.href).searchParams.get("v") || "dev";
const PREFIX = "darius-";
const SHELL_CACHE = `${PREFIX}shell-${VERSION}`;
const PAGES_CACHE = `${PREFIX}pages-${VERSION}`;
/** The key in PAGES_CACHE whose body is the address of the last saved page. */
const LAST_PAGE_KEY = "/__darius/last-page";
const OFFLINE_PAGE = "/offline.html";
/** Saved at install, so a first open with no connection still has a page. */
const PRECACHE = [OFFLINE_PAGE, "/favicon.svg", "/manifest.webmanifest"];
const DEADLINE_MS = 8000;
const SAVED_AT = "x-darius-saved-at";
/** A proxy says these when darius is down: the saved copy is better. */
const DOWN = new Set([502, 503, 504]);

// --- the rules (pure) ---

/** A same-origin path, never `//host` or a full URL from the payload. */
function safePath(value) {
  return String(value ?? "").startsWith("/") && !String(value).startsWith("//") ? String(value) : HOME;
}

/** A file of the shell: hashed assets, icons, splash images, the manifest, fonts. */
function isShellPath(path) {
  if (path.startsWith("/assets/")) return true;
  if (path === "/manifest.webmanifest" || path === "/favicon.svg") return true;
  if (/^\/(?:icon|apple-touch-icon|badge|splash)[\w.-]*\.png$/u.test(path)) return true;
  return /\.woff2?$/u.test(path);
}

/**
 * How the worker answers a request: "shell" (cache first), "page" (a
 * navigation, network first), "data" (a `.data` read or /__manifest, network
 * first), or "pass" (the network alone, the worker stays out).
 */
function routeOf(method, href, mode, origin) {
  if (method !== "GET") return "pass";
  const url = new URL(href);
  if (url.origin !== origin) return "pass";
  const path = url.pathname;
  if (path === "/healthz" || path.startsWith("/api/") || path === "/sw.js") return "pass";
  if (mode === "navigate") return "page";
  if (path.endsWith(".data") || path === "/__manifest") return "data";
  return isShellPath(path) ? "shell" : "pass";
}

/** A complete 200 of this origin, not a redirect: the only answer worth saving. */
function isStorable(response) {
  if (response.status !== 200 || response.redirected) return false;
  if (response.type !== "basic" && response.type !== "default") return false;
  return !response.headers.has("x-remix-redirect");
}

/** The key of an address: no hash. */
function keyOf(href) {
  const url = new URL(href);
  url.hash = "";
  return url.href;
}

/**
 * The keys to look up for a copy, best first. A `.data` read that names its
 * routes (`_routes`) may use the copy of the full read, which holds them all.
 */
function copyKeys(href) {
  const url = new URL(href);
  url.hash = "";
  const keys = [url.href];
  if (url.searchParams.has("_routes")) {
    url.searchParams.delete("_routes");
    keys.push(url.href);
  }
  return keys;
}

/** The `.data` address of a page, the way React Router asks for it: `/` reads `/_root.data`. */
function dataHrefOf(href) {
  const url = new URL(href);
  url.hash = "";
  const path = url.pathname === "/" ? "/_root" : url.pathname.replace(/\/+$/u, "");
  url.pathname = `${path}.data`;
  return url.href;
}

/** The caches a new version deletes: every darius cache but its own two. */
function isOldCache(name) {
  return name.startsWith(PREFIX) && name !== SHELL_CACHE && name !== PAGES_CACHE;
}

// --- the caches ---

/** A copy of `response` with the time it was saved. Reading the body whole proves it is complete. */
async function withSavedAt(response, savedAt) {
  const body = await response.arrayBuffer();
  const headers = new Headers(response.headers);
  headers.set(SAVED_AT, savedAt);
  return new Response(body, { status: response.status, statusText: response.statusText, headers });
}

/** The saved copy of an address, or null. */
async function savedCopy(href) {
  const cache = await caches.open(PAGES_CACHE);
  for (const key of copyKeys(href)) {
    const hit = await cache.match(key, { ignoreVary: true });
    if (hit !== undefined) return hit;
  }
  return null;
}

/** Save an answer under its address. A saved page also becomes the last page, and its `.data` read is saved with it. */
async function keep(href, route, response) {
  const cache = await caches.open(PAGES_CACHE);
  await cache.put(keyOf(href), await withSavedAt(response, new Date().toISOString()));
  if (route !== "page") return;
  await cache.put(LAST_PAGE_KEY, new Response(keyOf(href)));
  // The page came as HTML, so the next reload of its data in place has no copy yet. One read of it now fills that gap.
  const dataHref = dataHrefOf(href);
  const data = await fetch(dataHref, { headers: { accept: "*/*" } });
  if (isStorable(data)) await cache.put(dataHref, await withSavedAt(data, new Date().toISOString()));
}

/** Where a navigation with no copy goes: the last saved page, else the offline page. */
async function fallbackPage(href) {
  const pages = await caches.open(PAGES_CACHE);
  const last = await pages.match(LAST_PAGE_KEY);
  if (last !== undefined) {
    const target = await last.text();
    if (target !== "" && target !== keyOf(href)) return Response.redirect(target, 302);
  }
  const shell = await caches.open(SHELL_CACHE);
  const offline = await shell.match(OFFLINE_PAGE);
  return offline ?? new Response("No connection, and no saved page yet.", { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } });
}

/** A shell file: the cache, else the network, saved for next time. A failed save costs the next open, never this one. */
async function cacheFirst(request) {
  const cache = await caches.open(SHELL_CACHE);
  const hit = await cache.match(request, { ignoreVary: true });
  if (hit !== undefined) return hit;
  const response = await fetch(request);
  if (isStorable(response)) await cache.put(request, response.clone()).catch(() => undefined);
  return response;
}

// --- the messages ---

/** True after a copy answered, until the network answers a read again. */
let servedStale = false;
/** The new tabs that a saved page opened, with its time: they ask with "hello" once they listen. */
const staleTabs = new Map();

// `Client.postMessage(message, transfer)`: the second argument is a transfer list, not a target
// origin. A client of this worker is always of its own origin, and nothing is transferred.

async function tell(clientId, message) {
  if (clientId === "" || clientId === undefined) return;
  const client = await self.clients.get(clientId);
  if (client !== undefined) client.postMessage(message, []);
}

async function tellAll(message) {
  const tabs = await self.clients.matchAll({ type: "window" });
  for (const tab of tabs) tab.postMessage(message, []);
}

async function tellStale(event, route, copy) {
  const message = { type: "stale", savedAt: copy.headers.get(SAVED_AT) };
  servedStale = true;
  if (route === "page") {
    if (event.resultingClientId) staleTabs.set(event.resultingClientId, message.savedAt);
    await tellAll(message);
    return;
  }
  await tell(event.clientId, message);
}

async function tellFresh(event, route) {
  if (servedStale) {
    servedStale = false;
    await tellAll({ type: "fresh" });
    return;
  }
  // A worker that slept forgot it served a copy, so a read always tells its own page.
  if (route === "data") await tell(event.clientId, { type: "fresh" });
}

// --- network first ---

const LATE = Symbol("late");

function deadline(ms) {
  return new Promise((resolve) => setTimeout(() => resolve(LATE), ms));
}

/**
 * The network, then the copy. `answer` goes to respondWith; `done` keeps the
 * worker alive until the answer is saved and the page is told.
 */
function networkFirst(event, route) {
  const href = event.request.url;
  const network = fetch(event.request).then(
    (response) => ({ response, copy: isStorable(response) ? response.clone() : null }),
    () => ({ response: null, copy: null }),
  );
  const saved = network.then((outcome) => (outcome.copy === null ? undefined : keep(href, route, outcome.copy))).catch(() => undefined);
  const told = [];
  const live = (outcome) => outcome !== LATE && outcome.response !== null && !DOWN.has(outcome.response.status);
  const answer = (async () => {
    const first = await Promise.race([network, deadline(DEADLINE_MS)]);
    if (live(first)) {
      told.push(tellFresh(event, route));
      return first.response;
    }
    const copy = await savedCopy(href);
    if (copy !== null) {
      told.push(tellStale(event, route, copy));
      return copy;
    }
    const outcome = first === LATE ? await network : first;
    if (live(outcome)) told.push(tellFresh(event, route));
    if (outcome.response !== null) return outcome.response;
    return route === "page" ? fallbackPage(href) : Response.error();
  })();
  const done = Promise.allSettled([saved, answer]).then(() => Promise.allSettled(told));
  return { answer, done };
}

// --- the page asks ---

/** The page asks at boot: save the shell files it names, and the page itself when it names one (it loaded before this worker took it over). */
async function warm(page, files) {
  const shell = await caches.open(SHELL_CACHE);
  for (const file of files) {
    if (routeOf("GET", file, "no-cors", self.location.origin) !== "shell" || (await shell.match(file)) !== undefined) continue;
    const response = await fetch(file).catch(() => null);
    if (response !== null && isStorable(response)) await shell.put(file, response);
  }
  if (page === "" || routeOf("GET", page, "navigate", self.location.origin) !== "page") return;
  const response = await fetch(page, { headers: { accept: "text/html" } }).catch(() => null);
  if (response !== null && isStorable(response)) await keep(page, "page", response);
}

// --- the events ---

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter(isOldCache).map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const route = routeOf(request.method, request.url, request.mode, self.location.origin);
  if (route === "pass") return;
  if (route === "shell") {
    event.respondWith(cacheFirst(request));
    return;
  }
  const { answer, done } = networkFirst(event, route);
  event.waitUntil(done);
  event.respondWith(answer);
});

self.addEventListener("message", (event) => {
  const data = Object(event.data);
  const source = event.source;
  if (data.type === "hello" && source !== null && source !== undefined) {
    const savedAt = staleTabs.get(source.id);
    if (savedAt !== undefined) {
      staleTabs.delete(source.id);
      source.postMessage({ type: "stale", savedAt }, []);
    }
    return;
  }
  if (data.type === "warm") {
    const files = Array.isArray(data.files) ? data.files.map(String) : [];
    event.waitUntil(warm(String(data.page ?? ""), files).catch(() => undefined));
  }
});

function readPayload(data) {
  if (data === null) return {};
  try {
    return Object(data.json());
  } catch {
    return { body: data.text() };
  }
}

self.addEventListener("push", (event) => {
  const payload = readPayload(event.data);
  const title = String(payload.title ?? "") || "darius";
  const options = {
    body: String(payload.body ?? ""),
    data: { url: safePath(payload.url) },
    icon: "/icon-192.png",
    badge: "/badge-72.png",
  };
  if (String(payload.tag ?? "") !== "") options.tag = String(payload.tag);
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(safePath(event.notification.data?.url), self.location.origin).href;
  event.waitUntil(openOrFocus(target));
});

/** Focus a darius tab and move it to the notice's page; open one when there is none. */
async function openOrFocus(target) {
  const tabs = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  const exact = tabs.find((tab) => tab.url === target);
  if (exact !== undefined) return exact.focus();
  const any = tabs.find((tab) => new URL(tab.url).origin === self.location.origin);
  if (any === undefined) return self.clients.openWindow(target);
  const focused = await any.focus();
  return focused.navigate(target);
}
