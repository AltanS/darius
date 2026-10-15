/**
 * The Runs list filters (0.93.0): which runs a filter keeps, and the words
 * that describe it. Pure: the loader passes the runs and the parsed filter
 * (`runsFilterOf` in paths.ts). The filter of a run page link is built by
 * `runsQuery`, so the same text round-trips.
 */

import type { RunRow } from "../../../src/web/api.ts";
import type { RunsFilter } from "./paths.ts";
import { ackKindOf } from "./result.ts";
import { isOpenAsk } from "./view.ts";

/** True when the run closed with this outcome, or is in this phase. `held` and `running` are phases; anything else is an outcome. */
function stateMatches(run: RunRow, state: string): boolean {
  if (state === "") return true;
  if (state === "held" || state === "running") return run.phase === state;
  return run.phase === "closed" && run.outcome === state;
}

/** `follow-up`: it follows a run up. `scheduled`: no follow-up, and the timer started it. `manual`: no follow-up, and a hand started it (the web, the CLI). */
function kindMatches(run: RunRow, kind: RunsFilter["kind"]): boolean {
  if (kind === "") return true;
  if (kind === "follow-up") return run.followUpOf !== null;
  if (run.followUpOf !== null) return false;
  return kind === "scheduled" ? run.startedBy === "timer" : run.startedBy !== "timer";
}

/**
 * `answered` and `dismissed` read the first acknowledgement (`ackKindOf`) of a
 * run that asked a question: the "seen it" ack of a failed run is neither.
 * `open` is a complete run that asked a question nobody answered or
 * dismissed (`isOpenAsk`): it also lists an ask that a newer run replaced,
 * since no person decided on it.
 */
function ackMatches(run: RunRow, ack: RunsFilter["ack"]): boolean {
  if (ack === "") return true;
  if (ack === "open") return isOpenAsk(run);
  return (run.result?.questions ?? 0) > 0 && ackKindOf(run) === ack;
}

/** True when the run passes every part of the filter. `imported` is not here: the list drops imported runs before it filters. */
export function runMatches(run: RunRow, filter: RunsFilter): boolean {
  return stateMatches(run, filter.state) && kindMatches(run, filter.kind) && (filter.by === "" || run.startedBy === filter.by) && ackMatches(run, filter.ack);
}

const KIND_WORDS = { "": "", "follow-up": "follow-up ", scheduled: "scheduled ", manual: "manual " } as const satisfies Record<RunsFilter["kind"], string>;
const BY_WORDS = { "": "", web: ", started from the web", timer: ", started by the timer", cli: ", started from the command line" } as const satisfies Record<RunsFilter["by"], string>;
const ACK_PHRASES = { "": "", answered: ", answered", dismissed: ", dismissed", open: ", still open" } as const satisfies Record<RunsFilter["ack"], string>;

function capital(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** What the filter lists, by state and kind: "Held follow-up runs", "Runs still running", "All runs". */
function subject(filter: RunsFilter): string {
  const runs = `${KIND_WORDS[filter.kind]}runs`;
  if (filter.state === "") return filter.kind === "" ? "All runs" : capital(runs);
  if (filter.state === "running") return `${capital(runs)} still running`;
  if (filter.state === "held" || filter.state === "complete" || filter.state === "failed" || filter.state === "abandoned") return `${capital(filter.state)} ${runs}`;
  return `${capital(runs)} that ended ${filter.state}`;
}

/** The filter in words: "Held follow-up runs of every workspace, started from the web, answered, newest first." */
export function filterSentence(filter: RunsFilter, project: string): string {
  const where = project === "" ? " of every workspace" : ` in ${project}`;
  const imported = filter.imported ? ", imported runs included" : "";
  return `${subject(filter)}${where}${BY_WORDS[filter.by]}${ACK_PHRASES[filter.ack]}${imported}, newest first.`;
}
