/**
 * Worklog thread types and validators — no external dependencies.
 *
 * Worklog files are append-only journals that capture decisions, blockers,
 * and artifact paths produced during spec implementation.
 *
 * Each file contains one or more threads, each with a ULID-prefixed header
 * and a sequence of typed entries.
 */

import { TrackerValidationError } from "../markdown/errors.ts";

// ---------------------------------------------------------------------------
// Entry types
// ---------------------------------------------------------------------------

export interface NoteEntry {
  kind: "note";
  text: string;
  timestamp?: string;
}

export interface ArtifactEntry {
  kind: "artifact";
  path: string;
  timestamp?: string;
}

export interface BlockerEntry {
  kind: "blocker";
  text: string;
  timestamp?: string;
}

export type WorklogEntry = NoteEntry | ArtifactEntry | BlockerEntry;

// ---------------------------------------------------------------------------
// Thread type
// ---------------------------------------------------------------------------

export interface WorklogThread {
  /** ULID-prefixed thread identifier, e.g. "01KQA00MJ5725V29Q1AF-auth-refactor" */
  threadId: string;
  /** Human-readable label for the thread */
  label?: string;
  /** ISO timestamp when the thread was opened */
  openedAt?: string;
  /** Ordered list of entries in this thread */
  entries: WorklogEntry[];
}

// ---------------------------------------------------------------------------
// File-level type
// ---------------------------------------------------------------------------

export interface WorklogFile {
  threads: WorklogThread[];
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

function validateWorklogEntry(
  raw: unknown,
  path: string,
  sourcePath?: string,
): WorklogEntry {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new TrackerValidationError({
      path,
      expected: "object",
      actual: Array.isArray(raw) ? "array" : typeof raw,
      sourcePath,
    });
  }

  const d = raw as Record<string, unknown>;
  const kind = d["kind"];

  if (kind === "note") {
    if (typeof d["text"] !== "string") {
      throw new TrackerValidationError({
        path: `${path}.text`,
        expected: "string",
        actual: typeof d["text"],
        sourcePath,
      });
    }
    return { kind: "note", text: d["text"], timestamp: d["timestamp"] as string | undefined };
  }

  if (kind === "artifact") {
    if (typeof d["path"] !== "string") {
      throw new TrackerValidationError({
        path: `${path}.path`,
        expected: "string",
        actual: typeof d["path"],
        sourcePath,
      });
    }
    return { kind: "artifact", path: d["path"], timestamp: d["timestamp"] as string | undefined };
  }

  if (kind === "blocker") {
    if (typeof d["text"] !== "string") {
      throw new TrackerValidationError({
        path: `${path}.text`,
        expected: "string",
        actual: typeof d["text"],
        sourcePath,
      });
    }
    return { kind: "blocker", text: d["text"], timestamp: d["timestamp"] as string | undefined };
  }

  throw new TrackerValidationError({
    path: `${path}.kind`,
    expected: "note | artifact | blocker",
    actual: kind === undefined ? "undefined" : String(kind),
    sourcePath,
  });
}

function validateWorklogThread(
  raw: unknown,
  path: string,
  sourcePath?: string,
): WorklogThread {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new TrackerValidationError({
      path,
      expected: "object",
      actual: Array.isArray(raw) ? "array" : typeof raw,
      sourcePath,
    });
  }

  const d = raw as Record<string, unknown>;

  if (typeof d["threadId"] !== "string") {
    throw new TrackerValidationError({
      path: `${path}.threadId`,
      expected: "string",
      actual: typeof d["threadId"],
      sourcePath,
    });
  }

  if (!Array.isArray(d["entries"])) {
    throw new TrackerValidationError({
      path: `${path}.entries`,
      expected: "array",
      actual: typeof d["entries"],
      sourcePath,
    });
  }

  const entries = d["entries"].map((entry, i) =>
    validateWorklogEntry(entry, `${path}.entries[${i}]`, sourcePath),
  );

  return {
    threadId: d["threadId"],
    label: typeof d["label"] === "string" ? d["label"] : undefined,
    openedAt: typeof d["openedAt"] === "string" ? d["openedAt"] : undefined,
    entries,
  };
}

// ---------------------------------------------------------------------------
// Schema-compatible API shims
// ---------------------------------------------------------------------------

export const WorklogEntrySchema = {
  safeParse(
    data: unknown,
  ): { success: true; data: WorklogEntry } | { success: false; error: { message: string } } {
    try {
      return { success: true, data: validateWorklogEntry(data, "entry") };
    } catch (err) {
      return { success: false, error: { message: err instanceof Error ? err.message : String(err) } };
    }
  },
};

export const WorklogThreadSchema = {
  safeParse(
    data: unknown,
  ): { success: true; data: WorklogThread } | { success: false; error: { message: string } } {
    try {
      return { success: true, data: validateWorklogThread(data, "thread") };
    } catch (err) {
      return { success: false, error: { message: err instanceof Error ? err.message : String(err) } };
    }
  },
};

export const WorklogFileSchema = {
  safeParse(
    data: unknown,
  ): { success: true; data: WorklogFile } | { success: false; error: { message: string } } {
    if (typeof data !== "object" || data === null || Array.isArray(data)) {
      return { success: false, error: { message: "Expected an object" } };
    }
    const d = data as Record<string, unknown>;
    if (!Array.isArray(d["threads"])) {
      return { success: false, error: { message: "threads: expected array" } };
    }
    try {
      const threads = d["threads"].map((t, i) =>
        validateWorklogThread(t, `threads[${i}]`),
      );
      return { success: true, data: { ...d, threads } as WorklogFile };
    } catch (err) {
      return { success: false, error: { message: err instanceof Error ? err.message : String(err) } };
    }
  },

  parse(data: unknown): WorklogFile {
    const result = WorklogFileSchema.safeParse(data);
    if (!result.success) {
      throw new Error(result.error.message);
    }
    return result.data;
  },
};
