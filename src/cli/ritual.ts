/**
 * `darius ritual add|list|show|set|pause|resume|retire`: item-file CRUD and
 * lifecycle for rituals (docs/plan-tonight.md, T6b). Status (next due, held
 * runs) is never stored here: it is computed by `src/core/due.ts` (T6a) from
 * the ledger, the same way `list`/`show` read it for display.
 *
 *   ritual add <slug> --title T --cadence Nd|Nw|Nm [--anchor due|completion]
 *              [--mode off|report|act] [--model M] [--max-turns N]
 *              [--may RULE ...] [--hold REGEX ...] [--notes TEXT]
 *              [--profile NAME] [--skill NAME] [--host NAME] [--stdin] [--who W]
 *   ritual list
 *   ritual show <slug>          also what the latest run passes on (0.26.0)
 *   ritual set <slug> [--title T] [--cadence C] [--anchor A] [--agent A]
 *              [--owner O] [--tag T ...] [--mode off|report|act] [--model M]
 *              [--max-turns N] [--may RULE ...] [--hold REGEX ...]
 *              [--notes TEXT] [--profile NAME] [--skill NAME] [--host NAME]
 *              [--due YYYY-MM-DD] [--stdin] [--who W]
 *
 *   `--due` appends a `ritual.rescheduled` line (src/core/due.ts): it re-arms
 *   a ritual without a cadence, and it pushes a cadenced one out. It never
 *   pulls a due date in.
 *
 *   `--host NAME` pins the ritual to one host: run-due and `run now` on any
 *   other host skip it as `other-host` (docs/concept.md, "Host pin"). NAME is
 *   the host id, `host` in that host's config.toml. `--host ""` clears it.
 *   ritual pause|resume|retire <slug> [--who W]
 *
 * `--may`/`--hold` are repeatable (docs/concept.md, "Domain model"'s policy
 * YAML): giving the flag at all REPLACES the ritual's existing list, in the
 * order given -- `--may ""` alone clears it. `--may` values must look like a
 * Claude Code permission rule (`Tool` or `Tool(pattern)`); `--hold` values
 * must compile as JS regexes. Setting `--mode act` prints one extra stderr
 * line naming the risk: act is allowed from day one, opt-in per ritual, and
 * must stay visible (operator ruling, docs/concept.md). A `--mode` above the
 * project checkout's `.darius.toml` `max_mode` is refused (exit 1): raising
 * the ceiling takes a reviewed commit to that file.
 *
 * `pause`/`resume`/`retire` only ever append a `ritual.lifecycle` line;
 * `retired` is terminal (src/core/due.ts's doc comment), so this file
 * refuses to append a further lifecycle change once one is read back.
 */

import { appendLine, defaultWho, isHostId, readLedger } from "../core/ledger.ts";
import { parseDate, ritualState, rollCadence, type RitualState } from "../core/due.ts";
import { handoffLines, latestHandoff } from "../core/handoff.ts";
import { findMarker, isAboveCap, PERMISSION_RULE_RE, type Marker } from "../core/marker.ts";
import type { Policy, Ritual } from "../core/model.ts";
import { resolveProject } from "../core/paths.ts";
import { localToday } from "../core/sweep.ts";
import { itemRef, openProject, type Project } from "../core/store.ts";
import { ulid } from "../core/ulid.ts";
import { projectWorkdir } from "../core/workdir.ts";
import { errorMessage } from "../runtime.ts";
import { UsageError, type Command, type ParsedArgs } from "./registry.ts";

const VERBS = "add | list | show | set | pause | resume | retire";

function stringFlag(args: ParsedArgs, name: string): string | undefined {
  const value = args.flags[name];
  if (value === undefined || value === false) return undefined;
  if (value === true) throw new UsageError(`--${name} needs a value`);
  return value;
}

function requirePositional(args: ParsedArgs, index: number, label: string): string {
  const value = args.positional[index];
  if (value === undefined || value === "") throw new UsageError(`ritual: missing ${label}`);
  return value;
}

function currentProject(args: ParsedArgs, opts?: { create?: boolean }): Project {
  return openProject(resolveProject(stringFlag(args, "project")), opts);
}

function printJson<T>(value: T): void {
  console.log(JSON.stringify(value));
}

function anchorFlag(value: string | undefined): Ritual["anchor"] {
  if (value === undefined || value === "due") return "due";
  if (value === "completion") return "completion";
  throw new UsageError(`--anchor must be 'due' or 'completion', got '${value}'`);
}

/** Reuses src/core/due.ts's own cadence parser so "Nd|Nw|Nm" stays defined in one place. */
function assertCadence(value: string): void {
  try {
    rollCadence("2000-01-01", value);
  } catch (cause) {
    throw new UsageError(errorMessage(cause));
  }
}

