/**
 * `darius ritual add|list|show|set|pause|resume|retire|reconcile`: item-file CRUD and
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
 *   ritual reconcile [--project P] [--dry-run] [--json]
 *   ritual export [--project P] [--write] [--json]
 *
 * v3 projects (0.54.0; docs/architecture/marker-v3.md, section 2): a project
 * whose `.darius.toml` says `v = 3` defines its rituals there. `add` is refused
 * (exit 2) and names the table to add. `set` accepts only the store-owned flags
 * (`--host --owner --agent --tag --due --who`) on a repo ritual and names the
 * file and line for any other. `retire` is refused for a repo ritual: remove
 * the table and commit. `reconcile` mirrors the checkout's marker into the
 * store by hand (run-due does it on every batch); `--dry-run` writes nothing.
 *
 * `export` (0.55.0, section 6) prints a v3 marker built from the project's
 * store rituals; `--write` writes `.darius.toml` and the skill files into the
 * linked checkout. It never runs git. See src/cli/ritual-export.ts.
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

import { existsSync } from "node:fs";
import { join } from "node:path";

import { appendLine, defaultWho, hostId, isHostId, readLedger } from "../core/ledger.ts";
import { parseDate, ritualLifecycle, ritualState, rollCadence, type RitualState } from "../core/due.ts";
import { handoffLines, latestHandoff } from "../core/handoff.ts";
import { findMarker, isAboveCap, MARKER_FILE, PERMISSION_RULE_RE, type Marker } from "../core/marker.ts";
import { reconcileProject, ritualWarnings, type ReconcileResult } from "../core/reconcile.ts";
import type { Document, Policy, Ritual } from "../core/model.ts";
import { resolveProject } from "../core/paths.ts";
import { itemRef, openProject, type Project } from "../core/store.ts";
import { ulid } from "../core/ulid.ts";
import { checkoutDir, projectWorkdir } from "../core/workdir.ts";
import { errorMessage } from "../runtime.ts";
import { runExport } from "./ritual-export.ts";
import { NotFoundError, UsageError, type Command, type ParsedArgs } from "./registry.ts";

const VERBS = "add | list | show | set | pause | resume | retire | reconcile | export";

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

// --- v3 projects: rituals live in .darius.toml ------------------------------------------

/** A v3 marker on this host for `project`, else null. A marker that does not parse counts as none here. */
function v3Marker(project: Project): Marker | null {
  try {
    const marker = projectMarker(project);
    return marker !== null && marker.version >= 3 ? marker : null;
  } catch {
    return null;
  }
}

/** True when a v3 marker names the slug, or reconcile already mirrored it (`source: "repo"`). */
function isRepoRitual(doc: Document<Ritual> | null, slug: string, marker: Marker | null): boolean {
  return doc?.header.source === "repo" || (marker?.rituals.some((ritual) => ritual.slug === slug) ?? false);
}

/** `<checkout>/.darius.toml:<line> ([rituals.<slug>])`, or the bare table name when no marker is on this host. */
function definedAt(slug: string, marker: Marker | null): string {
  const line = marker?.rituals.find((ritual) => ritual.slug === slug)?.line;
  const where = marker === null ? MARKER_FILE : line === undefined ? marker.file : `${marker.file}:${String(line)}`;
  return `${where} ([rituals.${slug}])`;
}

/** The `set` flags whose values live in git for a repo ritual. `--stdin` is the body, which a repo ritual does not have. */
const GIT_FLAGS: readonly string[] = ["title", "cadence", "anchor", "skill", "mode", "may", "hold", "notes", "model", "max-turns", "profile", "stdin"];

function givenGitFlag(args: ParsedArgs): string | undefined {
  return GIT_FLAGS.find((name) => {
    if (name === "stdin") return args.stdin !== undefined || args.flags.stdin !== undefined;
    return (args.flags[name] !== undefined && args.flags[name] !== false) || args.repeated[name] !== undefined;
  });
}

function formatPolicy(policy: Policy): string {
  const parts = [`mode=${policy.mode}`];
  if (policy.model !== undefined) parts.push(`model=${policy.model}`);
  if (policy.max_turns !== undefined) parts.push(`max_turns=${String(policy.max_turns)}`);
  if (policy.profile !== undefined) parts.push(`profile=${policy.profile}`);
  return parts.join(" ");
}

/** A v3 marker here, or a ritual that reconcile mirrored from one. */
function isV3Project(project: Project): boolean {
  if (v3Marker(project) !== null) return true;
  return project.listItems("ritual").some((slug) => project.readItem<Ritual>("ritual", slug)?.header.source === "repo");
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
  if (isV3Project(project)) {
    throw new UsageError(`${project.name} defines rituals in ${MARKER_FILE} (v = 3); add [rituals.${slug}] there and commit`);
  }
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
  /** `repo`: defined in `.darius.toml` (v3). `unmanaged`: a store ritual a v3 marker does not name. */
  source?: "repo" | "unmanaged";
  at?: string;
  tz?: string;
  /** The skill's input from the marker (`args`); absent when none is set. */
  args?: string;
  /** What the operator should see: a stale mirror, a retired slug named again. */
  warnings?: string[];
}

