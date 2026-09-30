/**
 * Checklist checks: the line grammar, the Expected grammar, the shell no-op
 * classifier, and the executor that runs one Command.
 *
 * Ported, not reinvented. The grammar and the classifier come from the old
 * tracker CLI (its checklist parser, expectation grammar and verification
 * runner), and the executor from the legacy vigil sweep script it replaced.
 * Those rules were measured on 60 real vigils. Keep their semantics: a check
 * this module cannot see is a check the old CLI could not see either, so
 * `darius vigil sweep` and `tracker verify` classify the same body the same way.
 *
 * Classification (what a check IS) is pure and never runs anything. Only
 * `runCheck` spawns a process.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { performance } from "node:perf_hooks";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Check {
  /** Zero-based position in the body, the same index `tracker verify` used. */
  index: number;
  /** The label after the checkbox marker. */
  text: string;
  /** The `Command:` value with its backticks removed. */
  command?: string;
  /** The raw `Expected:` value with its backticks removed. */
  expected?: string;
  /**
   * Set when `expected` is the `manual (owner: X, expires: YYYY-MM-DD)` form.
   * A field the author left out is an empty string, never a guess.
   */
  manual?: { owner: string; expires: string };
}

export type Expectation =
  | { kind: "exit"; code: number }
  | { kind: "stdout-contains"; needle: string }
  | { kind: "stdout-matches"; pattern: RegExp }
  | { kind: "file-exists"; path: string };

export interface CheckRun {
  /** The process exit code, or null when a signal ended it (always null on timeout). */
  exit: number | null;
  outcome: "pass" | "fail" | "timeout";
  /** The last 4 KB of stdout followed by stderr. */
  output: string;
  durationMs: number;
}

export interface RunCheckOptions {
  cwd: string;
  timeoutMs: number;
  /** Added to the inherited environment for this Command only. */
  env?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Checklist line grammar
// ---------------------------------------------------------------------------

// Byte for byte the tracker CLI's `lib/markdown/checklist.ts`. The markers are
// pending, verified, in progress, blocked and skipped; darius reads every one
// of them as a check, as the old sweep did.
const ITEM_RE = /^(\s*)- \[([ xX~!-])\] (.*)$/;
const COMMAND_RE = /^\s*- Command:\s*(`+)(.*?)\1\s*$|^\s*- Command:\s*(.+)$/;
const EXPECTED_RE = /^\s*- Expected:\s*(`+)(.*?)\1\s*$|^\s*- Expected:\s*(.+)$/;

/**
 * `Expected: manual (owner: …, expires: …)`. Anything that starts with the
 * word `manual` is an operator decision, not a malformed expectation (the legacy
 * tracker runner and vigil sweep treat it the same way).
 */
const MANUAL_EXPECTATION_RE = /^\s*manual\b/i;
const MANUAL_OWNER_RE = /\bowner:\s*([^,)]+)/i;
const MANUAL_EXPIRES_RE = /\bexpires:\s*([^,)]+)/i;

/**
 * Every checklist item in a body, in document order.
 *
 * A `Command:` or `Expected:` line attaches to the item above it. A heading or
 * a `---` rule ends the current item, so a later section's sub-bullets are
 * never glued onto the last check of an earlier one.
 */
export function parseChecklist(body: string): Check[] {
  const checks: Check[] = [];
  let current: Check | null = null;

  for (const line of body.split("\n")) {
    const item = ITEM_RE.exec(line);
    if (item) {
      if (current !== null) checks.push(current);
      current = { index: checks.length, text: item[3] ?? "" };
      continue;
    }
    if (current === null) continue;

    const command = COMMAND_RE.exec(line);
    if (command) {
      current.command = (command[2] ?? command[3] ?? "").trim();
      continue;
    }
    const expected = EXPECTED_RE.exec(line);
    if (expected) {
      attachExpected(current, (expected[2] ?? expected[3] ?? "").trim());
      continue;
    }
    if (line.startsWith("#") || line.startsWith("---")) {
      checks.push(current);
      current = null;
    }
  }
  if (current !== null) checks.push(current);
  return checks;
}

