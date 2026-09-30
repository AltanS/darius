/**
 * `darius import`: mirror a legacy tracker directory (`<repo>/.tracker/`)
 * into a darius project. Rituals, their runs, and the verification ledger.
 * The mapping is docs/plan-tonight.md, "Import (read-only)":
 *
 *   rituals/<slug>/ritual.md       item `rituals/<slug>.md`: name -> title,
 *                                  cadence, agent, owner, started -> created,
 *                                  `anchor: due`, `policy.mode: off`,
 *                                  `imported_from`. Body kept byte for byte,
 *                                  minus its `## Findings` section, which is
 *                                  stored as a blob (see KEEP_WHOLE_BODY).
 *   runs/<date>[suffix].md         run.started + run.completed{outcome:
 *                                  "complete", findings_sha}; the whole run
 *                                  file is the findings blob.
 *   runs/_ledger.md rows           the same, for runs pruned by retention;
 *                                  the row text is the findings blob. A `- `
 *                                  row that does not parse is reported. A
 *                                  row whose run file `<date>.md` is in the
 *                                  source, or was imported before, is that
 *                                  run and is skipped.
 *   last_run                       a synthetic run on that date, only when no
 *                                  run file or ledger row already covers it.
 *   due != last_run + cadence      ritual.rescheduled{due}
 *   status: retired | paused       ritual.lifecycle{state, reason?}
 *   .verification-log.jsonl        one `evidence` line per source line,
 *                                  check "<spec>#<index>", `at` kept.
 *   vigils/, milestones, specs     not imported (phase 3 and later).
 *
 * READ-ONLY ON THE SOURCE. This module opens source files with readFileSync,
 * readdirSync and statSync only. Every write goes to the darius store through
 * src/core/store.ts and src/core/ledger.ts.
 *
 * IDEMPOTENT. Every imported line carries `imported_from`: the source path
 * relative to the tracker's parent directory, plus a `#fragment` naming the
 * fact inside that file when the file holds more than one (a ledger row's
 * date, `due=<date>`, `status=<state>`, an evidence line's sha256). A line is
 * skipped when a `who: "import"` line of the same type already carries the
 * same `imported_from`. The ritual item is rewritten only when its text would
 * change, keeping its id, created date, anchor, policy and tags, which darius
 * owns and the source does not have. One `import{source,count}` line is
 * appended by a run that wrote anything; a run that wrote nothing appends
 * nothing.
 *
 * DATES. A source date has no time. Its line is written at LOCAL noon of that
 * date (docs/plan-tonight.md, "Coordinator notes"), so its local date never
 * shifts west or east of UTC. The k-th run on one date starts at noon + k
 * minutes and completes one second later, so run lines never share a
 * millisecond and sort started-before-completed. A reschedule or lifecycle
 * line is written after the ritual's last imported completion, so the due
 * computation sees it as pending.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

import { rollCadence } from "./due.ts";
import { appendLines, readLedger } from "./ledger.ts";
import type { LedgerLineInput } from "./ledger.ts";
import { UsageError } from "./model.ts";
import type { Document, JsonValue, LedgerLine, Ritual } from "./model.ts";
import { projectDir } from "./paths.ts";
import { decodeItem, encodeItem, openProject, putBlob, readItemText, sha256Hex, writeItemText } from "./store.ts";
import type { Project } from "./store.ts";
import { ulid } from "./ulid.ts";

/** The `who` of every line an import writes. */
export const IMPORT_WHO = "import";

/**
 * Ritual bodies imported whole, `## Findings` included. The plan keeps the
 * 143 KB `fact-check-cycle` body whole tonight; splitting its 80 KB
 * of findings into runs and notes is deferred (docs/plan-tonight.md, "Import
 * (read-only)" and "Deferred past tonight").
 */
const KEEP_WHOLE_BODY: ReadonlySet<string> = new Set(["fact-check-cycle"]);

