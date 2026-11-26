/**
 * The machines of the synced store as the pages say them (0.141.0): the
 * facts of one machine from its live answer, its ledger lines and the
 * workspaces; the sentence at the top of its page; what needs attention
 * (on the page, in a block of the Machines page and as the count on a chip
 * of the machine bar); the block of the Machines page; and the split of
 * states for the Machines page, the Overview and Places. Pure.
 */

import type { FleetHost, FleetLast, FleetWorkspace, HostBackup, HostBoxCheck, HostOpenRun, PeerHost, PeerState } from "../../../src/web/api.ts";
import { onSchedule, runsHereRows, type OpenAsk, type PlacedRitual, type RunsHereRow } from "./lists.ts";
import type { NeedPart } from "./home.ts";
import { lookItems, type LookItem } from "./look.ts";
import { age, counted, plain, time, type Part } from "./sentence.ts";
import { TERMS, termCount } from "./terms.ts";

/** At most this many workspace names in a machine sentence, then "and n more". */
export const SENTENCE_NAMES = 4;

export interface MachineFacts {
  name: string;
  /** The machine that serves this page. */
  self: boolean;
  /** What the probe says; null when darius did not ask it (a host the ledgers know and the probe does not). */
  state: PeerState | null;
  reason: string | null;
  version: string | null;
  /** Its version is known and is not the version of this machine. */
  differs: boolean;
  uptimeSeconds: number | null;
  load: readonly [number, number, number] | null;
  boxCheck: HostBoxCheck | null;
  lastSeen: string | null;
  backup: HostBackup | null;
  retired: boolean;
  /** The workspaces it runs: their project folder is linked there. */
  runs: string[];
  /** The workspaces it only shows a copy of. */
  copies: string[];
  /** Its open runs, from its own answer; null when it did not answer. */
  openRuns: HostOpenRun[] | null;
  /** The rituals darius starts on it. */
  rituals: number;
  ritualsLate: number;
  /** When the newest run of a ritual that darius starts here started; null when none ran. */
  lastRitualAt: string | null;
}

export interface MachineInput {
  name: string;
  peer: PeerHost | undefined;
  host: FleetHost | undefined;
  workspaces: readonly FleetWorkspace[];
  /** The darius of this machine; null when unknown. */
  selfVersion: string | null;
}

/** The facts of one machine. */
export function machineFacts({ name, peer, host, workspaces, selfVersion }: MachineInput): MachineFacts {
  const live = peer?.live ?? null;
  const version = peer?.version ?? host?.version ?? null;
  const held = workspaces.flatMap((workspace) => workspace.places.filter((place) => place.host === name).map((place) => ({ workspace: workspace.name, kind: place.kind })));
  const rituals = workspaces.flatMap((workspace) => workspace.djinns.filter((ritual) => ritual.host === name));
  const starts = rituals.flatMap((ritual) => (ritual.lastAt === null ? [] : [ritual.lastAt])).toSorted();
  return {
    name,
    self: peer?.self === true || host?.self === true,
    state: peer?.state ?? null,
    reason: peer?.reason ?? null,
    version,
    differs: version !== null && selfVersion !== null && version !== selfVersion,
    uptimeSeconds: live?.uptimeSeconds ?? null,
    load: live?.load ?? null,
    boxCheck: live?.boxCheck ?? host?.boxCheck ?? null,
    lastSeen: peer?.lastSeen ?? host?.lastSeen ?? null,
    backup: host?.backup ?? null,
    retired: host?.retired === true,
    runs: held.filter((one) => one.kind === "checkout").map((one) => one.workspace),
    copies: held.filter((one) => one.kind === "copy").map((one) => one.workspace),
    openRuns: live?.openRuns ?? null,
    rituals: rituals.length,
    ritualsLate: rituals.filter((ritual) => ritual.state === "late").length,
    lastRitualAt: starts.at(-1) ?? null,
  };
}

/** The machines of the Machines page: every machine the ledgers know but the retired ones, this machine first, then any machine only the probe knows. */
export function machineNames(hosts: readonly FleetHost[], peers: readonly PeerHost[]): string[] {
  const known = hosts.filter((host) => !host.retired).map((host) => host.host);
  return [...known, ...peers.map((peer) => peer.host).filter((name) => !known.includes(name))];
}

/** Only a machine that is not plainly online says its state in the sentence: the state word and the "this machine" mark say the rest. */
function stateParts(facts: MachineFacts): Part[] {
  const why = facts.reason === null ? "" : ` (${facts.reason})`;
  const seen = facts.lastSeen === null ? [plain(" darius has seen no activity of it. ")] : [plain(" Its last activity was "), time(facts.lastSeen), plain(". ")];
  const lastLine = facts.lastSeen === null ? [plain(" darius has seen no activity of it. ")] : [plain(" Its last activity is "), age(facts.lastSeen), plain(" old. ")];
  if (facts.self || facts.state === "online" || facts.state === "self") return [];
  if (facts.state === "unreachable" || facts.state === "offline") return [plain(`${facts.name} did not answer${why}.`), ...lastLine];
  if (facts.state === "checking") return [plain(`darius is still asking ${facts.name}.`), ...seen];
  return [plain(`darius did not ask ${facts.name}.`), ...seen];
}

