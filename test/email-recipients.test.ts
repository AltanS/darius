/**
 * Mail recipients per project (0.128.0): `[email] to` in a project's
 * `.darius.toml` (src/core/marker.ts), resolved at send time on the sending
 * host (src/core/email-recipients.ts), for candle and report mails
 * (src/core/alerts.ts), `darius email status` and `darius email test
 * --project` (src/cli/email.ts), and `darius marker check`.
 *
 * SAFETY: the state and config dirs are `mkdtemp` dirs, the checkouts are
 * throwaway git repos under the sandbox, and the provider is a fake on
 * 127.0.0.1. Nothing here reaches a real provider or a real store. The token
 * and the addresses are placeholders.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseArgs } from "../src/cli/args.ts";
import { emailCommand } from "../src/cli/email.ts";
import { markerCommand } from "../src/cli/marker.ts";
import type { Command, ParsedArgs } from "../src/cli/registry.ts";
import { flushAlerts, NOT_SET_UP } from "../src/core/alerts.ts";
import { emailSettingsFile, parseEmailInput, writeEmailSettings, type EmailSettings } from "../src/core/email.ts";
import { projectRecipients } from "../src/core/email-recipients.ts";
import { appendLine, readLedger } from "../src/core/ledger.ts";
import { writeLink } from "../src/core/links.ts";
import { decodeMarker } from "../src/core/marker.ts";
import type { LedgerLine, Ritual } from "../src/core/model.ts";
import { GLOBAL_PROJECT, openProject, putBlob, type Project } from "../src/core/store.ts";
import { ulid } from "../src/core/ulid.ts";
import { errorMessage } from "../src/runtime.ts";

const SANDBOX = mkdtempSync(join(tmpdir(), "darius-email-recipients-"));
process.env.DARIUS_STATE_DIR = join(SANDBOX, "state");
process.env.DARIUS_CONFIG_DIR = join(SANDBOX, "config");
mkdirSync(process.env.DARIUS_CONFIG_DIR, { recursive: true, mode: 0o700 });
writeFileSync(join(process.env.DARIUS_CONFIG_DIR, "config.toml"), 'host = "host-a"\n');
// A suite run inside a darius run must not see its own run.
delete process.env.DARIUS_RUN;
delete process.env.DARIUS_RUN_POLICY;
delete process.env.DARIUS_PROJECT;

const TOKEN = "your-token-here";
const FROM = "darius@example.com";
const HOST_TO = ["ops@example.com", "Second Person <second@example.com>"];
const MARKER_TO = ["team@example.org", "Lead <lead@example.org>"];
const ALL_ADDRESSES = ["ops@example.com", "second@example.com", "team@example.org", "lead@example.org", FROM];
const MAIL_PATH = "/v1/private-path/send";

// --- a fake provider ----------------------------------------------------------------------

interface Provider {
  bodies: string[];
  status: number;
}

const provider: Provider = { bodies: [], status: 202 };

const server = createServer((request: IncomingMessage, response: ServerResponse) => {
  let body = "";
  request.setEncoding("utf8");
  request.on("data", (chunk: string) => {
    body += chunk;
  });
  request.on("end", () => {
    provider.bodies.push(body);
    response.writeHead(provider.status);
    // An error answer echoes the request, as a careless provider might.
    response.end(provider.status < 300 ? "" : body);
  });
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
// SAFETY: a server listening on a TCP port reports an AddressInfo, never a pipe name or null.
const origin = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
test.after(() => {
  server.closeAllConnections();
  server.close();
});
test.beforeEach(() => {
  provider.bodies = [];
  provider.status = 202;
  rmSync(emailSettingsFile(), { force: true });
});

// --- helpers ------------------------------------------------------------------------------

function settings(more: Partial<EmailSettings> = {}): EmailSettings {
  return { url: `${origin}${MAIL_PATH}`, token: TOKEN, from: FROM, to: HOST_TO, since: "2026-01-01T00:00:00.000Z", ...more };
}

function sentTo(index = 0): string[] {
  return JSON.parse(provider.bodies[index] ?? "{}").to;
}

function git(dir: string, args: string[]): void {
  const result = spawnSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", ...args], { cwd: dir, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
}

function markerText(project: string, email?: string): string {
  return `v = 3\nproject = "${project}"\ntz = "UTC"\n${email === undefined ? "" : `\n[email]\n${email}\n`}`;
}

interface Workspace {
  project: Project;
  dir: string;
}

/** A store project and a committed checkout linked on this host. `email` is the `[email]` body, or none. */
function workspace(name: string, email?: string): Workspace {
  const project = openProject(name, { create: true });
  const dir = join(SANDBOX, "checkouts", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, ".darius.toml"), markerText(name, email));
  git(dir, ["init", "-q"]);
  git(dir, ["add", ".darius.toml"]);
  git(dir, ["commit", "-q", "-m", "marker"]);
  writeLink(name, dir);
  return { project, dir };
}

