/**
 * The gate: the one place that decides whether an unattended run may make a
 * tool call (docs/concept.md, "Harnesses, profiles and surfaces" > "One gate,
 * thin shims"). `darius policy-check` feeds it one neutral ToolCall per hook
 * call, whatever the harness.
 *
 * Two scopes, set per run in policy.json as `gate`:
 *
 *   shell  (default) the harness's own allowlist enforces `may`, so the gate
 *          checks shell calls for `hold` and the report-mode write verbs and
 *          leaves every other tool to the allowlist. This is what every run
 *          did before the contract existed.
 *   full   the harness's permission system is off or cannot express the
 *          policy, so the gate enforces all of it: `may` for shell and other
 *          tools, `hold`, the write verbs, and a decision per ToolClass.
 *
 * The gate never second-guesses an allowlist that is on: two matchers that
 * disagree about one command would hold runs that pass today.
 *
 * A decision is allow, deny or hold. `hold` is for what needs a person: a
 * `hold` pattern, a report-mode write verb, any call after the run is held.
 * A policy with `on_hold: "deny"` (0.66.0) turns a `hold` pattern match into
 * a deny that names the pattern: the call is refused, the run goes on, and
 * the model records the command as a needs-decision item.
 * The run is then held and the model must stop. A match only inside quoted
 * text is a deny instead (holdView, 0.64.0). `deny` is for a call the
 * policy does not allow (outside `may`, a file write, a subagent): the model
 * is told why and goes on within the policy, as it does when a native
 * allowlist refuses a call. Holding on those would end a run on its first
 * stray `ls` (architect review, 2026-09-28).
 */

import type { Policy } from "../core/model.ts";
import type { ToolCall } from "./contract.ts";

/** What `policy.json` holds; `darius policy-check` reads it back. */
export interface RunPolicy {
  v: 1;
  project: string;
  ritual: string;
  run: string;
  mode: Policy["mode"];
  may: string[];
  hold: string[];
  /** Absent means "shell". */
  gate?: GateScope;
  /** "deny" (0.66.0): a hold-list match denies the call instead of holding the run. Absent means "stop". */
  on_hold?: "deny";
  /** "required": `run complete --outcome complete` needs a valid darius-result block (src/core/result.ts). */
  result?: "required";
  /**
   * Command lines an operator approved for this run (`darius run follow-up`,
   * 0.46.0). Each passes the gate as written (isGranted). Empty for every
   * other run.
   */
  grants: string[];
  /** The run this one follows up, when it is a follow-up. */
  follow_up_of?: string;
  /**
   * The run's working dir (0.47.1), written with the grants. A granted
   * line passes only when the hook payload's cwd is this dir: the line was
   * approved for one checkout, and a `cd` must not move it elsewhere.
   */
  cwd?: string;
}

export type GateScope = "shell" | "full";

/**
 * Write verbs `report` mode denies on top of the policy's `hold` list. Short
 * and explicit on purpose: the allowlist is the hard gate in `shell` scope,
 * this is the second layer.
 */
export const REPORT_MODE_WRITE_VERBS: readonly string[] = [
  String.raw`\bgit\b.*\s(commit|push)\b`,
  String.raw`(^|[\s;&|(])rm\s`,
  String.raw`\bdeploy\b`,
  String.raw`\btrellis\b`,
  String.raw`\bcurl\b.*\s(-X\s*|--request[\s=]+)(POST|PUT|DELETE|PATCH)\b`,
  String.raw`\bpnpm\s+cli\b.*\s--confirm\b`,
];

/** True when `may` lets the run start subagents (0.21.0): it names the subagent tool, `Agent`. */
export function allowsSubagents(may: readonly string[]): boolean {
  return may.includes("Agent");
}

/**
 * Tells whether an absolute path is the darius binary the hook itself runs
 * (0.66.0). policy-check passes one that compares resolved paths; without
 * one, only the bare word `darius` names the binary.
 */
export type DariusBinCheck = (path: string) => boolean;

/** The program, the verb, the run id and the rest of a protocol line. The rest starts with a blank. */
const PROTOCOL_START = /^\s*(\S+)\s+run\s+(hold|complete)\s+(\S+)(\s.*)$/u;
/** An absolute path to a file named `darius`, as one plain word. */
const DARIUS_PATH = /^\/(?:[\w.+,@%:=-]+\/)*darius$/u;

/**
 * True when `text` is plain arguments: no shell operator, no substitution,
 * no newline outside quotes (0.66.0). Inside single quotes anything but a
 * newline is text. Inside double quotes `( ) ; & | < >` are text, but `$`
 * and a backtick expand, so they are refused unless escaped. An unclosed
 * quote or a trailing backslash is refused.
 */
