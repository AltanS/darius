/**
 * Verification runner — executes Command/Expected pairs from checklist items.
 *
 * Each item may have a Command (shell string) and an Expected (assertion clause).
 * This module runs the command and evaluates the assertion.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { parseExpectation, isVerificationStep, type VerificationStep } from "./grammar.ts";

/**
 * Default wall-clock budget for one Command.
 *
 * 60s is right for a grep, a `test -f`, a CLI invocation. It is nowhere near
 * enough for the checks specs actually want to carry — a vitest suite, a
 * `tsc --noEmit`, a container build — which is why `--timeout <seconds>` exists
 * and why a blown budget reports `timeout`, not `fail`: "your check needs more
 * than 60s" and "your check is broken" are different facts and must not share
 * an outcome.
 */
export const DEFAULT_COMMAND_TIMEOUT_MS = 60_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RunOutcome = "pass" | "fail" | "skip" | "error" | "manual" | "timeout";

export type RunResult =
  | { outcome: "pass"; exitCode: number | null }
  | { outcome: "fail"; reason: string; exitCode: number | null }
  | { outcome: "skip"; reason: string; exitCode: null }
  | { outcome: "error"; reason: string; exitCode: null }
  | { outcome: "manual"; reason: string; exitCode: null }
  | { outcome: "timeout"; reason: string; exitCode: null; timeoutMs: number };

export type VerifyItemInput = {
  command: string | null;
  expected: string | null;
  /** Index of this item in the checklist (for reporting) */
  index: number;
  /** Label of the checklist item (for reporting) */
  label: string;
};

/**
 * Execution environment for one check.
 *
 * `cwd` is the directory every Command runs in. Callers pass the workspace root
 * (the parent of `.tracker/`) so a Command means the same thing no matter which
 * directory the CLI was invoked from; the `process.cwd()` fallback exists only
 * for direct library callers and is never used by the CLI.
 */
export type RunOptions = {
  cwd?: string;
  timeoutMs?: number;
};

// ---------------------------------------------------------------------------
// Trivial-command classification
// ---------------------------------------------------------------------------

/**
 * Shell no-ops that produce output without checking anything.
 *
 * `echo manual: confirm X by hand` paired with `Expected: exit 0` is the single
 * most common way a checklist item gets a green tick for nothing: the command
 * always exits 0, so `tracker verify` marks it `[x]` and the spec then *reads*
 * as machine-verified. These four names are the whole family — `echo`,
 * `printf`, `true`, and the shell's `:` builtin.
 */
const NO_OP_COMMANDS: ReadonlySet<string> = new Set(["echo", "printf", "true", ":"]);

/**
 * Stages that neither prove nor disprove anything, and are not placeholders
 * either — they only move the shell somewhere before the real work.
 *
 * `cd acme-web && echo … | scripts/prod-psql.sh` is the estate's canonical
 * repo-scoped check (verify runs every Command from the workspace root, so a
 * sub-repo command MUST carry its own `cd`). Counting `cd` as a real stage
 * would make `cd . && echo todo` the one-keystroke evasion of this whole
 * classifier, so `cd` is transparent: it is skipped, and the verdict is decided
 * by the stages around it.
 */
const TRANSPARENT_COMMANDS: ReadonlySet<string> = new Set(["cd"]);

/** `FOO=1 BAR="x y" echo hi` → `echo hi`. */
const LEADING_ASSIGNMENT_RE =
  /^\s*[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|[^\s]*)\s+/;

/**
 * Split a Command into its shell stages at `|`, `||`, `&&`, `;` and newline,
 * ignoring any operator that sits inside single quotes, double quotes, a
 * `$( … )` substitution or backticks.
 *
 * The quoting rules matter more than they look. A live vigil in this estate
 * carries `cd acme-web && printf "… @> '[{\"reason\":\"tip_prose…\"}]';\n" |
 * scripts/prod-psql.sh` — a splitter that does not honour `\"` inside a
 * double-quoted word loses track of the quote, swallows the trailing pipe, and
 * declares a real production query a no-op.
 *
 * Empty stages are dropped, so a trailing `;` or a doubled separator does not
 * manufacture a stage.
 */
export function splitShellStages(command: string): string[] {
  return splitShellStagesDetailed(command).map((stage) => stage.text);
}

