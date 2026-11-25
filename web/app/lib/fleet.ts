/**
 * The workspaces as the app shows them (0.140.0, 0.141.0): the words and
 * tones of a workspace health, the headline sentence of `/workspaces`, its
 * filter, the health split of the Overview, the status sentence of a
 * workspace, the machines that run it, and the rule every list of the
 * machine pages follows: grouped by workspace, at most five rows per group,
 * then "show all". Pure.
 */

import type { FleetWorkspace, PeerHost, WorkspaceHealth } from "../../../src/web/api.ts";
import type { Target } from "./paths.ts";
import { andList, counted, linkedList, plain, time, type Part } from "./sentence.ts";
import type { Badge } from "./tone.ts";

/** The legend of the Workspaces page and of a machine page (0.141.0). */
export const LEGEND = "A machine runs a workspace when its project folder is linked there. A copy only shows the workspace and starts nothing.";

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
  /** "11 workspaces on 2 machines": the quiet ones are not in it. */
  lead: string;
  /** The counts above zero, in the order OK, Needs you, Failing, Unreadable. */
  parts: HeadlinePart[];
  /** The quiet ones, counted apart. */
  quiet: HeadlinePart | null;
}

function partOf(workspaces: readonly { health: WorkspaceHealth }[], health: WorkspaceHealth): HeadlinePart {
  const count = workspaces.filter((workspace) => workspace.health === health).length;
  return { health, count, text: `${String(count)} ${PART_WORDS[health](count)}` };
}

/** The headline of `/workspaces`: "11 workspaces on 2 machines: 7 OK, 3 need you, 1 failing", the quiet ones counted apart ("Also 2 quiet"). */
export function headlineOf(workspaces: readonly FleetWorkspace[], hosts: number): Headline {
  const parts = (["ok", "needs-you", "failing", "unreadable"] as const).map((health) => partOf(workspaces, health)).filter((part) => part.count > 0);
  const quiet = partOf(workspaces, "quiet");
  return {
    lead: `${counted(workspaces.length - quiet.count, "workspace", "workspaces")} on ${counted(hosts, "machine", "machines")}`,
    parts,
    quiet: quiet.count === 0 ? null : quiet,
  };
}

/** The health split of the Overview (0.141.0): "10 workspaces: 2 OK, 3 need you, 2 failing, 1 unreadable, 2 quiet", the counts above zero. */
export interface HealthSplit {
  /** "10 workspaces". */
  lead: string;
  parts: HeadlinePart[];
}

export function healthSplit(workspaces: readonly { health: WorkspaceHealth }[]): HealthSplit {
  const parts = (["ok", "needs-you", "failing", "unreadable", "quiet"] as const).map((health) => partOf(workspaces, health)).filter((part) => part.count > 0);
  return { lead: counted(workspaces.length, "workspace", "workspaces"), parts };
}

/** The machines that run a workspace (its project folder is linked there), and the ones that only show a copy. */
export interface RunsOn {
  runs: string[];
  copies: string[];
}

export function runsOnOf(workspace: FleetWorkspace): RunsOn {
  return {
    runs: workspace.places.filter((place) => place.kind === "checkout").map((place) => place.host),
    copies: workspace.places.filter((place) => place.kind === "copy").map((place) => place.host),
  };
}

/** At most this many reasons in the status sentence of a workspace, then "and n more". */
const SENTENCE_REASONS = 3;

function machineTarget(name: string): Target {
  return { to: "machine", host: name };
}

/**
 * The status sentence of a workspace (0.141.0): its health and why, the
 * machines that run it, the other copies, and the copy on this machine.
 * "Failing: 2 high candles lit, 2 vigils flagged. Runs on demo. Copies on
 * host-b and host-c." For a copy here it ends "This machine shows a copy,
 * synced 6 min ago."
 */
export function workspaceSentence(workspace: FleetWorkspace, self: string): Part[] {
  const word = healthWord(workspace.health).label;
  const { shown, more } = shownReasons(workspace.reasons, SENTENCE_REASONS);
  const why = shown.length === 0 ? (workspace.health === "ok" ? ": nothing needs you" : "") : `: ${shown.join(", ")}${more === 0 ? "" : ` and ${String(more)} more`}`;
  const { runs, copies } = runsOnOf(workspace);
  const others = copies.filter((name) => name !== self);
  const parts: Part[] = [plain(`${word}${why}.`)];
  parts.push(...(runs.length === 0 ? [plain(" No machine runs it.")] : [plain(" Runs on "), ...linkedList(runs, machineTarget), plain(".")]));
  if (others.length > 0) parts.push(plain(others.length === 1 ? " A copy on " : " Copies on "), ...linkedList(others, machineTarget), plain("."));
  if (workspace.here === "copy") parts.push(...(workspace.lastSync === null ? [plain(" This machine shows a copy and has not synced it yet.")] : [plain(" This machine shows a copy, synced "), time(workspace.lastSync), plain(".")]));
  return parts;
}

/** "+2 copies" and the names for its title, or null when no machine shows only a copy. */
export interface CopiesMark {
  text: string;
  title: string;
}

export function copiesMark(copies: readonly string[]): CopiesMark | null {
  if (copies.length === 0) return null;
  return { text: `+${counted(copies.length, "copy", "copies")}`, title: `Copies on ${andList(copies)}` };
}

/** The machines of the store that count for the headline: every machine the probe knows, else the workspaces' own list. */
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
