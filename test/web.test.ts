/**
 * The web server (src/cli/serve.ts, src/web/*): the JSON API, static files,
 * the hand-over to the app with its CSP nonce, the data the app reads
 * (WebContext), markdown blocks, access, and the refused bind addresses.
 * Requests go through `respond()` without a socket, against a FAKE app
 * build in a temp directory; test/web-app.test.ts covers the real app.
 * Plus one real listen on 127.0.0.1.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SANDBOX = mkdtempSync(join(tmpdir(), "darius-web-"));
process.env.DARIUS_STATE_DIR = join(SANDBOX, "state");
process.env.DARIUS_CONFIG_DIR = join(SANDBOX, "config");
process.env.DARIUS_TAILSCALE = join(SANDBOX, "no-tailscale");
delete process.env.DARIUS_WEB_BIND;
delete process.env.DARIUS_WEB_ALLOW;

const { parseArgs } = await import("../src/cli/args.ts");
const { SETTINGS_COOKIE, WebApp, respond, serveCommand, settingsCookie, staticFile, webBind, webPort } = await import("../src/cli/serve.ts");
const { SETTINGS_COOKIE: APP_SETTINGS_COOKIE } = await import("../web/app/lib/settings.ts");
const { parseMarkdown } = await import("../src/web/markdown.ts");
const { webContext } = await import("../src/web/context.ts");
import type { MdSpan, RitualRow } from "../src/web/api.ts";
import type { Ritual } from "../src/core/model.ts";
const { allowedLogins, authorize, authorizeRequest, cachedWhois, parseWhois, proxyTrust } = await import("../src/web/auth.ts");
const { appendLine, readLedger } = await import("../src/core/ledger.ts");
const { openProject, putBlob } = await import("../src/core/store.ts");
const { acknowledgeRun } = await import("../src/runner/hold.ts");
const { collectStatus, runRows } = await import("../src/web/status.ts");
const { writeLink } = await import("../src/core/links.ts");
const { ulid } = await import("../src/core/ulid.ts");

interface Seeded {
  run: string;
  held: string;
}

function seed(): Seeded {
  const project = openProject("web-demo", { create: true });
  const now = new Date().toISOString();
  project.writeItem(
    {
      header: {
        id: ulid(),
        kind: "ritual",
        slug: "daily-report",
        title: "Daily <script>alert(1)</script> report",
        created: now,
        updated: now,
        tags: [],
        cadence: "1d",
        anchor: "due",
        skill: "daily-report",
        policy: { mode: "report", may: [], hold: [] },
      },
      body: "x\n",
    },
    { who: "test" },
  );
  const run = ulid();
  appendLine(project, { who: "timer", type: "run.started", item: "ritual/daily-report", run });
  const sha = putBlob(project, "# Report\n\n<b>bold</b> & more\n");
  appendLine(project, { who: "claude:x", type: "run.completed", item: "ritual/daily-report", run, outcome: "complete", findings_sha: sha });
  const held = ulid();
  appendLine(project, { who: "timer", type: "run.started", item: "ritual/daily-report", run: held });
  appendLine(project, { who: "policy-check", type: "run.held", item: "ritual/daily-report", run: held, questions: ["may I <push>?"] });
  return { run, held };
}

const { run, held } = seed();

/** A fake app build: one asset, and a handler that echoes what darius handed it. */
function fakeBuild(): string {
  const build = join(SANDBOX, "build");
  mkdirSync(join(build, "client", "assets"), { recursive: true });
  mkdirSync(join(build, "server"), { recursive: true });
  writeFileSync(join(build, "client", "assets", "app-1a2b.js"), "console.log(1);\n");
  writeFileSync(join(build, "client", "favicon.svg"), "<svg/>\n");
  writeFileSync(join(build, "build-info.json"), '{"sourceHash":"one"}\n');
  writeFileSync(join(SANDBOX, "package.json"), '{"type":"module"}\n');
  writeFileSync(
    join(build, "server", "index.js"),
    [
      "export default async (request, context) => new Response(",
      "  JSON.stringify({ path: new URL(request.url).pathname, viewer: context.viewer, nonce: context.nonce, cookie: request.headers.get('cookie'), accept: request.headers.get('accept'), projects: context.status().projects.length }),",
      "  { headers: { 'content-type': 'text/html' } });",
      "",
    ].join("\n"),
  );
  return build;
}

