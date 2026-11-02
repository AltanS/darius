/**
 * The candles of the Candles place (0.112.0), as plain functions: which rows a
 * view keeps, the words of a state, a decision, a history step and a delivery
 * line, and the bodies of the two writes. Pure, so the pages and the tests
 * share it. Every text in a candle comes from a run, a script or a person, so
 * the pages draw it as text only.
 *
 * The page has two views, both in the address (`?view=`): `lit` (the default)
 * and `all`, which adds the answered, the accepted and the ones that are out. There
 * are no other filters in this version.
 */

import type { CandleDelivery, CandleRow, CandleRowStatus, CandleStep } from "../../../src/web/api.ts";
import type { PostBody } from "./post.ts";
import { hostDate, shortDate, whenText } from "./format.ts";
import { href } from "./paths.ts";
import type { Badge } from "./tone.ts";

export type CandleView = "lit" | "all";

export const DEFAULT_VIEW: CandleView = "lit";

/** The query of an address. Any word but `all` is the default view, so an old or a hand-made link never shows an empty page. */
export function readView(params: { get(name: string): string | null }): CandleView {
  return params.get("view") === "all" ? "all" : DEFAULT_VIEW;
}

/** The address of a view on the Candles place of `ws` (null: all workspaces); the default view has no query. */
export function candlesHref(ws: string | null, view: CandleView): string {
  return href({ to: "section", ws, section: "candles", query: view === DEFAULT_VIEW ? {} : { view } });
}

const STATUS_ORDER: readonly CandleRowStatus[] = ["lit", "answered", "accepted", "out"];

/** The rows a view keeps: the lit ones, or every row. Lit first, then answered, accepted and out; worst first in each. */
export function filterCandles(rows: readonly CandleRow[], view: CandleView): CandleRow[] {
  const kept = view === "all" ? rows : rows.filter((row) => row.status === "lit");
  return kept.toSorted((left, right) => STATUS_ORDER.indexOf(left.status) - STATUS_ORDER.indexOf(right.status) || worstFirst(left, right));
}

const WORST_FIRST = ["critical", "high", "medium", "low", "info"];

/** Worst severity first, then the newest report; the rest keeps its order. For rows of several projects, which the host sorts one project at a time. */
export function worstFirst(left: CandleRow, right: CandleRow): number {
  const bySeverity = WORST_FIRST.indexOf(left.severity) - WORST_FIRST.indexOf(right.severity);
  if (bySeverity !== 0) return bySeverity;
  return right.lastSeen.at.localeCompare(left.lastSeen.at);
}

export function litCount(rows: readonly CandleRow[]): number {
  return rows.filter((row) => row.status === "lit").length;
}

/** The line of an empty page. `hasClosed` says that the other view holds rows. */
export function emptyText(view: CandleView, hasClosed: boolean): string {
  if (view === "all") return "No candles yet.";
  return hasClosed ? "No candle is lit." : "No candle has been lit.";
}

/** The sentence under the title of the list page. */
export function viewText(view: CandleView, scope: string | null): string {
  const where = scope === null ? "every workspace" : scope;
  return view === "all" ? `All candles in ${where}, the lit ones first.` : `The lit candles in ${where}, worst first.`;
}

const STATUS_BADGES = {
  lit: { tone: "wait", label: "Lit" },
  answered: { tone: "ok", label: "Answered" },
  accepted: { tone: "idle", label: "Accepted" },
  out: { tone: "ok", label: "Out" },
} as const satisfies Record<CandleRowStatus, Badge>;

/** The state word of a candle. */
export function statusBadge(status: CandleRowStatus): Badge {
  return STATUS_BADGES[status];
}

/** "seen 1 time", "seen 5 times". */
export function seenText(reports: number): string {
  return `seen ${reports} ${reports === 1 ? "time" : "times"}`;
}

/** "first seen 3 h ago", "first seen 27 Sep". */
export function firstSeenText(row: Pick<CandleRow, "firstSeen">, now: number, offset: number): string {
  return `first seen ${whenText(row.firstSeen.at, now, offset)}`;
}

// --- where a candle came from ----------------------------------------------------------------

/** The slug in a source of the form `<prefix>:<slug>`, or null. */
function slugAfter(source: string, prefix: string): string | null {
  if (!source.startsWith(`${prefix}:`)) return null;
  const slug = source.slice(prefix.length + 1);
  return slug === "" ? null : slug;
}

/** The slug of the vigil a source names (`vigil:<slug>`), or null. */
export function vigilOfSource(source: string): string | null {
  return slugAfter(source, "vigil");
}

/** The slug of the ritual a source names (`ritual:<slug>`), or null. */
export function ritualOfSource(source: string): string | null {
  return slugAfter(source, "ritual");
}

/** True when the newest report came from a run: only then can an answer start a follow-up. */
export function cameFromRun(row: Pick<CandleRow, "run" | "ritual">): boolean {
  return row.run !== undefined && row.ritual !== undefined;
}

// --- what the person can do -----------------------------------------------------------------

/** An answer closes a lit candle. An answered candle needs a relight first, which the web does not offer. */
export function canAnswer(row: Pick<CandleRow, "status">): boolean {
  return row.status === "lit";
}

/** An accept closes a lit or an answered candle. */
export function canAccept(row: Pick<CandleRow, "status">): boolean {
  return row.status === "lit" || row.status === "answered";
}

/** The sentence shown before the tap on "Accept risk" when the candle belongs to a vigil; null for any other candle. */
export function acceptWarning(row: Pick<CandleRow, "source">): string | null {
  const slug = vigilOfSource(row.source);
  return slug === null ? null : `Accepting this risk also closes the vigil ${slug}.`;
}

