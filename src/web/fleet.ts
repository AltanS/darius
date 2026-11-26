/**
 * The hosts of the synced store (0.139.0): the live facts of this host, the
 * body of `GET /api/host.json`, and what the ledgers here say about every
 * host: its version history, its newest box check, the runs open on it,
 * and where each ritual and vigil last ran. Read-only: nothing here writes,
 * syncs or reaches the network. The probe of the other hosts is
 * src/web/peers.ts.
 */

import { loadavg, uptime } from "node:os";

import { ritualState } from "../core/due.ts";
import { RETIRED_AFTER_MS } from "../core/host-versions.ts";
import { hostId, linesBy, readLedgerShared } from "../core/ledger.ts";
import type { JsonValue, LedgerLine, Ritual } from "../core/model.ts";
import { listProjects, openProject } from "../core/store.ts";
import { HOST_VERSION_TYPE } from "../core/sync.ts";
import { globalLedger, newestBoxChecks } from "../runner/box-check.ts";
import { isBun } from "../runtime.ts";
import { VERSION } from "../version.ts";
import type { FleetHost, FleetLast, FleetRun, FleetView, RunRow, HostBoxCheck, HostDue, HostLive, HostOpenRun, HostVersionStep } from "./api.ts";
import { readHostBackupStates } from "./backups.ts";
import { runRowsShared } from "./status.ts";
import { collectHosts } from "./system.ts";

const NEXT_DUE_MAX = 10;

/** How many runs per host the fleet view keeps (0.142.0): the "Recent runs here" list of a machine page. */
export const FLEET_RECENT_RUNS = 15;

let serveStartedAt: string | null = null;

/** `darius serve` calls this when it listens: `/api/host.json` then says since when it serves. */
export function markServeStarted(at: Date = new Date()): void {
  serveStartedAt = at.toISOString();
}

interface ProjectLedger {
  name: string;
  /** The shared array of `readLedgerShared`: read only. */
  lines: readonly LedgerLine[];
}

/** The ledger of every project here; a project that cannot be read adds none. */
function projectLedgers(): ProjectLedger[] {
  return listProjects().flatMap((name) => {
    try {
      return [{ name, lines: readLedgerShared(openProject(name)) }];
    } catch {
      return [];
    }
  });
}

function isText(value: JsonValue | undefined): value is string {
  return typeof value === "string";
}

interface RunState {
  run: string;
  item: string;
  host: string;
  startedAt: string;
  phase: "running" | "held" | "closed";
  outcome: string | null;
}

/** Every run of a ledger with its phase, by the same rule as `viewRun`: the host is the one of its newest start or resume. */
export function runStates(lines: readonly LedgerLine[]): RunState[] {
  const runs = new Map<string, RunState>();
  for (const line of lines) {
    const id = line.run;
    if (!isText(id)) continue;
    if (line.type === "run.started") {
      runs.set(id, { run: id, item: line.item ?? "", host: line.host, startedAt: line.at, phase: "running", outcome: null });
      continue;
    }
    const state = runs.get(id);
    if (state === undefined) continue;
    if (line.type === "run.resumed") {
      state.phase = "running";
      state.host = line.host;
    }
    if (line.type === "run.held") state.phase = "held";
    if (line.type === "run.completed") {
      state.phase = "closed";
      state.outcome = isText(line.outcome) ? line.outcome : null;
    }
  }
  return [...runs.values()];
}

function openRunsOf(ledgers: readonly ProjectLedger[]): (HostOpenRun & { host: string })[] {
  return ledgers
    .flatMap(({ name, lines }) =>
      runStates(lines).flatMap((state) => (state.phase === "closed" ? [] : [{ run: state.run, project: name, item: state.item, phase: state.phase, startedAt: state.startedAt, host: state.host }])),
    )
    .toSorted((left, right) => right.startedAt.localeCompare(left.startedAt));
}

