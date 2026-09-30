/**
 * The two kinds of tracked item, each with one word, one colour and one icon
 * all over the app: a ritual (a recurring job) and a vigil (a one-shot
 * check). `manual` is not a kind but a modifier of a ritual: its mode is off,
 * so darius never starts it and a person does it by hand. A manual ritual
 * shows both chips, ritual and manual.
 */

import type { RitualRow } from "../../../src/web/api.ts";
export type Kind = "ritual" | "vigil";

/** True when darius itself starts this ritual. */
export function isUnattended(ritual: RitualRow): boolean {
  return ritual.mode !== "off" && ritual.lifecycle === "active";
}

/** True when a person does this ritual by hand: darius never starts it. */
export function isManual(ritual: RitualRow): boolean {
  return !isUnattended(ritual);
}

/** The kind of a run's item (`ritual/<slug>` or `vigil/<slug>`). */
export function itemKind(item: string): Kind {
  return item.startsWith("vigil/") ? "vigil" : "ritual";
}

/**
 * Whether a run's item is a manual ritual. A ritual that the status no longer
 * lists counts as one darius runs, since only such a ritual leaves runs behind.
 */
export function itemManual(item: string, ritual?: RitualRow): boolean {
  return !item.startsWith("vigil/") && ritual !== undefined && isManual(ritual);
}

/** The word that names a kind on a chip. */
export function kindWord(kind: Kind): string {
  return kind;
}
