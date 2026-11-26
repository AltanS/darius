/**
 * What needs a look (0.143.0): the short list at the top of a machine block
 * and a machine page, and the headline of the Machines page that counts it.
 * One item per problem, each one sentence with the cause and the next step:
 * a ritual that waits for your answer, one whose last run failed, one that
 * is late, and what is wrong with the machine itself. Workspace health
 * stays in the workspace table.
 * Pure: the tests read the sentences as plain text.
 */

import type { FleetDjinn, PeerState } from "../../../src/web/api.ts";
import { shortDate } from "./format.ts";
import { shownReasons } from "./fleet.ts";
import { withProblems, type PlacedRitual, type RitualProblem } from "./lists.ts";
import type { Attention, AttentionKey } from "./machines.ts";
import type { Section, Target } from "./paths.ts";
import type { NeedPart } from "./home.ts";
import { age, counted, link, plain, time, type Part } from "./sentence.ts";
import { MACHINE_PAGE_TERMS as TERM_ORDER, TERMS, type TermKey } from "./terms.ts";

export type LookKind = RitualProblem | "machine";

/** One problem, as one item of the list. */
export interface LookItem {
  kind: LookKind;
  /** The machine it is on. */
  machine: string;
  /** For a machine item, what is wrong; null otherwise. */
  cause: AttentionKey | null;
  /** The anchor of the item, unique on the page: the headline links to it. */
  id: string;
  /** "Waits for your answer", "Late", "Failing". */
  lead: string;
  /** The sentence after the lead: what and why. */
  parts: Part[];
  /** The command that fixes a machine item, when one does. */
  command: string | null;
  /** The next step: the link that covers the whole item. Null on a machine page for a machine item. */
  action: { text: string; to: Target } | null;
  /** The words the sentence uses that the block explains under the list. */
  glossed: TermKey[];
}

const LEADS = { waits: "Waits for your answer", failed: "Failed", late: "Late" } as const satisfies Record<RitualProblem, string>;

/** "complete" reads "completed", "abandoned" reads "was abandoned". */
function endedPhrase(outcome: string | null): string {
  if (outcome === null || outcome === "running") return "started";
  if (outcome === "held") return "stopped to ask";
  if (outcome === "complete") return "completed";
  if (outcome === "failed") return "failed";
  if (outcome === "abandoned") return "was abandoned";
  return `ended ${outcome}`;
}

function ritualTarget(placed: PlacedRitual): Target {
  return { to: "ritual", ws: placed.workspace, slug: placed.ritual.slug };
}

function runTarget(placed: PlacedRitual): Target | null {
  return placed.ritual.lastRun === null ? null : { to: "run", ws: placed.workspace, run: placed.ritual.lastRun };
}

function anchor(...words: string[]): string {
  return ["look", ...words].join("-").replaceAll(/[^A-Za-z0-9_-]+/gu, "_");
}

/** Since when a late ritual is late: its due time, or the start of its due day; null when it is not late. */
function lateSince(ritual: FleetDjinn): string | null {
  if (ritual.state !== "late") return null;
  if (ritual.nextDueAt !== null) return ritual.nextDueAt;
  return ritual.nextDue === null ? null : `${ritual.nextDue}T00:00:00.000Z`;
}

