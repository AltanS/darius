/**
 * The machine and the store, for the web status page (0.44.0). Read-only:
 * nothing here writes, syncs, locks or reaches the network. The one slow
 * part, the walk over the state dir, is remembered for a minute.
 */

import { existsSync, lstatSync, readdirSync, statfsSync, statSync } from "node:fs";
import { freemem, loadavg, totalmem, uptime } from "node:os";
import { basename, dirname, join } from "node:path";

import { loadConfigIfPresent } from "../core/config.ts";
import { hostId, listChunks, readLedger } from "../core/ledger.ts";
import { readLegacyMilestonesAt } from "../core/legacy-milestones.ts";
import { linkedDir } from "../core/links.ts";
import { projectDir, stateDir } from "../core/paths.ts";
import { listProjects, openProject } from "../core/store.ts";
import { ulidTime } from "../core/ulid.ts";
import { VERSION } from "../version.ts";
import type { SystemDisk, SystemHost, SystemProject, SystemStatus } from "./api.ts";
import { lastSync, trackerDirOf } from "./status.ts";

const WALK_TTL_MS = 60_000;

export interface SystemOptions {
  /** The snapshot directory; when set, a `backups` disk is listed. */
  backupDir?: string;
  /** The clock for the walk cache, in milliseconds; tests pass their own. */
  now?: number;
}

interface Walk {
  bytes: number;
  files: number;
  /** Bytes per top-level entry of the state dir. */
  byEntry: Map<string, number>;
}

let cached: { readonly dir: string; readonly at: number; readonly walk: Walk } | null = null;

/** Forgets the remembered store walk. For tests. */
export function resetSystemCache(): void {
  cached = null;
}

/** Sums the regular files under `root`. Uses lstat, never follows links, skips what it cannot read. */
function sumFiles(root: string): Pick<Walk, "bytes" | "files"> {
  let bytes = 0;
  let files = 0;
  const pending = [root];
  for (let dir = pending.pop(); dir !== undefined; dir = pending.pop()) {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      const path = join(dir, name);
      try {
        const stats = lstatSync(path);
        if (stats.isDirectory()) pending.push(path);
        else if (stats.isFile()) {
          bytes += stats.size;
          files += 1;
        }
      } catch {
        continue;
      }
    }
  }
  return { bytes, files };
}

function walkState(root: string): Walk {
  const walk: Walk = { bytes: 0, files: 0, byEntry: new Map() };
  let names: string[];
  try {
    names = readdirSync(root);
  } catch {
    return walk;
  }
  for (const name of names) {
    const path = join(root, name);
    try {
      const stats = lstatSync(path);
      if (stats.isFile()) {
        walk.bytes += stats.size;
        walk.files += 1;
      } else if (stats.isDirectory()) {
        const sum = sumFiles(path);
        walk.bytes += sum.bytes;
        walk.files += sum.files;
        walk.byEntry.set(name, sum.bytes);
      }
    } catch {
      continue;
    }
  }
  return walk;
}

function storeWalk(root: string, now: number): Walk {
  if (cached !== null && cached.dir === root && now - cached.at < WALK_TTL_MS && now >= cached.at) return cached.walk;
  const walk = walkState(root);
  cached = { dir: root, at: now, walk };
  return walk;
}

function systemProject(name: string, walk: Walk): SystemProject & { milestones: number; specs: number } {
  const row = { project: name, lastSync: lastSync(name), rituals: 0, vigils: 0, profiles: 0, runs: 0, bytes: walk.byEntry.get(name) ?? 0, milestones: 0, specs: 0 };
  try {
    const project = openProject(name);
    row.rituals = project.listItems("ritual").length;
    row.vigils = project.listItems("vigil").length;
    row.profiles = project.listItems("profile").length;
    row.runs = readLedger(project).filter((line) => line.type === "run.started").length;
  } catch {
    // A broken project still shows up, with what could be read.
  }
  try {
    const trackerDir = trackerDirOf(name, linkedDir(name) ?? null);
    if (trackerDir !== null) {
      const { milestones } = readLegacyMilestonesAt(trackerDir);
      row.milestones = milestones.length;
      row.specs = milestones.reduce((sum, milestone) => sum + milestone.specs.length, 0);
    }
  } catch {
    // The linked checkout is gone or unreadable.
  }
  return row;
}

