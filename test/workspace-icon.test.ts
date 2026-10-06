/**
 * The workspace icon (0.70.0): the file checks of src/web/workspace-icon.ts,
 * the `GET /api/workspace-icon/<project>` route of src/cli/serve.ts, and the
 * `icon` field of the status (src/web/status.ts). Every checkout is a temp
 * directory; the route goes through `respond()` without a socket, plus one
 * real listen on 127.0.0.1 for the access check.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SANDBOX = mkdtempSync(join(tmpdir(), "darius-workspace-icon-"));
process.env.DARIUS_STATE_DIR = join(SANDBOX, "state");
process.env.DARIUS_CONFIG_DIR = join(SANDBOX, "config");
process.env.DARIUS_TAILSCALE = join(SANDBOX, "no-tailscale");
delete process.env.DARIUS_WEB_BIND;
delete process.env.DARIUS_WEB_ALLOW;

const { parseArgs } = await import("../src/cli/args.ts");
const { WebApp, respond, serveCommand } = await import("../src/cli/serve.ts");
const { writeLink } = await import("../src/core/links.ts");
const { openProject } = await import("../src/core/store.ts");
const { collectStatus } = await import("../src/web/status.ts");
const { MAX_ICON_BYTES, readWorkspaceIcon, sniffIconType, workspaceIconOf } = await import("../src/web/workspace-icon.ts");

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
const WEBP = new Uint8Array([...new TextEncoder().encode("RIFF"), 26, 0, 0, 0, ...new TextEncoder().encode("WEBPVP8 ")]);
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6"/></svg>\n';
const V3 = 'v = 3\ntz = "UTC"\n';

let counter = 0;

/** A checkout dir with `files` (path to content) written under it. */
function repo(files: Readonly<Record<string, string | Uint8Array>>): string {
  counter += 1;
  const dir = join(SANDBOX, `repo-${String(counter)}`);
  mkdirSync(dir, { recursive: true });
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  return dir;
}

function reasonOf(checkout: string, path: string): string {
  const read = readWorkspaceIcon(checkout, path);
  assert.equal(read.ok, false, `${path} must be refused`);
  return read.ok ? "" : read.reason;
}

// --- readWorkspaceIcon -------------------------------------------------------------

test("readWorkspaceIcon: a PNG, a WebP and an SVG pass, with the type from the bytes and a strong ETag", () => {
  const dir = repo({ "a/logo.png": PNG, "b.webp": WEBP, "c/d/icon.SVG": SVG });
  const cases: [string, string, Uint8Array][] = [
    ["a/logo.png", "image/png", PNG],
    ["b.webp", "image/webp", WEBP],
    ["c/d/icon.SVG", "image/svg+xml", new TextEncoder().encode(SVG)],
  ];
  for (const [path, type, content] of cases) {
    const read = readWorkspaceIcon(dir, path);
    assert.ok(read.ok, read.ok ? "" : read.reason);
    assert.equal(read.icon.type, type, path);
    assert.deepEqual(read.icon.bytes, content);
    assert.match(read.icon.etag, /^"[0-9a-f]{16}"$/u);
  }
});

test("readWorkspaceIcon: an SVG may start with a BOM, an XML prolog and comments", () => {
  const dir = repo({
    "bom.svg": `﻿${SVG}`,
    "prolog.svg": `<?xml version="1.0" encoding="UTF-8"?>\n<!-- made by hand -->\n  <!-- two -->\n${SVG}`,
    "spaced.svg": `\n\n<svg\n  viewBox="0 0 1 1"/>`,
  });
  for (const path of ["bom.svg", "prolog.svg", "spaced.svg"]) assert.equal(readWorkspaceIcon(dir, path).ok, true, path);
});

