/**
 * `classifyBackups` and the snapshot lines (src/core/backup-state.ts).
 * Pure: hand-built ledger lines and a fixed clock, no store, no disk.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import type { LedgerLineInput } from "../src/core/ledger.ts";
import { classifyBackups, type BackupRemote, snapshotLineFor, snapshotOffLine, SILENT_AFTER_MS, STALE_AFTER_MS, type BackupState } from "../src/core/backup-state.ts";
import type { LedgerLine } from "../src/core/model.ts";
import { scrubForLedger } from "../src/core/redact.ts";
import type { SnapshotRunResult } from "../src/core/snapshot.ts";
import { resolveSnapshotSettings } from "../src/core/snapshot-settings.ts";
import { ulid } from "../src/core/ulid.ts";

const NOW = Date.UTC(2026, 9, 8, 12, 0, 0);
const HOUR = 3_600_000;

/** Extra fields come first, so a test cannot override the envelope. */
function line(host: string, type: string, agoMs: number, extra: Partial<LedgerLineInput> = {}): LedgerLine {
  const time = NOW - agoMs;
  return { ...extra, v: 1, id: ulid(time), at: new Date(time).toISOString(), host, who: "snapshot", project: "_global", type };
}

function ok(host: string, agoMs: number, extra: Partial<LedgerLineInput> = {}): LedgerLine {
  return line(host, "snapshot.ok", agoMs, { name: `darius-${host}-x.tar.gz`, bytes: 1_048_576, files: 3, store_bytes: 4096, darius: "1.2.3", remote: null, bucket: null, ...extra });
}

function one(lines: LedgerLine[]): BackupState {
  const states = classifyBackups(lines, NOW);
  assert.equal(states.length, 1);
  const [state] = states;
  assert.ok(state);
  return state;
}

test("the constants are 36 hours and 30 days", () => {
  assert.equal(STALE_AFTER_MS, 36 * HOUR);
  assert.equal(SILENT_AFTER_MS, 30 * 24 * HOUR);
});

test("ok: a snapshot younger than 36 hours, with the fields of the newest snapshot.ok", () => {
  const state = one([ok("a", HOUR, { remote: { ok: true, key: "darius/a/x", error: null }, bucket: { endpoint_host: "s3.example.com", bucket: "b", prefix: "darius" } })]);
  assert.equal(state.state, "ok");
  assert.equal(state.age_ms, HOUR);
  assert.equal(state.name, "darius-a-x.tar.gz");
  assert.equal(state.bytes, 1_048_576);
  assert.equal(state.files, 3);
  assert.equal(state.store_bytes, 4096);
  assert.equal(state.darius, "1.2.3");
  assert.deepEqual(state.remote, { ok: true, key: "darius/a/x", error: null });
  assert.deepEqual(state.bucket, { endpoint_host: "s3.example.com", bucket: "b", prefix: "darius" });
  assert.equal(state.error, null);
});

test("the 36 hour border: exactly 36 hours is still ok, one millisecond more is stale", () => {
  assert.equal(one([ok("a", STALE_AFTER_MS)]).state, "ok");
  assert.equal(one([ok("a", STALE_AFTER_MS + 1)]).state, "stale");
});

test("stale: the newest snapshot.ok is old; a failed line after it does not make it fresh", () => {
  assert.equal(one([ok("a", 50 * HOUR)]).state, "stale");
  const failedAfter = one([ok("a", 50 * HOUR), line("a", "snapshot.failed", HOUR, { error: "tar did not run" })]);
  assert.equal(failedAfter.state, "stale");
  assert.equal(failedAfter.error, "tar did not run");
  assert.equal(failedAfter.last_type, "snapshot.failed");
});

test("stale: a host that only ever failed has no good snapshot", () => {
  const state = one([line("a", "snapshot.failed", HOUR, { error: "no store" })]);
  assert.equal(state.state, "stale");
  assert.equal(state.last_ok_at, null);
  assert.equal(state.age_ms, null);
  assert.equal(state.name, null);
});

test("failed: the newest line failed and the last good snapshot is fresh", () => {
  const state = one([ok("a", 10 * HOUR), line("a", "snapshot.failed", HOUR, { error: "disk full" })]);
  assert.equal(state.state, "failed");
  assert.equal(state.error, "disk full");
  assert.equal(state.age_ms, 10 * HOUR);
});

test("a later snapshot.ok clears an earlier failure", () => {
  assert.equal(one([line("a", "snapshot.failed", 3 * HOUR, { error: "x" }), ok("a", HOUR)]).state, "ok");
});

test("off: the newest snapshot line is snapshot.off, whatever came before", () => {
  assert.equal(one([ok("a", 100 * HOUR), line("a", "snapshot.off", HOUR)]).state, "off");
  assert.equal(one([line("a", "snapshot.off", 5 * HOUR), ok("a", HOUR)]).state, "ok");
});