// --- policy flags -------------------------------------------------------------

function modeFlag(value: string): Policy["mode"] {
  if (value === "off" || value === "report" || value === "act") return value;
  throw new UsageError(`--mode must be 'off', 'report' or 'act', got '${value}'`);
}

function positiveIntFlag(args: ParsedArgs, name: string): number | undefined {
  const raw = stringFlag(args, name);
  if (raw === undefined) return undefined;
  if (!/^[1-9]\d*$/u.test(raw)) throw new UsageError(`--${name} must be a positive integer, got '${raw}'`);
  return Number.parseInt(raw, 10);
}

function assertMayRule(rule: string): void {
  if (!PERMISSION_RULE_RE.test(rule)) {
    throw new UsageError(`--may '${rule}' is not a Claude Code permission rule; expected 'Tool' or 'Tool(pattern)'`);
  }
}

function assertHoldPattern(pattern: string): void {
  try {
    const compiled = new RegExp(pattern);
    void compiled;
  } catch (cause) {
    throw new UsageError(`--hold '${pattern}' does not compile as a regular expression: ${errorMessage(cause)}`);
  }
}

/**
 * A repeated flag's values, validated, with empty strings dropped. Giving
 * the flag at all (even just `--flag ""`) means "replace the list" -- the
 * caller distinguishes "not given" (`undefined`, leave the existing list
 * alone) from "given, replace with this" (an array, possibly empty).
 */
function repeatedListFlag(args: ParsedArgs, name: string, validate: (value: string) => void): string[] | undefined {
  const values = args.repeated[name];
  if (values === undefined) return undefined;
  const nonEmpty = values.filter((value) => value.length > 0);
  for (const value of nonEmpty) validate(value);
  return nonEmpty;
}

/** Applies every policy flag present in `args` on top of `base`; flags absent leave `base`'s field untouched. */
function policyFromArgs(args: ParsedArgs, base: Policy): Policy {
  const policy: Policy = { ...base };
  const mode = stringFlag(args, "mode");
  if (mode !== undefined) policy.mode = modeFlag(mode);
  const model = stringFlag(args, "model");
  if (model !== undefined) policy.model = model;
  const maxTurns = positiveIntFlag(args, "max-turns");
  if (maxTurns !== undefined) policy.max_turns = maxTurns;
  const may = repeatedListFlag(args, "may", assertMayRule);
  if (may !== undefined) policy.may = may;
  const hold = repeatedListFlag(args, "hold", assertHoldPattern);
  if (hold !== undefined) policy.hold = hold;
  const notes = stringFlag(args, "notes");
  if (notes !== undefined) policy.notes = notes;
  // `--profile ""` clears it: the ritual then uses the repo's or the store's default.
  const profile = stringFlag(args, "profile");
  if (profile === "") delete policy.profile;
  else if (profile !== undefined) policy.profile = profile;
  return policy;
}

/** `--host`: undefined when not given, "" to clear the pin, else a host id. */
function hostFlag(args: ParsedArgs): string | undefined {
  const host = stringFlag(args, "host");
  if (host === undefined || host === "" || isHostId(host)) return host;
  throw new UsageError(`--host '${host}' is not a host id: use the \`host\` of that host's config.toml`);
}

/** Setting `--mode act` must stay visible: one stderr line, every time it is set (operator ruling, docs/concept.md). */
function warnIfSettingActMode(args: ParsedArgs): void {
  if (stringFlag(args, "mode") !== "act") return;
  console.error("act mode: this ritual may run the commands in 'may' unattended; 'hold' still stops it.");
}

/** The `.darius.toml` of the project's checkout on this host, else the one above the cwd when it names this project. */
function projectMarker(project: Project): Marker | null {
  const where = projectWorkdir(project, readLedger(project));
  if ("dir" in where && where.marker !== null) return where.marker;
  const here = findMarker(process.cwd());
  return here?.project === project.name ? here : null;
}

/** Refuses a `--mode` above the checkout's `max_mode`. Without `--mode`, or with no marker on this host, nothing to check. */
function assertUnderCap(args: ParsedArgs, project: Project, mode: Policy["mode"]): void {
  if (stringFlag(args, "mode") === undefined) return;
  const marker = projectMarker(project);
  if (marker === null || !isAboveCap(mode, marker)) return;
  throw new Error(
    `refusing --mode ${mode}: ${marker.file} caps ${project.name} at max_mode = "${marker.maxMode ?? "?"}". ` +
      "Raise it there in a reviewed commit first.",
  );
}

