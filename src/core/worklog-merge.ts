/**
 * The merge of two concurrent versions of a worklog file (0.75.0).
 *
 * A milestone keeps all its threads in one file, `worklog/<slug>.md`. When
 * two hosts append to it before they sync, the tree sees a concurrent edit
 * (src/core/tree.ts). Last-writer-wins would drop the threads, notes and
 * stage stamps of one host, so apply writes this merge instead.
 *
 * The file format is the one of the legacy writer
 * (src/legacy/lib/worklog.ts, `parseWorklogMarkdown`). This module reads it
 * on its own, line by line, with the same rules, because native code does
 * not import the vendored tree:
 *
 *   preamble   every line before the first thread
 *   thread     a `## <id> — <label>` line with an `<!-- opened: -->` marker
 *              after it (behind other markers and blank lines only)
 *   markers    opened, spec, stage, session, stamp, closed comments
 *   freeform   other lines before the first entry
 *   entry      a `### <time> [<kind>]` line and the text up to the next one
 *
 * The merge of `winner` and `other`:
 *
 *   preamble   must be the same on both sides; else no merge
 *   threads    by id: the winner's in its order, then the other's new ones
 *   in a thread on both sides:
 *     header, opened   the winner's
 *     spec, session    the winner's, else the other's
 *     stage            the furthest in STAGES order
 *     stamps           the union of the lines, stable sorted by `at`
 *     closed           the winner's, else the other's: closed beats open
 *     freeform         the winner's lines, then the other's lines it lacks
 *     entries          the winner's, then the other's entries it lacks,
 *                      each entry compared as a whole block
 *
 * No merge (null) when a side is not UTF-8, a side is a distilled stub
 * (`<!-- distilled: ... -->` first; a stub replaces the file on purpose),
 * or the preambles differ. The tree then keeps last-writer-wins and records
 * the conflict. A union cannot remove: a thread or an entry deleted by hand
 * on one side comes back. No CLI verb deletes either one.
 *
 * The result is a pure function of the two inputs, so every host that merges
 * the same pair writes the same bytes.
 */

import type { JsonValue } from "./model.ts";

/** The work loop stages, in order (src/legacy/lib/worklog.ts, WORKLOG_STAGES). */
const STAGES = ["planned", "dispatched", "verified", "committed", "reviewed"];
const STAGE_NAMES: ReadonlySet<string> = new Set(STAGES);

const OPENED_RE = /^<!-- opened: (.+) -->$/u;
const SPEC_RE = /^<!-- spec: (.+) -->$/u;
const STAGE_RE = /^<!-- stage: (.+) -->$/u;
const CLOSED_RE = /^<!-- closed: (.+) status: (.+) -->$/u;
const SESSION_RE = /^<!-- session: (.+) -->$/u;
const STAMP_RE = /^<!-- stamp: (\{.*\}) -->$/u;
const THREAD_RE = /^## (.+)$/u;
const ENTRY_RE = /^### (.+) \[(\w+)\]$/u;
const DISTILLED_RE = /^<!-- distilled: \S+ source-sha256: [0-9a-f]{64} raw: \S.*? -->$/u;

interface Stamp {
  line: string;
  at: string;
}

interface Thread {
  id: string;
  header: string;
  opened: string;
  spec?: string;
  stage?: string;
  session?: string;
  stamps: Stamp[];
  /** The closed marker line as written. */
  closed?: string;
  freeform: string[];
  /** Each entry as its serialized block: the header line, then the trimmed text. */
  entries: string[];
}

/** The entry being read: its header line and body lines, or null between entries. */
interface OpenEntry {
  lines: string[] | null;
}

interface Doc {
  preamble: string[];
  threads: Thread[];
}