test("silent: no line of any kind for over 30 days; exactly 30 days is not silent yet", () => {
  assert.equal(one([ok("a", SILENT_AFTER_MS + 1)]).state, "silent");
  assert.equal(one([ok("a", SILENT_AFTER_MS)]).state, "stale");
  assert.equal(one([line("a", "snapshot.off", SILENT_AFTER_MS + 1)]).state, "silent");
});

test("a line of another type keeps a host with an old snapshot from being silent", () => {
  const state = one([ok("a", 40 * 24 * HOUR), line("a", "harness.checked", HOUR)]);
  assert.equal(state.state, "stale");
  assert.equal(state.seen_at, new Date(NOW - HOUR).toISOString());
});

test("a host that never wrote a snapshot line is not listed", () => {
  assert.deepEqual(classifyBackups([line("a", "harness.checked", HOUR), line("b", "alert.sent", HOUR)], NOW), []);
  assert.deepEqual(classifyBackups([], NOW), []);
});

test("one row per host, newest good snapshot first, hosts without one last, a fixed clock", () => {
  const states = classifyBackups(
    [ok("old", 30 * HOUR), line("never", "snapshot.failed", HOUR, { error: "x" }), ok("new", HOUR), line("off", "snapshot.off", HOUR), ok("mid", 5 * HOUR)],
    NOW,
  );
  assert.deepEqual(
    states.map((state) => [state.host, state.state]),
    [
      ["new", "ok"],
      ["mid", "ok"],
      ["old", "ok"],
      ["never", "stale"],
      ["off", "off"],
    ],
  );
});

test("the order of the input lines does not matter", () => {
  const lines = [ok("a", 3 * HOUR), line("a", "snapshot.failed", HOUR, { error: "later" }), ok("a", 5 * HOUR)];
  assert.equal(one(lines).state, "failed");
  assert.equal(one(lines.toReversed()).state, "failed");
  assert.equal(one(lines.toReversed()).age_ms, 3 * HOUR);
});

test("odd field types in a line give null fields, not a throw", () => {
  const state = one([line("a", "snapshot.ok", HOUR, { name: 7, bytes: "big", remote: "yes", bucket: [] })]);
  assert.equal(state.state, "ok");
  assert.equal(state.name, null);
  assert.equal(state.bytes, null);
  assert.equal(state.remote, null);
  assert.equal(state.bucket, null);
});

// --- the lines a run writes -------------------------------------------------------------------

function result(extra: Partial<SnapshotRunResult> = {}): SnapshotRunResult {
  return { code: 0, ok: true, name: "darius-a-20261008T120000Z.tar.gz", bytes: 100, files: 2, storeBytes: 900, busy: false, remote: null, pruned: { local: 0, remote: 0 }, warnings: [], error: null, ...extra };
}

const REMOTE_ENV = { DARIUS_SNAPSHOT_ENDPOINT: "https://user.s3.example.com:9000/path?x=1", DARIUS_SNAPSHOT_BUCKET: "backups" };

test("snapshotLineFor: a good run is snapshot.ok with the bucket's host name only", () => {
  const resolved = resolveSnapshotSettings({ env: { ...REMOTE_ENV, DARIUS_SNAPSHOT_ENDPOINT: "https://s3.example.com:9000" }, config: {}, file: new Map() });
  const made = snapshotLineFor(result({ remote: { ok: true, key: "darius/a/x", error: null } }), resolved, "9.9.9");
  assert.deepEqual(made, {
    who: "snapshot",
    type: "snapshot.ok",
    name: "darius-a-20261008T120000Z.tar.gz",
    bytes: 100,
    files: 2,
    store_bytes: 900,
    darius: "9.9.9",
    remote: { ok: true, key: "darius/a/x", error: null },
    bucket: { endpoint_host: "s3.example.com", bucket: "backups", prefix: "darius" },
  });
  assert.equal(JSON.stringify(made).includes("9000"), false);
});

test("snapshotLineFor: a local archive with a failed upload is still snapshot.ok, and the error loses the endpoint URL", () => {
  const resolved = resolveSnapshotSettings({ env: { ...REMOTE_ENV, DARIUS_SNAPSHOT_ENDPOINT: "https://s3.example.com:9000" }, config: {}, file: new Map() });
  const made = snapshotLineFor(result({ code: 3, ok: false, remote: { ok: false, key: null, error: "fetch https://s3.example.com:9000 failed\nrefused" } }), resolved, "9.9.9");
  assert.equal(made.type, "snapshot.ok");
  assert.deepEqual(made.remote, { ok: false, key: null, error: "fetch s3.example.com failed refused" });
});

