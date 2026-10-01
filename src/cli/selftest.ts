/**
 * `darius selftest`: seeds and drives the `darius-selftest` project used to
 * prove the runner, sweep, and sync end to end (docs/plan-tonight.md, "Test
 * project darius-selftest").
 *
 *   selftest seed [--project darius-selftest] [--who W] [--json]
 *   selftest fire [--project darius-selftest] [--json]
 *   selftest status [--project darius-selftest] [--json]
 *
 * `seed` is idempotent: a slug that already exists is left untouched and
 * reported `unchanged`, never edited. It writes through the same primitives
 * the CLI commands use -- every vigil goes through `addVigil`
 * (src/core/sweep.ts), the exact function `vigil add` (src/cli/vigil.ts)
 * calls. The ritual is written straight through `project.writeItem`
 * (src/core/store.ts), the primitive `ritual add`/`set` (src/cli/ritual.ts)
 * call once they have built their header, because that CLI has no flags yet
 * for `policy.mode`, `model`, `max_turns`, `may`, `hold` or `notes` -- this
 * is a gap in `ritual.ts`, reported to the coordinator rather than patched
 * here (out of this task's file scope).
 *
 * `fire` touches the file `event-gated`'s `gate_command` tests for, relative
 * to the sweep's cwd (the project's store dir, `SweepOptions.cwd`'s default
 * in src/core/sweep.ts): `<stateDir>/<project>/fired.marker`.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { ritualState, type RitualState } from "../core/due.ts";
import { defaultWho, linesFor, readLedger } from "../core/ledger.ts";
import type { LedgerLine, Policy, Ritual } from "../core/model.ts";
import { addVigil, localToday, vigilStatus, type VigilInput, type VigilStatus } from "../core/sweep.ts";
import { itemRef, openProject, type Project } from "../core/store.ts";
import { ulid } from "../core/ulid.ts";
import { UsageError, type Command, type ParsedArgs } from "./registry.ts";

const VERBS = "seed | fire | status";
const DEFAULT_PROJECT = "darius-selftest";
const MARKER_FILE = "fired.marker";

// ---------------------------------------------------------------------------
// Small arg helpers (mirrors src/cli/vigil.ts and src/cli/ritual.ts: no
// shared helper module exists yet, so every command file keeps its own).
// ---------------------------------------------------------------------------

function stringFlag(args: ParsedArgs, name: string): string | undefined {
  const value = args.flags[name];
  if (value === undefined || value === false) return undefined;
  if (value === true) throw new UsageError(`--${name} needs a value`);
  return value;
}

function currentProject(args: ParsedArgs, opts?: { create?: boolean }): Project {
  return openProject(stringFlag(args, "project") ?? DEFAULT_PROJECT, opts);
}

function printJson<T>(value: T): void {
  console.log(JSON.stringify(value));
}

// ---------------------------------------------------------------------------
// The fixtures: one ritual, five vigils, per docs/plan-tonight.md's table.
// ---------------------------------------------------------------------------

interface RitualSeed {
  readonly slug: string;
  readonly title: string;
  readonly cadence: string;
  readonly policy: Policy;
}

const HEARTBEAT: RitualSeed = {
  slug: "heartbeat",
  title: "Heartbeat",
  cadence: "1d",
  policy: {
    mode: "report",
    may: ["Bash(darius *)", "Bash(date)"],
    hold: ["git push", "rm -rf"],
    notes: "Read-only. Runs darius --version and date, then reports the outputs. Nothing else is allowed.",
    model: "haiku",
    max_turns: 6,
  },
};

function heartbeatBody(project: string): string {
  return [
    "# Heartbeat",
    "",
    "Prove the unattended runner can launch, act, and report back.",
    "",
    "1. Run `darius --version`.",
    "2. Run `date`.",
    "3. Finish the run with both outputs as findings:",
    `   \`darius run complete <run> --project ${project} --outcome complete --findings-stdin\``,
    "",
    "The runner fills in `<run>` in its prompt.",
    "",
  ].join("\n");
}

interface VigilSeed {
  readonly slug: string;
  readonly title: string;
  readonly due?: string;
  readonly until?: string;
  readonly gate_command?: string;
  readonly heavy: boolean;
  readonly body: string;
}

function checklist(...items: string[]): string {
  return `# checks\n\n${items.join("\n")}\n`;
}

function checkItem(label: string, command: string, expected = "exit 0"): string {
  return `- [ ] ${label}\n  - Command: \`${command}\`\n  - Expected: \`${expected}\``;
}

function manualItem(label: string, owner: string, expires: string): string {
  return `- [ ] ${label}\n  - Expected: \`manual (owner: ${owner}, expires: ${expires})\``;
}

/** Local calendar date, one day before `today` (avoids DST/ms-arithmetic drift). */
function yesterday(): string {
  const now = new Date();
  now.setDate(now.getDate() - 1);
  return localToday(now);
}

