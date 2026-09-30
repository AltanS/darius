/**
 * `darius push keys|status|devices|test|flush|forget`: phone notifications
 * by Web Push (src/core/push.ts, src/core/alerts.ts; docs/concept.md,
 * "Alerts").
 *
 *   push keys --subject URL [--force]
 *                    makes the VAPID key pair in <config>/push.json (0600).
 *                    URL is a mailto: or https: contact for the push
 *                    services. Every host that sends needs the same file:
 *                    copy it, do not make a second pair (--force makes a new
 *                    one, and every phone must subscribe again)
 *   push status      the public key and the device count; never the private key
 *   push devices     the subscribed devices, numbered
 *   push forget <n>  ends device n
 *   push test        sends a test notification to every device
 *   push flush [--dry-run]
 *                    sends what this host's ledgers hold and nobody was told
 *                    yet; run-due and sync do this by themselves
 *
 * A phone subscribes in the web app (served over HTTPS), which posts to
 * `darius serve` (src/cli/serve.ts).
 */

import { existsSync } from "node:fs";

import { flushAlerts } from "../core/alerts.ts";
import { hostId, readLedger } from "../core/ledger.ts";
import { projectDir } from "../core/paths.ts";
import { activeDevices, broadcast, makePushKeys, pushKeysFile, readPushKeys, unsubscribe, writePushKeys, type Device } from "../core/push.ts";
import { GLOBAL_PROJECT, openProject, type Project } from "../core/store.ts";
import { UsageError, type Command, type ParsedArgs } from "./registry.ts";

const VERBS = "keys | status | devices | forget | test | flush";

function stringFlag(args: ParsedArgs, name: string): string | undefined {
  const value = args.flags[name];
  if (value === undefined || value === false) return undefined;
  if (value === true) throw new UsageError(`--${name} needs a value`);
  return value;
}

function globalProject(): Project | null {
  return existsSync(projectDir(GLOBAL_PROJECT)) ? openProject(GLOBAL_PROJECT) : null;
}

function devices(): Device[] {
  const global = globalProject();
  return global === null ? [] : activeDevices(readLedger(global));
}

/** The push service of a device: its host, never the whole endpoint (the path is the device's address). */
function serviceOf(device: Device): string {
  return new URL(device.endpoint).hostname;
}

async function keys(args: ParsedArgs): Promise<number> {
  const subject = stringFlag(args, "subject");
  if (subject === undefined || !/^(mailto:\S+@\S+|https:\/\/\S+)$/u.test(subject)) {
    throw new UsageError("push keys needs --subject with a mailto: or https: contact, for example --subject mailto:you@example.com");
  }
  if (readPushKeys() !== null && args.flags.force !== true) {
    console.log(`! ${pushKeysFile()} exists. New keys end every subscription; use --force if you mean it.`);
    return 1;
  }
  const made = await makePushKeys(subject);
  writePushKeys(made);
  if (args.json) console.log(JSON.stringify({ ok: true, public: made.public, file: pushKeysFile() }));
  else console.log(`✓ push keys made in ${pushKeysFile()}. Copy this file to every other host that sends; never make a second pair.`);
  return 0;
}

function status(args: ParsedArgs): number {
  const found = readPushKeys();
  const count = devices().length;
  if (args.json) {
    console.log(JSON.stringify({ host: hostId(), public: found?.public ?? null, subject: found?.subject ?? null, since: found?.since ?? null, devices: count }));
    return 0;
  }
  if (found === null) {
    console.log(`· no push keys on ${hostId()}: darius push keys --subject <mailto:...> on one host, then copy ${pushKeysFile()} to the others`);
    return 0;
  }
  console.log(`✓ ${hostId()} sends push to ${String(count)} device(s); contact ${found.subject}; public key ${found.public}`);
  return 0;
}

function list(args: ParsedArgs): number {
  const found = devices();
  if (args.json) {
    console.log(JSON.stringify({ devices: found.map((device, index) => ({ n: index + 1, service: serviceOf(device), viewer: device.viewer, at: device.at })) }));
    return 0;
  }
  if (found.length === 0) console.log("· no devices: turn notifications on in the web app");
  found.forEach((device, index) => console.log(`${String(index + 1)}. ${device.viewer}, ${serviceOf(device)}, since ${device.at}`));
  return 0;
}

function forget(args: ParsedArgs): number {
  const n = Number(args.positional[1]);
  const found = devices();
  const device = Number.isInteger(n) ? found[n - 1] : undefined;
  const global = globalProject();
  if (device === undefined || global === null) throw new UsageError(`push forget needs a device number from 1 to ${String(found.length)}`);
  unsubscribe(global, device.endpoint);
  console.log(`✓ device ${String(n)} (${device.viewer}, ${serviceOf(device)}) gets no more notifications`);
  return 0;
}

async function test(): Promise<number> {
  const found = readPushKeys();
  const global = globalProject();
  if (found === null) throw new UsageError("no push keys on this host: run darius push keys first");
  if (global === null || devices().length === 0) {
    console.log("· no devices: turn notifications on in the web app first");
    return 1;
  }
  const result = await broadcast(global, found, { title: "darius", body: `A test from ${hostId()}. Notifications work.`, url: "/", tag: "darius-test" });
  console.log(`✓ sent to ${String(result.sent)} device(s)${result.gone > 0 ? `, ${String(result.gone)} gone and removed` : ""}`);
  for (const error of result.errors) console.log(`! ${error}`);
  return result.sent > 0 ? 0 : 1;
}

async function flush(args: ParsedArgs): Promise<number> {
  const isDryRun = args.flags["dry-run"] === true;
  const delivery = await flushAlerts({ isDryRun });
  if (delivery === null) {
    if (args.json) console.log(JSON.stringify({ ok: true, sending: false }));
    else console.log("· this host sends nothing: no push keys, or no device yet");
    return 0;
  }
  if (args.json) {
    console.log(JSON.stringify({ ok: delivery.failed.length === 0, sent: delivery.sent, failed: delivery.failed, pending: delivery.pending }));
    return delivery.failed.length === 0 ? 0 : 1;
  }
  for (const alert of delivery.pending) console.log(`would send (${alert.key}): ${alert.title}\n${alert.body}\n`);
  if (!isDryRun) console.log(`✓ ${String(delivery.sent)} alert(s) sent`);
  for (const failure of delivery.failed) console.log(`! ${failure}`);
  return delivery.failed.length === 0 ? 0 : 1;
}

export const pushCommand: Command = {
  name: "push",
  summary: "phone notifications: keys, status, devices, forget, test, flush",
  async run(args: ParsedArgs): Promise<number> {
    switch (args.positional[0]) {
      case "keys":
        return keys(args);
      case "status":
        return status(args);
      case "devices":
        return list(args);
      case "forget":
        return forget(args);
      case "test":
        return test();
      case "flush":
        return flush(args);
      default:
        throw new UsageError(`push needs a verb: ${VERBS}`);
    }
  },
};
