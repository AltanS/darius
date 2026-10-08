/**
 * `darius spec check`: a deterministic check of one spec, with no model
 * (0.74.0, docs/concept.md, "Spec check and the review gate").
 *
 * It answers three questions from the spec file alone:
 *
 *   1. Can every checklist item be checked? Each item needs a `Command:` and
 *      an `Expected:` in the verify grammar, or it is manual (the legacy
 *      classifier decides: `Expected: manual (...)` or a shell no-op Command)
 *      AND carries a `- Manual: <reason>` line.
 *   2. Do the `depends_on` targets exist?
 *   3. How risky is it? High when the text matches a pattern of RISK_PATTERNS,
 *      when a Command runs a repo script (`opaque-script`), or when the
 *      frontmatter says `risk: high`. Command lines and fenced blocks get
 *      every pattern; prose gets only the destructive, data and narrow auth
 *      forms; frontmatter and headings are not scanned (0.76.0). The
 *      frontmatter can raise the risk, never lower it: an agent that writes
 *      the spec must not be able to talk its way past the reviewer. A
 *      high-risk spec needs a Rollback section (any heading level from 2)
 *      with real text.
 *
 * Since 0.76.0 a Command that passes whatever happens, a placeholder
 * Command, and an absolute path in a Command are problems too. Checklist
 * items inside a fenced block are not items.
 *
 * The item and frontmatter parsers are the vendored legacy ones, loaded at
 * run time (src/legacy is outside this tsconfig), so `spec check` and
 * `verify-item` read a spec the same way.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";

import { UsageError } from "./model.ts";

/** The classes of risk the patterns fall in. `opaque`: the text runs code the spec does not show. */
export type RiskClass = "destructive" | "data" | "external-write" | "auth" | "opaque" | "frontmatter";

export interface RiskPattern {
  /** A stable name, shown in the output: `rm-rf`, `git-push`. */
  readonly id: string;
  readonly class: RiskClass;
  /** Matched against Command lines and fenced code blocks. */
  readonly pattern: RegExp;
  /**
   * Matched against prose (since 0.76.0). Absent: the pattern is for
   * commands and code only, because in prose its words are everyday words
   * ("deploy the docs", "the login page").
   */
  readonly prose?: RegExp;
}

/** A command word inside one shell stage: `[^\n|;&]*` stops at the next stage. */
const STAGE = String.raw`[^\n|;&]*`;

/** `rm` with a recursive and a force flag, in any order, case and split. */
const RM_RF = new RegExp(String.raw`\brm\b(?=${STAGE}\s-(?:-recursive\b|[a-z]*r))(?=${STAGE}\s-(?:-force\b|[a-z]*f))`, "iu");

/**
 * Every pattern that makes a spec high risk. One list, in one place, so the
 * docs and the tests can name it. A false alarm costs one reviewer run; a
 * missed pattern costs an unreviewed destructive change. So the command
 * patterns are broad on purpose. Prose gets only the patterns that have a
 * `prose` form: destructive and data operations, and a narrow auth list.
 */