function vigilSeeds(): readonly VigilSeed[] {
  const due = yesterday();
  return [
    {
      slug: "date-held",
      title: "date held",
      due,
      heavy: false,
      body: checklist(checkItem("passes", "test 1 = 1")),
    },
    {
      slug: "date-failed",
      title: "date failed",
      due,
      heavy: false,
      body: checklist(checkItem("fails", "test -f /nonexistent")),
    },
    {
      slug: "event-gated",
      title: "event gated",
      until: "selftest marker exists",
      gate_command: `test -f ${MARKER_FILE}`,
      heavy: false,
      body: checklist(checkItem("passes", "test 1 = 1")),
    },
    {
      slug: "heavy-one",
      title: "heavy one",
      heavy: true,
      body: checklist(checkItem("sleeps then passes", "sleep 1 && test 1 = 1")),
    },
    {
      slug: "mixed-manual",
      title: "mixed manual",
      heavy: false,
      body: checklist(
        checkItem("passes", "test 1 = 1"),
        manualItem("an operator looks at the page", "owner", "2027-01-01"),
      ),
    },
  ];
}

// ---------------------------------------------------------------------------
// seed
// ---------------------------------------------------------------------------

export interface SeedItemResult {
  kind: "ritual" | "vigil";
  slug: string;
  status: "added" | "unchanged";
}

export interface SeedReport {
  project: string;
  items: SeedItemResult[];
}

interface SeedContext {
  readonly project: Project;
  readonly who: string;
}

function seedRitual(ctx: SeedContext): SeedItemResult {
  const { slug } = HEARTBEAT;
  if (ctx.project.readItem("ritual", slug) !== null) return { kind: "ritual", slug, status: "unchanged" };
  const now = new Date().toISOString();
  const header: Ritual = {
    id: ulid(),
    kind: "ritual",
    slug,
    title: HEARTBEAT.title,
    created: now,
    updated: now,
    tags: [],
    cadence: HEARTBEAT.cadence,
    anchor: "due",
    policy: HEARTBEAT.policy,
  };
  ctx.project.writeItem({ header, body: heartbeatBody(ctx.project.name) }, { who: ctx.who });
  return { kind: "ritual", slug, status: "added" };
}

function seedVigil(ctx: SeedContext, seed: VigilSeed): SeedItemResult {
  if (ctx.project.readItem("vigil", seed.slug) !== null) {
    return { kind: "vigil", slug: seed.slug, status: "unchanged" };
  }
  const input: VigilInput = { slug: seed.slug, title: seed.title, body: seed.body, heavy: seed.heavy, who: ctx.who };
  if (seed.due !== undefined) input.due = seed.due;
  if (seed.until !== undefined) input.until = seed.until;
  if (seed.gate_command !== undefined) input.gate_command = seed.gate_command;
  addVigil(ctx.project, input);
  return { kind: "vigil", slug: seed.slug, status: "added" };
}

/** Idempotent: a slug that already exists is skipped and reported `unchanged`. */
export function seedSelftest(project: Project, who: string): SeedReport {
  const ctx: SeedContext = { project, who };
  const items: SeedItemResult[] = [seedRitual(ctx)];
  for (const seed of vigilSeeds()) items.push(seedVigil(ctx, seed));
  return { project: project.name, items };
}

function runSeed(args: ParsedArgs): number {
  const project = currentProject(args, { create: true });
  const who = stringFlag(args, "who") ?? defaultWho();
  const report = seedSelftest(project, who);
  if (args.json) {
    printJson(report);
    return 0;
  }
  console.log(report.project);
  for (const item of report.items) {
    console.log(`  ${item.status === "added" ? "✓" : "·"} ${item.kind} ${item.slug} ${item.status}`);
  }
  return 0;
}

