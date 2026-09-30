/**
 * Demo data for `bun run web:dev --demo`: one host whose project shows every
 * state the pages draw (running, held, asks you, failed, flagged vigil,
 * overdue, dormant, no schedule, dated and event-waiting vigils), so a design change can be judged without waiting for
 * the real store to be in that state. A second, quieter project (atlas-docs)
 * gives the home page a cross-project view. Times are relative to the
 * request, so "3 min ago" stays true. Run and ritual detail pages are not
 * part of it.
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
      ritual("backup-check", "Backup check (djinn)", { skill: "backup-check", nextDue: day(now, 0, 1), failedToday: { run: failed.run, acknowledged: null } }),
      ritual("uptime-review", "Uptime review", { mode: "off", cadence: "7d", nextDue: day(now, 0, -9), overdueDays: 9, lastCompleted: day(now, 0, -16) }),
      ritual("search-ranking", "Search ranking and content review", { mode: "off", cadence: "1w", nextDue: day(now, 0, -3), overdueDays: 3, lastCompleted: day(now, 0, -10) }),
      ritual("shipping-rates", "Shipping rates check", { mode: "off", cadence: "3d", nextDue: day(now, 0, -5), overdueDays: 5, lastCompleted: day(now, 0, -8) }),
      ritual("promo-freshness", "Promo page freshness", { mode: "off", cadence: "3d", nextDue: day(now, 0, 0), isDue: true, lastCompleted: day(now, 0, -3) }),
      ritual("a11y-spot-check", "Accessibility spot check", { mode: "off", cadence: "1w", nextDue: day(now, 0, 3), lastCompleted: day(now, 0, -4) }),
      ritual("currency-audit", "Currency rounding audit", { mode: "off", cadence: "2w", nextDue: day(now, 0, 6), lastCompleted: day(now, 0, -8) }),
      ritual("quarterly-audit", "Quarterly audit", { mode: "off", cadence: "3m", nextDue: day(now, 0, 40), lastCompleted: day(now, 0, -50) }),
      ritual("vendor-review", "Vendor contract review", { mode: "off", cadence: null, lastCompleted: day(now, 0, -70) }),
      ritual("old-cleanup", "Old cleanup", { mode: "off", lifecycle: "retired" }),
    ],
    vigils: [
      vigil("guard-soak", "Guard soak after the checkout release", { due: day(now, 0, 3), until: "the first real order batch" }),
      vigil("cache-flip", "Cache flip is stable", { flagged: true, lastOutcome: "failed", due: day(now, 0, -1) }),
      vigil("coupon-sync", "Coupon export stays in sync with the shop", { due: day(now, 0, 0), until: "the next full catalogue import finishes" }),
      vigil("cert-window", "Certificate renewal went through", { due: day(now, 0, 60) }),
      vigil("checkout-latency", "Checkout latency stays under the budget after the payment provider change", { until: "the first Monday peak after the new payment provider is live, or 14 days of traffic logs, whichever comes first" }),
      vigil("sitemap-diff", "Sitemap lists every published product page", { until: "the next product import that adds at least 200 pages, then one crawl of the sitemap against the catalogue" }),
      vigil("stock-alert", "Low-stock alert e-mails reach the warehouse inbox", { until: "the first product that drops below its stock threshold after the alert rule change ships" }),
      vigil("search-synonyms", "Search synonyms do not hide products", { until: "one week of search logs after the synonym list was replaced, checked against zero-result queries" }),
      vigil("image-cdn", "Image CDN serves the new WebP variants", { until: "the next cache purge of the product image path completes and the edge hit rate settles above 90 percent" }),
      vigil("returns-form", "Returns form sends its confirmation mail", { until: "the first customer return that uses the new form, with the confirmation mail found in the outbound log" }),
      vigil("bot-rules", "Bot filter does not block the payment webhook", { flagged: true, lastOutcome: "failed", until: "the next scheduled webhook delivery from the payment provider after the firewall rule update" }),
      vigil("old-soak", "Search index soak", { state: "closed", verdict: "held", lastOutcome: "held" }),
    ],
  };
}

/** A second project: a running djinn, one that did not start, a djinn that finished last night, and a late manual ritual. */
function atlas(now: number): ProjectStatus {
  const running = run(now, "link-audit", "running", null, 3 * MINUTE);
  const done = run(now, "release-notes", "closed", "complete", 9 * 60 * MINUTE);
  return {
    name: "atlas-docs",
    checkout: "/home/user/projects/atlas-docs",
    maxMode: "report",
    lastSync: ago(now, 14 * MINUTE),
    error: null,
    runs: [running, done],
    rituals: [
      ritual("link-audit", "Docs link audit (djinn)", { skill: "link-audit", cadence: "6h", nextDue: day(now, 0, 0), openRun: running.run }),
      ritual("release-notes", "Release notes draft (djinn)", { skill: "release-notes", nextDue: day(now, 0, 2) }),
      ritual("sitemap-check", "Sitemap check (djinn)", { skill: "sitemap-check", nextDue: day(now, 0, -2), isDue: true, overdueDays: 2 }),
      ritual("changelog-digest", "Changelog digest (djinn)", { skill: "changelog-digest", nextDue: day(now, 0, 0), isDue: true }),
      ritual("dependency-review", "Dependency review", { mode: "off", cadence: "2w", nextDue: day(now, 0, -14), overdueDays: 14 }),
      ritual("style-guide", "Style guide pass", { mode: "off", cadence: "1m", nextDue: day(now, 0, 12) }),
    ],
    vigils: [],
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
    projects: [project(now), atlas(now)],
  };
}

/** The real context with the demo status; run and ritual detail pages answer 404. */
export function demoContext(base: WebContext): WebContext {
  return { ...base, status: () => demoStatus(), ritual: () => null, run: () => null };
}
