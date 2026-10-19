/**
 * The service worker (web/public/sw.js), run in a VM context against fakes of
 * the Cache API, fetch and the clients: which requests it answers and how,
 * what it saves, the copy it serves when the network fails, the fallback of
 * a navigation with no copy, the versioned caches, and the messages it posts
 * to the page. The file is plain JS with no exports, so its top-level
 * functions are read from the context.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";

const SOURCE = readFileSync(new URL("../web/public/sw.js", import.meta.url), "utf8");
const ORIGIN = "https://darius.test";

/** A request as the worker sees it: a navigation cannot be built with `new Request`, so this is a plain record. */
interface FakeRequest {
  url: string;
  method: string;
  mode: string;
}

type Input = string | FakeRequest;

function isFakeRequest(input: Input): input is FakeRequest {
  return typeof input !== "string";
}

const hrefOf = (input: Input): string => new URL(isFakeRequest(input) ? input.url : input, ORIGIN).href;

class FakeCache {
  readonly entries = new Map<string, Response>();

  match(input: Input): Promise<Response | undefined> {
    return Promise.resolve(this.entries.get(hrefOf(input))?.clone());
  }

  put(input: Input, response: Response): Promise<void> {
    this.entries.set(hrefOf(input), response);
    return Promise.resolve();
  }

  async addAll(inputs: string[]): Promise<void> {
    for (const input of inputs) this.entries.set(hrefOf(input), new Response(`precached ${input}`, { status: 200 }));
  }
}

class FakeCaches {
  readonly stores = new Map<string, FakeCache>();

  open(name: string): Promise<FakeCache> {
    const store = this.stores.get(name) ?? new FakeCache();
    this.stores.set(name, store);
    return Promise.resolve(store);
  }

  keys(): Promise<string[]> {
    return Promise.resolve([...this.stores.keys()]);
  }

  delete(name: string): Promise<boolean> {
    return Promise.resolve(this.stores.delete(name));
  }
}

interface Posted {
  client: string;
  message: { type: string; savedAt?: string | null };
}

/** What the network does with a request: answer now, answer later, or fail. */
type Network = (href: string) => Response | Promise<Response> | "fail";

/** Every event this harness dispatches: a fetch, a message, an install or an activate. */
interface WorkerEvent {
  request?: FakeRequest;
  clientId?: string;
  resultingClientId?: string;
  respondWith?: (promise: Promise<Response>) => void;
  waitUntil: (promise: Promise<unknown>) => void;
  data?: { type: string; page?: string; files?: string[] };
  source?: { id: string; postMessage: (message: Posted["message"]) => void } | null;
}

const ANSWER_OK: Network = () => new Response("ok", { status: 200 });

interface Worker {
  caches: FakeCaches;
  posted: Posted[];
  fetched: string[];
  setNetwork: (network: Network) => void;
  dispatch: (type: string, event: WorkerEvent) => void;
  rules: Rules;
}

/** The pure rules, declared at the top of sw.js. */
interface Rules {
  routeOf: (method: string, href: string, mode: string, origin: string) => string;
  isStorable: (response: Response) => boolean;
  copyKeys: (href: string) => string[];
  dataHrefOf: (href: string) => string;
}

/** A message as plain JSON: objects made in the VM have another prototype, which deepEqual would compare. */
const plain = (message: Posted["message"]): Posted["message"] => JSON.parse(JSON.stringify(message));