function plainArguments(text: string): boolean {
  let quote: "'" | '"' | undefined;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i] ?? "";
    if (ch === "\n") return false;
    if (quote === "'") {
      if (ch === "'") quote = undefined;
      continue;
    }
    if (ch === "\\") {
      const next = text[i + 1] ?? "";
      if (next === "" || next === "\n") return false;
      i += 1;
      continue;
    }
    if (quote === '"') {
      if (ch === '"') quote = undefined;
      else if (ch === "$" || ch === "`") return false;
      continue;
    }
    if (ch === "'" || ch === '"') quote = ch;
    else if (/[;&|`$()<>]/u.test(ch)) return false;
  }
  return quote === undefined;
}

/**
 * The verb when `line` is `darius run hold|complete <run> ...` of THIS run
 * with plain arguments (plainArguments), else undefined. The program is the
 * word `darius`, or an absolute path whose last part is `darius` and that
 * `isDariusBin` accepts.
 */
function protocolHead(line: string, run: string, isDariusBin: DariusBinCheck): string | undefined {
  const match = PROTOCOL_START.exec(line);
  if (match === null || match[3] !== run || !plainArguments(match[4] ?? "")) return undefined;
  const program = match[1] ?? "";
  if (program !== "darius" && !(DARIUS_PATH.test(program) && !program.split("/").includes("..") && isDariusBin(program))) return undefined;
  return match[2];
}

/** A heredoc at the end of a `run complete` line: the head, the quote around the delimiter (may be empty), the delimiter. */
const HEREDOC_HEAD = /^(.*)<<-?[ \t]*(['"]?)(\w+)\2\s*$/u;

/** Text an unquoted heredoc body may not hold: a substitution or arithmetic the shell would run. */
const EXPANDS_TO_COMMAND = /\$\(|`|\$\[/u;

/**
 * True for `darius run hold|complete <run> ...` of THIS run with plain
 * arguments, optionally feeding findings through a heredoc that ends the
 * command (protocolVerb).
 */
export function isProtocolCommand(command: string, run: string, isDariusBin: DariusBinCheck = () => false): boolean {
  return protocolVerb(command, run, isDariusBin) !== undefined;
}

/**
 * A leading `cd <dir> &&` (0.64.1). Models often write it before the
 * protocol; it changes nothing the protocol does. The dir is one plain word
 * or one single-quoted word, so no operator or substitution can hide in it.
 */
const CD_PREFIX = /^\s*cd\s+(?:'[^'\n]*'|[^\s;&|`$()<>'"\\]+)\s*&&\s*/u;

/**
 * `hold` or `complete` when the command is the protocol of THIS run, else
 * undefined. One line (protocolHead), or `run complete` with a heredoc
 * whose body ends at its first delimiter line, the last line. A quoted
 * delimiter (`<<'EOF'`) keeps the body as text; an unquoted one (`<<EOF`,
 * 0.66.0) passes only when the body holds no `$(`, backtick or `$[`, so the
 * shell expands nothing that runs.
 */
function protocolVerb(command: string, run: string, isDariusBin: DariusBinCheck): string | undefined {
  const lines = command.replace(/\n+$/u, "").split("\n");
  const first = (lines[0] ?? "").replace(CD_PREFIX, "");
  if (lines.length === 1) return protocolHead(first, run, isDariusBin);
  const heredoc = HEREDOC_HEAD.exec(first);
  if (heredoc === null) return undefined;
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === heredoc[3]);
  if (end !== lines.length - 1) return undefined;
  if (heredoc[2] === "" && EXPANDS_TO_COMMAND.test(lines.slice(1, -1).join("\n"))) return undefined;
  const verb = protocolHead(heredoc[1] ?? "", run, isDariusBin);
  return verb === "complete" ? verb : undefined;
}

// --- `may` rules ---------------------------------------------------------------------

/**
 * What `*` matches in a shell rule: anything but a shell operator. So
 * `Bash(pnpm cli fc *)` never matches `pnpm cli fc x; rm -rf ~`. A rule that
 * needs an operator spells it out: `Bash(cd tools && pnpm cli fc *)`.
 */
const STAR = "(?:[^;&|\\n`<>$]|\\$(?!\\())*";

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);
}

/**
 * A rule body as an anchored regex source, `star` standing for `*`. The
 * legacy `prefix:*` form is the prefix alone, or the prefix and arguments.
 * So is one program word and ` *` (`prog *`, 0.66.0): it also allows the bare
 * `prog`, as `prog:*` does. A rule with more words (`pnpm cli *`) does not
 * change.
 */
function ruleSource(pattern: string, star: string): string {
  const legacy = pattern.endsWith(":*");
  const bare = !legacy && /^[^\s*]+ \*$/u.test(pattern);
  const body = legacy || bare ? pattern.slice(0, -2) : pattern;
  const source = body.split("*").map(escapeRegex).join(star);
  if (legacy) return `^${source}(?:\\s${star})?$`;
  return bare ? `^${source}(?: ${star})?$` : `^${source}$`;
}

/** A Claude permission rule body (`git status`, `pnpm cli *`, `npm run test:*`) as an anchored regex. */
export function shellRuleRegex(pattern: string): RegExp {
  return new RegExp(ruleSource(pattern, STAR), "u");
}

const SHELL_RULE = /^Bash(?:\((.*)\))?$/su;

