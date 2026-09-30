/**
 * Alert channels (src/core/alerts.ts, src/cli/alert.ts, 0.29.0) against a fake
 * Telegram Bot API on loopback: setup finds the chat and writes a 0600 file,
 * a flush sends each alert of this host once, a failed send is tried again
 * up to MAX_TRIES, and the token never shows in output, errors or the ledger.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseArgs } from "../src/cli/args.ts";
import { alertCommand } from "../src/cli/alert.ts";
import type { ParsedArgs } from "../src/cli/registry.ts";
import { alertsFile, flushAlerts, ledgerAlerts, MAX_TRIES, readAlertConfig, sendAlerts, writeAlertConfig, type AlertConfig } from "../src/core/alerts.ts";
import { appendLine, hostId, readLedger } from "../src/core/ledger.ts";
import type { LedgerLine } from "../src/core/model.ts";
import { GLOBAL_PROJECT, openProject, putBlob } from "../src/core/store.ts";
import { skipAlerts } from "../src/runner/report.ts";

const SANDBOX = mkdtempSync(join(tmpdir(), "darius-alerts-"));
process.env.DARIUS_STATE_DIR = join(SANDBOX, "state");
process.env.DARIUS_CONFIG_DIR = join(SANDBOX, "config");

const TOKEN = "123456:AAHsecret-token_value_for_tests_only";

interface FakeApi {
  /** Messages the fake received, in order. */
  sent: string[];
  /** "ok", or "refuse": 401 with the token in the description. */
  mode: "ok" | "refuse";
  hasUpdates: boolean;
}

const api: FakeApi = { sent: [], mode: "ok", hasUpdates: true };

/** What the fake answers: the Bot API envelope. */
interface ApiReply {
  ok: boolean;
  description?: string;
  result?: unknown;
}

function reply(response: ServerResponse, status: number, body: ApiReply): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