/** The `_global` ledger, or none when it cannot be read: the pages still show the rest. */
function safeGlobal(): LedgerLine[] {
  try {
    return globalLedger();
  } catch {
    return [];
  }
}

/** The newest box check per host, from the `_global` ledger. */
function boxChecks(global: readonly LedgerLine[]): Map<string, HostBoxCheck> {
  const checks = new Map<string, HostBoxCheck>();
  // newestBoxChecks is newest first: the first entry per host wins.
  for (const entry of newestBoxChecks(global)) {
    if (!checks.has(entry.host)) checks.set(entry.host, { outcome: entry.outcome, at: entry.at, darius: entry.darius });
  }
  return checks;
}

/** The active rituals pinned to `host`, soonest first. */
function pinnedDue(ledgers: readonly ProjectLedger[], host: string, now: Date): HostDue[] {
  const due = ledgers.flatMap(({ name, lines }): HostDue[] => {
    try {
      const project = openProject(name);
      // Grouped once per project, on the first pinned ritual: `ritualState` reads only the ritual's own lines.
      let byItem: Map<string, LedgerLine[]> | null = null;
      return project.listItems("ritual").flatMap((slug): HostDue[] => {
        const doc = project.readItem<Ritual>("ritual", slug);
        if (doc === null || doc.header.host !== host) return [];
        byItem ??= linesBy(lines, "item");
        const state = ritualState(doc, byItem.get(`ritual/${doc.header.slug}`) ?? [], { now });
        return state.lifecycle === "active" ? [{ project: name, slug, nextDueAt: state.nextDueAt ?? null }] : [];
      });
    } catch {
      return [];
    }
  });
  return due.toSorted((left, right) => (left.nextDueAt ?? "~").localeCompare(right.nextDueAt ?? "~")).slice(0, NEXT_DUE_MAX);
}

/** This host's live facts: the body of `GET /api/host.json`. No path, no environment. */
export function collectHostLive(now: Date = new Date()): HostLive {
  const self = hostId();
  const ledgers = projectLedgers();
  const [one = 0, five = 0, fifteen = 0] = loadavg();
  return {
    host: self,
    version: VERSION,
    runtime: isBun ? "bun" : "node",
    runtimeVersion: (isBun ? process.versions.bun : process.versions.node) ?? "",
    serveStartedAt,
    now: now.toISOString(),
    uptimeSeconds: Math.floor(uptime()),
    load: [one, five, fifteen],
    openRuns: openRunsOf(ledgers)
      .filter((run) => run.host === self)
      .map(({ host: _host, ...run }) => run),
    boxCheck: boxChecks(safeGlobal()).get(self) ?? null,
    nextDue: pinnedDue(ledgers, self, now),
  };
}

/** Per host: its `host.version` lines newest first, and its newest line of any type. Lines count once by id. */
function hostLines(ledgers: readonly (readonly LedgerLine[])[]): Map<string, { newest: string; versions: HostVersionStep[] }> {
  const seen = new Set<string>();
  const byHost = new Map<string, { newest: string; versions: HostVersionStep[] }>();
  for (const line of ledgers.flat()) {
    if (seen.has(line.id)) continue;
    seen.add(line.id);
    const entry = byHost.get(line.host) ?? { newest: line.at, versions: [] };
    if (line.at > entry.newest) entry.newest = line.at;
    if (line.type === HOST_VERSION_TYPE && isText(line.version)) entry.versions.push({ version: line.version, at: line.at });
    byHost.set(line.host, entry);
  }
  for (const entry of byHost.values()) entry.versions.sort((left, right) => right.at.localeCompare(left.at));
  return byHost;
}

function newerIso(left: string | null, right: string | undefined): string | null {
  if (right === undefined) return left;
  return left === null || right > left ? right : left;
}

