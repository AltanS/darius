/**
 * The machines of the synced store as the pages say them (0.141.0): the
 * facts of one machine from its live answer, its ledger lines and the
 * workspaces; the sentence at the top of its page; what needs attention
 * (on the page, in a block of the Machines page and as the count on a chip
 * of the machine bar); the block of the Machines page; and the split of
 * states for the Machines page, the Overview and Places. Pure.
 */

import type { FleetHost, FleetLast, FleetWorkspace, HostBackup, HostBoxCheck, HostOpenRun, PeerHost, PeerState } from "../../../src/web/api.ts";
import { runsHereRows, sortDjinns, type PlacedDjinn, type RunsHereRow } from "./lists.ts";
import { age, counted, link, plain, time, type Part } from "./sentence.ts";

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
  djinns: number;
  djinnsLate: number;
  /** When the newest run of a djinn that lives here started; null when none ran. */
  lastDjinnAt: string | null;
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
  const djinns = workspaces.flatMap((workspace) => workspace.djinns.filter((djinn) => djinn.host === name));
  const starts = djinns.flatMap((djinn) => (djinn.lastAt === null ? [] : [djinn.lastAt])).toSorted();
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
    djinns: djinns.length,
    djinnsLate: djinns.filter((djinn) => djinn.state === "late").length,
    lastDjinnAt: starts.at(-1) ?? null,
  };
}

/** The machines of the Machines page: every machine the ledgers know but the retired ones, this machine first, then any machine only the probe knows. */
export function machineNames(hosts: readonly FleetHost[], peers: readonly PeerHost[]): string[] {
  const known = hosts.filter((host) => !host.retired).map((host) => host.host);
  return [...known, ...peers.map((peer) => peer.host).filter((name) => !known.includes(name))];
}

function workspaceLink(name: string): Part {
  return link(name, { to: "overview", ws: name });
}

/** "(a, b, c, d and 3 more)": at most four names, each a link. */
function namesInBrackets(names: readonly string[]): Part[] {
  const shown = names.slice(0, SENTENCE_NAMES);
  const more = names.length - shown.length;
  const list = shown.flatMap((name, index) => (index === 0 ? [workspaceLink(name)] : [plain(", "), workspaceLink(name)]));
  return [plain(" ("), ...list, ...(more === 0 ? [] : [plain(` and ${String(more)} more`)]), plain(")")];
}

function stateParts(facts: MachineFacts): Part[] {
  const why = facts.reason === null ? "" : ` (${facts.reason})`;
  const seen = facts.lastSeen === null ? [plain(" Its ledgers hold no line of it.")] : [plain(" Its ledgers were last seen "), time(facts.lastSeen), plain(".")];
  const lastLine = facts.lastSeen === null ? [plain(" It has no ledger line here.")] : [plain(" Its last ledger line is "), age(facts.lastSeen), plain(" old.")];
  if (facts.self) return [plain(`${facts.name} is this machine, the one that serves this page.`)];
  if (facts.state === "online") return [plain(`${facts.name} is online.`)];
  if (facts.state === "unreachable" || facts.state === "offline") return [plain(`${facts.name} did not answer${why}.`), ...lastLine];
  if (facts.state === "checking") return [plain(`darius is still asking ${facts.name}.`), ...seen];
  return [plain(`darius did not ask ${facts.name}.`), ...seen];
}

function workspaceParts(facts: MachineFacts): Part[] {
  const copies = facts.copies.length === 0 ? "." : ` and shows a copy of ${String(facts.copies.length)}.`;
  if (facts.runs.length === 0) return [plain(` It runs no workspace${copies}`)];
  return [plain(` It runs ${counted(facts.runs.length, "workspace", "workspaces")}`), ...namesInBrackets(facts.runs), plain(copies)];
}

function openRunParts(facts: MachineFacts): Part[] {
  if (facts.openRuns === null) return [];
  const count = facts.openRuns.length;
  if (count === 0) return [plain(" No run is open now.")];
  return [plain(count === 1 ? " 1 run is open now." : ` ${String(count)} runs are open now.`)];
}

function djinnParts(facts: MachineFacts): Part[] {
  if (facts.djinns === 0) return [plain(" No djinn lives here.")];
  const lead = facts.djinns === 1 ? " 1 djinn lives here" : ` ${String(facts.djinns)} djinns live here`;
  if (facts.lastDjinnAt === null) return [plain(`${lead}; none has run yet.`)];
  return [plain(`${lead}; the last one ran `), time(facts.lastDjinnAt), plain(".")];
}

/**
 * The sentence at the top of a machine page: its state, the workspaces it
 * runs and shows, its open runs (only when it answered) and its djinns.
 * "host-b is online. It runs 2 workspaces (infra-notes, archive-2025) and
 * shows a copy of 1. No run is open now. 2 djinns live here; the last one ran 25 min ago."
 */
export function machineSentence(facts: MachineFacts): Part[] {
  return [...stateParts(facts), ...workspaceParts(facts), ...openRunParts(facts), ...djinnParts(facts)];
}

/** One thing on a machine that needs attention, with the command that fixes it when there is one. */
export interface Attention {
  text: string;
  command: string | null;
}