const BUILD = fakeBuild();
const APP = new WebApp(BUILD);
const NO_HEADERS = new Headers();

function get(path: string, headers: Headers = NO_HEADERS): ReturnType<typeof respond> {
  return respond("GET", new URL(path, "http://host-a:4747"), headers, "owner on host-b", APP);
}

function isText(body: string | Uint8Array): body is string {
  return typeof body === "string";
}

function text(body: string | Uint8Array): string {
  return isText(body) ? body : new TextDecoder().decode(body);
}

test("status.json, healthz, read-only", async () => {
  const json = await get("/api/status.json");
  const status = JSON.parse(text(json.body));
  assert.equal(status.projects[0].name, "web-demo");
  assert.equal(status.projects[0].rituals[0].skill, "daily-report");
  assert.equal(status.projects[0].runs.length, 2);
  assert.equal(status.utcOffset, -new Date(status.generatedAt).getTimezoneOffset() || 0, "the host's UTC offset in minutes east");
  assert.equal(text((await get("/healthz")).body), "ok\n");
  assert.equal((await respond("POST", new URL("http://x/"), NO_HEADERS, "x", APP)).status, 405);
});

test("pages go to the app with a fresh nonce in the CSP; only a few request headers reach it", async () => {
  const headers = new Headers({ accept: "text/html", cookie: "secret=1" });
  const first = await get("/p/web-demo", headers);
  const page = JSON.parse(text(first.body));
  assert.equal(first.status, 200);
  assert.deepEqual([page.path, page.viewer, page.accept, page.cookie, page.projects], ["/p/web-demo", "owner on host-b", "text/html", null, 1]);
  const csp = first.headers.get("content-security-policy") ?? "";
  assert.ok(csp.includes(`script-src 'self' 'nonce-${page.nonce}'`), csp);
  assert.match(csp, /default-src 'none'/u);
  assert.equal(csp.includes("unsafe-inline"), false);
  const withSettings = JSON.parse(text((await get("/", new Headers({ cookie: "secret=1; darius-settings=theme%3Dlight; other=2" }))).body));
  assert.equal(withSettings.cookie, "darius-settings=theme%3Dlight", "the settings cookie alone reaches the app");
  assert.equal(SETTINGS_COOKIE, APP_SETTINGS_COOKIE, "darius serve and the web app name the same cookie");
  assert.equal(settingsCookie(`darius-settings=${"x".repeat(600)}`), null, "an oversized settings cookie stays out");
  assert.equal(settingsCookie("darius-settingsX=1; a=b"), null, "only the exact name passes");
  const second = JSON.parse(text((await get("/")).body));
  assert.notEqual(second.nonce, page.nonce, "a new nonce per request");
});

test("static files: hashed assets are immutable; nothing outside build/client is served", async () => {
  const asset = await get("/assets/app-1a2b.js");
  assert.equal(asset.status, 200);
  assert.match(asset.headers.get("content-type") ?? "", /text\/javascript/u);
  assert.match(asset.headers.get("cache-control") ?? "", /immutable/u);
  assert.equal((await get("/favicon.svg")).headers.get("cache-control"), "no-cache");
  for (const path of ["/../server/index.js", "/%2e%2e/server/index.js", "/..%2fbuild-info.json", "/assets/", "/%E0%A4%A"]) {
    assert.equal(staticFile(BUILD, path), null, path);
  }
  // URL resolves the dots to /server/index.js, which is no file under build/client: the app answers it.
  assert.equal(JSON.parse(text((await get("/%2e%2e/server/index.js")).body)).path, "/server/index.js");
});

