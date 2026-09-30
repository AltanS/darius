/**
 * Demo data for `bun run web:dev --demo`: one host whose project shows every
 * state the pages draw (running, held, asks you, failed, flagged vigil,
 * overdue, dormant), so a design change can be judged without waiting for
 * the real store to be in that state. Times are relative to the request, so
 * "3 min ago" stays true. Run and ritual detail pages are not part of it.
 */

import type { HostStatus, ProjectStatus, RitualRow, RunRow, VigilRow, WebContext } from "../../src/web/api.ts";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

function ago(now: number, ms: number): string {
  return new Date(now - ms).toISOString();
}

function day(now: number, offset: number, shift: number): string {
  return new Date(now + shift * DAY + offset * MINUTE).toISOString().slice(0, 10);
}

const NO_COUNTS = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };

let serial = 0;

function run(now: number, slug: string, phase: RunRow["phase"], outcome: string | null, startedAgo: number, extra: Partial<RunRow> = {}): RunRow {
  serial += 1;
  return {
    run: `01DEMO${String(serial).padStart(20, "0")}`,
    item: `ritual/${slug}`,
    phase,
    outcome,
    startedAt: ago(now, startedAgo),
    endedAt: phase === "closed" ? ago(now, startedAgo - 4 * MINUTE) : null,
    who: "timer",
    questions: [],
    findingsSha: phase === "closed" && outcome === "complete" ? "demo" : null,
    result: null,
    acknowledged: null,
    ...extra,
  };
}

function ritual(slug: string, title: string, extra: Partial<RitualRow> = {}): RitualRow {
  return {
    slug,
    title,
    lifecycle: "active",
    mode: "report",
    cadence: "1d",
    nextDue: null,
    isDue: false,
    overdueDays: 0,
    skill: null,
    profile: null,
    host: null,
    lastCompleted: null,
    heldRun: null,
    openRun: null,
    failedToday: null,
    ...extra,
  };
}

function vigil(slug: string, title: string, extra: Partial<VigilRow> = {}): VigilRow {
  return { slug, title, state: "armed", verdict: null, flagged: false, lastOutcome: null, due: null, until: null, ...extra };
}

function project(now: number): ProjectStatus {
  const running = run(now, "link-check", "running", null, 6 * MINUTE, { who: "timer" });
  const held = run(now, "price-sync", "held", null, 25 * MINUTE, { questions: ["Push the new prices to the live shop?", "Which currency rounds up?"] });
  const asks = run(now, "site-report", "closed", "complete", 5 * 60 * MINUTE, {
    result: { status: "attention", questions: 1, open: { ...NO_COUNTS, high: 2 }, fixed: 3 },
  });
  const failed = run(now, "backup-check", "closed", "failed", 3 * 60 * MINUTE);
  const done = [
    run(now, "link-check", "closed", "complete", 26 * 60 * MINUTE),
    run(now, "site-report", "closed", "complete", 29 * 60 * MINUTE),
    run(now, "price-sync", "closed", "complete", 30 * 60 * MINUTE, { who: "operator" }),
    run(now, "backup-check", "closed", "abandoned", 2 * DAY, { acknowledged: { at: ago(now, 2 * DAY - 30 * MINUTE), who: "operator", note: "disk was full" } }),
  ];
  return {
    name: "demo-shop",
    checkout: "/home/user/projects/demo-shop",
    maxMode: "report",
    lastSync: ago(now, 2 * MINUTE),
    error: null,
    runs: [running, held, asks, failed, ...done],
    rituals: [
      ritual("site-report", "Nightly site report (djinn)", { skill: "site-report", nextDue: day(now, 0, 1) }),
      ritual("link-check", "Link checker (djinn)", { skill: "link-check", cadence: "6h", nextDue: day(now, 0, 0), openRun: running.run }),
      ritual("price-sync", "Price sync (djinn)", { skill: "price-sync", nextDue: day(now, 0, 0), heldRun: held.run }),
      ritual("backup-check", "Backup check", { nextDue: day(now, 0, 1), failedToday: { run: failed.run, acknowledged: null } }),
      ritual("uptime-review", "Uptime review", { mode: "off", cadence: "7d", nextDue: day(now, 0, -9), overdueDays: 9 }),
      ritual("search-ranking", "Search ranking and content review", { mode: "off", cadence: "1w", nextDue: day(now, 0, -3), overdueDays: 3 }),
      ritual("promo-freshness", "Promo page freshness", { mode: "off", cadence: "3d", nextDue: day(now, 0, 0), isDue: true }),
      ritual("quarterly-audit", "Quarterly audit", { mode: "off", cadence: "3m", nextDue: day(now, 0, 40) }),
      ritual("old-cleanup", "Old cleanup", { mode: "off", lifecycle: "retired" }),
    ],
    vigils: [
      vigil("guard-soak", "Guard soak after the checkout release", { due: day(now, 0, 3), until: "the first real order batch" }),
      vigil("cache-flip", "Cache flip is stable", { flagged: true, lastOutcome: "failed", due: day(now, 0, -1) }),
      vigil("old-soak", "Search index soak", { state: "closed", verdict: "held", lastOutcome: "held" }),
    ],
  };
}

export function demoStatus(now: number = Date.now()): HostStatus {
  return {
    host: "demo",
    version: "demo",
    generatedAt: new Date(now).toISOString(),
    today: new Date(now - new Date(now).getTimezoneOffset() * MINUTE).toISOString().slice(0, 10),
    utcOffset: -new Date(now).getTimezoneOffset(),
    profiles: [],
    projects: [project(now)],
  };
}

/** The real context with the demo status; run and ritual detail pages answer 404. */
export function demoContext(base: WebContext): WebContext {
  return { ...base, status: () => demoStatus(), ritual: () => null, run: () => null };
}