function toLine(list: readonly string[]): string {
  return `to = [${list.map((entry) => JSON.stringify(entry)).join(", ")}]`;
}

function light(project: Project, key: string): LedgerLine {
  return appendLine(project, { who: "script", type: "candle.lit", key, title: `Candle ${key}`, severity: "high", source: "ci:nightly", deliver: ["email"] });
}

let runCount = 0;

/** A report-mail ritual and one complete run of it. */
function reportRun(project: Project): LedgerLine {
  const now = new Date().toISOString();
  const header: Ritual = { id: ulid(), kind: "ritual", slug: "daily", title: "Daily", created: now, updated: now, tags: [], anchor: "due", policy: { mode: "report", may: [], hold: [] }, report_deliver: ["email"] };
  project.writeItem({ header, body: "Do it." }, { who: "test" });
  runCount += 1;
  const findings = `# Report\n\nSent by ${HOST_TO[0] ?? ""} and nobody else.\n`;
  return appendLine(project, { who: "t", type: "run.completed", item: "ritual/daily", run: `RUN${String(runCount).padStart(4, "0")}`, outcome: "complete", findings_sha: putBlob(project, findings) });
}

function alertLines(project: Project): LedgerLine[] {
  return readLedger(project).filter((line) => line.type.startsWith("alert."));
}

function assertClean(text: string, what: string): void {
  for (const address of ALL_ADDRESSES) assert.equal(text.toLowerCase().includes(address), false, `${what} holds ${address}`);
}

/** Every file of the store, which is what syncs, holds no address. Blobs hold run text and are skipped. */
function assertStoreClean(): void {
  const root = process.env.DARIUS_STATE_DIR ?? "";
  for (const name of readdirSync(root, { recursive: true, encoding: "utf8" })) {
    const path = join(root, name);
    if (!statSync(path).isFile() || path.includes("/blobs/")) continue;
    assertClean(readFileSync(path, "utf8"), path);
  }
}

interface CliRun {
  code: number;
  stdout: string;
}

async function cli(command: Command, argv: string[], cwd?: string): Promise<CliRun> {
  const args: ParsedArgs = parseArgs(argv, command.flags);
  const out: string[] = [];
  const { log, error } = console;
  const before = process.cwd();
  console.log = (...parts: string[]) => out.push(parts.join(" "));
  console.error = (...parts: string[]) => out.push(parts.join(" "));
  if (cwd !== undefined) process.chdir(cwd);
  try {
    return { code: await command.run(args), stdout: out.join("\n") };
  } finally {
    console.log = log;
    console.error = error;
    process.chdir(before);
  }
}

// --- the marker key -----------------------------------------------------------------------