test("without a build every page answers 503 with the build command; a new build on disk makes the app stale", async () => {
  const missing = new WebApp(join(SANDBOX, "nothing"));
  const answer = await respond("GET", new URL("http://x/"), NO_HEADERS, "x", missing);
  assert.equal(answer.status, 503);
  assert.match(text(answer.body), /not built/u);
  assert.equal((await respond("GET", new URL("http://x/api/status.json"), NO_HEADERS, "x", missing)).status, 200);
  const app = new WebApp(BUILD);
  assert.equal(app.isStale(), false);
  writeFileSync(join(BUILD, "build-info.json"), '{"sourceHash":"two"}\n');
  try {
    assert.equal(app.isStale(), true);
  } finally {
    writeFileSync(join(BUILD, "build-info.json"), '{"sourceHash":"one"}\n');
  }
});

test("the app's data: ritual and run details with events and findings blocks; unknowns are null", () => {
  const context = webContext("this host");
  assert.match(context.nonce, /^[A-Za-z0-9+/]{22}==$/u);
  const ritual = context.ritual("web-demo", "daily-report");
  assert.equal(ritual?.row.skill, "daily-report");
  assert.equal(ritual?.policy.mode, "report");
  assert.deepEqual(ritual?.body, [{ kind: "paragraph", lines: [[{ kind: "text", text: "x" }]] }]);
  assert.equal(ritual?.runs.length, 2);
  const detail = context.run("web-demo", run);
  assert.deepEqual([detail?.itemKind, detail?.itemSlug, detail?.row.outcome], ["ritual", "daily-report", "complete"]);
  assert.deepEqual(detail?.events.map((event) => [event.type, event.detail]), [["run.started", null], ["run.completed", "complete"]]);
  assert.deepEqual(detail?.findings?.[0], { kind: "heading", level: 1, content: [{ kind: "text", text: "Report" }] });
  assert.deepEqual(context.run("web-demo", held)?.events.map((event) => event.detail), [null, "may I <push>?"]);
  assert.equal(context.run("web-demo", "NOPE"), null);
  assert.equal(context.run("ghost", run), null);
  assert.equal(context.ritual("web-demo", "nope"), null);
  assert.equal(context.ritual("ghost", "daily-report"), null);
});

test("a failed run: runRows and RitualRow.failedToday carry who acknowledged it; the run's events show the note", () => {
  const project = openProject("web-ack", { create: true });
  const now = new Date().toISOString();
  project.writeItem(
    {
      header: { id: ulid(), kind: "ritual", slug: "nightly", title: "Nightly", created: now, updated: now, tags: [], cadence: "1d", anchor: "due", policy: { mode: "report", may: [], hold: [] } },
      body: "x\n",
    },
    { who: "test" },
  );
  const failed = ulid();
  appendLine(project, { who: "timer", type: "run.started", item: "ritual/nightly", run: failed });
  appendLine(project, { who: "timer", type: "run.completed", item: "ritual/nightly", run: failed, outcome: "failed" });
  const ritualOf = (): RitualRow["failedToday"] | undefined => collectStatus().projects.find((entry) => entry.name === "web-ack")?.rituals[0]?.failedToday;
  assert.deepEqual(ritualOf(), { run: failed, acknowledged: null });
  assert.equal(runRows(readLedger(project))[0]?.acknowledged, null);

  assert.equal(acknowledgeRun(project, { run: failed, who: "tester", note: "known outage" }).ok, true);
  const [row] = runRows(readLedger(project));
  assert.equal(row?.acknowledged?.who, "tester");
  assert.equal(row?.acknowledged?.note, "known outage");
  assert.match(row?.acknowledged?.at ?? "", /^\d{4}-\d\d-\d\dT/u);
  assert.deepEqual(ritualOf(), { run: failed, acknowledged: row?.acknowledged });
  assert.deepEqual(
    webContext("this host").run("web-ack", failed)?.events.map((event) => [event.type, event.detail]),
    [["run.started", null], ["run.completed", "failed"], ["run.acknowledged", "known outage"]],
  );
  assert.equal(webContext("this host").ritual("web-ack", "nightly")?.row.failedToday?.run, failed);
});

