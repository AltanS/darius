/**
 * The status the web page shows (docs/concept.md, "App design" > "Web
 * status page"): one read of the local store, computed the same way `darius
 * due`, `run list` and `vigil list` compute theirs. Read-only: nothing here
 * writes, syncs or locks. The sync timer keeps the store fresh.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { ritualState } from "../core/due.ts";
import { collectFindings, findingCounts } from "../core/finding-index.ts";
import { latestHandoff } from "../core/handoff.ts";
import { hostId, linesFor, readLedger } from "../core/ledger.ts";
import { readLegacyMilestoneDetailAt, type LegacyFile } from "../core/legacy-milestone-detail.ts";
import { readLegacyMilestonesAt, type LegacyMilestone } from "../core/legacy-milestones.ts";
import { readLegacyVigilsAt } from "../core/legacy-vigils.ts";
import { linkedDir } from "../core/links.ts";
import { readMarker, type Marker } from "../core/marker.ts";
import { maskSecrets } from "../core/mask-secrets.ts";
import { ritualWarnings } from "../core/reconcile.ts";
import type { Document, JsonValue, LedgerLine, Profile, Ritual, Vigil } from "../core/model.ts";
import { projectDir } from "../core/paths.ts";
import { parseResult, readSummary } from "../core/result.ts";
import { GLOBAL_PROJECT, getBlobText, itemRef, listProjects, openProject, type Project } from "../core/store.ts";
import { lastFailure, localToday, outputTail, plainOutput, readFailKind, vigilStatus } from "../core/sweep.ts";
import { treeDir } from "../core/tree.ts";
import { followUpOf, followUpsOf } from "../runner/follow-up.ts";
import { failedToday, viewRun } from "../runner/run-due.ts";
import { errorMessage } from "../runtime.ts";
import { VERSION } from "../version.ts";
import type {
  Acknowledgement,
  HostStatus,
  MilestoneDetail,
  MilestoneFile,
  MilestoneRow,
  ProfileRow,
  ProjectStatus,
  FollowUpChild,
  RitualDetail,
  RitualRow,
  RunDetail,
  RunResult,
  RunRow,
  VigilDetail,
  VigilRow,
  VigilSweep,
} from "./api.ts";
import { ackKindOf, startedByOf } from "./activity.ts";
import { hostBackupEntries } from "./backups.ts";
import { parseMarkdown } from "./markdown.ts";
import { originOf, readersOf } from "./run-origin.ts";
import { workspaceIconOf } from "./workspace-icon.ts";

export type { HostStatus, ProjectStatus, RitualRow, RunRow, VigilRow } from "./api.ts";

/** How many runs per project `collectStatus()` lists, newest first. */
export const RECENT_RUNS = 20;
const RITUAL_RUNS = 100;

