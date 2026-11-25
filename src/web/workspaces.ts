/**
 * The fleet of workspaces (0.140.0): every workspace this host holds, with
 * its health word (src/web/health.ts), where it lives (a checkout or a copy
 * per host, and the rituals pinned there), its counts and its djinns. The
 * `/fleet` page and the workspace header read it.
 *
 * Two halves: `collectWorkspaces` reads the store (ledgers, candles, box
 * taints, checkout records, mirror failures) into plain facts, and
 * `buildWorkspaces` turns facts into the view. The second is pure, so the
 * demo and the tests feed it facts directly. Read-only: nothing here writes,
 * syncs or reaches the network.
 */

import { readTaints } from "../core/box-taint.ts";
import { readBehindRecord } from "../core/checkout-behind.ts";
import { loadConfigIfPresent } from "../core/config.ts";
import { RETIRED_AFTER_MS } from "../core/host-versions.ts";
import { hostId, readLedger } from "../core/ledger.ts";
import { readMirrorFailures } from "../core/mirror.ts";
import type { JsonValue, LedgerLine } from "../core/model.ts";
import { openProject } from "../core/store.ts";
import { HOST_VERSION_TYPE, SYNC_WHO } from "../core/sync.ts";
import { readTreeConflicts } from "../core/tree-conflicts.ts";
import { checkoutDir, LINKED_LINE } from "../core/workdir.ts";
import type { FleetDjinn, FleetMirrorFailure, FleetWorkspace, FleetWorkspaces, HostStatus, ProjectStatus, RitualRow, WorkspaceCounts, WorkspacePlace } from "./api.ts";
import { collectCandleRows } from "./candles.ts";
import { runStates } from "./fleet.ts";
import { healthOf, HEALTH_ORDER, isFailedOutcome, type HealthFacts } from "./health.ts";

/** The newest run of a ritual, and how many of its newest closed runs failed in a row. */
export interface RitualRuns {
  slug: string;
  last: { run: string; outcome: string | null; at: string } | null;
  failedStreak: number;
}

/** What the ledger and the local records of this host say about one workspace. */
export interface WorkspaceLedgerFacts {
  name: string;
  lastActivity: string | null;
  rituals: readonly RitualRuns[];
  /** The hosts that hold it, without the pin counts. */
  places: readonly Omit<WorkspacePlace, "pinned">[];
  treeConflicts: number;
  cannotStart: readonly string[];
}

export interface WorkspacesInput {
  self: string;
  now: number;
  /** The host's today, YYYY-MM-DD. */
  today: string;
  generatedAt: string;
  projects: readonly ProjectStatus[];
  ledgers: readonly WorkspaceLedgerFacts[];
  /** The lit candles of every workspace, with their severity. */
  litCandles: readonly { project: string; severity: string }[];
  /** Every host seen in 30 days. */
  hosts: readonly string[];
  mirrorFailures: readonly FleetMirrorFailure[];
}

// --- the pure half ---------------------------------------------------------------------------

function isActive(ritual: RitualRow): boolean {
  return ritual.lifecycle === "active";
}

/** A ritual darius starts by itself: active, with a mode other than off. */
function isUnattended(ritual: RitualRow): boolean {
  return isActive(ritual) && ritual.mode !== "off";
}

function isDjinn(ritual: RitualRow): boolean {
  return isUnattended(ritual) && ritual.skill !== null;
}

/** Late: darius starts it, nothing runs or waits, and its due day has passed. */
function isLate(ritual: RitualRow, today: string): boolean {
  if (!isUnattended(ritual) || ritual.openRun !== null || ritual.heldRun !== null || ritual.nextDue === null) return false;
  return ritual.overdueDays > 0 || ritual.nextDue < today;
}

function djinnState(ritual: RitualRow, today: string): FleetDjinn["state"] {
  if (ritual.openRun !== null) return "running";
  if (ritual.heldRun !== null) return "held";
  if (isLate(ritual, today)) return "late";
  if (ritual.nextDue !== null && ritual.nextDue <= today) return "due";
  return "idle";
}

function placesOf(project: ProjectStatus, facts: WorkspaceLedgerFacts | undefined, self: string, hosts: readonly string[]): WorkspacePlace[] {
  const pinnedOn = (host: string): number => project.rituals.filter((ritual) => isActive(ritual) && ritual.host === host).length;
  const found = facts?.places ?? [];
  const own = found.find((place) => place.host === self) ?? { host: self, kind: project.checkout === null ? "copy" : "checkout" };
  const others = found.filter((place) => place.host !== self && hosts.includes(place.host));
  return [own, ...others.toSorted((left, right) => left.host.localeCompare(right.host))].map((place) => ({ host: place.host, kind: place.kind, pinned: pinnedOn(place.host) }));
}