function ruleAllows(command: string, may: readonly string[]): boolean {
  return may.some((rule) => {
    const match = SHELL_RULE.exec(rule);
    if (match === null) return false;
    const pattern = match[1];
    if (pattern === undefined) return true;
    return shellRuleRegex(pattern).test(command);
  });
}

/** Where an output redirection may write: a file under /tmp, or /dev/null. */
const REDIRECT_TARGET = /^(?:\/dev\/null|\/tmp\/[\w.,+=@%:/-]+)$/u;

/**
 * True for a scratch file: an absolute path under /tmp with no `..` step
 * (0.23.0). A run may write there with a redirection or a write tool; it
 * changes nothing in a repo or a product.
 */
export function isScratchPath(path: string): boolean {
  return path.startsWith("/tmp/") && path.length > "/tmp/".length && !path.split("/").includes("..") && !path.includes("\0");
}
/** Where a redirection target ends. */
const TARGET_END = /[\s;&|<>()]/u;

type Scan = { parts: string[] } | { refused: string };
type Redirect = { part: string; end: number } | { refused: string };

/**
 * Reads the output redirection that starts at `line[at]` (`>`, `>>`, `&>`,
 * `N>`, `N>&M`). `part` is the command text so far; digits that form a word
 * of their own right before the `>` are its file descriptor and leave it.
 * Returns the part without the redirection and the index after it.
 */
function readRedirect(line: string, at: number, part: string): Redirect {
  const both = line[at] === "&";
  const fd = both ? null : /(?:^|\s)(\d+)$/u.exec(part);
  const before = fd === null ? part : part.slice(0, part.length - (fd[1] ?? "").length);
  let i = both ? at + 2 : at + 1;
  const append = line[i] === ">";
  if (append) i += 1;
  if (line[i] === "&") {
    const digits = /^\d+/u.exec(line.slice(i + 1))?.[0] ?? "";
    const after = line[i + 1 + digits.length] ?? "";
    if (both || append || digits === "" || (after !== "" && !TARGET_END.test(after))) {
      return { refused: "an output redirection darius cannot check; use > /tmp/<file>, 2> /tmp/<file> or 2>&1" };
    }
    return { part: before, end: i + 1 + digits.length };
  }
  while (line[i] === " " || line[i] === "\t") i += 1;
  let end = i;
  while (end < line.length && !TARGET_END.test(line[end] ?? "")) end += 1;
  const target = line.slice(i, end);
  if (!REDIRECT_TARGET.test(target) || target.split("/").includes("..")) {
    return { refused: `an output redirection to "${clip(target)}"; output may go only to a file under /tmp or to /dev/null` };
  }
  return { part: before, end };
}

/**
 * Splits a shell line into the commands it runs, reading quotes the way the
 * shell does: an operator inside quotes is plain text. An output redirection
 * to a file under /tmp or to /dev/null, or from one descriptor to another
 * (`2>&1`), leaves its command (0.18.1). Anything whose meaning a split
 * cannot keep is refused with the reason: command substitution (`$(`,
 * backticks, also inside double quotes), any other redirection, a lone `&`
 * (background), a subshell parenthesis, a trailing backslash, an unclosed
 * quote, an empty command.
 */
function scanShell(line: string): Scan {
  const parts: string[] = [];
  let part = "";
  let quote: "'" | '"' | undefined;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i] ?? "";
    const next = line[i + 1] ?? "";
    if (quote === "'") {
      if (ch === "'") quote = undefined;
      part += ch;
      continue;
    }
    if (ch === "\\") {
      if (next === "" || next === "\n") return { refused: "a trailing backslash" };
      part += ch + next;
      i += 1;
      continue;
    }
    if (ch === "`" || (ch === "$" && next === "(")) {
      return { refused: "command substitution ($(...) or backticks); run the inner command on its own first" };
    }
    if (quote === '"') {
      if (ch === '"') quote = undefined;
      part += ch;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      part += ch;
      continue;
    }
    if (ch === ">" || (ch === "&" && next === ">")) {
      const redirect = readRedirect(line, i, part);
      if ("refused" in redirect) return redirect;
      part = `${redirect.part} `;
      i = redirect.end - 1;
      continue;
    }
    if (ch === "<") return { refused: "an input redirection (< or <<); pass the file as an argument" };
    if (ch === "(" || ch === ")") return { refused: "a subshell parenthesis" };
    const operator = ch === "&" && next === "&" ? 2 : ch === "|" && next === "|" ? 2 : ch === "|" || ch === ";" || ch === "\n" ? 1 : 0;
    if (ch === "&" && operator === 0) return { refused: "a background job (a lone &)" };
    if (operator === 0) {
      part += ch;
      continue;
    }
    parts.push(part.trim());
    part = "";
    i += operator - 1;
  }
  if (quote !== undefined) return { refused: "an unclosed quote" };
  parts.push(part.trim());
  return parts.some((command) => command === "") ? { refused: "an empty command" } : { parts };
}

