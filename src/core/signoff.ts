/**
 * The sign-off a darius-started session prints when it ends (0.52.0). The
 * operator looks at the herdr panes in the morning, and a ghost leaving the
 * castle tells at a glance that the run ended as it should.
 *
 * Plain printable ASCII: no colour codes, no emoji, no em dashes. At most
 * 10 lines of at most 72 columns, so a terminal of any width shows it whole
 * and the model can copy it exactly. Pure: the caller passes the facts.
 */

import type { ResultSummary } from "./result.ts";

export const SIGNOFF_MAX_WIDTH = 72;
export const SIGNOFF_MAX_LINES = 10;

/** A castle with an open gate; the ghost drifts out of it and leaves a trail. */
const LEAVING = [
  " |^|^|^|^|^|^|^|",
  " |             |          .-.",
  " |    .---.    |   ~     (o o)",
  " |   /     \\   | ~~~~    | O |",
  " |___|     |___|~~~~     '~^~'",
];

/** The same castle; the ghost waits at the gate and has a question. */
const WAITING = [
  " |^|^|^|^|^|^|^|          ?",
  " |             |         .-.",
  " |    .---.    |        (o o)",
  " |   /     \\   |        | O |",
  " |___|     |___|        '~^~'",
];

export interface SignoffInput {
  kind: "complete" | "held";
  ritual: string;
  run: string;
  project: string;
  /** complete: the outcome of `run complete`. */
  outcome?: "complete" | "failed" | "abandoned";
  /** complete: the result block's summary, when the run handed one in. */
  summary?: ResultSummary;
  /** held: the number of questions. */
  questions?: number;
  /** When the run started (ISO), for the duration. */
  startedAt?: string;
  /** The parent run id of a follow-up. */
  followUpOf?: string;
  now?: Date;
}

function answerLines(input: SignoffInput): string[] {
  const head = `answer: darius run answer ${input.run} <n> <text>`;
  const tail = `--project ${input.project}`;
  return head.length + 1 + tail.length <= SIGNOFF_MAX_WIDTH ? [`${head} ${tail}`] : [head, `        ${tail}`];
}

function clip(line: string): string {
  return line.length <= SIGNOFF_MAX_WIDTH ? line : `${line.slice(0, SIGNOFF_MAX_WIDTH - 3)}...`;
}

function two(n: number): string {
  return String(n).padStart(2, "0");
}

/** `56 min`, `1 h 05 min`, `under 1 min`. */
export function durationText(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60_000);
  if (minutes < 1) return "under 1 min";
  if (minutes < 60) return `${String(minutes)} min`;
  return `${String(Math.floor(minutes / 60))} h ${two(minutes % 60)} min`;
}

function resultLine(input: SignoffInput): string {
  if (input.outcome !== undefined && input.outcome !== "complete") return `outcome: ${input.outcome}`;
  const { summary } = input;
  if (summary === undefined) return "result: complete";
  const { open } = summary;
  const openCount = open.critical + open.high + open.medium + open.low + open.info;
  const parts = [`result: ${summary.status}`];
  if (summary.questions > 0) parts.push(`${String(summary.questions)} question(s)`);
  if (summary.fixed > 0) parts.push(`${String(summary.fixed)} fixed`);
  if (openCount > 0) parts.push(`${String(openCount)} open`);
  return parts.join(" | ");
}

function endedLine(input: SignoffInput): string {
  const now = input.now ?? new Date();
  const time = `${two(now.getUTCHours())}:${two(now.getUTCMinutes())} UTC`;
  if (input.startedAt === undefined) return `ended ${time}`;
  const started = Date.parse(input.startedAt);
  if (Number.isNaN(started)) return `ended ${time}`;
  return `ended ${time}, took ${durationText(now.getTime() - started)}`;
}

/** The sign-off block. Art above, text below; every line within 72 columns. */
export function signoffBanner(input: SignoffInput): string {
  const where = `run ${input.run} | ${input.project}`;
  const text =
    input.kind === "held"
      ? [
          `darius: ${input.ritual} waits at the gate`,
          where,
          `${String(input.questions ?? 0)} question(s) for the operator`,
          ...answerLines(input),
        ]
      : [
          `darius: ${input.ritual} left the castle`,
          where,
          resultLine(input),
          endedLine(input),
          ...(input.followUpOf === undefined ? [] : [`follow-up of ${input.followUpOf.slice(-6).toLowerCase()}`]),
        ];
  const art = input.kind === "held" ? WAITING : LEAVING;
  return [...art, ...text].map(clip).slice(0, SIGNOFF_MAX_LINES).join("\n");
}
