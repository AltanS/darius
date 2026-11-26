/**
 * The handful of things Bun and Node spell differently.
 *
 * darius runs on either: Bun if the host has it, otherwise Node >= 22.6, which
 * executes TypeScript directly (bare `node file.ts` from 23.6, and behind
 * `--experimental-strip-types` before that; `scripts/run.sh` passes the flag
 * when it is needed). Keeping the divergence in one file is what makes that
 * cheap. Nothing else in `src/` may reach for a runtime-specific global.
 */

import { writeSync } from "node:fs";

export const isBun = "Bun" in globalThis;

/**
 * The message from a caught value.
 *
 * `catch` binds `unknown`, and `(err as Error).message` yields `undefined` the
 * moment something throws a string or a plain object. The parameter is named
 * `cause` because that is the one name the anti-slop rule accepts for an
 * unavoidable `unknown`: this IS the boundary where a thrown value is decoded.
 */
export function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * Blocks the calling thread for `ms` milliseconds.
 *
 * Only the local store lock uses this: its retry loop is synchronous so that
 * `withLock` can wrap plain synchronous file edits. `Atomics.wait` is allowed on
 * the main thread in both Bun and Node; the spin is the fallback for a host
 * that refuses it.
 */
export function sleepSync(ms: number): void {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      // spin
    }
  }
}

function isBrokenPipe(cause: Error): boolean {
  return "code" in cause && cause.code === "EPIPE";
}

/**
 * Ends the process quietly, with the exit code set so far (0 when none is), when the reader of stdout has gone
 * (`darius list milestones --json | head -1`, 0.138.0). Node reports the broken
 * pipe as an `error` event on `process.stdout`, and Bun as a throw from the
 * stream write; both end as an unhandled stdout error, and a stack trace. Only
 * EPIPE on stdout is handled: any other stdout error is thrown again, loud.
 */
export function exitQuietlyOnBrokenPipe(): void {
  process.stdout.on("error", (cause: Error) => {
    if (!isBrokenPipe(cause)) throw cause;
    process.exit();
  });
}

/** How long `writeStdoutSync` waits before it tries a full pipe again. */
const FULL_PIPE_WAIT_MS = 5;

function isFullPipe(cause: Error): boolean {
  return "code" in cause && cause.code === "EAGAIN";
}

/** Writes all of `bytes` to stdout. Returns true when the reader has gone (EPIPE), false when all went out. */
function writeBytesSync(bytes: Uint8Array): boolean {
  let offset = 0;
  while (offset < bytes.length) {
    try {
      offset += writeSync(1, bytes, offset);
    } catch (cause) {
      if (cause instanceof Error && isBrokenPipe(cause)) return true;
      if (!(cause instanceof Error) || !isFullPipe(cause)) throw cause;
      sleepSync(FULL_PIPE_WAIT_MS);
    }
  }
  return false;
}

/**
 * Writes all of `text` to stdout before it returns (0.138.0). A stream write
 * that `process.exit` follows loses what does not fit in the pipe: a slow
 * reader got the first 65536 bytes only. A full pipe is tried again, and a
 * reader that has gone ends the write.
 */
export function writeStdoutSync(text: string): void {
  writeBytesSync(new TextEncoder().encode(text));
}

type WriteDone = (error?: Error | null) => void;

function isEncoding(value: BufferEncoding | WriteDone | undefined): value is BufferEncoding {
  return typeof value === "string";
}

function isWriteDone(value: BufferEncoding | WriteDone | undefined): value is WriteDone {
  return typeof value === "function";
}

/**
 * Makes every write to stdout finish before it returns, when stdout is a pipe or a file.
 * The legacy engine ends the process with `process.exit` itself, and a stream write
 * that `process.exit` follows loses what does not fit in the pipe (`darius scan stubs`
 * gave a reader 65536 bytes of 138893). A terminal is left alone. A reader that has gone
 * ends the process quietly, as `exitQuietlyOnBrokenPipe` does.
 */
export function writeStdoutBeforeExit(): void {
  if (process.stdout.isTTY) return;
  process.stdout.write = (chunk: string | Uint8Array, encodingOrDone?: BufferEncoding | WriteDone, maybeDone?: WriteDone): boolean => {
    const encoding: BufferEncoding = isEncoding(encodingOrDone) ? encodingOrDone : "utf8";
    const done = isWriteDone(encodingOrDone) ? encodingOrDone : maybeDone;
    const bytes = chunk instanceof Uint8Array ? chunk : Buffer.from(chunk, encoding);
    if (writeBytesSync(bytes)) process.exit();
    if (done !== undefined) process.nextTick(done);
    return true;
  };
}