test("the ritual row carries its host pin", () => {
  const project = openProject("web-ack");
  const doc = project.readItem<Ritual>("ritual", "nightly");
  assert.ok(doc !== null);
  const rowOf = (): RitualRow | undefined => collectStatus().projects.find((entry) => entry.name === "web-ack")?.rituals[0];
  assert.equal(rowOf()?.host, null);
  project.writeItem({ header: { ...doc.header, host: "host-b" }, body: doc.body }, { who: "test" });
  assert.equal(rowOf()?.host, "host-b");
  assert.equal(webContext("this host").ritual("web-ack", "nightly")?.row.host, "host-b");
});

test("a repo ritual row carries its source, schedule, timeout and the git facts", () => {
  const project = openProject("web-ack");
  const doc = project.readItem<Ritual>("ritual", "nightly");
  assert.ok(doc !== null);
  const repo = { ...doc.header, source: "repo" as const, at: "07:00", tz: "Europe/Berlin", timeout: "30m", def_commit: "abcdef123456", def_host: "host-a", def_at: "2026-10-01T06:00:00.000Z", def_dirty: true };
  project.writeItem({ header: repo, body: doc.body }, { who: "test" });
  const row = webContext("this host").ritual("web-ack", "nightly")?.row;
  assert.deepEqual(
    [row?.source, row?.defCommit, row?.defHost, row?.defAt, row?.defDirty, row?.at, row?.zone, row?.timeout],
    ["repo", "abcdef123456", "host-a", "2026-10-01T06:00:00.000Z", true, "07:00", "Europe/Berlin", "30m"],
  );
  assert.match(row?.nextDueAt ?? "", /^\d{4}-\d{2}-\d{2}T/u);
  assert.deepEqual(row?.warnings, []);
  project.writeItem({ header: doc.header, body: doc.body }, { who: "test" });
  assert.equal(webContext("this host").ritual("web-ack", "nightly")?.row.source, null);
});

test("serve refuses every-interface binds and bad ports", () => {
  for (const bind of ["0.0.0.0", "::", "", "127.0.0.1,0.0.0.0"]) assert.throws(() => webBind(bind), /every interface/u, bind);
  assert.equal(webBind(undefined), "auto");
  assert.deepEqual(webBind("100.64.1.10"), ["100.64.1.10"]);
  assert.deepEqual(webBind("127.0.0.1, 100.64.1.10"), ["127.0.0.1", "100.64.1.10"]);
  assert.throws(() => webPort("0"), /1 to 65535/u);
  assert.throws(() => webPort("http"), /1 to 65535/u);
  assert.equal(webPort(undefined), 4747);
});

test("serve listens on 127.0.0.1 and stops on SIGTERM", async () => {
  const log = console.log;
  console.log = () => undefined;
  try {
    // auto: loopback now; the fake-less tailscale has no address, so no tailnet bind.
    const serving = serveCommand.run(parseArgs(["--port", "47991"]));
    await new Promise((resolve) => setTimeout(resolve, 200));
    const status = await new Promise<number>((resolve, reject) => {
      const req = request({ host: "127.0.0.1", port: 47_991, path: "/healthz" }, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      });
      req.on("error", reject);
      req.end();
    });
    assert.equal(status, 200);
    process.emit("SIGTERM");
    assert.equal(await serving, 0);
  } finally {
    console.log = log;
  }
});

/** One request to a listening serve on 127.0.0.1: status, content type, body. */
function call(port: number, options: { method: string; path: string; headers?: Record<string, string>; body?: string }): Promise<{ status: number; type: string; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, method: options.method, path: options.path, headers: options.headers ?? {} }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, type: String(res.headers["content-type"] ?? ""), body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.end(options.body ?? "");
  });
}

