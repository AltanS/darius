/**
 * The daily sweep lease behind `darius vigil sweep --daily`, the command the
 * timer runs. Each project is swept at most once per local day, by whichever
 * host takes `<project>/leases/sweep-<YYYY-MM-DD>.json` first. The winner
 * marks the lease done when its sweep ends; every later host that day sees
 * `lease-done` and skips the project. So any number of hosts can run the
 * sweep timer. A lease whose holder died expires after SWEEP_LEASE_TTL_MS and
 * can then be taken over (src/core/lease.ts).
 *
 * A one-vigil sweep (`vigil sweep <slug>`) never takes that lease: finishing it
 * would mark the day done and stop the daily sweep. It reads the daily lease and
 * stands aside while another sweep holds it, then takes
 * `<project>/leases/vigil-<slug>.json` for its own run and releases it at the end.
 *
 * The date is the host's local date, like the sweep's own `today`. Hosts in
 * different time zones use different keys around midnight and can then both
 * sweep; the same-zone hosts this runs on today never do.
 */

import { readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";

import { errorMessage } from "../runtime.ts";
import { isLeaseStale, readLease, takeLease, type LeaseOutcome } from "./lease.ts";
import { S3NetworkError, type S3 } from "./s3.ts";
import type { Project } from "./store.ts";
import { localToday } from "./sweep.ts";

/** Long enough for a slow sweep: 60 vigils at the 120 s Command timeout is 2 hours. */
export const SWEEP_LEASE_TTL_MS = 3 * 60 * 60_000;
/** Sweep leases older than this many days are deleted after a sweep. */
const KEEP_DAYS = 2;
const SWEEP_LEASE_NAME = /(?:^|\/)sweep-(\d{4}-\d{2}-\d{2})\.(?:json|lock)$/u;

function leaseDir(project: Project): string {
  return join(project.root, "leases");
}

function dailyLease(project: Project, today: string) {
  return { key: `${project.name}/leases/sweep-${today}.json`, file: join(leaseDir(project), `sweep-${today}.lock`) };
}

export function takeSweepLease(project: Project, target: { s3: S3 | null; host: string; today: string }): Promise<LeaseOutcome> {
  return takeLease({
    ...dailyLease(project, target.today),
    s3: target.s3,
    host: target.host,
    ttlMs: SWEEP_LEASE_TTL_MS,
  });
}

/** The TTL of a one-vigil sweep: every Command may run to its timeout, plus a minute for the kills and the writes. */
export function vigilLeaseTtlMs(commands: number, timeoutMs: number): number {
  return Math.max(1, commands) * timeoutMs + 60_000;
}

/**
 * The lease of a one-vigil sweep. Blocked while today's daily sweep is held and
 * not done, or while another one-vigil sweep of the same vigil runs. Never
 * writes the daily lease. The caller releases the handle.
 */
export async function takeVigilSweepLease(
  project: Project,
  target: { s3: S3 | null; host: string; today: string; slug: string; ttlMs: number },
): Promise<LeaseOutcome> {
  try {
    const daily = await readLease({ ...dailyLease(project, target.today), s3: target.s3 });
    if (daily !== null && daily.done !== true && !isLeaseStale(daily, target.host)) {
      return { blocked: "lease-held", detail: `the daily sweep runs on ${daily.host}` };
    }
  } catch (cause) {
    if (cause instanceof S3NetworkError) return { blocked: "lease-offline", detail: errorMessage(cause) };
    throw cause;
  }
  const taken = await takeLease({
    key: `${project.name}/leases/vigil-${target.slug}.json`,
    file: join(leaseDir(project), `vigil-${target.slug}.lock`),
    s3: target.s3,
    host: target.host,
    ttlMs: target.ttlMs,
  });
  if ("handle" in taken || taken.blocked !== "lease-held") return taken;
  return { blocked: "lease-held", detail: `a check of '${target.slug}' is already running (${taken.detail})` };
}

function isOld(name: string, cutoff: string): boolean {
  const date = SWEEP_LEASE_NAME.exec(name)?.[1];
  return date !== undefined && date < cutoff;
}

/** `YYYY-MM-DD`, KEEP_DAYS before `today`. */
function cutoffDate(today: string): string {
  const date = new Date(`${today}T12:00:00`);
  date.setDate(date.getDate() - KEEP_DAYS);
  return localToday(date);
}

/** Deletes finished sweep leases of past days. Best effort: a failure only leaves a small object behind. */
export async function pruneSweepLeases(project: Project, target: { s3: S3 | null; today: string }): Promise<void> {
  const cutoff = cutoffDate(target.today);
  try {
    if (target.s3 === null) {
      const old = readdirSync(leaseDir(project)).filter((name) => isOld(name, cutoff));
      for (const name of old) unlinkSync(join(leaseDir(project), name));
      return;
    }
    const listed = await target.s3.list(`${project.name}/leases/sweep-`);
    for (const object of listed.filter((one) => isOld(one.key, cutoff))) await target.s3.del(object.key);
  } catch {
    // A lease left behind costs nothing; the next sweep tries again.
  }
}