function ritualItem(machine: string, placed: PlacedRitual & { problem: RitualProblem }): LookItem {
  const { ritual, workspace, problem } = placed;
  const head = [plain(`${ritual.title}, ${workspace}. `)];
  const base = { kind: problem, machine, cause: null, id: anchor(machine, problem, workspace, ritual.slug), lead: LEADS[problem], command: null, glossed: [] };
  const run = runTarget(placed);
  if (problem === "waits") {
    const asked = placed.ask === null ? [plain("Its run stopped to ask you.")] : [plain(`It asked ${counted(placed.ask.questions, "question", "questions")} `), time(placed.ask.at), plain(".")];
    return { ...base, parts: [...head, ...asked], action: { text: "Answer", to: run ?? ritualTarget(placed) } };
  }
  if (problem === "failed") {
    const failed = ritual.lastAt === null ? [plain("Its last run failed")] : [plain("Its last run failed "), time(ritual.lastAt)];
    const since = lateSince(ritual);
    // A ritual that failed and is late says both, under the worse word.
    const when = since === null ? [...failed, plain(".")] : [...failed, plain(", and it has been late for "), age(since), plain(".")];
    return { ...base, parts: [...head, ...when], action: run === null ? { text: "Open ritual", to: ritualTarget(placed) } : { text: "Open run", to: run } };
  }
  const due = ritual.nextDueAt === null ? (ritual.nextDue === null ? [plain("It is late")] : [plain(`It was due on ${shortDate(ritual.nextDue)}`)]) : [plain("Due "), time(ritual.nextDueAt)];
  const last = ritual.lastAt === null ? [plain("; it has not run yet.")] : [plain(`; its last run ${endedPhrase(ritual.lastOutcome)} `), time(ritual.lastAt), plain(".")];
  return { ...base, parts: [...head, ...due, ...last], action: { text: "Open ritual", to: ritualTarget(placed) } };
}

/** Where a reason of a workspace points, and the word it explains. */
interface ReasonTarget {
  to: Target | null;
  term: TermKey | null;
}

/** Where a reason of a workspace points, and the word it explains: "2 vigils flagged" goes to the vigils. */
function reasonTarget(reason: string, ws: string): ReasonTarget {
  const section = (name: Section, query?: Record<string, string>): Target => (query === undefined ? { to: "section", ws, section: name } : { to: "section", ws, section: name, query });
  if (/\bcandles?\b/u.test(reason)) return { to: section("candles"), term: "candle" };
  if (/\bvigils?\b/u.test(reason)) return { to: section("vigils"), term: "vigil" };
  if (/\bfindings?\b/u.test(reason)) return { to: section("findings"), term: "finding" };
  if (/\bruns? (held|waits?)\b/u.test(reason)) return { to: section("runs", { state: "held" }), term: null };
  if (/\b(rituals?|runs?)\b/u.test(reason)) return { to: section("rituals"), term: null };
  return { to: null, term: null };
}

/** The reasons of a workspace as sentence parts, the words they explain, and how many reasons it left out. */
export interface ReasonParts {
  parts: Part[];
  glossed: TermKey[];
  /** The reasons after the first `max`: the caller says "and n more". */
  more: number;
}

/** At most this many reasons of a workspace in a list (0.143.0): the worst ones, in the order of the health rules. */
export const MAX_REASONS = 3;

/** The reasons of a workspace, each a link when it has a place to go; a vigil or a candle reason carries the definition in its title. */
export function reasonParts(reasons: readonly string[], ws: string, capitalFirst = false, max = MAX_REASONS): ReasonParts {
  const glossed: TermKey[] = [];
  const { shown, more } = shownReasons(reasons, max);
  const parts: Part[] = [];
  for (const [index, phrase] of shown.entries()) {
    // With more to come, the list goes on with ", "; "and n more" follows it.
    if (index > 0) parts.push(plain(index === shown.length - 1 && more === 0 ? " and " : ", "));
    // The first reason starts a sentence.
    const reason = index === 0 && capitalFirst ? phrase.charAt(0).toUpperCase() + phrase.slice(1) : phrase;
    const { to, term } = reasonTarget(reason, ws);
    if (term !== null && !glossed.includes(term)) glossed.push(term);
    if (to === null) parts.push(plain(reason));
    if (to !== null) parts.push(term === null ? link(reason, to) : link(reason, to, `${TERMS[term].word}: ${TERMS[term].definition}`));
  }
  return { parts, glossed, more };
}

function machineItem(machine: string, item: Attention, page: "machines" | "machine"): LookItem {
  return {
    kind: "machine",
    machine,
    cause: item.key,
    id: anchor(machine, item.key),
    lead: item.lead,
    parts: [plain(item.text)],
    command: item.command,
    action: page === "machine" ? null : { text: "Open machine", to: { to: "machine", host: machine, hash: "look" } },
    glossed: item.key === "sandbox" ? ["sandboxCheck"] : [],
  };
}