function attachExpected(check: Check, expected: string): void {
  check.expected = expected;
  if (!MANUAL_EXPECTATION_RE.test(expected)) {
    delete check.manual;
    return;
  }
  check.manual = {
    owner: MANUAL_OWNER_RE.exec(expected)?.[1]?.trim() ?? "",
    expires: MANUAL_EXPIRES_RE.exec(expected)?.[1]?.trim() ?? "",
  };
}

// ---------------------------------------------------------------------------
// Expected grammar: the four forms `tracker verify` parses
// ---------------------------------------------------------------------------

/**
 * Parse an `Expected:` value. Never throws.
 *
 * Anything outside the four forms is an error, not a guess. A vigil whose
 * Expected reads "context shows draftAndNotify: false" is prose for a person,
 * and scoring it as a pass would be an invented verdict (the legacy
 * vigil sweep did the same).
 */
export function parseExpectation(raw: string): Expectation | { error: string } {
  const trimmed = raw.trim();
  if (trimmed === "") return { error: "empty expectation string" };

  const exit = /^exit\s+(-?\d+)$/.exec(trimmed);
  if (exit) return { kind: "exit", code: Number.parseInt(exit[1] ?? "0", 10) };

  const contains = /^stdout\s+contains\s+([\s\S]+)$/.exec(trimmed);
  if (contains) {
    return { kind: "stdout-contains", needle: stripSurroundingQuotes((contains[1] ?? "").trim()) };
  }

  const matches = /^stdout\s+matches\s+([\s\S]+)$/.exec(trimmed);
  if (matches) return parseRegexLiteral((matches[1] ?? "").trim());

  const file = /^file\s+exists\s+(\S+)$/.exec(trimmed);
  if (file) return { kind: "file-exists", path: stripSurroundingQuotes((file[1] ?? "").trim()) };

  return { error: `unknown expectation form: ${trimmed}` };
}

/**
 * `/re/flags`, or a bare pattern. Flags after the closing slash are kept: they
 * used to be dropped silently, so `/^ok$/m` could not opt into multiline
 * (tracker `grammar.ts` ~100). Invalid flags surface as an error.
 */
function parseRegexLiteral(literal: string): Expectation | { error: string } {
  let body = literal;
  let flags = "";
  if (body.startsWith("/") && body.length >= 2) {
    const lastSlash = body.lastIndexOf("/");
    if (lastSlash > 0) {
      flags = body.slice(lastSlash + 1);
      body = body.slice(1, lastSlash);
    }
  }
  try {
    return { kind: "stdout-matches", pattern: new RegExp(body, flags) };
  } catch (cause) {
    return { error: `invalid regex: ${cause instanceof Error ? cause.message : String(cause)}` };
  }
}

function stripSurroundingQuotes(text: string): string {
  if (text.length < 2) return text;
  const first = text[0];
  const last = text.at(-1);
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) return text.slice(1, -1);
  return text;
}

// ---------------------------------------------------------------------------
// Shell no-op classifier
// ---------------------------------------------------------------------------

/**
 * Shell no-ops that print without checking anything. `echo manual: confirm X`
 * with `Expected: exit 0` was the most common way an item got a green tick for
 * nothing (tracker `runner.ts` ~66).
 */
const NO_OP_COMMANDS: ReadonlySet<string> = new Set(["echo", "printf", "true", ":"]);

/**
 * Stages that only move the shell. `cd` is transparent: counting it as real
 * work would make `cd . && echo todo` a one-keystroke evasion of the whole
 * classifier (tracker `runner.ts` ~76).
 */
const TRANSPARENT_COMMANDS: ReadonlySet<string> = new Set(["cd"]);

/** `FOO=1 BAR="x y" echo hi` starts with `echo`. */
const LEADING_ASSIGNMENT_RE = /^\s*[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S*)\s+/;

/** An assignment prefix cannot be longer than the stage, so this bounds the strip loop. */
const MAX_LEADING_ASSIGNMENTS = 64;

