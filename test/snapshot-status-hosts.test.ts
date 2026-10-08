/**
 * `darius snapshot status --hosts` (src/cli/snapshot.ts): every host's last
 * snapshot line from the synced `_global` ledger.
 *
 * SAFETY: the state and config dirs are `mkdtemp` dirs. The other hosts' lines
 * are written straight into `_global/ledger/<host>/open.jsonl`, as a sync
 * would leave them. No bucket, no systemd.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runSnapshotCommand, type SnapshotDeps } from "../src/cli/snapshot.ts";
import { STALE_AFTER_MS, type BackupState } from "../src/core/backup-state.ts";
import type { LedgerLineInput } from "../src/core/ledger.ts";
import type { ParsedArgs } from "../src/cli/registry.ts";
import { ulid } from "../src/core/ulid.ts";

const sandbox = mkdtempSync(join(tmpdir(), "darius-snapshot-hosts-test-"));
const configRoot = join(sandbox, "config");
const stateRoot = join(sandbox, "state");
process.env.DARIUS_CONFIG_DIR = configRoot;
process.env.DARIUS_STATE_DIR = stateRoot;
process.env.DARIUS_SNAPSHOT_DIR = join(sandbox, "snapshots");
mkdirSync(configRoot, { recursive: true });
mkdirSync(stateRoot, { recursive: true });
writeFileSync(join(configRoot, "config.toml"), 'host = "host-a"\n');

const BIN = join(import.meta.dirname, "..", "bin", "darius");
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const deps: SnapshotDeps = {
  systemctl: () => {
    throw new Error("systemctl: not found");
  },
  stdinIsTTY: () => false,
  readStdin: () => "",
};

async function statusHosts(flags: Record<string, string | boolean> = {}): Promise<{ code: number; out: string }> {
  const parsed: ParsedArgs = { positional: ["status"], flags: { hosts: true, ...flags }, json: flags.json === true, repeated: {} };
  const out: string[] = [];
  const log = console.log;
  console.log = (...items: unknown[]) => out.push(items.join(" "));
  try {
    return { code: await runSnapshotCommand(parsed, deps), out: out.join("\n") };
  } finally {
    console.log = log;
  }
}

/** A line of `host` written `agoMs` ago, as a synced chunk would hold it. */
function entry(host: string, type: string, agoMs: number, extra: Partial<LedgerLineInput> = {}): string {
  const time = Date.now() - agoMs;
  return JSON.stringify({ ...extra, v: 1, id: ulid(time), at: new Date(time).toISOString(), host, who: "snapshot", project: "_global", type });
}

function writeHost(host: string, lines: string[]): void {
  const dir = join(stateRoot, "_global", "ledger", host);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "open.jsonl"), `${lines.join("\n")}\n`);
}

test("without a _global ledger: the empty message, exit 0, and an empty list in JSON", async () => {
  const text = await statusHosts();
  assert.equal(text.code, 0);
  assert.equal(text.out, "· no host has written a snapshot line yet");
  const json = await statusHosts({ json: true });
  assert.equal(json.code, 0);
  assert.deepEqual(JSON.parse(json.out), { hosts: [], stale_after_ms: STALE_AFTER_MS });
});

test("a _global ledger with other lines only gives the same empty message", async () => {
  writeHost("host-z", [entry("host-z", "harness.checked", HOUR, { who: "darius" })]);
  const text = await statusHosts();
  assert.equal(text.code, 0);
  assert.equal(text.out, "· no host has written a snapshot line yet");
  rmSync(join(stateRoot, "_global", "ledger", "host-z"), { recursive: true });
});