test("serve dispatches POST /api/run/follow-up to the action API; every other write stays 405 and the reads are unchanged (0.48.0)", async () => {
  const log = console.log;
  console.log = () => undefined;
  try {
    const serving = serveCommand.run(parseArgs(["--port", "47992", "--bind", "127.0.0.1"]));
    await new Promise((resolve) => setTimeout(resolve, 200));
    const body = JSON.stringify({ project: "demo", run: "01JX", approve: [1] });
    const loopback = await call(47_992, { method: "POST", path: "/api/run/follow-up", headers: { "content-type": "application/json" }, body });
    assert.equal(loopback.status, 403);
    assert.match(loopback.type, /^application\/json/u);
    assert.match(loopback.body, /the follow-up button needs a tailnet identity; open the page by its tailnet address/u, "loopback is \"this host\": refused before any other check");
    const read = await call(47_992, { method: "GET", path: "/api/run/follow-up" });
    assert.equal(read.status, 405, "the action API takes POST only");
    for (const path of ["/", "/p/demo/runs/01JX", "/api/status.json", "/api/run"]) {
      assert.equal((await call(47_992, { method: "POST", path, headers: { "content-type": "application/json" }, body })).status, 405, path);
    }
    const status = await call(47_992, { method: "GET", path: "/api/status.json" });
    assert.equal(status.status, 200);
    assert.match(status.type, /^application\/json/u);
    assert.equal((await call(47_992, { method: "GET", path: "/healthz" })).body, "ok\n");
    process.emit("SIGTERM");
    assert.equal(await serving, 0);
  } finally {
    console.log = log;
  }
});

function span(kind: MdSpan["kind"], value: string): MdSpan {
  return { kind, text: value };
}

test("findings markdown becomes blocks of spans; HTML and links stay plain text", () => {
  const blocks = parseMarkdown(
    [
      "# Title",
      "",
      "Some **bold** and `code` and *soft*.",
      "",
      "| Site | Visits |",
      "|---|---|",
      "| site-a | 2281 |",
      "",
      "- one",
      "- two <script>alert(1)</script>",
      "",
      "1. first",
      "2. second",
      "",
      "```",
      "<b>raw</b>",
      "```",
      "[click](javascript:alert(1)) <img src=x onerror=alert(1)>",
    ].join("\n"),
  );
  assert.deepEqual(blocks, [
    { kind: "heading", level: 1, content: [span("text", "Title")] },
    { kind: "paragraph", lines: [[span("text", "Some "), span("bold", "bold"), span("text", " and "), span("code", "code"), span("text", " and "), span("italic", "soft"), span("text", ".")]] },
    { kind: "table", head: [[span("text", "Site")], [span("text", "Visits")]], rows: [[[span("text", "site-a")], [span("text", "2281")]]] },
    { kind: "list", ordered: false, start: 1, items: [[span("text", "one")], [span("text", "two <script>alert(1)</script>")]] },
    { kind: "list", ordered: true, start: 1, items: [[span("text", "first")], [span("text", "second")]] },
    { kind: "code", text: "<b>raw</b>" },
    { kind: "paragraph", lines: [[span("text", "[click](javascript:alert(1)) <img src=x onerror=alert(1)>")]] },
  ]);
  assert.deepEqual(
    parseMarkdown("1. a\n   - x\n2. b").map((block) => (block.kind === "list" ? [block.ordered, block.start] : block.kind)),
    [[true, 1], [false, 1], [true, 2]],
  );
  assert.deepEqual(parseMarkdown("2 * 3 * 4"), [{ kind: "paragraph", lines: [[span("text", "2 * 3 * 4")]] }], "a lone star is no italic");
  assert.deepEqual(
    parseMarkdown("Raise time on page, and\nrecover **the ranking\ngaps** today."),
    [{ kind: "paragraph", lines: [[span("text", "Raise time on page, and recover "), span("bold", "the ranking gaps"), span("text", " today.")]] }],
    "a hard-wrapped paragraph flows as one line, bold across the wrap included",
  );
  assert.deepEqual(
    parseMarkdown("first  \nsecond\\\nthird"),
    [{ kind: "paragraph", lines: [[span("text", "first")], [span("text", "second")], [span("text", "third")]] }],
    "two trailing spaces or a backslash keep the break",
  );
});