test("readWorkspaceIcon: text that is not an SVG is refused, a DOCTYPE and an unclosed comment included", () => {
  const dir = repo({
    "html.svg": "<html><svg/></html>",
    "doctype.svg": `<!DOCTYPE svg [<!ENTITY a "b">]>\n${SVG}`,
    "open.svg": `<!-- never closed ${SVG}`,
    "svgfoo.svg": "<svgfoo/>",
    "binary.svg": new Uint8Array([0x3c, 0x73, 0x76, 0x67, 0x20, 0xff, 0xfe]),
  });
  for (const path of ["html.svg", "doctype.svg", "open.svg", "svgfoo.svg", "binary.svg"]) {
    assert.equal(reasonOf(dir, path), "the icon file is not a PNG, WebP or SVG image", path);
  }
});

test("readWorkspaceIcon: the extension must agree with the magic bytes", () => {
  const dir = repo({ "png.svg": PNG, "svg.png": SVG, "webp.png": WEBP });
  assert.equal(reasonOf(dir, "png.svg"), "the icon file is png by its content, but its name ends in .svg");
  assert.equal(reasonOf(dir, "svg.png"), "the icon file is svg by its content, but its name ends in .png");
  assert.equal(reasonOf(dir, "webp.png"), "the icon file is webp by its content, but its name ends in .png");
});

test("readWorkspaceIcon: a file over 64 KB is refused; exactly 64 KB passes", () => {
  const exact = new Uint8Array(MAX_ICON_BYTES);
  exact.set(PNG);
  const over = new Uint8Array(MAX_ICON_BYTES + 1);
  over.set(PNG);
  const dir = repo({ "exact.png": exact, "big.png": over });
  assert.equal(readWorkspaceIcon(dir, "exact.png").ok, true);
  assert.match(reasonOf(dir, "big.png"), /^the icon file is 65537 bytes, more than 65536$/u);
});

test("readWorkspaceIcon: a symlink out of the checkout is refused; one inside it is followed", () => {
  const outside = repo({ "secret.svg": SVG });
  const dir = repo({ "real/logo.svg": SVG });
  symlinkSync(join(outside, "secret.svg"), join(dir, "escape.svg"));
  symlinkSync(outside, join(dir, "linked"));
  symlinkSync(join(dir, "real", "logo.svg"), join(dir, "inside.svg"));
  assert.equal(reasonOf(dir, "escape.svg"), "the icon file resolves to a place outside the checkout");
  assert.equal(reasonOf(dir, "linked/secret.svg"), "the icon file resolves to a place outside the checkout");
  assert.equal(readWorkspaceIcon(dir, "inside.svg").ok, true);
});

test("readWorkspaceIcon: a directory, a missing file and a path the marker would refuse give a reason, never a throw", () => {
  const dir = repo({ "folder.svg/x": "x" });
  assert.equal(reasonOf(dir, "folder.svg"), "the icon path is not a regular file");
  assert.match(reasonOf(dir, "missing.svg"), /^the icon file cannot be found: /u);
  assert.match(reasonOf(dir, "../outside.svg"), /^the icon path is not valid: a path may not hold a \.\. part$/u);
  assert.match(reasonOf(dir, "/etc/passwd.svg"), /^the icon path is not valid: /u);
  assert.match(reasonOf(dir, "logo.gif"), /^the icon path is not valid: /u);
  assert.match(reasonOf(join(SANDBOX, "no-such-checkout"), "logo.svg"), /^the checkout cannot be read: /u);
});

test("sniffIconType reads the first bytes only, never the name", () => {
  assert.equal(sniffIconType(PNG), "png");
  assert.equal(sniffIconType(WEBP), "webp");
  assert.equal(sniffIconType(new TextEncoder().encode(SVG)), "svg");
  assert.equal(sniffIconType(new TextEncoder().encode("RIFF1234WAVE")), undefined);
  assert.equal(sniffIconType(new Uint8Array()), undefined);
});

// --- the route ---------------------------------------------------------------------

/** A project in the store whose linked checkout has `marker` and `files`. */
function linkedProject(name: string, marker: string | null, files: Readonly<Record<string, string | Uint8Array>> = {}): string {
  openProject(name, { create: true });
  const dir = repo(marker === null ? files : { ".darius.toml": `${V3}project = "${name}"\n${marker}`, ...files });
  writeLink(name, dir);
  return dir;
}

