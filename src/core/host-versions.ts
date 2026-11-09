/**
 * Which darius each host runs, from the synced ledgers (0.126.0). Each sync
 * that pushes appends one `host.version {version, compat}` line when this
 * host's newest one names another version (src/core/sync.ts), so the newest
 * such line per host is what that host last synced with. No new network
 * path: only what sync already carries.
 *
 * `darius doctor` prints one line per host (host, version, since when), a
 * warning when the hosts run different versions, and a problem when they
 * differ in sync compat: the host with the lower compat stops syncing once
 * the other one raised the bucket's floor. A host with no line is listed as
 * "unknown (before 0.126.0)" and is not compared. A host whose newest line
 * of any type is older than 30 days is left out, so a retired host does not
 * warn forever.
 */

import { existsSync } from "node:fs";

import { behindDoctorLine, readBehindRecord } from "./checkout-behind.ts";
import { readStaleRecord, staleDoctorLine } from "./reconcile-guard.ts";
import { readLedger } from "./ledger.ts";
import type { JsonValue, LedgerLine } from "./model.ts";
import { projectDir, resolveProject } from "./paths.ts";
import { GLOBAL_PROJECT, openProject, type Project } from "./store.ts";
import { HOST_VERSION_TYPE } from "./sync.ts";

/** A host whose newest line is older than this is retired for the comparison. */
export const RETIRED_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

export interface HostVersion {
  host: string;
  /** Absent for a host with no `host.version` line. */
  version?: string;
  compat?: number;
  /** When the newest `host.version` line was written. */
  since?: string;
  /** The host's newest line of any type. */
  lastSeen: string;
}

export type HostVersionLevel = "ok" | "warn" | "problem";

export interface HostVersionReport {
  hosts: HostVersion[];
  level: HostVersionLevel;
}

function isJsonText(value: JsonValue | undefined): value is string {
  return typeof value === "string";
}

function isJsonCount(value: JsonValue | undefined): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/** The newest `host.version` per active host, and how far they agree. Pure. `ledgers` may overlap; a line counts once by id. */
export function compareHostVersions(ledgers: readonly (readonly LedgerLine[])[], now: Date): HostVersionReport {
  const seen = new Set<string>();
  const byHost = new Map<string, HostVersion>();
  for (const line of ledgers.flat()) {
    if (seen.has(line.id)) continue;
    seen.add(line.id);
    const entry = byHost.get(line.host) ?? { host: line.host, lastSeen: line.at };
    if (line.at > entry.lastSeen) entry.lastSeen = line.at;
    const isVersion = line.type === HOST_VERSION_TYPE && isJsonText(line.version);
    if (isVersion && (entry.since === undefined || line.at > entry.since) && isJsonText(line.version)) {
      entry.version = line.version;
      entry.since = line.at;
      if (isJsonCount(line.compat)) entry.compat = line.compat;
      else delete entry.compat;
    }
    byHost.set(line.host, entry);
  }
  const cutoff = now.getTime() - RETIRED_AFTER_MS;
  const hosts = [...byHost.values()].filter((entry) => Date.parse(entry.lastSeen) >= cutoff).toSorted((a, b) => (a.host < b.host ? -1 : 1));
  return { hosts, level: levelOf(hosts) };
}

function levelOf(hosts: readonly HostVersion[]): HostVersionLevel {
  const known = hosts.filter((entry) => entry.version !== undefined);
  const compats = new Set(known.flatMap((entry) => (entry.compat === undefined ? [] : [entry.compat])));
  if (compats.size > 1) return "problem";
  const versions = new Set(known.map((entry) => entry.version));
  return versions.size > 1 ? "warn" : "ok";
}

function describeHost(entry: HostVersion): string {
  if (entry.version === undefined) return `${entry.host}: unknown (before 0.126.0), last seen ${entry.lastSeen}`;
  const compat = entry.compat === undefined ? "" : ` (sync compat ${String(entry.compat)})`;
  return `${entry.host}: darius ${entry.version}${compat}, since ${entry.since ?? "?"}`;
}

/** What `darius doctor` prints: one line per host, then the warning or the problem. Empty without hosts. */
export function hostVersionLines(report: HostVersionReport): string[] {
  if (report.hosts.length === 0) return [];
  const lines = report.hosts.map(describeHost);
  const known = report.hosts.filter((entry) => entry.version !== undefined);
  if (report.level === "problem") {
    const top = Math.max(...known.map((entry) => entry.compat ?? 0));
    const behind = known.filter((entry) => (entry.compat ?? 0) < top).map((entry) => entry.host);
    lines.push(`PROBLEM: the hosts differ in sync compat. Once a host with compat ${String(top)} has synced, ${behind.join(", ")} stop syncing: update them with darius update.`);
  }
  if (report.level === "warn") {
    const versions = [...new Set(known.map((entry) => entry.version))].join(", ");
    lines.push(`WARN: the hosts run different darius versions (${versions}). They still sync: their sync compat is the same. darius update --hosts brings them level.`);
  }
  return lines;
}

// --- doctor ---------------------------------------------------------------------------

/** The doctor's two sections: `## Hosts` and `## Checkout`. */
export interface SyncGuardLines {
  hosts: string[];
  checkout: string[];
}

/** The project's store, or null when the name is unknown here or it has no store on this host. */
function storeOf(name: string | undefined): Project | null {
  return name !== undefined && existsSync(projectDir(name)) ? openProject(name) : null;
}

function projectHere(cwd: string): string | undefined {
  try {
    return resolveProject(undefined, cwd);
  } catch {
    return undefined;
  }
}

/**
 * What the full `darius doctor` adds about the hosts and the checkout
 * (0.126.0): the host versions from the ledgers of the project at `cwd` and
 * of `_global`, the stale checkout the last reconcile found (0.129.0,
 * src/core/reconcile-guard.ts), and the behind check run-due recorded for
 * that project's checkout (src/core/checkout-behind.ts). Doctor fetches nothing.
 */
export function syncGuardLines(cwd: string, now: Date = new Date()): SyncGuardLines {
  const name = projectHere(cwd);
  const project = storeOf(name);
  const ledgers = [project, storeOf(GLOBAL_PROJECT)].flatMap((store) => (store === null ? [] : [readLedger(store)]));
  const hosts = hostVersionLines(compareHostVersions(ledgers, now));
  const lines = project === null ? [] : [staleDoctorLine(readStaleRecord(project)), behindDoctorLine(project.name, readBehindRecord(project))];
  return { hosts, checkout: lines.filter((line) => line !== null) };
}
