/**
 * The three kinds of tracked item, each with one word, one colour and one icon
 * all over the app: a ritual darius runs by itself, a ritual done by hand
 * (mode off), and a vigil (a one-shot check).
 */

import type { RitualRow } from "../../../src/web/api.ts";
export type Kind = "ritual" | "manual" | "vigil";

/** True when darius itself starts this ritual. */
export function isUnattended(ritual: RitualRow): boolean {
  return ritual.mode !== "off" && ritual.lifecycle === "active";
}

/** `ritual` when darius starts the ritual itself, `manual` when a person does it. */
export function ritualKind(ritual: RitualRow): Kind {
  return isUnattended(ritual) ? "ritual" : "manual";
}

/**
 * The kind of a run's item (`ritual/<slug>` or `vigil/<slug>`). A ritual that
 * the status no longer lists counts as a ritual darius runs, since only such a
 * ritual leaves runs behind.
 */
export function itemKind(item: string, ritual?: RitualRow): Kind {
  if (item.startsWith("vigil/")) return "vigil";
  return ritual === undefined ? "ritual" : ritualKind(ritual);
}

/** The word that names a kind on a tag. */
export function kindWord(kind: Kind): string {
  return kind;
}