/**
 * What a Command is, decided without running it.
 *
 * - `none`: no Command, or only whitespace.
 * - `noop`: every stage, after dropping `cd` stages, is `echo`, `printf`,
 *   `true` or `:`. A Command that is only `cd` is a no-op too.
 * - `exec`: anything else. `echo "select …" | scripts/db-query.sh` is a real
 *   production query and executes.
 *
 * Pipeline-aware since 2026-09-02: reading only the first token filed four
 * armed vigils with a real `echo … | db-query.sh` query as placeholders
 * (tracker `runner.ts` ~250, M315/07). Still token-prefix based, so
 * `/bin/echo x` or `sh -c 'echo x'` read as executable. That is the right
 * trade: this stops the lazy placeholder, not an adversary.
 */
export function classifyCommand(cmd: string | undefined): "none" | "noop" | "exec" {
  if (cmd === undefined || cmd.trim() === "") return "none";
  const meaningful = splitShellStages(cmd).filter(
    (stage) => !TRANSPARENT_COMMANDS.has(stageFirstToken(stage)),
  );
  if (meaningful.every((stage) => NO_OP_COMMANDS.has(stageFirstToken(stage)))) return "noop";
  return "exec";
}

/** Scanner state for `splitShellStages`. */
interface StageScan {
  stages: string[];
  current: string;
  quote: '"' | "'" | null;
  substitutionDepth: number;
  inBackticks: boolean;
}

/**
 * Split a Command at `|`, `||`, `&&`, `;` and newline, ignoring any operator
 * inside single quotes, double quotes, `$( … )` or backticks. Empty stages are
 * dropped, so a trailing `;` does not make a stage.
 *
 * `\"` inside a double-quoted word must not end the word. A live vigil carries
 * `printf "… '[{\"reason\":\"broken_link…\"}]';\n" | scripts/db-query.sh`, and a
 * splitter that lost the quote there swallowed the pipe and called a real
 * production query a no-op (tracker `runner.ts` ~92).
 */
export function splitShellStages(command: string): string[] {
  const scan: StageScan = { stages: [], current: "", quote: null, substitutionDepth: 0, inBackticks: false };
  let i = 0;
  while (i < command.length) i += scanOne(scan, command, i);
  pushStage(scan);
  return scan.stages;
}

function pushStage(scan: StageScan): void {
  const trimmed = scan.current.trim();
  if (trimmed !== "") scan.stages.push(trimmed);
  scan.current = "";
}

/** Consume the text at `i` and return how many characters it took. */
function scanOne(scan: StageScan, command: string, i: number): number {
  const ch = command[i] ?? "";
  const next = command[i + 1];
  if (scan.quote === "'") {
    scan.current += ch;
    if (ch === "'") scan.quote = null;
    return 1;
  }
  // A backslash escapes the next character inside "…" and in bare words alike.
  if (ch === "\\" && next !== undefined) {
    scan.current += ch + next;
    return 2;
  }
  if (scan.quote === '"') {
    scan.current += ch;
    if (ch === '"') scan.quote = null;
    return 1;
  }
  return scanUnquoted(scan, command, i);
}

function scanUnquoted(scan: StageScan, command: string, i: number): number {
  const ch = command[i] ?? "";
  if (ch === '"' || ch === "'") {
    scan.quote = ch;
    scan.current += ch;
    return 1;
  }
  if (ch === "`") {
    scan.inBackticks = !scan.inBackticks;
    scan.current += ch;
    return 1;
  }
  if (ch === "$" && command[i + 1] === "(") {
    scan.substitutionDepth++;
    scan.current += "$(";
    return 2;
  }
  if (ch === ")" && scan.substitutionDepth > 0) {
    scan.substitutionDepth--;
    scan.current += ch;
    return 1;
  }
  if (scan.substitutionDepth > 0 || scan.inBackticks) {
    scan.current += ch;
    return 1;
  }
  if (command.startsWith("&&", i) || command.startsWith("||", i)) {
    pushStage(scan);
    return 2;
  }
  if (ch === "|" || ch === ";" || ch === "\n") {
    pushStage(scan);
    return 1;
  }
  scan.current += ch;
  return 1;
}

