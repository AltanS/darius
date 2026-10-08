/**
 * The dead-man ping of `snapshot create` (docs/backups.md, "Alarms").
 *
 * When `ping_url` is set, a finished run does one GET to it, in the style of
 * healthchecks: the address itself after a good run (a local archive, and the
 * bucket copy done or not asked for), and `<address>/fail` after any other
 * result. There is no `/start`. A run with `--no-upload` on a host with a
 * bucket sends nothing: it says nothing about the bucket copy. A service that expects a ping every day tells
 * the operator when the pings stop, which covers the case where the whole mesh
 * is down and no host can send a push.
 *
 * The address is a capability: whoever has it can fake a ping. So no message
 * from this module holds it. A failure names the host and a reason with the
 * address and its path cut out. A failed ping is a warning in the run's result
 * and never changes the exit code.
 */

import { errorMessage } from "../runtime.ts";
import { scrubForLedger } from "./redact.ts";
import type { SnapshotRunResult } from "./snapshot.ts";

export const PING_TIMEOUT_MS = 10_000;

export type PingKind = "ok" | "fail";

/** What the ping for this result is. `ok` needs a done run and no failed bucket copy. */
export function pingKindFor(result: Pick<SnapshotRunResult, "code" | "remote">): PingKind {
  return result.code === 0 && (result.remote === null || result.remote.ok) ? "ok" : "fail";
}

/** The address to GET: the ping URL, or the ping URL plus `/fail`. */
export function pingTarget(url: string, kind: PingKind): string {
  const base = url.replace(/\/+$/u, "");
  return kind === "ok" ? base : `${base}/fail`;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "the ping address";
  }
}

export interface PingOptions {
  /** For a test; a run waits 10 seconds. */
  timeoutMs?: number;
}

/**
 * Sends one ping. Returns a warning when it failed, else null. Never throws.
 * Redirects are refused, so the address never travels to another host.
 */
export async function sendPing(url: string, kind: PingKind, options: PingOptions = {}): Promise<string | null> {
  const where = hostOf(url);
  try {
    const response = await fetch(pingTarget(url, kind), {
      method: "GET",
      redirect: "error",
      signal: AbortSignal.timeout(options.timeoutMs ?? PING_TIMEOUT_MS),
    });
    await response.body?.cancel();
    if (response.ok) return null;
    return `the ${kind === "ok" ? "dead-man" : "dead-man fail"} ping to ${where} answered HTTP ${String(response.status)}`;
  } catch (cause) {
    return `the ${kind === "ok" ? "dead-man" : "dead-man fail"} ping to ${where} failed: ${scrubForLedger(errorMessage(cause), [url, pingTarget(url, "fail")])}`;
  }
}
