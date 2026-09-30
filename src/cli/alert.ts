/**
 * `darius alert setup|status|test|flush|off`: the Telegram alert channel of
 * this host (src/core/alerts.ts; docs/concept.md, "Alerts (0.29.0)").
 *
 *   alert setup telegram [--chat-id ID] [--link-base URL]
 *                    reads the bot token from stdin (never an argument, so
 *                    it stays out of the shell history), finds the chat of
 *                    your newest message to the bot (send it /start first)
 *                    unless --chat-id names one, sends a test message, and
 *                    only then writes <config>/alerts.json (0600)
 *   alert status     whether this host sends, to which chat; never the token
 *   alert test       sends a test message
 *   alert flush [--dry-run]
 *                    sends what this host's ledgers hold and nobody was told
 *                    yet; run-due and sync do this by themselves
 *   alert off        deletes the channel of this host
 *
 * Each host that should send needs its own setup: the token is not synced.
 */

import { hostId } from "../core/ledger.ts";
import {
  alertsFile,
  findChat,
  flushAlerts,
  readAlertConfig,
  removeAlertConfig,
  sendTelegram,
  writeAlertConfig,
  type AlertConfig,
} from "../core/alerts.ts";
import { errorMessage } from "../runtime.ts";
import { readStdin } from "./args.ts";
import { UsageError, type Command, type ParsedArgs } from "./registry.ts";

const VERBS = "setup | status | test | flush | off";
const BOT_TOKEN = /^\d+:[A-Za-z0-9_-]{20,}$/u;

function stringFlag(args: ParsedArgs, name: string): string | undefined {
  const value = args.flags[name];
  if (value === undefined || value === false) return undefined;
  if (value === true) throw new UsageError(`--${name} needs a value`);
  return value;
}

function testText(): string {
  return `darius on ${hostId()}: alerts are on. You get a message here when a run waits for you, asks you something, or fails.`;
}

async function setup(args: ParsedArgs): Promise<number> {
  if (args.positional[1] !== "telegram") throw new UsageError("alert setup needs a channel: telegram");
  const token = (args.stdin ?? readStdin()).trim();
  if (!BOT_TOKEN.test(token)) throw new UsageError("alert setup telegram reads the bot token from stdin, in the form 123456:ABC... from @BotFather");
  const linkBase = stringFlag(args, "link-base");
  if (linkBase !== undefined && !/^https?:\/\/\S+$/u.test(linkBase)) throw new UsageError("--link-base needs an http(s) URL, for example http://host-a:4747");
  try {
    let chat = stringFlag(args, "chat-id");
    let name = chat;
    if (chat === undefined) {
      const found = await findChat(token);
      if (found === null) {
        console.log("! no message to the bot yet: open the bot in Telegram, send it /start, then run this again");
        return 1;
      }
      chat = found.id;
      name = found.name;
    }
    const channel = { token, chat_id: chat };
    await sendTelegram(channel, testText());
    const known = readAlertConfig();
    const config: AlertConfig = { v: 1, since: known?.since ?? new Date().toISOString(), telegram: channel };
    const base = linkBase ?? known?.link_base;
    if (base !== undefined) config.link_base = base.replace(/\/+$/u, "");
    writeAlertConfig(config);
    if (args.json) console.log(JSON.stringify({ ok: true, host: hostId(), chat_id: chat, file: alertsFile() }));
    else console.log(`✓ telegram alerts on for ${hostId()}: chat ${name ?? chat}; a test message is on its way. Config: ${alertsFile()}`);
    return 0;
  } catch (cause) {
    // The core cuts the token out of its errors; this one never saw it.
    console.log(`! ${errorMessage(cause)}`);
    return 1;
  }
}

function status(args: ParsedArgs): number {
  const config = readAlertConfig();
  const telegram = config?.telegram;
  if (args.json) {
    console.log(JSON.stringify({ host: hostId(), telegram: telegram === undefined ? null : { chat_id: telegram.chat_id }, link_base: config?.link_base ?? null, since: config?.since ?? null }));
    return 0;
  }
  if (config === null || telegram === undefined) {
    console.log(`· no alerts from ${hostId()}: run darius alert setup telegram (the bot token on stdin)`);
    return 0;
  }
  const link = config.link_base === undefined ? "no run links (--link-base)" : `links to ${config.link_base}`;
  console.log(`✓ ${hostId()} sends telegram alerts to chat ${telegram.chat_id}, ${link}, news since ${config.since}`);
  return 0;
}

async function test(): Promise<number> {
  const telegram = readAlertConfig()?.telegram;
  if (telegram === undefined) throw new UsageError("no telegram channel on this host: run darius alert setup telegram first");
  try {
    await sendTelegram(telegram, testText());
    console.log("✓ test message sent");
    return 0;
  } catch (cause) {
    console.log(`! ${errorMessage(cause)}`);
    return 1;
  }
}

async function flush(args: ParsedArgs): Promise<number> {
  const isDryRun = args.flags["dry-run"] === true;
  const delivery = await flushAlerts({ isDryRun });
  if (delivery === null) {
    if (args.json) console.log(JSON.stringify({ ok: true, configured: false }));
    else console.log("· no telegram channel on this host; nothing to send");
    return 0;
  }
  if (args.json) {
    console.log(JSON.stringify({ ok: delivery.failed.length === 0, sent: delivery.sent, failed: delivery.failed, pending: delivery.pending }));
    return delivery.failed.length === 0 ? 0 : 1;
  }
  for (const alert of delivery.pending) console.log(`would send (${alert.key}):\n${alert.text}\n`);
  if (!isDryRun) console.log(`✓ ${String(delivery.sent)} alert(s) sent`);
  for (const failure of delivery.failed) console.log(`! ${failure}`);
  return delivery.failed.length === 0 ? 0 : 1;
}

function off(): number {
  console.log(removeAlertConfig() ? `✓ alerts off for ${hostId()}; ${alertsFile()} deleted` : `· no alerts on ${hostId()}`);
  return 0;
}

export const alertCommand: Command = {
  name: "alert",
  summary: "Telegram alerts of this host: setup (token on stdin), status, test, flush, off",
  async run(args: ParsedArgs): Promise<number> {
    switch (args.positional[0]) {
      case "setup":
        return setup(args);
      case "status":
        return status(args);
      case "test":
        return test();
      case "flush":
        return flush(args);
      case "off":
        return off();
      default:
        throw new UsageError(`alert needs a verb: ${VERBS}`);
    }
  },
};