function isRecord(value: JsonValue | undefined): value is { readonly [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStage(value: JsonValue | undefined): value is string {
  return typeof value === "string" && STAGE_NAMES.has(value);
}

function isText(value: JsonValue | undefined): value is string {
  return typeof value === "string";
}

/** A stamp line with a JSON object that names a known stage and a string `at`; null otherwise (it stays prose). */
function parseStamp(line: string): Stamp | null {
  const match = STAMP_RE.exec(line.trim());
  if (match === null) return null;
  let parsed: JsonValue;
  try {
    parsed = JSON.parse(match[1] ?? "");
  } catch {
    return null;
  }
  if (!isRecord(parsed) || !isStage(parsed.stage) || !isText(parsed.at)) return null;
  return { line, at: parsed.at };
}

/** True when the `## ` heading at `index` carries an opened marker (legacy `readThreadOpenedMarker`). */
function isThreadHeading(lines: readonly string[], index: number): boolean {
  for (let at = index + 1; at < lines.length; at += 1) {
    const line = lines[at] ?? "";
    if (OPENED_RE.test(line)) return true;
    if (line.trim() === "") continue;
    if (SPEC_RE.test(line) || STAGE_RE.test(line) || CLOSED_RE.test(line) || SESSION_RE.test(line) || STAMP_RE.test(line)) continue;
    return false;
  }
  return false;
}

function newThread(header: string): Thread {
  const text = header.slice(3);
  const dash = text.indexOf(" — ");
  const id = (dash >= 0 ? text.slice(0, dash) : text).trim();
  return { id, header, opened: "", stamps: [], freeform: [], entries: [] };
}

function trimTrailingBlanks(lines: readonly string[]): string[] {
  let end = lines.length;
  while (end > 0 && (lines[end - 1] ?? "").trim() === "") end -= 1;
  return lines.slice(0, end);
}

/** The marker and entry lines of one thread section, read the way the legacy parser reads them. */
function readThreadLine(thread: Thread, line: string, entry: OpenEntry): void {
  const opened = OPENED_RE.exec(line);
  if (opened !== null) {
    thread.opened = (opened[1] ?? "").trim();
    return;
  }
  const spec = SPEC_RE.exec(line);
  if (spec !== null) {
    thread.spec = (spec[1] ?? "").trim();
    return;
  }
  const session = SESSION_RE.exec(line);
  if (session !== null) {
    thread.session = (session[1] ?? "").trim();
    return;
  }
  const stamp = STAMP_RE.test(line) ? parseStamp(line) : null;
  if (stamp !== null) {
    thread.stamps.push(stamp);
    return;
  }
  const stage = STAGE_RE.exec(line);
  if (stage !== null) {
    const value = (stage[1] ?? "").trim();
    if (STAGE_NAMES.has(value)) {
      thread.stage = value;
      return;
    }
  } else {
    const closed = CLOSED_RE.exec(line);
    if (closed !== null) {
      thread.closed = `<!-- closed: ${(closed[1] ?? "").trim()} status: ${(closed[2] ?? "").trim()} -->`;
      return;
    }
    const head = ENTRY_RE.exec(line);
    if (head !== null) {
      flushEntry(thread, entry);
      entry.lines = [`### ${(head[1] ?? "").trim()} [${head[2] ?? "note"}]`];
      return;
    }
  }
  if (entry.lines !== null) entry.lines.push(line);
  else thread.freeform.push(line);
}

function flushEntry(thread: Thread, entry: OpenEntry): void {
  if (entry.lines === null) return;
  const [head = "", ...body] = entry.lines;
  const text = body.join("\n").trim();
  thread.entries.push(text === "" ? head : `${head}\n${text}`);
  entry.lines = null;
}

function parse(text: string): Doc {
  const lines = text.split("\n");
  const doc: Doc = { preamble: [], threads: [] };
  let thread: Thread | null = null;
  const entry: OpenEntry = { lines: null };
  const finish = (): void => {
    if (thread === null) return;
    flushEntry(thread, entry);
    thread.freeform = trimTrailingBlanks(thread.freeform);
    doc.threads.push(thread);
    thread = null;
  };
  for (const [index, line] of lines.entries()) {
    if (THREAD_RE.test(line) && isThreadHeading(lines, index)) {
      finish();
      thread = newThread(line);
      continue;
    }
    if (thread === null) doc.preamble.push(line);
    else readThreadLine(thread, line, entry);
  }
  finish();
  return doc;
}

/** The legacy serializer's output for `doc` (`serializeWorklogMarkdown`). */
function serialize(doc: Doc): string {
  const parts = [...doc.preamble];
  for (const thread of doc.threads) {
    parts.push(thread.header, `<!-- opened: ${thread.opened} -->`);
    if (thread.spec !== undefined && thread.spec !== "") parts.push(`<!-- spec: ${thread.spec} -->`);
    if (thread.stage !== undefined) parts.push(`<!-- stage: ${thread.stage} -->`);
    if (thread.session !== undefined && thread.session !== "") parts.push(`<!-- session: ${thread.session} -->`);
    parts.push(...thread.stamps.map((stamp) => stamp.line));
    if (thread.closed !== undefined) parts.push(thread.closed);
    parts.push(...thread.freeform, ...thread.entries, "");
  }
  return parts.join("\n");
}

function furthestStage(a: string | undefined, b: string | undefined): string | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  const rank = (stage: string): number => STAGES.indexOf(stage);
  return rank(b) > rank(a) ? b : a;
}

function union(winner: readonly string[], other: readonly string[]): string[] {
  const seen = new Set(winner);
  return [...winner, ...other.filter((item) => !seen.has(item))];
}

function mergeThread(winner: Thread, other: Thread): Thread {
  const stampLines = new Set(winner.stamps.map((stamp) => stamp.line));
  const stamps = [...winner.stamps, ...other.stamps.filter((stamp) => !stampLines.has(stamp.line))];
  // A stable sort: the latest stamp of a stage is the last one (legacy `latestStamp`).
  const sorted = stamps.toSorted((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  const kept = new Set(winner.freeform);
  const freeform = [...winner.freeform, ...other.freeform.filter((line) => line.trim() !== "" && !kept.has(line))];
  const merged: Thread = {
    id: winner.id,
    header: winner.header,
    opened: winner.opened,
    stamps: sorted,
    freeform,
    entries: union(winner.entries, other.entries),
  };
  const spec = winner.spec ?? other.spec;
  if (spec !== undefined) merged.spec = spec;
  const stage = furthestStage(winner.stage, other.stage);
  if (stage !== undefined) merged.stage = stage;
  const session = winner.session ?? other.session;
  if (session !== undefined) merged.session = session;
  const closed = winner.closed ?? other.closed;
  if (closed !== undefined) merged.closed = closed;
  return merged;
}

function isDistilled(text: string): boolean {
  const first = text.split("\n").find((line) => line.trim() !== "");
  return first !== undefined && DISTILLED_RE.test(first.trim());
}

function decode(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/** True for a worklog file of the tree: `worklog/<name>.md`, not a generated `00-` index. */
export function isWorklogPath(path: string): boolean {
  return /^worklog\/[^/]+\.md$/u.test(path) && !path.startsWith("worklog/00-");
}

/**
 * The merge of two versions of a worklog file (see the file header). Returns
 * the winner's own bytes when the other adds nothing, and null when the two
 * cannot be merged safely.
 */
export function mergeWorklog(winner: Uint8Array, other: Uint8Array): Uint8Array | null {
  const winnerText = decode(winner);
  const otherText = decode(other);
  if (winnerText === null || otherText === null) return null;
  if (isDistilled(winnerText) || isDistilled(otherText)) return winnerText === otherText ? winner : null;
  const ours = parse(winnerText);
  const theirs = parse(otherText);
  if (ours.preamble.join("\n") !== theirs.preamble.join("\n")) {
    // A file with no thread is all preamble: equal or not mergeable.
    return null;
  }
  const byId = new Map(theirs.threads.map((thread) => [thread.id, thread]));
  const ids = new Set(ours.threads.map((thread) => thread.id));
  const threads = [
    ...ours.threads.map((thread) => {
      const match = byId.get(thread.id);
      return match === undefined ? thread : mergeThread(thread, match);
    }),
    ...theirs.threads.filter((thread) => !ids.has(thread.id)),
  ];
  const merged = serialize({ preamble: ours.preamble, threads });
  if (merged === serialize(ours)) return winner;
  return new TextEncoder().encode(merged);
}