function worker(version = "1.2.3", clientIds: string[] = ["tab-a", "tab-b"]): Worker {
  const handlers = new Map<string, (event: WorkerEvent) => void>();
  const caches = new FakeCaches();
  const posted: Posted[] = [];
  const fetched: string[] = [];
  let network = ANSWER_OK;
  const client = (id: string) => ({ id, url: `${ORIGIN}/all`, postMessage: (message: Posted["message"]) => posted.push({ client: id, message: plain(message) }) });
  const clients = new Map(clientIds.map((id) => [id, client(id)]));
  const fakeFetch = (input: Input): Promise<Response> => {
    const href = hrefOf(input);
    fetched.push(href);
    const outcome = network(href);
    if (outcome === "fail") return Promise.reject(new TypeError("Failed to fetch"));
    return Promise.resolve(outcome);
  };
  const context = createContext({
    self: {
      location: new URL(`${ORIGIN}/sw.js?v=${version}`),
      addEventListener: (type: string, handler: (event: WorkerEvent) => void) => handlers.set(type, handler),
      skipWaiting: () => Promise.resolve(),
      clients: {
        get: (id: string) => Promise.resolve(clients.get(id)),
        matchAll: () => Promise.resolve([...clients.values()]),
        claim: () => Promise.resolve(),
      },
    },
    caches,
    fetch: fakeFetch,
    Response,
    Headers,
    URL,
    // The 8 s deadline is 5 ms here.
    setTimeout: (callback: () => void, ms: number) => setTimeout(callback, ms === 8000 ? 5 : ms),
  });
  runInContext(SOURCE, context);
  return {
    caches,
    posted,
    fetched,
    setNetwork: (next) => {
      network = next;
    },
    dispatch: (type, event) => {
      const handler = handlers.get(type);
      assert.ok(handler !== undefined, `sw.js listens to ${type}`);
      handler(event);
    },
    rules: { routeOf: context.routeOf, isStorable: context.isStorable, copyKeys: context.copyKeys, dataHrefOf: context.dataHrefOf },
  };
}

interface Fetched {
  answer: Response | null;
  waits: Promise<unknown>[];
}

/** Dispatch one fetch event and wait for its answer and its waitUntil work. */
async function request(target: Worker, path: string, extra: { method?: string; mode?: string; clientId?: string; resultingClientId?: string } = {}): Promise<Fetched> {
  const waits: Promise<unknown>[] = [];
  let answer: Promise<Response> | null = null;
  const event = {
    request: { url: `${ORIGIN}${path}`, method: extra.method ?? "GET", mode: extra.mode ?? "cors" },
    clientId: extra.clientId ?? "",
    resultingClientId: extra.resultingClientId ?? "",
    respondWith: (promise: Promise<Response>) => {
      answer = promise;
    },
    waitUntil: (promise: Promise<unknown>) => waits.push(promise),
  };
  target.dispatch("fetch", event);
  const response = answer === null ? null : await answer;
  await Promise.all(waits);
  return { answer: response, waits };
}

const page = (body: string): Response => new Response(body, { status: 200, headers: { "content-type": "text/html" } });
const data = (body: string): Response => new Response(body, { status: 200, headers: { "content-type": "text/x-script" } });

test("the routes: shell files cache first, pages and reads network first, the rest is left alone", () => {
  const { routeOf } = worker().rules;
  const cases: [string, string, string, string][] = [
    ["GET", "/assets/root-1a2b.js", "cors", "shell"],
    ["GET", "/assets/cinzel-latin-600-normal-x.woff2", "cors", "shell"],
    ["GET", "/icon-192.png", "no-cors", "shell"],
    ["GET", "/apple-touch-icon.png", "no-cors", "shell"],
    ["GET", "/splash-1170x2532.png", "no-cors", "shell"],
    ["GET", "/manifest.webmanifest", "cors", "shell"],
    ["GET", "/favicon.svg", "no-cors", "shell"],
    ["GET", "/all", "navigate", "page"],
    ["GET", "/w/demo/rituals?x=1", "navigate", "page"],
    ["GET", "/all.data", "cors", "data"],
    ["GET", "/w/demo/vigils.data?_routes=root", "cors", "data"],
    ["GET", "/__manifest?paths=%2Fall&version=abc", "cors", "data"],
    ["POST", "/all.data", "cors", "pass"],
    ["POST", "/api/run", "cors", "pass"],
    ["GET", "/api/pending?ids=a", "cors", "pass"],
    ["GET", "/api/workspace-icon/demo", "no-cors", "pass"],
    ["GET", "/healthz", "cors", "pass"],
    ["GET", "/sw.js", "cors", "pass"],
    ["HEAD", "/all", "cors", "pass"],
    ["GET", "/status-image.png", "no-cors", "pass"],
  ];
  for (const [method, path, mode, route] of cases) assert.equal(routeOf(method, `${ORIGIN}${path}`, mode, ORIGIN), route, `${method} ${path}`);
  assert.equal(routeOf("GET", "https://elsewhere.example/assets/a.js", "cors", ORIGIN), "pass", "another origin");
});