/** What the loopback viewer reads where the buttons would be. */
export const NO_WRITE_TEXT = "No buttons here: this page was opened from this host. To answer or accept, open the page by its tailnet name.";

export const NOTE_MAX = 500;

/** The line that replaces the buttons after the reply. */
export const RECEIPTS = { answer: "Answer saved.", accept: "Risk accepted." } as const satisfies Record<"answer" | "accept", string>;

/** The body of `POST /api/candle/answer`. */
export function answerBody(row: Pick<CandleRow, "project" | "key">, note: string, followUp: boolean): PostBody {
  const base = { project: row.project, key: row.key, note: note.trim() };
  return followUp ? { ...base, followUp: true } : base;
}

/** The body of `POST /api/candle/accept`; an empty note is left out. */
export function acceptBody(row: Pick<CandleRow, "project" | "key">, note: string): PostBody {
  const trimmed = note.trim();
  const base = { project: row.project, key: row.key };
  return trimmed === "" ? base : { ...base, note: trimmed };
}

// --- the words of the detail page -----------------------------------------------------------

/** The note of an event as a tail: ": known issue", or nothing. */
function noteTail(note: string | undefined): string {
  return note === undefined || note === "" ? "" : `: ${note}`;
}

/** "Answered by web:altan on 27 Sep: patched on the next release." One line per decision in force; empty when the candle is lit. */
export function decisionLines(row: CandleRow, offset: number): string[] {
  const day = (iso: string): string => shortDate(hostDate(iso, offset));
  const lines: string[] = [];
  if (row.answered !== undefined) lines.push(`Answered by ${row.answered.who} on ${day(row.answered.at)}${noteTail(row.answered.note)}`);
  if (row.accepted !== undefined) lines.push(`Risk accepted by ${row.accepted.who} on ${day(row.accepted.at)}${noteTail(row.accepted.note)}`);
  if (row.blownOut !== undefined) lines.push(`Blown out by ${row.blownOut.who} on ${day(row.blownOut.at)}${noteTail(row.blownOut.note)}`);
  return lines;
}

/** The follow-up run an answer started, or null. */
export function followUpRun(row: Pick<CandleRow, "answered">): string | null {
  return row.answered?.followUpRun ?? null;
}

/** Said in words when a report came after the candle was closed and did not light it again. */
export function stillReportedText(row: Pick<CandleRow, "stillReported" | "status">): string | null {
  if (!row.stillReported || row.status === "lit" || row.status === "out") return null;
  return "The problem was reported again after you closed this candle. The report was not worse, so the candle stays closed.";
}

/** The state of the problem when the candle is out, in words; null otherwise. */
export function outText(row: Pick<CandleRow, "status" | "blownOut">): string | null {
  if (row.status !== "out") return null;
  return row.blownOut === undefined ? "The runs that watch for this problem stopped reporting it." : null;
}

/** One step of the history, dated on the host's calendar. */
export function stepText(step: CandleStep, offset: number): string {
  const date = shortDate(hostDate(step.at, offset));
  const by = step.who === undefined ? "" : ` by ${step.who}`;
  const tail = noteTail(step.note);
  switch (step.kind) {
    case "lit":
      return `${date}, lit at ${step.severity}${by}`;
    case "report":
      return `${date}, reported again, ${step.severity}`;
    case "raised":
      return `${date}, raised to ${step.severity}`;
    case "answered":
      return `${date}, answered${by}${tail}`;
    case "accepted":
      return `${date}, risk accepted${by}${tail}`;
    case "blown-out":
      return `${date}, blown out${step.who === undefined ? " by a run that reported it fixed" : by}${tail}`;
    case "relit":
      return `${date}, relit${by}${tail}`;
    case "out":
      return `${date}, out: the runs that watch for it stopped reporting it`;
  }
}

/** The key of a step in a list. */
export function stepKey(step: CandleStep, index: number): string {
  return `${index}-${step.kind}-${step.at}`;
}

// --- delivery -------------------------------------------------------------------------------

const CHANNEL_WORDS = { push: "Push", email: "Email" } as const satisfies Record<CandleDelivery["channel"], string>;

/** A notice that failed this many times is not sent again (MAX_TRIES in src/core/alerts.ts; the app may not import it at run time). */
export const GAVE_UP_AFTER = 3;

/** The ledger's own reason when a channel is not set up on the host that wrote the notice. */
const NOT_SET_UP = "not set up on host";

/** One delivery line: "Push: sent from host-a on 27 Sep.", "Email: not set up on host-b.", "Email: not sent yet." */
export function deliveryText(delivery: CandleDelivery, offset: number): string {
  const channel = CHANNEL_WORDS[delivery.channel];
  const host = delivery.host === undefined ? "the host" : delivery.host;
  const day = delivery.at === undefined ? "" : ` on ${shortDate(hostDate(delivery.at, offset))}`;
  if (delivery.state === "sent") return `${channel}: sent from ${host}${day}.`;
  if (delivery.state === "waiting") return `${channel}: not sent yet.`;
  if (delivery.reason === NOT_SET_UP) return `${channel}: not set up on ${host}.`;
  const tries = delivery.tries >= GAVE_UP_AFTER ? `not sent after ${delivery.tries} tries` : `not sent yet, ${delivery.tries} ${delivery.tries === 1 ? "try" : "tries"} so far`;
  return `${channel}: ${tries}${delivery.reason === undefined ? "" : `. ${delivery.reason}`}${delivery.reason?.endsWith(".") === true ? "" : "."}`;
}

/** The line when no channel is named: the candle delivers to the app only. */
export const APP_ONLY_TEXT = "App only. No alert goes out.";
