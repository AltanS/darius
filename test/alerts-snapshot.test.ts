/**
 * The backup alerts (src/core/alerts.ts): a failed run on this host, and a
 * stale host seen by the watcher. The push service is a fake on loopback that
 * counts requests; the ledger lines are hand-built, so no clock, bucket or
 * real service is involved.
 *
 * SAFETY: the state and config dirs are `mkdtemp` dirs, and
 * DARIUS_PUSH_ORIGINS names only the fake.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { flushAlerts, ledgerAlerts, watcherHost } from "../src/core/alerts.ts";
import { STALE_AFTER_MS, type BackupRemote } from "../src/core/backup-state.ts";
import { appendLine, readLedger, type LedgerLineInput } from "../src/core/ledger.ts";
import type { LedgerLine } from "../src/core/model.ts";
import { makePushKeys, subscribe, writePushKeys } from "../src/core/push.ts";
import { GLOBAL_PROJECT, openProject } from "../src/core/store.ts";
import { ulid } from "../src/core/ulid.ts";

const SANDBOX = mkdtempSync(join(tmpdir(), "darius-alerts-snapshot-"));
process.env.DARIUS_STATE_DIR = join(SANDBOX, "state");
process.env.DARIUS_CONFIG_DIR = join(SANDBOX, "config");
mkdirSync(process.env.DARIUS_CONFIG_DIR, { recursive: true });
writeFileSync(join(process.env.DARIUS_CONFIG_DIR, "config.toml"), 'host = "host-a"\n');

const HOUR = 3_600_000;
const NOW = Date.UTC(2026, 9, 8, 12, 0, 0);

/** Extra fields come first, so a test cannot override the envelope. */
function line(host: string, type: string, agoMs: number, extra: Partial<LedgerLineInput> = {}, now: number = NOW): LedgerLine {
  const time = now - agoMs;
  return { ...extra, v: 1, id: ulid(time), at: new Date(time).toISOString(), host, who: "snapshot", project: "_global", type };
}

const global = openProject(GLOBAL_PROJECT, { create: true });

// --- watcherHost -----------------------------------------------------------------------------

test("watcherHost: one host is its own watcher", () => {
  assert.equal(watcherHost([line("host-b", "snapshot.ok", HOUR)], NOW), "host-b");
});

test("watcherHost: the smallest host id among the hosts that wrote anything in the last 36 hours", () => {
  const lines = [line("host-c", "snapshot.ok", HOUR), line("host-b", "harness.checked", 2 * HOUR), line("host-d", "snapshot.ok", HOUR)];
  assert.equal(watcherHost(lines, NOW), "host-b");
});

test("watcherHost: a silent host does not watch, however small its id", () => {
  const lines = [line("host-a", "snapshot.ok", 40 * HOUR), line("host-b", "snapshot.ok", HOUR)];
  assert.equal(watcherHost(lines, NOW), "host-b");
});

test("watcherHost: the border is 36 hours; null when every host is quiet or there is no line", () => {
  assert.equal(watcherHost([line("host-a", "x.y", STALE_AFTER_MS)], NOW), "host-a");
  assert.equal(watcherHost([line("host-a", "x.y", STALE_AFTER_MS + 1)], NOW), null);
  assert.equal(watcherHost([line("host-a", "snapshot.ok", 50 * HOUR), line("host-b", "snapshot.ok", 60 * HOUR)], NOW), null);
  assert.equal(watcherHost([], NOW), null);
});

test("watcherHost: the order of the lines does not matter", () => {
  const lines = [line("host-b", "a.b", HOUR), line("host-a", "a.b", 2 * HOUR), line("host-c", "a.b", 3 * HOUR)];
  assert.equal(watcherHost(lines, NOW), "host-a");
  assert.equal(watcherHost(lines.toReversed(), NOW), "host-a");
});

// --- ledgerAlerts: a failed run --------------------------------------------------------------

test("a snapshot.failed line of this host builds a snapshot-failed alert; another host's builds none", () => {
  const mine = line("host-a", "snapshot.failed", HOUR, { error: "tar did not run\nsecond line" });
  const theirs = line("host-b", "snapshot.failed", HOUR, { error: "disk full" });
  const alerts = ledgerAlerts(global, [mine, theirs], "2000-01-01T00:00:00.000Z", "host-a", NOW).filter((alert) => alert.key.startsWith("snapshot-failed:"));
  assert.deepEqual(alerts, [
    { key: `snapshot-failed:host-a:${mine.id}`, tag: `snapshot-failed:host-a:${mine.id}`, title: "Backup failed on host-a", body: "tar did not run second line", url: "/status" },
  ]);
});