function formatPolicy(policy: Policy): string {
  const parts = [`mode=${policy.mode}`];
  if (policy.model !== undefined) parts.push(`model=${policy.model}`);
  if (policy.max_turns !== undefined) parts.push(`max_turns=${String(policy.max_turns)}`);
  if (policy.profile !== undefined) parts.push(`profile=${policy.profile}`);
  return parts.join(" ");
}

// --- add --------------------------------------------------------------------

function runAdd(args: ParsedArgs): number {
  const slug = requirePositional(args, 1, "<slug>");
  const title = stringFlag(args, "title");
  if (title === undefined) throw new UsageError("ritual add needs --title");
  const cadence = stringFlag(args, "cadence");
  if (cadence === undefined) throw new UsageError("ritual add needs --cadence");
  assertCadence(cadence);
  const anchor = anchorFlag(stringFlag(args, "anchor"));
  const host = hostFlag(args);
  const policy = policyFromArgs(args, { mode: "off", may: [], hold: [] });
  const project = currentProject(args, { create: true });
  if (project.readItem("ritual", slug) !== null) {
    throw new UsageError(`ritual '${slug}' already exists in ${project.name}`);
  }
  assertUnderCap(args, project, policy.mode);
  warnIfSettingActMode(args);
  const now = new Date().toISOString();
  const header: Ritual = {
    id: ulid(),
    kind: "ritual",
    slug,
    title,
    created: now,
    updated: now,
    tags: [],
    cadence,
    anchor,
    policy,
  };
  const skill = stringFlag(args, "skill");
  if (skill !== undefined && skill !== "") header.skill = skill;
  if (host !== undefined && host !== "") header.host = host;
  const who = stringFlag(args, "who") ?? defaultWho();
  project.writeItem({ header, body: args.stdin ?? `# ${title}\n` }, { who });
  if (args.json) printJson({ ok: true, project: project.name, added: header });
  else console.log(`✓ ritual ${slug} added to ${project.name}`);
  return 0;
}

// --- list and show ------------------------------------------------------------

interface ListedRitual {
  slug: string;
  title: string;
  cadence?: string;
  anchor: Ritual["anchor"];
  lifecycle: RitualState["lifecycle"];
  /** The host the ritual is pinned to; absent when any host may run it. */
  host?: string;
}

function listRituals(project: Project): ListedRitual[] {
  const ledger = readLedger(project);
  const today = localToday();
  return project.listItems("ritual").flatMap((slug) => {
    const doc = project.readItem<Ritual>("ritual", slug);
    if (doc === null) return [];
    const state = ritualState(doc, ledger, today);
    const listed: ListedRitual = {
      slug,
      title: doc.header.title,
      anchor: doc.header.anchor,
      lifecycle: state.lifecycle,
    };
    if (doc.header.cadence !== undefined) listed.cadence = doc.header.cadence;
    if (doc.header.host !== undefined) listed.host = doc.header.host;
    return [listed];
  });
}

function runList(args: ParsedArgs): number {
  const project = currentProject(args);
  const rituals = listRituals(project);
  if (args.json) {
    printJson({ project: project.name, rituals });
    return 0;
  }
  if (rituals.length === 0) console.log(`no rituals in ${project.name}`);
  for (const ritual of rituals) {
    const host = ritual.host === undefined ? "" : ` host=${ritual.host}`;
    console.log(
      `${ritual.slug.padEnd(28)} ${ritual.lifecycle.padEnd(8)} cadence=${ritual.cadence ?? "-"} anchor=${ritual.anchor}${host}  ${ritual.title}`,
    );
  }
  return 0;
}

function runShow(args: ParsedArgs): number {
  const slug = requirePositional(args, 1, "<slug>");
  const project = currentProject(args);
  const doc = project.readItem<Ritual>("ritual", slug);
  if (doc === null) throw new UsageError(`no ritual '${slug}' in ${project.name}`);
  const ledger = readLedger(project);
  const state = ritualState(doc, ledger, localToday());
  const handoff = latestHandoff(project, ledger, slug);
  if (args.json) {
    printJson({ project: project.name, header: doc.header, body: doc.body, status: state, handoff });
    return 0;
  }
  console.log(`${doc.header.title} (${slug})`);
  console.log(`lifecycle: ${state.lifecycle}  cadence: ${doc.header.cadence ?? "-"}  anchor: ${doc.header.anchor}`);
  console.log(`nextDue: ${state.nextDue ?? "-"}  isDue: ${String(state.isDue)}  overdueDays: ${String(state.overdueDays)}`);
  if (state.heldRun !== undefined) console.log(`held run: ${state.heldRun}`);
  if (state.openRun !== undefined) console.log(`open run: ${state.openRun}`);
  if (doc.header.skill !== undefined) console.log(`skill: ${doc.header.skill}`);
  if (doc.header.host !== undefined) console.log(`host: ${doc.header.host} (other hosts skip it)`);
  console.log(`policy: ${formatPolicy(doc.header.policy)}`);
  if (doc.header.policy.may.length > 0) console.log(`  may: ${doc.header.policy.may.join(", ")}`);
  if (doc.header.policy.hold.length > 0) console.log(`  hold: ${doc.header.policy.hold.join(", ")}`);
  if (doc.header.policy.notes !== undefined) console.log(`  notes: ${doc.header.policy.notes}`);
  if (handoff !== null) console.log(`\nhandoff to the next run:\n${handoffLines(handoff).join("\n")}`);
  console.log(`\n${doc.body}`);
  return 0;
}

