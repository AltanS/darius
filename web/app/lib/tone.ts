/**
 * Status colours after Diablo II item colours: set green for done, rare
 * yellow for waiting on the operator, blood red for failed, magic blue for
 * running, worn grey for idle, crafted orange for overdue.
 */

import type { RitualRow, RunRow, VigilRow } from "../../../src/web/api.ts";

export type Tone = "ok" | "wait" | "bad" | "run" | "idle" | "late" | "gold";

export interface Badge {
  tone: Tone;
  label: string;
}

const BAD_OUTCOMES: ReadonlySet<string> = new Set(["failed", "refused", "error", "gate-broken", "harness-unchecked", "profile-invalid", "subagents-unproven", "tool-missing"]);

export function outcomeTone(outcome: string | null): Tone {
  if (outcome === null) return "idle";
  if (outcome === "complete" || outcome === "done" || outcome === "ok") return "ok";
  if (BAD_OUTCOMES.has(outcome)) return "bad";
  return "idle";
}

export function runBadge(run: RunRow): Badge {
  if (run.phase === "held") return { tone: "wait", label: "held" };
  if (run.phase === "running") return { tone: "run", label: "running" };
  return { tone: outcomeTone(run.outcome), label: run.outcome ?? "closed" };
}

export function ritualBadge(ritual: RitualRow): Badge {
  if (ritual.heldRun !== null) return { tone: "wait", label: "held" };
  if (ritual.openRun !== null) return { tone: "run", label: "running" };
  if (ritual.lifecycle !== "active") return { tone: "idle", label: ritual.lifecycle };
  if (ritual.overdueDays > 0) return { tone: "late", label: `overdue ${ritual.overdueDays} d` };
  if (ritual.isDue) return { tone: "gold", label: "due" };
  if (ritual.nextDue === null) return { tone: "idle", label: "dormant" };
  return { tone: "ok", label: "scheduled" };
}

export function vigilBadge(vigil: VigilRow): Badge {
  if (vigil.state === "closed") return { tone: vigil.verdict === "failed" ? "bad" : "ok", label: vigil.verdict ?? "closed" };
  if (vigil.flagged) return { tone: "bad", label: "flagged" };
  return { tone: "idle", label: "armed" };
}