test("[email] to parses, dedupes and allows []; it needs v = 3 and quotes no address in an error", () => {
  const file = "/repo/.darius.toml";
  assert.deepEqual(decodeMarker(markerText("acme-web", toLine([...MARKER_TO, MARKER_TO[0] ?? ""])), file).emailTo, MARKER_TO);
  assert.deepEqual(decodeMarker(markerText("acme-web", "to = []"), file).emailTo, []);
  assert.equal(decodeMarker(markerText("acme-web"), file).emailTo, undefined);
  const cases: ReadonlyArray<[string, RegExp]> = [
    [markerText("acme-web", 'to = "team@example.org"'), /:6: \[email\] to must be a list of addresses/u],
    [markerText("acme-web", 'to = ["team@example.org", "lead at example.org"]'), /:6: \[email\] to\[1\] must be an email address/u],
    [markerText("acme-web", 'to = ["team@example.org"]\ncc = ["lead@example.org"]'), /:7: unknown key "cc"/u],
    [markerText("acme-web", 'cc = ["lead@example.org"]'), /unknown key "cc"/u],
    [`v = 2\nproject = "acme-web"\n[email]\nto = ["team@example.org"]\n`, /:4: \[email\] needs v = 3/u],
  ];
  for (const [text, pattern] of cases) {
    assert.throws(() => decodeMarker(text, file), (cause) => {
      assert.match(errorMessage(cause), pattern);
      assertClean(errorMessage(cause), "the error");
      return true;
    });
  }
});

test("marker check prints the count of [email] to and never an address", async () => {
  const { dir } = workspace("mc-web", toLine(MARKER_TO));
  const human = await cli(markerCommand, ["check", dir]);
  assert.equal(human.code, 0, human.stdout);
  assert.match(human.stdout, /^email: 2 recipients$/mu);
  assertClean(human.stdout, "marker check");
  const json = await cli(markerCommand, ["check", dir, "--json"]);
  assert.equal(JSON.parse(json.stdout).email_recipients, 2);
  assertClean(json.stdout, "marker check --json");
});

// --- resolution ---------------------------------------------------------------------------

test("resolution: the marker list replaces the default, [] is no mail, no key or no checkout falls back, _global uses the default", () => {
  const host = settings();
  assert.deepEqual(projectRecipients(workspace("rs-list", toLine(MARKER_TO)).project, host), { to: MARKER_TO, source: "marker" });
  assert.deepEqual(projectRecipients(workspace("rs-empty", "to = []").project, host), { to: [], source: "marker" });
  assert.deepEqual(projectRecipients(workspace("rs-nokey").project, host), { to: HOST_TO, source: "host" });
  assert.deepEqual(projectRecipients(openProject("rs-nocheckout", { create: true }), host), { to: HOST_TO, source: "host" });
  assert.deepEqual(projectRecipients(openProject(GLOBAL_PROJECT, { create: true }), host), { to: HOST_TO, source: "host" });
  assert.deepEqual(projectRecipients(workspace("rs-nokey-empty").project, settings({ to: [] })), { to: [], source: "host" });
});

test("resolution: a marker that does not parse, names another project, or has [email] and uncommitted changes is a problem with no address", () => {
  const host = settings();
  const broken = workspace("rp-broken", toLine(MARKER_TO));
  writeFileSync(join(broken.dir, ".darius.toml"), `${markerText("rp-broken")}\n[email]\nto = [team@example.org]\n`);
  const other = workspace("rp-other");
  writeFileSync(join(other.dir, ".darius.toml"), markerText("someone-else", toLine(MARKER_TO)));
  const dirty = workspace("rp-dirty", toLine(MARKER_TO));
  writeFileSync(join(dirty.dir, ".darius.toml"), markerText("rp-dirty", toLine(["new@example.org"])));
  const dirtyNoKey = workspace("rp-dirty-nokey");
  writeFileSync(join(dirtyNoKey.dir, ".darius.toml"), `${markerText("rp-dirty-nokey")}# a comment\n`);
  for (const [project, pattern] of [[broken.project, /does not parse/u], [other.project, /names another project/u], [dirty.project, /uncommitted changes/u]] as const) {
    const found = projectRecipients(project, host);
    assert.ok("problem" in found, project.name);
    assert.match(found.problem, pattern);
    assertClean(found.problem, "the problem");
    assert.equal(found.problem.includes(SANDBOX), false, "no path");
  }
  // A dirty marker without the key changes nothing for 0.127.0 setups: the default applies.
  assert.deepEqual(projectRecipients(dirtyNoKey.project, host), { to: HOST_TO, source: "host" });
});

