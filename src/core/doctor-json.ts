/**
 * `darius doctor --json` carries every part (0.138.0).
 *
 * The legacy doctor writes its JSON report to stdout, and may end the process
 * itself with `process.exit`. The parts darius adds after it (alert channels,
 * box, hosts, checkout, tracker location notes, tree conflicts) used to go to
 * stderr in `--json` mode, and the tree conflicts went to stdout as text.
 * Now the legacy stdout is held back, parsed, given one new top-level field
 * `darius`, and written once. No field of the legacy report is renamed or
 * removed. Text that is not a JSON object is written unchanged.
 */

import type { JsonValue } from "./model.ts";

/** The parts darius adds to the legacy doctor, as lines without indent. */
export interface DoctorParts {
  channels: string[];
  box: string[];
  hosts: string[];
  checkout: string[];
  notes: string[];
  treeConflicts: string[];
}

/** Type guards, not bare `typeof`, so the narrowing satisfies `anti-slop/no-runtime-typeof`. */
function isRecord(value: JsonValue): value is { readonly [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type Done = (error?: Error | null) => void;

function isDone(value: BufferEncoding | Done | undefined): value is Done {
  return typeof value === "function";
}

/**
 * The legacy report with the `darius` field added, as the legacy doctor
 * prints it (two-space indent, one newline). Null when `captured` is not one
 * JSON object, or already has a `darius` field.
 */
export function mergeDoctorJson(captured: string, parts: DoctorParts): string | null {
  let report: JsonValue;
  try {
    report = JSON.parse(captured);
  } catch {
    return null;
  }
  if (!isRecord(report) || "darius" in report) return null;
  return `${JSON.stringify({ ...report, darius: parts }, null, 2)}\n`;
}

type Write = typeof process.stdout.write;

function textOf(chunk: string | Uint8Array): string {
  return chunk instanceof Uint8Array ? Buffer.from(chunk).toString("utf8") : chunk;
}

/** A hold on stdout. */
export interface StdoutHold {
  /** Gives stdout and `process.exit` back, and returns the text held. Safe to call twice: the second call returns "". */
  release(): string;
}

/**
 * Holds back what the process writes to stdout through `process.stdout.write`.
 * `onExit` runs when the code calls `process.exit` while the hold is on, before
 * the exit goes on: it must `release()` and write what it has to write, so the
 * merged report is out before the exit hooks of the JSON error contract look at
 * stdout (src/core/json-errors.ts).
 */
export function holdStdout(onExit: () => void): StdoutHold {
  const write: Write = process.stdout.write;
  const exit = process.exit;
  const chunks: string[] = [];
  let held = true;
  const holding = (chunk: string | Uint8Array, ...rest: (BufferEncoding | Done | undefined)[]): boolean => {
    chunks.push(textOf(chunk));
    const done = rest.findLast(isDone);
    if (done !== undefined) done();
    return true;
  };
  const exiting = (code?: number | string | null): never => {
    onExit();
    return process.exit(code ?? undefined);
  };
  // SAFETY: `holding` takes the chunk and ignores the rest; it is the part of `write` that callers use.
  process.stdout.write = holding as Write;
  process.exit = exiting;
  return {
    release(): string {
      if (!held) return "";
      held = false;
      process.stdout.write = write;
      process.exit = exit;
      return chunks.join("");
    },
  };
}