test("an old failed line is history, a snapshot.ok line is no alert, and other projects build none", () => {
  const old = line("host-a", "snapshot.failed", 10 * HOUR, { error: "x" });
  const since = new Date(NOW - HOUR).toISOString();
  assert.deepEqual(ledgerAlerts(global, [old, line("host-a", "snapshot.ok", HOUR)], since, "host-a", NOW), []);
  const other = openProject("alerts-other", { create: true });
  assert.deepEqual(ledgerAlerts(other, [line("host-a", "snapshot.failed", HOUR, { error: "x" })], "2000-01-01T00:00:00.000Z", "host-a", NOW), []);
});

// --- ledgerAlerts: a stale host --------------------------------------------------------------

function mesh(): LedgerLine[] {
  return [
    line("host-a", "snapshot.ok", HOUR),
    line("host-b", "snapshot.ok", 50 * HOUR),
    line("host-b", "harness.checked", HOUR),
    line("host-c", "snapshot.ok", 60 * 24 * HOUR),
    line("host-d", "snapshot.off", HOUR),
    line("host-e", "snapshot.failed", HOUR, { error: "x" }),
    line("host-e", "snapshot.ok", 10 * HOUR),
  ];
}

test("the watcher alerts for each stale host, once per UTC day; silent, off, failed and ok hosts get none", () => {
  const stale = ledgerAlerts(global, mesh(), "2000-01-01T00:00:00.000Z", "host-a", NOW).filter((alert) => alert.key.startsWith("snapshot-stale:"));
  assert.equal(stale.length, 1);
  const [alert] = stale;
  assert.equal(alert?.key, "snapshot-stale:host-b:2026-10-08");
  assert.equal(alert?.tag, alert?.key);
  assert.equal(alert?.title, "No backup from host-b for 50 hours");
  assert.match(alert?.body ?? "", /^No snapshot for 50 h\. Last good backup: 2026-10-06T10:00:00\.000Z\. /u);
  assert.equal(alert?.url, "/status");

  const nextDay = ledgerAlerts(global, mesh(), "2000-01-01T00:00:00.000Z", "host-a", NOW + 24 * HOUR).filter((found) => found.key.startsWith("snapshot-stale:"));
  assert.deepEqual(nextDay.map((found) => found.key).filter((key) => key.includes("host-b")), ["snapshot-stale:host-b:2026-10-09"]);
});

test("a host that is not the watcher sends no stale alert", () => {
  for (const host of ["host-b", "host-c", "host-d", "host-e", "host-z"]) {
    const found = ledgerAlerts(global, mesh(), "2000-01-01T00:00:00.000Z", host, NOW).filter((alert) => alert.key.startsWith("snapshot-stale:"));
    assert.deepEqual(found, [], host);
  }
});

test("when the smallest host goes quiet, the next one watches, and the quiet host is itself reported", () => {
  const lines = [line("host-a", "snapshot.ok", 40 * HOUR), line("host-b", "snapshot.ok", HOUR)];
  assert.equal(ledgerAlerts(global, lines, "2000-01-01T00:00:00.000Z", "host-a", NOW).length, 0);
  const found = ledgerAlerts(global, lines, "2000-01-01T00:00:00.000Z", "host-b", NOW);
  assert.deepEqual(found.map((alert) => alert.key), ["snapshot-stale:host-a:2026-10-08"]);
});

test("a host that never made a good backup is stale, and the title counts from its newest line", () => {
  const found = ledgerAlerts(global, [line("host-a", "snapshot.ok", HOUR), line("host-b", "snapshot.failed", 5 * HOUR, { error: "x" })], "2000-01-01T00:00:00.000Z", "host-a", NOW);
  assert.equal(found[0]?.title, "No backup from host-b for 5 hours");
  assert.match(found[0]?.body ?? "", /^No good snapshot yet\. It never made a good backup\./u);
});

const UP = { ok: true, key: "k", error: null };
const DOWN = { ok: false, key: null, error: "access denied" };
const BUCKET = { endpoint_host: "s3.example.com", bucket: "b", prefix: "darius" };

function withBucket(host: string, agoMs: number, remote: BackupRemote): LedgerLine {
  return line(host, "snapshot.ok", agoMs, { name: `darius-${host}-x.tar.gz`, bytes: 1, files: 1, store_bytes: 1, darius: "1.0.0", remote, bucket: BUCKET });
}

