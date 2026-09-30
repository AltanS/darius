/**
 * The three JSON endpoints the web app's notification button uses
 * (src/core/push.ts; docs/concept.md, "Alerts"). They are the first writes
 * of the web page: `darius serve` calls them after its access check, and
 * they add a line to the `_global` ledger and nothing else.
 *
 *   GET  /api/push/key          { key: string | null }, the VAPID public key
 *   POST /api/push/subscribe    body: PushSubscription.toJSON();
 *                               { ok: true } | { ok: false, error }
 *   POST /api/push/unsubscribe  body: { endpoint }; same answer
 *
 * A POST must come from the page itself: its Origin names the host the
 * request went to (either scheme: a TLS proxy sends https, darius sees
 * http), or the origin of `$DARIUS_WEB_URL`. It must be JSON, at most
 * MAX_BODY bytes.
 */

import type { JsonValue } from "../core/model.ts";
import { readPushKeys, subscribe, unsubscribe, type PushResult } from "../core/push.ts";
import { GLOBAL_PROJECT, openProject } from "../core/store.ts";

export const PUSH_API_PREFIX = "/api/push/";
/** A subscription is well under 1 KB. */
export const MAX_BODY = 4096;

export interface PushApiReply {
  status: number;
  body: JsonValue;
}

function isRecord(value: JsonValue): value is { readonly [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isText(value: JsonValue | undefined): value is string {
  return typeof value === "string";
}

/** Whether the POST comes from a page of this app. */
export function isSameOrigin(headers: Headers, publicUrl: string | undefined): boolean {
  const origin = headers.get("origin");
  if (origin === null) return false;
  let from: URL;
  try {
    from = new URL(origin);
  } catch {
    return false;
  }
  if (from.protocol !== "https:" && from.protocol !== "http:") return false;
  if (from.host === headers.get("host")) return true;
  if (publicUrl === undefined || publicUrl === "") return false;
  try {
    return from.origin === new URL(publicUrl).origin;
  } catch {
    return false;
  }
}

function answer(result: PushResult): PushApiReply {
  return { status: result.ok ? 200 : 400, body: result.ok ? { ok: true } : { ok: false, error: result.error } };
}

/** One request under PUSH_API_PREFIX, already past the access check. */
export function pushApi(request: { method: string; path: string; headers: Headers; body: string }, viewer: string): PushApiReply {
  const { method, path, headers } = request;
  if (path === `${PUSH_API_PREFIX}key`) {
    if (method !== "GET" && method !== "HEAD") return { status: 405, body: { ok: false, error: "GET only" } };
    return { status: 200, body: { key: readPushKeys()?.public ?? null } };
  }
  const isSubscribe = path === `${PUSH_API_PREFIX}subscribe`;
  if (!isSubscribe && path !== `${PUSH_API_PREFIX}unsubscribe`) return { status: 404, body: { ok: false, error: "no such endpoint" } };
  if (method !== "POST") return { status: 405, body: { ok: false, error: "POST only" } };
  if (!isSameOrigin(headers, process.env.DARIUS_WEB_URL?.trim())) return { status: 403, body: { ok: false, error: "the request must come from the darius page" } };
  if (!(headers.get("content-type") ?? "").startsWith("application/json")) return { status: 415, body: { ok: false, error: "send JSON" } };
  if (request.body.length > MAX_BODY) return { status: 413, body: { ok: false, error: "too large" } };
  let parsed: JsonValue;
  try {
    parsed = JSON.parse(request.body);
  } catch {
    return { status: 400, body: { ok: false, error: "not valid JSON" } };
  }
  const global = openProject(GLOBAL_PROJECT, { create: true });
  if (isSubscribe) return answer(subscribe(global, parsed, viewer));
  if (!isRecord(parsed) || !isText(parsed.endpoint)) return { status: 400, body: { ok: false, error: "send { endpoint }" } };
  return answer(unsubscribe(global, parsed.endpoint));
}