test("markdown: checklist boxes as the tracker writes them, indented items, HTML comments left out", () => {
  const [list] = parseMarkdown(["- [x] done", "  - Command: `true`", "- [ ] open", "- [~] doing", "- [!] blocked", "- [-] skipped", "- [X] done too", "- plain"].join("\n"));
  assert.deepEqual(list, {
    kind: "list",
    ordered: false,
    start: 1,
    items: [[span("text", "done")], [span("text", "Command: "), span("code", "true")], [span("text", "open")], [span("text", "doing")], [span("text", "blocked")], [span("text", "skipped")], [span("text", "done too")], [span("text", "plain")]],
    checks: ["done", null, "open", "doing", "blocked", "skipped", "done", null],
    nested: [false, true, false, false, false, false, false, false],
  });
  assert.deepEqual(parseMarkdown("- a\n- b"), [{ kind: "list", ordered: false, start: 1, items: [[span("text", "a")], [span("text", "b")]] }], "a plain list has neither key");
  assert.deepEqual(
    parseMarkdown("<!-- opened: 2026-09-02 -->\ntext\n<!--\nmany\nlines\n-->\n<!-- not closed\nstays"),
    [{ kind: "paragraph", lines: [[span("text", "text")]] }, { kind: "paragraph", lines: [[span("text", "<!-- not closed stays")]] }],
    "a comment on its own lines is left out; one that never closes stays text",
  );
  assert.deepEqual(
    parseMarkdown("- first line\n  wraps here\n- [ ] box\n    wraps too\nnot indented"),
    [
      { kind: "list", ordered: false, start: 1, items: [[span("text", "first line wraps here")], [span("text", "box wraps too")]], checks: [null, "open"] },
      { kind: "paragraph", lines: [[span("text", "not indented")]] },
    ],
    "an indented line carries on the item above",
  );
  assert.deepEqual(parseMarkdown("a <!-- x --> b"), [{ kind: "paragraph", lines: [[span("text", "a <!-- x --> b")]] }], "a comment inside a line stays text");
});

// --- access -----------------------------------------------------------------------------

const OWNER_ON_LAPTOP = JSON.stringify({ UserProfile: { LoginName: "owner" }, Node: { ComputedName: "laptop", Tags: null } });
const TAGGED_SERVER = JSON.stringify({ UserProfile: { LoginName: "tagged-devices" }, Node: { ComputedName: "build-box", Tags: ["tag:server"] } });
const OTHER_USER = JSON.stringify({ UserProfile: { LoginName: "other-user" }, Node: { ComputedName: "other-box" } });

test("whois JSON: a person's device has a login; a tagged device has none", () => {
  assert.deepEqual(parseWhois(OWNER_ON_LAPTOP), { login: "owner", node: "laptop", tagged: false });
  assert.deepEqual(parseWhois(TAGGED_SERVER), { login: null, node: "build-box", tagged: true });
});

test("access: loopback passes; only an allowed login's own device passes from the tailnet; failures refuse", async () => {
  const devices = new Map([
    ["100.64.0.9", parseWhois(OWNER_ON_LAPTOP)],
    ["100.64.0.20", parseWhois(TAGGED_SERVER)],
    ["100.64.0.30", parseWhois(OTHER_USER)],
  ]);
  const context = { allow: new Set(["owner"]), whois: async (ip: string) => devices.get(ip) ?? null };
  assert.deepEqual(await authorize("127.0.0.1", context), { allowed: true, who: "this host", local: true });
  assert.deepEqual(await authorize("::1", context), { allowed: true, who: "this host", local: true });
  assert.deepEqual(await authorize("::ffff:127.0.0.1", context), { allowed: true, who: "this host", local: true });
  assert.deepEqual(await authorize("::ffff:100.64.0.9", context), { allowed: true, who: "owner on laptop" });
  const tagged = await authorize("100.64.0.20", context);
  assert.equal(tagged.allowed, false);
  assert.match(tagged.allowed ? "" : tagged.reason, /build-box is a tagged device/u);
  const other = await authorize("100.64.0.30", context);
  assert.match(other.allowed ? "" : other.reason, /belongs to other-user, who is not allowed/u);
  const stranger = await authorize("192.168.1.5", context);
  assert.match(stranger.allowed ? "" : stranger.reason, /not a device on this tailnet/u);
  const broken = await authorize("100.64.0.9", { allow: new Set(["owner"]), whois: () => Promise.reject(new Error("tailscaled is down")) });
  assert.match(broken.allowed ? "" : broken.reason, /could not ask Tailscale who 100\.64\.0\.9 is \(tailscaled is down\)/u);
  const nobody = await authorize("100.64.0.9", { allow: new Set(), whois: context.whois });
  assert.equal(nobody.allowed, false, "no allowed login known: nobody from the tailnet passes");
});

