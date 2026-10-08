/**
 * `darius profile add|set|list|show`: the store-wide harness profiles
 * (docs/concept.md, "Harnesses, profiles and surfaces" > "Profiles"). They
 * live in the reserved `_global` project and sync to every host like any
 * item. A repo's `.darius.toml` may override them field by field.
 *
 *   profile add <name> [--harness H] [--model M] [--effort E]
 *               [--permissions gated|skip] [--surface headless|herdr]
 *               [--max-turns N] [--arg=A ...] [--title T] [--who W]
 *   profile set <name> (the same flags; a flag given replaces the field,
 *               an empty value clears it, `--arg ""` clears the args)
 *   profile list
 *   profile show <name>
 *
 * An arg is almost always a flag itself. Both `--arg --verbose` and
 * `--arg=--verbose` pass `--verbose` (0.42.3: a value may start with --).
 *
 * A ritual uses one with `ritual set <slug> --profile <name>`. A profile
 * called `default` applies to every ritual that names none. The harness,
 * the effort and the args are checked against the harness adapter when the
 * profile is written, and again when run-due resolves it.
 */

import { defaultWho } from "../core/ledger.ts";
import type { Profile, ProfileFields } from "../core/model.ts";
import { GLOBAL_PROJECT, openProject, type Project } from "../core/store.ts";
import { ulid } from "../core/ulid.ts";
import { checkProfileFields } from "../harness/profile.ts";
import { errorMessage } from "../runtime.ts";
import { NotFoundError, UsageError, type Command, type ParsedArgs } from "./registry.ts";

const VERBS = "add | set | list | show";

function stringFlag(args: ParsedArgs, name: string): string | undefined {
  const value = args.flags[name];
  if (value === undefined || value === false) return undefined;
  if (value === true) throw new UsageError(`--${name} needs a value`);
  return value;
}

function requireName(args: ParsedArgs): string {
  const value = args.positional[1];
  if (value === undefined || value === "") throw new UsageError("profile: missing <name>");
  return value;
}

function globalProject(opts?: { create?: boolean }): Project {
  return openProject(GLOBAL_PROJECT, opts);
}

function printJson<T>(value: T): void {
  console.log(JSON.stringify(value));
}

function permissionsFlag(value: string): ProfileFields["permissions"] {
  if (value === "gated" || value === "skip") return value;
  throw new UsageError(`--permissions must be 'gated' or 'skip', got '${value}'`);
}

function surfaceFlag(value: string): ProfileFields["surface"] {
  if (value === "headless" || value === "herdr") return value;
  throw new UsageError(`--surface must be 'headless' or 'herdr', got '${value}'`);
}

function maxTurnsFlag(value: string): number {
  if (!/^[1-9]\d*$/u.test(value)) throw new UsageError(`--max-turns must be a positive integer, got '${value}'`);
  return Number.parseInt(value, 10);
}

/** Sets or clears one text field: absent leaves it, "" clears it. */
function applyText(fields: ProfileFields, key: "harness" | "model" | "effort", value: string | undefined): void {
  if (value === undefined) return;
  if (value === "") delete fields[key];
  else fields[key] = value;
}

/** Applies every profile flag present in `args` on top of `base`. */
function fieldsFromArgs(args: ParsedArgs, base: ProfileFields): ProfileFields {
  const fields: ProfileFields = { ...base };
  applyText(fields, "harness", stringFlag(args, "harness"));
  applyText(fields, "model", stringFlag(args, "model"));
  applyText(fields, "effort", stringFlag(args, "effort"));
  const permissions = stringFlag(args, "permissions");
  if (permissions === "") delete fields.permissions;
  else if (permissions !== undefined) fields.permissions = permissionsFlag(permissions);
  const surface = stringFlag(args, "surface");
  if (surface === "") delete fields.surface;
  else if (surface !== undefined) fields.surface = surfaceFlag(surface);
  const maxTurns = stringFlag(args, "max-turns");
  if (maxTurns === "") delete fields.max_turns;
  else if (maxTurns !== undefined) fields.max_turns = maxTurnsFlag(maxTurns);
  const argValues = args.repeated.arg;
  if (argValues !== undefined) {
    const nonEmpty = argValues.filter((value) => value !== "");
    if (nonEmpty.length === 0) delete fields.args;
    else fields.args = nonEmpty;
  }
  return fields;
}

