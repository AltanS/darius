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
import { credentialsSource, resolveSnapshotSettings, type ResolvedSnapshotSettings, type SnapshotKey } from "../core/snapshot-settings.ts";
import type { BackupField, BackupRow, BackupsStatus } from "./api.ts";

function field(resolved: ResolvedSnapshotSettings, key: SnapshotKey): BackupField<string> {
  return { value: String(resolved.values.get(key) ?? ""), source: resolved.sources.get(key) ?? "default" };
}

function flag(resolved: ResolvedSnapshotSettings, key: SnapshotKey): BackupField<boolean> {
  return { value: resolved.values.get(key) === true, source: resolved.sources.get(key) ?? "default" };
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
      endpoint: field(resolved, "endpoint"),
      bucket: field(resolved, "bucket"),
      region: field(resolved, "region"),
      prefix: field(resolved, "prefix"),
      pathStyle: flag(resolved, "path_style"),
      allowHttp: flag(resolved, "allow_http"),
      sse: flag(resolved, "sse"),
    },
    problems: resolved.problems,
    credentials: credentialsSource(),
    remoteConfigured: resolved.settings.remote !== null,
    running: runningSnapshot(dir),
    last: state.last,
    remote: state.remote === null ? null : { at: state.remote.at, ok: state.remote.ok, error: state.remote.error, count: state.remote.objects.length },
    snapshots: rows,
    localBytes: local.reduce((sum, row) => sum + row.bytes, 0),
    storePath: shortPath(stateDir()),
    envFile: shortPath(join(configDir(), "snapshot.env")),
  };
}
