/**
 * Tests for the counsel gate parser + threshold logic.
 *
 * pnpm vitest run counsel-gate
 */

import { describe, it, expect } from "vitest";
import {
  parseCounselTranscript,
  applyGate,
  applyRoundBudget,
  type GateDecision,
} from "../lib/counsel-gate.ts";

const ADVISOR_TEMPLATE = (
  index: number,
  persona: string,
  verdict: "up" | "sideways" | "down",
  assessment: string,
) =>
  `\n## Advisor ${index} — ${persona}\n\n**Verdict**: thumbs_${verdict}\n\n**Assessment**: ${assessment}\n`;

const BRIEF_SECTION =
  "# Counsel Transcript — Test\n\n## Brief\n\nSome brief.\n";
const CONSENSUS_SECTION = "\n## Consensus\n\nNo blockers.\n";

describe("counsel-gate parser", () => {
  it("counts a mix of verdicts correctly", () => {
    const transcript =
      BRIEF_SECTION +
      ADVISOR_TEMPLATE(1, "Senior Developer", "sideways", "okay") +
      ADVISOR_TEMPLATE(2, "Architect", "sideways", "fine") +
      ADVISOR_TEMPLATE(3, "Pragmatic Skeptic", "down", "broken") +
      ADVISOR_TEMPLATE(4, "End User", "up", "great") +
      CONSENSUS_SECTION;

    const parse = parseCounselTranscript(transcript);

    expect(parse.thumbsDown).toBe(1);
    expect(parse.thumbsSideways).toBe(2);
    expect(parse.thumbsUp).toBe(1);
    expect(parse.advisors).toHaveLength(4);
    expect(parse.advisors[2]?.persona).toBe("Pragmatic Skeptic");
    expect(parse.advisors[2]?.verdict).toBe("thumbs_down");
    expect(parse.advisors[2]?.assessment).toBe("broken");
  });

  it("counts zero thumbs_down when none present", () => {
    const transcript =
      BRIEF_SECTION +
      ADVISOR_TEMPLATE(1, "A", "up", "good") +
      ADVISOR_TEMPLATE(2, "B", "up", "good");

    const parse = parseCounselTranscript(transcript);
    expect(parse.thumbsDown).toBe(0);
    expect(parse.thumbsUp).toBe(2);
  });

  it("counts multiple thumbs_down", () => {
    const transcript =
      BRIEF_SECTION +
      ADVISOR_TEMPLATE(1, "A", "down", "broken") +
      ADVISOR_TEMPLATE(2, "B", "down", "also broken") +
      ADVISOR_TEMPLATE(3, "C", "sideways", "fine");

    const parse = parseCounselTranscript(transcript);
    expect(parse.thumbsDown).toBe(2);
  });

  it("tolerates verdict case variations", () => {
    const transcript =
      BRIEF_SECTION +
      "\n## Advisor 1 — Tester\n\n**Verdict**: THUMBS_DOWN\n\n**Assessment**: caps.\n";

    const parse = parseCounselTranscript(transcript);
    expect(parse.thumbsDown).toBe(1);
  });

  it("tolerates extra whitespace in verdict line", () => {
    const transcript =
      BRIEF_SECTION +
      "\n## Advisor 1 — Tester\n\n**Verdict** :   thumbs_down\n\n**Assessment**: padded.\n";

    const parse = parseCounselTranscript(transcript);
    expect(parse.thumbsDown).toBe(1);
  });

  it("skips advisor sections with no verdict line", () => {
    const transcript =
      BRIEF_SECTION +
      "\n## Advisor 1 — Ghost\n\n(no verdict given)\n" +
      ADVISOR_TEMPLATE(2, "B", "down", "broken");

    const parse = parseCounselTranscript(transcript);
    expect(parse.advisors).toHaveLength(1);
    expect(parse.thumbsDown).toBe(1);
  });

  it("ignores Brief and Consensus sections", () => {
    const transcript =
      "# T\n\n## Brief\n\nThumbs_down sounds bad.\n\n## Consensus\n\nthumbs_down everywhere.\n" +
      ADVISOR_TEMPLATE(1, "A", "sideways", "ok");

    const parse = parseCounselTranscript(transcript);
    expect(parse.thumbsDown).toBe(0);
    expect(parse.thumbsSideways).toBe(1);
  });

  it("handles legacy heading form '### Persona — verdict'", () => {
    const transcript =
      BRIEF_SECTION +
      "\n### Senior Developer — thumbs_down\n\n**Verdict**: thumbs_down\n\n**Assessment**: legacy form.\n";

    const parse = parseCounselTranscript(transcript);
    expect(parse.advisors).toHaveLength(1);
    expect(parse.advisors[0]?.persona).toBe("Senior Developer");
    expect(parse.thumbsDown).toBe(1);
  });

  it("tolerates a hyphen separator instead of em-dash", () => {
    const transcript =
      BRIEF_SECTION +
      "\n## Advisor 1 - Senior Developer\n\n**Verdict**: thumbs_sideways\n\n**Assessment**: hyphen.\n";

    const parse = parseCounselTranscript(transcript);
    expect(parse.advisors[0]?.persona).toBe("Senior Developer");
    expect(parse.thumbsSideways).toBe(1);
  });

  it("strips trailing verdict from advisor heading", () => {
    const transcript =
      BRIEF_SECTION +
      "\n## Advisor 1 — Senior Developer — thumbs_down\n\n**Verdict**: thumbs_down\n\n**Assessment**: t.\n";

    const parse = parseCounselTranscript(transcript);
    expect(parse.advisors[0]?.persona).toBe("Senior Developer");
  });
});