/** "host-a runs 2 workspaces and starts 11 rituals for them." The copies are in the line under the workspace table. */
function workParts(facts: MachineFacts): Part[] {
  const runs = facts.runs.length;
  const rituals = facts.rituals;
  const them = runs === 1 ? "it" : "them";
  if (runs === 0 && rituals === 0) return [plain(`${facts.name} runs no ${TERMS.workspace.word}.`)];
  if (runs === 0) return [plain(`${facts.name} runs no ${TERMS.workspace.word}; it starts ${termCount("ritual", rituals)}.`)];
  if (rituals === 0) return [plain(`${facts.name} runs ${termCount("workspace", runs)}; darius starts no ${TERMS.ritual.word} for ${them}.`)];
  return [plain(`${facts.name} runs ${termCount("workspace", runs)} and starts ${termCount("ritual", rituals)} for ${them}.`)];
}

/** "Nothing is running now; the last run started 8 h ago." Open runs only when the machine answered. */
function nowParts(facts: MachineFacts): Part[] {
  const last = facts.lastRitualAt;
  const open = facts.openRuns;
  if (open === null) return last === null ? [] : [plain(" The last run started "), time(last), plain(".")];
  const running = open.filter((run) => run.phase === "running").length;
  const held = open.filter((run) => run.phase === "held").length;
  const words = [running === 0 ? "" : `${counted(running, "run", "runs")} ${running === 1 ? "is" : "are"} running`, held === 0 ? "" : `${counted(held, "run", "runs")} ${held === 1 ? "waits" : "wait"} for your answer`].filter((word) => word !== "");
  const now = words.length === 0 ? "Nothing is running now" : `${words.join(" and ")} now`;
  return last === null ? [plain(` ${now}.`)] : [plain(` ${now}; the last run started `), time(last), plain(".")];
}

/**
 * The status of a machine in short sentences, one idea each (0.143.0):
 * its state when it is not plainly online, what it runs and starts, and
 * what runs now. "host-a runs 2 workspaces and starts 11 rituals for
 * them. Nothing is running now; the last run started 8 h ago."
 */
export function machineSentence(facts: MachineFacts): Part[] {
  return [...stateParts(facts), ...workParts(facts), ...nowParts(facts)];
}

/** What is wrong with a machine itself. */
export type AttentionKey = "unreachable" | "retired" | "version" | "sandbox" | "backup-stale" | "backup-failed";

/** One thing on a machine that needs a look: a short lead, the cause, and the command that fixes it when there is one. */
export interface Attention {
  key: AttentionKey;
  /** "Did not answer", "Sandbox check failed". */
  lead: string;
  text: string;
  command: string | null;
}

/** What needs a look on a machine itself, most urgent first; empty when nothing does. */
export function machineAttention(facts: MachineFacts, selfVersion: string | null): Attention[] {
  const items: Attention[] = [];
  const why = facts.reason === null ? "" : ` (${facts.reason})`;
  if (facts.state === "unreachable" || facts.state === "offline") items.push({ key: "unreachable", lead: "Did not answer", text: `Its darius serve did not answer${why}. Live facts show only while darius serve runs on that machine, and [setup] units must list web there.`, command: "darius setup --systemd" });
  if (facts.retired) items.push({ key: "retired", lead: "Retired", text: "It wrote no line in 30 days, so darius counts it as retired.", command: null });
  if (facts.differs && facts.version !== null) items.push({ key: "version", lead: "Other darius version", text: `It runs darius ${facts.version}, and this machine runs ${selfVersion ?? "another version"}.`, command: "darius update --hosts" });
  if (facts.boxCheck !== null && facts.boxCheck.outcome !== "pass") items.push({ key: "sandbox", lead: "Sandbox check failed", text: facts.boxCheck.outcome === "fail" ? `Its last ${TERMS.sandboxCheck.word} failed.` : `Its last ${TERMS.sandboxCheck.word} ended ${facts.boxCheck.outcome}.`, command: "darius box check" });
  if (facts.backup?.state === "stale") items.push({ key: "backup-stale", lead: "Backup stale", text: `Its backup is stale${facts.backup.reason === null ? "" : `: ${facts.backup.reason}`}.`, command: null });
  if (facts.backup?.state === "failed") items.push({ key: "backup-failed", lead: "Backup failed", text: `Its last backup failed${facts.backup.error === null ? "" : `: ${facts.backup.error}`}.`, command: null });
  return items;
}

/** Whether a chip of the machine bar shows the "something to check" mark. The bar has only the probe data, so it looks at the items that data holds: a machine that did not answer, another darius version, a box check from its live facts. The backup, the retired mark and a box check of the ledgers need the ledgers, which the bar does not read, so the bar shows no number: it would disagree with the count on Machines. */
export function peerNeedsCheck(peer: PeerHost, selfVersion: string | null): boolean {
  return machineAttention(machineFacts({ name: peer.host, peer, host: undefined, workspaces: [], selfVersion }), selfVersion).length > 0;
}