// --- set ------------------------------------------------------------------------

function assertDate(date: string): void {
  try {
    parseDate(date);
  } catch (cause) {
    throw new UsageError(`--due: ${errorMessage(cause)}`);
  }
}

function runSet(args: ParsedArgs): number {
  const slug = requirePositional(args, 1, "<slug>");
  const project = currentProject(args);
  const doc = project.readItem<Ritual>("ritual", slug);
  if (doc === null) throw new UsageError(`no ritual '${slug}' in ${project.name}`);
  const cadence = stringFlag(args, "cadence");
  if (cadence !== undefined) assertCadence(cadence);
  const due = stringFlag(args, "due");
  if (due !== undefined) assertDate(due);
  const policy = policyFromArgs(args, doc.header.policy);
  const header: Ritual = {
    ...doc.header,
    title: stringFlag(args, "title") ?? doc.header.title,
    cadence: cadence ?? doc.header.cadence,
    anchor: args.flags.anchor === undefined ? doc.header.anchor : anchorFlag(stringFlag(args, "anchor")),
    policy,
    updated: new Date().toISOString(),
  };
  const agent = stringFlag(args, "agent");
  if (agent !== undefined) header.agent = agent;
  const owner = stringFlag(args, "owner");
  if (owner !== undefined) header.owner = owner;
  const tags = args.repeated.tag ?? [];
  if (tags.length > 0) header.tags = [...tags];
  // `--skill ""` clears it.
  const skill = stringFlag(args, "skill");
  if (skill === "") delete header.skill;
  else if (skill !== undefined) header.skill = skill;
  // `--host ""` clears the pin: any host may run the ritual again.
  const host = hostFlag(args);
  if (host === "") delete header.host;
  else if (host !== undefined) header.host = host;
  assertUnderCap(args, project, policy.mode);
  warnIfSettingActMode(args);
  const who = stringFlag(args, "who") ?? defaultWho();
  project.writeItem({ header, body: args.stdin ?? doc.body }, { who });
  if (due !== undefined) appendLine(project, { who, type: "ritual.rescheduled", item: itemRef("ritual", slug), due });
  if (args.json) printJson({ ok: true, project: project.name, updated: header });
  else console.log(`✓ ritual ${slug} updated`);
  return 0;
}

// --- pause / resume / retire ----------------------------------------------------

function setLifecycle(args: ParsedArgs, state: "active" | "paused" | "retired"): number {
  const slug = requirePositional(args, 1, "<slug>");
  const project = currentProject(args);
  const doc = project.readItem<Ritual>("ritual", slug);
  if (doc === null) throw new UsageError(`no ritual '${slug}' in ${project.name}`);
  const current = ritualState(doc, readLedger(project), localToday());
  if (current.lifecycle === "retired") {
    throw new UsageError(`ritual '${slug}' is retired (terminal); its lifecycle cannot change`);
  }
  const who = stringFlag(args, "who") ?? defaultWho();
  appendLine(project, { who, type: "ritual.lifecycle", item: itemRef("ritual", slug), state });
  if (args.json) printJson({ ok: true, project: project.name, ritual: slug, lifecycle: state });
  else console.log(`✓ ritual ${slug} is now ${state}`);
  return 0;
}

// --- dispatch ---------------------------------------------------------------------

export const ritualCommand: Command = {
  name: "ritual",
  summary: "add, list, show, edit and change lifecycle of rituals",
  audience: "session",
  usage: `ritual ${VERBS.replaceAll(" | ", "|")}`,
  async run(args: ParsedArgs): Promise<number> {
    const verb = args.positional[0];
    switch (verb) {
      case "add":
        return runAdd(args);
      case "list":
        return runList(args);
      case "show":
        return runShow(args);
      case "set":
        return runSet(args);
      case "pause":
        return setLifecycle(args, "paused");
      case "resume":
        return setLifecycle(args, "active");
      case "retire":
        return setLifecycle(args, "retired");
      default:
        throw new UsageError(`ritual needs a verb: ${VERBS}`);
    }
  },
};
