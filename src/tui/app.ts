/**
 * The TUI's imperative shell (docs/concept.md, "App design" > "TUI"): the
 * terminal, the event loop, the store reads and the writes. The screens
 * and the key reducer are pure (src/tui/state.ts); everything that touches
 * the world is here.
 *
 * LOOP. Keys, a 5 s refresh tick, a resize and a stop signal all go into one
 * inbox, and one loop takes them in order. Before each chunk of keys and on
 * each tick the store is read again (`loadView`), so a run that ends or gets
 * answered elsewhere shows up. A chunk of keys (a key held down, a paste) is
 * one read, not one per key.
 *
 * WRITES. The TUI writes the store through `answerRun()` and
 * `acknowledgeRun()` (src/runner/hold.ts) only, the same functions as
 * `darius run answer` and `darius run ack` (a decision on a result's
 * questions is the `--note`). A resume starts
 * `darius run resume <run> --project <project>` detached, in its own
 * session, with stdout and stderr appended to
 * `<store>/<project>/runs/<run>/resume.log`, and forgets it: the run's report
 * goes to the webhook, or to that log without one. `n` on a failed run
 * starts `darius run now <slug> --project <project>` the same way, logged to
 * `runs/<failed run>/rerun.log`. The spawner is injectable, so no test
 * starts a process.
 *
 * EXIT. The terminal is restored on every way out: q, Ctrl-C, SIGTERM,
 * SIGHUP, SIGINT, an exception in the loop (the `finally`), and a process
 * exit from anywhere else (the `exit` hook).
 */

import { spawn } from "node:child_process";
import { appendFileSync, closeSync, mkdirSync, openSync } from "node:fs";
import { dirname, join } from "node:path";

import { defaultWho } from "../core/ledger.ts";
import { projectDir } from "../core/paths.ts";
import { openProject } from "../core/store.ts";
import { acknowledgeRun, answerRun } from "../runner/hold.ts";
import { dariusBin } from "../runner/launch.ts";
import { errorMessage } from "../runtime.ts";
import { readDue, readRun, type RunTarget } from "./snapshot.ts";
import { initialState, reduce, render, type Effect, type TuiState, type View } from "./state.ts";
import { colourAllowed, decodeKeys, ENTER_MODES, frame, LEAVE_MODES, type Size } from "./term.ts";
import type { Notice } from "./text.ts";

const REFRESH_MS = 5_000;
const STOP_SIGNALS: readonly NodeJS.Signals[] = ["SIGTERM", "SIGHUP", "SIGINT"];
const FALLBACK_SIZE: Size = { cols: 80, rows: 24 };

/** Starts `program` with `args`, detached, its stdout and stderr appended to `log`. Returns at once. */
export type Spawner = (program: string, args: readonly string[], log: string) => void;

export interface TuiDeps {
  spawn: Spawner;
  /** Who an answer is recorded as. */
  who: () => string;
}

function noteSpawnError(log: string, cause: Error): void {
  try {
    appendFileSync(log, `darius tui: could not start the resume: ${cause.message}\n`);
  } catch {
    // The log cannot be written either; nothing is left to tell.
  }
}

/** The real spawner: its own session (`detached`), no stdin, unref'd so the TUI can quit first. */
export function spawnDetached(program: string, args: readonly string[], log: string): void {
  const fd = openSync(log, "a");
  try {
    const child = spawn(program, [...args], { detached: true, stdio: ["ignore", fd, fd] });
    child.on("error", (cause) => noteSpawnError(log, cause));
    child.unref();
  } finally {
    closeSync(fd);
  }
}

export function defaultDeps(): TuiDeps {
  return { spawn: spawnDetached, who: defaultWho };
}

/** `<store>/<project>/runs/<run>/resume.log`. */
export function resumeLog(target: RunTarget): string {
  return join(projectDir(target.project), "runs", target.run, "resume.log");
}

/** `<store>/<project>/runs/<failed run>/rerun.log`: where `n` logs the `run now` it starts. */
export function rerunLog(target: RunTarget): string {
  return join(projectDir(target.project), "runs", target.run, "rerun.log");
}

/** Starts `darius <args>` detached with its output appended to `log`, after one line that says who started it. */
function startDetached(args: readonly string[], log: string, deps: TuiDeps): void {
  mkdirSync(dirname(log), { recursive: true });
  appendFileSync(log, `${new Date().toISOString()} darius tui: darius ${args.join(" ")}\n`);
  deps.spawn(dariusBin(), args, log);
}

