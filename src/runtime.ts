/**
 * The handful of things Bun and Node spell differently.
 *
 * darius runs on either: Bun if the host has it, otherwise Node >= 22.6, which
 * executes TypeScript directly (bare `node file.ts` from 23.6, and behind
 * `--experimental-strip-types` before that; `scripts/run.sh` passes the flag
 * when it is needed). Keeping the divergence in one file is what makes that
 * cheap. Nothing else in `src/` may reach for a runtime-specific global.
 */

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