// ---------------------------------------------------------------------------
// fire
// ---------------------------------------------------------------------------

/** Touches the marker `event-gated`'s `gate_command` looks for. Returns its path. */
export function fireMarker(project: Project): string {
  const path = join(project.root, MARKER_FILE);
  mkdirSync(project.root, { recursive: true });
  writeFileSync(path, "");
  return path;
}

function runFire(args: ParsedArgs): number {
  const project = currentProject(args);
  const path = fireMarker(project);
  if (args.json) {
    printJson({ project: project.name, marker: path });
    return 0;
  }
  console.log(`✓ marker touched: ${path}`);
  return 0;
}

// ---------------------------------------------------------------------------
// status (one screen, read-only)
// ---------------------------------------------------------------------------

interface SelftestRitualStatus {
  slug: string;
  lifecycle: RitualState["lifecycle"];
  isDue: boolean;
  nextDue?: string;
}

interface SelftestVigilStatus {
  slug: string;
  state: VigilStatus["state"];
  verdict?: string;
  flagged: boolean;
  lastOutcome?: string;
}

interface SelftestStatusReport {
  project: string;
  ritual?: SelftestRitualStatus;
  vigils: SelftestVigilStatus[];
}

function ritualStatus(project: Project, ledger: LedgerLine[]): SelftestRitualStatus | undefined {
  const doc = project.readItem<Ritual>("ritual", HEARTBEAT.slug);
  if (doc === null) return undefined;
  const state = ritualState(doc, ledger, { now: new Date() });
  const status: SelftestRitualStatus = { slug: HEARTBEAT.slug, lifecycle: state.lifecycle, isDue: state.isDue };
  if (state.nextDue !== undefined) status.nextDue = state.nextDue;
  return status;
}

function vigilStatuses(project: Project, ledger: LedgerLine[]): SelftestVigilStatus[] {
  return project.listItems("vigil").map((slug) => {
    const status = vigilStatus(slug, linesFor(ledger, itemRef("vigil", slug)));
    const entry: SelftestVigilStatus = { slug, state: status.state, flagged: status.flagged };
    if (status.verdict !== undefined) entry.verdict = status.verdict;
    if (status.lastOutcome !== undefined) entry.lastOutcome = status.lastOutcome;
    return entry;
  });
}

function printStatus(report: SelftestStatusReport): void {
  console.log(report.project);
  if (report.ritual === undefined) console.log("  ritual heartbeat  not seeded");
  else {
    const { ritual } = report;
    console.log(`  ritual heartbeat  ${ritual.lifecycle}  isDue=${String(ritual.isDue)}  nextDue=${ritual.nextDue ?? "-"}`);
  }
  if (report.vigils.length === 0) console.log("  no vigils");
  for (const vigil of report.vigils) {
    const verdict = vigil.state === "closed" ? ` ${vigil.verdict ?? ""}`.trimEnd() : "";
    const flag = vigil.flagged ? " FLAGGED" : "";
    console.log(`  vigil ${vigil.slug.padEnd(16)} ${vigil.state}${verdict}${flag}  last=${vigil.lastOutcome ?? "-"}`);
  }
}

function runStatus(args: ParsedArgs): number {
  const project = currentProject(args);
  const ledger = readLedger(project);
  const report: SelftestStatusReport = { project: project.name, vigils: vigilStatuses(project, ledger) };
  const ritual = ritualStatus(project, ledger);
  if (ritual !== undefined) report.ritual = ritual;
  if (args.json) printJson(report);
  else printStatus(report);
  return 0;
}

// ---------------------------------------------------------------------------
// dispatch
// ---------------------------------------------------------------------------

export const selftestCommand: Command = {
  name: "selftest",
  summary: "seed and drive the darius-selftest project",
  async run(args: ParsedArgs): Promise<number> {
    const verb = args.positional[0];
    switch (verb) {
      case "seed":
        return runSeed(args);
      case "fire":
        return runFire(args);
      case "status":
        return runStatus(args);
      default:
        throw new UsageError(`selftest needs a verb: ${VERBS}`);
    }
  },
};