export const RISK_PATTERNS: readonly RiskPattern[] = [
  // Destructive file and history operations.
  { id: "rm-rf", class: "destructive", pattern: RM_RF, prose: RM_RF },
  { id: "git-push-force", class: "destructive", pattern: /\bgit\s+push\b[^\n]*(?:--force\b|--force-with-lease\b|\s-f\b)/u, prose: /\bgit\s+push\b[^\n]*(?:--force\b|--force-with-lease\b|\s-f\b)/u },
  { id: "git-reset-hard", class: "destructive", pattern: /\bgit\s+reset\s+--hard\b/u, prose: /\bgit\s+reset\s+--hard\b/u },
  { id: "git-clean", class: "destructive", pattern: /\bgit\s+clean\b[^\n|;&]*\s-(?:-force\b|[a-z]*f)/iu, prose: /\bgit\s+clean\b[^\n|;&]*\s-(?:-force\b|[a-z]*f)/iu },
  { id: "git-branch-delete", class: "destructive", pattern: /\bgit\s+branch\b[^\n|;&]*\s(?:-D\b|-[a-zA-Z]*D\b|--delete\s+--force\b|--force\s+--delete\b|-d\s+-f\b|-f\s+-d\b)/u, prose: /\bgit\s+branch\b[^\n|;&]*\s(?:-D\b|-[a-zA-Z]*D\b|--delete\s+--force\b|--force\s+--delete\b|-d\s+-f\b|-f\s+-d\b)/u },
  { id: "find-delete", class: "destructive", pattern: /\bfind\b[^\n|;&]*\s-delete\b/u, prose: /\bfind\b[^\n|;&]*\s-delete\b/u },
  { id: "rsync-delete", class: "destructive", pattern: /\brsync\b[^\n|;&]*\s--delete/u, prose: /\brsync\b[^\n|;&]*\s--delete/u },
  { id: "dd", class: "destructive", pattern: /\bdd\b[^\n|;&]*\b(?:if|of)=/u, prose: /\bdd\b[^\n|;&]*\b(?:if|of)=/u },
  { id: "kubectl-delete", class: "destructive", pattern: /\bkubectl\s+delete\b/iu, prose: /\bkubectl\s+delete\b/iu },
  { id: "aws-s3-rm", class: "destructive", pattern: /\baws\s+s3\s+(?:rm|rb)\b/iu, prose: /\baws\s+s3\s+(?:rm|rb)\b/iu },
  // Data operations.
  { id: "sql-drop", class: "data", pattern: /\bDROP\s+(?:TABLE|DATABASE|SCHEMA|INDEX|VIEW|COLUMN)\b/iu, prose: /\bDROP\s+(?:TABLE|DATABASE|SCHEMA|INDEX|VIEW|COLUMN)\b/iu },
  { id: "sql-delete", class: "data", pattern: /\bDELETE\s+FROM\b/iu, prose: /\bDELETE\s+FROM\b/iu },
  { id: "sql-truncate", class: "data", pattern: /\bTRUNCATE\b|\btruncate\s+table\b/iu, prose: /\bTRUNCATE\b|\b[Tt]runcate\s+[Tt]able\b/u },
  { id: "migration", class: "data", pattern: /\bmigrations?\b|\bmigrate\b/iu, prose: /\b(?:database|schema|db)\s+migrations?\b|\bmigrate\s+the\s+(?:database|db|schema)\b|\bdb[\s:_-]migrate\b/iu },
  // Writes outside the repo.
  { id: "curl-write", class: "external-write", pattern: /\bcurl\b[^\n]*(?:-X|--request)\s*['"]?(?:POST|PUT|PATCH|DELETE)\b/iu },
  { id: "deploy", class: "external-write", pattern: /\bdeploy(?:s|ed|ing|ment|ments)?\b/iu },
  { id: "publish", class: "external-write", pattern: /\bpublish(?:es|ed|ing)?\b/iu },
  { id: "git-push", class: "external-write", pattern: /\bgit\s+push\b/u },
  { id: "docker-push", class: "external-write", pattern: /\bdocker\s+(?:image\s+)?push\b/iu },
  // Auth and secrets.
  { id: "auth", class: "auth", pattern: /\b(?:authentication|authorization|authn|authz|oauth|login|sign[- ]?in|session cookies?)\b/iu, prose: /\b(?:authentication|authorization|oauth)\b/iu },
  { id: "token", class: "auth", pattern: /\b(?:api[-_ ]?keys?|access[-_ ]tokens?|refresh[-_ ]tokens?|bearer tokens?|jwts?)\b/iu, prose: /\b(?:api[-_ ]?keys?|access[-_ ]tokens?|refresh[-_ ]tokens?)\b/iu },
  { id: "credential", class: "auth", pattern: /\b(?:credentials?|passwords?)\b/iu, prose: /\bcredentials?\b/iu },
  { id: "secret", class: "auth", pattern: /\bsecrets?\b/iu, prose: /\b(?:the|a|an|our|its|their|this|that|your|my|these|those)\s+secret\b|\bsecrets\b/iu },
  { id: "permission", class: "auth", pattern: /\b(?:chmod|chown|sudoers|access control|acls?|roles? and permissions)\b/iu },
  { id: "sudo", class: "auth", pattern: /\bsudo\b/u },
  // Code the spec does not show.
  { id: "pipe-shell", class: "opaque", pattern: /\|\s*(?:sudo\s+)?(?:ba|z|da|k)?sh\b/u },
  { id: "base64-decode", class: "opaque", pattern: /\bbase64\b[^\n|;&]*\s(?:-d|-D|--decode)\b/u },
  { id: "eval", class: "opaque", pattern: /(?:^|[\s;&|(`$])eval\s/u },
];

/** One reason a spec is high risk: the pattern and the line it matched. */
export interface RiskReason {
  pattern: string;
  class: RiskClass;
  /** 1-based line in the spec file. */
  line: number;
  text: string;
  /** Added field (0.76.0): the script an `opaque-script` reason names. */
  script?: string;
}

/** `review_gate:` in `.tracker/config.yml`. */
export type ReviewGate = "auto" | "off";

/** The gate a config asks for, and a warning when its value was not understood. */
export interface ReviewGateSetting {
  gate: ReviewGate;
  warning?: string;
}

export interface SpecCheckResult {
  ok: boolean;
  risk: "low" | "high";
  riskReasons: RiskReason[];
  problems: string[];
  /** Added fields (not in the minimal contract): what the planner needs next. */
  reviewGate: ReviewGate;
  /** True when the risk is high and the review gate is `auto`. */
  reviewRequired: boolean;
  /** The spec's `counsel:` stamp, or null. */
  counsel: string | null;
}

/** The parts of the vendored legacy CLI that spec check reuses. */
export interface SpecGrammar {
  parseChecklist(body: string): readonly LegacyItem[];
  classifyItem(item: { index: number; label: string; command: string | null; expected: string | null }): { kind: string; reason?: string };
  parseFrontmatter(raw: string): { data: LegacyFrontmatter; content: string };
  /** The verify classifier's helpers (0.76.0), so spec check and verify-item read a Command the same way. */
  splitShellStages(command: string): string[];
  constantPassReason(command: string): string | null;
  isPlaceholderCommand(command: string): boolean;
  absolutePathsIn(command: string): string[];
}

/** A checklist item as the legacy parser returns it (the fields read here). */
export interface LegacyItem {
  index: number;
  state: string;
  label: string;
  command: string | null;
  expected: string | null;
}

/** Legacy frontmatter values: scalars, lists of scalars, or absent. */
export interface LegacyFrontmatter {
  readonly [key: string]: string | number | boolean | readonly string[] | undefined;
}

const VENDORED_CHECKLIST = new URL("../legacy/lib/markdown/checklist.ts", import.meta.url);
const VENDORED_RUNNER = new URL("../legacy/lib/verification/runner.ts", import.meta.url);
const VENDORED_FRONTMATTER = new URL("../legacy/lib/markdown/frontmatter.ts", import.meta.url);

/** The runner exports spec check needs. */
type RunnerExports = Pick<SpecGrammar, "classifyItem" | "splitShellStages" | "constantPassReason" | "isPlaceholderCommand" | "absolutePathsIn">;

/** Loads the legacy parsers once per call; each is checked before use. */
export async function loadSpecGrammar(): Promise<SpecGrammar> {
  // SAFETY: darius's own vendored modules; each function is checked below before it is used.
  const checklist = (await import(VENDORED_CHECKLIST.href)) as Partial<Pick<SpecGrammar, "parseChecklist">>;
  // SAFETY: as above.
  const runner = (await import(VENDORED_RUNNER.href)) as Partial<RunnerExports>;
  // SAFETY: as above.
  const frontmatter = (await import(VENDORED_FRONTMATTER.href)) as Partial<Pick<SpecGrammar, "parseFrontmatter">>;
  const { classifyItem, splitShellStages, constantPassReason, isPlaceholderCommand, absolutePathsIn } = runner;
  if (
    checklist.parseChecklist === undefined ||
    classifyItem === undefined ||
    splitShellStages === undefined ||
    constantPassReason === undefined ||
    isPlaceholderCommand === undefined ||
    absolutePathsIn === undefined ||
    frontmatter.parseFrontmatter === undefined
  ) {
    throw new Error("the vendored legacy parsers are missing an export spec check needs");
  }
  return {
    parseChecklist: checklist.parseChecklist,
    classifyItem,
    parseFrontmatter: frontmatter.parseFrontmatter,
    splitShellStages,
    constantPassReason,
    isPlaceholderCommand,
    absolutePathsIn,
  };
}

/**
 * The review gate a config file asks for. `review_gate: auto|off` wins. The
 * old `counsel_gate:` key maps to `auto` whatever its value: `on` meant
 * "review", and `off` (the old default) meant "no advisors", but the spec
 * check is cheap and the reviewer now runs only for high risk.
 * An unknown `review_gate:` value is `auto` too, with a warning.
 */
export function parseReviewGate(configText: string | null): ReviewGateSetting {
  if (configText === null) return { gate: "auto" };
  const match = /^\s*review_gate\s*:\s*["']?([A-Za-z]+)["']?\s*$/mu.exec(configText);
  if (match === null) return { gate: "auto" };
  const value = (match[1] ?? "").toLowerCase();
  if (value === "off") return { gate: "off" };
  if (value === "auto") return { gate: "auto" };
  return { gate: "auto", warning: `review_gate: ${value} is not auto or off; using auto` };
}

/** The `.tracker` directory a spec belongs to: the `.tracker` segment of its path, else the nearest one above it. */
export function trackerRootOf(specPath: string, cwd: string): string | null {
  const absolute = resolve(cwd, specPath);
  const parts = absolute.split(sep);
  const at = parts.lastIndexOf(".tracker");
  if (at > 0) return parts.slice(0, at + 1).join(sep);
  return findTrackerAbove(dirname(absolute)) ?? findTrackerAbove(cwd);
}

function findTrackerAbove(start: string): string | null {
  let dir = resolve(start);
  for (let depth = 0; depth < 50; depth += 1) {
    const candidate = join(dir, ".tracker");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

/** True when `dep` names an existing spec, in any of the forms the legacy reader accepts. */
export function dependencyExists(dep: string, specPath: string, trackerRoot: string | null): boolean {
  const normalized = dep.replace(/^\.\//u, "");
  const candidates = [resolve(dirname(specPath), normalized)];
  if (trackerRoot !== null) candidates.push(resolve(trackerRoot, normalized), resolve(dirname(trackerRoot), normalized));
  if (candidates.some((candidate) => existsSync(candidate))) return true;
  if (trackerRoot === null || !existsSync(trackerRoot)) return false;
  // The legacy reader also matches a bare file name in any milestone.
  const name = basename(normalized);
  return readdirSync(trackerRoot, { withFileTypes: true }).some((entry) => entry.isDirectory() && existsSync(join(trackerRoot, entry.name, name)));
}

const ITEM_RE = /^\s*- \[[ xX~!-]\] /u;
const MANUAL_RE = /^\s*- Manual:\s*(.*)$/u;

/**
 * The `- Manual: <reason>` text under each checklist item, by item index.
 * Items are counted with the legacy item pattern, and a heading or `---`
 * ends an item, as in the legacy parser, so the indexes line up.
 */
function manualReasons(body: string): Map<number, string> {
  const reasons = new Map<number, string>();
  let index = -1;
  let open = false;
  for (const line of body.split("\n")) {
    if (ITEM_RE.test(line)) {
      index += 1;
      open = true;
      continue;
    }
    if (!open) continue;
    if (line.startsWith("#") || line.startsWith("---")) {
      open = false;
      continue;
    }
    const match = MANUAL_RE.exec(line);
    if (match !== null) reasons.set(index, (match[1] ?? "").trim());
  }
  return reasons;
}

function itemName(item: LegacyItem): string {
  const label = item.label.trim();
  return `item ${item.index} (${label === "" ? "unlabelled" : JSON.stringify(label.length > 60 ? `${label.slice(0, 57)}...` : label)})`;
}

/** The legacy item pattern (src/legacy/lib/markdown/checklist.ts), to find each item's line. */
const LEGACY_ITEM_RE = /^(\s*)- \[([ xX~!-])\] (.*)$/u;

/**
 * The indexes of the legacy items that sit inside a fenced code block. The
 * legacy parser does not know fences, so it counts them; spec check keeps
 * its index numbers (they match verify-item) and skips those items.
 */
function fencedItemIndexes(body: string): Set<number> {
  const lines = body.split("\n");
  const fenced = fencedLines(lines);
  const indexes = new Set<number>();
  let index = -1;
  for (const [at, line] of lines.entries()) {
    if (!LEGACY_ITEM_RE.test(line)) continue;
    index += 1;
    if (fenced.has(at)) indexes.add(index);
  }
  return indexes;
}

/** Problems with one Command beyond the verify grammar: constant pass, placeholder, absolute paths. */
function commandProblems(name: string, item: LegacyItem, grammar: SpecGrammar): string[] {
  const command = item.command ?? "";
  if (grammar.isPlaceholderCommand(command)) return [`${name}: the Command is a placeholder, not a check`];
  const problems: string[] = [];
  const manualExpected = /^\s*manual\b/iu.test(item.expected ?? "");
  const constant = manualExpected ? null : grammar.constantPassReason(command);
  if (constant !== null) problems.push(`${name}: the Command passes whatever the system looks like (${constant})`);
  const absolute = grammar.absolutePathsIn(command);
  if (absolute.length > 0) problems.push(`${name}: the Command names an absolute path (${absolute.join(", ")}); use a path relative to the repo root`);
  return problems;
}

function checkItems(body: string, grammar: SpecGrammar): string[] {
  const fencedItems = fencedItemIndexes(body);
  const items = grammar.parseChecklist(body).filter((item) => !fencedItems.has(item.index));
  if (items.length === 0) return ["the spec has no checklist items"];
  const reasons = manualReasons(body);
  const problems: string[] = [];
  for (const item of items) {
    if (item.state === "skipped") continue;
    const name = itemName(item);
    if (item.command === null) {
      problems.push(`${name}: no Command: line`);
      continue;
    }
    if (item.expected === null) {
      problems.push(`${name}: no Expected: line`);
      continue;
    }
    const extra = commandProblems(name, item, grammar);
    if (extra.length > 0) {
      problems.push(...extra);
      continue;
    }
    const classified = grammar.classifyItem({ index: item.index, label: item.label, command: item.command, expected: item.expected });
    if (classified.kind === "grammar-error") {
      problems.push(`${name}: ${classified.reason ?? "grammar error"}`);
      continue;
    }
    if (classified.kind === "manual" && (reasons.get(item.index) ?? "") === "") {
      problems.push(`${name}: a manual check needs a "- Manual: <reason>" line that says why it cannot be a command`);
    }
  }
  return problems;
}

function lineOf(text: string, key: RegExp): number {
  const lines = text.split("\n");
  const at = lines.findIndex((line) => key.test(line));
  return at === -1 ? 1 : at + 1;
}

/** Where a line of a spec sits, for the risk scan. */
type LineKind = "frontmatter" | "heading" | "fence" | "command" | "prose";

/** A logical line: backslash-continued lines joined, with the 1-based number of its first line. */
interface LogicalLine {
  line: number;
  kind: LineKind;
  text: string;
}

const FENCE_RE = /^\s*(`{3,}|~{3,})/u;
const COMMAND_LINE_RE = /^\s*- Command:\s*(.*)$/u;
const HEADING_RE = /^\s{0,3}(#{1,6})\s/u;

/** The 0-based line indexes of a leading `---` frontmatter block, both fences included. */
function frontmatterLines(lines: readonly string[]): Set<number> {
  const inside = new Set<number>();
  if ((lines[0] ?? "").trim() !== "---") return inside;
  for (let at = 1; at < lines.length; at += 1) {
    if ((lines[at] ?? "").trim() === "---") {
      for (let i = 0; i <= at; i += 1) inside.add(i);
      return inside;
    }
  }
  return inside;
}

/** The 0-based line indexes inside fenced code blocks, the fence lines included. */
export function fencedLines(lines: readonly string[]): Set<number> {
  const inside = new Set<number>();
  let open: string | null = null;
  for (const [at, line] of lines.entries()) {
    const fence = FENCE_RE.exec(line);
    if (open === null) {
      if (fence === null) continue;
      open = (fence[1] ?? "").slice(0, 3);
      inside.add(at);
      continue;
    }
    inside.add(at);
    if (fence !== null && (fence[1] ?? "").startsWith(open) && line.trim().replace(/^[`~]+/u, "") === "") open = null;
  }
  return inside;
}

/** Splits a spec into logical lines and says what each one is. */
function logicalLines(text: string): LogicalLine[] {
  const lines = text.split("\n");
  const front = frontmatterLines(lines);
  const fenced = fencedLines(lines);
  const out: LogicalLine[] = [];
  for (let at = 0; at < lines.length; at += 1) {
    const first = at;
    let joined = lines[at] ?? "";
    // Join backslash-continued lines, so `rm \<newline> -rf x` reads as one command.
    while (/\\\s*$/u.test(joined) && at + 1 < lines.length && !front.has(at + 1)) {
      at += 1;
      joined = `${joined.replace(/\\\s*$/u, "")} ${(lines[at] ?? "").trim()}`;
    }
    let kind: LineKind = "prose";
    if (front.has(first)) kind = "frontmatter";
    else if (fenced.has(first)) kind = "fence";
    else if (COMMAND_LINE_RE.test(joined)) kind = "command";
    else if (HEADING_RE.test(joined)) kind = "heading";
    out.push({ line: first + 1, kind, text: joined });
  }
  return out;
}

/** Test runners that are not opaque: their meaning does not hide in a repo script. */
const TEST_RUNNER_RE = /^(?:(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test|make\s+test|node\s+--test|pytest|python3?\s+-m\s+pytest|go\s+test|cargo\s+test)(?:\s|$)/u;

/** Interpreters that run a script file given as their first non-flag word. */
const INTERPRETERS = new Set(["bash", "sh", "zsh", "dash", "ksh", "node", "bun", "deno", "python", "python3", "ruby", "perl", "tsx", "ts-node"]);

/** Flags after which an interpreter runs inline code, not a file. */
const INLINE_FLAGS = new Set(["-c", "-e", "--eval", "-p", "--print", "-m", "x"]);

/** One stage of a Command, with leading `VAR=value` words dropped. */
function stageWords(stage: string): string[] {
  const words = stage.trim().split(/\s+/u).filter((word) => word !== "");
  while (words.length > 0 && /^[A-Za-z_][A-Za-z0-9_]*=/u.test(words[0] ?? "")) words.shift();
  return words;
}

/** The repo script one stage runs, or null. */
function opaqueScriptOf(stage: string): string | null {
  const words = stageWords(stage);
  const head = words[0];
  if (head === undefined) return null;
  if (TEST_RUNNER_RE.test(words.join(" "))) return null;
  if (head.startsWith("./") || head.startsWith("../") || (head.includes("/") && !head.startsWith("/") && !head.startsWith("$"))) return head;
  if (head === "make") return `make ${words.slice(1).find((word) => !word.startsWith("-")) ?? "(default target)"}`;
  if (head === "npm" || head === "bun" || head === "yarn") {
    if (words[1] === "run" || words[1] === "run-script") return words[2] === undefined ? null : `${head} run ${words[2]}`;
    if (head === "yarn" && words[1] !== undefined && !words[1].startsWith("-")) return `yarn ${words[1]}`;
  }
  if (head === "pnpm") {
    const target = words[1] === "run" ? words[2] : words[1];
    const builtins = new Set(["install", "i", "add", "remove", "exec", "dlx", "x", "why", "list", "ls", "outdated"]);
    if (target !== undefined && !target.startsWith("-") && !builtins.has(target)) return `pnpm ${target}`;
  }
  if (INTERPRETERS.has(head)) {
    for (const word of words.slice(1)) {
      if (INLINE_FLAGS.has(word)) return null;
      if (word.startsWith("-")) continue;
      return /^["'$]/u.test(word) ? null : word;
    }
  }
  return null;
}

/** The repo scripts a Command runs, in order. */
export function opaqueScriptsIn(command: string, splitStages: (command: string) => readonly string[]): string[] {
  const scripts: string[] = [];
  for (const stage of splitStages(command)) {
    const words = stageWords(stage);
    if (words[0] === "cd") continue;
    const script = opaqueScriptOf(stage);
    if (script !== null) scripts.push(script);
  }
  return scripts;
}

/** The value of a `- Command:` line, without its backticks. */
function commandValue(line: string): string {
  const raw = (COMMAND_LINE_RE.exec(line)?.[1] ?? "").trim();
  const ticked = /^(`+)(.*?)\1$/u.exec(raw);
  return (ticked?.[2] ?? raw).trim();
}

/** A shell stage splitter for the opaque-script scan; the legacy one when the grammar is at hand. */
type StageSplitter = (command: string) => readonly string[];

const SIMPLE_SPLIT: StageSplitter = (command) => command.split(/\|\||&&|[|;\n]/u);

/**
 * Every pattern match, one reason per pattern and line (0.76.0 scopes):
 * Command lines and fenced code blocks get every pattern, and Command lines
 * also name each repo script they run (`opaque-script`). Prose gets only the
 * patterns with a `prose` form. Frontmatter and headings are not scanned.
 */
export function riskReasonsOf(text: string, splitStages: StageSplitter = SIMPLE_SPLIT): RiskReason[] {
  const reasons: RiskReason[] = [];
  for (const logical of logicalLines(text)) {
    if (logical.kind === "frontmatter" || logical.kind === "heading") continue;
    const code = logical.kind !== "prose";
    for (const risk of RISK_PATTERNS) {
      const pattern = code ? risk.pattern : risk.prose;
      if (pattern !== undefined && pattern.test(logical.text)) {
        reasons.push({ pattern: risk.id, class: risk.class, line: logical.line, text: logical.text.trim() });
      }
    }
    if (logical.kind !== "command") continue;
    for (const script of opaqueScriptsIn(commandValue(logical.text), splitStages)) {
      reasons.push({ pattern: "opaque-script", class: "opaque", line: logical.line, text: `runs ${script}`, script });
    }
  }
  return reasons;
}

/** Text in a Rollback section that says nothing. */
const ROLLBACK_PLACEHOLDER_RE = /^(?:tbd|todo|fixme|n\/a|na|none|-|\.+|…)?$/iu;

/**
 * True when a Rollback heading (level 2 or deeper, outside a fence) has a
 * line of real text before the next heading of the same or a higher level.
 * Blank lines, HTML comments (multi-line ones too), fenced blocks and
 * placeholders (TBD, TODO, `.`, `-`, n/a, none) do not count.
 */
export function hasRollback(body: string): boolean {
  const lines = body.split("\n");
  const fenced = fencedLines(lines);
  const start = lines.findIndex((line, at) => !fenced.has(at) && /^\s{0,3}#{2,6}\s+Rollback\b/iu.test(line));
  if (start === -1) return false;
  const level = (/^\s{0,3}(#+)/u.exec(lines[start] ?? "")?.[1] ?? "##").length;
  let inComment = false;
  for (let at = start + 1; at < lines.length; at += 1) {
    if (fenced.has(at)) continue;
    let line = lines[at] ?? "";
    const heading = HEADING_RE.exec(line);
    if (heading !== null && !inComment) {
      if ((heading[1] ?? "").length <= level) return false;
      continue;
    }
    // Drop HTML comments, including ones that span lines.
    let visible = "";
    while (line !== "") {
      if (inComment) {
        const close = line.indexOf("-->");
        if (close === -1) {
          line = "";
          break;
        }
        line = line.slice(close + 3);
        inComment = false;
        continue;
      }
      const open = line.indexOf("<!--");
      if (open === -1) {
        visible += line;
        break;
      }
      visible += line.slice(0, open);
      line = line.slice(open + 4);
      inComment = true;
    }
    const words = visible.trim().replace(/^(?:[-*+]|\d+[.)])\s+/u, "").trim().replace(/[.:]+$/u, "");
    if (ROLLBACK_PLACEHOLDER_RE.test(words)) continue;
    if (/^(?:tbd|todo|fixme)\b/iu.test(words)) continue;
    return true;
  }
  return false;
}

function scalar(value: string | number | boolean | readonly string[] | undefined): string | null {
  if (value === undefined || Array.isArray(value)) return null;
  return String(value);
}

/**
 * Checks one spec's text. Pure apart from `depends_on`, which looks at the
 * file system next to `specPath`.
 */
export function checkSpecText(text: string, specPath: string, trackerRoot: string | null, grammar: SpecGrammar, gate: ReviewGate): SpecCheckResult {
  const problems: string[] = [];
  let data: LegacyFrontmatter = {};
  let body = text;
  try {
    const parsed = grammar.parseFrontmatter(text);
    data = parsed.data;
    body = parsed.content;
  } catch (cause) {
    problems.push(`frontmatter: ${cause instanceof Error ? cause.message : String(cause)}`);
  }

  problems.push(...checkItems(body, grammar));

  const deps = data["depends_on"];
  const depList: readonly string[] = Array.isArray(deps) ? deps : [];
  for (const dep of depList) {
    if (!dependencyExists(dep, specPath, trackerRoot)) problems.push(`depends_on: ${dep} does not exist`);
  }

  const riskReasons = riskReasonsOf(text, grammar.splitShellStages);
  const declared = scalar(data["risk"]);
  if (declared !== null) {
    const value = declared.toLowerCase();
    if (value === "high") riskReasons.push({ pattern: "frontmatter", class: "frontmatter", line: lineOf(text, /^\s*risk\s*:/u), text: "risk: high" });
    else if (value !== "low") problems.push(`risk: ${declared} is not low or high`);
  }
  const risk = riskReasons.length > 0 ? "high" : "low";
  if (risk === "high" && !hasRollback(body)) problems.push("the spec is high risk and has no ## Rollback section with text");

  return {
    ok: problems.length === 0,
    risk,
    riskReasons,
    problems,
    reviewGate: gate,
    reviewRequired: risk === "high" && gate === "auto",
    counsel: scalar(data["counsel"]),
  };
}

/** Reads and checks a spec file. Throws a UsageError (exit 2) when the file does not exist. */
export async function checkSpecFile(specPath: string, cwd: string): Promise<{ result: SpecCheckResult; warning?: string }> {
  const absolute = resolve(cwd, specPath);
  if (!existsSync(absolute)) throw new UsageError(`spec check: no spec at ${specPath}`);
  const trackerRoot = trackerRootOf(absolute, cwd);
  const configPath = trackerRoot === null ? null : join(trackerRoot, "config.yml");
  const configText = configPath !== null && existsSync(configPath) ? readFileSync(configPath, "utf8") : null;
  const { gate, warning } = parseReviewGate(configText);
  const grammar = await loadSpecGrammar();
  const result = checkSpecText(readFileSync(absolute, "utf8"), absolute, trackerRoot, grammar, gate);
  return warning === undefined ? { result } : { result, warning };
}
