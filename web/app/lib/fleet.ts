/**
 * The fleet pages as the app shows them (0.140.0): the words and tones of a
 * workspace health, the headline sentence of `/fleet`, its filter, and the
 * rule every list of the fleet pages follows: grouped by workspace, at most
 * five rows per group, then "show all". Pure.
 */

import type { FleetWorkspace, FleetWorkspaces, PeerHost, WorkspaceHealth } from "../../../src/web/api.ts";
import type { Badge } from "./tone.ts";

const HEALTH_WORDS = {
  unreadable: { tone: "bad", label: "Unreadable" },
  failing: { tone: "bad", label: "Failing" },
  "needs-you": { tone: "wait", label: "Needs you" },
  quiet: { tone: "idle", label: "Quiet" },
  ok: { tone: "ok", label: "OK" },
} as const satisfies Record<WorkspaceHealth, Badge>;

export const HEALTHS: readonly WorkspaceHealth[] = ["unreadable", "failing", "needs-you", "ok", "quiet"];

export function healthWord(health: WorkspaceHealth): Badge {
  return HEALTH_WORDS[health];
}

/** The health a `?health=` query names, or null for every workspace. */
export function healthFilterOf(params: { get(name: string): string | null }): WorkspaceHealth | null {
  const text = params.get("health");
  return HEALTHS.find((health) => health === text) ?? null;
}

/** At most `max` reasons, and how many more there are. */
export interface ShownReasons {
  shown: string[];
  more: number;
}

export function shownReasons(reasons: readonly string[], max = 2): ShownReasons {
  return { shown: reasons.slice(0, max), more: Math.max(0, reasons.length - max) };
}

/** One part of the headline: "3 need you", a link that filters the table. */
export interface HeadlinePart {
  health: WorkspaceHealth;
  count: number;
  text: string;
}

const PART_WORDS = {
  ok: () => "OK",
  failing: () => "failing",
  "needs-you": (count: number) => (count === 1 ? "needs you" : "need you"),
  unreadable: () => "unreadable",
  quiet: () => "quiet",
} as const satisfies Record<WorkspaceHealth, (count: number) => string>;

export interface Headline {
  /** "11 workspaces on 2 hosts": the quiet ones are not in it. */
  lead: string;
  /** The counts above zero, in the order OK, Needs you, Failing, Unreadable. */
  parts: HeadlinePart[];
  /** The quiet ones, counted apart. */
  quiet: HeadlinePart | null;
}

function plural(count: number, one: string, many: string): string {
  return `${String(count)} ${count === 1 ? one : many}`;
}

/** The headline of `/fleet`: "11 workspaces on 2 hosts: 7 OK, 3 need you, 1 failing", the quiet ones counted apart ("Also 2 quiet"). */
export function headlineOf(workspaces: readonly FleetWorkspace[], hosts: number): Headline {
  const count = (health: WorkspaceHealth): number => workspaces.filter((workspace) => workspace.health === health).length;
  const parts = (["ok", "needs-you", "failing", "unreadable"] as const).map((health) => ({ health, count: count(health), text: `${String(count(health))} ${PART_WORDS[health](count(health))}` })).filter((part) => part.count > 0);
  const quiet = count("quiet");
  return {
    lead: `${plural(workspaces.length - quiet, "workspace", "workspaces")} on ${plural(hosts, "host", "hosts")}`,
    parts,
    quiet: quiet === 0 ? null : { health: "quiet", count: quiet, text: `${String(quiet)} quiet` },
  };
}

/** The hosts of the store that count for the headline: every host the probe knows, else the fleet's own list. */
export function hostCount(peers: readonly PeerHost[], fleetHosts: readonly string[]): number {
  return Math.max(peers.length, fleetHosts.length);
}

/** At most this many rows per workspace group on the fleet pages. */
export const GROUP_MAX = 5;

export interface Group<T> {
  workspace: string;
  rows: T[];
  /** All rows of the group, before the cut. */
  total: number;
}

/** Rows grouped by workspace, in first-seen order, each cut to `max`. */
export function groupByWorkspace<T>(rows: readonly T[], workspaceOf: (row: T) => string, max = GROUP_MAX): Group<T>[] {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const key = workspaceOf(row);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups.entries()].map(([workspace, all]) => ({ workspace, rows: all.slice(0, max), total: all.length }));
}

/** The workspaces with a checkout on `host`. */
export function checkoutsOn(workspaces: FleetWorkspaces, host: string): string[] {
  return workspaces.workspaces.filter((workspace) => workspace.places.some((place) => place.host === host && place.kind === "checkout")).map((workspace) => workspace.name);
}

/** The djinns pinned to `host`. */
export function pinnedDjinnsOn(workspaces: FleetWorkspaces, host: string): number {
  return workspaces.workspaces.reduce((sum, workspace) => sum + workspace.djinns.filter((djinn) => djinn.why === "pinned" && djinn.host === host).length, 0);
}
