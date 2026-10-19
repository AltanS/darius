/**
 * How the page follows a start it asked for (a check, a run, a resume, a
 * follow-up). One light poll of `GET /api/pending?ids=a,b` replaces the
 * reload of whole pages: the answer holds the state of those registry
 * entries and nothing else. When a state changes, the page loads its data
 * once (silent: the shell gem ignores a reload, see `busy.ts`).
 *
 * Schedule: the first look 1.5 s after an id is followed, then every 3 s
 * until 1 minute after the earliest ask, then every 10 s, and nothing after
 * 15 minutes. It stops when every followed id has left `starting`, an
 * `unknown` id included. The server calls a start `lost` after 15 minutes
 * too, so the last look is the one that tells it.
 *
 * Several components may follow the same id: a module-level registry counts
 * them and runs one timer for all ids. The functions at the top are pure and
 * hold the rules; the store and the hook below hold the timer.
 */

import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { useRevalidator } from "react-router";

import type { PendingKind, PendingPollEntry, PendingState } from "../../../src/web/api.ts";

/** The first look after an id is followed. */
export const FIRST_LOOK_MS = 1500;
/** The time between looks in the first minute after the ask. */
export const FAST_LOOK_MS = 3000;
/** The fast looks last until this long after the earliest ask. */
export const FAST_WINDOW_MS = 60 * 1000;
/** The time between looks after the first minute. */
export const SLOW_LOOK_MS = 10 * 1000;
/** No look happens when the earliest ask is this old. */
export const GIVE_UP_MS = 15 * 60 * 1000;
/** The most ids in one poll (the server takes 50). */
export const MAX_IDS = 50;

/**
 * Milliseconds until the next look, or null when the page stops looking.
 * `looks` is the number of looks since the ids changed; `ageMs` is the time
 * since the earliest ask of the open ids.
 */
export function lookDelay(looks: number, ageMs: number): number | null {
  if (ageMs >= GIVE_UP_MS) return null;
  if (looks === 0) return FIRST_LOOK_MS;
  return ageMs < FAST_WINDOW_MS ? FAST_LOOK_MS : SLOW_LOOK_MS;
}

/** True while a start is not decided: no answer yet, or `starting`. */
export function isOpen(entry: PendingPollEntry | undefined): boolean {
  return entry === undefined || entry.state === "starting";
}

/** The stop rule: every id has an answer, and none is `starting`. An `unknown` id is decided. An empty list is decided. */
export function isSettled(ids: readonly string[], entries: ReadonlyMap<string, PendingPollEntry>): boolean {
  return ids.every((id) => !isOpen(entries.get(id)));
}

/** The age of the earliest ask among the open ids; 0 when none of them knows its time yet. */
export function earliestAge(ids: readonly string[], entries: ReadonlyMap<string, PendingPollEntry>, now: number): number {
  const asked = ids.flatMap((id) => {
    const entry = entries.get(id);
    return entry !== undefined && entry.state === "starting" ? [Date.parse(entry.at)] : [];
  });
  const earliest = Math.min(...asked.filter((time) => !Number.isNaN(time)));
  return Number.isFinite(earliest) ? Math.max(0, now - earliest) : 0;
}

/** The state an id had before this poll: an id with no answer yet was `starting`, since only those are followed. */
function stateBefore(entries: ReadonlyMap<string, PendingPollEntry>, id: string): PendingState | "unknown" {
  return entries.get(id)?.state ?? "starting";
}

/** True when any state of the answer differs from the one the page knew. */
export function hasChanged(entries: ReadonlyMap<string, PendingPollEntry>, starts: readonly PendingPollEntry[]): boolean {
  return starts.some((start) => start.state !== stateBefore(entries, start.id));
}

function isState(value: string): value is PendingState {
  return value === "starting" || value === "started" || value === "refused" || value === "lost";
}

function isKind(value: string): value is PendingKind {
  return value === "follow-up" || value === "run-now" || value === "resume" || value === "vigil-check";
}

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

function isRecord(value: Json | undefined): value is { [key: string]: Json } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isText(value: Json | undefined): value is string {
  return typeof value === "string";
}

function text(value: Json | undefined): string | null {
  return isText(value) && value !== "" ? value : null;
}

/** Reads the body of `GET /api/pending`: the entries it holds, or null when the body is not the answer. An entry that is not readable is left out. */
export function readPoll(body: string): PendingPollEntry[] | null {
  let parsed: Json;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || parsed.ok !== true || !Array.isArray(parsed.starts)) return null;
  const out: PendingPollEntry[] = [];
  for (const entry of parsed.starts) {
    if (!isRecord(entry)) continue;
    const id = text(entry.id);
    const state = text(entry.state);
    if (id === null || state === null) continue;
    if (state === "unknown") {
      out.push({ id, state });
      continue;
    }
    const host = text(entry.host);
    const at = text(entry.at);
    const project = text(entry.project);
    const kind = text(entry.kind);
    if (!isState(state) || kind === null || !isKind(kind) || host === null || at === null || project === null) continue;
    const known: PendingPollEntry = { id, state, host, at, kind, project, item: text(entry.item) ?? "" };
    const run = text(entry.run);
    if (run !== null) known.run = run;
    out.push(known);
  }
  return out;
}

