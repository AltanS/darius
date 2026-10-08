/**
 * The two Claude Code hook verbs: `darius hook-stop` (the Work Loop exit
 * gate, a port of the plugin's lib/loop-gate.sh) and `darius hook-drift` (the
 * pending-sync ledger, a port of lib/drift-check.sh).
 *
 * Both read the hook JSON on stdin and FAIL OPEN: no `.tracker/`, bad JSON,
 * a foreign subagent, any error, all exit 0 with no output. A broken gate must
 * never brick a turn.
 *
 * Write rule: `hook-drift` writes `.tracker/.pending-sync` and nothing else.
 * `hook-stop` writes no file of its own; the bounce budget it spends lives in
 * `.tracker/.loop-bounces.json`, which `runLoopCheck` keeps (the same file the
 * shell gate reached through `darius loop-check --bounce`).
 *
 * Since 0.72.0 the gate blocks only on threads owned by the stopping session
 * (the payload `session_id`), with a budget per thread. Threads of other
 * sessions, or of none, show up in one notice line and never block. A payload
 * with no `session_id` never blocks.
 *
 * Debugging: TRACKER_LOOP_DEBUG=1 prints to stderr (with the observed
 * agent_type); TRACKER_LOOP_DEBUG_FILE also appends the lines to a file.
 * TRACKER_DRIFT_DEBUG=1 does the same for hook-drift.
 */

import { appendFileSync, existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { formatLoopCheckReport, formatOthersNotice, runLoopCheck } from "./loop-check.ts";

type Payload = Record<string, unknown>;

/** The JSON object on stdin, or null for empty input, bad JSON, or a non-object. */
function readPayload(): Payload | null {
  let text: string;
  try {
    text = readFileSync(0, "utf8");
  } catch {
    return null;
  }
  if (text.trim() === "") return null;
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    return parsed as Payload;
  } catch {
    return null;
  }
}