test("email.json takes an absent or empty to; set says only marked projects get mail", async () => {
  const { to: _to, ...withoutTo } = settings();
  assert.deepEqual(parseEmailInput(JSON.stringify(withoutTo)).to, []);
  assert.deepEqual(parseEmailInput(JSON.stringify({ ...withoutTo, to: [] })).to, []);
  const args = parseArgs(["set", "--stdin"], emailCommand.flags);
  args.stdin = JSON.stringify({ ...withoutTo, to: [] });
  const out: string[] = [];
  const { log } = console;
  console.log = (...parts: string[]) => out.push(parts.join(" "));
  try {
    assert.equal(await emailCommand.run(args), 0);
  } finally {
    console.log = log;
  }
  assert.match(out.join("\n"), /0 recipients by default/u);
  assert.match(out.join("\n"), /Only a project whose \.darius\.toml names recipients/u);
});

// --- the send -----------------------------------------------------------------------------

test("a candle mail and a report mail of a project with [email] to go only to the marker list, and no line holds an address", async () => {
  writeEmailSettings(settings());
  const { project } = workspace("send-web", toLine(MARKER_TO));
  light(project, "k1");
  reportRun(project);
  await flushAlerts({ projects: [project.name] });
  assert.equal(provider.bodies.length, 2, "one candle mail and one report");
  assert.deepEqual(sentTo(0), MARKER_TO);
  assert.deepEqual(sentTo(1), MARKER_TO);
  const sent = alertLines(project).filter((line) => line.type === "alert.sent");
  assert.equal(sent.length, 2);
  assert.ok(sent.every((line) => line.devices === MARKER_TO.length), "delivered is the resolved list's length");
  // The host's own addresses are still scrubbed from the report body.
  const report = JSON.parse(provider.bodies[1] ?? "{}");
  assert.equal(report.text.includes("ops@example.com"), false);
  assert.match(report.text, /Sent by \[address\]/u);
  assertStoreClean();
});

test("a project with no checkout here, or no key, mails the host default", async () => {
  writeEmailSettings(settings());
  const { project } = workspace("send-nokey");
  light(project, "k1");
  const bare = openProject("send-nocheckout", { create: true });
  light(bare, "k1");
  await flushAlerts({ projects: [project.name, bare.name] });
  assert.equal(provider.bodies.length, 2);
  assert.deepEqual(sentTo(0), HOST_TO);
  assert.deepEqual(sentTo(1), HOST_TO);
});

for (const [label, email, host] of [
  ["an empty default and no key", undefined, settings({ to: [] })],
  ["[email] to = [] with a default set", "to = []", settings()],
] as const) {
  test(`${label}: no mail; a candle notice leaves one trace that is no try, a report leaves no line, and a second flush adds nothing`, async () => {
    writeEmailSettings(host);
    const { project } = workspace(`mute-${email === undefined ? "default" : "marker"}`, email);
    light(project, "k1");
    reportRun(project);
    const first = await flushAlerts({ projects: [project.name] });
    assert.equal(provider.bodies.length, 0, "no request");
    const traces = alertLines(project);
    assert.equal(traces.length, 1, "one line: the candle trace");
    const [trace] = traces;
    assert.equal(trace?.type, "alert.failed");
    assert.match(trace?.key ?? "", /^line:.+:email$/u);
    assert.ok(String(trace?.error).startsWith(`${NOT_SET_UP} for this project: `), String(trace?.error));
    assert.equal(first?.sent, 0);
    await flushAlerts({ projects: [project.name] });
    await flushAlerts({ projects: [project.name] });
    assert.equal(provider.bodies.length, 0);
    assert.equal(alertLines(project).length, 1, "no more lines");
    assertStoreClean();
  });
}

