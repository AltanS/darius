/**
 * Run reports by email (0.127.0): src/core/report-email.ts builds the mail,
 * src/core/alerts.ts sends it after a complete run of a ritual with
 * `report_deliver = ["email"]`, and `darius email test --report` sends a sample.
 *
 * SAFETY: the state and config dirs are `mkdtemp` dirs, and the provider is a
 * fake on 127.0.0.1. Nothing here reaches a real provider or a real store. The
 * token and the addresses are placeholders.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseArgs } from "../src/cli/args.ts";
import { emailCommand } from "../src/cli/email.ts";
import type { Command, ParsedArgs } from "../src/cli/registry.ts";
import { runCommand } from "../src/cli/run.ts";
import { flushAlerts, MAX_TRIES } from "../src/core/alerts.ts";
import { emailSettingsFile, writeEmailSettings, type EmailSettings } from "../src/core/email.ts";
import { appendLine, readLedger } from "../src/core/ledger.ts";
import type { LedgerLine, Ritual } from "../src/core/model.ts";
import { markdownHtml, REPORT_MISSING, reportChannelNote } from "../src/core/report-email.ts";
import { openProject, putBlob, type Project } from "../src/core/store.ts";
import { ulid } from "../src/core/ulid.ts";

const SANDBOX = mkdtempSync(join(tmpdir(), "darius-report-email-"));
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
const TO = ["ops@example.com", "Second Person <second@example.com>"];
const MAIL_PATH = "/v1/private-path/send";

// --- a fake provider ----------------------------------------------------------------------

interface Received {
  method: string;
  path: string;
  headers: IncomingMessage["headers"];
  body: string;
}

interface Provider {
  received: Received[];
  status: number;
}

const provider: Provider = { received: [], status: 202 };

const server = createServer((request: IncomingMessage, response: ServerResponse) => {
  let body = "";
  request.setEncoding("utf8");
  request.on("data", (chunk: string) => {
    body += chunk;
  });
  request.on("end", () => {
    provider.received.push({ method: request.method ?? "", path: request.url ?? "", headers: request.headers, body });
    response.writeHead(provider.status);
    // An error answer echoes the request, as a careless provider might.
    response.end(provider.status < 300 ? "" : JSON.stringify({ authorization: request.headers.authorization, request: body }));
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
  provider.received = [];
  provider.status = 202;
  rmSync(emailSettingsFile(), { force: true });
});

// --- helpers ------------------------------------------------------------------------------

function settings(more: Partial<EmailSettings> = {}): EmailSettings {
  return { url: `${origin}${MAIL_PATH}`, token: TOKEN, from: FROM, to: TO, since: "2026-01-01T00:00:00.000Z", web_url: "https://darius.example.com/", ...more };
}

interface SentMail {
  from: string;
  to: string[];
  subject: string;
  text: string;
  html?: string;
}

function mail(index = 0): SentMail {
  return JSON.parse(provider.received[index]?.body ?? "");
}

function fresh(name: string): Project {
  return openProject(name, { create: true });
}

/** A ritual item, as reconcile mirrors it, with `report_deliver` when given. */
function ritual(project: Project, slug: string, deliver?: string[], title = "Daily report"): void {
  const now = new Date().toISOString();
  const header: Ritual = { id: ulid(), kind: "ritual", slug, title, created: now, updated: now, tags: [], anchor: "due", policy: { mode: "report", may: [], hold: [] } };
  if (deliver !== undefined) header.report_deliver = deliver;
  project.writeItem({ header, body: "Do it." }, { who: "test" });
}

let runCount = 0;

/** A `run.completed` line written straight to the ledger; `at` defaults to now. */
function completed(project: Project, slug: string, more: Record<string, string | null> = {}): LedgerLine {
  runCount += 1;
  return appendLine(project, { who: "t", type: "run.completed", item: `ritual/${slug}`, run: `RUN${String(runCount).padStart(4, "0")}`, outcome: "complete", findings_sha: null, ...more });
}

