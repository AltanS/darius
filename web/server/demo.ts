/**
 * Demo data for `bun run web:dev --demo`: one host whose project shows every
 * state the pages draw (running, held, asks you, failed, flagged vigil,
 * overdue, dormant, no schedule, dated and event-waiting vigils), so a design change can be judged without waiting for
 * the real store to be in that state. A second, quieter project (atlas-docs)
 * gives the home page a cross-project view. Times are relative to the
 * request, so "3 min ago" stays true. Run and ritual detail pages are not
 * part of it; the milestone detail page is, for M12 of demo-shop.
 */

import type { BackupRow, BackupsStatus, HostStatus, MilestoneDetail, MilestoneFile, MilestoneRow, ProjectStatus, RitualRow, RunRow, SpecRow, SystemStatus, VigilRow, WebContext } from "../../src/web/api.ts";
import { parseMarkdown } from "../../src/web/markdown.ts";

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

function spec(milestoneId: string, number: number, title: string, done: number, total: number, extra: Partial<SpecRow> = {}): SpecRow {
  const label = `${milestoneId}/${String(number).padStart(2, "0")}`;
  const state = done === 0 ? "Not Started" : done === total ? "Complete" : "In Progress";
  const verified = done === total && total > 0;
  return {
    source: "legacy",
    slug: `${milestoneId.toLowerCase()}-${String(number).padStart(2, "0")}-${title.toLowerCase().replaceAll(" ", "-")}`,
    label,
    number,
    title,
    status: state,
    done,
    total,
    verified,
    verifiedAt: verified ? "2026-09-20T09:30:00.000Z" : null,
    dependsOn: [],
    ...extra,
  };
}

function milestoneRow(id: string, title: string, status: string, specs: SpecRow[], extra: Partial<MilestoneRow> = {}): MilestoneRow {
  const slug = title.toLowerCase().replaceAll(" ", "-");
  const done = specs.reduce((sum, row) => sum + row.done, 0);
  const total = specs.reduce((sum, row) => sum + row.total, 0);
  return { source: "legacy", id, label: id, slug, title, started: "2026-09-01", target: null, status, done, total, specs, ...extra };
}