/**
 * First word of a stage after every leading `VAR=val`. Whole-token, so
 * `echoserver`, `truealike` and `/bin/echo` are not mistaken for no-ops.
 */
export function stageFirstToken(stage: string): string {
  let rest = stage;
  for (let n = 0; n < MAX_LEADING_ASSIGNMENTS; n++) {
    const stripped = rest.replace(LEADING_ASSIGNMENT_RE, "");
    if (stripped === rest) break;
    rest = stripped;
  }
  return /^\s*(\S+)/.exec(rest)?.[1] ?? "";
}

// ---------------------------------------------------------------------------
// Executor
// ---------------------------------------------------------------------------

/** Grace between SIGTERM and SIGKILL on a timed-out Command (as in the legacy vigil sweep). */
const KILL_GRACE_MS = 3000;

/**
 * After SIGKILL, how long to wait for the pipes to close. A process that left
 * the group (`setsid`) can hold stdout open forever; past this the executor
 * stops waiting and reports the timeout anyway.
 */
const PIPE_CLOSE_GRACE_MS = 1000;

/** The output kept for evidence. */
const OUTPUT_TAIL_BYTES = 4096;

/** Per stream. The tracker CLI's `maxBuffer`. Older bytes are dropped first. */
const MAX_CAPTURE_BYTES = 16 * 1024 * 1024;

/**
 * Run one executable check and evaluate its Expected clause.
 *
 * The Command runs as `bash -lc <command>` in `o.cwd`. The login shell is on
 * purpose: the timer units carry a minimal PATH, and `-l` gives the check the
 * operator's own tools. It costs about 0.8 s per Command (measured on the lead host,
 * 2026-09-28).
 *
 * The child leads its own process group, and a timeout signals the whole
 * group: SIGTERM, then SIGKILL 3 s later. Killing only the shell wrapper left
 * 16 nested grandchildren alive on 2026-09-03 and took the host to load 61
 * (as in the legacy vigil sweep).
 *
 * `file exists` runs the Command first, then stats the path relative to
 * `o.cwd`, as djinn's sweep did. `stdout contains` and `stdout matches` read
 * stdout followed by stderr; `matches` ignores trailing whitespace, because
 * shell output ends in a newline that `$` would otherwise never pass.
 *
 * Throws when the check is not executable: no Command, no Expected, a manual
 * item, or an Expected the grammar rejects. Classify first; a sweep only runs
 * what `classifyCommand` calls `exec`.
 */
export async function runCheck(check: Check, o: RunCheckOptions): Promise<CheckRun> {
  const expectation = executableExpectation(check);
  const started = performance.now();
  const run = await spawnGroup(check.command ?? "", o);
  const durationMs = Math.round(performance.now() - started);
  const combined = run.stdout + run.stderr;
  const output = tailBytes(combined);
  if (run.isTimedOut) return { exit: null, outcome: "timeout", output, durationMs };
  const isPass = evaluate({ expectation, combined, cwd: o.cwd, exit: run.exit });
  return { exit: run.exit, outcome: isPass ? "pass" : "fail", output, durationMs };
}

function executableExpectation(check: Check): Expectation {
  const where = `check #${check.index} (${check.text})`;
  if (check.command === undefined || check.command.trim() === "") {
    throw new Error(`${where} has no Command, so there is nothing to run`);
  }
  if (check.manual !== undefined || check.expected === undefined) {
    throw new Error(`${where} has no executable Expected clause`);
  }
  const parsed = parseExpectation(check.expected);
  if ("error" in parsed) throw new Error(`${where}: ${parsed.error}`);
  return parsed;
}

function evaluate(input: { expectation: Expectation; combined: string; cwd: string; exit: number | null }): boolean {
  const { expectation, combined } = input;
  switch (expectation.kind) {
    case "exit":
      return input.exit === expectation.code;
    case "stdout-contains":
      return combined.includes(expectation.needle);
    case "stdout-matches":
      expectation.pattern.lastIndex = 0;
      return expectation.pattern.test(combined.trimEnd());
    case "file-exists":
      return existsSync(isAbsolute(expectation.path) ? expectation.path : resolve(input.cwd, expectation.path));
  }
}