function isRecord(value: JsonValue): value is { readonly [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isText(value: JsonValue | undefined): value is string {
  return typeof value === "string";
}

function isNumber(value: JsonValue | undefined): value is number {
  return typeof value === "number";
}

function text(value: JsonValue | undefined): string | null {
  return isText(value) ? value : null;
}

function textList(value: JsonValue | undefined): string[] {
  return Array.isArray(value) ? value.filter((entry) => isText(entry)) : [];
}

/** Every run in the ledger, newest first, from its `run.*` lines. */
export function runRows(ledger: readonly LedgerLine[]): RunRow[] {
  const byRun = new Map<string, RunRow>();
  for (const line of ledger) {
    const run = text(line.run);
    if (run === null || !line.type.startsWith("run.")) continue;
    let row = byRun.get(run);
    if (row === undefined) {
      row = {
        run,
        item: line.item ?? "?",
        phase: "running",
        outcome: null,
        startedAt: line.at,
        endedAt: null,
        who: line.who,
        questions: [],
        findingsSha: null,
        result: null,
        acknowledged: null,
        followUpOf: null,
        startedBy: startedByOf(line.who),
        ackKind: null,
      };
      byRun.set(run, row);
    }
    if (line.type === "run.started") {
      row.startedBy = startedByOf(line.who);
      row.followUpOf ??= text(line.follow_up_of);
    } else if (line.type === "run.acknowledged") {
      if (row.acknowledged === null) {
        row.acknowledged = { at: line.at, who: line.who, note: text(line.note) };
        row.ackKind = ackKindOf(line);
      }
    } else if (line.type === "run.held") {
      row.phase = "held";
      row.holdFrom = row.questions.length;
      row.questions.push(...textList(line.questions));
    } else if (line.type === "run.resumed") {
      row.phase = "running";
    } else if (line.type === "run.completed") {
      row.phase = "closed";
      row.outcome = text(line.outcome);
      row.endedAt = line.at;
      row.findingsSha = text(line.findings_sha);
      row.result = readSummary(line.result);
    }
  }
  return [...byRun.values()].toSorted((left, right) => right.startedAt.localeCompare(left.startedAt));
}

/** The ritual's run that failed today, with who saw it; null when its latest run did not fail today. */
function failedTodayOf(ledger: readonly LedgerLine[], slug: string, today: string): RitualRow["failedToday"] {
  const run = failedToday(ledger, { slug, today });
  if (run === undefined) return null;
  const seen = viewRun(ledger, run).acknowledged;
  const acknowledged: Acknowledgement | null = seen === undefined ? null : { at: seen.at, who: seen.who, note: seen.note ?? null };
  return { run, acknowledged };
}

/** The v3 marker of the checkout, or null: no checkout, no marker, an older marker, or one that does not parse. */
function v3MarkerAt(checkout: string | null): Marker | null {
  if (checkout === null) return null;
  try {
    const marker = readMarker(checkout);
    return marker !== null && marker.version >= 3 ? marker : null;
  } catch {
    return null;
  }
}

function sourceOf(doc: Document<Ritual>, lifecycle: string, marker: Marker | null): RitualRow["source"] {
  if (doc.header.source === "repo") return "repo";
  if (marker === null || lifecycle === "retired") return null;
  return marker.rituals.some((ritual) => ritual.slug === doc.header.slug) ? null : "unmanaged";
}

function ritualRows(project: Project, ledger: LedgerLine[], now: Date, checkout: string | null): RitualRow[] {
  const today = localToday(now);
  const marker = v3MarkerAt(checkout);
  return project.listItems("ritual").flatMap((slug) => {
    const doc = project.readItem<Ritual>("ritual", slug);
    if (doc === null) return [];
    const state = ritualState(doc, ledger, { now });
    const { header } = doc;
    return [
      {
        slug,
        title: header.title,
        lifecycle: state.lifecycle,
        mode: header.policy.mode,
        cadence: header.cadence ?? null,
        nextDue: state.nextDue ?? null,
        isDue: state.isDue,
        overdueDays: state.overdueDays,
        skill: header.skill ?? null,
        profile: header.policy.profile ?? null,
        host: header.host ?? null,
        lastCompleted: state.lastCompleted ?? null,
        heldRun: state.heldRun ?? null,
        openRun: state.openRun ?? null,
        failedToday: failedTodayOf(ledger, slug, today),
        source: sourceOf(doc, state.lifecycle, marker),
        defCommit: header.def_commit ?? null,
        defHost: header.def_host ?? null,
        defAt: header.def_at ?? null,
        defDirty: header.def_dirty === true,
        at: header.at ?? null,
        zone: header.tz ?? null,
        args: header.args ?? null,
        timeout: header.timeout ?? null,
        nextDueAt: state.nextDueAt ?? null,
        warnings: ritualWarnings(doc, state.lifecycle, marker),
      },
    ];
  });
}

function vigilRowOf(slug: string, doc: Document<Vigil>, lines: readonly LedgerLine[]): VigilRow {
  const status = vigilStatus(slug, lines);
  const failure = status.flagged ? lastFailure(slug, lines, doc.body) : null;
  return {
    slug,
    title: doc.header.title,
    state: status.state,
    verdict: status.verdict ?? null,
    flagged: status.flagged,
    lastOutcome: status.lastOutcome ?? null,
    due: doc.header.due ?? null,
    until: doc.header.until ?? null,
    lastFailure: failure === null ? null : { index: failure.index, text: failure.text, exit: failure.exit, outcome: failure.outcome, at: failure.at, failKind: failure.failKind },
    failKind: status.failKind ?? null,
    paused: status.paused,
    pausedUntil: status.pausedUntil ?? null,
  };
}

function vigilRows(project: Project, ledger: LedgerLine[]): VigilRow[] {
  return project.listItems("vigil").flatMap((slug) => {
    const doc = project.readItem<Vigil>("vigil", slug);
    return doc === null ? [] : [vigilRowOf(slug, doc, linesFor(ledger, `vigil/${slug}`))];
  });
}

/**
 * Vigils that only the legacy tracker holds (phase 3 has not moved them):
 * read from the linked checkout, read-only, and never over a vigil the store has.
 */
function legacyVigilRows(trackerDir: string | null, known: readonly VigilRow[]): VigilRow[] {
  if (trackerDir === null) return [];
  const have = new Set(known.map((vigil) => vigil.slug));
  return readLegacyVigilsAt(trackerDir)
    .filter((vigil) => !have.has(vigil.slug))
    .map((vigil) => {
      const closed = vigil.resolved !== null || vigil.verdict !== null;
      return {
        slug: vigil.slug,
        title: vigil.title,
        state: closed ? "closed" : "armed",
        verdict: vigil.verdict,
        flagged: false,
        lastOutcome: null,
        due: vigil.due,
        until: vigil.until,
        lastFailure: null,
        failKind: null,
        paused: false,
        pausedUntil: null,
        legacy: true,
      };
    });
}

/**
 * The tracker tree the readers use: the store working copy
 * `<state dir>/<project>/tracker` when it exists (a project whose marker lists
 * `milestone`; a host with no checkout still has it), else `<checkout>/.tracker`
 * as before, else null. The store path comes from `treeDir` in
 * src/core/tree.ts, its one definition.
 */
export function trackerDirOf(project: string, checkout: string | null): string | null {
  const stored = treeDir({ root: projectDir(project) });
  if (existsSync(stored)) return stored;
  return checkout === null ? null : join(checkout, ".tracker");
}

function milestoneRow(milestone: LegacyMilestone): MilestoneRow {
  return {
    source: "legacy",
    id: milestone.id,
    label: milestone.id,
    slug: milestone.slug,
    title: milestone.title,
    started: milestone.started,
    target: milestone.target,
    status: milestone.status,
    done: milestone.done,
    total: milestone.total,
    specs: milestone.specs.map((spec) => ({ source: "legacy", ...spec })),
  };
}

/** Milestones of the tracker tree: read from the store working copy or the linked checkout, read-only. */
function legacyMilestones(trackerDir: string | null): Pick<ProjectStatus, "milestones" | "milestonesArchived"> {
  if (trackerDir === null) return { milestones: [], milestonesArchived: 0 };
  const { milestones, archived } = readLegacyMilestonesAt(trackerDir);
  return { milestones: milestones.map(milestoneRow), milestonesArchived: archived };
}

/** A file's text for the page: markdown as blocks, any other text as one code block. */
function milestoneFile(file: LegacyFile): MilestoneFile {
  const content = file.text;
  const body = content === null ? null : file.markdown ? parseMarkdown(content) : [{ kind: "code" as const, text: content }];
  return { path: file.path, size: file.size, modifiedAt: file.modifiedAt, lines: content === null ? 0 : content.split("\n").length, body, omitted: file.omitted };
}

/** One milestone of a project's tracker tree, in full; null when the project, its tree or the milestone is unknown. */
export function milestoneDetail(projectName: string, ref: string): MilestoneDetail | null {
  if (!listProjects().includes(projectName)) return null;
  const trackerDir = trackerDirOf(projectName, linkedDir(projectName) ?? null);
  if (trackerDir === null) return null;
  const detail = readLegacyMilestoneDetailAt(trackerDir, ref);
  if (detail === null) return null;
  const row = milestoneRow(detail.milestone);
  return {
    project: projectName,
    row,
    dir: detail.dir,
    readme: detail.readme === null ? null : milestoneFile(detail.readme),
    specs: detail.specs.map(({ spec, file }) => ({ row: { source: "legacy", ...spec }, file: milestoneFile(file) })),
    others: detail.others.map(milestoneFile),
    worklogs: detail.worklogs.map((worklog) => Object.assign(milestoneFile(worklog), { link: worklog.link, distilledAt: worklog.distilledAt })),
  };
}

/** `last_sync` from the project's `sync.json`; null when the file is missing, unreadable or has no such text. */
export function lastSync(name: string): string | null {
  const file = join(projectDir(name), "sync.json");
  if (!existsSync(file)) return null;
  try {
    const parsed: JsonValue = JSON.parse(readFileSync(file, "utf8"));
    return isRecord(parsed) ? text(parsed.last_sync) : null;
  } catch {
    return null;
  }
}

function projectStatus(name: string, now: Date): ProjectStatus {
  const checkout = linkedDir(name) ?? null;
  const status: ProjectStatus = { name, icon: null, checkout, maxMode: null, lastSync: lastSync(name), rituals: [], runs: [], vigils: [], milestones: [], milestonesArchived: 0, findings: { needsYou: 0, open: 0 }, error: null };
  try {
    const project = openProject(name);
    const ledger = readLedger(project);
    status.rituals = ritualRows(project, ledger, now, checkout);
    status.runs = runRows(ledger).slice(0, RECENT_RUNS);
    status.findings = findingCounts(collectFindings(project, ledger));
    const stored = vigilRows(project, ledger);
    const trackerDir = trackerDirOf(name, checkout);
    status.vigils = [...stored, ...legacyVigilRows(trackerDir, stored)];
    const tracked = legacyMilestones(trackerDir);
    status.milestones = tracked.milestones;
    status.milestonesArchived = tracked.milestonesArchived;
    if (checkout !== null) status.maxMode = readMarker(checkout)?.maxMode ?? null;
    // Last, so a project darius could not read shows no icon. It never throws.
    status.icon = workspaceIconOf(name, checkout);
  } catch (cause) {
    status.error = errorMessage(cause);
  }
  return status;
}

function profiles(): ProfileRow[] {
  if (!existsSync(projectDir(GLOBAL_PROJECT))) return [];
  const project = openProject(GLOBAL_PROJECT);
  return project.listItems("profile").flatMap((name) => {
    const header = project.readItem<Profile>("profile", name)?.header;
    if (header === undefined) return [];
    return [
      {
        name,
        harness: header.harness ?? "claude",
        model: header.model ?? null,
        effort: header.effort ?? null,
        permissions: header.permissions ?? "skip",
        surface: header.surface ?? "headless",
      },
    ];
  });
}

export function collectStatus(now: Date = new Date()): HostStatus {
  const today = localToday(now);
  return {
    host: hostId(),
    version: VERSION,
    generatedAt: now.toISOString(),
    today,
    // `|| 0`: in UTC the negation is -0, and a strict comparison sees -0 as another number.
    utcOffset: -now.getTimezoneOffset() || 0,
    profiles: profiles(),
    projects: listProjects().map((name) => projectStatus(name, now)),
    hosts: hostBackupEntries(hostId(), now.getTime()),
  };
}

/** A run's findings text, or null when the run, its findings or the project is unknown. */
export function runFindings(projectName: string, run: string): { row: RunRow; findings: string | null } | null {
  if (!listProjects().includes(projectName)) return null;
  const project = openProject(projectName);
  const row = runRows(readLedger(project)).find((candidate) => candidate.run === run);
  if (row === undefined) return null;
  return { row, findings: row.findingsSha === null ? null : getBlobText(project, row.findingsSha) };
}

/** One run with its origin, its parsed findings and the follow-ups that came of it; null when the project or the run is unknown. */
export function runDetail(projectName: string, run: string): RunDetail | null {
  if (!listProjects().includes(projectName)) return null;
  const project = openProject(projectName);
  const ledger = readLedger(project);
  const row = runRows(ledger).find((candidate) => candidate.run === run);
  if (row === undefined) return null;
  const findings = row.findingsSha === null ? null : getBlobText(project, row.findingsSha);
  const [itemKind = "", itemSlug = ""] = row.item.split("/");
  const result = runResult(project, ledger, run);
  const rows = runRows(ledger);
  const children = followUpsOf(ledger, run).flatMap((child): FollowUpChild[] => {
    const childRow = rows.find((candidate) => candidate.run === child);
    if (childRow === undefined) return [];
    const started = ledger.find((line) => line.run === child && line.type === "run.started");
    const approved = Array.isArray(started?.approved) ? started.approved.filter((n): n is number => typeof n === "number") : [];
    return [{ row: childRow, approved, items: textList(started?.items), result: runResult(project, ledger, child) }];
  });
  return {
    project: projectName,
    row,
    itemKind,
    itemSlug,
    findings: findings === null ? null : parseMarkdown(findings),
    result,
    followUpOf: followUpOf(ledger, run) ?? null,
    followUps: followUpsOf(ledger, run),
    origin: originOf(ledger, run),
    readBy: readersOf(ledger, run),
    children,
    skillHash: text(ledger.find((line) => line.run === run && line.type === "run.started")?.skill_hash),
  };
}

/** The run's result block, checked again on the way out: a blob from another host is as untrusted as the model. */
function runResult(project: Project, ledger: readonly LedgerLine[], run: string): RunResult | null {
  const completed = ledger.findLast((line) => line.run === run && line.type === "run.completed");
  const sha = text(completed?.result_sha);
  if (sha === null) return null;
  const blob = getBlobText(project, sha);
  if (blob === null) return null;
  const parsed = parseResult(blob);
  return "result" in parsed ? parsed.result : null;
}

/** One ritual with its policy, instructions and runs; null when the project or the ritual is unknown. */
export function ritualDetail(projectName: string, slug: string, now: Date = new Date()): RitualDetail | null {
  if (!listProjects().includes(projectName)) return null;
  const project = openProject(projectName);
  if (!project.listItems("ritual").includes(slug)) return null;
  const doc = project.readItem<Ritual>("ritual", slug);
  if (doc === null) return null;
  const ledger = readLedger(project);
  const row = ritualRows(project, ledger, now, linkedDir(projectName) ?? null).find((candidate) => candidate.slug === slug);
  if (row === undefined) return null;
  const { policy } = doc.header;
  const item = `ritual/${slug}`;
  return {
    project: projectName,
    row,
    anchor: doc.header.anchor,
    policy: {
      mode: policy.mode,
      may: [...policy.may],
      hold: [...policy.hold],
      onHold: policy.on_hold ?? "stop",
      followUpMay: [...(policy.follow_up_may ?? [])],
      followUp: doc.header.follow_up ?? "attended",
      notes: policy.notes ?? null,
      model: policy.model ?? null,
      maxTurns: policy.max_turns ?? null,
      profile: policy.profile ?? null,
    },
    body: parseMarkdown(doc.body),
    runs: runRows(ledger).filter((candidate) => candidate.item === item).slice(0, RITUAL_RUNS),
    handoff: latestHandoff(project, ledger, slug),
  };
}

/** Sweeps the vigil page lists. */
const VIGIL_SWEEPS = 10;

function sweepRow(line: LedgerLine): VigilSweep {
  const checks = Array.isArray(line.checks) ? line.checks : [];
  return {
    at: line.at,
    who: line.who,
    outcome: text(line.outcome),
    failKind: readFailKind(line.fail_kind) ?? null,
    reason: text(line.reason),
    checks: checks.flatMap((check) => (isRecord(check) && isNumber(check.index) && isText(check.outcome) ? [{ index: check.index, outcome: check.outcome, exit: isNumber(check.exit) ? check.exit : null }] : [])),
  };
}

/**
 * One vigil with the check that flagged it and its last sweeps; null when the
 * project or the vigil is unknown. A vigil only the legacy tracker holds has a
 * row and nothing more.
 */
export function vigilDetail(projectName: string, slug: string): VigilDetail | null {
  if (!listProjects().includes(projectName)) return null;
  const project = openProject(projectName);
  const doc = project.readItem<Vigil>("vigil", slug);
  if (doc === null) {
    const legacy = legacyVigilRows(trackerDirOf(projectName, linkedDir(projectName) ?? null), []).find((candidate) => candidate.slug === slug);
    return legacy === undefined ? null : { project: projectName, row: legacy, closedReason: null, pausedReason: null, failure: null, sweeps: [], body: [] };
  }
  const lines = linesFor(readLedger(project), itemRef("vigil", slug));
  const row = vigilRowOf(slug, doc, lines);
  const status = vigilStatus(slug, lines);
  const found = status.flagged ? lastFailure(slug, lines, doc.body) : null;
  const tail = found?.output_sha === undefined ? null : outputTail(project, found.output_sha);
  return {
    project: projectName,
    row,
    closedReason: status.closedReason ?? null,
    pausedReason: status.pausedReason ?? null,
    failure:
      found === null || row.lastFailure === null
        ? null
        : { ...row.lastFailure, command: found.command ?? null, expected: found.expected ?? null, source: found.source, host: found.host, outputTail: tail === null ? null : maskSecrets(plainOutput(tail)) },
    sweeps: lines.filter((line) => line.type === "vigil.swept").map(sweepRow).slice(-VIGIL_SWEEPS).toReversed(),
    body: parseMarkdown(doc.body),
  };
}