function djinnsOf(project: ProjectStatus, facts: WorkspaceLedgerFacts | undefined, places: readonly WorkspacePlace[], today: string): FleetDjinn[] {
  const checkout = places.find((place) => place.kind === "checkout")?.host ?? null;
  return project.rituals.filter(isDjinn).map((ritual): FleetDjinn => {
    const last = facts?.rituals.find((entry) => entry.slug === ritual.slug)?.last ?? null;
    const pinned = ritual.host !== null && ritual.host !== "";
    return {
      slug: ritual.slug,
      title: ritual.title,
      state: djinnState(ritual, today),
      nextDueAt: ritual.nextDueAt,
      nextDue: ritual.nextDue,
      host: pinned ? ritual.host : checkout,
      why: pinned ? "pinned" : checkout === null ? null : "checkout",
      lastOutcome: last?.outcome ?? null,
      lastAt: last?.at ?? null,
      lastRun: last?.run ?? null,
    };
  });
}

function countsOf(project: ProjectStatus, today: string): WorkspaceCounts {
  const active = project.rituals.filter(isActive);
  const djinns = active.filter(isDjinn);
  const open = project.vigils.filter((vigil) => vigil.state !== "closed");
  return {
    djinns: djinns.length,
    djinnsLate: djinns.filter((ritual) => isLate(ritual, today)).length,
    rituals: active.length,
    ritualsLate: active.filter((ritual) => isLate(ritual, today)).length,
    vigilsOpen: open.length,
    vigilsFlagged: open.filter((vigil) => vigil.flagged && !vigil.paused).length,
    candlesLit: project.candles.lit,
    findingsOpen: project.findings.open,
    findingsNeedYou: project.findings.needsYou,
  };
}

function healthFacts(project: ProjectStatus, facts: WorkspaceLedgerFacts | undefined, input: WorkspacesInput, here: WorkspacePlace["kind"]): HealthFacts {
  const result = baseFacts(project, facts, input);
  if (here === "copy") result.copySyncedAt = project.lastSync;
  return result;
}

function baseFacts(project: ProjectStatus, facts: WorkspaceLedgerFacts | undefined, input: WorkspacesInput): HealthFacts {
  const { today } = input;
  const active = project.rituals.filter(isActive);
  const runsOf = (slug: string): RitualRuns | undefined => facts?.rituals.find((entry) => entry.slug === slug);
  const streaks = active.map((ritual) => runsOf(ritual.slug)?.failedStreak ?? 0);
  const high = input.litCandles.filter((candle) => candle.project === project.name && (candle.severity === "high" || candle.severity === "critical")).length;
  const open = project.vigils.filter((vigil) => vigil.state !== "closed");
  const waiting = open.filter((vigil) => !vigil.paused);
  return {
    error: project.error,
    candlesHigh: high,
    candlesLow: Math.max(0, project.candles.lit - high),
    vigilsFlagged: waiting.filter((vigil) => vigil.flagged).length,
    vigilsDue: waiting.filter((vigil) => !vigil.flagged && vigil.due !== null && vigil.due <= today).length,
    ritualsFailing: streaks.filter((streak) => streak >= 2).length,
    ritualsFailedOnce: streaks.filter((streak) => streak === 1).length,
    ritualsLate: active.filter((ritual) => isLate(ritual, today)).length,
    runsHeld: active.filter((ritual) => ritual.heldRun !== null).length,
    findingsNeedYou: project.findings.needsYou,
    activeRituals: active.length,
    openVigils: open.length,
    lastActivity: facts?.lastActivity ?? null,
    treeConflicts: facts?.treeConflicts ?? 0,
    cannotStart: facts?.cannotStart ?? [],
  };
}

/** One workspace of the fleet view. */
export function buildWorkspace(project: ProjectStatus, input: WorkspacesInput): FleetWorkspace {
  const facts = input.ledgers.find((entry) => entry.name === project.name);
  const places = placesOf(project, facts, input.self, input.hosts);
  const here = places[0]?.kind ?? "copy";
  const verdict = healthOf(healthFacts(project, facts, input, here), input.now);
  return {
    name: project.name,
    icon: project.icon,
    health: verdict.health,
    reasons: verdict.reasons,
    places,
    here,
    lastSync: project.lastSync,
    counts: countsOf(project, input.today),
    lastActivity: facts?.lastActivity ?? null,
    djinns: djinnsOf(project, facts, places, input.today),
  };
}

/** Every workspace, worst first, then by name. */
export function buildWorkspaces(input: WorkspacesInput): FleetWorkspaces {
  const workspaces = input.projects.map((project) => buildWorkspace(project, input)).toSorted((left, right) => HEALTH_ORDER[left.health] - HEALTH_ORDER[right.health] || left.name.localeCompare(right.name));
  const hosts = [input.self, ...input.hosts.filter((host) => host !== input.self).toSorted()];
  return { self: input.self, generatedAt: input.generatedAt, hosts, workspaces, mirrorFailures: [...input.mirrorFailures] };
}

// --- the reading half ------------------------------------------------------------------------

/** A line that says nothing about the work: a version stamp, an alert delivery, a sync. */
function isHousekeeping(line: LedgerLine): boolean {
  return line.type === HOST_VERSION_TYPE || line.type.startsWith("alert.") || line.who === SYNC_WHO;
}

