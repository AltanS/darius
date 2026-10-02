/**
 * Words, tones and order for a run's result block (0.22.0). Every text in a
 * result is untrusted plain text: the components render it as text, never
 * as markdown, HTML or a link. Every tone comes with a word, so no state
 * relies on colour alone.
 */

import type { ResultAction, ResultItem, ResultItemState, ResultMetric, ResultSeverity, ResultStatus, RunResultSummary } from "../../../src/web/api.ts";
import type { Tone } from "./tone.ts";

/** A small word in a box; a null tone is the plain box. */
export interface TagSpec {
  text: string;
  tone: Tone | null;
}

export function resultTone(status: ResultStatus): Tone {
  if (status === "ok") return "ok";
  return status === "attention" ? "wait" : "bad";
}

export function resultWord(status: ResultStatus): string {
  if (status === "ok") return "Result ok";
  return status === "attention" ? "Needs attention" : "Result failed";
}

const SEVERITY_RANK = { critical: 0, high: 1, medium: 2, low: 3, info: 4 } as const satisfies Record<ResultSeverity, number>;
const STATE_RANK = { open: 0, "needs-decision": 1, "needs-code": 2, "not-verified": 3, fixed: 4 } as const satisfies Record<ResultItemState, number>;

export function severityTone(severity: ResultSeverity): Tone | null {
  if (severity === "critical") return "bad";
  if (severity === "high") return "late";
  if (severity === "medium") return "gold";
  return severity === "low" ? "idle" : null;
}

export function itemStateTag(state: ResultItemState): TagSpec {
  if (state === "fixed") return { text: "fixed", tone: "ok" };
  if (state === "needs-decision") return { text: "needs decision", tone: "wait" };
  if (state === "needs-code") return { text: "needs code", tone: "wait" };
  if (state === "not-verified") return { text: "not verified", tone: "late" };
  return { text: "open", tone: null };
}

export function actionTag(state: ResultAction["state"]): TagSpec {
  if (state === "done") return { text: "done", tone: "ok" };
  return state === "failed" ? { text: "failed", tone: "bad" } : { text: "skipped", tone: "idle" };
}

/** The tone of a metric value, and its word: a value is never coloured without the word. */
export interface MetricTone {
  tone: Tone;
  word: string;
}

export function metricTag(tone: NonNullable<ResultMetric["tone"]>): MetricTone {
  if (tone === "ok") return { tone: "ok", word: "ok" };
  return tone === "warn" ? { tone: "late", word: "warning" } : { tone: "bad", word: "bad" };
}

export interface ItemGroup {
  /** The group's name; null for the items without one. */
  name: string | null;
  items: ResultItem[];
}

/** Critical first, then by state: open, needs decision, needs code, not verified, fixed. Ties keep the model's order. */
function byWeight(left: ResultItem, right: ResultItem): number {
  return SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity] || STATE_RANK[left.state] - STATE_RANK[right.state];
}

/** The items by group, in the order the groups first appear; the items without a group last, in one group. */
export function groupItems(items: readonly ResultItem[]): ItemGroup[] {
  const named = new Map<string, ResultItem[]>();
  const loose: ResultItem[] = [];
  for (const item of items) {
    if (item.group === undefined) {
      loose.push(item);
      continue;
    }
    const list = named.get(item.group);
    if (list === undefined) named.set(item.group, [item]);
    else list.push(item);
  }
  const groups: ItemGroup[] = [...named].map(([name, list]) => ({ name, items: list.toSorted(byWeight) }));
  if (loose.length > 0) groups.push({ name: null, items: loose.toSorted(byWeight) });
  return groups;
}

/** "3 open, 2 fixed", over the items of a result. */
export function itemsText(items: readonly ResultItem[]): string {
  const fixed = items.filter((item) => item.state === "fixed").length;
  const open = items.length - fixed;
  return [open === 0 ? null : `${open} open`, fixed === 0 ? null : `${fixed} fixed`].filter((part) => part !== null).join(", ");
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/**
 * The tags a run row shows for its result: open critical and high items,
 * and the questions, in the waiting tone until someone answered them.
 */
export function summaryTags(summary: RunResultSummary, isAnswered: boolean): TagSpec[] {
  const tags: TagSpec[] = [];
  if (summary.open.critical > 0) tags.push({ text: `${summary.open.critical} critical open`, tone: "bad" });
  if (summary.open.high > 0) tags.push({ text: `${summary.open.high} high open`, tone: "late" });
  if (summary.questions > 0) {
    const text = plural(summary.questions, "question");
    tags.push(isAnswered ? { text: `${text}, answered`, tone: null } : { text, tone: "wait" });
  }
  return tags;
}
