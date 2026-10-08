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
 *      or when the frontmatter says `risk: high`. The frontmatter can raise
 *      the risk, never lower it: an agent that writes the spec must not be
 *      able to talk its way past the reviewer. A high-risk spec needs a
 *      `## Rollback` section with text.
 *
 * The item and frontmatter parsers are the vendored legacy ones, loaded at
 * run time (src/legacy is outside this tsconfig), so `spec check` and
 * `verify-item` read a spec the same way.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";

import { UsageError } from "./model.ts";

/** The classes of risk the patterns fall in. */
export type RiskClass = "destructive" | "data" | "external-write" | "auth" | "frontmatter";

export interface RiskPattern {
  /** A stable name, shown in the output: `rm-rf`, `git-push`. */
  readonly id: string;
  readonly class: RiskClass;
  readonly pattern: RegExp;
}

/**
 * Every pattern that makes a spec high risk. One list, in one place, so the
 * docs and the tests can name it. A false alarm costs one reviewer run; a
 * missed pattern costs an unreviewed destructive change. So the words are
 * broad on purpose.
 */
export const RISK_PATTERNS: readonly RiskPattern[] = [
  // Destructive file and history operations.
  { id: "rm-rf", class: "destructive", pattern: /\brm\s+(?:-[a-zA-Z]*(?:rf|fr)[a-zA-Z]*|-r\s+-f|-f\s+-r|--recursive\s+--force|--force\s+--recursive)\b/u },
  { id: "git-push-force", class: "destructive", pattern: /\bgit\s+push\b[^\n]*(?:--force\b|--force-with-lease\b|\s-f\b)/u },
  { id: "git-reset-hard", class: "destructive", pattern: /\bgit\s+reset\s+--hard\b/u },
  // Data operations.
  { id: "sql-drop", class: "data", pattern: /\bDROP\s+(?:TABLE|DATABASE|SCHEMA|INDEX|VIEW|COLUMN)\b/iu },
  { id: "sql-delete", class: "data", pattern: /\bDELETE\s+FROM\b/iu },
  { id: "sql-truncate", class: "data", pattern: /\bTRUNCATE\b|\btruncate\s+table\b/iu },
  { id: "migration", class: "data", pattern: /\bmigrations?\b|\bmigrate\b/iu },
  // Writes outside the repo.
  { id: "curl-write", class: "external-write", pattern: /\bcurl\b[^\n]*(?:-X|--request)\s*['"]?(?:POST|PUT|PATCH|DELETE)\b/iu },
  { id: "deploy", class: "external-write", pattern: /\bdeploy(?:s|ed|ing|ment|ments)?\b/iu },
  { id: "publish", class: "external-write", pattern: /\bpublish(?:es|ed|ing)?\b/iu },
  { id: "git-push", class: "external-write", pattern: /\bgit\s+push\b/u },
  // Auth and secrets.
  { id: "auth", class: "auth", pattern: /\b(?:authentication|authorization|authn|authz|oauth|login|sign[- ]?in|session cookies?)\b/iu },
  { id: "token", class: "auth", pattern: /\b(?:api[-_ ]?keys?|access[-_ ]tokens?|refresh[-_ ]tokens?|bearer tokens?|jwts?)\b/iu },
  { id: "credential", class: "auth", pattern: /\b(?:credentials?|passwords?)\b/iu },
  { id: "secret", class: "auth", pattern: /\bsecrets?\b/iu },
  { id: "permission", class: "auth", pattern: /\b(?:chmod|chown|sudoers|access control|acls?|roles? and permissions)\b/iu },
];

/** One reason a spec is high risk: the pattern and the line it matched. */
export interface RiskReason {
  pattern: string;
  class: RiskClass;
  /** 1-based line in the spec file. */
  line: number;
  text: string;
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

/** Loads the legacy parsers once per call; each is checked before use. */
export async function loadSpecGrammar(): Promise<SpecGrammar> {
  // SAFETY: darius's own vendored modules; each function is checked below before it is used.
  const checklist = (await import(VENDORED_CHECKLIST.href)) as Partial<Pick<SpecGrammar, "parseChecklist">>;
  // SAFETY: as above.
  const runner = (await import(VENDORED_RUNNER.href)) as Partial<Pick<SpecGrammar, "classifyItem">>;
  // SAFETY: as above.
  const frontmatter = (await import(VENDORED_FRONTMATTER.href)) as Partial<Pick<SpecGrammar, "parseFrontmatter">>;
  if (checklist.parseChecklist === undefined || runner.classifyItem === undefined || frontmatter.parseFrontmatter === undefined) {
    throw new Error("the vendored legacy parsers are missing an export spec check needs");
  }
  return { parseChecklist: checklist.parseChecklist, classifyItem: runner.classifyItem, parseFrontmatter: frontmatter.parseFrontmatter };
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

function checkItems(body: string, grammar: SpecGrammar): string[] {
  const items = grammar.parseChecklist(body);
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

/** Every pattern match, one reason per pattern and line. */
export function riskReasonsOf(text: string): RiskReason[] {
  const reasons: RiskReason[] = [];
  const lines = text.split("\n");
  for (const [at, line] of lines.entries()) {
    for (const risk of RISK_PATTERNS) {
      if (risk.pattern.test(line)) reasons.push({ pattern: risk.id, class: risk.class, line: at + 1, text: line.trim() });
    }
  }
  return reasons;
}

/** True when a `## Rollback` section has text that is not a comment. */
export function hasRollback(body: string): boolean {
  const lines = body.split("\n");
  const start = lines.findIndex((line) => /^##\s+Rollback\b/iu.test(line.trim()));
  if (start === -1) return false;
  for (const line of lines.slice(start + 1)) {
    const trimmed = line.trim();
    if (/^#{1,2}\s/u.test(trimmed)) return false;
    if (trimmed === "" || /^<!--.*-->$/u.test(trimmed)) continue;
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

  const riskReasons = riskReasonsOf(text);
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