/** Only the ProfileFields of a profile header, for display and resolution. */
function fieldsOf(profile: Profile): ProfileFields {
  const { harness, model, effort, permissions, surface, max_turns: maxTurns, args } = profile;
  const fields: ProfileFields = {};
  if (harness !== undefined) fields.harness = harness;
  if (model !== undefined) fields.model = model;
  if (effort !== undefined) fields.effort = effort;
  if (permissions !== undefined) fields.permissions = permissions;
  if (surface !== undefined) fields.surface = surface;
  if (maxTurns !== undefined) fields.max_turns = maxTurns;
  if (args !== undefined) fields.args = [...args];
  return fields;
}

function check(fields: ProfileFields, name: string): void {
  try {
    checkProfileFields(fields, `profile "${name}"`);
  } catch (cause) {
    throw new UsageError(errorMessage(cause));
  }
}

function describe(fields: ProfileFields): string {
  const parts = [`harness=${fields.harness ?? "claude"}`];
  if (fields.model !== undefined) parts.push(`model=${fields.model}`);
  if (fields.effort !== undefined) parts.push(`effort=${fields.effort}`);
  parts.push(`permissions=${fields.permissions ?? "skip"}`, `surface=${fields.surface ?? "headless"}`);
  if (fields.max_turns !== undefined) parts.push(`max_turns=${String(fields.max_turns)}`);
  if (fields.args !== undefined) parts.push(`args=${JSON.stringify(fields.args)}`);
  return parts.join(" ");
}

// --- verbs --------------------------------------------------------------------

function runAdd(args: ParsedArgs): number {
  const name = requireName(args);
  const fields = fieldsFromArgs(args, {});
  check(fields, name);
  const project = globalProject({ create: true });
  if (project.readItem("profile", name) !== null) throw new UsageError(`profile '${name}' already exists; use profile set`);
  const now = new Date().toISOString();
  const header: Profile = {
    id: ulid(),
    kind: "profile",
    slug: name,
    title: stringFlag(args, "title") ?? name,
    created: now,
    updated: now,
    tags: [],
    ...fields,
  };
  project.writeItem({ header, body: "" }, { who: stringFlag(args, "who") ?? defaultWho() });
  if (args.json) printJson({ ok: true, added: header });
  else console.log(`✓ profile ${name} added: ${describe(fields)}`);
  return 0;
}

function runSet(args: ParsedArgs): number {
  const name = requireName(args);
  const project = globalProject();
  const doc = project.readItem<Profile>("profile", name);
  if (doc === null) throw new NotFoundError(`no profile '${name}'; use profile add`);
  const fields = fieldsFromArgs(args, fieldsOf(doc.header));
  check(fields, name);
  const { id, created, tags } = doc.header;
  const header: Profile = {
    id,
    kind: "profile",
    slug: name,
    title: stringFlag(args, "title") ?? doc.header.title,
    created,
    updated: new Date().toISOString(),
    tags,
    ...fields,
  };
  project.writeItem({ header, body: doc.body }, { who: stringFlag(args, "who") ?? defaultWho() });
  if (args.json) printJson({ ok: true, updated: header });
  else console.log(`✓ profile ${name} updated: ${describe(fields)}`);
  return 0;
}

function readProfiles(): Profile[] {
  let project: Project;
  try {
    project = globalProject();
  } catch {
    return [];
  }
  return project.listItems("profile").flatMap((name) => {
    const doc = project.readItem<Profile>("profile", name);
    return doc === null ? [] : [doc.header];
  });
}

function runList(args: ParsedArgs): number {
  const profiles = readProfiles();
  if (args.json) {
    printJson({ profiles });
    return 0;
  }
  if (profiles.length === 0) console.log("no profiles; the built-in one runs claude headless, with permissions skipped and the darius gate");
  for (const profile of profiles) console.log(`${profile.slug.padEnd(24)} ${describe(fieldsOf(profile))}`);
  return 0;
}

function runShow(args: ParsedArgs): number {
  const name = requireName(args);
  const profile = readProfiles().find((candidate) => candidate.slug === name);
  if (profile === undefined) throw new NotFoundError(`no profile '${name}'`);
  if (args.json) printJson({ profile });
  else console.log(`${profile.slug}: ${describe(fieldsOf(profile))}`);
  return 0;
}

export const profileCommand: Command = {
  name: "profile",
  flags: ["harness", "model", "effort", "permissions", "surface", "max-turns", "arg", "title", "who"],
  summary: "store-wide harness profiles: add, set, list, show (a ritual picks one with --profile)",
  async run(args: ParsedArgs): Promise<number> {
    const verb = args.positional[0];
    switch (verb) {
      case "add":
        return runAdd(args);
      case "set":
        return runSet(args);
      case "list":
        return runList(args);
      case "show":
        return runShow(args);
      default:
        throw new UsageError(`profile needs a verb: ${VERBS}`);
    }
  },
};