function chunkTime(name: string): number | null {
  try {
    return ulidTime(basename(name, ".jsonl"));
  } catch {
    return null;
  }
}

function newer(current: number | null, time: number | null): number | null {
  return time !== null && (current === null || time > current) ? time : current;
}

function collectHosts(projects: readonly string[], self: string): SystemHost[] {
  const seen = new Map<string, { newest: number | null; chunks: number; projects: Set<string> }>();
  const entry = (host: string) => {
    let found = seen.get(host);
    if (found === undefined) {
      found = { newest: null, chunks: 0, projects: new Set() };
      seen.set(host, found);
    }
    return found;
  };
  entry(self);
  for (const name of projects) {
    try {
      for (const chunk of listChunks(openProject(name))) {
        const host = entry(chunk.host);
        host.chunks += 1;
        host.projects.add(name);
        host.newest = newer(host.newest, chunkTime(chunk.name));
      }
    } catch {
      continue;
    }
    try {
      const open = statSync(join(projectDir(name), "ledger", self, "open.jsonl"), { throwIfNoEntry: false });
      if (open !== undefined) entry(self).newest = newer(entry(self).newest, open.mtimeMs);
    } catch {
      continue;
    }
  }
  const hosts = [...seen.entries()].map(([host, data]): SystemHost => ({
    host,
    self: host === self,
    lastSeen: data.newest === null ? null : new Date(data.newest).toISOString(),
    chunks: data.chunks,
    projects: [...data.projects].toSorted(),
  }));
  return hosts.toSorted((left, right) => {
    if (left.self !== right.self) return left.self ? -1 : 1;
    return (right.lastSeen ?? "").localeCompare(left.lastSeen ?? "");
  });
}

/** The volume under `path`, or under its nearest existing parent; null when none answers. */
function diskFor(label: string, path: string): SystemDisk | null {
  let probe = path;
  for (;;) {
    try {
      if (existsSync(probe)) {
        const stats = statfsSync(probe);
        return { label, path, freeBytes: stats.bavail * stats.bsize, totalBytes: stats.blocks * stats.bsize };
      }
    } catch {
      // Try the parent.
    }
    const parent = dirname(probe);
    if (parent === probe) return null;
    probe = parent;
  }
}

function syncRemote(): SystemStatus["syncRemote"] {
  try {
    const remote = loadConfigIfPresent()?.remote;
    return remote === undefined ? null : { endpoint: remote.endpoint, bucket: remote.bucket };
  } catch {
    return null;
  }
}

export function collectSystem(options: SystemOptions = {}): SystemStatus {
  const root = stateDir();
  const self = hostId();
  const walk = storeWalk(root, options.now ?? Date.now());
  const names = listProjects();
  const rows = names.map((name) => systemProject(name, walk));
  const disks = [diskFor("store", root), options.backupDir === undefined ? null : diskFor("backups", options.backupDir)].filter((disk) => disk !== null);
  const [one = 0, five = 0, fifteen = 0] = loadavg();
  const sum = (pick: (row: (typeof rows)[number]) => number): number => rows.reduce((total, row) => total + pick(row), 0);
  const bun = process.versions.bun;
  return {
    host: self,
    version: VERSION,
    runtime: bun === undefined ? `node ${process.versions.node}` : `bun ${bun}`,
    platform: `${process.platform} ${process.arch}`,
    generatedAt: new Date().toISOString(),
    uptimeSeconds: Math.floor(uptime()),
    load: [one, five, fifteen],
    memory: { totalBytes: totalmem(), freeBytes: freemem() },
    disks,
    store: {
      path: root,
      bytes: walk.bytes,
      files: walk.files,
      projects: names.length,
      rituals: sum((row) => row.rituals),
      vigils: sum((row) => row.vigils),
      profiles: sum((row) => row.profiles),
      runs: sum((row) => row.runs),
      milestones: sum((row) => row.milestones),
      specs: sum((row) => row.specs),
    },
    hosts: collectHosts(names, self),
    projects: rows.map(({ milestones: _milestones, specs: _specs, ...project }) => project),
    syncRemote: syncRemote(),
  };
}
