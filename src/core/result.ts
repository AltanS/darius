/**
 * Run results (docs/concept.md, "Run results (0.22.0)"). A run's findings
 * stay markdown for people; the model ends them with ONE fenced block whose
 * info string is `darius-result`, holding JSON in the shape below. darius
 * cuts the block out, checks it, and stores it next to the findings, so the
 * web app and the TUI can draw a result, and a question for the operator
 * surfaces instead of hiding in prose (the fact check of 2026-09-30).
 *
 * Every text is untrusted, plain text: no markdown, no HTML, no links. The
 * app renders it as text. darius clips long texts, strips control
 * characters, and ignores unknown keys; a wrong type, a wrong enum value, a
 * missing field or too many entries is an error the model must fix.
 *
 * `status` only ever goes up: any question, any item still open or waiting
 * for a decision at severity high or critical, or any item not verified
 * makes a result `attention`, whatever the model said. `failed` stays.
 *
 * `handoff` (0.26.0) is a note of at most HANDOFF_MAX characters for the
 * next run of the same ritual (src/core/handoff.ts). It is the one text
 * darius does not clip: a cut note can lose its meaning, so a longer one is
 * an error the model must fix.
 */

import type { JsonValue } from "./model.ts";

export const RESULT_FENCE = "darius-result";

export const RESULT_STATUSES = ["ok", "attention", "failed"] as const;
export const SEVERITIES = ["critical", "high", "medium", "low", "info"] as const;
export const ITEM_STATES = ["open", "fixed", "needs-decision", "not-verified"] as const;
export const ACTION_STATES = ["done", "failed", "skipped"] as const;
export const TONES = ["ok", "warn", "bad"] as const;

export type ResultStatus = (typeof RESULT_STATUSES)[number];
export type Severity = (typeof SEVERITIES)[number];
export type ItemState = (typeof ITEM_STATES)[number];
export type ActionState = (typeof ACTION_STATES)[number];
export type MetricTone = (typeof TONES)[number];

export interface ResultMetric {
  label: string;
  value: number | string;
  unit?: string;
  tone?: MetricTone;
}

/** A problem the run found. Clean counts go in `metrics`, not here. */
export interface ResultItem {
  title: string;
  severity: Severity;
  state: ItemState;
  /** What the items group under on the page, for example a market. */
  group?: string;
  /** What the item is about, for example a post: plain text, never a link. */
  target?: string;
  detail?: string;
}

export interface ResultQuestion {
  text: string;
  recommendation?: string;
}

export interface ResultAction {
  text: string;
  state: ActionState;
  target?: string;
}

export interface RunResult {
  v: 1;
  status: ResultStatus;
  summary: string;
  metrics: ResultMetric[];
  items: ResultItem[];
  questions: ResultQuestion[];
  actions: ResultAction[];
  /** The note for the next run of the ritual; absent when the run left none. */
  handoff?: string;
}

/** Open items (every state but `fixed`) per severity. */
export interface SeverityCounts {
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
}

/** What the ledger line carries, so a list needs no blob read. */
export interface ResultSummary {
  status: ResultStatus;
  questions: number;
  open: SeverityCounts;
  fixed: number;
}

/** Texts are clipped to these lengths, in characters. */
const TEXT_LIMITS = {
  summary: 240,
  label: 80,
  unit: 20,
  value: 80,
  title: 200,
  group: 80,
  target: 200,
  detail: 400,
  question: 300,
  recommendation: 200,
  action: 200,
} as const;

/** The longest findings markdown `run complete --outcome complete` takes, in characters, the result block cut out. */
export const FINDINGS_MAX = 4000;

/** The longest handoff note, in characters. */
export const HANDOFF_MAX = 200;

/** More entries than these are an error, not a clip: the page could not show them. */
const COUNT_LIMITS = { metrics: 12, items: 100, questions: 10, actions: 100 } as const;

// --- cut --------------------------------------------------------------------------------

const FENCE_OPEN = /^[ \t]*```[ \t]*darius-result[ \t]*$/u;
const FENCE_CLOSE = /^[ \t]*```[ \t]*$/u;

export type Cut = { findings: string; block: string | null } | { error: string };