function named(device: string): Headers {
  return new Headers({ "x-tailnet-device": device });
}

test("behind a proxy: only the proxy's device header counts, and only for listed devices", async () => {
  const devices = new Map([["100.64.0.9", parseWhois(OWNER_ON_LAPTOP)]]);
  const proxy = proxyTrust({ DARIUS_WEB_PROXY: "100.64.0.50, 127.0.0.1", DARIUS_WEB_PROXY_DEVICES: "laptop,phone" });
  assert.notEqual(proxy, null);
  const context = { allow: new Set(["owner"]), whois: async (ip: string) => devices.get(ip) ?? null, proxy };
  assert.deepEqual(await authorizeRequest("::ffff:100.64.0.50", named("phone"), context), { allowed: true, who: "phone via the proxy" });
  const stranger = await authorizeRequest("100.64.0.50", named("tv"), context);
  assert.match(stranger.allowed ? "" : stranger.reason, /tv is not in DARIUS_WEB_PROXY_DEVICES/u);
  const bare = await authorizeRequest("100.64.0.50", new Headers(), context);
  assert.match(bare.allowed ? "" : bare.reason, /named no device/u);
  const unknown = await authorizeRequest("100.64.0.50", named("unknown"), context);
  assert.equal(unknown.allowed, false, "the proxy's own word for an unmapped caller");
  const local = await authorizeRequest("127.0.0.1", new Headers(), context);
  assert.equal(local.allowed, false, "a proxy on loopback: loopback no longer passes by itself");
  assert.deepEqual(await authorizeRequest("100.64.0.9", named("phone"), context), { allowed: true, who: "owner on laptop" }, "a direct caller's header is ignored");
  const forged = await authorizeRequest("100.64.0.30", named("laptop"), context);
  assert.equal(forged.allowed, false, "a direct caller cannot name itself");
  assert.deepEqual(await authorizeRequest("127.0.0.1", named("phone"), { ...context, proxy: null }), { allowed: true, who: "this host", local: true }, "without a proxy nothing changes");
  const header = proxyTrust({ DARIUS_WEB_PROXY: "100.64.0.50", DARIUS_WEB_PROXY_HEADER: "Tailscale-User-Login" });
  assert.equal(header?.header, "tailscale-user-login");
  assert.equal(header?.devices.size, 0, "no device listed: every proxied request is refused");
  assert.equal(proxyTrust({}), null);
});

test("whois answers are cached for a minute; DARIUS_WEB_ALLOW names the allowed logins", async () => {
  let calls = 0;
  let clock = 0;
  const lookup = cachedWhois(async () => {
    calls += 1;
    return parseWhois(OWNER_ON_LAPTOP);
  }, () => clock);
  await lookup("100.64.0.9");
  await lookup("100.64.0.9");
  assert.equal(calls, 1);
  clock = 61_000;
  await lookup("100.64.0.9");
  assert.equal(calls, 2);
  process.env.DARIUS_WEB_ALLOW = "owner, friend";
  try {
    assert.deepEqual([...(await allowedLogins())], ["owner", "friend"]);
  } finally {
    delete process.env.DARIUS_WEB_ALLOW;
  }
  assert.deepEqual([...(await allowedLogins())], [], "without Tailscale and without the variable nobody is allowed");
});