export interface LookInput {
  machine: string;
  /** The rituals darius starts on the machine. */
  rituals: readonly PlacedRitual[];
  /** What is wrong with the machine itself (`machineAttention`). */
  attention: readonly Attention[];
  /** The page the list is on: a machine item links to the machine page only from the Machines page. */
  page: "machines" | "machine";
}

/**
 * What needs a look on a machine, concrete and one action each, in this
 * order: the rituals that wait for your answer, the ones whose last run
 * failed, the late ones (each the oldest due first), then the machine
 * itself. Workspace health stays in the workspace table (0.143.0).
 */
export function lookItems({ machine, rituals, attention, page }: LookInput): LookItem[] {
  return [...withProblems(rituals).map((placed) => ritualItem(machine, placed)), ...attention.map((item) => machineItem(machine, item, page))];
}

// --- what the need-you count of a workspace is made of ----------------------------------------------

const NEED_WORDS = {
  answer: { one: "run to answer", many: "runs to answer", section: "runs", term: "run" },
  failed: { one: "failed ritual", many: "failed rituals", section: "rituals", term: "ritual" },
  stuck: { one: "stuck run", many: "stuck runs", section: "runs", term: "run" },
  vigil: { one: "flagged vigil", many: "flagged vigils", section: "vigils", term: "vigil" },
  candle: { one: "lit candle", many: "lit candles", section: "candles", term: "candle" },
  unreadable: { one: "unreadable store", many: "unreadable stores", section: null, term: null },
} as const satisfies Record<NeedPart["kind"], { one: string; many: string; section: Section | null; term: TermKey | null }>;

/**
 * The Why of a workspace that needs you: its need-you count, then exactly
 * what that count is made of, each part a link to its section. The parts
 * sum to the count: "5 items need you: 2 runs to answer, 2 flagged vigils,
 * 1 lit candle". Empty with no part.
 */
export function needParts(parts: readonly NeedPart[], ws: string): ReasonParts {
  const total = parts.reduce((sum, part) => sum + part.count, 0);
  if (total === 0) return { parts: [], glossed: [], more: 0 };
  const glossed: TermKey[] = [];
  const out: Part[] = [plain(`${counted(total, "item needs", "items need")} you: `)];
  for (const [index, part] of parts.entries()) {
    const words = NEED_WORDS[part.kind];
    if (index > 0) out.push(plain(", "));
    const text = `${String(part.count)} ${part.count === 1 ? words.one : words.many}`;
    if (words.term !== null && (words.term === "vigil" || words.term === "candle") && !glossed.includes(words.term)) glossed.push(words.term);
    out.push(words.section === null ? plain(text) : link(text, { to: "section", ws, section: words.section }));
  }
  return { parts: out, glossed, more: 0 };
}

/** The words the items of a list explain, once each, in the order of the terms. */
export function glossedTerms(items: readonly LookItem[]): TermKey[] {
  const used = new Set(items.flatMap((item) => item.glossed));
  return TERM_ORDER.filter((key) => used.has(key));
}

// --- the headline of the Machines page ---------------------------------------------------------

function isOnline(state: PeerState | null): boolean {
  return state === "self" || state === "online";
}

function itemLink(text: string, item: LookItem | undefined): Part {
  return item === undefined ? plain(text) : link(text, { to: "host", page: "machines", hash: item.id });
}

/** "host-b runs another darius version." One short sentence per machine problem; a machine name keeps its case. */
const PROBLEM_WORDS = {
  unreachable: (machine) => `${machine} did not answer`,
  retired: (machine) => `${machine} counts as retired`,
  version: (machine) => `${machine} runs another darius version`,
  sandbox: (machine) => `${machine} failed its sandbox check`,
  "backup-stale": (machine) => `The backup of ${machine} is stale`,
  "backup-failed": (machine) => `The last backup of ${machine} failed`,
} as const satisfies Record<AttentionKey, (machine: string) => string>;

/** At most this many machine problems are named one sentence each; more are one sentence that names the machines. */
const NAMED_PROBLEMS = 2;