const server = createServer((request, response) => {
  void (async () => {
    const body = JSON.parse((await readBody(request)) || "{}");
    if (request.url !== `/bot${TOKEN}/getUpdates` && request.url !== `/bot${TOKEN}/sendMessage`) {
      reply(response, 404, { ok: false, description: "Not Found" });
      return;
    }
    if (api.mode === "refuse") {
      reply(response, 401, { ok: false, description: `Unauthorized for ${TOKEN}` });
      return;
    }
    if (request.url.endsWith("/getUpdates")) {
      const updates = api.hasUpdates ? [{ update_id: 1, message: { message_id: 1, chat: { id: 4242, first_name: "Op" }, text: "/start" } }] : [];
      reply(response, 200, { ok: true, result: updates });
      return;
    }
    assert.equal(body.chat_id, "4242");
    api.sent.push(body.text);
    reply(response, 200, { ok: true, result: { message_id: api.sent.length } });
  })();
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
// SAFETY: a server listening on a TCP port reports an AddressInfo, never a pipe name or null.
const { port } = server.address() as AddressInfo;
process.env.DARIUS_TELEGRAM_API = `http://127.0.0.1:${String(port)}`;
test.after(() => server.close());

interface CliRun {
  code: number;
  stdout: string;
}

async function alert(argv: string[], stdin?: string): Promise<CliRun> {
  const args: ParsedArgs = parseArgs(argv);
  if (stdin !== undefined) args.stdin = stdin;
  const out: string[] = [];
  const { log } = console;
  console.log = (...parts: string[]) => out.push(parts.join(" "));
  try {
    return { code: await alertCommand.run(args), stdout: out.join("\n") };
  } finally {
    console.log = log;
  }
}

function reset(): void {
  api.sent = [];
  api.mode = "ok";
  api.hasUpdates = true;
}

test("setup reads the token from stdin, finds the chat, sends a test and writes a 0600 file; nothing prints the token", async () => {
  reset();
  api.hasUpdates = false;
  const early = await alert(["setup", "telegram"], `${TOKEN}\n`);
  assert.equal(early.code, 1);
  assert.match(early.stdout, /send it \/start, then run this again/u);
  assert.equal(readAlertConfig(), null, "no file before the chat is known");

  api.hasUpdates = true;
  const done = await alert(["setup", "telegram", "--link-base", "http://host-a:4747/"], `${TOKEN}\n`);
  assert.equal(done.code, 0, done.stdout);
  assert.match(done.stdout, /chat Op/u);
  assert.match(api.sent[0] ?? "", /alerts are on/u);
  assert.equal(statSync(alertsFile()).mode & 0o777, 0o600);
  const config = readAlertConfig();
  assert.equal(config?.telegram?.chat_id, "4242");
  assert.equal(config?.link_base, "http://host-a:4747");
  const status = await alert(["status"]);
  assert.match(status.stdout, /sends telegram alerts to chat 4242, links to http:\/\/host-a:4747/u);
  for (const text of [done.stdout, status.stdout, (await alert(["status", "--json"])).stdout]) assert.equal(text.includes(TOKEN), false);

  await assert.rejects(alert(["setup", "telegram"], "not-a-token\n"), /reads the bot token from stdin/u);
});

function resultBlob(project: ReturnType<typeof openProject>): string {
  return putBlob(project, `${JSON.stringify({ v: 1, status: "attention", summary: "s", metrics: [], items: [], questions: [{ text: "Delete the card?", recommendation: "Yes." }], actions: [] })}\n`);
}

test("a flush sends each alert of this host once: held, asks, failed; a passed run and a gate check that passed stay quiet", async () => {
  reset();
  const project = openProject("alerts-flush", { create: true });
  appendLine(project, { who: "claude:1", type: "run.held", item: "ritual/heartbeat", run: "R1", questions: ["may I push?"] });
  const summary = { status: "attention", questions: 1, open: { critical: 0, high: 0, medium: 0, low: 0, info: 0 }, fixed: 0 };
  appendLine(project, { who: "claude:2", type: "run.completed", item: "ritual/heartbeat", run: "R2", outcome: "complete", result_sha: resultBlob(project), result: summary });
  appendLine(project, { who: "timer", type: "run.completed", item: "ritual/heartbeat", run: "R3", outcome: "failed" });
  appendLine(project, { who: "claude:4", type: "run.completed", item: "ritual/heartbeat", run: "R4", outcome: "complete" });
  const global = openProject(GLOBAL_PROJECT, { create: true });
  appendLine(global, { who: "timer", type: "harness.checked", harness: "claude", version: "2.1.300", outcome: "passed", subagents: "passed", run: "C1" });
  appendLine(global, { who: "timer", type: "harness.checked", harness: "claude", version: "2.1.301", outcome: "failed", subagents: "inconclusive", run: "C2", detail: "the marker exists" });

  const dry = await flushAlerts({ isDryRun: true });
  assert.equal(dry?.pending.length, 4);
  assert.equal(api.sent.length, 0, "a dry run sends nothing");

  const first = await flushAlerts();
  assert.equal(first?.sent, 4);
  const texts = api.sent.join("\n---\n");
  assert.match(texts, /heartbeat is held and waits for you:\n1\. may I push\?\nAnswer: darius run answer R1 1/u);
  assert.match(texts, /heartbeat asks you 1 question:\n1\. Delete the card\? \(recommended: Yes\.\)\nAnswer: darius run ack R2 --note "your decision" --project alerts-flush\nhttp:\/\/host-a:4747\/p\/alerts-flush\/runs\/R2/u);
  assert.match(texts, /heartbeat: the run failed\.\nLook: darius run show R3/u);
  assert.match(texts, /The gate check of claude 2\.1\.301 was failed: the marker exists\./u);
  assert.equal(texts.includes("R4"), false, "a complete run without questions is no alert");
  const keys = readLedger(project).filter((line) => line.type === "alert.sent").map((line) => String(line.key));
  assert.equal(keys.length, 3);
  assert.ok(keys.includes("asks:R2"), "a question alert is keyed by its run");

  assert.equal((await flushAlerts())?.sent, 0, "each alert goes out once");
  assert.equal(api.sent.length, 4);
});

/** A run.completed failed line of this host at 13:00, with `fields` over it. */
function failedLine(fields: Partial<LedgerLine>): LedgerLine {
  return {
    v: 1,
    id: fields.id ?? "L",
    at: "2026-09-30T13:00:00.000Z",
    host: hostId(),
    who: "x",
    project: "p",
    type: "run.completed",
    item: "ritual/r",
    run: "R",
    outcome: "failed",
    ...fields,
  };
}

test("only this host's lines since the setup count", () => {
  const config: AlertConfig = { v: 1, since: "2026-09-30T12:00:00.000Z" };
  const project = openProject("alerts-pure", { create: true });
  const alerts = ledgerAlerts(project, [failedLine({ id: "mine" }), failedLine({ id: "other", host: "elsewhere" }), failedLine({ id: "old", at: "2026-09-29T00:00:00.000Z" })], config, hostId());
  assert.deepEqual(alerts.map((entry) => entry.key), ["line:mine"]);
});

test("a failed send is recorded without the token and tried again, at most MAX_TRIES times", async () => {
  reset();
  const project = openProject("alerts-fail", { create: true });
  appendLine(project, { who: "timer", type: "run.completed", item: "ritual/heartbeat", run: "F1", outcome: "failed" });
  api.mode = "refuse";
  for (let attempt = 0; attempt < MAX_TRIES + 1; attempt += 1) await flushAlerts({ projects: ["alerts-fail"] });
  const failed = readLedger(project).filter((line) => line.type === "alert.failed");
  assert.equal(failed.length, MAX_TRIES, "no more tries after the limit");
  assert.match(String(failed[0]?.error), /telegram sendMessage answered 401: Unauthorized for <token>/u);
  assert.equal(JSON.stringify(readLedger(project)).includes(TOKEN), false);

  process.env.DARIUS_TELEGRAM_API = "http://127.0.0.1:1";
  try {
    const project2 = openProject("alerts-unreachable", { create: true });
    appendLine(project2, { who: "timer", type: "run.completed", item: "ritual/heartbeat", run: "U1", outcome: "failed" });
    const delivery = await flushAlerts({ projects: ["alerts-unreachable"] });
    assert.match(delivery?.failed[0] ?? "", /telegram sendMessage did not reach the API/u);
    assert.equal(delivery?.failed[0]?.includes(TOKEN), false);
  } finally {
    process.env.DARIUS_TELEGRAM_API = `http://127.0.0.1:${String(port)}`;
  }
});

test("a failing skip is an alert once per ritual, reason and day; a skip that means 'not now' is none", () => {
  const entry = {
    project: "p",
    syncBefore: "ok",
    syncAfter: "ok",
    rituals: [
      { slug: "a", action: "skipped" as const, reason: "gate-broken" as const, detail: "the gate exited 127: HOME=/secret" },
      { slug: "b", action: "skipped" as const, reason: "not-due" as const },
      { slug: "c", action: "skipped" as const, reason: "tool-missing" as const, detail: "pnpm not on the runner PATH" },
    ],
  };
  const alerts = skipAlerts(entry, { date: "2026-09-30", host: "host-a" });
  assert.deepEqual(alerts, [
    { key: "skip:host-a:a:2026-09-30:gate-broken", text: "darius · p · host-a\na did not start: gate-broken. Details: darius run now a --dry-run --project p, on host-a." },
    { key: "skip:host-a:c:2026-09-30:tool-missing", text: "darius · p · host-a\nc did not start: tool-missing. pnpm not on the runner PATH" },
  ]);
});

test("off deletes the channel; a flush without one does nothing", async () => {
  writeAlertConfig({ v: 1, since: new Date().toISOString(), telegram: { token: TOKEN, chat_id: "4242" } });
  assert.match((await alert(["off"])).stdout, /alerts off/u);
  assert.equal(await flushAlerts(), null);
  assert.equal(readFileSync(join(SANDBOX, "config", "alerts.json"), { flag: "a+" }).length, 0, "the file is gone");
});

test("a skip alert that failed goes out on a later flush, with the text it failed with", async () => {
  reset();
  writeAlertConfig({ v: 1, since: "2026-01-01T00:00:00.000Z", telegram: { token: TOKEN, chat_id: "4242" } });
  const project = openProject("alerts-skip", { create: true });
  api.mode = "refuse";
  const failed = await sendAlerts(project, [{ key: "skip:h:r:2026-09-30:gate-broken", text: "r did not start" }], readAlertConfig() ?? { v: 1, since: "" });
  assert.equal(failed.failed.length, 1);
  api.mode = "ok";
  assert.equal((await flushAlerts({ projects: ["alerts-skip"] }))?.sent, 1);
  assert.deepEqual(api.sent, ["r did not start"]);
  assert.equal((await flushAlerts({ projects: ["alerts-skip"] }))?.sent, 0);
});