test("one row per host in text and JSON: ok, stale, failed, off, and silent in its own line", async () => {
  const good = { name: "darius-host-a-x.tar.gz", bytes: 3 * 1_048_576, files: 10, store_bytes: 9, darius: "1.0.0", bucket: null };
  writeHost("host-a", [entry("host-a", "snapshot.ok", 2 * HOUR, { ...good, remote: { ok: true, key: "k", error: null } })]);
  writeHost("host-b", [entry("host-b", "snapshot.ok", 3 * DAY, { ...good, name: "darius-host-b-x.tar.gz", remote: null })]);
  writeHost("host-c", [entry("host-c", "snapshot.ok", 5 * HOUR, { ...good, name: "darius-host-c-x.tar.gz", remote: { ok: true, key: "k", error: null } }), entry("host-c", "snapshot.failed", HOUR, { error: "disk full" })]);
  writeHost("host-d", [entry("host-d", "snapshot.off", HOUR)]);
  writeHost("host-f", [entry("host-f", "snapshot.ok", 60 * HOUR, { ...good, name: "darius-host-f-x.tar.gz", remote: { ok: true, key: "k", error: null }, bucket: { endpoint_host: "s3.example.com", bucket: "b", prefix: "p" } }), entry("host-f", "snapshot.ok", HOUR, { ...good, name: "darius-host-f-y.tar.gz", remote: { ok: false, key: null, error: "denied" }, bucket: { endpoint_host: "s3.example.com", bucket: "b", prefix: "p" } })]);
  writeHost("host-e", [entry("host-e", "snapshot.ok", 60 * DAY, { ...good, remote: null })]);

  const json = await statusHosts({ json: true });
  assert.equal(json.code, 0);
  const parsed: { hosts: BackupState[]; stale_after_ms: number } = JSON.parse(json.out);
  assert.equal(parsed.stale_after_ms, STALE_AFTER_MS);
  assert.deepEqual(
    parsed.hosts.map((state) => [state.host, state.state]),
    [
      ["host-f", "stale"],
      ["host-a", "ok"],
      ["host-c", "failed"],
      ["host-b", "stale"],
      ["host-e", "silent"],
      ["host-d", "off"],
    ],
  );
  assert.equal(parsed.hosts[0]?.reason, "no upload for 60 h", "uploads failing past 36 h: stale, with the reason");
  assert.equal(parsed.hosts[1]?.reason, null);
  assert.equal(parsed.hosts[1]?.name, "darius-host-a-x.tar.gz");
  assert.equal(parsed.hosts[2]?.error, "disk full");

  const text = await statusHosts();
  assert.equal(text.code, 0);
  const rows = text.out.split("\n");
  assert.match(rows[0] ?? "", /^host-f +stale +1h ago .*bucket failed: denied +no upload for 60 h$/u);
  assert.match(rows[1] ?? "", /^host-a +ok +2h ago +darius-host-a-x\.tar\.gz +3\.0 MiB +bucket ok$/u);
  assert.match(rows[2] ?? "", /^host-c +failed +5h ago .*bucket ok +last run failed: disk full$/u);
  assert.match(rows[3] ?? "", /^host-b +stale +3d 0h ago .*no bucket copy +no snapshot for 72 h$/u);
  assert.match(rows[4] ?? "", /^host-d +off .*snapshots are off on purpose$/u);
  assert.match(rows[5] ?? "", /^· silent for over 30 days, not counted as stale: host-e$/u);
  assert.equal(rows.length, 6);
});

test("the CLI accepts a bare --hosts last and before another flag, and plain status is unchanged", () => {
  const env = { ...process.env, DARIUS_SYSTEMCTL: join(sandbox, "no-systemctl") };
  const last = spawnSync(BIN, ["snapshot", "status", "--hosts"], { encoding: "utf8", env, cwd: tmpdir(), timeout: 20_000 });
  assert.equal(last.status, 0, last.stderr);
  assert.match(last.stdout, /^host-a +ok /mu);
  const json = spawnSync(BIN, ["snapshot", "status", "--hosts", "--json"], { encoding: "utf8", env, cwd: tmpdir(), timeout: 20_000 });
  assert.equal(json.status, 0, json.stderr);
  const listed: { hosts: unknown[] } = JSON.parse(json.stdout);
  assert.equal(listed.hosts.length, 6);
  const plain = spawnSync(BIN, ["snapshot", "status", "--json"], { encoding: "utf8", env, cwd: tmpdir(), timeout: 20_000 });
  const parsed: { settings?: unknown; hosts?: unknown } = JSON.parse(plain.stdout);
  assert.ok(parsed.settings !== undefined);
  assert.equal(parsed.hosts, undefined);
  const push = spawnSync(BIN, ["snapshot", "config", "push", "--hosts"], { encoding: "utf8", env, cwd: tmpdir(), timeout: 20_000 });
  assert.equal(push.status, 2);
  assert.match(push.stderr, /needs --hosts/u);
});