test("a host whose uploads fail past 36 hours gets a stale alert that says why, counted from its last upload", () => {
  const lines = [line("host-a", "snapshot.ok", HOUR), withBucket("host-b", 60 * HOUR, UP), withBucket("host-b", 30 * HOUR, DOWN), withBucket("host-b", 6 * HOUR, DOWN)];
  const found = ledgerAlerts(global, lines, "2000-01-01T00:00:00.000Z", "host-a", NOW).filter((alert) => alert.key.startsWith("snapshot-stale:"));
  assert.equal(found.length, 1);
  assert.equal(found[0]?.key, "snapshot-stale:host-b:2026-10-08");
  assert.equal(found[0]?.title, "No backup from host-b for 60 hours");
  assert.match(found[0]?.body ?? "", /^No upload for 60 h\. Last good backup: /u);
});

test("one good upload inside 36 hours among failures sends no stale alert", () => {
  const lines = [line("host-a", "snapshot.ok", HOUR), withBucket("host-b", 20 * HOUR, UP), withBucket("host-b", 6 * HOUR, DOWN)];
  assert.deepEqual(ledgerAlerts(global, lines, "2000-01-01T00:00:00.000Z", "host-a", NOW).filter((alert) => alert.key.startsWith("snapshot-stale:")), []);
});

// --- flushAlerts with a fake push service ----------------------------------------------------

let requests = 0;
const server = createServer((request: IncomingMessage, response: ServerResponse) => {
  request.resume();
  request.on("end", () => {
    requests += 1;
    response.writeHead(201);
    response.end();
  });
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
// SAFETY: a server listening on a TCP port reports an AddressInfo, never a pipe name or null.
const origin = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
process.env.DARIUS_PUSH_ORIGINS = origin;
test.after(() => server.close());

/** Writes lines of another host into `_global`, as a sync would leave them. */
function foreign(host: string, lines: readonly LedgerLine[]): void {
  const dir = join(process.env.DARIUS_STATE_DIR ?? "", GLOBAL_PROJECT, "ledger", host);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "open.jsonl"), lines.map((found) => `${JSON.stringify(found)}\n`).join(""));
}

test("flushAlerts sends the stale alert and the failed alert once; a second flush on the same day sends nothing; the next UTC day sends the stale one again", async () => {
  writePushKeys(await makePushKeys("mailto:ops@example.com", new Date(Date.now() - 100 * HOUR)));
  const pair = await webcrypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const p256dh = Buffer.from(await webcrypto.subtle.exportKey("raw", pair.publicKey)).toString("base64url");
  const auth = Buffer.from(webcrypto.getRandomValues(new Uint8Array(16))).toString("base64url");
  assert.deepEqual(subscribe(global, { endpoint: `${origin}/device`, keys: { p256dh, auth } }, "ops on phone"), { ok: true });

  const real = Date.now();
  foreign("host-b", [line("host-b", "snapshot.ok", 50 * HOUR, {}, real), line("host-b", "snapshot.failed", HOUR, { error: "disk full" }, real)]);
  appendLine(global, { who: "snapshot", type: "snapshot.ok", name: "darius-host-a-x.tar.gz", bytes: 1, files: 1, store_bytes: 1, darius: "1.0.0", remote: null, bucket: null });
  appendLine(global, { who: "snapshot", type: "snapshot.failed", error: "tar did not run" });

  requests = 0;
  const first = await flushAlerts({ projects: [GLOBAL_PROJECT], now: real });
  assert.equal(first?.sent, 2, JSON.stringify(first));
  assert.equal(requests, 2, "one device, two notices");
  const sent = readLedger(global).filter((found) => found.type === "alert.sent").map((found) => String(found.key));
  assert.equal(sent.filter((key) => key.startsWith("snapshot-failed:host-a:")).length, 1);
  assert.deepEqual(
    sent.filter((key) => key.startsWith("snapshot-stale:")),
    [`snapshot-stale:host-b:${new Date(real).toISOString().slice(0, 10)}`],
  );
  assert.equal(sent.some((key) => key.includes("host-b:0")), false, "host-b's own failed line is host-b's to send");

  const second = await flushAlerts({ projects: [GLOBAL_PROJECT], now: real });
  assert.equal(second?.sent, 0);
  assert.equal(requests, 2, "nothing went out the second time");

  const tomorrow = await flushAlerts({ projects: [GLOBAL_PROJECT], now: real + 24 * HOUR });
  assert.equal(tomorrow?.sent, 1, "the new UTC day is a new key for the same stale host");
  assert.equal(requests, 3);
});