test("only a complete 200 of this origin that is no redirect is saved", () => {
  const { isStorable } = worker().rules;
  assert.equal(isStorable(new Response("x", { status: 200 })), true);
  assert.equal(isStorable(new Response(null, { status: 204 })), false);
  assert.equal(isStorable(new Response("x", { status: 503 })), false);
  assert.equal(isStorable(new Response(null, { status: 204, headers: { "x-remix-redirect": "/all" } })), false);
  assert.equal(isStorable(new Response("x", { status: 200, headers: { "x-remix-redirect": "/all" } })), false);
  assert.equal(isStorable(Response.redirect(`${ORIGIN}/all`, 302)), false);
});

test("the keys: no hash; a read that names its routes may use the full read; the data address of a page", () => {
  const { copyKeys, dataHrefOf } = worker().rules;
  assert.deepEqual([...copyKeys(`${ORIGIN}/all.data#x`)], [`${ORIGIN}/all.data`]);
  assert.deepEqual([...copyKeys(`${ORIGIN}/w/demo/vigils.data?_routes=root%2Croutes%2Fvigil`)], [`${ORIGIN}/w/demo/vigils.data?_routes=root%2Croutes%2Fvigil`, `${ORIGIN}/w/demo/vigils.data`]);
  assert.equal(dataHrefOf(`${ORIGIN}/`), `${ORIGIN}/_root.data`);
  assert.equal(dataHrefOf(`${ORIGIN}/w/demo/rituals/`), `${ORIGIN}/w/demo/rituals.data`);
  assert.equal(dataHrefOf(`${ORIGIN}/activity?days=7#top`), `${ORIGIN}/activity.data?days=7`);
});

test("install saves the offline page; activate deletes the caches of other versions and nothing else", async () => {
  const target = worker("2.0.0");
  const waits: Promise<unknown>[] = [];
  const event = { waitUntil: (promise: Promise<unknown>) => waits.push(promise) };
  await target.caches.open("darius-shell-1.0.0");
  await target.caches.open("darius-pages-1.0.0");
  await target.caches.open("someone-else");
  target.dispatch("install", event);
  target.dispatch("activate", event);
  await Promise.all(waits);
  assert.deepEqual([...target.caches.stores.keys()].toSorted(), ["darius-shell-2.0.0", "someone-else"]);
  assert.ok((await (await target.caches.open("darius-shell-2.0.0")).match("/offline.html")) !== undefined);
});

test("a page online: the live page answers, is saved with its time, becomes the last page, and its data read is saved too", async () => {
  const target = worker();
  target.setNetwork((href) => (href.endsWith(".data") ? data("all data") : page("all page")));
  const { answer } = await request(target, "/all", { mode: "navigate", resultingClientId: "tab-new" });
  assert.equal(await answer?.text(), "all page");
  const pages = await target.caches.open("darius-pages-1.2.3");
  const saved = await pages.match(`${ORIGIN}/all`);
  assert.equal(await saved?.text(), "all page");
  assert.match(saved?.headers.get("x-darius-saved-at") ?? "", /^\d{4}-\d\d-\d\dT/u);
  assert.equal(saved?.headers.get("content-type"), "text/html", "the saved copy keeps the headers of the answer");
  assert.equal(await (await pages.match("/__darius/last-page"))?.text(), `${ORIGIN}/all`);
  assert.equal(await (await pages.match(`${ORIGIN}/all.data`))?.text(), "all data");
  assert.deepEqual(target.posted, [], "nothing was stale, so nothing is said");
});

