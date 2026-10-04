/**
 * The rules for a vigil body, shared by `vigil add` and `vigil set-body`.
 *
 * The check is the legacy tracker's `assertVigilBodyIsWorkable`
 * (src/legacy/lib/tracker-writer.ts): the body needs a
 * `## Verification Checklist`, no unrunnable Command, and at least one real
 * assertion. It is a pure function, so native code may call it. The import is
 * dynamic, like src/core/legacy-entry.ts, so a verb that takes no body never
 * loads the legacy tree and the main typecheck does not follow it there.
 */

import { fileURLToPath } from "node:url";

const VENDORED_WRITER = new URL("../legacy/lib/tracker-writer.ts", import.meta.url);

/** What this module needs of the legacy writer module. */
interface LegacyBodyCheck {
  assertVigilBodyIsWorkable(body: string, context: string, slug?: string): number;
}

const EMPTY_BODY = "refusing to write an empty body: the vigil IS the spec you work when its gate fires";

/** Prepends `# <title>` only when the body has no H1 of its own (the legacy rule). */
function withTitle(body: string, title: string): string {
  const hasH1 = body.split("\n").some((line) => /^#\s+\S/u.test(line));
  return hasH1 ? body : `# ${title}\n\n${body}`;
}

export interface CheckedBody {
  body: string;
  /** Checklist items that carry an executable Command. */
  executableCommands: number;
}

/**
 * Validates a supplied body and returns the body to store. Throws an Error
 * (exit 1) naming `context` when the body is empty or not workable.
 */
export async function checkVigilBody(input: { body: string; title: string; slug: string; context: string }): Promise<CheckedBody> {
  if (input.body.trim() === "") throw new Error(`${input.context}: ${EMPTY_BODY}`);
  const body = withTitle(input.body, input.title);
  // SAFETY: darius's own vendored module; the function is checked before it is called.
  const loaded = (await import(VENDORED_WRITER.href)) as Partial<LegacyBodyCheck>;
  if (loaded.assertVigilBodyIsWorkable === undefined) {
    throw new Error(`the legacy tracker writer at ${fileURLToPath(VENDORED_WRITER)} exports no assertVigilBodyIsWorkable()`);
  }
  const executableCommands = loaded.assertVigilBodyIsWorkable(body, input.context, input.slug);
  return { body, executableCommands };
}

/** "1 executable Command", "2 executable Commands". */
export function commandCount(count: number): string {
  return `${count} executable Command${count === 1 ? "" : "s"}`;
}