test("a failed send to the marker list records a line with no address, also when the provider echoes the request", async () => {
  writeEmailSettings(settings());
  const { project } = workspace("fail-web", toLine(MARKER_TO));
  provider.status = 500;
  light(project, "k1");
  await flushAlerts({ projects: [project.name] });
  const [failed] = alertLines(project);
  assert.equal(failed?.type, "alert.failed");
  assert.match(String(failed?.error), /answered 500/u);
  assertStoreClean();
});

// --- the CLI ------------------------------------------------------------------------------

test("email status inside a project folder adds the marker's count and no address", async () => {
  writeEmailSettings(settings());
  const listed = workspace("st-web", toLine(MARKER_TO));
  const muted = workspace("st-muted", "to = []");
  const plain = workspace("st-plain");
  const human = await cli(emailCommand, ["status"], listed.dir);
  assert.equal(human.code, 0);
  assert.match(human.stdout, /2 recipients by default/u);
  assert.match(human.stdout, /st-web: its \.darius\.toml sets 2 recipients/u);
  assertClean(human.stdout, "status");
  assert.match((await cli(emailCommand, ["status"], muted.dir)).stdout, /sets \[email\] to = \[\], so it gets no mail/u);
  assert.match((await cli(emailCommand, ["status"], plain.dir)).stdout, /names no recipients, so this host's default applies/u);
  const json = await cli(emailCommand, ["status", "--json"], listed.dir);
  const parsed = JSON.parse(json.stdout);
  assert.equal(parsed.recipients, 2);
  assert.deepEqual(parsed.project, { name: "st-web", recipients: 2 });
  assertClean(json.stdout, "status --json");
});

test("email test --project sends to the project's list, with and without --report; an empty list or default exits 1", async () => {
  writeEmailSettings(settings());
  workspace("tp-web", toLine(MARKER_TO));
  workspace("tp-muted", "to = []");
  const plain = await cli(emailCommand, ["test", "--project", "tp-web"]);
  assert.equal(plain.code, 0, plain.stdout);
  assert.match(plain.stdout, /took a test for 2 recipients of tp-web/u);
  const report = await cli(emailCommand, ["test", "--report", "--project", "tp-web", "--json"]);
  assert.equal(report.code, 0, report.stdout);
  assert.deepEqual(JSON.parse(report.stdout), { ok: true, host: "127.0.0.1", recipients: 2, project: "tp-web", report: true, html: true });
  assert.deepEqual(sentTo(0), MARKER_TO);
  assert.deepEqual(sentTo(1), MARKER_TO);
  const muted = await cli(emailCommand, ["test", "--project", "tp-muted"]);
  assert.equal(muted.code, 1);
  assert.match(muted.stdout, /no recipients for tp-muted/u);
  assertClean(`${plain.stdout}${report.stdout}${muted.stdout}`, "test output");
  writeEmailSettings(settings({ to: [] }));
  const empty = await cli(emailCommand, ["test"]);
  assert.equal(empty.code, 1);
  assert.match(empty.stdout, /no default recipients/u);
  assert.equal(provider.bodies.length, 2, "the refusals sent nothing");
});

test("inside a run, email test --project refuses and sends nothing", async () => {
  writeEmailSettings(settings());
  workspace("run-web", toLine(MARKER_TO));
  process.env.DARIUS_RUN = "RUN0001";
  try {
    const refused = await cli(emailCommand, ["test", "--project", "run-web"]);
    assert.equal(refused.code, 1);
  } finally {
    delete process.env.DARIUS_RUN;
  }
  assert.equal(provider.bodies.length, 0);
});
