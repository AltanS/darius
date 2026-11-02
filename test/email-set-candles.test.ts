/**
 * `darius email set` says how many open candles asked for email and were not
 * sent (src/cli/email.ts, `unsentEmailCandles` in src/core/alerts.ts). It writes
 * nothing to a ledger.
 *
 * SAFETY: the state and config dirs are `mkdtemp` dirs. Nothing here sends mail.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SANDBOX = mkdtempSync(join(tmpdir(), "darius-email-set-candles-"));
process.env.DARIUS_STATE_DIR = join(SANDBOX, "state");
process.env.DARIUS_CONFIG_DIR = join(SANDBOX, "config");
mkdirSync(process.env.DARIUS_CONFIG_DIR, { recursive: true });
writeFileSync(join(process.env.DARIUS_CONFIG_DIR, "config.toml"), 'host = "host-a"\n');
delete process.env.DARIUS_RUN;
delete process.env.DARIUS_RUN_POLICY;
delete process.env.DARIUS_PROJECT;

const { parseArgs } = await import("../src/cli/args.ts");
const { emailCommand } = await import("../src/cli/email.ts");
const { unsentEmailCandles } = await import("../src/core/alerts.ts");
const { appendLine, readLedger } = await import("../src/core/ledger.ts");
const { openProject } = await import("../src/core/store.ts");

const INPUT = JSON.stringify({ url: "https://mail.example.test/send", token: "token-placeholder", from: "darius@example.test", to: ["ops@example.test"] });

async function emailSet(...flags: string[]): Promise<string> {
  const out: string[] = [];
  const { log } = console;
  console.log = (...parts: string[]) => out.push(parts.join(" "));
  try {
    const args = parseArgs(["set", "--stdin", ...flags], emailCommand.flags);
    args.stdin = INPUT;
    assert.equal(await emailCommand.run(args), 0);
    return out.join("\n");
  } finally {
    console.log = log;
  }
}

let tickMs = Date.now();
function tick(): string {
  tickMs += 1000;
  return new Date(tickMs).toISOString();
}

function light(project: ReturnType<typeof openProject>, key: string, deliver: string[]): string {
  return appendLine(project, { who: "script", type: "candle.lit", key, title: `Candle ${key}`, severity: "high", source: "ci", deliver, at: tick() }).id;
}

test("email set prints one extra line with the count, nothing at zero, and writes no ledger line", async () => {
  assert.equal(unsentEmailCandles(), 0);
  assert.equal((await emailSet()).split("\n").length, 1, "nothing extra at zero");

  const shop = openProject("shop", { create: true });
  const blog = openProject("blog", { create: true });
  const sentId = light(shop, "sent", ["email"]);
  light(shop, "waiting", ["email"]);
  light(shop, "pushonly", ["push"]);
  light(blog, "elsewhere", ["push", "email"]);
  light(blog, "settled", ["email"]);
  appendLine(blog, { who: "op", type: "candle.accepted", key: "settled", severity: "high", at: tick() });
  appendLine(shop, { who: "darius:alerts", type: "alert.sent", key: `line:${sentId}:email`, channel: "email", devices: 1 });

  const before = [readLedger(shop).length, readLedger(blog).length];
  const text = await emailSet();
  assert.deepEqual(text.split("\n").slice(1), ["2 open candles were not sent on email. They stay in the app."]);
  assert.deepEqual([readLedger(shop).length, readLedger(blog).length], before, "it writes nothing");

  appendLine(blog, { who: "op", type: "candle.blown-out", key: "elsewhere", at: tick() });
  assert.deepEqual((await emailSet()).split("\n").slice(1), ["1 open candle was not sent on email. It stays in the app."]);
  assert.equal((await emailSet("--json")).includes("open candle"), false, "the JSON stays as it was");
});
