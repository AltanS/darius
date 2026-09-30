/**
 * Status colours after Diablo II item colours: set green for done, rare
 * yellow for waiting on the operator, blood red for failed, magic blue for
 * running, worn grey for idle, crafted orange for late. The words that go
 * with them are in `state-words.ts`.
 */

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
