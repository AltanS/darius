/**
 * `darius ritual export [--project P] [--write] [--json]`
 * (docs/architecture/marker-v3.md, section 6): the migration from store
 * rituals to a v3 `.darius.toml`.
 *
 * It reads the active and paused rituals of the project (retired ones are
 * left out) and builds a v3 marker. The existing marker's root keys,
 * `[profiles.*]` and `[defaults]` are copied as text; `v` becomes 3 and a root
 * `tz` line (the host's zone) is added. One `[rituals.<slug>]` follows per
 * ritual, with the git-owned fields. `host` is never written. A ritual with
 * no skill gets `skill = "<slug>"` and its body becomes
 * `.claude/skills/<slug>/SKILL.md`. If that skill already exists in the
 * checkout, the body becomes `<slug>-ritual` instead.
 *
 * Without `--write` the marker goes to stdout. With `--write` the file and the
 * skill files are written (tmp and rename) in the linked checkout. Export never
 * runs a git write command and never commits.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

import { ritualLifecycle } from "../core/due.ts";
import { readLedger } from "../core/ledger.ts";
import { MARKER_FILE, PERMISSION_RULE_RE, REPO_SLUG, readMarker } from "../core/marker.ts";
import { UsageError, type Ritual } from "../core/model.ts";
import { resolveProject } from "../core/paths.ts";
import { markerDirty } from "../core/reconcile.ts";
import { openProject, type Project } from "../core/store.ts";
import { tomlArrayMultiline, tomlLiteral, tomlString, tomlText } from "../core/toml.ts";
import { checkoutDir } from "../core/workdir.ts";
import type { ParsedArgs } from "./registry.ts";

/** One skill file export creates: a ritual that had a body and no skill. */
export interface ExportedSkill {
  slug: string;
  /** Relative to the checkout. */
  path: string;
  content: string;
}

export interface Export {
  marker: string;
  skills: ExportedSkill[];
  /** Things the operator should know: a store body that is not exported. */
  warnings: string[];
}

function hostZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** A YAML value: plain when it is safe, else a JSON string (valid YAML). */
function yamlValue(text: string): string {
  return /^[A-Za-z0-9][A-Za-z0-9 ,.()/_-]*$/u.test(text) ? text : JSON.stringify(text);
}

function skillContent(ritual: Ritual, name: string, body: string): string {
  return `---\nname: ${name}\ndescription: ${yamlValue(ritual.title)}\n---\n${body}`;
}

interface MarkerParts {
  head: string;
  sections: string;
}

/**
 * The existing marker's text as the v3 head: `v = 3`, the root keys and a
 * `tz` line, then everything from the first section on, untouched. No marker
 * gives the two required root lines.
 */
