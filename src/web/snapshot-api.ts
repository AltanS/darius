/**
 * The JSON endpoints of the status page's backup controls
 * (docs/concept.md, "Snapshots"). They are the first writes of the page that
 * change darius's behaviour, so each one has its guards, and `darius serve`
 * calls them only after its access check:
 *
 *   POST /api/snapshots/run                 start a snapshot in a detached `darius snapshot create`
 *   POST /api/snapshots/settings            body { values: { key: value | null } }; null clears a key
 *   POST /api/snapshots/credentials         body { accessKeyId, secretAccessKey }; write-only
 *   POST /api/snapshots/credentials/clear   remove the saved key pair
 *   POST /api/snapshots/check               list the bucket, write and delete a probe object
 *   POST /api/snapshots/delete              body { name, where: "local" | "remote" }
 *
 * Every answer is `{ ok: true, ... }` or `{ ok: false, error }`. A request
 * must come from the page itself (its Origin names the host it went to, or
 * `$DARIUS_WEB_URL`), be JSON, and be at most MAX_BODY bytes. A key set by
 * the environment cannot be changed here, nor a key pair it sets. The access key pair goes into
 * `<config>/snapshot-credentials` (0600) and comes back nowhere: no answer, no
 * page and no log line holds it. Restoring is not here: it overwrites the
 * store, so it stays a `tar -xzf` by hand.
 */

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { hostId } from "../core/ledger.ts";
import type { JsonValue } from "../core/model.ts";
import { checkRemote, deleteLocalSnapshot, deleteRemoteSnapshot, runningSnapshot } from "../core/snapshot.ts";
import { applySnapshotSettings, removeSnapshotCredentials, resolveSnapshotSettings, saveSnapshotCredentials, type RawSetting } from "../core/snapshot-settings.ts";
import { errorMessage } from "../runtime.ts";
import { MAX_BODY, isSameOrigin, type PushApiReply } from "./push-api.ts";

export const SNAPSHOT_API_PREFIX = "/api/snapshots/";

/** Starts `darius snapshot create` as a separate process, so the page stays responsive for a long run. */
export type RunStarter = () => void;

const CLI = fileURLToPath(new URL("../../bin/darius", import.meta.url));

export const startDetachedRun: RunStarter = () => {
  const child = spawn(CLI, ["snapshot", "create"], { detached: true, stdio: "ignore" });
  child.on("error", (cause) => {
    console.error(`darius serve: could not start a snapshot: ${errorMessage(cause)}`);
  });
  child.unref();
};

function isRecord(value: JsonValue | undefined): value is { readonly [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isText(value: JsonValue | undefined): value is string {
  return typeof value === "string";
}

function isRaw(value: JsonValue): value is string | number | boolean | null {
  return value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function fail(status: number, error: string): PushApiReply {
  return { status, body: { ok: false, error } };
}

function done(extra: { readonly [key: string]: JsonValue } = {}): PushApiReply {
  return { status: 200, body: { ok: true, ...extra } };
}

function saveSettings(body: { readonly [key: string]: JsonValue }): PushApiReply {
  const values = body.values;
  if (!isRecord(values)) return fail(400, "send { values: { key: value } }");
  const input = new Map<string, RawSetting>();
  for (const [key, value] of Object.entries(values)) {
    if (!isRaw(value)) return fail(400, `${key} must be text, a number, true, false or null`);
    input.set(key, value);
  }
  const applied = applySnapshotSettings(input);
  if (!applied.ok) return fail(applied.failed === "write" ? 500 : 400, applied.errors.join("; "));
  return done();
}

function saveCredentials(body: { readonly [key: string]: JsonValue }): PushApiReply {
  const id = body.accessKeyId;
  const secret = body.secretAccessKey;
  if (!isText(id) || !isText(secret)) return fail(400, "send { accessKeyId, secretAccessKey }");
  const saved = saveSnapshotCredentials(id, secret);
  return saved.ok ? done() : fail(400, saved.error);
}

function clearCredentials(): PushApiReply {
  const cleared = removeSnapshotCredentials();
  return cleared.ok ? done() : fail(400, cleared.error);
}

function startRun(start: RunStarter): PushApiReply {
  const resolved = resolveSnapshotSettings();
  if (resolved.problems.length > 0) return fail(400, `fix the settings first: ${resolved.problems.join("; ")}`);
  if (!resolved.settings.enabled) return fail(400, "snapshots are off on this host");
  if (runningSnapshot(resolved.settings.dir) !== null) return fail(409, "a snapshot is already running");
  start();
  return { status: 202, body: { ok: true, started: true } };
}

async function deleteOne(body: { readonly [key: string]: JsonValue }): Promise<PushApiReply> {
  const name = body.name;
  const where = body.where;
  if (!isText(name) || (where !== "local" && where !== "remote")) return fail(400, 'send { name, where: "local" | "remote" }');
  const resolved = resolveSnapshotSettings();
  const result = where === "local" ? deleteLocalSnapshot(resolved.settings.dir, name) : await deleteRemoteSnapshot(resolved, hostId(), name);
  return result.ok ? done() : fail(400, result.error);
}

export interface SnapshotRequest {
  method: string;
  path: string;
  headers: Headers;
  body: string;
}

/** One request under SNAPSHOT_API_PREFIX, already past the access check. */
export async function snapshotApi(request: SnapshotRequest, start: RunStarter = startDetachedRun): Promise<PushApiReply> {
  const route = request.path.slice(SNAPSHOT_API_PREFIX.length);
  const known = ["run", "settings", "credentials", "credentials/clear", "check", "delete"];
  if (!known.includes(route)) return fail(404, "no such endpoint");
  if (request.method !== "POST") return fail(405, "POST only");
  if (!isSameOrigin(request.headers, process.env.DARIUS_WEB_URL?.trim())) return fail(403, "the request must come from the darius page");
  if (!(request.headers.get("content-type") ?? "").startsWith("application/json")) return fail(415, "send JSON");
  if (request.body.length > MAX_BODY) return fail(413, "too large");
  let parsed: JsonValue;
  try {
    parsed = JSON.parse(request.body === "" ? "{}" : request.body);
  } catch {
    return fail(400, "not valid JSON");
  }
  if (!isRecord(parsed)) return fail(400, "send a JSON object");

  if (route === "run") return startRun(start);
  if (route === "settings") return saveSettings(parsed);
  if (route === "credentials") return saveCredentials(parsed);
  if (route === "credentials/clear") return clearCredentials();
  if (route === "delete") return deleteOne(parsed);
  const checked = await checkRemote(resolveSnapshotSettings(), hostId());
  return checked.ok ? done({ count: checked.objects.length }) : fail(400, checked.error ?? "the check failed");
}