/** The commands of a shell line (scanShell), or null when the split cannot keep its meaning. */
export function splitShell(line: string): string[] | null {
  const scan = scanShell(line);
  return "parts" in scan ? scan.parts : null;
}

/** One command, already free of unquoted operators: `*` may match anything here, quotes included. */
function ruleAllowsCommand(command: string, may: readonly string[]): boolean {
  return may.some((rule) => {
    const match = SHELL_RULE.exec(rule);
    if (match === null) return false;
    const pattern = match[1];
    if (pattern === undefined) return true;
    return new RegExp(ruleSource(pattern, "[\\s\\S]*"), "u").test(command);
  });
}

/**
 * One leading shell assignment: a POSIX name, `=`, then a value made of
 * single-quoted text, double-quoted text, escaped characters and plain word
 * characters. Command substitution never reaches here: scanShell refuses it
 * on the whole line first. A `$VAR` in the value is the shell's business.
 */
const ASSIGNMENT = /^([A-Za-z_][A-Za-z0-9_]*)=((?:'[^']*'|"(?:[^"\\]|\\[\s\S])*"|\\[\s\S]|[^\s'"\\])*)(?:\s+|$)/u;

/**
 * Names whose value changes which program a later command runs or which
 * config it reads (a search path, a preload, a shell hook, a home or config
 * directory, a tool's own settings). An assignment to one of them never
 * passes on its own; the part then needs a rule that matches it whole, as
 * before 0.42.3.
 */
const STEERING_NAME =
  /^(?:PATH|IFS|ENV|BASH_ENV|CDPATH|FPATH|PROMPT_COMMAND|PS4|SHELLOPTS|BASHOPTS|GLOBIGNORE|HOME|TMPDIR|EDITOR|VISUAL|PAGER|LESSOPEN|LESSCLOSE|CURL_HOME|WGETRC|NODE_OPTIONS|NODE_PATH|LD_\w*|DYLD_\w*|XDG_\w*|GIT_\w*|SSH_\w*|PYTHON\w*|PERL\w*|RUBY\w*|BUN_\w*|NPM_\w*|npm_\w*|DARIUS_\w*)$/u;

/** The names a command's leading assignments set, and the command after them. */
export interface Assignments {
  names: string[];
  rest: string;
}

/** The leading assignments of one split command, and the command after them ("" for a bare assignment). */
export function stripAssignments(command: string): Assignments {
  const names: string[] = [];
  let rest = command;
  for (let match = ASSIGNMENT.exec(rest); match !== null && match[0] !== ""; match = ASSIGNMENT.exec(rest)) {
    names.push(match[1] ?? "");
    rest = rest.slice(match[0].length);
  }
  return { names, rest };
}

/**
 * Why `may` refuses one split command, or undefined. A bare assignment
 * (`UA="..."`) runs nothing and needs no rule; an assignment prefix
 * (`X=1 cmd`) leaves the rules to the command after it (0.42.3). An
 * assignment to a STEERING_NAME is not stripped.
 */
function partRefusal(part: string, may: readonly string[]): string | undefined {
  if (ruleAllowsCommand(part, may)) return undefined;
  const { names, rest } = stripAssignments(part);
  const steering = names.find((name) => STEERING_NAME.test(name));
  if (steering !== undefined) return `no may rule allows "${clip(part)}" (an assignment to ${steering} changes what commands run)`;
  if (rest === "" || (names.length > 0 && ruleAllowsCommand(rest, may))) return undefined;
  return `no may rule allows "${clip(part)}"`;
}

/**
 * Why `may` refuses the line, or undefined when it allows it: one rule
 * matches it whole (`*` never crossing an operator), or the shell split of
 * the line (scanShell) gives commands that each match a rule. Inside one
 * split command `*` may match quoted text with operators in it, because the
 * shell passes that as an argument and never runs it. A bare assignment
 * passes and an assignment prefix leaves its command (partRefusal). The
 * reason goes to the model, so it names the construct or the command that
 * failed.
 */
export function mayRefusal(command: string, may: readonly string[]): string | undefined {
  const trimmed = command.trim();
  if (ruleAllows(trimmed, may)) return undefined;
  const scan = scanShell(trimmed);
  if ("refused" in scan) return `the line has ${scan.refused}`;
  for (const part of scan.parts) {
    const refused = partRefusal(part, may);
    if (refused !== undefined) return refused;
  }
  return undefined;
}

/** True when `may` allows the line (mayRefusal). */
export function mayAllowsShell(command: string, may: readonly string[]): boolean {
  return mayRefusal(command, may) === undefined;
}

// --- grants ----------------------------------------------------------------------------

/** The longest granted line, in characters. */
export const GRANT_MAX = 300;

/** Shell words that expand outside quotes: a glob, a brace list, a home dir. */
const EXPANDING = new Set(["*", "?", "[", "]", "{", "}", "~"]);

/**
 * A command line with the spaces and tabs outside quotes collapsed to one
 * space, trimmed. Quoted text stays as it is: there the spaces are part of
 * an argument. A newline is never collapsed: the shell runs it as a second
 * command.
 */
export function normalizeGrant(line: string): string {
  let out = "";
  let quote: "'" | '"' | undefined;
  let gap = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i] ?? "";
    if (quote === undefined && (ch === " " || ch === "\t")) {
      gap = true;
      continue;
    }
    if (gap && out !== "") out += " ";
    gap = false;
    out += ch;
    if (ch === "\\" && quote !== "'") {
      out += line[i + 1] ?? "";
      i += 1;
    } else if (quote === undefined && (ch === "'" || ch === '"')) quote = ch;
    else if (quote === ch) quote = undefined;
  }
  return out;
}

