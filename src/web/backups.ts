/**
 * The snapshots of this host as the status page shows them
 * (docs/concept.md, "Snapshots"): the settings with their sources, the last
 * run, the local folder and the bucket's listing as of the last contact.
 * Read-only and offline: it never reaches the bucket (the page revalidates
 * every minute) and never reads the access key. The writes live in
 * src/web/snapshot-api.ts.
 */

import { homedir } from "node:os";
import { join } from "node:path";

import { hostId } from "../core/ledger.ts";
import { configDir, stateDir } from "../core/paths.ts";
import { listLocalSnapshots, parseSnapshotName, readSnapshotState, runningSnapshot } from "../core/snapshot.ts";
import { bucketLabel, classifyBackups, readGlobalLines, type BackupState } from "../core/backup-state.ts";
import { credentialsSource, maskPingUrl, resolveSnapshotSettings, type ResolvedSnapshotSettings, type SnapshotKey } from "../core/snapshot-settings.ts";
import type { BackupField, BackupRow, BackupsStatus, HostBackup, HostBackupEntry } from "./api.ts";

function field(resolved: ResolvedSnapshotSettings, key: SnapshotKey): BackupField<string> {
  return { value: String(resolved.values.get(key) ?? ""), source: resolved.sources.get(key) ?? "default" };
}

function flag(resolved: ResolvedSnapshotSettings, key: SnapshotKey): BackupField<boolean> {
  return { value: resolved.values.get(key) === true, source: resolved.sources.get(key) ?? "default" };
}

/** The ping address is a capability: the page gets only its scheme and host. */
function maskedField(resolved: ResolvedSnapshotSettings, key: SnapshotKey): BackupField<string> {
  return { value: maskPingUrl(String(resolved.values.get(key) ?? "")), source: resolved.sources.get(key) ?? "default" };
}

function whole(resolved: ResolvedSnapshotSettings, key: SnapshotKey): BackupField<number> {
  return { value: Number(resolved.values.get(key) ?? 0), source: resolved.sources.get(key) ?? "default" };
}

/** `~` for the home dir, so a path in the page does not repeat the user name in the clear on every screenshot. */
function shortPath(path: string): string {
  const home = homedir();
  return path === home || path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}

export function collectBackups(): BackupsStatus {
  const resolved = resolveSnapshotSettings();
  const { dir } = resolved.settings;
  const state = readSnapshotState(dir);
  const local = listLocalSnapshots(dir);
  const inBucket = state.remote?.objects ?? [];
  const known = new Set(local.map((row) => row.name));
  const remoteOnly: BackupRow[] = inBucket
    .filter((object) => !known.has(object.name))
    .map((object) => ({ name: object.name, at: parseSnapshotName(object.name)?.at ?? "", bytes: object.bytes, files: null, sha256: null, local: false, remote: true }));
  const rows = [...local, ...remoteOnly].toSorted((a, b) => b.at.localeCompare(a.at));

  return {
    generatedAt: new Date().toISOString(),
    host: hostId(),
    settings: {
      enabled: flag(resolved, "enabled"),
      dir: { ...field(resolved, "dir"), value: shortPath(String(resolved.values.get("dir") ?? "")) },
      keep: whole(resolved, "keep"),
      keepRemote: whole(resolved, "keep_remote"),
      remotePrune: flag(resolved, "remote_prune"),
      endpoint: field(resolved, "endpoint"),
      bucket: field(resolved, "bucket"),
      region: field(resolved, "region"),
      prefix: field(resolved, "prefix"),
      pathStyle: flag(resolved, "path_style"),
      allowHttp: flag(resolved, "allow_http"),
      sse: flag(resolved, "sse"),
      pingUrl: maskedField(resolved, "ping_url"),
    },
    problems: resolved.problems,
    credentials: credentialsSource(),
    remoteConfigured: resolved.settings.remote !== null,
    running: runningSnapshot(dir),
    last: state.last,
    remote: state.remote === null ? null : { at: state.remote.at, ok: state.remote.ok, error: state.remote.error, count: state.remote.objects.length },
    check:
      state.check === null
        ? null
        : { at: state.check.at, delete: state.check.delete, versioning: state.check.versioning, warnings: state.check.warnings, stale: state.check.remotePrune !== resolved.settings.remotePrune },
    snapshots: rows,
    localBytes: local.reduce((sum, row) => sum + row.bytes, 0),
    storePath: shortPath(stateDir()),
    envFile: shortPath(join(configDir(), "snapshot.env")),
  };
}

// --- every host's last backup ---------------------------------------------------------------------

/** The backup state of every host that wrote a snapshot line. A broken `_global` ledger is no state, not an error: the page must still load. */
export function readHostBackupStates(now: number = Date.now()): BackupState[] {
  try {
    return classifyBackups(readGlobalLines(), now);
  } catch {
    return [];
  }
}

export function hostBackup(state: BackupState): HostBackup {
  return { state: state.state, lastOkAt: state.last_ok_at, ageMs: state.age_ms, name: state.name, error: state.error, reason: state.reason, bucket: state.bucket === null ? null : bucketLabel(state.bucket) };
}

/** This host first, then the others by name, each with its backup (null when it wrote no snapshot line). */
export function hostBackupEntries(self: string, now: number = Date.now()): HostBackupEntry[] {
  const states = new Map(readHostBackupStates(now).map((state) => [state.host, state]));
  const others = [...states.keys()].filter((host) => host !== self).toSorted();
  return [self, ...others].map((host) => {
    const state = states.get(host);
    return { host, self: host === self, backup: state === undefined ? null : hostBackup(state) };
  });
}
