/**
 * The merge of two concurrent versions of `.session-claims.json` (0.75.0).
 *
 * Since 0.75.0 the claims file syncs with the tree, so a session on one host
 * sees a spec that a session on another host claimed. The file is written by
 * the legacy claim verbs (src/legacy/lib/session-claims.ts):
 *
 *   { "version": 1,
 *     "claims":   { "<spec ref>": { session, at, expiresAt, host? } },
 *     "released": { "<spec ref>": { session, at, expiresAt, host? } } }
 *
 * `released` (0.75.0) holds a tombstone per released ref, so a merge does not
 * bring back a claim that one host released while the other still had it.
 * A tombstone keeps the `expiresAt` of the claim it ended, or its own time.
 *
 * The merge of `winner` and `other`, per ref: of the claims and tombstones
 * on both sides, the one with the newest `at` wins (a tie keeps the winner's
 * claim, then the winner's tombstone, then the other's). Then every entry
 * whose `expiresAt` is not after the newest `at` in either file drops out:
 * it expired before the last write, so it is stale everywhere. The newest
 * `at`, not the clock, keeps the merge a pure function of the two inputs.
 * A side that does not parse counts as empty, as the legacy reader treats it.
 *
 * Each entry is kept as written, unknown fields included.
 */

import type { JsonValue } from "./model.ts";

/** One claim or tombstone, kept as written. */
type Entry = { readonly [key: string]: JsonValue };

interface ClaimsFile {
  claims: Map<string, Entry>;
  released: Map<string, Entry>;
}

const CLAIMS_PATH = ".session-claims.json";

/** True for the claims file at the tree root. */
export function isClaimsPath(path: string): boolean {
  return path === CLAIMS_PATH;
}

function isRecord(value: JsonValue | undefined): value is Entry {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isText(value: JsonValue | undefined): value is string {
  return typeof value === "string";
}

function entries(value: JsonValue | undefined): Map<string, Entry> {
  const map = new Map<string, Entry>();
  if (!isRecord(value)) return map;
  for (const [ref, entry] of Object.entries(value)) {
    if (isRecord(entry) && isText(entry.at) && isText(entry.expiresAt)) map.set(ref, entry);
  }
  return map;
}

function parse(bytes: Uint8Array): ClaimsFile {
  let parsed: JsonValue;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return { claims: new Map(), released: new Map() };
  }
  if (!isRecord(parsed)) return { claims: new Map(), released: new Map() };
  return { claims: entries(parsed.claims), released: entries(parsed.released) };
}

function time(entry: Entry, key: "at" | "expiresAt"): number {
  const value = entry[key];
  const parsed = isText(value) ? Date.parse(value) : Number.NaN;
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

function serialize(file: ClaimsFile): string {
  const claims = Object.fromEntries(file.claims);
  const doc = file.released.size > 0 ? { version: 1, claims, released: Object.fromEntries(file.released) } : { version: 1, claims };
  return `${JSON.stringify(doc, null, 2)}\n`;
}

/** The merge of two versions of the claims file (see the file header). Returns the winner's own bytes when the result is the same text. */
export function mergeClaims(winner: Uint8Array, other: Uint8Array): Uint8Array {
  const ours = parse(winner);
  const theirs = parse(other);
  const all = [...ours.claims.values(), ...ours.released.values(), ...theirs.claims.values(), ...theirs.released.values()];
  const newest = all.reduce((max, entry) => Math.max(max, time(entry, "at")), Number.NEGATIVE_INFINITY);
  const refs = new Set([...ours.claims.keys(), ...ours.released.keys(), ...theirs.claims.keys(), ...theirs.released.keys()]);
  const merged: ClaimsFile = { claims: new Map(), released: new Map() };
  for (const ref of refs) {
    const candidates: { entry: Entry; released: boolean }[] = [];
    const push = (entry: Entry | undefined, released: boolean): void => {
      if (entry !== undefined) candidates.push({ entry, released });
    };
    push(ours.claims.get(ref), false);
    push(ours.released.get(ref), true);
    push(theirs.claims.get(ref), false);
    push(theirs.released.get(ref), true);
    const best = candidates.reduce((top, next) => (time(next.entry, "at") > time(top.entry, "at") ? next : top));
    if (time(best.entry, "expiresAt") <= newest) continue;
    (best.released ? merged.released : merged.claims).set(ref, best.entry);
  }
  const text = serialize(merged);
  if (text === new TextDecoder().decode(winner)) return winner;
  return new TextEncoder().encode(text);
}