function lines(project: Project, type: string): LedgerLine[] {
  return readLedger(project).filter((line) => line.type === type);
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

async function withEmail(value: EmailSettings, body: () => Promise<void>): Promise<void> {
  writeEmailSettings(value);
  try {
    await body();
  } finally {
    rmSync(emailSettingsFile(), { force: true });
  }
}

interface CliRun {
  code: number;
  stdout: string;
}

async function cli(command: Command, argv: string[], stdin?: string): Promise<CliRun> {
  const args: ParsedArgs = parseArgs(argv, command.flags);
  if (stdin !== undefined) args.stdin = stdin;
  const out: string[] = [];
  const { log } = console;
  console.log = (...parts: string[]) => out.push(parts.join(" "));
  try {
    return { code: await command.run(args), stdout: out.join("\n") };
  } finally {
    console.log = log;
  }
}

/** Every file under `dir`, with its text. */
function filesUnder(dir: string): Array<{ path: string; text: string }> {
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .map((name) => join(dir, name))
    .filter((path) => statSync(path).isFile())
    .map((path) => ({ path, text: readFileSync(path, "utf8") }));
}

/** The store, which is what syncs: no token, no address, no path of the provider's url, and none of `more`. */
function assertStoreClean(more: readonly string[] = []): void {
  for (const { path, text } of filesUnder(process.env.DARIUS_STATE_DIR ?? "")) {
    if (path.includes("/blobs/")) continue;
    for (const secret of [TOKEN, FROM, "ops@example.com", "second@example.com", "private-path", ...more]) assert.equal(text.includes(secret), false, `${path} holds ${secret}`);
  }
}

const FINDINGS = "# Daily report\n\nAll 12 pages checked. **One** link was broken and is fixed.\n\n- page 3\n- page 7\n";
const RESULT = '```darius-result\n{"v": 1, "status": "ok", "summary": "12 pages checked; 1 link fixed.", "items": []}\n```\n';

// --- the send -----------------------------------------------------------------------------

test("a complete run of an opted-in ritual sends one mail with the headers, the subject, the text and the html; a second flush sends nothing", async () => {
  await withEmail(settings(), async () => {
    const project = fresh("acme-web");
    ritual(project, "daily", ["email"]);
    const started = await cli(runCommand, ["start", "daily", "--json", "--project", project.name]);
    const run: string = JSON.parse(started.stdout).run;
    const done = await cli(runCommand, ["complete", run, "--outcome", "complete", "--findings-stdin", "--project", project.name], `${FINDINGS}\n${RESULT}`);
    assert.equal(done.code, 0);

    await flushAlerts({ projects: [project.name] });
    assert.equal(provider.received.length, 1, "one POST");
    const [request] = provider.received;
    assert.equal(request?.method, "POST");
    assert.equal(request?.path, MAIL_PATH);
    assert.equal(request?.headers.authorization, `Bearer ${TOKEN}`);
    assert.equal(request?.headers["content-type"], "application/json");
    assert.equal(request?.headers["idempotency-key"], sha256(`report:${run}`));

    const sent = mail();
    assert.deepEqual(Object.keys(sent), ["from", "to", "subject", "text", "html"]);
    assert.equal(sent.from, FROM);
    assert.deepEqual(sent.to, TO);
    assert.equal(sent.subject, "[acme-web] Daily report: 12 pages checked; 1 link fixed.");
    const finished = lines(project, "run.completed")[0]?.at ?? "";
    const link = `https://darius.example.com/w/acme-web/runs/${run}`;
    assert.equal(sent.text, `${FINDINGS.trimEnd()}\n\n-- \nProject: acme-web\nRitual: Daily report (daily)\nRun: ${run}\nFinished: ${finished}\nLink: ${link}\n`);
    assert.equal(sent.text.includes("darius-result"), false, "the result block is not mailed");
    assert.match(sent.html ?? "", /<h1 [^>]*>Daily report<\/h1>/u);
    assert.match(sent.html ?? "", /<strong>One<\/strong>/u);
    assert.match(sent.html ?? "", /<ul [^>]*><li>page 3<\/li><li>page 7<\/li><\/ul>/u);
    assert.ok(sent.html?.includes(`<a href="${link}"`), "the html links the run page");

    const [sentLine] = lines(project, "alert.sent");
    assert.equal(sentLine?.key, `report:${run}`);
    assert.equal(sentLine?.channel, "email");
    assert.equal(sentLine?.devices, TO.length);

    await flushAlerts({ projects: [project.name] });
    assert.equal(provider.received.length, 1, "a second flush sends nothing");
    assertStoreClean(["pages checked; 1 link"]);
  });
});

test("a retry after a 500 sends the same bytes with the same key, and the failed line holds no text and no address", async () => {
  await withEmail(settings(), async () => {
    const project = fresh("retry");
    ritual(project, "daily", ["email"]);
    const line = completed(project, "daily", { findings_sha: putBlob(project, "Found THE-FINDING-TEXT.\n") });
    provider.status = 500;
    await flushAlerts({ projects: [project.name] });
    provider.status = 202;
    await flushAlerts({ projects: [project.name] });
    await flushAlerts({ projects: [project.name] });
    assert.equal(provider.received.length, 2, "one failure, one success, then nothing");
    assert.equal(provider.received[0]?.body, provider.received[1]?.body, "byte-identical bodies");
    assert.equal(provider.received[0]?.headers["idempotency-key"], provider.received[1]?.headers["idempotency-key"]);
    const [failed] = lines(project, "alert.failed");
    assert.deepEqual(Object.keys(failed ?? {}).filter((key) => !["v", "id", "at", "host", "who", "project", "type"].includes(key)).toSorted(), ["channel", "error", "key"]);
    assert.equal(failed?.key, `report:${String(line.run)}`);
    assert.equal(failed?.error, "127.0.0.1 answered 500");
    assert.equal(lines(project, "alert.sent").length, 1);
    assertStoreClean(["THE-FINDING-TEXT"]);
  });
});

test("a provider that keeps failing costs at most MAX_TRIES requests", async () => {
  await withEmail(settings(), async () => {
    const project = fresh("broken-provider");
    ritual(project, "daily", ["email"]);
    completed(project, "daily");
    provider.status = 503;
    for (let attempt = 0; attempt < MAX_TRIES + 2; attempt += 1) await flushAlerts({ projects: [project.name] });
    assert.equal(provider.received.length, MAX_TRIES);
    assert.equal(lines(project, "alert.failed").length, MAX_TRIES);
  });
});

test("html = false sends the text only, with no html field", async () => {
  await withEmail(settings({ html: false }), async () => {
    const project = fresh("text-only");
    ritual(project, "daily", ["email"]);
    completed(project, "daily", { findings_sha: putBlob(project, FINDINGS) });
    await flushAlerts({ projects: [project.name] });
    assert.equal(provider.received.length, 1);
    assert.deepEqual(Object.keys(mail()), ["from", "to", "subject", "text"]);
  });
});

test("a run with no findings and no result says so in one line, and the subject says complete", async () => {
  await withEmail(settings({ web_url: undefined }), async () => {
    const project = fresh("bare");
    ritual(project, "check", ["email"], "check");
    const line = completed(project, "check");
    await flushAlerts({ projects: [project.name] });
    assert.equal(mail().subject, "[bare] check: complete");
    assert.equal(mail().text, `The run left no findings text.\n\n-- \nProject: bare\nRitual: check\nRun: ${String(line.run)}\nFinished: ${line.at}\n`);
    assert.match(mail().html ?? "", /The run left no findings text\./u);
  });
});

// --- what sends nothing -----------------------------------------------------------------

test("held, failed and abandoned runs send nothing; a ritual without the key or with [] sends nothing; a dry flush sends and records nothing", async () => {
  await withEmail(settings(), async () => {
    const project = fresh("quiet");
    ritual(project, "daily", ["email"]);
    ritual(project, "plain");
    ritual(project, "empty", []);
    const started = await cli(runCommand, ["start", "daily", "--json", "--project", project.name]);
    const held: string = JSON.parse(started.stdout).run;
    assert.equal((await cli(runCommand, ["hold", held, "--question", "Go on?", "--project", project.name])).code, 0);
    completed(project, "daily", { outcome: "failed" });
    completed(project, "daily", { outcome: "abandoned" });
    completed(project, "plain");
    completed(project, "empty");
    await flushAlerts({ projects: [project.name] });
    assert.equal(provider.received.length, 0);
    assert.equal(readLedger(project).some((line) => line.type.startsWith("alert.")), false);

    const opted = completed(project, "daily");
    const dry = await flushAlerts({ projects: [project.name], isDryRun: true });
    assert.equal(provider.received.length, 0, "a dry flush sends nothing");
    assert.deepEqual(dry?.pending.map((alert) => alert.key), [`report:${String(opted.run)}`]);
    assert.equal(dry?.pending.some((alert) => alert.report !== undefined), false, "the dry list holds no findings text");
    assert.equal(readLedger(project).some((line) => line.type.startsWith("alert.")), false, "and records nothing");
  });
});

test("without email.json a complete run sends nothing, leaves no line and the flush does not fail", async () => {
  const project = fresh("no-channel");
  ritual(project, "daily", ["email"]);
  const started = await cli(runCommand, ["start", "daily", "--json", "--project", project.name]);
  const run: string = JSON.parse(started.stdout).run;
  assert.equal((await cli(runCommand, ["complete", run, "--outcome", "complete", "--findings-stdin", "--project", project.name], FINDINGS)).code, 0, "the run completes");
  const delivery = await flushAlerts({ projects: [project.name] });
  assert.equal(delivery, null);
  assert.equal(provider.received.length, 0);
  assert.equal(readLedger(project).some((line) => line.type.startsWith("alert.")), false);
});

test("a run before since sends nothing, and neither does one older than a day, another host's or an imported one", async () => {
  const project = fresh("history");
  ritual(project, "daily", ["email"]);
  completed(project, "daily", { at: new Date(Date.now() - 60_000).toISOString() });
  await withEmail(settings({ since: new Date(Date.now() - 30_000).toISOString() }), async () => {
    await flushAlerts({ projects: [project.name] });
    assert.equal(provider.received.length, 0, "before since");
  });
  await withEmail(settings(), async () => {
    const other = fresh("history-day");
    ritual(other, "daily", ["email"]);
    completed(other, "daily", { at: new Date(Date.now() - 25 * 3_600_000).toISOString() });
    completed(other, "daily", { imported_from: "runs/2026-11-01.md" });
    const dir = join(other.root, "ledger", "host-b");
    mkdirSync(dir, { recursive: true });
    const at = new Date().toISOString();
    const row = { v: 1, id: ulid(), at, host: "host-b", who: "t", project: other.name, type: "run.completed", item: "ritual/daily", run: "FOREIGN", outcome: "complete", findings_sha: null };
    writeFileSync(join(dir, "open.jsonl"), `${JSON.stringify(row)}\n`);
    await flushAlerts({ projects: [other.name] });
    assert.equal(provider.received.length, 0, "older than a day, imported, or another host's");
  });
});

test("a findings blob that is not on this host is a failed try with a reason and no text", async () => {
  await withEmail(settings(), async () => {
    const project = fresh("missing-blob");
    ritual(project, "daily", ["email"]);
    completed(project, "daily", { findings_sha: sha256("not here") });
    await flushAlerts({ projects: [project.name] });
    assert.equal(provider.received.length, 0);
    assert.equal(lines(project, "alert.failed")[0]?.error, REPORT_MISSING);
  });
});

// --- the scrub and the html ---------------------------------------------------------------

test("the token, the addresses, the provider's url and obvious keys are scrubbed from the subject, the text and the html", async () => {
  await withEmail(settings(), async () => {
    const project = fresh("scrub");
    ritual(project, "daily", ["email"]);
    const findings = [
      `# Leak check ${TOKEN}`,
      "",
      `The token is ${TOKEN}, encoded ${encodeURIComponent(TOKEN)}.`,
      "Mail went to OPS@EXAMPLE.COM and second%40example.com.",
      `The provider is ${origin}${MAIL_PATH} at /v1/private-path/send.`,
      "A key: ghp_abcdefghijklmnop1234567890.",
      "",
    ].join("\n");
    const result = JSON.stringify({ v: 1, status: "ok", summary: `Checked with ${TOKEN}`, items: [] });
    completed(project, "daily", { findings_sha: putBlob(project, findings), result_sha: putBlob(project, `${result}\n`) });
    await flushAlerts({ projects: [project.name] });
    const sent = mail();
    for (const part of [sent.subject, sent.text, sent.html ?? ""]) {
      for (const secret of [TOKEN, encodeURIComponent(TOKEN), "ops@example.com", "OPS@EXAMPLE.COM", "second%40example.com", "private-path", "abcdefghijklmnop1234567890"]) {
        assert.equal(part.includes(secret), false, `holds ${secret}: ${part}`);
      }
    }
    assert.equal(sent.subject, "[scrub] Daily report: Checked with [token]");
    assert.match(sent.text, /The token is \[token\], encoded \[token\]\./u);
    assert.match(sent.text, /Mail went to \[address\] and \[address\]\./u);
    assert.match(sent.text, /The provider is 127\.0\.0\.1 at \/\.\.\./u);
    assert.match(sent.text, /A key: ghp_\[masked\]\./u);
  });
});

test("the html renderer escapes markup, drops a javascript: link and links only http and https", () => {
  const html = markdownHtml(
    [
      "<script>alert(1)</script>",
      "",
      "[click](javascript:alert) and [x](javascript:alert(1)) and [data](data:text/html,hi)",
      "",
      "[docs](https://example.com/a?b=1&c=\"2\") and ![img](https://example.com/i.png)",
      "",
      "| a | b |",
      "|---|---|",
      "| <b>x</b> | `<i>` |",
      "",
      "```",
      "<img src=x onerror=alert(1)>",
      "```",
    ].join("\n"),
  );
  assert.equal(html.includes("<script"), false);
  assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
  assert.equal(/href="(?!https?:)/u.test(html), false, "no href but http and https");
  assert.equal(html.includes("javascript:alert\""), false);
  assert.match(html, />click and /u, "the label stays as text");
  assert.ok(html.includes('<a href="https://example.com/a?b=1&amp;c=&quot;2&quot;"'));
  assert.equal(html.includes("<img"), false, "no image, also not from a code block");
  assert.ok(html.includes("&lt;b&gt;x&lt;/b&gt;"));
  assert.ok(html.includes("&lt;img src=x onerror=alert(1)&gt;"));
});

// --- the CLI and doctor -------------------------------------------------------------------

test("email test --report sends one sample with text and html; html false sends text only; a run cannot use it", async () => {
  writeEmailSettings(settings());
  const human = await cli(emailCommand, ["test", "--report"]);
  assert.equal(human.code, 0);
  assert.match(human.stdout, /took a sample report for 2 recipients, text and html/u);
  assert.equal(provider.received.length, 1);
  const sent = mail();
  assert.equal(sent.subject, "[example] Sample report: a sample report from host-a");
  assert.match(sent.text, /^# Sample report/u);
  assert.match(sent.html ?? "", /<table /u);
  assert.equal(readLedger(openProject("example", { create: true })).length, 0, "no ledger line");

  writeEmailSettings(settings({ html: false }));
  const json = await cli(emailCommand, ["test", "--report", "--json"]);
  assert.deepEqual(JSON.parse(json.stdout), { ok: true, host: "127.0.0.1", recipients: 2, report: true, html: false });
  assert.equal(mail(1).html, undefined);

  process.env.DARIUS_RUN = "RUN1";
  try {
    const refused = await cli(emailCommand, ["test", "--report"]);
    assert.equal(refused.code, 1);
    assert.equal(provider.received.length, 2, "nothing sent from a run");
  } finally {
    delete process.env.DARIUS_RUN;
  }
});

test("email status says when reports go as text only", async () => {
  writeEmailSettings(settings({ html: false }));
  const human = await cli(emailCommand, ["status"]);
  assert.match(human.stdout, /2 recipients by default, mail as text only/u);
  const json = JSON.parse((await cli(emailCommand, ["status", "--json"])).stdout);
  assert.equal(json.html, false);
});

test("doctor notes a marker that asks for report mail on a host with no email channel, once, and not when the channel is set up", () => {
  const dir = mkdtempSync(join(SANDBOX, "checkout-"));
  writeFileSync(join(dir, ".darius.toml"), 'v = 3\nproject = "acme-web"\ntz = "UTC"\n[rituals.daily]\ntitle = "Daily"\nskill = "daily"\nreport_deliver = ["email"]\n[rituals.weekly]\ntitle = "Weekly"\nskill = "weekly"\nreport_deliver = ["email"]\n[rituals.quiet]\ntitle = "Quiet"\nskill = "quiet"\nreport_deliver = []\n');
  assert.equal(reportChannelNote(dir), "rituals daily, weekly ask for report mail (report_deliver), and this host has no email channel: a run here sends no report. Set it up: darius email set --stdin");
  writeEmailSettings(settings());
  assert.equal(reportChannelNote(dir), null);
  assert.equal(reportChannelNote(SANDBOX), null, "no marker, no note");
});
