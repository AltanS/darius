/**
 * `darius run resume <run>` (docs/concept.md, "Unattended runner" >
 * "Resume"): a held run goes on after the operator answered it. The work is
 * the run-due path with the same run id (src/runner/run-due.ts, option
 * `resume`); this file holds the two things only a resume needs.
 *
 * The session note. After every launch, run-due writes the harness's session
 * id to `<run dir>/session.json`. Run dirs are not synced, and the harness
 * keeps its sessions on the host that ran them, so a note on this host is
 * exactly the case where the session can go on.
 *
 * The message. With the session, the harness goes on with its own
 * transcript, and the message gives it the answers. Without it (another
 * host, a surface that reports no session id, a session the harness no
 * longer has) a new session starts, and the message carries the questions
 * and the answers instead.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { JsonValue } from "../core/model.ts";
import type { RunView } from "./run-due.ts";

export interface SessionNote {
  harness: string;
  session_id: string;
}

function isRecord(value: JsonValue): value is { readonly [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFilled(value: JsonValue | undefined): value is string {
  return typeof value === "string" && value !== "";
}

function noteFile(runDir: string): string {
  return join(runDir, "session.json");
}

export function writeSessionNote(runDir: string, note: SessionNote): void {
  writeFileSync(noteFile(runDir), `${JSON.stringify(note)}\n`);
}

/** The note in `runDir`, or null when there is none or it cannot be read. */
export function readSessionNote(runDir: string): SessionNote | null {
  const file = noteFile(runDir);
  if (!existsSync(file)) return null;
  try {
    const parsed: JsonValue = JSON.parse(readFileSync(file, "utf8"));
    if (!isRecord(parsed) || !isFilled(parsed.harness) || !isFilled(parsed.session_id)) return null;
    return { harness: parsed.harness, session_id: parsed.session_id };
  } catch {
    return null;
  }
}

/** The questions, numbered as `darius run answer` numbers them, each with its latest answer. */
function answerLines(view: RunView): string[] {
  return view.questions.flatMap((question, index) => {
    const answer = view.answers.get(index + 1);
    return [`${String(index + 1)}. ${question}`, answer === undefined ? "   No answer." : `   Answer: ${answer}`];
  });
}

/**
 * The gate does not change with an answer: a command on the hold list is
 * held again. So an approved held action goes to the operator, not the model.
 */
const FINDINGS_STYLE = "Keep the findings to the Style and Result rules of your system prompt: at most 4000 characters, no re-listing of the items.";

const HOLD_STILL_APPLIES =
  "The hold list still applies, and an answer does not lift it. When an answer approves an action on the hold list, do not run it: name it in the findings, so the operator can do it.";

export interface ResumeInput {
  run: string;
  slug: string;
  view: RunView;
  /** True when a new session starts: the model has no transcript of the run. */
  isFresh: boolean;
}

/** The first message of a resumed run. */
export function resumeMessage(input: ResumeInput): string {
  const { run, slug, view } = input;
  const answers = answerLines(view);
  if (!input.isFresh) {
    return [
      `The operator answered the questions of run ${run}:`,
      "",
      ...answers,
      "",
      "Go on with the procedure where you stopped. Follow the protocol in your system prompt: hold the run again if you need a person, and finish with darius run complete. After it succeeds, your last message is the sign-off block it printed, copied exactly inside a code block, and nothing else.",
      HOLD_STILL_APPLIES,
      FINDINGS_STYLE,
    ].join("\n");
  }
  return [
    `Run ritual ${slug} now. Run id ${run}. Follow the protocol in your system prompt.`,
    "",
    "An earlier session of this run held it with questions. That session cannot go on here, so this is a new session. The operator answered:",
    "",
    ...answers,
    "",
    "Do the procedure from the start, with these answers.",
    HOLD_STILL_APPLIES,
    FINDINGS_STYLE,
  ].join("\n");
}
