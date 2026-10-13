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
 * `<project>/leases/vigil-<slug>.json` for its own run. At the end it keeps
 * that lease as a 2 minute cooldown (0.86.2), so a check on another host
 * cannot repeat it at once; `--force` takes the cooldown over. The local
 * ledger cooldown stays as the first check, but it sees only lines of this
 * host and lines already pulled.
 *
 * The daily sweep reads the `vigil-` leases once per project (one LIST, one
 * GET per lease) and leaves out every vigil a one-vigil check holds on any
 * host (0.86.2). That check writes its own lines.
 *
 * The date is the host's local date, like the sweep's own `today`. Hosts in
 * different time zones use different keys around midnight and can then both
 * sweep; the same-zone hosts this runs on today never do.
 */

import { readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";

import { errorMessage } from "../runtime.ts";
import { isLeaseStale, readLease, takeLease, type LeaseHandle, type LeaseOutcome } from "./lease.ts";
import { S3NetworkError, type S3 } from "./s3.ts";
import type { Project } from "./store.ts";
import { localToday, SWEEP_COOLDOWN_MS } from "./sweep.ts";

/** Long enough for a slow sweep: 60 vigils at the 120 s Command timeout is 2 hours. */
export const SWEEP_LEASE_TTL_MS = 3 * 60 * 60_000;
/** Sweep leases older than this many days are deleted after a sweep. */
const KEEP_DAYS = 2;
const SWEEP_LEASE_NAME = /(?:^|\/)sweep-(\d{4}-\d{2}-\d{2})\.(?:json|lock)$/u;
const VIGIL_LEASE_NAME = /(?:^|\/)vigil-(.+)\.(?:json|lock)$/u;

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
 * not done, while another one-vigil sweep of the same vigil runs, and during
 * the cooldown after one (`force` lifts the cooldown only). Never writes the
 * daily lease. The caller ends the handle with `coolVigilSweepLease`.
 */
export async function takeVigilSweepLease(
  project: Project,
  target: { s3: S3 | null; host: string; today: string; slug: string; ttlMs: number; force?: boolean },
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
    force: target.force === true,
  });
  if ("handle" in taken) return taken;
  if (taken.blocked === "lease-cooldown") {
    return { blocked: "lease-cooldown", detail: `vigil '${target.slug}' was checked less than 2 minutes ago (${taken.detail}); wait or pass --force` };
  }
  if (taken.blocked !== "lease-held") return taken;
  return { blocked: "lease-held", detail: `a check of '${target.slug}' is already running (${taken.detail})` };
}

/** Ends a one-vigil sweep's lease: it stays as a cooldown for SWEEP_COOLDOWN_MS. */
export function coolVigilSweepLease(handle: LeaseHandle): Promise<void> {
  return handle.cool(SWEEP_COOLDOWN_MS);
}

/**
 * The vigils whose one-vigil check runs now on some host: slug to a line that
 * says where. A cooldown lease does not count: its check has ended. Best
 * effort: when the leases cannot be read the map is empty, and the daily
 * sweep runs every vigil as it did before 0.86.2.
 */
export async function heldVigilChecks(project: Project, target: { s3: S3 | null; host: string }): Promise<Map<string, string>> {
  const held = new Map<string, string>();
  try {
    const names = target.s3 === null ? readdirSync(leaseDir(project)) : (await target.s3.list(`${project.name}/leases/vigil-`)).map((object) => object.key);
    for (const name of names) {
      const slug = VIGIL_LEASE_NAME.exec(name)?.[1];
      if (slug === undefined) continue;
      const lease = await readLease({ key: name, file: join(leaseDir(project), name), s3: target.s3 });
      if (lease === null || lease.cooldown === true || isLeaseStale(lease, target.host)) continue;
      held.set(slug, `a check of '${slug}' runs on ${lease.host} until ${lease.expires} at the latest`);
    }
  } catch {
    // Unreadable leases: sweep every vigil, as before.
  }
  return held;
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