/** What needs attention on a machine, most urgent first; empty when nothing does. */
export function machineAttention(facts: MachineFacts, selfVersion: string | null): Attention[] {
  const items: Attention[] = [];
  const why = facts.reason === null ? "" : ` (${facts.reason})`;
  if (facts.state === "unreachable" || facts.state === "offline") items.push({ text: `Its darius serve did not answer${why}. Live facts show only while darius serve runs on that machine, and [setup] units must list web there.`, command: "darius setup --systemd" });
  if (facts.retired) items.push({ text: "It wrote no line in 30 days, so darius counts it as retired.", command: null });
  if (facts.differs && facts.version !== null) items.push({ text: `It runs darius ${facts.version}, and this machine runs ${selfVersion ?? "another version"}.`, command: "darius update --hosts" });
  if (facts.boxCheck !== null && facts.boxCheck.outcome !== "pass") items.push({ text: facts.boxCheck.outcome === "fail" ? "Its last box check failed." : `Its last box check ended ${facts.boxCheck.outcome}.`, command: "darius box check" });
  if (facts.backup?.state === "stale") items.push({ text: `Its backup is stale${facts.backup.reason === null ? "" : `: ${facts.backup.reason}`}.`, command: null });
  if (facts.backup?.state === "failed") items.push({ text: `Its last backup failed${facts.backup.error === null ? "" : `: ${facts.backup.error}`}.`, command: null });
  return items;
}

/** Whether a chip of the machine bar shows the "something to check" mark. The bar has only the probe data, so it looks at the items that data holds: a machine that did not answer, another darius version, a box check from its live facts. The backup, the retired mark and a box check of the ledgers need the ledgers, which the bar does not read, so the bar shows no number: it would disagree with the count on Machines. */
export function peerNeedsCheck(peer: PeerHost, selfVersion: string | null): boolean {
  return machineAttention(machineFacts({ name: peer.host, peer, host: undefined, workspaces: [], selfVersion }), selfVersion).length > 0;
}

// --- the block of the Machines page ----------------------------------------------------------------

/** At most this many djinns in a block, then "and n more". */
export const BLOCK_DJINNS = 8;

/** At most this many workspaces in a block, then "and n more". */
export const BLOCK_WORKSPACES = 6;

export interface MachineBlock {
  facts: MachineFacts;
  attention: Attention[];
  /** The workspaces that run here, worst health first, at most `BLOCK_WORKSPACES`. */
  runs: RunsHereRow[];
  /** How many workspaces that run here the block does not list. */
  moreRuns: number;
  /** The djinns that live here in the order of every djinn list (`sortDjinns`), at most `BLOCK_DJINNS`. */
  djinns: PlacedDjinn[];
  /** How many djinns the block does not list. */
  moreDjinns: number;
}

export interface BlockInput extends MachineInput {
  /** The newest run of each ritual (`FleetView.lastRuns`). */
  lastRuns: readonly FleetLast[];
  /** The runs open on this machine. */
  openRuns: readonly Pick<HostOpenRun, "project">[];
  /** The runs that ask a question nobody answered, as `project/run`. */
  asking: ReadonlySet<string>;
}

/** The djinns that live on a machine, each with its workspace and whether its last run asks you. */
export function machineDjinns(name: string, workspaces: readonly FleetWorkspace[], asking: ReadonlySet<string>): PlacedDjinn[] {
  return workspaces.flatMap((workspace) =>
    workspace.djinns.filter((djinn) => djinn.host === name).map((djinn) => ({ workspace: workspace.name, djinn, asks: djinn.lastRun !== null && asking.has(`${workspace.name}/${djinn.lastRun}`) })),
  );
}

/** Everything the block of one machine shows on the Machines page. */
export function machineBlock(input: BlockInput): MachineBlock {
  const facts = machineFacts(input);
  const runs = runsHereRows(input.name, input.workspaces, input.lastRuns, input.openRuns);
  const djinns = sortDjinns(machineDjinns(input.name, input.workspaces, input.asking));
  return {
    facts,
    attention: machineAttention(facts, input.selfVersion),
    runs: runs.slice(0, BLOCK_WORKSPACES),
    moreRuns: Math.max(0, runs.length - BLOCK_WORKSPACES),
    djinns: djinns.slice(0, BLOCK_DJINNS),
    moreDjinns: Math.max(0, djinns.length - BLOCK_DJINNS),
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

/** "3 runs are open now." over the machines that answered. */
export function openRunsLine(facts: readonly MachineFacts[]): string {
  const known = facts.filter((one) => one.openRuns !== null);
  const count = known.reduce((sum, one) => sum + (one.openRuns?.length ?? 0), 0);
  const where = known.length === facts.length ? "" : " on the machines that answered";
  if (count === 0) return `No run is open now${where}.`;
  return `${count === 1 ? "1 run is" : `${String(count)} runs are`} open now${where}.`;
}

/** "3" or "3, 1 unreachable": the count of the Machines row in Places. */
export function machinesRowText(split: StateSplit, count: number): string {
  return split.worst === null ? String(count) : `${String(count)}, ${split.worst}`;
}