/** The newest entry per item of a project. */
function newestPerItem(candidates: readonly FleetLast[]): FleetLast[] {
  const newest = new Map<string, FleetLast>();
  for (const entry of candidates) {
    const key = `${entry.project}\u0000${entry.item}`;
    const current = newest.get(key);
    if (current === undefined || entry.at > current.at) newest.set(key, entry);
  }
  return [...newest.values()];
}

/** The newest runs of each host, at most `FLEET_RECENT_RUNS` per host, newest first; imported runs left out. The run rows come from the shared scan of the status read. */
export function recentRunsByHost(ledgers: readonly ProjectLedger[], max: number = FLEET_RECENT_RUNS): FleetRun[] {
  // The rows of a project are newest first: keep at most `max` per host of each project, then merge.
  const newestOf = (name: string, rows: readonly RunRow[]): FleetRun[] => {
    const kept = new Map<string, number>();
    const out: FleetRun[] = [];
    for (const row of rows) {
      if (row.who === "import") continue;
      const seen = kept.get(row.host) ?? 0;
      if (seen >= max) continue;
      kept.set(row.host, seen + 1);
      out.push(Object.assign({ project: name }, row));
    }
    return out;
  };
  const all = ledgers.flatMap(({ name, lines }) => newestOf(name, runRowsShared(lines))).toSorted((left, right) => right.startedAt.localeCompare(left.startedAt));
  const count = new Map<string, number>();
  return all.filter((run) => {
    const seen = count.get(run.host) ?? 0;
    count.set(run.host, seen + 1);
    return seen < max;
  });
}

/** The hosts of the store and where things ran. A host whose newest line or chunk is older than 30 days is `retired`; this host never is. */
export function collectFleet(now: Date = new Date()): FleetView {
  const self = hostId();
  const ledgers = projectLedgers();
  const global = safeGlobal();
  const lines = hostLines([global, ...ledgers.map((ledger) => ledger.lines)]);
  const checks = boxChecks(global);
  const cutoff = now.getTime() - RETIRED_AFTER_MS;
  const systemHosts = collectHosts(
    ledgers.map((ledger) => ledger.name),
    self,
    readHostBackupStates(now.getTime()),
  );
  const known = new Set(systemHosts.map((host) => host.host));
  // A host that only wrote `_global` lines (no chunk of a project here) still counts.
  const extra = [...lines.keys()].filter((host) => !known.has(host)).map((host) => ({ host, self: false, lastSeen: null, chunks: 0, projects: [], backup: null }));
  const hosts = [...systemHosts, ...extra]
    .map((host): FleetHost => {
      const own = lines.get(host.host);
      const versions = own?.versions ?? [];
      const lastSeen = newerIso(host.lastSeen, own?.newest);
      const retired = !host.self && (lastSeen === null || Date.parse(lastSeen) < cutoff);
      return Object.assign({}, host, { lastSeen, version: versions[0]?.version ?? (host.self ? VERSION : null), versions, boxCheck: checks.get(host.host) ?? null, retired });
    });
  const lastRuns = newestPerItem(
    ledgers.flatMap(({ name, lines: projectLines }) =>
      runStates(projectLines)
        .filter((state) => state.item.startsWith("ritual/"))
        .map((state): FleetLast => Object.assign({ project: name, item: state.item, host: state.host, at: state.startedAt, outcome: state.outcome, run: state.run }, state.phase === "closed" ? {} : { phase: state.phase })),
    ),
  );
  const lastSweeps = newestPerItem(
    ledgers.flatMap(({ name, lines: projectLines }) =>
      projectLines
        .filter((line) => line.type === "vigil.swept" && line.outcome !== "skipped" && line.item !== undefined)
        .map((line): FleetLast => ({ project: name, item: line.item ?? "", host: line.host, at: line.at, outcome: isText(line.outcome) ? line.outcome : null })),
    ),
  );
  return { self, generatedAt: now.toISOString(), hosts, lastRuns, lastSweeps, openRuns: openRunsOf(ledgers), recentRuns: recentRunsByHost(ledgers) };
}