/** A string field of the payload, or "" when absent or not a string or number. */
function field(payload: Payload, name: string): string {
  const value = payload[name];
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return "";
}

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** The nearest directory at or above `start` that holds a `.tracker/` dir, or null. */
function findTrackerParent(start: string): string | null {
  let dir = start;
  for (;;) {
    if (isDir(join(dir, ".tracker"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

// ---------------------------------------------------------------------------
// hook-stop
// ---------------------------------------------------------------------------

function stopDebug(message: string): void {
  if (process.env.TRACKER_LOOP_DEBUG === "1") process.stderr.write(`loop-gate: ${message}\n`);
  const file = process.env.TRACKER_LOOP_DEBUG_FILE;
  if (file === undefined || file === "") return;
  try {
    appendFileSync(file, `loop-gate: ${message}\n`);
  } catch {
    // A debug file that cannot be written is not worth a failed hook.
  }
}

/** What the gate decides for one Stop payload: the hook protocol line to print, or null to let the stop through. */
export function decideStop(payload: Payload, cwd: string): string | null {
  const event = field(payload, "hook_event_name");
  const agentType = field(payload, "agent_type");
  const agentId = field(payload, "agent_id");
  const sessionId = field(payload, "session_id");
  const hookCwd = field(payload, "cwd");
  const empty = (value: string): string => (value === "" ? "<empty>" : value);
  stopDebug(`event=${empty(event)} agent_type=${empty(agentType)} agent_id=${empty(agentId)} session_id=${empty(sessionId)}`);

  if (event === "SubagentStop") {
    if (agentType !== "darius" && agentType !== "tracker:darius") {
      stopDebug(`foreign/absent subagent type (${empty(agentType)}), pass`);
      return null;
    }
  } else if (event !== "Stop") {
    stopDebug(`unrecognized event (${empty(event)}), pass`);
    return null;
  }

  const root = findTrackerParent(hookCwd !== "" ? hookCwd : cwd);
  if (root === null) {
    stopDebug("no tracker, pass");
    return null;
  }

  const trackerRoot = join(root, ".tracker");
  if (sessionId === "") {
    // No owner to match: report every open thread, block on none.
    const query = runLoopCheck({ trackerRoot });
    stopDebug(`no session_id, loop-check status=${query.status}, notice only`);
    if (query.status !== "stuck") return null;
    const notice = formatOthersNotice({ ...query, others: query.threads });
    return notice === null ? null : `{"systemMessage": ${JSON.stringify(notice)}}`;
  }

  const result = runLoopCheck({ trackerRoot, session: sessionId });
  const report = formatLoopCheckReport(result).replace(/\n+$/u, "");
  stopDebug(`loop-check status=${result.status}`);
  stopDebug(report);

  if (result.status === "stuck") {
    const reason = `Work Loop incomplete: finish it or park it before ending the turn.\n${report}`;
    return `{"decision": "block", "reason": ${JSON.stringify(reason)}}`;
  }
  if (result.status === "exhausted") {
    const message = `⚠ Turn ended mid-Work-Loop (bounce budget exhausted). Stuck threads:\n${report}`;
    return `{"systemMessage": ${JSON.stringify(message)}}`;
  }
  const notice = formatOthersNotice(result);
  return notice === null ? null : `{"systemMessage": ${JSON.stringify(notice)}}`;
}

/** `darius hook-stop`: reads the Stop hook JSON on stdin. Always exits 0. */
export function runHookStop(): number {
  try {
    const payload = readPayload();
    if (payload === null) return 0;
    const line = decideStop(payload, process.cwd());
    if (line !== null) process.stdout.write(`${line}\n`);
  } catch {
    // Fail open.
  }
  return 0;
}

// ---------------------------------------------------------------------------
// hook-drift
// ---------------------------------------------------------------------------

function driftDebug(message: string): void {
  if (process.env.TRACKER_DRIFT_DEBUG === "1") process.stderr.write(`drift-check: ${message}\n`);
}

/** The path of an edited file relative to the tracker root; an absolute path outside it stays as is. */
function relativeTo(root: string, file: string): string {
  const prefix = `${root}/`;
  return file.startsWith(prefix) ? file.slice(prefix.length) : file;
}

/** True when any spec file of any milestone mentions `rel`. */
function mentionedInSpec(root: string, rel: string): boolean {
  const tracker = join(root, ".tracker");
  for (const milestone of readdirSync(tracker)) {
    if (!/^M.*-/u.test(milestone) || !isDir(join(tracker, milestone))) continue;
    for (const name of readdirSync(join(tracker, milestone))) {
      if (!/^\d\d-.*\.md$/u.test(name)) continue;
      try {
        if (readFileSync(join(tracker, milestone, name), "utf8").includes(rel)) return true;
      } catch {
        // An unreadable spec does not match.
      }
    }
  }
  return false;
}

/** Appends `rel` to `<root>/.tracker/.pending-sync` unless a line already holds it. Returns true when it wrote. */
function logPending(root: string, rel: string): boolean {
  const pending = join(root, ".tracker", ".pending-sync");
  if (!existsSync(pending)) writeFileSync(pending, "");
  const lines = readFileSync(pending, "utf8").split("\n");
  if (lines.includes(rel)) return false;
  appendFileSync(pending, `${rel}\n`);
  return true;
}

/** What the drift check does for one PostToolUse payload. Returns the path it logged, or null. */
export function recordDrift(payload: Payload, cwd: string): string | null {
  const input = payload.tool_input;
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    driftDebug("no file_path");
    return null;
  }
  const tool = input as Payload;
  const file = field(tool, "file_path") || field(tool, "filePath");
  if (file === "") {
    driftDebug("no file_path");
    return null;
  }

  const root = findTrackerParent(cwd);
  if (root === null) {
    driftDebug("no tracker");
    return null;
  }

  const rel = relativeTo(root, file);
  if (rel.startsWith(".tracker/") || rel.includes("/.tracker/")) return null;
  if (!mentionedInSpec(root, rel)) return null;
  if (!logPending(root, rel)) return null;
  driftDebug(`logged ${rel}`);
  return rel;
}

/** `darius hook-drift`: reads the PostToolUse hook JSON on stdin. Always exits 0. */
export function runHookDrift(): number {
  try {
    const payload = readPayload();
    if (payload === null) return 0;
    recordDrift(payload, process.cwd());
  } catch {
    // Fail open.
  }
  return 0;
}