describe("counsel-gate threshold logic", () => {
  function makeParse(down: number, sideways: number = 0, up: number = 0) {
    return parseCounselTranscript(
      BRIEF_SECTION +
        Array.from({ length: down }, (_, i) =>
          ADVISOR_TEMPLATE(i + 1, `Down${i}`, "down", "broken"),
        ).join("") +
        Array.from({ length: sideways }, (_, i) =>
          ADVISOR_TEMPLATE(
            i + 1 + down,
            `Side${i}`,
            "sideways",
            "okay",
          ),
        ).join("") +
        Array.from({ length: up }, (_, i) =>
          ADVISOR_TEMPLATE(i + 1 + down + sideways, `Up${i}`, "up", "great"),
        ).join(""),
    );
  }

  it("0 thumbs_down → ready, no dissent summary", () => {
    const decision = applyGate(makeParse(0, 3, 1));
    expect(decision.status).toBe("ready");
    expect(decision.dissentSummary).toBeUndefined();
    expect(decision.blockingSummary).toBeUndefined();
  });

  it("1 thumbs_down → ready with dissent summary", () => {
    const decision = applyGate(makeParse(1, 2, 1));
    expect(decision.status).toBe("ready");
    expect(decision.dissentSummary).toContain("Down0");
    expect(decision.dissentSummary).toContain("broken");
    expect(decision.blockingSummary).toBeUndefined();
  });

  it("2 thumbs_down with default threshold → blocked", () => {
    const decision = applyGate(makeParse(2, 1, 1));
    expect(decision.status).toBe("blocked");
    expect(decision.thumbsDown).toBe(2);
    expect(decision.threshold).toBe(2);
    expect(decision.blockingSummary).toContain("Down0");
    expect(decision.blockingSummary).toContain("Down1");
    expect(decision.dissentSummary).toBeUndefined();
  });

  it("3 thumbs_down with threshold 3 → blocked", () => {
    const decision = applyGate(makeParse(3, 1, 0), 3);
    expect(decision.status).toBe("blocked");
    expect(decision.threshold).toBe(3);
  });

  it("2 thumbs_down with threshold 3 → ready (under threshold)", () => {
    const decision = applyGate(makeParse(2, 1, 1), 3);
    expect(decision.status).toBe("ready");
    expect(decision.dissentSummary).toBeUndefined();
  });

  it("1 thumbs_down with threshold 1 → blocked (gate as strict as old behavior)", () => {
    const decision = applyGate(makeParse(1, 3, 0), 1);
    expect(decision.status).toBe("blocked");
    expect(decision.blockingSummary).toContain("Down0");
  });

  it("rejects non-integer threshold", () => {
    const parse = makeParse(0);
    expect(() => applyGate(parse, 0)).toThrow(/positive integer/);
    expect(() => applyGate(parse, -1)).toThrow(/positive integer/);
    expect(() => applyGate(parse, 1.5)).toThrow(/positive integer/);
  });
});