/** The machines: "Both machines are online." or "1 of 2 machines is online.", then each machine problem: "host-b runs another darius version." */
function machineParts(items: readonly LookItem[], states: readonly (PeerState | null)[]): Part[] {
  const total = states.length;
  const online = states.filter(isOnline).length;
  const problems = items.filter((item) => item.kind === "machine");
  const lead: Part[] = [];
  if (online === total) lead.push(plain(total === 1 ? "The machine is online." : total === 2 ? "Both machines are online." : `All ${String(total)} machines are online.`));
  if (online < total && total === 1) lead.push(plain("The machine is not online."));
  if (online < total && total > 1) lead.push(plain(`${String(online)} of ${counted(total, TERMS.machine.word, TERMS.machine.plural)} ${online === 1 ? "is" : "are"} online.`));
  if (problems.length <= NAMED_PROBLEMS) {
    for (const item of problems) {
      const words = item.cause === null ? `${item.machine} has a problem` : PROBLEM_WORDS[item.cause](item.machine);
      lead.push(plain(" "), itemLink(words, item), plain("."));
    }
    return lead;
  }
  const machines = [...new Set(problems.map((item) => item.machine))];
  const names = machines.flatMap((machine, index) => [plain(index === 0 ? "" : ", "), itemLink(machine, problems.find((item) => item.machine === machine))]);
  return [...lead, plain(` ${String(problems.length)} machine problems need a look: `), ...names, plain(".")];
}

/** The block of a machine on the Machines page. */
function block(machine: string): Target {
  return { to: "host", page: "machines", hash: `machine-${machine}` };
}

/**
 * The rituals, by machine, so each part maps to a block: "6 rituals need a
 * look: 2 on host-a, 4 on host-b." All on one machine: "3 rituals need a
 * look, all on host-b." A page with one machine: "3 rituals need a look."
 * Nothing: "All 19 rituals are on schedule." The kinds are read in the block.
 */
function ritualParts(items: readonly LookItem[], onSchedule: number, machineCount: number): Part[] {
  const rituals = items.filter((item) => item.kind !== "machine");
  if (rituals.length === 0) {
    if (onSchedule === 0) return [plain(` darius starts no ${TERMS.ritual.word}.`)];
    return [plain(onSchedule === 1 ? " The 1 ritual is on schedule." : ` All ${String(onSchedule)} ${TERMS.ritual.plural} are on schedule.`)];
  }
  const lead = `${counted(rituals.length, TERMS.ritual.word, TERMS.ritual.plural)} ${rituals.length === 1 ? "needs" : "need"} a look`;
  const machines = [...new Set(rituals.map((item) => item.machine))];
  const [only] = machines;
  if (machineCount === 1 && only !== undefined) return [plain(" "), link(lead, block(only)), plain(".")];
  if (machines.length === 1 && only !== undefined) return [plain(` ${lead}, `), link(`all on ${only}`, block(only)), plain(".")];
  const parts = machines.flatMap((machine, index) => [plain(index === 0 ? "" : ", "), link(`${String(rituals.filter((item) => item.machine === machine).length)} on ${machine}`, block(machine))]);
  return [plain(` ${lead}: `), ...parts, plain(".")];
}

export interface HeadlineInput {
  /** Every item of every machine block, in page order. */
  items: readonly LookItem[];
  /** The state of every machine on the page. */
  states: readonly (PeerState | null)[];
  /** The rituals on schedule over every machine. */
  onSchedule: number;
}

/**
 * The headline of the Machines page: the machines first, each machine
 * problem named, then the rituals by machine, each part a link to its item
 * or its block. "Both machines are online. host-b runs another darius
 * version. 6 rituals need a look: 2 on host-a, 4 on host-b." Nothing wrong:
 * "Both machines are online. All 19 rituals are on schedule." Workspace health is not counted here: the workspace tables
 * and Places carry it, with the one need-you count of each workspace.
 */
export function machinesHeadline({ items, states, onSchedule }: HeadlineInput): Part[] {
  return [...machineParts(items, states), ...ritualParts(items, onSchedule, states.length)];
}