function listRituals(project: Project): ListedRitual[] {
  const ledger = readLedger(project);
  const now = new Date();
  const marker = v3Marker(project);
  return project.listItems("ritual").flatMap((slug) => {
    const doc = project.readItem<Ritual>("ritual", slug);
    if (doc === null) return [];
    const state = ritualState(doc, ledger, { now });
    const listed: ListedRitual = {
      slug,
      title: doc.header.title,
      anchor: doc.header.anchor,
      lifecycle: state.lifecycle,
    };
    if (doc.header.cadence !== undefined) listed.cadence = doc.header.cadence;
    if (doc.header.host !== undefined) listed.host = doc.header.host;
    if (doc.header.source === "repo") listed.source = "repo";
    else if (marker !== null && !isRepoRitual(doc, slug, marker) && state.lifecycle !== "retired") listed.source = "unmanaged";
    if (doc.header.at !== undefined) listed.at = doc.header.at;
    if (doc.header.tz !== undefined) listed.tz = doc.header.tz;
    if (doc.header.args !== undefined) listed.args = doc.header.args;
    const warnings = ritualWarnings(doc, ritualLifecycle(ledger, doc.header.slug), marker);
    if (warnings.length > 0) listed.warnings = warnings;
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
    const at = ritual.at === undefined ? "" : ` at=${ritual.at}${ritual.tz === undefined ? "" : ` ${ritual.tz}`}`;
    const source = ritual.source === undefined ? "" : ` ${ritual.source}`;
    console.log(
      `${ritual.slug.padEnd(28)} ${ritual.lifecycle.padEnd(8)} cadence=${ritual.cadence ?? "-"}${at} anchor=${ritual.anchor}${host}${source}  ${ritual.title}`,
    );
    for (const warning of ritual.warnings ?? []) console.log(`! ${warning}`);
  }
  return 0;
}

/** `repo (commit X, host Y, <date>)`, `unmanaged` (v3 project, not in the marker) or `store`. */
function showSource(doc: Document<Ritual>, ledger: ReturnType<typeof readLedger>, marker: Marker | null): string {
  const { header } = doc;
  if (header.source === "repo") {
    const commit = header.def_commit === undefined ? "no commit" : `commit ${header.def_commit}`;
    const dirty = header.def_dirty === true ? ", uncommitted changes" : "";
    const warnings = ritualWarnings(doc, ritualLifecycle(ledger, doc.header.slug), marker).map((warning) => `\n  ! ${warning}`).join("");
    return `repo (${commit}, host ${header.def_host ?? "?"}, ${header.def_at ?? "?"}${dirty})${warnings}`;
  }
  return marker !== null && !isRepoRitual(doc, header.slug, marker) ? "unmanaged (not in .darius.toml; it never runs unattended)" : "store";
}

function runShow(args: ParsedArgs): number {
  const slug = requirePositional(args, 1, "<slug>");
  const project = currentProject(args);
  const doc = project.readItem<Ritual>("ritual", slug);
  if (doc === null) throw new NotFoundError(`no ritual '${slug}' in ${project.name}`);
  const ledger = readLedger(project);
  const state = ritualState(doc, ledger, { now: new Date() });
  const handoff = latestHandoff(project, ledger, slug);
  if (args.json) {
    printJson({ project: project.name, header: doc.header, body: doc.body, status: state, handoff });
    return 0;
  }
  console.log(`${doc.header.title} (${slug})`);
  console.log(`lifecycle: ${state.lifecycle}  cadence: ${doc.header.cadence ?? "-"}  anchor: ${doc.header.anchor}`);
  const when = state.nextDue === undefined || doc.header.at === undefined ? "" : ` ${doc.header.at} ${doc.header.tz ?? "local"}`;
  console.log(`nextDue: ${state.nextDue ?? "-"}${when}  isDue: ${String(state.isDue)}  overdueDays: ${String(state.overdueDays)}`);
  if (state.heldRun !== undefined) console.log(`held run: ${state.heldRun}`);
  if (state.openRun !== undefined) console.log(`open run: ${state.openRun}`);
  if (doc.header.skill !== undefined) console.log(`skill: ${doc.header.skill}`);
  if (doc.header.args !== undefined) console.log(`args: ${doc.header.args}`);
  if (doc.header.timeout !== undefined) console.log(`timeout: ${doc.header.timeout}`);
  console.log(`source: ${showSource(doc, ledger, v3Marker(project))}`);
  if (doc.header.host !== undefined) console.log(`host: ${doc.header.host} (other hosts skip it)`);
  console.log(`policy: ${formatPolicy(doc.header.policy)}`);
  if (doc.header.policy.may.length > 0) console.log(`  may: ${doc.header.policy.may.join(", ")}`);
  if (doc.header.policy.hold.length > 0) console.log(`  hold: ${doc.header.policy.hold.join(", ")}`);
  if (doc.header.policy.on_hold !== undefined) console.log(`  on_hold: ${doc.header.policy.on_hold} (a hold-list match refuses the call; the run goes on)`);
  const followUpMay = doc.header.policy.follow_up_may ?? [];
  if (followUpMay.length > 0) console.log(`  follow_up_may: ${followUpMay.join(", ")} (a follow-up run only)`);
  if (doc.header.follow_up !== undefined) console.log(`follow_up: ${doc.header.follow_up} (a follow-up runs without herdr)`);
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
  if (doc === null) throw new NotFoundError(`no ritual '${slug}' in ${project.name}`);
  const marker = v3Marker(project);
  if (isRepoRitual(doc, slug, marker)) {
    const flag = givenGitFlag(args);
    if (flag !== undefined) throw new UsageError(`--${flag} is defined in ${definedAt(slug, marker)}; edit the file and commit`);
  } else if (marker !== null) {
    console.error("unmanaged: not in .darius.toml; it never runs unattended");
  }
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
  if (doc === null) throw new NotFoundError(`no ritual '${slug}' in ${project.name}`);
  const current = ritualState(doc, readLedger(project), { now: new Date() });
  if (current.lifecycle === "retired") {
    throw new UsageError(`ritual '${slug}' is retired (terminal); its lifecycle cannot change`);
  }
  if (state === "retired" && isRepoRitual(doc, slug, v3Marker(project))) {
    throw new UsageError(`remove [rituals.${slug}] from ${MARKER_FILE} and commit; the next reconcile retires it`);
  }
  const who = stringFlag(args, "who") ?? defaultWho();
  appendLine(project, { who, type: "ritual.lifecycle", item: itemRef("ritual", slug), state });
  if (args.json) printJson({ ok: true, project: project.name, ritual: slug, lifecycle: state });
  else console.log(`✓ ritual ${slug} is now ${state}`);
  return 0;
}

// --- reconcile ------------------------------------------------------------------------

function reconcileLines(project: string, result: ReconcileResult, isDry: boolean): string[] {
  const where = result.commit === undefined ? "" : ` at commit ${result.commit}`;
  const counts = [
    `${String(result.adopted.length)} adopted`,
    `${String(result.updated.length)} updated`,
    `${String(result.unchanged.length)} unchanged`,
    `${String(result.retired.length)} retired`,
  ].join(", ");
  const lines = [`${isDry ? "·" : "✓"} ${isDry ? "would reconcile" : "reconciled"} ${project}${where} on ${hostId()}: ${counts}`];
  if (result.unmanaged.length > 0) lines.push(`  unmanaged: ${result.unmanaged.join(", ")} (not in ${MARKER_FILE}; they never run unattended)`);
  if (result.dirty) lines.push(`! ${MARKER_FILE} has uncommitted changes; unattended runs skip this project's rituals until you commit them`);
  for (const warning of result.warnings) lines.push(`! ${warning}`);
  return lines;
}

function runReconcile(args: ParsedArgs): number {
  const isDry = args.flags["dry-run"] === true;
  const project = currentProject(args, { create: !isDry });
  const checkout = checkoutDir(project, readLedger(project));
  if (checkout === undefined) {
    throw new UsageError(`no checkout of ${project.name} on this host: run darius link inside one`);
  }
  if (!existsSync(join(checkout, MARKER_FILE))) throw new UsageError(`not a v3 project: ${checkout} has no ${MARKER_FILE}`);
  const result = reconcileProject(project, checkout, hostId(), new Date(), { dryRun: isDry });
  if (result.marker === "v2") throw new UsageError(`not a v3 project: ${join(checkout, MARKER_FILE)} is below v = 3`);
  if (args.json) printJson({ project: project.name, dryRun: isDry, ...result });
  else if (!result.ok) console.error(`! ${result.error ?? "the marker does not parse"}`);
  else for (const line of reconcileLines(project.name, result, isDry)) console.log(line);
  return result.ok ? 0 : 1;
}

// --- dispatch ---------------------------------------------------------------------

export const ritualCommand: Command = {
  name: "ritual",
  summary: "add, list, show, edit and change lifecycle of rituals; reconcile mirrors a v3 .darius.toml into the store; export builds one from the store",
  audience: "session",
  // In a v3 project add and retire are refused for repo rituals, and set takes host, owner, agent, tag and due only.
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
      case "reconcile":
        return runReconcile(args);
      case "export":
        return runExport(args);
      default:
        throw new UsageError(`ritual needs a verb: ${VERBS}`);
    }
  },
};