/** A shell operator that separates two stages of a Command. */
export type StageSeparator = "|" | "||" | "&&" | ";" | "\n";

export type ShellStage = {
  /** The stage text, trimmed. */
  text: string;
  /**
   * The operator that separated this stage from the one before it — `null` for
   * the first stage. This is the whole reason the detailed form exists:
   * `a && head -1` and `a | head -1` split identically, but only the second
   * hands the shell `head`'s exit status.
   */
  separator: StageSeparator | null;
};

/**
 * `splitShellStages`, keeping the operator that introduced each stage.
 *
 * Same scanner, same quoting rules, same dropping of empty stages — the string
 * form is a projection of this one, so the two can never disagree about where
 * a stage starts.
 */
export function splitShellStagesDetailed(command: string): ShellStage[] {
  const stages: ShellStage[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let substitutionDepth = 0;
  let inBackticks = false;
  let pending: StageSeparator | null = null;

  const push = (next: StageSeparator | null = null): void => {
    const trimmed = current.trim();
    current = "";
    if (trimmed !== "") {
      stages.push({ text: trimmed, separator: pending });
      pending = next;
      return;
    }
    // Empty stage — a leading or doubled separator. Keep the operator already
    // pending so degenerate input (`a | ; b`) cannot present `b` as though it
    // were cleanly `;`-separated.
    if (pending === null) pending = next;
  };

  for (let i = 0; i < command.length; i++) {
    const ch = command[i] as string;

    if (quote === "'") {
      current += ch;
      if (ch === "'") quote = null;
      continue;
    }

    if (quote === '"') {
      // Inside "…" a backslash escapes the next character; consume the pair so
      // an escaped quote cannot terminate the word.
      if (ch === "\\" && i + 1 < command.length) {
        current += ch + command[i + 1];
        i++;
        continue;
      }
      current += ch;
      if (ch === '"') quote = null;
      continue;
    }

    if (ch === "\\" && i + 1 < command.length) {
      current += ch + command[i + 1];
      i++;
      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }

    if (ch === "`") {
      inBackticks = !inBackticks;
      current += ch;
      continue;
    }

    if (ch === "$" && command[i + 1] === "(") {
      substitutionDepth++;
      current += "$(";
      i++;
      continue;
    }

    if (ch === ")" && substitutionDepth > 0) {
      substitutionDepth--;
      current += ch;
      continue;
    }

    if (substitutionDepth > 0 || inBackticks) {
      current += ch;
      continue;
    }

    if (command.startsWith("&&", i) || command.startsWith("||", i)) {
      push(ch === "&" ? "&&" : "||");
      i++;
      continue;
    }

    if (ch === "|" || ch === ";" || ch === "\n") {
      push(ch);
      continue;
    }

    current += ch;
  }

  push();
  return stages;
}

/**
 * First word of one stage, after stripping every leading `VAR=val` assignment.
 *
 * Whole-token by construction, so `echoserver`, `truealike` and `/bin/echo` are
 * not confused with the no-ops they start with.
 */
export function stageFirstToken(stage: string): string {
  let rest = stage;
  for (;;) {
    const stripped = rest.replace(LEADING_ASSIGNMENT_RE, "");
    if (stripped === rest) break;
    rest = stripped;
  }
  const match = /^\s*(\S+)/.exec(rest);
  return match?.[1] ?? "";
}

/**
 * True if `command` is a shell no-op whose exit status and output prove nothing
 * about the system under test.
 *
 * Pipeline-aware (M315/07). The classifier used to read only the FIRST token of
 * the whole string, so `echo "select …" | scripts/prod-psql.sh` — a real
 * production query — was filed as a placeholder. Measured on this estate on
 * 2026-09-02: four armed vigils counted as unrunnable for exactly that reason,
 * and the workaround people reached for (prefixing `cd <repo> &&`) made the
 * debt look like progress.
 *
 * The rule now: split the Command into stages, drop the transparent ones
 * (`cd`), and call it a no-op only when EVERY remaining stage is a no-op. So
 * `echo todo` and `cd x && echo y` stay manual, while `echo … | <real command>`
 * executes. A Command with no stages at all (empty, or only a `cd`) is a no-op.
 *
 * Still deliberately token-prefix based, and therefore still evadable
 * (`/bin/echo x`, `sh -c 'echo x'`, `printf x | tee /tmp/f` — a pipeline into a
 * pure sink reads as executable because `tee` is a real command). That remains
 * the right trade: this guards against the lazy placeholder, not an adversary,
 * and a classifier that tried to be exhaustive would start refusing honest
 * commands.
 */
export function isTrivialCommand(command: string): boolean {
  const stages = splitShellStages(command);
  const meaningful = stages.filter(
    (stage) => !TRANSPARENT_COMMANDS.has(stageFirstToken(stage)),
  );
  if (meaningful.length === 0) return true;
  return meaningful.every((stage) => NO_OP_COMMANDS.has(stageFirstToken(stage)));
}

// ---------------------------------------------------------------------------
// Constant-pass and placeholder Commands (darius 0.76.0)
// ---------------------------------------------------------------------------

/** `node -e "process.exit(0)"`, `bun -e '...'`, `python -c "..."`: an inline script that only exits. */
const INLINE_EXIT_ONLY_RE =
  /^(?:node|bun|deno|python3?|ruby|perl)\s+(?:-e|-c|--eval)\s+(["'])\s*(?:process\.exit\(\s*0?\s*\)|exit\(?\s*0?\s*\)?|sys\.exit\(\s*0?\s*\)|import sys;\s*sys\.exit\(\s*0?\s*\))?\s*;?\s*\1$/;

/** One stage that exits 0 whatever the system under test looks like. */
function isConstantPassStage(stage: string): boolean {
  const text = stage.replace(LEADING_ASSIGNMENT_RE, "").trim();
  if (/^(?:true|:)(?:\s|$)/.test(text)) return true;
  if (/^exit(?:\s+0)?\s*$/.test(text)) return true;
  // `test 1`, `test x`, `[ 1 ]`: a test of one non-empty literal word is always true.
  if (/^test\s+(?:[A-Za-z0-9_]+|"[^"$`]+"|'[^']+')\s*$/.test(text)) return true;
  if (/^\[\s+(?:[A-Za-z0-9_]+|"[^"$`]+"|'[^']+')\s+\]\s*$/.test(text)) return true;
  return INLINE_EXIT_ONLY_RE.test(text);
}

/**
 * Why a Command passes whatever the system under test looks like, or `null`.
 *
 * `exit 0`, `true`, `:`, `test 1`, `node -e "process.exit(0)"`, and any
 * Command whose last stage is `|| true`, `|| :` or `|| exit 0`. Paired with
 * an `exit` expectation such a Command can never go red. `true` and `:` alone
 * are also shell no-ops (`isTrivialCommand`), which verify already files as
 * manual; this helper names the wider family so `darius spec check` and
 * verify agree.
 */
export function constantPassReason(command: string): string | null {
  const stages = splitShellStagesDetailed(command).filter(
    (stage) => !TRANSPARENT_COMMANDS.has(stageFirstToken(stage.text)),
  );
  const last = stages[stages.length - 1];
  if (last === undefined) return null;
  if (last.separator === "||" && isConstantPassStage(last.text)) {
    return `it ends in "|| ${last.text}", so it exits 0 whatever the earlier stages did`;
  }
  // `a; exit 0`: after `;` the last stage alone decides the status.
  if (last.separator === ";" && isConstantPassStage(last.text)) {
    return `it ends in "; ${last.text}", so it exits 0 whatever the earlier stages did`;
  }
  if (stages.every((stage) => isConstantPassStage(stage.text))) {
    return "it exits 0 whatever the system looks like";
  }
  return null;
}

/** True when the Command exits 0 whatever the system under test looks like. */
export function isConstantPassCommand(command: string): boolean {
  return constantPassReason(command) !== null;
}

/**
 * True when the Command is a placeholder, not a check: an HTML comment, or a
 * Command whose first word is TODO, TBD, FIXME, XXX or PLACEHOLDER, or one
 * that is only `...` or an `<angle placeholder>`.
 */
export function isPlaceholderCommand(command: string): boolean {
  const text = command.trim();
  if (text === "" || text.includes("<!--")) return true;
  if (/^(?:\.\.\.|…|<[^<>]*>)$/.test(text)) return true;
  return splitShellStages(text).some((stage) =>
    /^(?:todo|tbd|fixme|xxx|placeholder)\b/i.test(stageFirstToken(stage)),
  );
}

/** Absolute paths a Command may name: they mean the same thing on every host. */
const PORTABLE_ABSOLUTE_PATHS: ReadonlySet<string> = new Set([
  "/dev/null",
  "/dev/stdin",
  "/dev/stdout",
  "/dev/stderr",
]);

/** The roots a file system path argument starts with. Other `/x/y` words are URL paths or patterns. */
const FILE_SYSTEM_ROOTS = /^(?:\/(?:home|Users|tmp|var|etc|opt|root|mnt|nix|usr)\/[^/]|~\/[^/])/;

/** A quoted string, so `grep -q "/api/v1" file` does not read as a path (0.77.0). */
const QUOTED_STRING = /"(?:\\.|[^"\\])*"|'[^']*'/g;

/**
 * The absolute file system paths a Command names, in order. The spec template
 * forbids them: a Command runs from the workspace root on any host. Since
 * 0.77.0 a path counts only when it is an unquoted word that starts with a
 * common root (`/home/`, `/Users/`, `/tmp/`, `/var/`, `/etc/`, `/opt/`,
 * `/root/`, `/mnt/`, `/nix/`, `/usr/`, or `~/`) and has at least two
 * segments. Quoted strings and URL paths (`/api/v1`) are not paths. A path
 * starts a word (after a space, `=` or a redirect), so the `//` of a URL and
 * the `/` inside a relative path do not count.
 */
export function absolutePathsIn(command: string): string[] {
  const found: string[] = [];
  const unquoted = command.replace(QUOTED_STRING, " ");
  const re = /(?:^|[\s=<>(])((?:\/|~\/)[A-Za-z0-9_.~+-][^\s"'`;|&)<>]*)/g;
  for (const match of unquoted.matchAll(re)) {
    const path = match[1] as string;
    if (PORTABLE_ABSOLUTE_PATHS.has(path)) continue;
    if (!FILE_SYSTEM_ROOTS.test(path)) continue;
    found.push(path);
  }
  return found;
}

// ---------------------------------------------------------------------------
// Trailing-pipe exit-status masking
// ---------------------------------------------------------------------------

/**
 * Commands that report success whatever reached them, so a pipeline ending in
 * one throws away the exit status of every stage before it.
 *
 * A shell pipeline exits with the status of its LAST stage. So
 * `rg -n "foo" file.ts | head -1` paired with `Expected: exit 0` can never
 * fail: `rg` exits 1 when it matches nothing, and `head` exits 0 regardless.
 * Measured on this estate on 2026-09-20: 134 checklist Commands pair a trailing
 * filter with `Expected: exit 0` — 30 of them in ACTIVE specs — and one of them
 * (M347/04 item 3) ticked green while that half of the work had not been
 * started at all.
 *
 * The family is the one measured across `.tracker`, plus `wc`. `wc -l` is
 * included deliberately: it exits 0 whatever it counts, so `… | wc -l` with
 * `Expected: exit 0` is the same defect exactly — and its HONEST pairing,
 * `Expected: stdout matches /^[1-9]/`, is untouched by this guard, which only
 * fires on `exit` expectations.
 *
 * `grep`, `rg`, `jq`, `test` and friends are deliberately absent: they carry a
 * real exit status, so `… | grep -q foo` is a real check and must keep running.
 * The guard is about ACCIDENTAL masking, not about banning pipes.
 */
const EXIT_MASKING_FILTERS: ReadonlySet<string> = new Set([
  "head",
  "tail",
  "sort",
  "uniq",
  "cut",
  "sed",
  "tr",
  "awk",
  "column",
  "wc",
]);

/**
 * The explicit opt-ins. `set -o pipefail` makes the pipeline report the first
 * failing stage; `${PIPESTATUS[0]}` reads a stage's status back by hand. Either
 * one means the author thought about the pipeline's exit status, which is the
 * whole thing this guard is asking for, so the bare mention of them is enough.
 *
 * Both are bash-isms. `spawnSync(..., { shell: true })` runs `/bin/sh`, so a
 * Command that opts in this way needs `/bin/sh` to be bash (it is on the hosts
 * this estate runs on); `bash -c '…'` is the portable form.
 */
const PIPE_STATUS_OPT_IN_RE = /\bpipefail\b|\bPIPESTATUS\b/;

/** `xargs` flags that take a separate value, so the next token is not the child command. */
const XARGS_VALUE_FLAGS: ReadonlySet<string> = new Set([
  "-a",
  "-d",
  "-E",
  "-e",
  "-I",
  "-i",
  "-L",
  "-l",
  "-n",
  "-P",
  "-s",
  "--arg-file",
  "--delimiter",
  "--eof",
  "--replace",
  "--max-args",
  "--max-chars",
  "--max-lines",
  "--max-procs",
]);

/** `xargs` flags that make it run NOTHING on empty input — and so exit 0. */
const XARGS_EMPTY_INPUT_FLAGS: ReadonlySet<string> = new Set([
  "-r",
  "--no-run-if-empty",
]);

/**
 * Is a trailing `| xargs …` a mask?
 *
 * `xargs` is transparent rather than masking: it reports its child's failure as
 * 123/124/125, so the estate's real usage — `grep -rln x … | xargs grep -l y` —
 * DOES fail when the second grep finds nothing, and must keep running. Two
 * shapes still mask: `-r`/`--no-run-if-empty` (an empty pipe runs nothing, so
 * `xargs` exits 0), and a child that is itself a masking filter
 * (`| xargs head -1`). A bare `| xargs` defaults to `echo`, which always
 * succeeds.
 */
function xargsMasksExitStatus(stage: string): boolean {
  const tokens = stage.trim().split(/\s+/).slice(1);
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i] as string;
    if (!token.startsWith("-")) return EXIT_MASKING_FILTERS.has(token);
    if (XARGS_EMPTY_INPUT_FLAGS.has(token)) return true;
    if (XARGS_VALUE_FLAGS.has(token)) i++;
  }
  return true;
}

/**
 * The trailing pipe stage that takes the Command's exit status, or `null` if
 * the Command's own status survives.
 *
 * Only the LAST stage is judged, and only when a single `|` introduced it:
 * `a && head -1` reports `a`'s failure, `a | head -1` does not. A filter buried
 * mid-pipeline (`a | head -1 | grep -q x`) is fine — `grep -q` carries the
 * status the shell reports.
 *
 * Whole-token matching, like `isTrivialCommand`: `/usr/bin/head` and
 * `sh -c 'head -1'` read as real commands. Same trade as the no-op classifier —
 * this catches the accident, not an adversary.
 */
export function trailingPipeFilter(command: string): string | null {
  if (PIPE_STATUS_OPT_IN_RE.test(command)) return null;

  const stages = splitShellStagesDetailed(command);
  const last = stages[stages.length - 1];
  if (last === undefined || last.separator !== "|") return null;

  const token = stageFirstToken(last.text);
  if (token === "xargs") return xargsMasksExitStatus(last.text) ? "xargs" : null;
  return EXIT_MASKING_FILTERS.has(token) ? token : null;
}

/**
 * True if the Command's exit status is produced by a trailing filter rather
 * than by the check itself.
 *
 * Paired with `Expected: exit 0` this is worse than a missing check: the item
 * lands in `.verification-log.jsonl` as executed evidence and reads as
 * machine-verified, while being incapable of ever going red.
 */
export function pipelineMasksExitStatus(command: string): boolean {
  return trailingPipeFilter(command) !== null;
}

// ---------------------------------------------------------------------------
// A counting query paired with `exit 0` (M316/19)
// ---------------------------------------------------------------------------

/** The production SQL wrapper. A query through it exits on the QUERY, not the answer. */
const SQL_WRAPPER_RE = /\bprod-psql(?:\.sh)?\b/;

/**
 * A deliberately negated command — `! (echo "..." | prod-psql.sh)`. There the
 * exit status IS the assertion (the query must fail), so the guard stands down.
 */
const NEGATED_COMMAND_RE = /(?:^|[;&|]\s*)!\s*[({]?/;

/** `count(*)`, `count(1)`, `COUNT (x)` — an answer the Expected clause then throws away. */
const SQL_COUNT_RE = /\bcount\s*\(/i;

/**
 * True when the Command asks production for a NUMBER and the Expected clause
 * discards it.
 *
 * `prod-psql.sh <<< "SELECT count(*) FROM creations WHERE ..."` paired with
 * `Expected: exit 0` passes on 0 rows and on 703 rows alike: the exit status
 * belongs to psql, not to the count. Measured 2026-09-20 across `.tracker`,
 * four such items were ticked and every one of them was false — two against a
 * relation and a column that do not exist, two against counts of 703 and 592.
 *
 * Narrow on purpose. A constant probe (`SELECT 1;`) really is a connectivity
 * assertion and carries no count, and a negated command asserts the failure
 * itself; both stay legal.
 */
export function queryAnswerDiscarded(command: string): boolean {
  if (!SQL_WRAPPER_RE.test(command)) return false;
  if (NEGATED_COMMAND_RE.test(command)) return false;
  if (!SQL_COUNT_RE.test(command)) return false;

  // The wrapper must be the stage that PRODUCES the exit status. When a real
  // assertion follows it — `... | grep -q OFFSETS_PRESENT` — the answer is
  // asserted after all, and the shell reports that stage. (A trailing stage
  // that masks instead of asserts, `| head`, is the other guard's business.)
  const stages = splitShellStagesDetailed(command);
  const last = stages[stages.length - 1];
  if (last === undefined) return false;
  return SQL_WRAPPER_RE.test(last.text);
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Classification — everything that can be decided WITHOUT running anything
// ---------------------------------------------------------------------------

/**
 * What a check *is*, decided without executing it.
 *
 * This is the whole of `--dry-run`: parse, classify, report. `runVerification`
 * consumes the same function, so a dry run and a real run can never disagree
 * about what an item is — the only difference between them is that the real run
 * goes on to spawn the process.
 */
/**
 * `Expected: manual (owner: …, expires: …)` — the sanctioned operator-decision
 * form. Anything starting with the word `manual` is treated the same way.
 */
const MANUAL_EXPECTATION_RE = /^\s*manual\b/i;

export type ItemClassification =
  | { kind: "no-pair"; reason: string }
  | { kind: "grammar-error"; reason: string }
  | { kind: "manual"; reason: string }
  /** `file exists <path>` — answered with a stat, never a subprocess. */
  | { kind: "file-check"; path: string }
  /** A real Command that a non-dry run would spawn, as it would be spawned. */
  | { kind: "would-execute"; command: string; expected: string; step: VerificationStep };

/**
 * Classify one checklist item. Executes nothing, stats nothing, writes nothing.
 *
 * `command` is returned in its run-ready form (cwd prefix stripped), so a
 * `--dry-run` report shows the exact string that a real run would hand to the
 * shell rather than the raw spec text.
 */
export function classifyItem(item: VerifyItemInput, opts: RunOptions = {}): ItemClassification {
  const cwd = opts.cwd ?? process.cwd();

  if (item.command === null || item.expected === null) {
    return { kind: "no-pair", reason: "no command/expected pair" };
  }

  // `Expected: manual (owner: <who>, expires: <date>)` — the one sanctioned
  // non-assertion, written by `tracker add spec --manual`. Classified before
  // the grammar parse so a deliberate operator decision reports as MANUAL
  // rather than as a malformed expectation.
  if (MANUAL_EXPECTATION_RE.test(item.expected)) {
    return {
      kind: "manual",
      reason:
        `Expected clause is an operator decision (${JSON.stringify(item.expected)}) — nothing is executed. ` +
        `Record the decision with \`tracker mark <spec> ${item.index} --verified --evidence "..."\`.`,
    };
  }

  const parsed = parseExpectation(item.expected);
  if (!isVerificationStep(parsed)) {
    return { kind: "grammar-error", reason: `grammar error: ${parsed.error}` };
  }

  // Classified before anything else: a no-op command is not evidence, whatever
  // its Expected clause says.
  if (isTrivialCommand(item.command)) {
    return {
      kind: "manual",
      reason:
        `Command is a shell no-op (${JSON.stringify(item.command)}) — running it proves nothing. ` +
        `Record what was actually checked with \`tracker mark <spec> ${item.index} --verified --evidence "..."\`.`,
    };
  }

  // An `exit` assertion on a pipeline that ends in a filter asserts the
  // FILTER's status, not the check's. Refused here, next to the other
  // classification-time refusals, so `--dry-run` and a real run say the same
  // thing and nothing is spawned: executing it would append a ledger line
  // claiming a pass that no repository state could have prevented.
  //
  // Reported as a grammar error on purpose — it is a defect in how the
  // Command/Expected pair is WRITTEN, and the existing grammar-error path
  // already refuses the tick, names the item, and ledgers the attempt as
  // `error`.
  if (parsed.kind === "exit") {
    // A Command that exits 0 whatever happened (`exit 0`, `test 1`,
    // `... || true`) can never fail `Expected: exit 0` (darius 0.76.0).
    const constant = parsed.code === 0 ? constantPassReason(item.command) : null;
    if (constant !== null) {
      return {
        kind: "grammar-error",
        reason:
          `grammar error: the Command passes whatever the system looks like: ${constant}. ` +
          `Write a Command that can fail, or assert on its output.`,
      };
    }

    const filter = trailingPipeFilter(item.command);
    if (filter !== null) {
      return {
        kind: "grammar-error",
        reason:
          `grammar error: the Command's exit status is taken by its trailing \`| ${filter}\` stage, ` +
          `which exits 0 whatever reached it — \`Expected: ${item.expected.trim()}\` asserts the filter's ` +
          `status, not the check's. Assert on the output instead (\`Expected: stdout matches /.../\`), ` +
          `drop the trailing \`| ${filter}\`, or opt in deliberately with \`set -o pipefail; ...\` ` +
          `or \`\${PIPESTATUS[0]}\`.`,
      };
    }

    // A production COUNT whose number the Expected clause throws away. Refused
    // here for the same reason as the trailing pipe: executing it would append
    // a ledger line claiming a pass that no production state could prevent.
    if (queryAnswerDiscarded(item.command)) {
      return {
        kind: "grammar-error",
        reason:
          `grammar error: the Command asks production for a count, and ` +
          `\`Expected: ${item.expected.trim()}\` is the exit status of the psql wrapper, not the ` +
          `count. It passes on 0 rows and on 703 rows alike. Assert the number instead, for ` +
          `example \`Expected: stdout matches /^\\s*0\\s*$/\`.`,
      };
    }
  }

  if (parsed.kind === "file-exists") {
    return { kind: "file-check", path: stripCwdPrefix(parsed.path, cwd) };
  }

  return {
    kind: "would-execute",
    command: stripCwdPrefix(item.command, cwd),
    expected: item.expected,
    step: parsed,
  };
}

// ---------------------------------------------------------------------------
// Main runner function
// ---------------------------------------------------------------------------

/**
 * Evaluate a single checklist item's Command/Expected pair.
 *
 * Returns:
 *  - `{ outcome: "pass" }` if the assertion is satisfied
 *  - `{ outcome: "fail", reason }` if assertion fails
 *  - `{ outcome: "skip", reason }` if no command/expected pair present
 *  - `{ outcome: "error", reason }` if grammar error or command error
 *  - `{ outcome: "manual", reason }` if the Command is a shell no-op — nothing
 *    is executed, and callers must NOT treat this as a pass
 *  - `{ outcome: "timeout", reason, timeoutMs }` if the Command outlived its
 *    budget — distinct from `fail` on purpose: nothing was proven either way
 *
 * Everything except the spawn itself is decided by `classifyItem`, so
 * `--dry-run` (classification only) reports exactly what a real run would do.
 *
 * `manual` is classified BEFORE anything runs (and before the no-execution
 * `file exists` branch), so a trivial Command can never earn a tick by being
 * paired with an assertion that ignores it.
 */
export function runVerification(item: VerifyItemInput, opts: RunOptions = {}): RunResult {
  const cwd = opts.cwd ?? process.cwd();
  const timeoutMs = opts.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
  const classification = classifyItem(item, { cwd, timeoutMs });

  switch (classification.kind) {
    case "no-pair":
      return { outcome: "skip", reason: classification.reason, exitCode: null };

    case "grammar-error":
      return { outcome: "error", reason: classification.reason, exitCode: null };

    case "manual":
      return { outcome: "manual", reason: classification.reason, exitCode: null };

    case "file-check": {
      // Resolved against the run cwd, not the process cwd — a relative path in
      // a spec must mean the same file whichever directory the CLI was called
      // from.
      const target = isAbsolute(classification.path)
        ? classification.path
        : resolve(cwd, classification.path);
      if (existsSync(target)) {
        return { outcome: "pass", exitCode: null };
      }
      return {
        outcome: "fail",
        reason: `file does not exist: ${classification.path}`,
        exitCode: null,
      };
    }

    case "would-execute": {
      const cmdResult = runCommand(classification.command, cwd, timeoutMs);

      if (cmdResult.timedOut) {
        return {
          outcome: "timeout",
          reason:
            `command exceeded its ${timeoutMs / 1000}s budget and was killed — ` +
            `nothing was proven either way. Raise it with \`--timeout <seconds>\` if the check is simply slow.`,
          exitCode: null,
          timeoutMs,
        };
      }

      return evaluateAssertion(classification.step, cmdResult);
    }
  }
}

// ---------------------------------------------------------------------------
// Repo-relative path normalization (issue #4)
// ---------------------------------------------------------------------------

/**
 * Strip a leading run-root prefix from a path token.
 *
 * Specs are committed, so they MUST carry repo-relative paths — an absolute host
 * path (e.g. `/home/alice/repo/src/x.ts`) leaks the author's home-dir layout into
 * git history and only runs on the author's machine. Skills and templates forbid
 * writing them; this is the belt-and-suspenders runtime guard: stripping the
 * directory the command will actually run in is execution-equivalent and lets a
 * stray absolute path degrade gracefully to its repo-relative form.
 *
 * `cwd` must be the directory the Command will be spawned in (the workspace
 * root), NOT necessarily `process.cwd()` — stripping a prefix the command will
 * not be standing in would turn a working absolute path into a broken relative
 * one. The `process.cwd()` default is for direct library callers only.
 */
export function stripCwdPrefix(s: string, cwd: string = process.cwd()): string {
  return s.split(`${cwd}/`).join("");
}

/** True if `s` embeds the run-root prefix — i.e. a stray absolute path. */
export function hasCwdPrefix(s: string, cwd: string = process.cwd()): boolean {
  return s.includes(`${cwd}/`);
}

// ---------------------------------------------------------------------------
// Command execution
// ---------------------------------------------------------------------------

type CommandResult = {
  stdout: string;
  stderr: string;
  combined: string;
  exitCode: number;
  timedOut: boolean;
};

/**
 * Spawn one Command.
 *
 * `cwd` is passed explicitly and always: without it the child inherits whatever
 * directory the CLI happened to be started in, so the same spec item could pass
 * from the repo root and fail from a subdirectory. Callers pass the workspace
 * root — repo-scoped commands in a multi-repo workspace must therefore say
 * `cd <repo> && …` themselves.
 */
function runCommand(cmd: string, cwd: string, timeoutMs: number): CommandResult {
  const result = spawnSync(cmd, {
    shell: true,
    encoding: "utf-8",
    cwd,
    timeout: timeoutMs,
    maxBuffer: 16 * 1024 * 1024,
  });
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  const isTimedOut =
    result.error !== undefined &&
    (result.error as NodeJS.ErrnoException).code === "ETIMEDOUT";
  return {
    stdout,
    stderr,
    combined: stdout + stderr,
    exitCode: result.status ?? -1,
    timedOut: isTimedOut,
  };
}

// ---------------------------------------------------------------------------
// Assertion evaluation
// ---------------------------------------------------------------------------

function evaluateAssertion(
  step: VerificationStep,
  result: CommandResult,
): RunResult {
  switch (step.kind) {
    case "exit": {
      if (result.exitCode === step.code) {
        return { outcome: "pass", exitCode: result.exitCode };
      }
      return {
        outcome: "fail",
        reason: `exit code ${result.exitCode}, expected ${step.code}`,
        exitCode: result.exitCode,
      };
    }
    case "stdout-contains": {
      if (result.combined.includes(step.needle)) {
        return { outcome: "pass", exitCode: result.exitCode };
      }
      return {
        outcome: "fail",
        reason: `output does not contain ${JSON.stringify(step.needle)}`,
        exitCode: result.exitCode,
      };
    }
    case "stdout-matches": {
      // Shell output virtually always carries a trailing newline; without /m,
      // `$` anchors to end-of-string and can never match past it, so patterns
      // like /^[1-9]$/ against `grep -c` output would always fail. Trailing
      // whitespace is command noise, never signal — strip it before testing.
      if (step.pattern.test(result.combined.trimEnd())) {
        return { outcome: "pass", exitCode: result.exitCode };
      }
      return {
        outcome: "fail",
        reason: `output does not match ${step.pattern}`,
        exitCode: result.exitCode,
      };
    }
    case "file-exists": {
      // Already handled above, but TypeScript exhaustion requires this
      return { outcome: "error", reason: "unreachable", exitCode: null };
    }
  }
}