describe("counsel-gate single-dissent mode", () => {
  function makeParse(down: number, sideways: number = 0, up: number = 0) {
    return parseCounselTranscript(
      BRIEF_SECTION +
        Array.from({ length: down }, (_, i) =>
          ADVISOR_TEMPLATE(i + 1, `Down${i}`, "down", "broken"),
        ).join("") +
        Array.from({ length: sideways }, (_, i) =>
          ADVISOR_TEMPLATE(i + 1 + down, `Side${i}`, "sideways", "okay"),
        ).join("") +
        Array.from({ length: up }, (_, i) =>
          ADVISOR_TEMPLATE(i + 1 + down + sideways, `Up${i}`, "up", "great"),
        ).join(""),
    );
  }

  it("defaults to surface — 1 thumbs_down → ready with dissent", () => {
    const decision = applyGate(makeParse(1, 2, 1));
    expect(decision.status).toBe("ready");
    expect(decision.dissentSummary).toContain("Down0");
  });

  it("confirm — 1 thumbs_down → needs_ack with dissent", () => {
    const decision = applyGate(makeParse(1, 2, 1), 2, "confirm");
    expect(decision.status).toBe("needs_ack");
    expect(decision.dissentSummary).toContain("Down0");
    expect(decision.reason).toMatch(/acknowledge/i);
  });

  it("ignore — 1 thumbs_down → ready, no dissent surfaced", () => {
    const decision = applyGate(makeParse(1, 2, 1), 2, "ignore");
    expect(decision.status).toBe("ready");
    expect(decision.dissentSummary).toBeUndefined();
  });

  it("mode never overrides the threshold — confirm still blocks at >= threshold", () => {
    const decision = applyGate(makeParse(2, 1, 0), 2, "confirm");
    expect(decision.status).toBe("blocked");
    expect(decision.dissentSummary).toBeUndefined();
  });

  it("mode is irrelevant when there is no dissent — 0 thumbs_down → ready", () => {
    for (const mode of ["surface", "confirm", "ignore"] as const) {
      const decision = applyGate(makeParse(0, 3, 1), 2, mode);
      expect(decision.status).toBe("ready");
      expect(decision.dissentSummary).toBeUndefined();
    }
  });
});

describe("counsel-gate dissent summaries", () => {
  it("concatenates multiple blocking advisors with separator", () => {
    const transcript =
      BRIEF_SECTION +
      ADVISOR_TEMPLATE(1, "Senior Developer", "down", "Reason A") +
      ADVISOR_TEMPLATE(2, "Architect", "down", "Reason B") +
      ADVISOR_TEMPLATE(3, "End User", "up", "Looks good");

    const parse = parseCounselTranscript(transcript);
    const decision = applyGate(parse);
    expect(decision.blockingSummary).toBe(
      "Senior Developer: Reason A | Architect: Reason B",
    );
  });

  it("handles missing assessment line gracefully", () => {
    const transcript =
      BRIEF_SECTION +
      "\n## Advisor 1 — Mute Critic\n\n**Verdict**: thumbs_down\n\n(no assessment)\n";

    const parse = parseCounselTranscript(transcript);
    const decision = applyGate(parse, 1);
    expect(decision.blockingSummary).toContain("no assessment line");
  });
});

describe("counsel-gate round budget", () => {
  const blocked = (): GateDecision => ({
    status: "blocked",
    reason: "counsel rejected (2 thumbs_down >= 2)",
    thumbsDown: 2,
    threshold: 2,
    blockingSummary: "A: x | B: y",
  });
  const ready = (): GateDecision => ({
    status: "ready",
    reason: "0 thumbs_down below threshold 2",
    thumbsDown: 0,
    threshold: 2,
  });

  it("annotates rounds/maxRounds without changing a sub-budget blocked decision", () => {
    const d = applyRoundBudget(blocked(), 1, 2);
    expect(d.status).toBe("blocked");
    expect(d.rounds).toBe(1);
    expect(d.maxRounds).toBe(2);
  });

  it("converts blocked to counsel_exhausted at the round cap", () => {
    const d = applyRoundBudget(blocked(), 2, 2);
    expect(d.status).toBe("counsel_exhausted");
    expect(d.rounds).toBe(2);
    expect(d.reason).toContain("counsel exhausted after 2 round(s)");
    // The underlying blocking summary is preserved for surfacing to the user.
    expect(d.blockingSummary).toBe("A: x | B: y");
  });

  it("converts blocked to counsel_exhausted past the cap", () => {
    expect(applyRoundBudget(blocked(), 5, 2).status).toBe("counsel_exhausted");
  });

  it("never exhausts a ready decision regardless of rounds", () => {
    const d = applyRoundBudget(ready(), 9, 2);
    expect(d.status).toBe("ready");
    expect(d.rounds).toBe(9);
  });

  it("respects a custom maxRounds of 3", () => {
    expect(applyRoundBudget(blocked(), 2, 3).status).toBe("blocked");
    expect(applyRoundBudget(blocked(), 3, 3).status).toBe("counsel_exhausted");
  });

  it("rejects a non-positive or non-integer maxRounds", () => {
    expect(() => applyRoundBudget(blocked(), 1, 0)).toThrow(/positive integer/);
    expect(() => applyRoundBudget(blocked(), 1, 1.5)).toThrow(/positive integer/);
  });
});