test("snapshotLineFor: no archive is snapshot.failed with the error; no bucket is null", () => {
  const resolved = resolveSnapshotSettings({ env: {}, config: {}, file: new Map() });
  const made = snapshotLineFor(result({ code: 1, ok: false, name: null, bytes: 0, files: 0, storeBytes: 0, error: "tar did not run" }), resolved, "9.9.9");
  assert.deepEqual(made, { who: "snapshot", type: "snapshot.failed", error: "tar did not run", remote: null, bucket: null });
  assert.deepEqual(snapshotOffLine(), { who: "snapshot", type: "snapshot.off" });
});

test("scrubForLedger cuts a URL to its host, joins lines and caps the length", () => {
  assert.equal(scrubForLedger("GET https://h.example.com/a/b?c=d failed", ["https://h.example.com/a/b?c=d"]), "GET h.example.com failed");
  assert.equal(scrubForLedger("a\n\n  b"), "a b");
  assert.equal(scrubForLedger("x".repeat(500)).length, 300);
});

test("snapshotLineFor: an error that repeats the ping URL or its secret path loses both", () => {
  const ping = "https://hc.example.com/ping-secret-uuid-1234";
  const resolved = resolveSnapshotSettings({ env: { DARIUS_SNAPSHOT_PING_URL: ping }, config: {}, file: new Map() });
  const made = snapshotLineFor(result({ code: 1, ok: false, name: null, error: `trouble with ${ping} and /ping-secret-uuid-1234 itself` }), resolved, "9.9.9");
  assert.equal(made.error, "trouble with hc.example.com and /... itself");
  assert.equal(JSON.stringify(made).includes("ping-secret"), false);
});

// --- the offsite copy decides when a bucket is set up -------------------------------------------

const UP = { ok: true, key: "k", error: null };
const DOWN = { ok: false, key: null, error: "access denied" };
const BUCKET = { endpoint_host: "s3.example.com", bucket: "b", prefix: "darius" };

function viaBucket(host: string, agoMs: number, remote: BackupRemote | null): LedgerLine {
  return ok(host, agoMs, { remote, bucket: BUCKET });
}

test("uploads that fail past 36 hours make the host stale with the reason, though the local archives are fresh", () => {
  const state = one([viaBucket("a", 60 * HOUR, UP), viaBucket("a", 30 * HOUR, DOWN), viaBucket("a", HOUR, DOWN)]);
  assert.equal(state.state, "stale");
  assert.equal(state.reason, "no upload for 60 h");
  assert.equal(state.needs_upload, true);
  assert.equal(state.last_upload_at, new Date(NOW - 60 * HOUR).toISOString());
  assert.equal(state.last_ok_at, new Date(NOW - HOUR).toISOString(), "the local archive is still reported");
  assert.equal(state.age_ms, HOUR);
});

test("a host that never uploaded is stale with its own reason", () => {
  const state = one([viaBucket("a", HOUR, DOWN)]);
  assert.equal(state.state, "stale");
  assert.equal(state.reason, "no upload yet");
  assert.equal(state.last_upload_at, null);
});

test("one good upload inside 36 hours among failures keeps the host ok; the 36 hour border holds for uploads too", () => {
  const among = one([viaBucket("a", 20 * HOUR, UP), viaBucket("a", 6 * HOUR, DOWN), viaBucket("a", HOUR, DOWN)]);
  assert.equal(among.state, "ok");
  assert.equal(among.reason, null);
  assert.equal(one([viaBucket("a", STALE_AFTER_MS, UP), viaBucket("a", HOUR, DOWN)]).state, "ok");
  assert.equal(one([viaBucket("a", STALE_AFTER_MS + 1, UP), viaBucket("a", HOUR, DOWN)]).state, "stale");
});

test("a failed run after a fresh upload is failed; --no-upload runs on a bucket host do not count as uploads", () => {
  assert.equal(one([viaBucket("a", 10 * HOUR, UP), line("a", "snapshot.failed", HOUR, { error: "x" })]).state, "failed");
  const skipped = one([viaBucket("a", 50 * HOUR, UP), ok("a", HOUR, { remote: null, bucket: BUCKET })]);
  assert.equal(skipped.state, "stale");
  assert.equal(skipped.reason, "no upload for 50 h");
});

test("no bucket: the local archive decides, as before, with its own reason", () => {
  const fresh = one([ok("a", HOUR)]);
  assert.equal(fresh.state, "ok");
  assert.equal(fresh.needs_upload, false);
  assert.equal(fresh.reason, null);
  const old = one([ok("a", 50 * HOUR)]);
  assert.equal(old.state, "stale");
  assert.equal(old.reason, "no snapshot for 50 h");
  assert.equal(one([line("a", "snapshot.failed", HOUR, { error: "x" })]).reason, "no good snapshot yet");
  const unbucketed = one([viaBucket("a", 70 * HOUR, UP), ok("a", HOUR)]);
  assert.equal(unbucketed.state, "ok", "the newest good line has no bucket, so the local rule applies");
});