/** The first shell word outside quotes that expands (EXPANDING), or undefined. */
function unquotedExpansion(line: string): string | undefined {
  let quote: "'" | '"' | undefined;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i] ?? "";
    if (quote === undefined && ch === "\\") i += 1;
    else if (quote === undefined && (ch === "'" || ch === '"')) quote = ch;
    else if (quote === ch) quote = undefined;
    else if (quote === undefined && EXPANDING.has(ch)) return ch;
  }
  return undefined;
}

/** True for a control character other than a tab, which counts as a space. */
function hasControl(line: string): boolean {
  for (const char of line) {
    const code = char.codePointAt(0) ?? 0;
    if (char === "\t") continue;
    if (code < 0x20 || (code >= 0x7f && code < 0xa0)) return true;
  }
  return false;
}

/**
 * Programs that run code the operator did not read: a shell, a script
 * loader, or a wrapper that runs the command it is given. A grant names the
 * command itself instead. `pnpm`, `node` and the like stay grantable: their
 * line names what they run.
 */
const LOADERS: ReadonlySet<string> = new Set(["bash", "sh", "zsh", "dash", "fish", "eval", "source", ".", "exec", "env", "xargs", "nohup", "setsid", "sudo", "time", "command", "builtin"]);

/** The program word of a line after its assignments, unquoted, without its dir. */
function programWord(line: string): string {
  const first = stripAssignments(line).rest.trim().split(/\s+/u)[0] ?? "";
  const bare = first.replaceAll(/["'\\]/gu, "");
  return bare.slice(bare.lastIndexOf("/") + 1);
}

/**
 * Why `line` cannot be a granted command, or undefined when it can. A grant
 * is one plain command, so what the operator read is what runs: one line of
 * at most GRANT_MAX characters, one part in the shell split (no &&, ||, ;,
 * |), no redirection, no substitution, no $ at all, no glob, brace or ~
 * outside quotes, no assignment that steers which program runs, and no
 * shell or loader as the program (LOADERS). A command
 * that needs another dir names it with a flag (`pnpm -C tools ...`).
 */
export function grantRefusal(line: string): string | undefined {
  const trimmed = line.trim();
  if (trimmed === "") return "an empty command";
  const length = [...trimmed].length;
  if (length > GRANT_MAX) return `at most ${String(GRANT_MAX)} characters, got ${String(length)}`;
  if (hasControl(trimmed)) return "a newline or another control character; give one command on one line";
  if (trimmed.includes("$")) return "a $ (a variable or a substitution); write the value out";
  const scan = scanShell(trimmed);
  if ("refused" in scan) return scan.refused;
  if (scan.parts.length !== 1) return "more than one command (&&, ||, ; or |); give each command on its own, and a dir with a flag such as -C, not cd";
  if (normalizeGrant(scan.parts[0] ?? "") !== normalizeGrant(trimmed)) return "an output redirection; a granted command writes no file";
  const expansion = unquotedExpansion(trimmed);
  if (expansion !== undefined) return `a ${expansion} outside quotes; the shell would expand it`;
  const steering = stripAssignments(trimmed).names.find((name) => STEERING_NAME.test(name));
  if (steering !== undefined) return `an assignment to ${steering}, which changes what commands run`;
  const program = programWord(trimmed);
  if (LOADERS.has(program)) return `${/^[aeiou]/u.test(program) ? "an" : "a"} ${program} line runs code the operator does not see; grant the command itself`;
  return undefined;
}

/**
 * True when the main session runs a line an operator granted: the line is
 * one plain command (grantRefusal), the session's dir is the run's dir
 * (policy.cwd, 0.47.1), and the line equals a grant once both are
 * normalized (normalizeGrant). A line that holds a grant as one part of a
 * chain is not granted. A subagent never gets a grant: the operator
 * approved what the session they started runs, and the hook tells the two
 * apart by the payload's agent id (src/harness/claude.ts).
 */
function isGranted(command: string, policy: RunPolicy, call: { agentId?: string | undefined; cwd?: string | undefined }): boolean {
  const { grants } = policy;
  if (grants.length === 0 || call.agentId !== undefined) return false;
  // 0.47.1: only in the run's working dir. No cwd on either side: no grant.
  if (policy.cwd === undefined || call.cwd === undefined || call.cwd !== policy.cwd) return false;
  if (grantRefusal(command) !== undefined) return false;
  const line = normalizeGrant(command.trim());
  return grants.some((grant) => normalizeGrant(grant.trim()) === line);
}

// --- follow-up from inside a run --------------------------------------------------------

/**
 * True when the line starts a follow-up run (`darius run follow-up ...`)
 * anywhere in it, under any prefix: `env -u DARIUS_RUN`, `FOO=1`, `sudo`,
 * `nohup`, `setsid`, a path to the binary, `bash -c "..."`. Quotes and
 * backslashes are dropped first, so `"run" follow-up` counts too. Broad on
 * purpose: a run must never grant itself lines, and a false match is only
 * a deny, never a hold. The CLI refuses inside a run as well (DARIUS_RUN),
 * but `env -u` clears that, so the gate is the second wall (0.47.1).
 */
export function startsFollowUp(command: string): boolean {
  return /\brun follow-up\b/u.test(plainShell(command));
}

/** True when the line forwards a run verb to another host (`darius run now X --on HOST`, 0.50.0): ssh drops DARIUS_RUN, so the gate stops it here. */
export function forwardsRun(command: string): boolean {
  return /\brun (?:now|resume|follow-up)\b.*\s--on(?:[\s=]|$)/u.test(plainShell(command));
}

/** The line without quotes, backslashes and `$` (so `$'follow-up'` reads as `follow-up`), runs of blanks as one space: what the shell would read as words. */
function plainShell(command: string): string {
  return command.replaceAll(/["'\\$]/gu, "").replaceAll(/\s+/gu, " ");
}

/**
 * `DARIUS_RUN=`, `unset DARIUS_RUN`, `env -u DARIUS_RUN`, `env --unset=...`,
 * `env -i` (also in a cluster, `env -iu X`) and `env -`: a line that clears the variables that tell darius it
 * runs inside a run. With them gone, `darius run follow-up` would not know.
 */
const CLEARS_RUN_MARKER =
  /\bDARIUS_RUN(?:_POLICY)?\s*=|\bunset\b[^;&|\n]*\bDARIUS_RUN|(?:^|\s)(?:-\w*u\s*|--unset[=\s]\s*)DARIUS_RUN|\benv(?:\s+-\S+)*\s+(?:-\w*i\w*\b|--ignore-environment\b|-(?:\s|$))/u;

/** True when the line clears the run's own markers (CLEARS_RUN_MARKER). */
export function clearsRunMarker(command: string): boolean {
  return CLEARS_RUN_MARKER.test(plainShell(command));
}

// --- decision ------------------------------------------------------------------------

function firstMatch(command: string, patterns: readonly string[]): string | undefined {
  return patterns.find((pattern) => new RegExp(pattern, "u").test(command));
}

/**
 * Programs that run their arguments as a command, here or on another host.
 * When a line names one outside quotes, its quoted text is a command after
 * all, and the hold check reads the line as written (holdView).
 */
const RUNS_ARGUMENTS: ReadonlySet<string> = new Set([
  ...LOADERS,
  "ssh",
  "su",
  "doas",
  "timeout",
  "watch",
  "nice",
  "ionice",
  "stdbuf",
  "parallel",
  "flock",
  "chroot",
  "nsenter",
  "unshare",
  "script",
  "trap",
]);

/**
 * Words the shell reads before the program of a command: a negation, a
 * group brace, and the keywords of `if`, `while`, `until` and `for` bodies.
 * The hold check looks past them for the program (holdProgram).
 */
const SHELL_KEYWORDS: ReadonlySet<string> = new Set(["!", "{", "}", "if", "then", "elif", "else", "fi", "do", "done", "while", "until"]);

/** The program of one split command for the hold check: programWord, after any SHELL_KEYWORDS. */
function holdProgram(part: string): string {
  let rest = stripAssignments(part.trim()).rest.trim();
  for (let word = rest.split(/\s+/u)[0] ?? ""; SHELL_KEYWORDS.has(word); word = rest.split(/\s+/u)[0] ?? "") {
    rest = stripAssignments(rest.slice(word.length).trim()).rest.trim();
  }
  return programWord(rest);
}

/** True when one split command runs its arguments (RUNS_ARGUMENTS), so its quoted text is a command after all. */
function runsArguments(part: string): boolean {
  return RUNS_ARGUMENTS.has(holdProgram(part));
}

/**
 * Quoted text with a blank in it becomes `_`; quoted text without a blank
 * loses its quotes (holdView).
 */
function blankQuotes(command: string): string {
  let out = "";
  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i] ?? "";
    if (ch === "\\") {
      out += ch + (command[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (ch !== "'" && ch !== '"') {
      out += ch;
      continue;
    }
    let text = "";
    for (i += 1; i < command.length && command[i] !== ch; i += 1) {
      const inner = command[i] ?? "";
      if (ch === '"' && inner === "\\" && /["\\$`]/u.test(command[i + 1] ?? "")) i += 1;
      text += command[i] ?? "";
    }
    out += /\s/u.test(text) ? "_" : text;
  }
  return out;
}

/**
 * The line as the hold check reads it (0.64.0), or undefined when only the
 * line as written will do. Quoted text with a blank in it is one argument
 * (a jq filter, a commit message, a search text) and becomes `_`: the
 * program gets it as data, so `jq '.posts // .wp // null'` does not read as
 * a `wp` command. Quoted text without a blank loses its quotes, so
 * `"wp" plugin list` still reads `wp plugin list`. Undefined when scanShell
 * refuses the line, or when the program of one of its commands runs its
 * arguments (RUNS_ARGUMENTS: `bash -c "..."`, `ssh host "..."`). Since
 * 0.66.0 only the program word of each command counts, so a `.` that names
 * a dir (`find . -name x`) is not the `.` loader. The gate reads each
 * command apart (holdMatch); this is the view of a whole line.
 */
export function holdView(command: string): string | undefined {
  const scan = scanShell(command);
  if ("refused" in scan) return undefined;
  return scan.parts.some((part) => runsArguments(part)) ? undefined : blankQuotes(command);
}

/**
 * A line that ends in a quoted heredoc (`cmd <<'EOF'`, body, `EOF`): the
 * shell never expands that body, so it is text the command reads, like
 * quoted text (0.64.1). Returns the command before `<<` and the body, or
 * undefined. The hold check reads only that command, so a body that names
 * a hold word denies instead of holding, and `bash <<'EOF'` still holds.
 */
function heredocHead(command: string): { head: string; body: string } | undefined {
  const lines = command.replace(/\n+$/u, "").split("\n");
  const head = /^([^\n]*?)<<-?(['"])(\w+)\2[ \t]*$/u.exec(lines[0] ?? "");
  if (head === null) return undefined;
  // The body ends at the first line that is the delimiter; that must be the last line.
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === head[3]);
  return end === lines.length - 1 ? { head: head[1] ?? "", body: lines.slice(1, -1).join("\n") } : undefined;
}

/**
 * What a hold list does with a line: undefined when no pattern matches it.
 * Since 0.66.0 the line is split into its commands (scanShell) and each is
 * read apart, so a pattern never matches across `|`, `;`, `&&` or `||`:
 * `curl URL | tr -d x` is not `curl ... -d`. Per command, as in 0.64.0: a
 * pattern that matches the command as the hold check reads it (blankQuotes)
 * holds, so `"wp" plugin list` holds too; one that matches only the
 * command as written matched inside quoted text: `quotedOnly`, which is
 * denied, not held. A command whose program runs its arguments (`bash -c`,
 * `ssh`, `eval`, `xargs`, `sudo`) is read as written and holds. A line the
 * split refuses is read whole and as written, as before 0.64.0. A quoted
 * heredoc body is text for the command before `<<`: quoted text, unless
 * that command runs its arguments (`bash <<'EOF'`).
 */
function holdMatch(command: string, patterns: readonly string[]): { pattern: string; quotedOnly: boolean } | undefined {
  const heredoc = heredocHead(command);
  const parts = splitShell(heredoc?.head ?? command);
  if (parts === null) {
    const whole = firstMatch(command, patterns);
    return whole === undefined ? undefined : { pattern: whole, quotedOnly: false };
  }
  let quoted: string | undefined;
  for (const part of parts) {
    const strict = runsArguments(part);
    const held = firstMatch(strict ? part : blankQuotes(part), patterns);
    if (held !== undefined) return { pattern: held, quotedOnly: false };
    quoted ??= strict ? undefined : firstMatch(part, patterns);
  }
  if (heredoc !== undefined) {
    const reader = parts.at(-1) ?? "";
    const inBody = firstMatch(heredoc.body, patterns);
    if (inBody !== undefined && runsArguments(reader)) return { pattern: inBody, quotedOnly: false };
    quoted ??= inBody;
  }
  return quoted === undefined ? undefined : { pattern: quoted, quotedOnly: true };
}

function quotedOnlyDeny(pattern: string, command: string): GateDecision {
  return deny(
    `the pattern /${pattern}/ matches only inside quoted text, so darius refused the call but did not hold the run. ` +
      `Write the call so the quoted text does not match /${pattern}/ (or put that text in a file under /tmp and pass the file), then go on: ${clip(command)}`,
  );
}

/** The deny reason of a hold-list match under `on_hold: "deny"` (0.66.0). The model reads it and goes on. */
export function onHoldDenyReason(pattern: string): string {
  return (
    `outside this run's scope (hold rule: ${pattern}). Do not try another form of this command. ` +
    "Record it as a needs-decision item with the exact command, and go on with the rest of the work."
  );
}

function clip(command: string): string {
  return command.slice(0, 300);
}

/**
 * What the gate decided. `holdPattern` names the hold-list pattern that
 * matched, on a hold and on the deny of an `on_hold: "deny"` policy, so the
 * gate log can count them.
 */
export type GateDecision = { verdict: "allow" } | { verdict: "deny" | "hold"; reason: string; holdPattern?: string };

const ALLOW: GateDecision = { verdict: "allow" };

function deny(reason: string): GateDecision {
  return { verdict: "deny", reason };
}

function hold(reason: string): GateDecision {
  return { verdict: "hold", reason };
}

/**
 * One shell command. Throws on an invalid regex. A subagent may hold the
 * run (fail closed) but not complete it: the main session collects the
 * findings, and the ledger cannot tell the two apart. A granted line
 * (isGranted) passes the hold list, `may` and the report-mode verbs; a run
 * that is held stays held (decide checks that first). A line that starts a
 * follow-up or clears the run's markers is denied in every run, whatever
 * `may` says (0.47.1).
 */
function decideShell(command: string, policy: RunPolicy, scope: GateScope, call: ToolCall, isDariusBin: DariusBinCheck): GateDecision {
  const { agentId } = call;
  const protocol = protocolVerb(command, policy.run, isDariusBin);
  if (protocol === "complete" && agentId !== undefined) {
    return deny("only the main session completes the run; return your findings to it");
  }
  // The protocol's heredoc body is text the shell never runs, so it may name a follow-up.
  if (protocol !== undefined) return ALLOW;
  // Before `may`, hold and grants (0.47.1): `Bash(darius *)` must not let a run start a follow-up.
  if (startsFollowUp(command)) return deny(`a run never starts a follow-up; a person does, outside the run: ${clip(command)}`);
  if (forwardsRun(command)) return deny(`a run never forwards a run to another host: ${clip(command)}`);
  if (clearsRunMarker(command)) return deny(`a run keeps DARIUS_RUN and DARIUS_RUN_POLICY as they are: ${clip(command)}`);
  if (isGranted(command, policy, call)) return ALLOW;
  const held = holdMatch(command, policy.hold);
  if (held?.quotedOnly === true) return quotedOnlyDeny(held.pattern, command);
  if (held !== undefined && policy.on_hold === "deny") return { verdict: "deny", reason: onHoldDenyReason(held.pattern), holdPattern: held.pattern };
  if (held !== undefined) return { verdict: "hold", reason: `the command matches the hold pattern /${held.pattern}/: ${clip(command)}`, holdPattern: held.pattern };
  const refusal = scope === "full" ? mayRefusal(command, policy.may) : undefined;
  if (refusal !== undefined) return deny(`the command is not allowed by the policy's may rules (${refusal}): ${clip(command)}`);
  if (policy.mode !== "report") return ALLOW;
  const verb = holdMatch(command, REPORT_MODE_WRITE_VERBS);
  if (verb === undefined) return ALLOW;
  if (verb.quotedOnly) return quotedOnlyDeny(verb.pattern, command);
  return hold(`report mode denies write verbs (/${verb.pattern}/): ${clip(command)}`);
}

/** The `full` scope's decision for a call that is not a shell command. */
function decideTool(call: ToolCall, policy: RunPolicy): GateDecision {
  switch (call.class) {
    case "read":
    case "internal":
      return ALLOW;
    case "write":
      if (call.path !== undefined && isScratchPath(call.path)) return ALLOW;
      return deny(`unattended runs write files only under /tmp (${call.name} ${clip(call.path ?? "without a path")}); put proposed changes in the findings`);
    case "agent":
      return decideSubagent(call, policy);
    case "web":
      if (policy.mode === "report") return deny(`report mode denies web access (${call.name})`);
      return policy.may.includes(call.name) ? ALLOW : deny(`${call.name} is not in the policy's may rules`);
    case "other":
      return policy.may.includes(call.name) ? ALLOW : deny(`${call.name} is not in the policy's may rules`);
    case "shell":
      return deny(`${call.name} came without a command`);
  }
}

/**
 * A call that starts a subagent (0.21.0). Allowed only when `may` names
 * Agent, never from a subagent (no nesting), and never with `isolation`: a
 * remote subagent runs where this gate cannot see it, and a worktree writes
 * a branch into the checkout.
 */
function decideSubagent(call: ToolCall, policy: RunPolicy): GateDecision {
  if (!allowsSubagents(policy.may)) return deny(`unattended runs start subagents only when the policy's may names Agent (${call.name})`);
  if (call.agentId !== undefined) return deny(`a subagent may not start another subagent (${call.name})`);
  if (call.isolation !== undefined) return deny(`unattended subagents run in this session only; start it without isolation "${call.isolation}"`);
  return ALLOW;
}

/** What the gate does with this tool call. Throws on an invalid regex. */
export function decide(call: ToolCall, context: { policy: RunPolicy; isHeld: boolean; isDariusBin?: DariusBinCheck }): GateDecision {
  const { policy } = context;
  const scope = policy.gate ?? "shell";
  if (scope === "shell" && (call.class !== "shell" || call.command === undefined)) return ALLOW;
  if (context.isHeld) return hold(`run ${policy.run} is held; stop now and wait for an operator`);
  if (call.class === "shell" && call.command !== undefined) return decideShell(call.command, policy, scope, call, context.isDariusBin ?? (() => false));
  return decideTool(call, policy);
}