const EVIDENCE_FILE = ".verification-log.jsonl";
const RUN_LEDGER_FILE = "_ledger.md";
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/u;
const RUN_FILE = /^(\d{4}-\d{2}-\d{2})(.*)\.md$/u;
const LEDGER_ROW = /^- (\d{4}-\d{2}-\d{2}): (.*)$/u;
const SOURCE_FIELD = /^([A-Za-z_][\w-]*):(?:[ \t]+(.*))?$/u;
const FINDINGS_HEADING = /^## Findings[ \t]*$/u;
const SECTION_HEADING = /^## /u;
const TITLE_HEADING = /^#\s+(.+)$/u;
const LIFECYCLE_STATES: ReadonlySet<string> = new Set(["retired", "paused"]);

const NOON_HOUR = 12;
const SECOND_MS = 1000;
const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
/** After-the-last-run offsets for the two non-run fact types, well past any noon + k minutes run. */
const RESCHEDULE_OFFSET_MS = 4 * HOUR_MS;
const LIFECYCLE_OFFSET_MS = 5 * HOUR_MS;

// --- source model -------------------------------------------------------------

interface SourceRun {
  /** `imported_from` of the run lines. */
  readonly key: string;
  readonly date: string;
  /** The findings blob: a run file's whole text, or a ledger row's text. */
  readonly findings: string;
  /**
   * A pruned row only: the key its run file had before the tracker pruned it
   * into `_ledger.md`. The row is the same run as that file.
   */
  readonly fileKey?: string;
}

interface SourceRitual {
  readonly slug: string;
  /** `imported_from` of the item, e.g. `.tracker/rituals/<slug>/ritual.md`. */
  readonly file: string;
  readonly fields: ReadonlyMap<string, string>;
  readonly body: string;
  readonly runs: readonly SourceRun[];
}

interface SourceEvidence {
  readonly key: string;
  readonly line: LedgerLineInput;
}

/** Everything read from a tracker directory, before any comparison with the store. */
export interface TrackerSource {
  /** The tracker directory, absolute. */
  readonly root: string;
  readonly rituals: readonly SourceRitual[];
  readonly evidence: readonly SourceEvidence[];
  /** Source content that was skipped, one line each, naming file and line. */
  readonly problems: readonly string[];
}

// --- the report -----------------------------------------------------------------

export interface ImportCounts {
  readonly found: number;
  readonly new: number;
}

export interface ImportReport {
  readonly project: string;
  readonly source: string;
  readonly dryRun: boolean;
  readonly rituals: ImportCounts & { readonly updated: number; readonly unchanged: number };
  readonly runs: ImportCounts;
  readonly lifecycle: ImportCounts;
  readonly rescheduled: ImportCounts;
  readonly evidence: ImportCounts;
  /** Items written plus ledger facts appended, the `count` of the import line. 0 on a repeat run. */
  readonly totalNew: number;
  readonly problems: readonly string[];
}

export interface ImportOptions {
  /** Path to the tracker directory, usually `<repo>/.tracker`. */
  readonly source: string;
  readonly project: string;
  readonly dryRun: boolean;
}

// --- small helpers --------------------------------------------------------------

function isDirectory(path: string): boolean {
  return statSync(path, { throwIfNoEntry: false })?.isDirectory() === true;
}