function isText(value: JsonValue | undefined): value is string {
  return typeof value === "string" && value !== "";
}

/** The newest run of each ritual and its failed streak, from the ritual's own runs (not the newest 20 of the project). */
export function ritualRuns(lines: readonly LedgerLine[]): RitualRuns[] {
  const bySlug = new Map<string, ReturnType<typeof runStates>>();
  for (const state of runStates(lines)) {
    if (!state.item.startsWith("ritual/")) continue;
    const slug = state.item.slice("ritual/".length);
    bySlug.set(slug, [...(bySlug.get(slug) ?? []), state]);
  }
  return [...bySlug.entries()].map(([slug, states]) => {
    const newest = states.toSorted((left, right) => right.startedAt.localeCompare(left.startedAt));
    const closed = newest.filter((state) => state.phase === "closed");
    const firstOk = closed.findIndex((state) => !isFailedOutcome(state.outcome));
    const top = newest[0];
    return {
      slug,
      last: top === undefined ? null : { run: top.run, outcome: top.phase === "closed" ? top.outcome : top.phase, at: top.startedAt },
      failedStreak: firstOk === -1 ? closed.length : firstOk,
    };
  });
}

/** The hosts that hold a workspace: a checkout where a host linked it (or imported it), a copy where a host only wrote lines. */
export function placesFromLedger(lines: readonly LedgerLine[], self: string, selfCheckout: boolean): Omit<WorkspacePlace, "pinned">[] {
  const checkouts = new Set(lines.filter((line) => (line.type === LINKED_LINE && isText(line.path)) || (line.type === "import" && isText(line.source))).map((line) => line.host));
  const writers = new Set(lines.map((line) => line.host));
  const others = [...writers, ...checkouts].filter((host, index, all) => host !== self && all.indexOf(host) === index);
  return [{ host: self, kind: selfCheckout ? "checkout" : "copy" }, ...others.map((host) => ({ host, kind: checkouts.has(host) ? ("checkout" as const) : ("copy" as const) }))];
}

/** The newest line that says something about the work; version, alert and sync lines do not count (they would keep a dead workspace from Quiet). */
export function newestActivity(lines: readonly LedgerLine[]): string | null {
  let newest: string | null = null;
  for (const line of lines) if (!isHousekeeping(line) && (newest === null || line.at > newest)) newest = line.at;
  return newest;
}

function safeTaints(): { project: string }[] {
  try {
    return readTaints();
  } catch {
    return [];
  }
}

function safeFailures(): FleetMirrorFailure[] {
  try {
    return readMirrorFailures();
  } catch {
    return [];
  }
}

function refusesBehind(): boolean {
  try {
    return loadConfigIfPresent()?.run.behind === "refuse";
  } catch {
    return false;
  }
}

/** The fleet view of this host's store, or of the one workspace `only`. `status` is the status read of the same request. */
export function collectWorkspaces(fullStatus: HostStatus, now: Date = new Date(), only?: string): FleetWorkspaces {
  const status = only === undefined ? fullStatus : { ...fullStatus, projects: fullStatus.projects.filter((project) => project.name === only) };
  const self = hostId();
  const taints = safeTaints();
  const refuse = refusesBehind();
  const seen = new Map<string, string>();
  const ledgers = status.projects.flatMap((projectStatus): WorkspaceLedgerFacts[] => {
    if (projectStatus.error !== null) return [];
    try {
      const project = openProject(projectStatus.name);
      const lines = readLedger(project);
      for (const line of lines) if (line.at > (seen.get(line.host) ?? "")) seen.set(line.host, line.at);
      const behind = readBehindRecord(project);
      const cannotStart = [
        ...(taints.some((taint) => taint.project === projectStatus.name) ? ["box-broken"] : []),
        ...(refuse && behind?.check.state === "checked" && behind.check.behind > 0 ? ["checkout-behind"] : []),
      ];
      return [
        {
          name: projectStatus.name,
          lastActivity: newestActivity(lines),
          rituals: ritualRuns(lines),
          places: placesFromLedger(lines, self, checkoutDir(project, lines) !== undefined),
          treeConflicts: readTreeConflicts(lines).open.length,
          cannotStart,
        },
      ];
    } catch {
      return [];
    }
  });
  const cutoff = now.getTime() - RETIRED_AFTER_MS;
  const hosts = [...seen.entries()].filter(([host, at]) => host === self || Date.parse(at) >= cutoff).map(([host]) => host);
  const hasLit = status.projects.some((project) => project.candles.lit > 0);
  const litCandles = hasLit ? collectCandleRows().filter((candle) => candle.status === "lit") : [];
  return buildWorkspaces({ self, now: now.getTime(), today: status.today, generatedAt: status.generatedAt, projects: status.projects, ledgers, litCandles, hosts: hosts.includes(self) ? hosts : [self, ...hosts], mirrorFailures: safeFailures() });
}