test("a read with no network: the saved copy answers and the page hears stale with the saved time; the network back says fresh to all", async () => {
  const target = worker();
  target.setNetwork(() => data("live"));
  await request(target, "/w/demo/rituals.data", { clientId: "tab-a" });
  assert.deepEqual(target.posted, [{ client: "tab-a", message: { type: "fresh" } }], "a read always tells its page the network answered");
  target.posted.length = 0;
  target.setNetwork(() => "fail");
  const offline = await request(target, "/w/demo/rituals.data", { clientId: "tab-a" });
  assert.equal(await offline.answer?.text(), "live");
  const savedAt = offline.answer?.headers.get("x-darius-saved-at") ?? null;
  assert.ok(savedAt !== null);
  assert.deepEqual(target.posted, [{ client: "tab-a", message: { type: "stale", savedAt } }]);
  target.posted.length = 0;
  target.setNetwork(() => data("live again"));
  const back = await request(target, "/w/demo/rituals.data", { clientId: "tab-a" });
  assert.equal(await back.answer?.text(), "live again");
  assert.deepEqual(target.posted.map((entry) => `${entry.client} ${entry.message.type}`), ["tab-a fresh", "tab-b fresh"]);
});

test("a read that names its routes falls back to the full read; a read with no copy fails as the network did", async () => {
  const target = worker();
  target.setNetwork(() => data("full"));
  await request(target, "/vigils.data", { clientId: "tab-a" });
  target.setNetwork(() => "fail");
  assert.equal(await (await request(target, "/vigils.data?_routes=root", { clientId: "tab-a" })).answer?.text(), "full");
  const missing = await request(target, "/findings.data", { clientId: "tab-a" });
  assert.equal(missing.answer?.type, "error", "React Router sees the network error and the page boundary says No connection");
});

test("a proxy 502, 503 or 504 counts as no connection when a copy exists; without one the answer goes through", async () => {
  const target = worker();
  target.setNetwork(() => data("saved"));
  await request(target, "/all.data", { clientId: "tab-a" });
  for (const status of [502, 503, 504]) {
    target.setNetwork(() => new Response("bad gateway", { status }));
    assert.equal(await (await request(target, "/all.data", { clientId: "tab-a" })).answer?.text(), "saved", String(status));
    assert.equal((await request(target, "/runs.data", { clientId: "tab-a" })).answer?.status, status, `${status} with no copy`);
  }
  target.setNetwork(() => new Response("not found", { status: 404 }));
  assert.equal((await request(target, "/all.data", { clientId: "tab-a" })).answer?.status, 404, "a 404 is a real answer");
});

test("a network slower than 8 s: the copy answers, and the late answer is still saved", async () => {
  const target = worker();
  target.setNetwork(() => data("first"));
  await request(target, "/all.data", { clientId: "tab-a" });
  let late: ((response: Response) => void) | null = null;
  target.setNetwork(
    () =>
      new Promise<Response>((resolve) => {
        late = resolve;
      }),
  );
  const slow = request(target, "/all.data", { clientId: "tab-a" });
  // The deadline is 5 ms in this harness; the answer comes after it.
  setTimeout(() => late?.(data("second")), 30);
  assert.equal(await (await slow).answer?.text(), "first", "the copy after the deadline");
  const pages = await target.caches.open("darius-pages-1.2.3");
  assert.equal(await (await pages.match(`${ORIGIN}/all.data`))?.text(), "second", "the late answer is the next copy");
});