linkedProject("icon-svg", 'icon = "assets/logo.svg"\n', { "assets/logo.svg": SVG });
linkedProject("icon-png", 'icon = "logo.png"\n', { "logo.png": PNG });
linkedProject("icon-emoji", 'icon = "🎯"\n');
linkedProject("icon-missing", 'icon = "assets/gone.svg"\n');
const escapeRepo = linkedProject("icon-escape", 'icon = "escape.svg"\n');
linkedProject("icon-none", "");
openProject("icon-unlinked", { create: true });
const escapeTarget = repo({ "secret.svg": SVG });
symlinkSync(join(escapeTarget, "secret.svg"), join(escapeRepo, "escape.svg"));

const APP = new WebApp(join(SANDBOX, "no-build"));

function isText(body: string | Uint8Array): body is string {
  return typeof body === "string";
}

function bodyText(body: string | Uint8Array): string {
  return isText(body) ? body : new TextDecoder().decode(body);
}

async function getIcon(path: string, headers: Headers = new Headers()): ReturnType<typeof respond> {
  return respond("GET", new URL(path, "http://host-a:4747"), headers, "owner on host-b", APP);
}

/** Runs `body` with console.error captured; returns what it logged. */
async function quietly(body: () => Promise<void>): Promise<string[]> {
  const logged: string[] = [];
  const { error } = console;
  console.error = (...parts: string[]) => logged.push(parts.join(" "));
  try {
    await body();
  } finally {
    console.error = error;
  }
  return logged;
}

test("GET /api/workspace-icon/<project>: 200 with the bytes, the detected type and the safety headers", async () => {
  const svg = await getIcon("/api/workspace-icon/icon-svg");
  assert.equal(svg.status, 200);
  assert.equal(bodyText(svg.body), SVG);
  assert.equal(svg.headers.get("content-type"), "image/svg+xml");
  assert.equal(svg.headers.get("x-content-type-options"), "nosniff");
  assert.equal(svg.headers.get("content-security-policy"), "default-src 'none'; style-src 'unsafe-inline'; sandbox");
  assert.equal(svg.headers.get("cache-control"), "private, max-age=300");
  assert.match(svg.headers.get("etag") ?? "", /^"[0-9a-f]{16}"$/u);
  const png = await getIcon("/api/workspace-icon/icon-png?v=whatever");
  assert.equal(png.status, 200);
  assert.equal(png.headers.get("content-type"), "image/png");
  assert.deepEqual(png.body, PNG);
});

test("GET /api/workspace-icon: If-None-Match with the ETag gives 304 and no body", async () => {
  const first = await getIcon("/api/workspace-icon/icon-svg");
  const etag = first.headers.get("etag") ?? "";
  for (const header of [etag, `W/${etag}`, `"other", ${etag}`, "*"]) {
    const again = await getIcon("/api/workspace-icon/icon-svg", new Headers({ "if-none-match": header }));
    assert.equal(again.status, 304, header);
    assert.equal(bodyText(again.body), "");
    assert.equal(again.headers.get("etag"), etag);
  }
  assert.equal((await getIcon("/api/workspace-icon/icon-svg", new Headers({ "if-none-match": '"other"' }))).status, 200);
});

test("GET /api/workspace-icon: every failure is the same plain 404 with no path or reason; the reason goes to the log", async () => {
  const paths = [
    "/api/workspace-icon/no-such-project",
    "/api/workspace-icon/icon-unlinked",
    "/api/workspace-icon/icon-none",
    "/api/workspace-icon/icon-emoji",
    "/api/workspace-icon/icon-missing",
    "/api/workspace-icon/icon-escape",
    "/api/workspace-icon/",
    "/api/workspace-icon/..%2F..%2Fetc",
    "/api/workspace-icon/icon-svg/extra",
    "/api/workspace-icon/_global",
  ];
  const logged = await quietly(async () => {
    for (const path of paths) {
      const answer = await getIcon(path);
      assert.equal(answer.status, 404, path);
      assert.equal(bodyText(answer.body), "not found\n", path);
      assert.equal(answer.headers.get("content-type"), "text/plain; charset=utf-8");
      assert.equal(answer.headers.get("etag"), null);
    }
  });
  assert.equal(logged.length, paths.length);
  assert.match(logged.join("\n"), /workspace icon icon-escape: the icon file resolves to a place outside the checkout/u);
  assert.match(logged.join("\n"), /workspace icon \(bad name\): not a project name/u);
  assert.match(logged.join("\n"), /workspace icon icon-unlinked: the project has no checkout on this host/u);
});

