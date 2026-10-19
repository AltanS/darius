/**
 * Is the host there? One module store answers it for the whole page: the
 * strip, the probe and `postJson` read the same state.
 *
 * Liveness is "did the last read succeed", never `navigator.onLine`. The
 * service worker says "stale" when it served a saved copy and "fresh" when
 * the network answered; a POST that got no answer says lost too. The
 * `online`, `offline` and `visibilitychange` events only start a probe (see
 * root.tsx).
 *
 * `justConnected` is true for 1.8 s after the host is back from an outage the
 * page showed, so the strip can say "Connected" once.
 *
 * The functions at the top are pure and hold the rules; the store below
 * holds the state and the one timer.
 */

import { useSyncExternalStore } from "react";

export interface ConnectionState {
  /** The last read or send got no answer. */
  lost: boolean;
  /** When the copy on screen was saved, an ISO time; null when the worker named none. */
  savedAt: string | null;
  /** When this outage began, in browser milliseconds; null while connected. */
  since: number | null;
  /** The host came back from an outage a moment ago. */
  justConnected: boolean;
}

/** How long the green "Connected" line shows. */
export const CONNECTED_MS = 1800;

export const CONNECTED: ConnectionState = { lost: false, savedAt: null, since: null, justConnected: false };

export type ConnectionEvent = { type: "stale"; savedAt: string | null } | { type: "fresh" } | { type: "sendFailed" } | { type: "settled" };

/** The next state after an event. The same object comes back when nothing changes, so React does not render again. */
export function nextConnection(state: ConnectionState, event: ConnectionEvent, now: number): ConnectionState {
  switch (event.type) {
    case "stale": {
      const savedAt = event.savedAt ?? state.savedAt;
      if (state.lost && state.savedAt === savedAt && !state.justConnected) return state;
      return { lost: true, savedAt, since: state.since ?? now, justConnected: false };
    }
    case "sendFailed":
      if (state.lost && !state.justConnected) return state;
      return { lost: true, savedAt: state.savedAt, since: state.since ?? now, justConnected: false };
    case "fresh":
      return state.lost ? { ...CONNECTED, justConnected: true } : state;
    case "settled":
      return state.justConnected ? { ...state, justConnected: false } : state;
  }
}

/**
 * Whether new root data proves the host answered. `previous` and `next` are
 * the `generatedAt` of the data before and after. Without a service worker
 * every answer is live, so any newer time counts. With one, a saved copy can
 * be newer than the one on screen, so the time must also be later than the
 * start of the outage.
 */
export function isFreshAdvance(previous: string, next: string, since: number | null, controlled: boolean): boolean {
  const before = Date.parse(previous);
  const after = Date.parse(next);
  if (Number.isNaN(after) || !(Number.isNaN(before) || after > before)) return false;
  if (!controlled) return true;
  return since !== null && after > since;
}

/** The time the strip names: when the copy was saved, else when the page on screen was read. */
export function shownTime(state: ConnectionState, generatedAt: string): string {
  return state.savedAt ?? generatedAt;
}

// --- the store ---

let state: ConnectionState = CONNECTED;
let settleTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function dispatch(event: ConnectionEvent): void {
  const next = nextConnection(state, event, Date.now());
  if (next === state) return;
  const recovered = next.justConnected && !state.justConnected;
  state = next;
  if (settleTimer !== null && !next.justConnected) {
    clearTimeout(settleTimer);
    settleTimer = null;
  }
  if (recovered) settleTimer = setTimeout(() => dispatch({ type: "settled" }), CONNECTED_MS);
  for (const listener of listeners) listener();
}

/** The worker served a saved copy, saved at `savedAt`. */
export function markStale(savedAt: string | null): void {
  dispatch({ type: "stale", savedAt });
}

/** The host answered a read. */
export function markFresh(): void {
  dispatch({ type: "fresh" });
}

/** A POST got no answer. */
export function markSendFailed(): void {
  dispatch({ type: "sendFailed" });
}

/** The state now, outside React (postJson reads it). */
export function connectionNow(): ConnectionState {
  return state;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The server render always says connected: it has the data it shows. */
function serverState(): ConnectionState {
  return CONNECTED;
}

export function useConnection(): ConnectionState {
  return useSyncExternalStore(subscribe, connectionNow, serverState);
}
