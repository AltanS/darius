/**
 * Copies a legacy `.tracker/vigils/` into the store's vigil items.
 *
 * READ-ONLY ON THE SOURCE: files are opened with readdirSync, statSync and
 * readFileSync only. Every write goes to the store.
 *
 * - One item per `vigils/<slug>.md`. Names that start with `_` or `00-` are
 *   not vigils. The header is read leniently (src/core/legacy-header.ts); a
 *   file with no usable header is a problem, never an exception.
 * - The body is copied byte for byte and is NOT validated: legacy bodies
 *   come in as they are, even ones `vigil add` would refuse today.
 * - `imported_from` is `.tracker/vigils/<file>`. A re-import finds the item
 *   by it: identical text is `unchanged`; a changed source rewrites the item
 *   and keeps its id, tags, `heavy` and `gate_command`, which the source does
 *   not have. A same-slug item of another origin is a problem.
 * - An imported OPEN vigil gets `heavy: true`, so the daily sweep does not run
 *   its Commands (many read production) until `vigil set <slug> --no-heavy`.
 *   A closed one gets `heavy: false`. A re-import keeps the stored value.
 * - A legacy `verdict` becomes one `vigil.closed{verdict, by: "import",
 *   imported_from}` line at LOCAL noon of `resolved`. A vigil that already has
 *   a `vigil.closed` line gets no second one.
 * - Dates have no time: `opened` becomes `created` at local noon (the file's
 *   mtime when `opened` is missing or not a date).
 *
 * Everything is checked first and written after. A real run with any problem
 * writes nothing; `dryRun` writes nothing and says what would happen.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { parseHeader } from "./legacy-header.ts";
import { appendLines, readLedger } from "./ledger.ts";
import type { LedgerLineInput } from "./ledger.ts";
import type { Document, Vigil } from "./model.ts";
import { decodeItem, encodeItem, isSlug, itemRef, readItemText, writeItemText } from "./store.ts";
import type { Project } from "./store.ts";
import { errorMessage } from "../runtime.ts";
import { ulid } from "./ulid.ts";
import { isCalendarDate, localNoonIso } from "./vigil-view.ts";

export interface VigilImportResult {
  imported: string[];
  unchanged: string[];
  closed: number;
  problems: string[];
}

const IMPORT_WHO = "import";

/** One file's plan: the item text to write (null when unchanged) and the close line to append. */
interface Planned {
  slug: string;
  text: string | null;
  close: LedgerLineInput | null;
}

function fieldOf(fields: Map<string, string>, key: string): string | undefined {
  const value = fields.get(key);
  return value === undefined || value === "" ? undefined : value;
}

function isVigilFile(name: string): boolean {
  return name.endsWith(".md") && !name.startsWith("_") && !name.startsWith("00-");
}

/** `created` for a file: local noon of `opened`, else the file's mtime. */
function createdOf(opened: string | undefined, mtime: Date): string {
  return opened !== undefined && isCalendarDate(opened) ? localNoonIso(opened) : mtime.toISOString();
}

/** The doc a source file stands for. A previous import keeps its id, tags and native-only fields. */
function docOf(source: { slug: string; fields: Map<string, string>; body: string; ref: string; mtime: Date }, previous: Document<Vigil> | null): Document<Vigil> {
  const { slug, fields, body, ref, mtime } = source;
  // An open vigil comes in heavy: the daily sweep skips it until the operator runs `vigil set <slug> --no-heavy`.
  const isOpen = fieldOf(fields, "verdict") === undefined;
  const created = previous?.header.created ?? createdOf(fieldOf(fields, "opened"), mtime);
  const header: Vigil = {
    id: previous?.header.id ?? ulid(),
    kind: "vigil",
    slug,
    title: fieldOf(fields, "name") ?? slug,
    created,
    updated: previous?.header.updated ?? created,
    tags: previous?.header.tags ?? [],
    heavy: previous?.header.heavy ?? isOpen,
    imported_from: ref,
  };
  for (const key of ["from", "due", "until", "agent"] as const) {
    const value = fieldOf(fields, key);
    if (value !== undefined) header[key] = value;
  }
  if (previous?.header.gate_command !== undefined) header.gate_command = previous.header.gate_command;
  return { header, body };
}

/** The `at` of the close line: local noon of `resolved`, else of `opened`, else now. */
function closedAt(fields: Map<string, string>): string {
  for (const key of ["resolved", "opened"]) {
    const value = fieldOf(fields, key);
    if (value !== undefined && isCalendarDate(value)) return localNoonIso(value);
  }
  return new Date().toISOString();
}

type Previous =
  | { kind: "none" }
  | { kind: "problem"; message: string }
  | { kind: "imported"; text: string; doc: Document<Vigil> };