test("the icon route takes GET (and HEAD) only: POST, PUT and DELETE are 405", async () => {
  for (const method of ["POST", "PUT", "DELETE"]) {
    const answer = await respond(method, new URL("http://x/api/workspace-icon/icon-svg"), new Headers(), "x", APP);
    assert.equal(answer.status, 405, method);
  }
  assert.equal((await respond("HEAD", new URL("http://x/api/workspace-icon/icon-svg"), new Headers(), "x", APP)).status, 200);
});

test("serve answers the icon route to a loopback caller, through the access check", async () => {
  const log = console.log;
  console.log = () => undefined;
  try {
    const serving = serveCommand.run(parseArgs(["--port", "47997", "--bind", "127.0.0.1"]));
    await new Promise((resolve) => setTimeout(resolve, 200));
    const answer = await new Promise<{ status: number; type: string; body: string }>((resolve, reject) => {
      const req = request({ host: "127.0.0.1", port: 47_997, path: "/api/workspace-icon/icon-svg" }, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, type: String(res.headers["content-type"] ?? ""), body: Buffer.concat(chunks).toString("utf8") }));
      });
      req.on("error", reject);
      req.end();
    });
    process.emit("SIGTERM");
    assert.equal(await serving, 0);
    assert.equal(answer.status, 200);
    assert.equal(answer.type, "image/svg+xml");
    assert.equal(answer.body, SVG);
  } finally {
    console.log = log;
  }
});

// --- the status --------------------------------------------------------------------

test("status: an emoji icon is its text, a valid image is the endpoint path with a cache buster, anything else is null", () => {
  const byName = new Map(collectStatus().projects.map((project) => [project.name, project.icon]));
  assert.deepEqual(byName.get("icon-emoji"), { kind: "emoji", text: "🎯" });
  const svg = byName.get("icon-svg");
  assert.equal(svg?.kind, "image");
  assert.match(svg?.kind === "image" ? svg.src : "", /^\/api\/workspace-icon\/icon-svg\?v=[0-9a-f]{16}$/u);
  for (const name of ["icon-missing", "icon-escape", "icon-none", "icon-unlinked"]) assert.equal(byName.get(name), null, name);
});

test("workspaceIconOf: no checkout, no marker, an older marker or a broken one give null, never a throw", () => {
  assert.equal(workspaceIconOf("p", null), null);
  assert.equal(workspaceIconOf("p", repo({})), null);
  assert.equal(workspaceIconOf("p", repo({ ".darius.toml": 'v = 2\nproject = "p"\n' })), null);
  assert.equal(workspaceIconOf("p", repo({ ".darius.toml": 'v = 3\nproject = "p"\nicon = "two words"\n' })), null);
  assert.equal(workspaceIconOf("p", repo({ ".darius.toml": "not toml at all = = =\n" })), null);
});

test("status: the cache buster changes when the image changes", () => {
  const dir = repo({ ".darius.toml": `${V3}project = "p"\nicon = "logo.svg"\n`, "logo.svg": SVG });
  const before = workspaceIconOf("p", dir);
  writeFileSync(join(dir, "logo.svg"), SVG.replace('r="6"', 'r="7"'));
  const after = workspaceIconOf("p", dir);
  assert.ok(before?.kind === "image" && after?.kind === "image");
  assert.notEqual(after.src, before.src);
});