// --- the block of the Machines page ----------------------------------------------------------------

/** At most this many rituals on schedule in a block, then "and n more". */
export const BLOCK_ON_SCHEDULE = 5;

/** At most this many workspaces in a block, then "and n more". */
export const BLOCK_WORKSPACES = 6;

export interface MachineBlock {
  facts: MachineFacts;
  /** What needs a look on this machine, in the order of the list (`lookItems`). */
  look: LookItem[];
  /** The workspaces that run here, worst health first, at most `BLOCK_WORKSPACES`. */
  runs: RunsHereRow[];
  /** How many workspaces that run here the block does not list. */
  moreRuns: number;
  /** The rituals on schedule here, next due first, at most `BLOCK_ON_SCHEDULE`. */
  onSchedule: PlacedRitual[];
  /** All rituals on schedule here. */
  onScheduleTotal: number;
}

export interface BlockInput extends MachineInput {
  /** The newest run of each ritual (`FleetView.lastRuns`). */
  lastRuns: readonly FleetLast[];
  /** The runs open on this machine. */
  openRuns: readonly Pick<HostOpenRun, "project">[];
  /** The runs that wait for an answer (`openAsks`), by `project/run`. */
  asks: ReadonlyMap<string, OpenAsk>;
  /** What the need-you count of each workspace is made of (`needCounts().partsByProject`): the badge in Places is their sum. */
  needs: Readonly<Record<string, readonly NeedPart[]>>;
}

/** The rituals darius starts on a machine, each with its workspace and the open question of its last run. */
export function machineRituals(name: string, workspaces: readonly FleetWorkspace[], asks: ReadonlyMap<string, OpenAsk>): PlacedRitual[] {
  return workspaces.flatMap((workspace) =>
    workspace.djinns.filter((ritual) => ritual.host === name).map((ritual) => ({ workspace: workspace.name, ritual, ask: ritual.lastRun === null ? null : (asks.get(`${workspace.name}/${ritual.lastRun}`) ?? null) })),
  );
}

/** Everything the block of one machine shows on the Machines page. */
export function machineBlock(input: BlockInput): MachineBlock {
  const facts = machineFacts(input);
  const runs = runsHereRows(input.name, input.workspaces, input.lastRuns, input.openRuns, input.asks, input.needs);
  const rituals = machineRituals(input.name, input.workspaces, input.asks);
  const quiet = onSchedule(rituals);
  return {
    facts,
    look: lookItems({ machine: input.name, rituals, attention: machineAttention(facts, input.selfVersion), page: "machines" }),
    runs: runs.slice(0, BLOCK_WORKSPACES),
    moreRuns: Math.max(0, runs.length - BLOCK_WORKSPACES),
    onSchedule: quiet.slice(0, BLOCK_ON_SCHEDULE),
    onScheduleTotal: quiet.length,
  };
}

// --- the split of states ---------------------------------------------------------------------------

/** The state word of a machine in a count: this machine counts as online, and offline is counted as unreachable (the page cannot tell a down machine from one whose serve is down). */
type StateWord = "online" | "unreachable" | "checking" | "not asked";

const STATE_ORDER: readonly StateWord[] = ["online", "unreachable", "checking", "not asked"];

function stateWordOf(state: PeerState | null): StateWord {
  if (state === null) return "not asked";
  if (state === "self") return "online";
  return state === "offline" ? "unreachable" : state;
}

export interface StateSplit {
  /** "3 machines". */
  lead: string;
  /** "2 online", "1 unreachable": the counts above zero, online first. */
  parts: string[];
  /** The worst state that is not online, with its count ("1 unreachable"); null when every machine is online. */
  worst: string | null;
}

/** How many machines are in each state. */
export function stateSplit(states: readonly (PeerState | null)[]): StateSplit {
  const words = states.map(stateWordOf);
  const parts = STATE_ORDER.flatMap((word) => {
    const count = words.filter((one) => one === word).length;
    return count === 0 ? [] : [{ word, text: `${String(count)} ${word}` }];
  });
  const bad = ["unreachable", "checking", "not asked"].map((word) => parts.find((part) => part.word === word)).find((part) => part !== undefined);
  return { lead: counted(states.length, "machine", "machines"), parts: parts.map((part) => part.text), worst: bad?.text ?? null };
}

/** "3 machines: 2 online, 1 unreachable." */
export function stateLine(split: StateSplit): string {
  return split.parts.length === 0 ? `${split.lead}.` : `${split.lead}: ${split.parts.join(", ")}.`;
}

/** "3" or "3, 1 unreachable": the count of the Machines row in Places. */
export function machinesRowText(split: StateSplit, count: number): string {
  return split.worst === null ? String(count) : `${String(count)}, ${split.worst}`;
}
