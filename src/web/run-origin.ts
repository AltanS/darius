/**
 * Where a run came from and who took its answers (0.92.0; docs/concept.md,
 * "Web status page", "The run page"). Two pure functions over the ledger of
 * one project: `originOf` reads the start line of a run, `readersOf` finds the
 * runs whose `answers_read` names the acks of a run. Neither reads a file.
 *
 * The reading rule is the one in src/core/handoff.ts: a `run.started` or
 * `run.resumed` line of a run that is not a follow-up lists the ack ids it
 * read, and a follow-up never consumes an answer. A reader that closed with
 * any outcome but `complete` did not take the answer (the handoff offers it
 * again), so it is left out; a reader that is still open is listed.
 *
 * Operator text (a follow-up's note and granted lines) goes through
 * `maskSecrets`: the ledger is append only and syncs, so a secret typed into
 * a note is shown masked, as in the activity model.
 */

import { maskSecrets } from "../core/mask-secrets.ts";
import type { JsonValue, LedgerLine } from "../core/model.ts";
import type { RunAnswerRead, RunApproval, RunOrigin, RunReader } from "./api.ts";
import { startedByOf } from "./activity.ts";

function isString(value: JsonValue | undefined): value is string {
  return typeof value === "string";
}

function isNumber(value: JsonValue | undefined): value is number {
  return typeof value === "number";
}

function textList(value: JsonValue | undefined): string[] {
  return Array.isArray(value) ? value.filter((entry) => isString(entry)) : [];
}

function numberList(value: JsonValue | undefined): number[] {
  return Array.isArray(value) ? value.filter((entry) => isNumber(entry)) : [];
}

function text(value: JsonValue | undefined): string | null {
  return isString(value) && value !== "" ? value : null;
}

/** The acks the lines read, once each, resolved against the ack lines of the ledger and sorted by time. An id nobody wrote is skipped. */
function answersReadBy(lines: readonly LedgerLine[], acks: ReadonlyMap<string, LedgerLine>): RunAnswerRead[] {
  const seen = new Set<string>();
  const read: RunAnswerRead[] = [];
  for (const line of lines) {
    for (const id of textList(line.answers_read)) {
      const ack = acks.get(id);
      if (ack === undefined || seen.has(id) || !isString(ack.run)) continue;
      seen.add(id);
      read.push({ run: ack.run, at: ack.at, who: ack.who });
    }
  }
  return read.toSorted((left, right) => left.at.localeCompare(right.at));
}

function approvalOf(started: LedgerLine): RunApproval {
  const note = text(started.note);
  return { questions: numberList(started.approved), items: textList(started.items), grants: textList(started.grants).map((grant) => maskSecrets(grant)), note: note === null ? null : maskSecrets(note) };
}

function ackLines(ledger: readonly LedgerLine[]): Map<string, LedgerLine> {
  const acks = new Map<string, LedgerLine>();
  for (const line of ledger) {
    if (line.type === "run.acknowledged") acks.set(line.id, line);
  }
  return acks;
}

/** The origin of `run`. A run with no start line but a resume line is a `resume`; a run with neither is `manual`. */
export function originOf(ledger: readonly LedgerLine[], run: string): RunOrigin {
  const lines = ledger.filter((line) => line.run === run);
  const started = lines.find((line) => line.type === "run.started");
  if (started === undefined) {
    const resumed = lines.find((line) => line.type === "run.resumed");
    return { kind: resumed === undefined ? "manual" : "resume", who: (resumed ?? lines[0])?.who ?? "unknown" };
  }
  const parent = text(started.follow_up_of);
  if (parent !== null) return { kind: "follow-up", run: parent, who: started.who, approved: approvalOf(started) };
  const answers = answersReadBy(
    lines.filter((line) => line.type === "run.started" || line.type === "run.resumed"),
    ackLines(ledger),
  );
  const kind = textList(started.answers_read).length > 0 ? "after-answer" : startedByOf(started.who) === "timer" ? "schedule" : "manual";
  const origin: RunOrigin = { kind, who: started.who };
  if (answers.length > 0) origin.answersRead = answers;
  return origin;
}

/** The runs that took the answers of `run`, oldest first. See the file header for the rule. */
export function readersOf(ledger: readonly LedgerLine[], run: string): RunReader[] {
  const ids = new Set(ledger.filter((line) => line.type === "run.acknowledged" && line.run === run).map((line) => line.id));
  if (ids.size === 0) return [];
  const followUps = new Set(ledger.filter((line) => line.type === "run.started" && text(line.follow_up_of) !== null).map((line) => line.run));
  const failedReaders = new Set(ledger.filter((line) => line.type === "run.completed" && line.outcome !== "complete").map((line) => line.run));
  const readers = new Map<string, string>();
  for (const line of ledger) {
    if (line.type !== "run.started" && line.type !== "run.resumed") continue;
    if (!isString(line.run) || line.run === run || followUps.has(line.run) || failedReaders.has(line.run)) continue;
    if (!textList(line.answers_read).some((id) => ids.has(id)) || readers.has(line.run)) continue;
    readers.set(line.run, line.at);
  }
  return [...readers].map(([reader, at]) => ({ run: reader, at })).toSorted((left, right) => left.at.localeCompare(right.at));
}