interface GroupRun {
  stdout: string;
  stderr: string;
  exit: number | null;
  isTimedOut: boolean;
}

/** A bounded byte capture that keeps the newest bytes. */
class Capture {
  #chunks: Buffer[] = [];
  #size = 0;

  add(chunk: Buffer): void {
    this.#chunks.push(chunk);
    this.#size += chunk.length;
    while (this.#size > MAX_CAPTURE_BYTES && this.#chunks.length > 1) {
      this.#size -= this.#chunks.shift()?.length ?? 0;
    }
  }

  text(): string {
    return Buffer.concat(this.#chunks).toString("utf8");
  }
}

/**
 * Runs first in every check shell. A login shell re-reads /etc/profile, and on
 * NixOS that REPLACES PATH, so a check under a systemd unit lost every dir the
 * unit put there, darius's own bin among them. This appends those dirs again,
 * after the login PATH, so the login PATH still wins as in a terminal.
 */
const RESTORE_PARENT_PATH = [
  'IFS=: read -r -a __darius_dirs <<< "${DARIUS_PARENT_PATH:-}"',
  'for __darius_dir in "${__darius_dirs[@]}"; do',
  '  case "$__darius_dir" in /*) ;; *) continue ;; esac',
  '  case ":$PATH:" in *":$__darius_dir:"*) ;; *) PATH="$PATH:$__darius_dir" ;; esac',
  "done",
  "unset __darius_dirs __darius_dir DARIUS_PARENT_PATH",
].join("\n");

function spawnGroup(command: string, o: RunCheckOptions): Promise<GroupRun> {
  return new Promise((done) => {
    const child = spawn("bash", ["-lc", `${RESTORE_PARENT_PATH}\n${command}`], {
      cwd: o.cwd,
      // A process-group leader, which is what makes `process.kill(-pid)` legal.
      detached: true,
      env: { ...process.env, DARIUS_PARENT_PATH: process.env.PATH ?? "", ...o.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = new Capture();
    const stderr = new Capture();
    child.stdout.on("data", (chunk: Buffer) => stdout.add(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.add(chunk));

    let isTimedOut = false;
    let isSettled = false;
    let exit: number | null = null;
    const timers: ReturnType<typeof setTimeout>[] = [];

    const killGroup = (signal: NodeJS.Signals): void => {
      if (child.pid === undefined) return;
      try {
        process.kill(-child.pid, signal);
      } catch {
        // The group is gone; the leader may still be reachable on its own.
        child.kill(signal);
      }
    };

    const settle = (spawnError = ""): void => {
      if (isSettled) return;
      isSettled = true;
      clearTimers(timers);
      done({ stdout: stdout.text(), stderr: stderr.text() + spawnError, exit, isTimedOut });
    };

    timers.push(
      setTimeout(() => {
        isTimedOut = true;
        killGroup("SIGTERM");
        timers.push(
          setTimeout(() => {
            killGroup("SIGKILL");
            timers.push(setTimeout(() => settle(), PIPE_CLOSE_GRACE_MS));
          }, KILL_GRACE_MS),
        );
      }, o.timeoutMs),
    );

    child.on("exit", (code) => {
      exit = code;
    });
    child.on("close", (code) => {
      exit = code;
      settle();
    });
    child.on("error", (cause) => settle(`\n${cause.message}`));
  });
}

function clearTimers(timers: readonly ReturnType<typeof setTimeout>[]): void {
  for (const timer of timers) clearTimeout(timer);
}

/** The last 4 KB of `text`, starting on a whole UTF-8 character. */
function tailBytes(text: string): string {
  const bytes = Buffer.from(text, "utf8");
  if (bytes.length <= OUTPUT_TAIL_BYTES) return text;
  let start = bytes.length - OUTPUT_TAIL_BYTES;
  // Skip UTF-8 continuation bytes (10xxxxxx) so the tail starts on a character.
  while (start < bytes.length && ((bytes[start] ?? 0) & 0xc0) === 0x80) start++;
  return bytes.subarray(start).toString("utf8");
}