function markerHead(existing: string | null, at: { project: string; zone: string; maxMode: string | undefined }): MarkerParts {
  const tzLine = `tz = ${tomlString(at.zone)}`;
  const capLine = at.maxMode === undefined ? [] : [`max_mode = ${tomlString(at.maxMode)}`];
  if (existing === null) {
    return { head: `v = 3\nproject = ${tomlString(at.project)}\n${[...capLine, tzLine].join("\n")}\n`, sections: "" };
  }
  const lines = existing.split("\n");
  const firstSection = lines.findIndex((line) => /^\s*\[/u.test(line));
  const split = firstSection === -1 ? lines.length : firstSection;
  const root = lines.slice(0, split);
  const sections = lines.slice(split).join("\n");
  const hasVersion = root.some((line) => /^\s*v\s*=/u.test(line));
  const next = root.map((line) => (/^\s*v\s*=/u.test(line) ? "v = 3" : line));
  if (!hasVersion) {
    const index = next.findIndex((line) => /^\s*project\s*=/u.test(line));
    next.splice(index === -1 ? 0 : index, 0, "v = 3");
  }
  while (next.length > 0 && next[next.length - 1]?.trim() === "") next.pop();
  if (!root.some((line) => /^\s*max_mode\s*=/u.test(line))) next.push(...capLine);
  next.push(tzLine);
  return { head: `${next.join("\n")}\n`, sections };
}

function listLines(key: string, items: readonly string[], quote: (value: string) => string): string[] {
  if (items.length === 0) return [];
  if (items.length === 1) return [`${key} = [${quote(items[0] ?? "")}]`];
  return [`${key} = ${tomlArrayMultiline(items, quote)}`];
}

function ritualTable(ritual: Ritual, skill: string): string {
  const { policy } = ritual;
  const lines = [`[rituals.${ritual.slug}]`, `title = ${tomlString(ritual.title)}`];
  if (ritual.cadence !== undefined && ritual.cadence !== "") lines.push(`cadence = ${tomlString(ritual.cadence)}`);
  if (ritual.anchor === "completion") lines.push('anchor = "completion"');
  lines.push(`skill = ${tomlString(skill)}`);
  if (ritual.args !== undefined && ritual.args !== "") lines.push(`args = ${tomlString(ritual.args)}`);
  if (policy.profile !== undefined) lines.push(`profile = ${tomlString(policy.profile)}`);
  if (policy.model !== undefined) lines.push(`model = ${tomlString(policy.model)}`);
  if (policy.max_turns !== undefined) lines.push(`max_turns = ${String(policy.max_turns)}`);
  lines.push(`mode = ${tomlString(policy.mode)}`);
  lines.push(...listLines("may", policy.may, tomlString));
  lines.push(...listLines("hold", policy.hold, tomlLiteral));
  if (policy.notes !== undefined && policy.notes !== "") lines.push(`notes = ${tomlText(policy.notes)}`);
  return lines.join("\n");
}

function validHold(pattern: string): boolean {
  try {
    return new RegExp(pattern, "u") instanceof RegExp;
  } catch {
    return false;
  }
}

/** Reasons a store ritual cannot become a v3 table, one line each. */
function problems(docs: readonly { header: Ritual }[]): string[] {
  const found: string[] = [];
  for (const { header } of docs) {
    const { slug, policy } = header;
    if (!REPO_SLUG.test(slug)) {
      found.push(`${slug}: not a v3 slug (lowercase letters, digits, '-' or '_', at most 64, no dots); rename it first`);
    }
    const badRule = policy.may.find((rule) => !PERMISSION_RULE_RE.test(rule));
    if (badRule !== undefined) found.push(`${slug}: may rule "${badRule}" is not a permission rule`);
    const badHold = policy.hold.find((pattern) => !validHold(pattern));
    if (badHold !== undefined) found.push(`${slug}: hold "${badHold}" does not compile with the u flag`);
  }
  return found;
}

/**
 * The skill name for a store body. An existing `.claude/skills/<slug>` in the
 * checkout is the domain procedure and stays; the body then becomes
 * `<slug>-ritual`. If that exists too, export refuses. `<slug>-ritual` is at
 * most 71 characters, so it always fits the 128 limit of a skill name.
 */
function exportedSkillName(slug: string, body: string, checkout: string | undefined, warnings: string[]): string {
  if (checkout === undefined || body.trim() === "" || !existsSync(join(checkout, ".claude", "skills", slug, "SKILL.md"))) return slug;
  const name = `${slug}-ritual`;
  const target = join(checkout, ".claude", "skills", name, "SKILL.md");
  if (existsSync(target)) {
    throw new UsageError(`${slug}: .claude/skills/${slug} and .claude/skills/${name} both exist (${target}); move one away first`);
  }
  warnings.push(`${slug}: .claude/skills/${slug} exists; the store body becomes the skill ${name}`);
  return name;
}

/** The v3 marker and skill files for `project`'s live rituals. `existing` is the current marker text, or null. */
export function buildExport(project: Project, existing: string | null, zone: string, checkout?: string): Export {
  const ledger = readLedger(project);
  const docs = project.listItems("ritual").flatMap((slug) => {
    const doc = project.readItem<Ritual>("ritual", slug);
    if (doc === null || ritualLifecycle(ledger, slug) === "retired") return [];
    return [doc];
  });
  const bad = problems(docs);
  if (bad.length > 0) throw new UsageError(`ritual export cannot continue:\n${bad.map((line) => `  ${line}`).join("\n")}`);
  const skills: ExportedSkill[] = [];
  const warnings: string[] = [];
  const tables = docs.map(({ header, body }) => {
    const named = header.skill !== undefined && header.skill !== "";
    if (named && body.trim() !== "") {
      warnings.push(`${header.slug}: the store body is not exported; the skill ${header.skill ?? ""} is the procedure`);
    }
    if (named) return ritualTable(header, header.skill ?? header.slug);
    const name = exportedSkillName(header.slug, body, checkout, warnings);
    skills.push({ slug: header.slug, path: join(".claude", "skills", name, "SKILL.md"), content: skillContent(header, name, body) });
    return ritualTable(header, name);
  });
  const rank = { off: 0, report: 1, act: 2 } as const;
  const top = docs.reduce<"off" | "report" | "act">((high, { header }) => (rank[header.policy.mode] > rank[high] ? header.policy.mode : high), "off");
  const { head, sections } = markerHead(existing, { project: project.name, zone, maxMode: top === "off" ? undefined : top });
  const middle = sections === "" ? "" : `\n${sections.replace(/\n+$/u, "")}\n`;
  const marker = `${head}${middle}${tables.length === 0 ? "" : `\n${tables.join("\n\n")}\n`}`;
  return { marker, skills, warnings };
}

function atomicWrite(file: string, text: string): void {
  mkdirSync(dirname(file), { recursive: true });
  const temp = `${file}.tmp-${String(process.pid)}`;
  writeFileSync(temp, text);
  renameSync(temp, file);
}

function pathDirty(checkout: string, path: string): boolean {
  const result = spawnSync("git", ["status", "--porcelain", "--", path], { cwd: checkout, encoding: "utf8", timeout: 10_000 });
  return result.status === 0 && result.stdout.trim() !== "";
}

/** The `--write` refusals, before anything is written. */
function assertWritable(checkout: string, built: Export): void {
  const file = join(checkout, MARKER_FILE);
  if (existsSync(file) && readMarker(checkout)?.version === 3) {
    throw new UsageError(`${file} is already v = 3; nothing to export`);
  }
  if (markerDirty(checkout)) throw new UsageError(`${file} has uncommitted changes; commit or discard them first`);
  for (const skill of built.skills) {
    const target = join(checkout, skill.path);
    if (existsSync(target)) throw new UsageError(`${target} exists; move it away first`);
    if (pathDirty(checkout, skill.path)) throw new UsageError(`${target} has uncommitted changes; commit or discard them first`);
  }
}

function currentProject(args: ParsedArgs): Project {
  const flag = args.flags.project;
  if (flag === true) throw new UsageError("--project needs a value");
  return openProject(resolveProject(flag === false ? undefined : flag));
}

export function runExport(args: ParsedArgs): number {
  const project = currentProject(args);
  const checkout = checkoutDir(project, readLedger(project));
  const markerFile = checkout === undefined ? undefined : join(checkout, MARKER_FILE);
  const present = markerFile !== undefined && existsSync(markerFile);
  if (present) {
    const current = readMarker(checkout ?? "");
    if (current?.version === 3) throw new UsageError(`${markerFile} is already v = 3; nothing to export`);
  }
  const built = buildExport(project, present && markerFile !== undefined ? readFileSync(markerFile, "utf8") : null, hostZone(), checkout);
  const isWrite = args.flags.write === true;
  if (!args.json) for (const warning of built.warnings) console.error(`! ${warning}`);
  if (!isWrite) {
    if (args.json) console.log(JSON.stringify({ project: project.name, written: false, marker: built.marker, skills: built.skills, warnings: built.warnings }));
    else process.stdout.write(built.marker);
    return 0;
  }
  if (checkout === undefined) throw new UsageError(`no checkout of ${project.name} on this host: run darius link inside one`);
  assertWritable(checkout, built);
  for (const skill of built.skills) atomicWrite(join(checkout, skill.path), skill.content);
  atomicWrite(join(checkout, MARKER_FILE), built.marker);
  const files = [MARKER_FILE, ...built.skills.map((skill) => skill.path)];
  if (args.json) {
    console.log(JSON.stringify({ project: project.name, written: true, files, warnings: built.warnings }));
    return 0;
  }
  for (const file of files) console.log(`✓ wrote ${join(checkout, file)}`);
  console.log("Next: review the files, commit, push, pull on the running host, then run `darius ritual reconcile`.");
  console.log("darius did not run git. The store rituals stay until reconcile adopts the repo ones.");
  return 0;
}
