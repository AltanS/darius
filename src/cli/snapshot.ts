/**
 * `darius snapshot create|list|status|check|delete`: dated archives of this
 * host's store, kept locally, with an optional copy in an S3 bucket
 * (src/core/snapshot.ts; docs/concept.md, "Snapshots"). The settings come from
 * the environment, the status page's file and config.toml
 * (src/core/snapshot-settings.ts).
 *
 *   snapshot create [--no-upload]   make a snapshot, copy it to the bucket, apply retention
 *   snapshot list                   the local snapshots, newest first
 *   snapshot status                 the settings with their sources, the last run, the bucket check
 *   snapshot check                  list the bucket and write and delete a small probe object
 *   snapshot delete <name> [--remote]
 *                                   delete one snapshot, here or in the bucket
 *
 * Exit codes (probe contract): 0 done; 1 refused or failed (a problem in the
 * settings, a secret-looking name in the store, a failed upload that is no
 * network fault); 2 usage; 3 the snapshot is local but the bucket could not be
 * reached. The next run makes a new snapshot and uploads that one; the missed
 * one is not sent again. `create` with `enabled = false` does nothing and exits
 * 0, so the timer does not show as failed.
 */

import { hostId } from "../core/ledger.ts";
import { stateDir } from "../core/paths.ts";
import {
  checkRemote,
  deleteLocalSnapshot,
  deleteRemoteSnapshot,
  describeSnapshotRun,
  listLocalSnapshots,
  readSnapshotState,
  runningSnapshot,
  runSnapshot,
} from "../core/snapshot.ts";
import { credentialsSource, resolveSnapshotSettings, SNAPSHOT_KEYS } from "../core/snapshot-settings.ts";
import { VERSION } from "../version.ts";
import { UsageError, type Command, type ParsedArgs } from "./registry.ts";

const VERBS = "create | list | status | check | delete";

async function create(args: ParsedArgs): Promise<number> {
  const resolved = resolveSnapshotSettings();
  // Off on purpose is not a failure: the timer must not show as failed every night.
  if (resolved.problems.length === 0 && !resolved.settings.enabled) {
    if (args.json) console.log(JSON.stringify({ code: 0, ok: true, name: null, skipped: "off" }));
    else console.log("· snapshots are off (enabled = false), nothing done");
    return 0;
  }
  const result = await runSnapshot({
    resolved,
    host: hostId(),
    version: VERSION,
    stateDir: stateDir(),
    upload: args.flags["no-upload"] !== true,
  });
  if (args.json) console.log(JSON.stringify(result));
  else console.log(describeSnapshotRun(result));
  for (const warning of result.warnings) console.error(`darius snapshot: ${warning}`);
  return result.code;
}

function list(args: ParsedArgs): number {
  const rows = listLocalSnapshots(resolveSnapshotSettings().settings.dir);
  if (args.json) {
    console.log(JSON.stringify({ snapshots: rows }));
    return 0;
  }
  if (rows.length === 0) console.log("· no local snapshots yet");
  for (const row of rows) {
    console.log(`${row.name}  ${(row.bytes / 1_048_576).toFixed(1)} MiB${row.remote ? "  in the bucket" : ""}`);
  }
  return 0;
}

function status(args: ParsedArgs): number {
  const resolved = resolveSnapshotSettings();
  const state = readSnapshotState(resolved.settings.dir);
  const running = runningSnapshot(resolved.settings.dir);
  if (args.json) {
    console.log(
      JSON.stringify({
        enabled: resolved.settings.enabled,
        settings: Object.fromEntries(SNAPSHOT_KEYS.map((key) => [key, { value: resolved.values.get(key), source: resolved.sources.get(key) }])),
        credentials: credentialsSource(),
        problems: resolved.problems,
        running,
        last: state.last,
        remote: state.remote,
      }),
    );
    return resolved.problems.length === 0 ? 0 : 1;
  }
  console.log(`snapshots ${resolved.settings.enabled ? "on" : "off"}, folder ${resolved.settings.dir}, keep ${String(resolved.settings.keep)}`);
  const remote = resolved.settings.remote;
  console.log(remote === null ? "· no remote copy" : `· remote copy: ${remote.endpoint} bucket ${remote.bucket}, keep ${String(resolved.settings.keepRemote)}, key pair from ${credentialsSource()}`);
  if (running !== null) console.log(`· running now (pid ${String(running.pid)})`);
  if (state.last !== null) console.log(`· last run ${state.last.at}: ${state.last.ok ? "ok" : `failed, ${state.last.error ?? ""}`}`);
  // A run can make its local snapshot (ok) and still fail to reach the bucket, so the bucket gets its own line.
  if (state.remote !== null) console.log(`· bucket, last contact ${state.remote.at}: ${state.remote.ok ? `ok, ${String(state.remote.objects.length)} snapshots` : `failed, ${state.remote.error ?? ""}`}`);
  for (const problem of resolved.problems) console.log(`! ${problem}`);
  return resolved.problems.length === 0 ? 0 : 1;
}

async function check(args: ParsedArgs): Promise<number> {
  const result = await checkRemote(resolveSnapshotSettings(), hostId());
  if (args.json) console.log(JSON.stringify(result));
  else console.log(result.ok ? `✓ the bucket answers, ${String(result.objects.length)} snapshots of this host` : `! ${result.error ?? "the check failed"}`);
  return result.ok ? 0 : 1;
}

async function remove(args: ParsedArgs): Promise<number> {
  const name = args.positional[1];
  if (name === undefined) throw new UsageError("snapshot delete needs a snapshot name");
  const resolved = resolveSnapshotSettings();
  const done = args.flags.remote === true ? await deleteRemoteSnapshot(resolved, hostId(), name) : deleteLocalSnapshot(resolved.settings.dir, name);
  if (args.json) console.log(JSON.stringify(done));
  else console.log(done.ok ? `✓ deleted ${name}` : `! ${done.error}`);
  return done.ok ? 0 : 1;
}

export const snapshotCommand: Command = {
  name: "snapshot",
  summary: "archive this host's store into a local folder and an optional S3 bucket (create, list, status, check, delete)",
  usage: `snapshot ${VERBS}`,
  async run(args: ParsedArgs): Promise<number> {
    const verb = args.positional[0];
    if (verb === "create") return create(args);
    if (verb === "list") return list(args);
    if (verb === "status") return status(args);
    if (verb === "check") return check(args);
    if (verb === "delete") return remove(args);
    throw new UsageError(`snapshot needs a verb: ${VERBS}`);
  },
};