/** Milestones in every state: in progress with a waiting spec, not started, complete, and one the owner closed. */
function milestones(): MilestoneRow[] {
  const cart = spec("M12", 2, "Cart totals use the shop tax rules", 0, 4, { dependsOn: ["m12-01-cart-keeps-items-between-visits"], status: "Waiting" });
  return [
    milestoneRow("M12", "Cart survives a page reload", "In Progress", [spec("M12", 1, "Cart keeps items between visits", 6, 6), cart, spec("M12", 3, "Cart shows the free shipping bar", 1, 5)], {
      target: "2026-10-15",
    }),
    milestoneRow("M14", "Product search finds typos", "Not Started", [spec("M14", 1, "Search ignores one typo", 0, 3), spec("M14", 2, "Search explains an empty result", 0, 2)]),
    milestoneRow("M9", "Checkout mail is reliable", "Complete", [spec("M9", 1, "Order mail has one sender", 4, 4), spec("M9", 2, "Order mail retries on error", 5, 5)], { started: "2026-08-10", target: "2026-09-10" }),
    milestoneRow("M11", "Old theme cleanup", "Closed", [spec("M11", 1, "Remove the old theme files", 1, 3)], { started: "2026-07-01" }),
  ].toSorted((left, right) => Number.parseInt(left.id.slice(1), 10) - Number.parseInt(right.id.slice(1), 10));
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
    milestones: milestones(),
    milestonesArchived: 41,
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
    milestones: [],
    milestonesArchived: 0,
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

function demoFile(now: number, path: string, text: string, changedAgo: number): MilestoneFile {
  const markdown = path.endsWith(".md");
  return {
    path,
    size: new TextEncoder().encode(text).length,
    modifiedAt: ago(now, changedAgo),
    lines: text.split("\n").length,
    body: markdown ? parseMarkdown(text) : [{ kind: "code", text }],
    omitted: null,
  };
}

const M12_README = `# Cart survives a page reload

## Goal

A shopper who reloads the page, or comes back the next day, finds the same cart.

## Scope

- Keep the cart in the browser and on the server
- Totals follow the shop tax rules
- The free shipping bar shows how much is left

## Out of scope

- Saved carts across devices without a login
`;

const M12_SPECS: readonly string[] = [
  `# Cart keeps items between visits

## Tasks

- [x] Store the cart id in a first-party cookie
- [x] Load the cart on the server for every page
  - Command: \`npm test -- cart-load\`
- [x] Merge a guest cart into the account cart at login
- [x] Drop items that went out of stock, and say so
- [x] Keep quantities within the stock
- [x] Write the reload test

## Verification

\`\`\`
npm test -- cart
npx playwright test cart-reload.spec.ts
\`\`\`
`,
  `# Cart totals use the shop tax rules

Depends on the cart load from M12/01.

- [ ] Read the tax rate per country from the shop settings
- [ ] Round per line, then sum, as the tax office asks
- [~] Show net and gross on the cart page
- [ ] Test a mixed cart with two tax rates

| Country | Rate |
|---|---|
| DE | 19 % |
| AT | 20 % |
`,
  `# Cart shows the free shipping bar

- [x] Read the threshold from the shop settings
- [ ] Draw the bar under the cart total
- [!] The designer has not sent the final colours
- [ ] Hide the bar once the threshold is met
- [-] Animate the bar (dropped: too distracting)
`,
];

/** M12 of demo-shop in full: README, three specs, two worklogs (one distilled), a note and an image. */
function demoMilestone(now: number): MilestoneDetail {
  const row = milestones().find((candidate) => candidate.id === "M12");
  if (row === undefined) throw new Error("demo: M12 is missing");
  const files = ["01-cart-keeps-items-between-visits.md", "02-cart-totals-use-the-shop-tax-rules.md", "03-cart-shows-the-free-shipping-bar.md"];
  return {
    project: "demo-shop",
    row,
    dir: "M12-cart-survives-a-page-reload",
    readme: demoFile(now, "00-README.md", M12_README, 9 * DAY),
    specs: row.specs.map((specRow, index) => ({ row: specRow, file: demoFile(now, files[index] ?? "spec.md", M12_SPECS[index] ?? "", (index + 1) * DAY) })),
    others: [
      demoFile(now, "_notes/tax-questions.md", "# Open tax questions\n\n- Does a gift card carry tax?\n- Which rate applies to a bundle?\n", 3 * DAY),
      { path: "_notes/cart-sketch.png", size: 48_213, modifiedAt: ago(now, 6 * DAY), lines: 0, body: null, omitted: "binary" },
    ],
    worklogs: [
      {
        ...demoFile(now, "M12-cart-survives-a-page-reload.md", "## Tax rounding\n\n<!-- opened: 2026-09-20T10:00:00Z -->\n\n- 2026-09-20: the shop rounds per line; the old code rounded the sum.\n- 2026-09-21: **decided** to round per line, as the tax office asks.\n", 2 * 60 * MINUTE),
        link: "name",
        distilledAt: null,
      },
      {
        ...demoFile(now, "2026-09-02-cart-cookie-spike.md", "<!-- distilled: 2026-09-15T08:00:00Z source-sha256: 0000000000000000000000000000000000000000000000000000000000000000 raw: archive/worklog-raw/2026-09-02-cart-cookie-spike.md -->\n\n# Cart cookie spike (distilled)\n\nA first-party cookie with the cart id is enough; no local storage.\n", 15 * DAY),
        link: "spec",
        distilledAt: "2026-09-15T08:00:00Z",
      },
    ],
  };
}

/** Fake machine and store numbers: two hosts, three projects, generic names. */
function demoSystem(now: number): SystemStatus {
  const back = (ms: number): string => new Date(now - ms).toISOString();
  const GB = 1024 ** 3;
  return {
    host: "host-a",
    version: "0.44.0",
    runtime: "bun 1.3.0",
    platform: "linux x64",
    generatedAt: new Date(now).toISOString(),
    uptimeSeconds: 12 * 86_400 + 3 * 3600,
    load: [0.42, 0.31, 0.27],
    memory: { totalBytes: 16 * GB, freeBytes: 6 * GB },
    disks: [
      { label: "store", path: "/home/user/.local/share/darius", freeBytes: 210 * GB, totalBytes: 500 * GB },
      { label: "backups", path: "/home/user/.local/share/darius-backup", freeBytes: 800 * GB, totalBytes: 2000 * GB },
    ],
    store: { path: "/home/user/.local/share/darius", bytes: 48 * 1024 * 1024, files: 1520, projects: 3, rituals: 7, vigils: 2, profiles: 3, runs: 214, milestones: 4, specs: 19 },
    hosts: [
      { host: "host-a", self: true, lastSeen: back(60_000), chunks: 41, projects: ["project-one", "project-three", "project-two"] },
      { host: "host-b", self: false, lastSeen: back(3 * 3600_000), chunks: 17, projects: ["project-one", "project-two"] },
    ],
    projects: [
      { project: "project-one", lastSync: back(5 * 60_000), rituals: 4, vigils: 1, profiles: 2, runs: 150, bytes: 30 * 1024 * 1024 },
      { project: "project-three", lastSync: null, rituals: 1, vigils: 0, profiles: 0, runs: 9, bytes: 2 * 1024 * 1024 },
      { project: "project-two", lastSync: back(2 * 3600_000), rituals: 2, vigils: 1, profiles: 1, runs: 55, bytes: 16 * 1024 * 1024 },
    ],
    syncRemote: { endpoint: "https://s3.example.com", bucket: "darius-state" },
  };
}

const sha = (seed: string): string => seed.repeat(64).slice(0, 64);

/** Fake snapshots of host-a: five files, three also in the bucket, one setting set by the environment. */
function demoBackups(clock: number): BackupsStatus {
  // Steady between two reads, so the page sees the same last run until a real run changes it.
  const now = clock - (clock % 600_000);
  const back = (ms: number): string => new Date(now - ms).toISOString();
  const MIB = 1024 * 1024;
  const row = (hoursAgo: number, mib: number, files: number | null, hash: string | null, local: boolean, remote: boolean): BackupRow => {
    const at = back(hoursAgo * 3600_000);
    const stamp = `${at.replaceAll(/[-:]/gu, "").slice(0, 15)}Z`;
    return { name: `darius-host-a-${stamp}.tar.gz`, at, bytes: mib * MIB, files, sha256: hash, local, remote };
  };
  const snapshots = [row(3, 412, 1520, sha("3f9a"), true, true), row(27, 398, 1498, sha("b01c"), true, true), row(51, 371, 1450, sha("7d2e"), true, true), row(75, 120, 980, sha("c4a8"), true, false), row(99, 15, null, null, false, true)];
  return {
    generatedAt: new Date(now).toISOString(),
    host: "host-a",
    settings: {
      enabled: { value: true, source: "file" },
      dir: { value: "~/.local/share/darius-backup", source: "default" },
      keep: { value: 7, source: "config" },
      keepRemote: { value: 14, source: "default" },
      endpoint: { value: "https://s3.example.com", source: "env" },
      bucket: { value: "darius-backups", source: "file" },
      region: { value: "us-east-1", source: "default" },
      prefix: { value: "host-a/", source: "file" },
      pathStyle: { value: true, source: "default" },
      allowHttp: { value: false, source: "default" },
      sse: { value: false, source: "default" },
    },
    problems: [],
    credentials: "file",
    remoteConfigured: true,
    running: null,
    last: { at: back(3 * 3600_000), ok: true, name: snapshots[0]?.name ?? null, error: null },
    remote: { at: back(3 * 3600_000), ok: true, error: null, count: 4 },
    snapshots,
    localBytes: (412 + 398 + 371 + 120) * MIB,
    storePath: "/home/user/.local/share/darius",
    envFile: "/home/user/.config/darius/web.env",
  };
}

/** The real context with the demo status; run and ritual detail pages answer 404, and only M12 of demo-shop has a detail page. */
export function demoContext(base: WebContext): WebContext {
  return {
    ...base,
    status: () => demoStatus(),
    ritual: () => null,
    run: () => null,
    milestone: (name, milestone) => (name === "demo-shop" && milestone.toUpperCase() === "M12" ? demoMilestone(Date.now()) : null),
    system: () => demoSystem(Date.now()),
    backups: () => demoBackups(Date.now()),
  };
}
