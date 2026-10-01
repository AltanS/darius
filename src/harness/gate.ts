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
 * The run is then held and the model must stop. `deny` is for a call the
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

const PROTOCOL_HEAD = /^\s*darius\s+run\s+(hold|complete)\s+(\S+)\s[^;&|`$()<>\n]*$/u;

/** True when `may` lets the run start subagents (0.21.0): it names the subagent tool, `Agent`. */
export function allowsSubagents(may: readonly string[]): boolean {
  return may.includes("Agent");
}
const HEREDOC_HEAD = /^\s*(darius\s+run\s+complete\s+\S+\s[^;&|`$()<>\n]*)<<-?(['"])(\w+)\2\s*$/u;

/**
 * True for `darius run hold|complete <run> ...` of THIS run with no shell
 * operators, optionally feeding findings through a quoted heredoc
 * (`<<'EOF'`, whose body the shell never expands) that ends the command.
 */
export function isProtocolCommand(command: string, run: string): boolean {
  return protocolVerb(command, run) !== undefined;
}

/** `hold` or `complete` when the command is the protocol of THIS run (isProtocolCommand), else undefined. */
function protocolVerb(command: string, run: string): string | undefined {
  const lines = command.replace(/\n+$/u, "").split("\n");
  const first = lines[0] ?? "";
  if (lines.length === 1) {
    const match = PROTOCOL_HEAD.exec(first);
    return match !== null && match[2] === run ? match[1] : undefined;
  }
  const heredoc = HEREDOC_HEAD.exec(first);
  if (heredoc === null || lines.at(-1)?.trim() !== heredoc[3]) return undefined;
  const head = PROTOCOL_HEAD.exec(heredoc[1] ?? "");
  return head !== null && head[2] === run ? head[1] : undefined;
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

/** A Claude permission rule body (`git status`, `pnpm cli *`, `npm run test:*`) as an anchored regex. */
export function shellRuleRegex(pattern: string): RegExp {
  // The legacy `prefix:*` form: the prefix alone, or the prefix and arguments.
  const legacy = pattern.endsWith(":*");
  const body = legacy ? pattern.slice(0, -2) : pattern;
  const source = body.split("*").map(escapeRegex).join(STAR);
  return new RegExp(`^${source}${legacy ? `(?:\\s${STAR})?` : ""}$`, "u");
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
    const legacy = pattern.endsWith(":*");
    const body = legacy ? pattern.slice(0, -2) : pattern;
    const source = body.split("*").map(escapeRegex).join("[\\s\\S]*");
    return new RegExp(`^${source}${legacy ? "(?:\\s[\\s\\S]*)?" : ""}$`, "u").test(command);
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
 * Why `line` cannot be a granted command, or undefined when it can. A grant
 * is one plain command, so what the operator read is what runs: one line of
 * at most GRANT_MAX characters, one part in the shell split (no &&, ||, ;,
 * |), no redirection, no substitution, no $ at all, no glob, brace or ~
 * outside quotes, no assignment that steers which program runs. A command
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
  return undefined;
}

/**
 * True when the main session runs a line an operator granted: the line is
 * one plain command (grantRefusal) and equals a grant once both are
 * normalized (normalizeGrant). A line that holds a grant as one part of a
 * chain is not granted. A subagent never gets a grant: the operator
 * approved what the session they started runs, and the hook tells the two
 * apart by the payload's agent id (src/harness/claude.ts).
 */
function isGranted(command: string, grants: readonly string[], agentId: string | undefined): boolean {
  if (grants.length === 0 || agentId !== undefined) return false;
  if (grantRefusal(command) !== undefined) return false;
  const line = normalizeGrant(command.trim());
  return grants.some((grant) => normalizeGrant(grant.trim()) === line);
}

// --- decision ------------------------------------------------------------------------

function firstMatch(command: string, patterns: readonly string[]): string | undefined {
  return patterns.find((pattern) => new RegExp(pattern, "u").test(command));
}

function clip(command: string): string {
  return command.slice(0, 300);
}

export type GateDecision = { verdict: "allow" } | { verdict: "deny" | "hold"; reason: string };

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
 * that is held stays held (decide checks that first).
 */
function decideShell(command: string, policy: RunPolicy, scope: GateScope, agentId?: string): GateDecision {
  const protocol = protocolVerb(command, policy.run);
  if (protocol === "complete" && agentId !== undefined) {
    return deny("only the main session completes the run; return your findings to it");
  }
  if (protocol !== undefined) return ALLOW;
  if (isGranted(command, policy.grants, agentId)) return ALLOW;
  const holdPattern = firstMatch(command, policy.hold);
  if (holdPattern !== undefined) return hold(`the command matches the hold pattern /${holdPattern}/: ${clip(command)}`);
  const refusal = scope === "full" ? mayRefusal(command, policy.may) : undefined;
  if (refusal !== undefined) return deny(`the command is not allowed by the policy's may rules (${refusal}): ${clip(command)}`);
  if (policy.mode !== "report") return ALLOW;
  const verb = firstMatch(command, REPORT_MODE_WRITE_VERBS);
  if (verb === undefined) return ALLOW;
  return hold(`report mode denies write verbs (/${verb}/): ${clip(command)}`);
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
export function decide(call: ToolCall, context: { policy: RunPolicy; isHeld: boolean }): GateDecision {
  const { policy } = context;
  const scope = policy.gate ?? "shell";
  if (scope === "shell" && (call.class !== "shell" || call.command === undefined)) return ALLOW;
  if (context.isHeld) return hold(`run ${policy.run} is held; stop now and wait for an operator`);
  if (call.class === "shell" && call.command !== undefined) return decideShell(call.command, policy, scope, call.agentId);
  return decideTool(call, policy);
}