/**
 * Cuts the `darius-result` block out of the findings. No block: the findings
 * as they are and `block` null. More than one block, or one that never
 * closes, is an error.
 */
export function cutResult(findings: string): Cut {
  const lines = findings.split("\n");
  const opens = lines.flatMap((line, index) => (FENCE_OPEN.test(line) ? [index] : []));
  if (opens.length === 0) return { findings, block: null };
  if (opens.length > 1) return { error: `the findings have ${String(opens.length)} darius-result blocks; send exactly one, at the end` };
  const start = opens[0] ?? 0;
  const end = lines.findIndex((line, index) => index > start && FENCE_CLOSE.test(line));
  if (end === -1) return { error: "the darius-result block has no closing ``` line" };
  const block = lines.slice(start + 1, end).join("\n");
  const rest = [...lines.slice(0, start), ...lines.slice(end + 1)].join("\n").replace(/\s+$/u, "");
  return { findings: rest === "" ? "" : `${rest}\n`, block };
}

// --- check ------------------------------------------------------------------------------

type JsonRecord = { readonly [key: string]: JsonValue };

function isRecord(value: JsonValue | undefined): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isText(value: JsonValue | undefined): value is string {
  return typeof value === "string";
}

function isFiniteNumber(value: JsonValue | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isControl(code: number): boolean {
  return code < 0x20 || (code >= 0x7f && code < 0xa0);
}

/** Control characters out (a newline stays where texts may have lines, anything else becomes a space), then clipped. */
function clean(text: string, max: number, keepNewlines = false): string {
  let out = "";
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (keepNewlines && char === "\n") out += char;
    else if (isControl(code)) out += " ";
    else out += char;
  }
  const trimmed = out.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

/** The handoff note, one line; longer than HANDOFF_MAX characters is an error, not a clip. */
function handoff(check: Checker, record: JsonRecord): string | undefined {
  const value = record.handoff;
  if (value === undefined || value === null) return undefined;
  if (!isText(value)) {
    check.errors.push("handoff: must be a string when set");
    return undefined;
  }
  const note = clean(value, Number.MAX_SAFE_INTEGER).replaceAll(/\s+/gu, " ");
  const length = [...note].length;
  if (length > HANDOFF_MAX) check.errors.push(`handoff: at most ${String(HANDOFF_MAX)} characters, got ${String(length)}; make it shorter`);
  return note === "" ? undefined : note;
}

function zeroCounts(): SeverityCounts {
  return { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
}

class Checker {
  readonly errors: string[] = [];

  text(record: JsonRecord, key: string, where: string, max: number, keepNewlines = false): string {
    const value = record[key];
    if (!isText(value) || value.trim() === "") {
      this.errors.push(`${where}.${key}: needs a non-empty string`);
      return "";
    }
    return clean(value, max, keepNewlines);
  }

  optionalText(record: JsonRecord, key: string, where: string, max: number, keepNewlines = false): string | undefined {
    const value = record[key];
    if (value === undefined || value === null) return undefined;
    if (!isText(value)) {
      this.errors.push(`${where}.${key}: must be a string when set`);
      return undefined;
    }
    const cleaned = clean(value, max, keepNewlines);
    return cleaned === "" ? undefined : cleaned;
  }

  choice<T extends string>(record: JsonRecord, key: string, where: string, allowed: readonly T[]): T | undefined {
    const value = record[key];
    const found = allowed.find((candidate) => candidate === value);
    if (found === undefined) this.errors.push(`${where}.${key}: must be one of ${allowed.join(", ")}`);
    return found;
  }

  list(record: JsonRecord, key: string, max: number): JsonRecord[] {
    const value = record[key];
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) {
      this.errors.push(`${key}: must be a list`);
      return [];
    }
    if (value.length > max) this.errors.push(`${key}: at most ${String(max)} entries, got ${String(value.length)}`);
    return value.flatMap((entry, index) => {
      if (isRecord(entry)) return [entry];
      this.errors.push(`${key}[${String(index)}]: must be an object`);
      return [];
    });
  }
}

function metric(check: Checker, record: JsonRecord, where: string): ResultMetric {
  const label = check.text(record, "label", where, TEXT_LIMITS.label);
  const raw = record.value;
  let value: number | string = "";
  if (isFiniteNumber(raw)) value = raw;
  else if (isText(raw) && raw.trim() !== "") value = clean(raw, TEXT_LIMITS.value);
  else check.errors.push(`${where}.value: needs a number or a non-empty string`);
  const out: ResultMetric = { label, value };
  const unit = check.optionalText(record, "unit", where, TEXT_LIMITS.unit);
  if (unit !== undefined) out.unit = unit;
  if (record.tone !== undefined && record.tone !== null) {
    const tone = check.choice(record, "tone", where, TONES);
    if (tone !== undefined) out.tone = tone;
  }
  return out;
}

function item(check: Checker, record: JsonRecord, where: string): ResultItem {
  const out: ResultItem = {
    title: check.text(record, "title", where, TEXT_LIMITS.title),
    severity: check.choice(record, "severity", where, SEVERITIES) ?? "info",
    state: check.choice(record, "state", where, ITEM_STATES) ?? "open",
  };
  const group = check.optionalText(record, "group", where, TEXT_LIMITS.group);
  if (group !== undefined) out.group = group;
  const target = check.optionalText(record, "target", where, TEXT_LIMITS.target);
  if (target !== undefined) out.target = target;
  const detail = check.optionalText(record, "detail", where, TEXT_LIMITS.detail, true);
  if (detail !== undefined) out.detail = detail;
  return out;
}

function question(check: Checker, record: JsonRecord, where: string): ResultQuestion {
  const out: ResultQuestion = { text: check.text(record, "text", where, TEXT_LIMITS.question) };
  const recommendation = check.optionalText(record, "recommendation", where, TEXT_LIMITS.recommendation);
  if (recommendation !== undefined) out.recommendation = recommendation;
  return out;
}

function action(check: Checker, record: JsonRecord, where: string): ResultAction {
  const out: ResultAction = {
    text: check.text(record, "text", where, TEXT_LIMITS.action),
    state: check.choice(record, "state", where, ACTION_STATES) ?? "done",
  };
  const target = check.optionalText(record, "target", where, TEXT_LIMITS.target);
  if (target !== undefined) out.target = target;
  return out;
}

const RANK = { ok: 0, attention: 1, failed: 2 } satisfies Record<ResultStatus, number>;

/** `status` raised to what the content says; never lowered. */
function derivedStatus(stated: ResultStatus, result: Omit<RunResult, "status">): ResultStatus {
  const needsLook =
    result.questions.length > 0 ||
    result.items.some(
      (entry) => entry.state === "not-verified" || (entry.state !== "fixed" && (entry.severity === "critical" || entry.severity === "high")),
    );
  const floor: ResultStatus = needsLook ? "attention" : "ok";
  return RANK[floor] > RANK[stated] ? floor : stated;
}

export type Parsed = { result: RunResult } | { errors: string[] };

/** Parses and checks the block's JSON. Every problem is listed, so the model can fix all at once. */
export function parseResult(block: string): Parsed {
  let raw: JsonValue;
  try {
    raw = JSON.parse(block);
  } catch (cause) {
    return { errors: [`the darius-result block is not valid JSON: ${cause instanceof Error ? cause.message : String(cause)}`] };
  }
  if (!isRecord(raw)) return { errors: ["the darius-result block must be one JSON object"] };
  const check = new Checker();
  if (raw.v !== 1) check.errors.push("v: must be 1");
  const stated = check.choice(raw, "status", "result", RESULT_STATUSES) ?? "attention";
  const summary = check.text(raw, "summary", "result", TEXT_LIMITS.summary);
  const body = {
    v: 1 as const,
    summary,
    metrics: check.list(raw, "metrics", COUNT_LIMITS.metrics).map((entry, index) => metric(check, entry, `metrics[${String(index)}]`)),
    items: check.list(raw, "items", COUNT_LIMITS.items).map((entry, index) => item(check, entry, `items[${String(index)}]`)),
    questions: check.list(raw, "questions", COUNT_LIMITS.questions).map((entry, index) => question(check, entry, `questions[${String(index)}]`)),
    actions: check.list(raw, "actions", COUNT_LIMITS.actions).map((entry, index) => action(check, entry, `actions[${String(index)}]`)),
  };
  const note = handoff(check, raw);
  if (check.errors.length > 0) return { errors: check.errors };
  const result: RunResult = { ...body, status: derivedStatus(stated, body) };
  if (note !== undefined) result.handoff = note;
  return { result };
}

/** The counts the ledger line carries. */
export function summarizeResult(result: RunResult): ResultSummary {
  const open = zeroCounts();
  let fixed = 0;
  for (const entry of result.items) {
    if (entry.state === "fixed") fixed += 1;
    else open[entry.severity] += 1;
  }
  return { status: result.status, questions: result.questions.length, open, fixed };
}

/** A summary read back from a ledger line, or null when the value is not one. */
export function readSummary(value: JsonValue | undefined): ResultSummary | null {
  if (!isRecord(value)) return null;
  const status = RESULT_STATUSES.find((candidate) => candidate === value.status);
  const { questions, fixed, open: openRaw } = value;
  if (status === undefined || !isFiniteNumber(questions) || !isFiniteNumber(fixed) || !isRecord(openRaw)) return null;
  const open = zeroCounts();
  for (const severity of SEVERITIES) {
    const count = openRaw[severity];
    if (isFiniteNumber(count)) open[severity] = count;
  }
  return { status, questions, open, fixed };
}

/** The writing rules the run prompt shows the model, before the Result section. */
export const STYLE_PROMPT: readonly string[] = [
  "## Style",
  "",
  "Write short sentences. Give facts, not narrative. Use one line per item. Name the thing, its state, and the next step. No preamble, no recap.",
  "",
  "The findings markdown holds only what the result block cannot: one H1 title, how you checked, the evidence for the items, and the reason behind each question. Do not list the items again. Do not add an actions table or a summary paragraph. At most 4000 characters.",
  "",
];

/** The text the run prompt shows the model: the format, one example, the rules. */
export const RESULT_PROMPT: readonly string[] = [
  "## Result",
  "",
  "End your findings with exactly one fenced block whose info string is `darius-result`, holding one JSON object. darius checks it: `darius run complete` refuses findings without a valid block and prints every error, so you can fix them and run it again. The web page and the TUI draw the block; the markdown above it holds only what the block cannot, at most 4000 characters, and a longer text is refused.",
  "",
  "Fields: `v` is 1. `status` is ok, attention or failed. `summary` is one or two plain sentences, at most 240 characters. `metrics` (up to 12) are counts worth a tile: `label`, `value` (number or short text), optional `unit` and `tone` (ok, warn, bad). `items` (up to 100) are the problems you found: `title`, `severity` (critical, high, medium, low, info), `state` (open, fixed, needs-decision, not-verified), optional `group` (for example the site), `target` (for example the page) and `detail` (at most 400 characters). `questions` (up to 10) are what the operator must decide: `text` (at most 300 characters), optional `recommendation` (at most 200). `actions` (up to 100) are changes you made: `text` (at most 200 characters), `state` (done, failed, skipped), optional `target`. `handoff` (optional, at most 200 characters, one line) is a note for the next run of this ritual: what it must check again, what waits for someone, what not to repeat. darius puts it at the top of that run's prompt. A longer note is refused, not cut. Longer texts in the other fields are cut without a warning, so keep them inside the numbers.",
  "",
  "Plain text only in every field: no markdown, no links. Put every question for the operator in `questions`, not only in the prose: that is how it reaches them. darius raises `status` to attention when there is a question, an open high or critical item, or an item not verified.",
  "",
  "```darius-result",
  '{"v": 1, "status": "attention", "summary": "37 pages checked; 1 critical fixed, 1 question.", "metrics": [{"label": "Pages checked", "value": 37}], "items": [{"title": "Broken link on the pricing page", "severity": "critical", "state": "fixed", "group": "site-a", "target": "page 12"}], "questions": [{"text": "Delete the two old landing pages on site-b now?", "recommendation": "Yes, delete them."}], "actions": [{"text": "Fixed the link in the price table", "state": "done", "target": "site-a page 12"}], "handoff": "Check that site-a page 12 still links to the pricing page. The old landing pages on site-b wait for the operator."}',
  "```",
  "",
];