// --- the registry ---------------------------------------------------------------------------

/** What the page knows of each followed id. Entries stay after the last follower leaves, so a card that comes back shows its last state at once. */
const entries = new Map<string, PendingPollEntry>();
/** How many components follow each id. */
const refs = new Map<string, number>();
const listeners = new Set<() => void>();
/** One function for each mounted hook; the first one loads the data again. */
const loaders = new Set<() => void>();
let version = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
let looks = 0;
let inflight = false;

function emit(): void {
  version += 1;
  for (const listener of listeners) listener();
}

function openIds(): string[] {
  return [...refs.keys()].filter((id) => isOpen(entries.get(id)));
}

function loadAgain(): void {
  const first = loaders.values().next();
  if (first.done !== true) first.value();
}

/** Plans the next look from the open ids, or stops when there is none. */
function plan(): void {
  clearTimeout(timer);
  timer = undefined;
  const open = openIds();
  if (open.length === 0) {
    looks = 0;
    return;
  }
  const delay = lookDelay(looks, earliestAge(open, entries, Date.now()));
  if (delay !== null) timer = setTimeout(() => void look(), delay);
}

async function fetchPoll(ids: readonly string[]): Promise<PendingPollEntry[] | null> {
  try {
    const response = await fetch(`/api/pending?ids=${ids.map(encodeURIComponent).join(",")}`, { headers: { accept: "application/json" }, cache: "no-store" });
    return readPoll(await response.text());
  } catch {
    return null;
  }
}

/** One look. A page in the background asks nothing; the minute refresh and the return to the page cover it. */
async function look(): Promise<void> {
  timer = undefined;
  const open = openIds().slice(0, MAX_IDS);
  if (open.length === 0 || inflight) return;
  // The timer runs in a browser only, so `document` exists.
  if (document.hidden) {
    looks += 1;
    plan();
    return;
  }
  inflight = true;
  const answer = await fetchPoll(open);
  inflight = false;
  looks += 1;
  if (answer !== null) {
    const changed = hasChanged(entries, answer);
    for (const start of answer) entries.set(start.id, start);
    if (changed) {
      emit();
      loadAgain();
    }
  }
  plan();
}

function follow(ids: readonly string[]): void {
  const before = new Set(openIds());
  for (const id of ids) refs.set(id, (refs.get(id) ?? 0) + 1);
  if (openIds().some((id) => !before.has(id))) looks = 0;
  plan();
}

function unfollow(ids: readonly string[]): void {
  for (const id of ids) {
    const count = (refs.get(id) ?? 0) - 1;
    if (count > 0) refs.set(id, count);
    else refs.delete(id);
  }
  plan();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Puts the entry of a start into the registry before any poll: a POST reply
 * names the id, the host and the time, so the page shows the state at once.
 * Call it before the component that follows the id renders.
 */
export function seedStart(start: Extract<PendingPollEntry, { host: string }>): void {
  entries.set(start.id, start);
  emit();
}

/** The id of a start in the `start-<id>` form of a Now row. */
export function startIdOf(rowId: string): string {
  return rowId.startsWith("start-") ? rowId.slice("start-".length) : rowId;
}

const NO_IDS: readonly string[] = [];

/**
 * Follows the starts with these ids and returns what the page knows of each
 * (an id with no answer yet is absent from the map). Two components that
 * follow the same id share one timer. When a state changes, the data of the
 * page loads once. Pass only ids that can still change; an empty list
 * follows nothing.
 */
export function useFollowStarts(ids: readonly string[]): ReadonlyMap<string, PendingPollEntry> {
  const { revalidate } = useRevalidator();
  const again = useRef(revalidate);
  again.current = revalidate;
  const key = [...new Set(ids)].toSorted().join(",");
  const list = useMemo(() => (key === "" ? NO_IDS : key.split(",")), [key]);
  useEffect(() => {
    const load = (): void => void again.current();
    loaders.add(load);
    return () => {
      loaders.delete(load);
    };
  }, []);
  useEffect(() => {
    if (list.length === 0) return;
    follow(list);
    return () => unfollow(list);
  }, [list]);
  const seen = useSyncExternalStore(subscribe, () => version, () => 0);
  return useMemo(() => {
    const known = new Map<string, PendingPollEntry>();
    for (const id of list) {
      const entry = entries.get(id);
      if (entry !== undefined) known.set(id, entry);
    }
    return known;
    // `seen` is the version of the registry: a new answer builds a new map.
  }, [list, seen]);
}