test("a page with no network and no copy goes to the last saved page; with no saved page, to the offline page", async () => {
  const target = worker();
  const install: Promise<unknown>[] = [];
  target.dispatch("install", { waitUntil: (promise: Promise<unknown>) => install.push(promise) });
  await Promise.all(install);
  target.setNetwork(() => "fail");
  const first = await request(target, "/", { mode: "navigate", resultingClientId: "tab-new" });
  assert.equal(await first.answer?.text(), "precached /offline.html");
  target.setNetwork((href) => (href.endsWith(".data") ? data("all data") : page("all page")));
  await request(target, "/all", { mode: "navigate" });
  target.setNetwork(() => "fail");
  const cold = await request(target, "/", { mode: "navigate", resultingClientId: "tab-new" });
  assert.equal(cold.answer?.status, 302);
  assert.equal(cold.answer?.headers.get("location"), `${ORIGIN}/all`);
  const same = await request(target, "/all", { mode: "navigate", resultingClientId: "tab-new" });
  assert.equal(await same.answer?.text(), "all page", "the last page itself comes from its copy");
});

test("a page from its copy tells every tab, and the new tab hears it once it says hello", async () => {
  const target = worker();
  target.setNetwork((href) => (href.endsWith(".data") ? data("d") : page("rituals page")));
  await request(target, "/rituals", { mode: "navigate" });
  target.setNetwork(() => "fail");
  await request(target, "/rituals", { mode: "navigate", resultingClientId: "tab-new" });
  assert.deepEqual(target.posted.map((entry) => `${entry.client} ${entry.message.type}`), ["tab-a stale", "tab-b stale"]);
  const heard: Posted["message"][] = [];
  const hello = { data: { type: "hello" }, source: { id: "tab-new", postMessage: (message: Posted["message"]) => heard.push(plain(message)) }, waitUntil: () => undefined };
  target.dispatch("message", hello);
  assert.equal(heard.length, 1);
  assert.equal(heard[0]?.type, "stale");
  assert.match(heard[0]?.savedAt ?? "", /^\d{4}-/u);
  target.dispatch("message", hello);
  assert.equal(heard.length, 1, "once");
});

test("shell files: the network once, then the cache, also with no network", async () => {
  const target = worker();
  target.setNetwork(() => new Response("js", { status: 200 }));
  assert.equal(await (await request(target, "/assets/root-1a2b.js")).answer?.text(), "js");
  target.setNetwork(() => "fail");
  assert.equal(await (await request(target, "/assets/root-1a2b.js")).answer?.text(), "js");
  assert.deepEqual(target.fetched, [`${ORIGIN}/assets/root-1a2b.js`]);
});

test("never saved: a POST, /api, /healthz, a 204, a redirect", async () => {
  const target = worker();
  target.setNetwork(() => new Response(null, { status: 204, headers: { "x-remix-redirect": "/all" } }));
  await request(target, "/all.data", { clientId: "tab-a" });
  for (const path of ["/api/run", "/healthz"]) assert.equal((await request(target, path)).answer, null, `${path} is left to the network`);
  assert.equal((await request(target, "/all.data", { method: "POST" })).answer, null, "a POST is left to the network");
  const pages = await target.caches.open("darius-pages-1.2.3");
  assert.equal(pages.entries.size, 0);
});

test("warm: a page loaded before the worker had it saves its files, the page and its data", async () => {
  const target = worker();
  target.setNetwork((href) => (href.endsWith(".data") ? data("d") : href.endsWith(".js") ? new Response("js", { status: 200 }) : page("p")));
  const waits: Promise<unknown>[] = [];
  target.dispatch("message", { data: { type: "warm", page: `${ORIGIN}/all`, files: [`${ORIGIN}/assets/a.js`, `${ORIGIN}/api/x`, "https://elsewhere.example/assets/b.js"] }, source: null, waitUntil: (promise: Promise<unknown>) => waits.push(promise) });
  await Promise.all(waits);
  assert.deepEqual(target.fetched, [`${ORIGIN}/assets/a.js`, `${ORIGIN}/all`, `${ORIGIN}/all.data`]);
  assert.equal((await target.caches.open("darius-pages-1.2.3")).entries.size, 3, "the page, the last page key and the data read");
});

test("push and notificationclick are still handled", () => {
  assert.match(SOURCE, /addEventListener\("push"/u);
  assert.match(SOURCE, /addEventListener\("notificationclick"/u);
});