/** What the store holds under `vigil/<slug>`: nothing, an item of this origin, or a clash. */
function previousOf(project: Project, slug: string, ref: string): Previous {
  const text = readItemText(project, "vigil", slug);
  if (text === null) return { kind: "none" };
  let doc: Document;
  try {
    doc = decodeItem(text, `vigil/${slug}`);
  } catch (cause) {
    return { kind: "problem", message: `${ref}: vigil/${slug} exists and cannot be read: ${errorMessage(cause)}` };
  }
  if (doc.header.kind !== "vigil") return { kind: "problem", message: `${ref}: vigil/${slug} exists and is not a vigil` };
  if (doc.header.imported_from !== ref) {
    const origin = doc.header.imported_from ?? "none";
    return { kind: "problem", message: `${ref}: vigil/${slug} already exists and was not imported from ${ref} (imported_from: ${origin}); refusing to overwrite it` };
  }
  return { kind: "imported", text, doc: { header: doc.header, body: doc.body } };
}

interface ReadFile {
  text: string;
  mtime: Date;
}

function readSource(path: string): ReadFile | null {
  const stats = statSync(path);
  return stats.isFile() ? { text: readFileSync(path, "utf8"), mtime: stats.mtime } : null;
}

/** The text to write for a source file, or null when the stored item already holds it. */
function itemTextOf(doc: Document<Vigil>, previous: Previous): string | null {
  const text = encodeItem(doc);
  if (previous.kind !== "imported") return text;
  if (previous.text === text) return null;
  return encodeItem({ ...doc, header: { ...doc.header, updated: new Date().toISOString() } });
}

function planFile(project: Project, dir: string, name: string, closedItems: ReadonlySet<string>, problems: string[]): Planned | null {
  const ref = `.tracker/vigils/${name}`;
  const slug = name.slice(0, -".md".length);
  if (!isSlug(slug)) {
    problems.push(`${ref}: '${slug}' is not a valid slug (lowercase letters, digits, '-', '_' or '.')`);
    return null;
  }
  let file: ReadFile | null;
  try {
    file = readSource(join(dir, name));
  } catch (cause) {
    problems.push(`${ref}: cannot read: ${errorMessage(cause)}`);
    return null;
  }
  if (file === null) return null;
  const parsed = parseHeader(file.text);
  if (!parsed.closed || parsed.fields.size === 0) {
    problems.push(`${ref}: no usable frontmatter header`);
    return null;
  }
  const verdict = fieldOf(parsed.fields, "verdict");
  if (verdict !== undefined && verdict !== "held" && verdict !== "failed") {
    problems.push(`${ref}: verdict '${verdict}' is not held or failed`);
    return null;
  }
  const previous = previousOf(project, slug, ref);
  if (previous.kind === "problem") {
    problems.push(previous.message);
    return null;
  }
  const doc = docOf({ slug, fields: parsed.fields, body: parsed.body, ref, mtime: file.mtime }, previous.kind === "imported" ? previous.doc : null);
  const text = itemTextOf(doc, previous);
  if (text !== null) {
    try {
      decodeItem(text, ref);
    } catch (cause) {
      problems.push(`${ref}: does not fit the store format: ${errorMessage(cause)}`);
      return null;
    }
  }
  const ledgerItem = itemRef("vigil", slug);
  const isClosing = verdict !== undefined && !closedItems.has(ledgerItem);
  const close: LedgerLineInput | null = isClosing
    ? { who: IMPORT_WHO, type: "vigil.closed", item: ledgerItem, at: closedAt(parsed.fields), verdict, by: IMPORT_WHO, imported_from: ref }
    : null;
  return { slug, text, close };
}

/** Copy a legacy `.tracker/vigils/` into the store's vigil items. */
export function importLegacyVigils(project: Project, trackerDir: string, options: { dryRun: boolean; who?: string }): VigilImportResult {
  const result: VigilImportResult = { imported: [], unchanged: [], closed: 0, problems: [] };
  const dir = join(trackerDir, "vigils");
  if (!existsSync(dir)) return result;
  const ledger = readLedger(project);
  const closedItems = new Set(ledger.filter((line) => line.type === "vigil.closed" && line.item !== undefined).map((line) => line.item ?? ""));
  const planned: Planned[] = [];
  for (const name of readdirSync(dir).filter(isVigilFile).toSorted()) {
    const plan = planFile(project, dir, name, closedItems, result.problems);
    if (plan === null) continue;
    planned.push(plan);
    if (plan.text === null) result.unchanged.push(plan.slug);
    else result.imported.push(plan.slug);
    if (plan.close !== null) result.closed += 1;
  }
  if (options.dryRun || result.problems.length > 0) return result;
  const who = options.who ?? IMPORT_WHO;
  for (const plan of planned) {
    if (plan.text !== null) writeItemText(project, { kind: "vigil", slug: plan.slug, text: plan.text, who });
  }
  const lines = planned.flatMap((plan) => (plan.close === null ? [] : [plan.close]));
  if (lines.length > 0) appendLines(project, lines);
  return result;
}