function isJsonObject(value: JsonValue | undefined): value is { readonly [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonString(value: JsonValue | undefined): value is string {
  return typeof value === "string";
}

function isJsonNumber(value: JsonValue | undefined): value is number {
  return typeof value === "number";
}

/** A path as `imported_from` spells it: relative to the tracker's parent, `/`-separated. */
function sourceRef(base: string, path: string): string {
  return relative(base, path).split(sep).join("/");
}

function isCalendarDate(date: string): boolean {
  const match = ISO_DATE.exec(date);
  if (match === null) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const check = new Date(Date.UTC(year, month - 1, day));
  return check.getUTCMonth() === month - 1 && check.getUTCDate() === day;
}

/** Milliseconds of local noon on `date` (YYYY-MM-DD, already validated). */
function localNoonMs(date: string): number {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year ?? 0, (month ?? 1) - 1, day ?? 1, NOON_HOUR).getTime();
}

function padTwo(value: number): string {
  return String(value).padStart(2, "0");
}

function localDateOf(ms: number): string {
  const date = new Date(ms);
  return `${date.getFullYear()}-${padTwo(date.getMonth() + 1)}-${padTwo(date.getDate())}`;
}

function isoAt(ms: number): string {
  return new Date(ms).toISOString();
}

// --- reading the source ---------------------------------------------------------

interface SplitSource {
  readonly fields: Map<string, string>;
  readonly body: string;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  const quote = trimmed[0];
  if (trimmed.length >= 2 && (quote === '"' || quote === "'") && trimmed.at(-1) === quote) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/**
 * Splits a legacy file into its flat `key: value` frontmatter and its body,
 * the text after the closing fence's newline (the same split darius's own
 * parser makes, so the body round-trips byte for byte). Lines that are not
 * `key: value` (lists, comments) are ignored: every field this import maps
 * is a scalar.
 */
function splitSourceFile(text: string): SplitSource {
  const fields = new Map<string, string>();
  const lines = text.split("\n");
  if (lines[0] !== "---") return { fields, body: text };
  const closing = lines.findIndex((line, index) => index > 0 && line === "---");
  if (closing === -1) return { fields, body: text };
  for (const line of lines.slice(1, closing)) {
    const match = SOURCE_FIELD.exec(line);
    if (match?.[1] === undefined) continue;
    fields.set(match[1], unquote(match[2] ?? ""));
  }
  return { fields, body: lines.slice(closing + 1).join("\n") };
}

/** Appends `~n` to the n-th repeat of `key` (n >= 2), so identical facts stay distinct. */
function occurrenceKey(key: string, seen: Map<string, number>): string {
  const count = (seen.get(key) ?? 0) + 1;
  seen.set(key, count);
  return count === 1 ? key : `${key}~${count}`;
}

interface RunDirContext {
  readonly runsDir: string;
  readonly base: string;
  readonly problems: string[];
}

function readLedgerRows(path: string, context: RunDirContext): SourceRun[] {
  const ref = sourceRef(context.base, path);
  const runs: SourceRun[] = [];
  const seen = new Map<string, number>();
  for (const [index, line] of readFileSync(path, "utf8").split("\n").entries()) {
    if (!line.startsWith("- ")) continue;
    const match = LEDGER_ROW.exec(line);
    const date = match?.[1];
    if (date === undefined || !isCalendarDate(date)) {
      context.problems.push(`${ref}:${index + 1}: pruned-run row not parsed ("- YYYY-MM-DD: text"), skipped`);
      continue;
    }
    const fileKey = sourceRef(context.base, join(context.runsDir, `${date}.md`));
    runs.push({ key: occurrenceKey(`${ref}#${date}`, seen), date, findings: `${line}\n`, fileKey });
  }
  return runs;
}

function readRunDir(context: RunDirContext): SourceRun[] {
  if (!isDirectory(context.runsDir)) return [];
  const runs: SourceRun[] = [];
  for (const name of readdirSync(context.runsDir).toSorted()) {
    const path = join(context.runsDir, name);
    if (name === RUN_LEDGER_FILE) {
      runs.push(...readLedgerRows(path, context));
      continue;
    }
    const date = RUN_FILE.exec(name)?.[1];
    if (date === undefined || !isCalendarDate(date)) {
      context.problems.push(`${sourceRef(context.base, path)}: not a run file (<YYYY-MM-DD>[suffix].md), skipped`);
      continue;
    }
    runs.push({ key: sourceRef(context.base, path), date, findings: readFileSync(path, "utf8") });
  }
  return runs;
}

function readRituals(root: string, base: string, problems: string[]): SourceRitual[] {
  const dir = join(root, "rituals");
  if (!isDirectory(dir)) return [];
  const rituals: SourceRitual[] = [];
  for (const slug of readdirSync(dir).toSorted()) {
    const ritualDir = join(dir, slug);
    if (!isDirectory(ritualDir)) continue;
    const file = join(ritualDir, "ritual.md");
    if (!existsSync(file)) {
      problems.push(`${sourceRef(base, ritualDir)}: no ritual.md, skipped`);
      continue;
    }
    const { fields, body } = splitSourceFile(readFileSync(file, "utf8"));
    const runs = readRunDir({ runsDir: join(ritualDir, "runs"), base, problems });
    rituals.push({ slug, file: sourceRef(base, file), fields, body, runs });
  }
  return rituals;
}

function optionalText(record: { readonly [key: string]: JsonValue }, key: string, where: string): string | undefined {
  const value = record[key];
  if (value === undefined || value === null) return undefined;
  if (!isJsonString(value)) throw new Error(`${where}: '${key}' must be a string`);
  return value;
}

/** One verification-log line to an `evidence` ledger line. Throws naming `where` on a malformed line. */
function decodeEvidence(value: JsonValue, where: string, key: string): LedgerLineInput {
  if (!isJsonObject(value)) throw new Error(`${where}: not a JSON object`);
  const spec = optionalText(value, "spec", where);
  const at = optionalText(value, "at", where);
  const outcome = optionalText(value, "outcome", where);
  const index = value.index;
  const exitCode = value.exitCode ?? null;
  if (spec === undefined || spec === "") throw new Error(`${where}: 'spec' is missing`);
  if (!isJsonNumber(index)) throw new Error(`${where}: 'index' must be a number`);
  if (at === undefined || Number.isNaN(Date.parse(at))) throw new Error(`${where}: 'at' is not a timestamp`);
  if (outcome === undefined || outcome === "") throw new Error(`${where}: 'outcome' is missing`);
  if (exitCode !== null && !isJsonNumber(exitCode)) throw new Error(`${where}: 'exitCode' must be a number or null`);
  const line: LedgerLineInput = {
    who: IMPORT_WHO,
    type: "evidence",
    at,
    check: `${spec}#${index}`,
    exit: exitCode,
    outcome,
    output_sha: null,
    duration_ms: null,
    label: optionalText(value, "label", where) ?? null,
    command: optionalText(value, "command", where) ?? null,
    expected: optionalText(value, "expected", where) ?? null,
    plugin_version: optionalText(value, "pluginVersion", where) ?? null,
    imported_from: key,
  };
  const note = optionalText(value, "evidence", where);
  if (note !== undefined) line.note = note;
  return line;
}

function readEvidence(path: string, base: string, problems: string[]): SourceEvidence[] {
  const ref = sourceRef(base, path);
  const evidence: SourceEvidence[] = [];
  const seen = new Map<string, number>();
  for (const [index, row] of readFileSync(path, "utf8").split("\n").entries()) {
    if (row.trim() === "") continue;
    const where = `${ref}:${index + 1}`;
    const key = occurrenceKey(`${ref}#${sha256Hex(row)}`, seen);
    let parsed: JsonValue;
    try {
      parsed = JSON.parse(row);
    } catch {
      problems.push(`${where}: not valid JSON, skipped`);
      continue;
    }
    try {
      evidence.push({ key, line: decodeEvidence(parsed, where, key) });
    } catch (cause) {
      problems.push(`${cause instanceof Error ? cause.message : String(cause)}, skipped`);
    }
  }
  return evidence;
}

/**
 * Reads a tracker directory. Refuses with a UsageError when the path is not a
 * directory or holds neither `rituals/` nor `.verification-log.jsonl`.
 */
export function readTrackerSource(trackerPath: string): TrackerSource {
  const root = resolve(trackerPath);
  if (!isDirectory(root)) throw new UsageError(`${root}: not a directory`);
  const evidenceFile = join(root, EVIDENCE_FILE);
  const hasEvidence = existsSync(evidenceFile);
  if (!isDirectory(join(root, "rituals")) && !hasEvidence) {
    throw new UsageError(`${root}: no rituals/ and no ${EVIDENCE_FILE}; pass the .tracker directory itself`);
  }
  const base = dirname(root);
  const problems: string[] = [];
  const rituals = readRituals(root, base, problems);
  const evidence = hasEvidence ? readEvidence(evidenceFile, base, problems) : [];
  return { root, rituals, evidence, problems };
}

// --- planning: source + store -> what to write ------------------------------------

/** What the store already holds that an import compares against. */
interface StoreView {
  /** `<type> <imported_from>` of every `who: "import"` line. */
  readonly importedKeys: ReadonlySet<string>;
  readItem(slug: string): string | null;
}

interface ItemWrite {
  readonly slug: string;
  readonly text: string;
  readonly status: "new" | "updated" | "unchanged";
}

interface ImportPlan {
  readonly items: ItemWrite[];
  readonly lines: LedgerLineInput[];
  readonly blobs: string[];
  /** Slug -> sha of the `## Findings` section stripped from a written item. */
  readonly findings: Map<string, string>;
  readonly problems: string[];
  runs: ImportCounts;
  lifecycle: ImportCounts;
  rescheduled: ImportCounts;
  evidence: ImportCounts;
}

function importKey(type: string, importedFrom: string): string {
  return `${type} ${importedFrom}`;
}

function storeViewOf(project: Project | null): StoreView {
  if (project === null) return { importedKeys: new Set(), readItem: () => null };
  const keys = new Set<string>();
  for (const line of readLedger(project)) {
    const from: LedgerLine[string] = line.imported_from;
    if (line.who === IMPORT_WHO && isJsonString(from)) keys.add(importKey(line.type, from));
  }
  return { importedKeys: keys, readItem: (slug) => readItemText(project, "ritual", slug) };
}

/** A non-empty frontmatter field of the source ritual. */
function field(ritual: SourceRitual, key: string): string | undefined {
  const value = ritual.fields.get(key);
  return value === undefined || value === "" ? undefined : value;
}

/** A date field, validated. A malformed date is a hard error naming the file. */
function dateField(ritual: SourceRitual, key: string): string | undefined {
  const value = field(ritual, key);
  if (value !== undefined && !isCalendarDate(value)) {
    throw new Error(`${ritual.file}: '${key}' is not a YYYY-MM-DD date: '${value}'`);
  }
  return value;
}

function cadenceOf(ritual: SourceRitual): string | undefined {
  const cadence = field(ritual, "cadence");
  if (cadence === undefined) return undefined;
  try {
    rollCadence("2000-01-01", cadence);
  } catch (cause) {
    throw new Error(`${ritual.file}: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
  }
  return cadence;
}

interface SplitBody {
  readonly body: string;
  readonly findings: string | null;
}

/** Removes the `## Findings` section (to the next `## ` heading or the end). */
function stripFindings(body: string): SplitBody {
  let offset = 0;
  let start: number | undefined;
  let end = body.length;
  for (const line of body.split("\n")) {
    if (start === undefined && FINDINGS_HEADING.test(line)) start = offset;
    else if (start !== undefined && SECTION_HEADING.test(line)) {
      end = offset;
      break;
    }
    offset += line.length + 1;
  }
  if (start === undefined) return { body, findings: null };
  return { body: body.slice(0, start) + body.slice(end), findings: body.slice(start, end) };
}

function titleOf(ritual: SourceRitual): string {
  const name = field(ritual, "name");
  if (name !== undefined) return name;
  for (const line of ritual.body.split("\n")) {
    const heading = TITLE_HEADING.exec(line.trim())?.[1];
    if (heading !== undefined) return heading.trim();
  }
  return ritual.slug;
}

/** The runs to import: the source's runs plus a synthetic one for `last_run` when nothing covers it. */
function completionsOf(ritual: SourceRitual): SourceRun[] {
  const lastRun = dateField(ritual, "last_run");
  const runs = [...ritual.runs];
  if (lastRun !== undefined && !runs.some((run) => run.date === lastRun)) {
    runs.push({ key: `${ritual.file}#last_run=${lastRun}`, date: lastRun, findings: "" });
  }
  return runs.toSorted((left, right) => (left.date === right.date ? compareText(left.key, right.key) : compareText(left.date, right.date)));
}

function compareText(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function previousRitual(ritual: SourceRitual, view: StoreView): { readonly text: string; readonly doc: Document<Ritual> } | null {
  const text = view.readItem(ritual.slug);
  if (text === null) return null;
  const { header, body } = decodeItem(text, `ritual/${ritual.slug}`);
  if (header.kind !== "ritual") throw new Error(`ritual/${ritual.slug}: stored item is not a ritual`);
  if (header.imported_from !== ritual.file) {
    throw new Error(
      `ritual/${ritual.slug} already exists and was not imported from ${ritual.file} ` +
        `(imported_from: ${header.imported_from ?? "none"}); refusing to overwrite it`,
    );
  }
  return { text, doc: { header, body } };
}

interface RitualDates {
  readonly created: string;
  readonly updated: string;
}

/**
 * `created` is `started` (else the earliest date the source knows). A new
 * item's `updated` is the latest date the source knows; a re-imported item
 * keeps its previous `updated`, and `planItem` moves it to today only when
 * the item text actually changes. So a legacy run bumping `last_run` alone
 * never rewrites the item.
 */
function datesOf(ritual: SourceRitual, runs: readonly SourceRun[], previous: Document<Ritual> | null): RitualDates {
  const known = [
    dateField(ritual, "started"),
    dateField(ritual, "last_run"),
    dateField(ritual, "retired"),
    dateField(ritual, "paused"),
    ...runs.map((run) => run.date),
  ].filter((date): date is string => date !== undefined);
  const earliest = known.toSorted()[0];
  const created = previous?.header.created ?? dateField(ritual, "started") ?? earliest ?? localDateOf(Date.now());
  const updated = previous?.header.updated ?? [created, ...known].toSorted().at(-1) ?? created;
  return { created, updated };
}

/** A ritual item plus the `## Findings` section cut from its body, if any. */
interface RitualImport {
  readonly doc: Document<Ritual>;
  readonly findings: string | null;
}

/** The item doc for a source ritual. Darius-owned fields (id, anchor, policy, tags) survive a re-import. */
function ritualDocOf(ritual: SourceRitual, runs: readonly SourceRun[], previous: Document<Ritual> | null): RitualImport {
  const { body, findings } = KEEP_WHOLE_BODY.has(ritual.slug) ? { body: ritual.body, findings: null } : stripFindings(ritual.body);
  const { created, updated } = datesOf(ritual, runs, previous);
  const header: Ritual = {
    id: previous?.header.id ?? ulid(),
    kind: "ritual",
    slug: ritual.slug,
    title: titleOf(ritual),
    created,
    updated,
    tags: previous?.header.tags ?? [],
    anchor: previous?.header.anchor ?? "due",
    policy: previous?.header.policy ?? { mode: "off", may: [], hold: [] },
    imported_from: ritual.file,
  };
  const cadence = cadenceOf(ritual);
  const agent = field(ritual, "agent");
  const owner = field(ritual, "owner");
  if (cadence !== undefined) header.cadence = cadence;
  if (agent !== undefined) header.agent = agent;
  if (owner !== undefined) header.owner = owner;
  return { doc: { header, body }, findings };
}

function planItem(ritual: SourceRitual, runs: readonly SourceRun[], context: { readonly view: StoreView; readonly plan: ImportPlan }): void {
  const previous = previousRitual(ritual, context.view);
  const { doc, findings } = ritualDocOf(ritual, runs, previous?.doc ?? null);
  let text = encodeItem(doc);
  let status: ItemWrite["status"] = "new";
  if (previous !== null && previous.text === text) status = "unchanged";
  if (previous !== null && previous.text !== text) {
    status = "updated";
    text = encodeItem({ ...doc, header: { ...doc.header, updated: localDateOf(Date.now()) } });
  }
  context.plan.items.push({ slug: ritual.slug, text, status });
  if (status === "unchanged" || findings === null) return;
  context.plan.blobs.push(findings);
  context.plan.findings.set(ritual.slug, sha256Hex(findings));
}

/**
 * A pruned row is covered when its run file is still in the source, or was
 * imported before the tracker pruned it: the row is that run, not a new one.
 */
function isCoveredRow(run: SourceRun, fileKeys: ReadonlySet<string>, view: StoreView): boolean {
  if (run.fileKey === undefined) return false;
  return fileKeys.has(run.fileKey) || view.importedKeys.has(importKey("run.completed", run.fileKey));
}

function planRuns(ritual: SourceRitual, runs: readonly SourceRun[], context: { readonly view: StoreView; readonly plan: ImportPlan }): void {
  const item = `ritual/${ritual.slug}`;
  const perDate = new Map<string, number>();
  const fileKeys = new Set(runs.map((run) => run.key));
  let added = 0;
  for (const run of runs) {
    const slot = perDate.get(run.date) ?? 0;
    perDate.set(run.date, slot + 1);
    if (context.view.importedKeys.has(importKey("run.completed", run.key))) continue;
    if (isCoveredRow(run, fileKeys, context.view)) continue;
    const startedMs = localNoonMs(run.date) + slot * MINUTE_MS;
    const runId = ulid(startedMs);
    const findingsSha = run.findings === "" ? null : sha256Hex(run.findings);
    if (run.findings !== "") context.plan.blobs.push(run.findings);
    context.plan.lines.push(
      { who: IMPORT_WHO, type: "run.started", item, at: isoAt(startedMs), run: runId, imported_from: run.key },
      {
        who: IMPORT_WHO,
        type: "run.completed",
        item,
        at: isoAt(startedMs + SECOND_MS),
        run: runId,
        outcome: "complete",
        findings_sha: findingsSha,
        imported_from: run.key,
      },
    );
    added += 1;
  }
  context.plan.runs = { found: context.plan.runs.found + runs.length, new: context.plan.runs.new + added };
}

/** Local noon of the last imported completion plus `offsetMs`, or now when there is none. */
function afterLastRun(runs: readonly SourceRun[], offsetMs: number): number {
  const last = runs.at(-1);
  return last === undefined ? Date.now() : localNoonMs(last.date) + offsetMs;
}

function planReschedule(ritual: SourceRitual, runs: readonly SourceRun[], context: { readonly view: StoreView; readonly plan: ImportPlan }): void {
  const due = dateField(ritual, "due");
  if (due === undefined) return;
  const lastRun = dateField(ritual, "last_run");
  const cadence = cadenceOf(ritual);
  const rolled = lastRun === undefined || cadence === undefined ? undefined : rollCadence(lastRun, cadence);
  if (due === rolled) return;
  const key = `${ritual.file}#due=${due}`;
  const isNew = !context.view.importedKeys.has(importKey("ritual.rescheduled", key));
  context.plan.rescheduled = { found: context.plan.rescheduled.found + 1, new: context.plan.rescheduled.new + (isNew ? 1 : 0) };
  if (!isNew) return;
  context.plan.lines.push({
    who: IMPORT_WHO,
    type: "ritual.rescheduled",
    item: `ritual/${ritual.slug}`,
    at: isoAt(afterLastRun(runs, RESCHEDULE_OFFSET_MS)),
    due,
    imported_from: key,
  });
}

function planLifecycle(ritual: SourceRitual, runs: readonly SourceRun[], context: { readonly view: StoreView; readonly plan: ImportPlan }): void {
  const state = field(ritual, "status");
  if (state === undefined || state === "active") return;
  if (!LIFECYCLE_STATES.has(state)) {
    context.plan.problems.push(`${ritual.file}: status '${state}' has no darius lifecycle, ignored`);
    return;
  }
  const key = `${ritual.file}#status=${state}`;
  const isNew = !context.view.importedKeys.has(importKey("ritual.lifecycle", key));
  context.plan.lifecycle = { found: context.plan.lifecycle.found + 1, new: context.plan.lifecycle.new + (isNew ? 1 : 0) };
  if (!isNew) return;
  const since = dateField(ritual, state);
  const atMs = since === undefined ? afterLastRun(runs, LIFECYCLE_OFFSET_MS) : localNoonMs(since) + LIFECYCLE_OFFSET_MS;
  const line: LedgerLineInput = { who: IMPORT_WHO, type: "ritual.lifecycle", item: `ritual/${ritual.slug}`, at: isoAt(atMs), state, imported_from: key };
  const reason = field(ritual, `${state}_reason`);
  if (reason !== undefined) line.reason = reason;
  context.plan.lines.push(line);
}

function planEvidence(evidence: readonly SourceEvidence[], context: { readonly view: StoreView; readonly plan: ImportPlan }): void {
  const fresh = evidence.filter((entry) => !context.view.importedKeys.has(importKey("evidence", entry.key)));
  context.plan.lines.push(...fresh.map((entry) => entry.line));
  context.plan.evidence = { found: evidence.length, new: fresh.length };
}

function planImport(source: TrackerSource, view: StoreView): ImportPlan {
  const empty: ImportCounts = { found: 0, new: 0 };
  const plan: ImportPlan = {
    items: [],
    lines: [],
    blobs: [],
    findings: new Map(),
    problems: [...source.problems],
    runs: empty,
    lifecycle: empty,
    rescheduled: empty,
    evidence: empty,
  };
  const context = { view, plan };
  for (const ritual of source.rituals) {
    const runs = completionsOf(ritual);
    planItem(ritual, runs, context);
    planRuns(ritual, runs, context);
    planReschedule(ritual, runs, context);
    planLifecycle(ritual, runs, context);
  }
  planEvidence(source.evidence, context);
  return plan;
}

// --- applying and reporting ------------------------------------------------------

function itemsWritten(plan: ImportPlan): number {
  return plan.items.filter((item) => item.status !== "unchanged").length;
}

function applyPlan(project: Project, plan: ImportPlan, source: TrackerSource): void {
  const written = itemsWritten(plan);
  if (written === 0 && plan.lines.length === 0) return;
  for (const blob of plan.blobs) putBlob(project, blob);
  for (const item of plan.items) {
    if (item.status === "unchanged") continue;
    writeItemText(project, { kind: "ritual", slug: item.slug, text: item.text, who: IMPORT_WHO });
  }
  const findings: { [slug: string]: JsonValue } = Object.fromEntries(plan.findings);
  const importLine: LedgerLineInput = {
    who: IMPORT_WHO,
    type: "import",
    source: source.root,
    count: written + plan.lines.length,
    items: written,
    lines: plan.lines.length,
  };
  if (plan.findings.size > 0) importLine.findings = findings;
  appendLines(project, [...plan.lines, importLine]);
}

function reportOf(plan: ImportPlan, context: { readonly options: ImportOptions; readonly source: TrackerSource }): ImportReport {
  const count = (status: ItemWrite["status"]): number => plan.items.filter((item) => item.status === status).length;
  return {
    project: context.options.project,
    source: context.source.root,
    dryRun: context.options.dryRun,
    rituals: { found: plan.items.length, new: count("new"), updated: count("updated"), unchanged: count("unchanged") },
    runs: plan.runs,
    lifecycle: plan.lifecycle,
    rescheduled: plan.rescheduled,
    evidence: plan.evidence,
    totalNew: itemsWritten(plan) + plan.lines.length,
    problems: plan.problems,
  };
}

/**
 * Imports the tracker at `options.source` into `options.project`, creating
 * the project when needed. With `dryRun`, computes the same report and
 * writes nothing, not even the project directory.
 */
export function importTracker(options: ImportOptions): ImportReport {
  const source = readTrackerSource(options.source);
  if (options.dryRun) {
    const project = existsSync(projectDir(options.project)) ? openProject(options.project) : null;
    return reportOf(planImport(source, storeViewOf(project)), { options, source });
  }
  const project = openProject(options.project, { create: true });
  return project.withLock(() => {
    const plan = planImport(source, storeViewOf(project));
    applyPlan(project, plan, source);
    return reportOf(plan, { options, source });
  });
}