function applyEffect(effect: Effect, deps: TuiDeps): Notice {
  const { target } = effect;
  if (effect.kind === "answer") {
    const refused = answerRun(openProject(target.project), { run: target.run, n: effect.n, text: effect.text, who: deps.who() });
    if (refused !== undefined) return { text: refused, isError: true };
    return { text: `saved the answer to question ${String(effect.n)}`, isError: false };
  }
  if (effect.kind === "ack") {
    const { note } = effect;
    const ack = note === null ? { run: target.run, who: deps.who() } : { run: target.run, who: deps.who(), note };
    const result = acknowledgeRun(openProject(target.project), ack);
    if (!result.ok) return { text: result.error, isError: true };
    if (note !== null) return { text: "saved your decision as the run's acknowledgement", isError: false };
    return { text: "acknowledged the run; the timer still does not retry it today", isError: false };
  }
  if (effect.kind === "run-now") {
    const log = rerunLog(target);
    startDetached(["run", "now", effect.slug, "--project", target.project], log, deps);
    return { text: `running ${effect.slug} now in the background; the report goes to the webhook, or to the log without one: ${log}`, isError: false };
  }
  const log = resumeLog(target);
  startDetached(["run", "resume", target.run, "--project", target.project], log, deps);
  return { text: `resuming in the background; the report goes to the webhook, or to the log without one: ${log}`, isError: false };
}

/** Runs one effect and says how it went. Never throws: a failure comes back as an error notice. */
export function performEffect(effect: Effect, deps: TuiDeps): Notice {
  try {
    return applyEffect(effect, deps);
  } catch (cause) {
    return { text: errorMessage(cause), isError: true };
  }
}

/** What the current screen needs, read fresh. A failed read comes back in `error`, never as a throw. */
export function loadView(state: TuiState, size: Size, now: Date = new Date()): View {
  try {
    if (state.screen === "run" && state.target !== null) return { size, due: null, run: readRun(state.target), error: null };
    return { size, due: readDue(now), run: null, error: null };
  } catch (cause) {
    return { size, due: null, run: null, error: errorMessage(cause) };
  }
}

export interface Pressed {
  state: TuiState;
  view: View;
}

/**
 * One chunk of stdin, key by key: reduce, run the effects, and read the
 * store again when the screen changed or something was written.
 */
export function pressKeys(start: Pressed, data: string, deps: TuiDeps): Pressed {
  let { state, view } = start;
  for (const key of decodeKeys(data)) {
    const step = reduce(state, key, view);
    const notice = step.effects.map((effect) => performEffect(effect, deps)).at(-1);
    const next = notice === undefined ? step.state : { ...step.state, notice };
    const hasMoved = next.screen !== state.screen || next.target !== state.target;
    state = next;
    if (hasMoved || step.effects.length > 0) view = loadView(state, view.size);
    if (state.isDone) break;
  }
  return { state, view };
}

type TuiEvent = { kind: "keys"; data: string } | { kind: "refresh" } | { kind: "stop" };

/** The loop's one queue. `next()` waits until something is in it. */
class Inbox {
  private readonly events: TuiEvent[] = [];
  private wake: (() => void) | null = null;

  push(event: TuiEvent): void {
    this.events.push(event);
    const wake = this.wake;
    this.wake = null;
    wake?.();
  }

  async next(): Promise<TuiEvent> {
    for (;;) {
      const event = this.events.shift();
      if (event !== undefined) return event;
      await new Promise<void>((resolve) => {
        this.wake = resolve;
      });
    }
  }
}

function terminalSize(): Size {
  const { columns, rows } = process.stdout;
  if (!(columns > 0) || !(rows > 0)) return FALLBACK_SIZE;
  return { cols: columns, rows };
}

/** Runs the TUI on this process's terminal until q, Ctrl-C or a stop signal. stdin and stdout must be TTYs. */
export async function runTui(deps: TuiDeps): Promise<number> {
  const { stdin, stdout } = process;
  const inbox = new Inbox();
  const hasColour = colourAllowed();
  let isRestored = false;
  const restore = (): void => {
    if (isRestored) return;
    isRestored = true;
    try {
      stdout.write(LEAVE_MODES);
      stdin.setRawMode(false);
    } catch {
      // The terminal is gone (SIGHUP); there is nothing left to restore.
    }
  };
  const onData = (data: string): void => inbox.push({ kind: "keys", data });
  const onRefresh = (): void => inbox.push({ kind: "refresh" });
  const onStop = (): void => inbox.push({ kind: "stop" });

  process.on("exit", restore);
  for (const signal of STOP_SIGNALS) process.on(signal, onStop);
  stdin.setEncoding("utf8");
  stdin.setRawMode(true);
  stdin.on("data", onData);
  stdin.resume();
  stdout.on("resize", onRefresh);
  const timer = setInterval(onRefresh, REFRESH_MS);
  stdout.write(ENTER_MODES);
  try {
    let state = initialState();
    let view = loadView(state, terminalSize());
    stdout.write(frame(render(state, view), view.size, hasColour));
    while (!state.isDone) {
      const event = await inbox.next();
      if (event.kind === "stop") break;
      view = loadView(state, terminalSize());
      if (event.kind === "keys") ({ state, view } = pressKeys({ state, view }, event.data, deps));
      if (!state.isDone) stdout.write(frame(render(state, view), view.size, hasColour));
    }
  } finally {
    clearInterval(timer);
    stdout.off("resize", onRefresh);
    stdin.off("data", onData);
    for (const signal of STOP_SIGNALS) process.off(signal, onStop);
    restore();
    process.off("exit", restore);
    stdin.pause();
  }
  return 0;
}
