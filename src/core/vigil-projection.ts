/**
 * The vigils of the store, projected as files in the legacy format:
 * `<treeDir>/vigils/<slug>.md`. The files are a derived, read-only view. The
 * store item is the one source; nothing reads these files back into it.
 * They exist so the legacy readers (the index, `archive-check`, vigil health)
 * still see the vigils.
 *
 * A file is written only when its content differs, and a `*.md` file with no
 * store vigil is removed, so a projection run on an unchanged store touches
 * nothing.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { Project } from "./store.ts";
import { readVigilViews, type VigilView } from "./vigil-view.ts";

/** The tree directory of a project in the store: `<project root>/tracker`. */
export function treeDirOf(project: Project): string {
  return join(project.root, "tracker");
}

/** Where the projection of vigil `slug` lives. */
export function projectedVigilPath(treeDir: string, slug: string): string {
  return join(treeDir, "vigils", `${slug}.md`);
}

/** The legacy writer's quoting: a bare scalar unless YAML would misread it. */
function scalar(value: string): string {
  const flat = value.replace(/\s*\n\s*/gu, " ");
  const needsQuotes =
    flat === "true" ||
    flat === "false" ||
    /^-?\d+$/u.test(flat) ||
    /^0\d/u.test(flat) ||
    flat !== flat.trim() ||
    flat.includes(": ") ||
    /^[[{*&!|>'"#]/u.test(flat) ||
    flat.endsWith(":");
  return needsQuotes ? `'${flat.replaceAll("'", "''")}'` : flat;
}

function line(key: string, value: string | null): string {
  return value === null || value === "" ? `${key}:` : `${key}: ${scalar(value)}`;
}

/** The text of one projected file: legacy frontmatter keys in legacy order, then the body. */
function fileText(view: VigilView): string {
  const header = [
    "type: vigil",
    line("name", view.name),
    line("slug", view.slug),
    line("due", view.due),
    line("until", view.until),
    line("from", view.from),
    line("agent", view.agent),
    line("opened", view.opened),
    line("resolved", view.resolved),
    line("verdict", view.verdict),
  ];
  const body = view.body.replace(/^\n+/u, "");
  const text = `---\n${header.join("\n")}\n---\n\n${body}`;
  return text.endsWith("\n") ? text : `${text}\n`;
}

function readIfPresent(path: string): string | null {
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

function writeAtomic(path: string, text: string): void {
  const temp = `${path}.tmp-${process.pid}`;
  writeFileSync(temp, text);
  renameSync(temp, path);
}

/** Brings `<treeDir>/vigils/` in line with the store vigils of `project`. */
export function projectVigils(project: Project, treeDir: string): void {
  const views = readVigilViews(project);
  const dir = join(treeDir, "vigils");
  if (views.length === 0 && !existsSync(dir)) return;
  mkdirSync(dir, { recursive: true });
  const wanted = new Set<string>();
  for (const view of views) {
    const path = projectedVigilPath(treeDir, view.slug);
    wanted.add(`${view.slug}.md`);
    const text = fileText(view);
    if (readIfPresent(path) !== text) writeAtomic(path, text);
  }
  for (const name of readdirSync(dir)) {
    if (name.endsWith(".md") && !wanted.has(name)) unlinkSync(join(dir, name));
  }
}
