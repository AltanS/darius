/**
 * The JSON error contract (since 0.77.0).
 *
 * With `--json`, stdout holds JSON and nothing else, also when the command
 * fails. A failure that wrote nothing to stdout prints one object there:
 * `{"ok":false,"error":"...","code":N}`, and the exit code is N (1 refused or
 * failed, 2 usage, 3 inconclusive environment). A command that already wrote
 * its own JSON before it failed (a verify report, a refused gate) is left as
 * it is: its output is the answer, not an error.
 *
 * `withJsonErrors` watches stdout and stderr for the run, and also catches a
 * verb that ends the process itself with `process.exit` (the vendored legacy
 * verbs do). The human message still goes to stderr.
 */

import { format } from "node:util";

import { errorMessage } from "../runtime.ts";

/** The `--json` flag among `argv`, before a bare `--`. */
export function wantsJson(argv: readonly string[]): boolean {
  for (const token of argv) {
    if (token === "--") return false;
    if (token === "--json") return true;
  }
  return false;
}

/** The text of a stderr stream as one error message: no `darius: ` prefix, trimmed. */
function messageFrom(stderr: string, code: number): string {
  const lines = stderr
    .split("\n")
    .map((line) => line.replace(/^darius: /u, "").trim())
    .filter((line) => line !== "");
  if (lines.length > 0) return lines.join("\n");
  return code === 2 ? "usage error" : "failed";
}

type Write = typeof process.stdout.write;

type Done = (error?: Error | null) => void;
type Rest = [Done?] | [BufferEncoding?, Done?];

/** Calls a stream's real `write` with the arguments it got. */
function forward(write: Write, chunk: string | Uint8Array, rest: Rest): boolean {
  // SAFETY: `write` takes the chunk, then an optional encoding and callback, or only a callback; `Rest` is exactly those two forms.
  return (write as (chunk: string | Uint8Array, ...rest: Rest) => boolean)(chunk, ...rest);
}

/** The text of a stream chunk. */
function textOf(chunk: string | Uint8Array): string {
  return chunk instanceof Uint8Array ? Buffer.from(chunk).toString("utf8") : chunk;
}

/**
 * Runs `run`; with `json` set, turns a failure that printed no JSON into the
 * error object above. Returns the exit code `run` returned.
 */
export async function withJsonErrors(json: boolean, run: () => Promise<number>): Promise<number> {
  if (!json) return run();

  const realExit = process.exit.bind(process);
  const realOut: Write = process.stdout.write.bind(process.stdout);
  const realErr: Write = process.stderr.write.bind(process.stderr);
  let outBytes = 0;
  let errText = "";
  let emitted = false;

  const emit = (code: number): void => {
    if (emitted || code === 0 || outBytes > 0) return;
    emitted = true;
    realOut(`${JSON.stringify({ ok: false, error: messageFrom(errText, code), code })}\n`);
  };

  // Bun's console writes to the file descriptor itself, so the console methods are watched too.
  // While one runs, the stream patches stay quiet: Node routes console through them.
  let inConsole = false;
  const countOut = (text: string): void => {
    outBytes += text.length;
  };
  const countErr = (text: string): void => {
    errText += text;
  };
  const countedOut = (chunk: string | Uint8Array, ...rest: Rest): boolean => {
    if (!inConsole) countOut(textOf(chunk));
    return forward(realOut, chunk, rest);
  };
  const countedErr = (chunk: string | Uint8Array, ...rest: Rest): boolean => {
    if (!inConsole) countErr(textOf(chunk));
    return forward(realErr, chunk, rest);
  };
  const exiting = (code?: number | string | null): never => {
    const final = Number(code ?? process.exitCode ?? 0);
    emit(final);
    return realExit(code ?? undefined);
  };

  const consoleMethods = [
    ["log", countOut],
    ["info", countOut],
    ["debug", countOut],
    ["error", countErr],
    ["warn", countErr],
  ] as const;
  const realConsole = consoleMethods.map(([name]) => console[name]);
  consoleMethods.forEach(([name, count], index) => {
    const real = realConsole[index];
    if (real === undefined) return;
    console[name] = (...args: unknown[]): void => {
      count(`${format(...args)}\n`);
      inConsole = true;
      try {
        real.apply(console, args);
      } finally {
        inConsole = false;
      }
    };
  });

  process.stdout.write = countedOut;
  process.stderr.write = countedErr;
  process.exit = exiting;
  try {
    const code = await run();
    emit(code);
    return code;
  } catch (cause) {
    errText += `${errorMessage(cause)}\n`;
    emit(1);
    throw cause;
  } finally {
    consoleMethods.forEach(([name], index) => {
      const real = realConsole[index];
      if (real !== undefined) console[name] = real;
    });
    process.stdout.write = realOut;
    process.stderr.write = realErr;
    process.exit = realExit;
  }
}