test("status: a linked checkout's legacy milestones reach the project, an unlinked project has none", () => {
  const checkout = mkdtempSync(join(tmpdir(), "darius-web-tracker-"));
  const spec = join(checkout, ".tracker", "M7-shop");
  mkdirSync(spec, { recursive: true });
  writeFileSync(join(spec, "00-README.md"), "---\nname: Shop\nstarted: 2026-09-01\n---\n");
  writeFileSync(join(spec, "01-cart.md"), "---\nupdated: 2026-09-02\n---\n\n# Cart\n\n- [x] a\n- [ ] b\n");
  mkdirSync(join(checkout, ".tracker", "archive"), { recursive: true });
  writeFileSync(join(checkout, ".tracker", "archive", "M1-old.md"), "# old\n");
  openProject("web-tracked", { create: true });
  openProject("web-untracked", { create: true });
  writeLink("web-tracked", checkout);
  const projects = collectStatus().projects;
  const tracked = projects.find((entry) => entry.name === "web-tracked");
  assert.equal(tracked?.milestonesArchived, 1);
  assert.deepEqual(
    tracked?.milestones.map((row) => [row.source, row.id, row.label, row.title, row.status, row.done, row.total]),
    [["legacy", "M7", "M7", "Shop", "In Progress", 1, 2]],
  );
  assert.deepEqual(tracked?.milestones[0]?.specs.map((row) => [row.source, row.slug, row.label, row.done, row.total]), [["legacy", "m7-01-cart", "M7/01", 1, 2]]);
  const untracked = projects.find((entry) => entry.name === "web-untracked");
  assert.deepEqual([untracked?.milestones, untracked?.milestonesArchived], [[], 0]);
});

test("milestone detail through the WebContext: README, spec texts and worklogs as blocks, unknown ones null", () => {
  const checkout = mkdtempSync(join(tmpdir(), "darius-web-tracker-"));
  const dir = join(checkout, ".tracker", "M8-mail");
  mkdirSync(join(dir, "_notes"), { recursive: true });
  mkdirSync(join(checkout, ".tracker", "worklog"), { recursive: true });
  writeFileSync(join(dir, "00-README.md"), "---\nname: Mail\ntarget: 2026-10-01\n---\n\n# Mail\n\nSend <script>alert(1)</script> once.\n");
  writeFileSync(join(dir, "01-sender.md"), "---\nupdated: 2026-09-02\n---\n\n# Sender\n\n- [x] one\n- [ ] two\n");
  writeFileSync(join(dir, "_notes", "run.sh"), "echo hi\n");
  writeFileSync(join(checkout, ".tracker", "worklog", "M8-mail.md"), "## Thread\n\n<!-- opened: 2026-09-02T10:00:00Z -->\n\n- note\n");
  openProject("web-detail", { create: true });
  writeLink("web-detail", checkout);
  const context = webContext("tester");
  const detail = context.milestone("web-detail", "M8");
  assert.ok(detail !== null);
  assert.deepEqual([detail.project, detail.dir, detail.row.id, detail.row.title, detail.row.target, detail.row.done, detail.row.total], ["web-detail", "M8-mail", "M8", "Mail", "2026-10-01", 1, 2]);
  assert.deepEqual(detail.readme?.body?.[1], { kind: "paragraph", lines: [[span("text", "Send <script>alert(1)</script> once.")]] }, "untrusted text stays text");
  assert.equal(detail.readme?.path, "00-README.md");
  const [sender] = detail.specs;
  assert.deepEqual([sender?.row.label, sender?.row.source, sender?.file.path, sender?.file.lines], ["M8/01", "legacy", "01-sender.md", 6]);
  assert.deepEqual(sender?.file.body?.[1], { kind: "list", ordered: false, start: 1, items: [[span("text", "one")], [span("text", "two")]], checks: ["done", "open"] });
  assert.deepEqual(detail.others.map((file) => [file.path, file.body, file.omitted]), [["_notes/run.sh", [{ kind: "code", text: "echo hi\n" }], null]], "another text file is one code block");
  const [worklog] = detail.worklogs;
  assert.deepEqual([worklog?.path, worklog?.link, worklog?.distilledAt, worklog?.omitted], ["M8-mail.md", "name", null, null]);
  assert.deepEqual(worklog?.body?.map((block) => block.kind), ["heading", "list"], "the thread marker comment is not shown");
  assert.ok(Number.isInteger(worklog?.size) && (worklog?.size ?? 0) > 0, "its size in bytes");
  assert.equal(context.milestone("web-detail", "M9"), null);
  assert.equal(context.milestone("web-detail", "../M8-mail"), null);
  assert.equal(context.milestone("no-such-project", "M8"), null);
  openProject("web-detail-unlinked", { create: true });
  assert.equal(context.milestone("web-detail-unlinked", "M8"), null, "a project without a checkout on this host");
});
