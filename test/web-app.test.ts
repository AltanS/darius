/**
 * The committed web app build (web/build/server/index.js): every page
 * renders through the WebHandler with a fake WebContext built from
 * literals, every inline script carries the nonce, store text stays text,
 * unknown items answer 404 and the 0.9 run URL redirects. The handler must
 * load under Node and Bun, so run this file under both:
 *   node --no-warnings --test test/web-app.test.ts
 *   bun test test/web-app.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Acknowledgement, BackupsStatus, FindingRow, FollowUpReadiness, HostStatus, MilestoneDetail, RitualDetail, RunDetail, RunResult, RunResultSummary, RunRow, SystemStatus, WebContext, WebHandler } from "../src/web/api.ts";

const SANDBOX = mkdtempSync(join(tmpdir(), "darius-web-app-"));
process.env.DARIUS_STATE_DIR = join(SANDBOX, "state");
process.env.DARIUS_CONFIG_DIR = join(SANDBOX, "config");

const built: { default: WebHandler } = await import("../web/build/server/index.js");
const handler = built.default;

const NONCE = "bm9uY2Utb2YtdGhlLXRlc3Q=";
const DONE = "01KAAAAAAAAAAAAAAAAAAAAAAA";
const HELD = "01KBBBBBBBBBBBBBBBBBBBBBBB";
const FAILED = "01KCCCCCCCCCCCCCCCCCCCCCCC";
const EVIL = "<script>alert(1)</script>";

function runRow(run: string, phase: RunRow["phase"], outcome: string | null): RunRow {
  return {
    run,
    item: "ritual/daily-report",
    phase,
    outcome,
    startedAt: "2026-09-28T08:00:00.000Z",
    endedAt: phase === "closed" ? "2026-09-28T08:04:30.000Z" : null,
    who: "timer",
    questions: phase === "held" ? [`may I push ${EVIL}?`, "which branch?"] : [],
    findingsSha: phase === "closed" ? "abc" : null,
    result: null,
    acknowledged: null,
  };
}

const RUNS: RunRow[] = [runRow(HELD, "held", null), runRow(FAILED, "closed", "failed"), runRow(DONE, "closed", "complete")];

const STATUS: HostStatus = {
  host: "testhost",
  version: "9.9.9",
  generatedAt: "2026-09-28T09:00:00.000Z",
  today: "2026-09-28",
  utcOffset: 120,
  profiles: [{ name: "careful", harness: "claude", model: "opus", effort: "high", permissions: "gated", surface: "headless" }],
  projects: [
    {
      name: "demo",
      checkout: "/home/test/demo",
      maxMode: "report",
      lastSync: "2026-09-28T08:55:00.000Z",
      rituals: [
        {
          slug: "daily-report",
          title: `Daily ${EVIL} report`,
          lifecycle: "active",
          mode: "report",
          cadence: "1d",
          nextDue: "2026-09-27",
          isDue: false,
          overdueDays: 1,
          skill: "daily-report",
          profile: "careful",
          lastCompleted: "2026-09-26",
          heldRun: HELD,
          openRun: null,
          failedToday: null,
          host: null,
          source: null,
          defCommit: null,
          defHost: null,
          defAt: null,
          defDirty: false,
          at: null,
          zone: null,
          args: null,
          timeout: null,
          nextDueAt: null,
          warnings: [],
        },
      ],
      runs: RUNS,
      vigils: [{ slug: "soak", title: "Guard soak", state: "open", verdict: null, flagged: true, lastOutcome: "failed", due: "2026-10-01", until: null }],
      milestones: [
        {
          source: "legacy",
          id: "M7",
          label: "M7",
          slug: "cart",
          title: `Cart ${EVIL} survives`,
          started: "2026-09-01",
          target: "2026-09-10",
          status: "In Progress",
          done: 7,
          total: 10,
          specs: [
            { source: "legacy", slug: "m7-01-keep", label: "M7/01", number: 1, title: "Keep items", status: "Complete", done: 6, total: 6, verified: false, verifiedAt: null, dependsOn: [] },
            { source: "legacy", slug: "m7-02-tax", label: "M7/02", number: 2, title: "Tax rules", status: "Waiting", done: 1, total: 4, verified: false, verifiedAt: null, dependsOn: ["m7-01-keep"] },
          ],
        },
      ],
      milestonesArchived: 3,
      findings: { needsYou: 2, open: 3 },
      error: null,
    },
  ],
};

function finding(key: string, extra: Partial<FindingRow>): FindingRow {
  return {
    project: "demo",
    ritual: "daily-report",
    key,
    auto: false,
    title: `Finding ${key}`,
    severity: "medium",
    state: "open",
    firstSeen: { run: DONE, at: "2026-09-26T08:00:00.000Z" },
    lastSeen: { run: DONE, at: "2026-09-28T08:00:00.000Z" },
    runs: 2,
    history: [
      { run: DONE, at: "2026-09-26T08:00:00.000Z", state: "open", severity: "medium" },
      { run: HELD, at: "2026-09-28T08:00:00.000Z", state: "open", severity: "medium" },
    ],
    stale: false,
    reopened: false,
    status: "open",
    ...extra,
  };
}

const FINDINGS: FindingRow[] = [
  finding("link-12", { title: `Broken ${EVIL} link`, severity: "high", state: "needs-code", status: "needs-you", group: "site-a", target: "page 12", detail: `Seen twice ${EVIL}`, reopened: true }),
  finding("tax-1", { title: "Tax rate missing", severity: "critical", state: "needs-decision", status: "needs-you" }),
  finding("banner-3", { title: "Old banner", severity: "medium" }),
  finding("feed-9", { title: "Old feed", severity: "low", stale: true }),
  finding("shut-1", { title: "Shut thing", status: "closed", closed: { at: "2026-09-27T08:00:00.000Z", who: "op", note: "known", severity: "medium" } }),
  finding("done-1", { title: "Done thing", state: "fixed", status: "fixed" }),
];

const RITUAL: RitualDetail = {
  project: "demo",
  row: STATUS.projects[0]!.rituals[0]!,
  anchor: "due",
  policy: { mode: "report", may: ["git fetch"], hold: ["git push"], onHold: "stop", notes: "Be brief.", model: null, maxTurns: 40, profile: "careful" },
  body: [
    { kind: "heading", level: 1, content: [{ kind: "text", text: "Steps" }] },
    { kind: "list", ordered: true, start: 1, items: [[{ kind: "text", text: "Read the log" }], [{ kind: "code", text: "darius due" }]] },
  ],
  runs: RUNS,
  handoff: null,
};

const MILESTONE_ROW = STATUS.projects[0]!.milestones[0]!;

const MILESTONE: MilestoneDetail = {
  project: "demo",
  row: MILESTONE_ROW,
  dir: "M7-cart",
  readme: {
    path: "00-README.md",
    size: 120,
    modifiedAt: "2026-09-20T08:00:00.000Z",
    lines: 5,
    body: [
      { kind: "heading", level: 1, content: [{ kind: "text", text: "The cart" }] },
      { kind: "paragraph", lines: [[{ kind: "text", text: `Readme ${EVIL} goal` }]] },
    ],
    omitted: null,
  },
  specs: [
    {
      row: MILESTONE_ROW.specs[0]!,
      file: {
        path: "01-keep.md",
        size: 80,
        modifiedAt: "2026-09-21T08:00:00.000Z",
        lines: 6,
        body: [{ kind: "list", ordered: false, start: 1, items: [[{ kind: "text", text: "Keep the cart id" }], [{ kind: "text", text: "Reload test" }]], checks: ["done", "open"] }],
        omitted: null,
      },
    },
    {
      row: MILESTONE_ROW.specs[1]!,
      file: { path: "02-tax.md", size: 9000, modifiedAt: "2026-09-22T08:00:00.000Z", lines: 300, body: [{ kind: "paragraph", lines: [[{ kind: "text", text: "Tax spec text" }]] }], omitted: null },
    },
  ],
  others: [{ path: "art/sketch.png", size: 48213, modifiedAt: "2026-09-19T08:00:00.000Z", lines: 0, body: null, omitted: "binary" }],
  worklogs: [
    {
      path: "M7-cart.md",
      size: 2048,
      modifiedAt: "2026-09-27T08:00:00.000Z",
      lines: 4,
      body: [{ kind: "paragraph", lines: [[{ kind: "text", text: "Worklog stub text" }]] }],
      omitted: null,
      link: "name",
      distilledAt: "2026-09-25T08:00:00Z",
    },
  ],
};

function runDetail(row: RunRow, result: RunResult | null = null): RunDetail {
  return {
    project: "demo",
    result,
    row,
    itemKind: "ritual",
    itemSlug: "daily-report",
    events: [
      { at: row.startedAt, who: "timer", type: "run.started", detail: null },
      { at: row.startedAt, who: "claude:x", type: "run.completed", detail: row.outcome },
    ],
    findings:
      row.findingsSha === null
        ? null
        : [
            { kind: "heading", level: 2, content: [{ kind: "text", text: "Findings heading" }] },
            { kind: "paragraph", lines: [[{ kind: "text", text: `store text ${EVIL} & more` }, { kind: "bold", text: "bold" }]] },
            { kind: "table", head: [[{ kind: "text", text: "Site" }], [{ kind: "text", text: "Visits" }]], rows: [[[{ kind: "text", text: "site-a" }], [{ kind: "text", text: "2281" }]]] },
            { kind: "list", ordered: true, start: 3, items: [[{ kind: "text", text: "third" }]] },
            { kind: "code", text: "echo </pre><script>x</script>" },
          ],
    followUpOf: null,
    followUps: [],
    skillHash: null,
  };
}

const SECRET = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";

const SYSTEM: SystemStatus = {
  host: "testhost",
  version: "9.9.9",
  runtime: "bun 1.3.0",
  platform: "linux x64",
  generatedAt: "2026-09-28T09:00:00.000Z",
  uptimeSeconds: 90_000,
  load: [0.5, 0.4, 0.3],
  memory: { totalBytes: 8 * 1024 ** 3, freeBytes: 3 * 1024 ** 3 },
  disks: [{ label: "store", path: "/home/test/.local/share/darius", freeBytes: 100 * 1024 ** 3, totalBytes: 200 * 1024 ** 3 }],
  store: { path: "/home/test/.local/share/darius", bytes: 5 * 1024 ** 2, files: 90, projects: 1, rituals: 1, vigils: 1, profiles: 1, runs: 3, milestones: 1, specs: 2 },
  hosts: [
    { host: "testhost", self: true, lastSeen: "2026-09-28T08:59:00.000Z", chunks: 4, projects: ["demo"] },
    { host: "other-host", self: false, lastSeen: null, chunks: 0, projects: [] },
  ],
  projects: [{ project: "demo", lastSync: "2026-09-28T08:55:00.000Z", rituals: 1, vigils: 1, profiles: 1, runs: 3, bytes: 1024 ** 2 }],
  syncRemote: { endpoint: "https://sync.example.com", bucket: "sync-bucket" },
};

const BACKUPS: BackupsStatus = {
  generatedAt: "2026-09-28T09:00:00.000Z",
  host: "testhost",
  settings: {
    enabled: { value: true, source: "file" },
    dir: { value: "~/backups", source: "default" },
    keep: { value: 7, source: "default" },
    keepRemote: { value: 14, source: "default" },
    endpoint: { value: "https://s3.example.com", source: "env" },
    bucket: { value: "darius-backups", source: "file" },
    region: { value: "us-east-1", source: "default" },
    prefix: { value: "", source: "default" },
    pathStyle: { value: true, source: "default" },
    allowHttp: { value: false, source: "default" },
    sse: { value: false, source: "default" },
  },
  problems: [`the folder is not writable ${EVIL}`],
  credentials: "file",
  remoteConfigured: true,
  running: null,
  last: { at: "2026-09-28T07:00:00.000Z", ok: true, name: "darius-testhost-20260928T070000Z.tar.gz", error: null },
  remote: { at: "2026-09-28T07:00:10.000Z", ok: true, error: null, count: 2 },
  snapshots: [
    { name: "darius-testhost-20260928T070000Z.tar.gz", at: "2026-09-28T07:00:00.000Z", bytes: 52_428_800, files: 90, sha256: "ab".repeat(32), local: true, remote: true },
    { name: "darius-testhost-20260927T070000Z.tar.gz", at: "2026-09-27T07:00:00.000Z", bytes: 1024, files: null, sha256: null, local: false, remote: true },
  ],
  localBytes: 52_428_800,
  storePath: "/home/test/.local/share/darius",
  envFile: "/home/test/.config/darius/web.env",
};

const context: WebContext = {
  viewer: "owner on phone",
  nonce: NONCE,
  status: () => STATUS,
  ritual: (project, slug) => (project === "demo" && slug === "daily-report" ? RITUAL : null),
  run: (project, run) => {
    const row = project === "demo" ? RUNS.find((candidate) => candidate.run === run) : undefined;
    return row === undefined ? null : runDetail(row);
  },
  milestone: (project, milestone) => (project === "demo" && milestone.toUpperCase() === "M7" ? MILESTONE : null),
  system: () => SYSTEM,
  backups: () => BACKUPS,
  findings: () => Promise.resolve(FINDINGS),
  followUp: () => Promise.resolve({ ready: false, host: "host-a", reason: "no follow-up in this fake" }),
};

async function get(path: string): Promise<{ status: number; body: string; headers: Headers }> {
  const response = await handler(new Request(`http://darius.test${path}`), context);
  return { status: response.status, body: await response.text(), headers: response.headers };
}

function assertScriptsCarryNonce(body: string, path: string): void {
  const tags = body.match(/<script\b[^>]*>/gu) ?? [];
  assert.ok(tags.length > 0, `${path}: the page hydrates`);
  for (const tag of tags) assert.ok(tag.includes(`nonce="${NONCE}"`), `${path}: ${tag}`);
  assert.equal(/\sstyle="/u.test(body), false, `${path}: no inline style attribute`);
  assert.equal(/(?:src|href)="(?:https?:)?\/\//u.test(body), false, `${path}: no external URL`);
}

const PAGES: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["/all", ["Two things need you.", "Needs you", `darius run answer ${HELD} 1 &quot;your answer&quot; --project demo`, `darius run answer ${HELD} 2`, "Guard soak", "seen by", "owner on phone", "testhost"]],
  ["/findings", ["Findings", "Findings that need you of every project, worst first.", "needs you (2)", "open (4)", "all (6)", "Broken &lt;script&gt;alert(1)&lt;/script&gt; link", "Tax rate missing", "needs code", "reopened", `/w/demo/runs/${DONE}`, "Detail and history", "Close"]],
  ["/w/demo/findings", ["Findings", "Findings that need you in demo, worst first.", "Tax rate missing"]],
  ["/runs", ["Runs", `/w/demo/runs/${DONE}`, `/w/demo/runs/${FAILED}`, "Failed", "Complete"]],
  ["/w/demo/runs?state=failed", [`/w/demo/runs/${FAILED}`]],
  ["/w/demo/runs", ["Runs", `/w/demo/runs/${DONE}`, "All runs in demo, newest first."]],
  ["/w/demo/milestones", ["Milestones", "In progress", "M7", "7 of 10 checks done", "<details", "M7/01", "6 of 6 checks", "M7/02", "Waiting", "depends on M7/01", "target 10 Sep, past", "3 archived", "Cart &lt;script&gt;alert(1)&lt;/script&gt; survives", 'href="/w/demo/milestones/M7"']],
  [
    "/w/demo/milestones/M7",
    [
      "Cart &lt;script&gt;alert(1)&lt;/script&gt; survives",
      "In progress",
      "target 10 Sep, past",
      "7 of 10 checks done",
      ".tracker/M7-cart/",
      "README",
      "Readme &lt;script&gt;alert(1)&lt;/script&gt; goal",
      "Specs (2)",
      "M7/01",
      "Keep the cart id",
      "md-box-done",
      'aria-label="Open"',
      "depends on M7/01",
      "Tax spec text",
      "Worklogs (1)",
      "M7-cart.md",
      "2.0 KB",
      "distilled 2026-09-25",
      "Worklog stub text",
      "Other files (1)",
      "art/sketch.png",
      "not text, not shown",
      'href="#worklogs"',
    ],
  ],
  ["/milestones", ["demo", "/w/demo/milestones", "M7/02", "3 archived"]],
  ["/profiles", ["careful", "opus", "headless"]],
  ["/all", ["Two things need you.", "Needs you", "Guard soak"]],
  ["/w/demo", ["/home/test/demo", "/w/demo/rituals/daily-report", "Latest reports", "Recent runs", "synced"]],
  ["/vigils", ["Vigils", "Coming up", "Guard soak", "last check failed", "/w/demo/vigils#vigil-soak"]],
  ["/w/demo/vigils", ["Vigils", "Guard soak", "last check failed"]],
  ["/rituals", ["Rituals", "Coming up", "/w/demo/rituals/daily-report", "Recent runs", "All runs"]],
  ["/w/demo/rituals", ["Rituals", "/w/demo/rituals/daily-report", "/w/demo/runs"]],
  ["/milestones", ["Milestones"]],
  ["/w/demo/milestones", ["Milestones"]],
  ["/settings", ["Settings", "Appearance"]],
  ["/settings/notifications", ["Settings", "Notifications"]],
  ["/settings/backups", ["Settings", "Backups", "Back up now"]],
  ["/settings/about", ["Settings", "About", "testhost"]],
  ["/w/demo/rituals/daily-report", ["Rules", "git fetch", "git push", "Be brief.", "Read the log", "darius due", "History", "report mode"]],
  [`/w/demo/runs/${DONE}`, ["Findings heading", "site-a", "2281", '<ol start="3">', "run.completed", "5 min", "Complete"]],
  [`/w/demo/runs/${HELD}`, ["Needs you", "which branch?", `darius run answer ${HELD} 2 &quot;your answer&quot; --project demo`]],
];

test("every page renders with the nonce on each script and store text as text", async () => {
  for (const [path, texts] of PAGES) {
    const page = await get(path);
    assert.equal(page.status, 200, path);
    assert.match(page.headers.get("content-type") ?? "", /text\/html/u, path);
    for (const text of texts) assert.ok(page.body.includes(text), `${path}: ${text}`);
    assertScriptsCarryNonce(page.body, path);
    assert.equal(page.body.includes(EVIL), false, `${path}: store text never becomes a script`);
  }
  const run = await get(`/w/demo/runs/${DONE}`);
  assert.ok(run.body.includes("store text &lt;script&gt;alert(1)&lt;/script&gt; &amp; more"), "escaped findings");
  const overview = await get("/all");
  assert.ok(overview.body.includes("may I push &lt;script&gt;alert(1)&lt;/script&gt;?"), "escaped question");
});

test("milestone detail: a short spec starts open, a long one folded; worklogs start folded; the Milestones tab is lit", async () => {
  const body = (await get("/w/demo/milestones/m7")).body;
  const folds = [...body.matchAll(/<details class="msd-fold"( id="[^"]*")?( open="")?/gu)].map((match) => [match[1] ?? "", match[2] !== undefined]);
  assert.deepEqual(folds, [[' id="m7-01-keep"', true], [' id="m7-02-tax"', false], ["", false]], "01 (6 lines) open, 02 (300 lines) folded, the worklog folded");
  assert.match(body, /<a [^>]*aria-current="page"[^>]*href="\/w\/demo\/milestones"|<a [^>]*href="\/w\/demo\/milestones"[^>]*aria-current="page"/u, "the Milestones tab of the workspace");
});

interface Crumb {
  text: string;
  href: string | null;
}

/** The steps of the breadcrumb nav of a page: text and link target (null for the current page). */
function crumbsOf(body: string): Crumb[] {
  const nav = /<nav aria-label="Breadcrumb"[^>]*>(.*?)<\/nav>/su.exec(body)?.[1] ?? "";
  assert.match(nav, /^<ol[ >]/u, "an ordered list");
  return [...nav.matchAll(/<li[^>]*>(.*?)<\/li>/gsu)].map((item) => {
    const inner = item[1] ?? "";
    return { text: inner.replaceAll("<!-- -->", "").replaceAll(/<[^>]+>/gu, ""), href: /<a [^>]*href="([^"]*)"/u.exec(inner)?.[1] ?? null };
  });
}

test("the breadcrumb nav: workspace, section, item, with the current page last and not a link", async () => {
  const ritual = await get("/w/demo/rituals/daily-report");
  const ritualTitle = RITUAL.row.title.replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  assert.deepEqual(crumbsOf(ritual.body), [
    { text: "demo", href: "/w/demo" },
    { text: "Rituals", href: "/w/demo/rituals" },
    { text: ritualTitle, href: null },
  ]);
  assert.match(ritual.body, /<span aria-current="page">/u, "the current step says so");

  const run = await get(`/w/demo/runs/${DONE}`);
  const steps = crumbsOf(run.body);
  assert.deepEqual(steps.map((step) => step.href), ["/w/demo", "/w/demo/rituals", "/w/demo/rituals/daily-report", null], "ws / Rituals / ritual / run, a ritual run is filed under Rituals");
  assert.equal(steps[0]?.text, "demo");
  assert.equal(steps[1]?.text, "Rituals");
  assert.equal(steps[2]?.text, ritualTitle);
  assert.equal(steps[3]?.text, "Findings heading", "the run's own title");

  const held = crumbsOf((await get(`/w/demo/runs/${HELD}`)).body);
  assert.deepEqual(held.map((step) => step.href), ["/w/demo", "/w/demo/rituals", null], "a run titled by its ritual has no separate ritual step");
  assert.equal(held.at(-1)?.text, ritualTitle);

  assert.deepEqual(crumbsOf((await get("/w/demo/milestones/M7")).body), [
    { text: "demo", href: "/w/demo" },
    { text: "Milestones", href: "/w/demo/milestones" },
    { text: "M7", href: null },
  ]);

  assert.deepEqual(crumbsOf((await get("/w/demo/runs")).body), [
    { text: "demo", href: "/w/demo" },
    { text: "Runs", href: null },
  ]);
  assert.deepEqual(crumbsOf((await get("/runs")).body), [
    { text: "All workspaces", href: "/all" },
    { text: "Runs", href: null },
  ]);
  assert.equal((await get("/w/demo/rituals")).body.includes('aria-label="Breadcrumb"'), false, "a section list has no crumbs");
});

test("a vigil run is filed under Vigils, and the ritual page shows Next due as a clock time, not raw ISO", async () => {
  const vigilRun = { ...RUNS[2]!, item: "vigil/guard-soak" };
  const vigilContext: WebContext = { ...context, run: (project, run) => (project === "demo" && run === DONE ? runDetail(vigilRun) : context.run(project, run)) };
  const page = await (await handler(new Request(`http://darius.test/w/demo/runs/${DONE}`), vigilContext)).text();
  const steps = crumbsOf(page);
  assert.equal(steps[1]?.text, "Vigils");
  assert.equal(steps[1]?.href, "/w/demo/vigils");
  const repo = { ...RITUAL.row, heldRun: null, args: "--site acme", nextDueAt: "2026-09-29T05:00:00.000Z" };
  const ritual = (await (await handler(new Request("http://darius.test/w/demo/rituals/daily-report"), { ...context, ritual: () => ({ ...RITUAL, row: repo }) })).text()).replaceAll("<!-- -->", "");
  assert.ok(ritual.includes("Next due") && /Next due.*?(29 Sep )?07:00/u.test(ritual.replaceAll(/<[^>]+>/gu, "")), "the host clock (UTC+2): a time, with the day when it is not today");
  assert.equal(ritual.replaceAll(/<script.*?<\/script>/gsu, "").replaceAll(/<[^>]+>/gu, "").includes("2026-09-29T05:00:00.000Z"), false, "no raw ISO date in the page text (the hydration data keeps it)");
});

test("the run filter keeps only matching runs", async () => {
  const page = await get("/runs?state=held");
  assert.ok(page.body.includes(`/w/demo/runs/${HELD}`));
  assert.equal(page.body.includes(`/w/demo/runs/${DONE}`), false);
});

test("the home page shows a manual ritual as a late row of Coming up, and never imported runs", async () => {
  const project = STATUS.projects[0]!;
  const manual = { ...project.rituals[0]!, slug: "by-hand", title: "Done by hand", mode: "off", skill: null, heldRun: null, overdueDays: 4, nextDue: "2026-09-24" };
  const imported = { ...RUNS[2]!, run: "01KDDDDDDDDDDDDDDDDDDDDDDD", item: "ritual/by-hand", who: "import" };
  const busy: HostStatus = { ...STATUS, projects: [{ ...project, rituals: [...project.rituals, manual], runs: [...project.runs, imported] }] };
  const response = await handler(new Request("http://darius.test/all"), { ...context, status: () => busy });
  const body = await response.text();
  assert.equal(body.includes("<article id=\"done-demo-by-hand"), false, "no card for a manual ritual");
  assert.equal(body.includes(imported.run), false, "no imported run");
  const rituals = (await (await handler(new Request("http://darius.test/rituals"), { ...context, status: () => busy })).text()).replaceAll("<!-- -->", "");
  const coming = comingOf(rituals).replaceAll(/<[^>]+>/gu, "");
  assert.ok(coming.includes("Done by hand") && coming.includes("4 days late") && coming.includes("manual"), "the late manual ritual is a row of Coming up, marked manual");
  assert.ok(coming.indexOf("Overdue") < coming.indexOf("Done by hand"), "under the Overdue label");
  assert.match(body, /<a [^>]*href="\/rituals#coming-up"[^>]*>.*?<span class="pill-n">1<\/span><span class="pill-l">late<\/span>/su, "and the late segment of the strip counts it, and opens the Rituals section");
  const workspacePage = await (await handler(new Request("http://darius.test/w/demo/rituals"), { ...context, status: () => busy })).text();
  assert.ok(workspacePage.replaceAll("<!-- -->", "").includes("Done by hand"), "the workspace section lists it in the same Coming up");
  const runs = await (await handler(new Request("http://darius.test/runs?imported=1"), { ...context, status: () => busy })).text();
  assert.ok(runs.includes(imported.run), "the runs page shows them on request");
});

test("the ritual page of a repo ritual shows where git defines it, the schedule and the warnings, and points edits to git", async () => {
  const repo = { ...RITUAL.row, mode: "off", heldRun: null, source: "repo" as const, defCommit: "abcdef123456", defHost: "host-a", defAt: "2026-09-28T07:00:00.000Z", defDirty: true, at: "07:00", zone: "Europe/Berlin", args: "--site acme", timeout: "30m", nextDueAt: "2026-09-29T05:00:00.000Z", warnings: ["mirror is from host-b, this checkout differs: darius ritual reconcile"] };
  const ctx: WebContext = { ...context, ritual: (name, slug) => (name === "demo" && slug === "daily-report" ? { ...RITUAL, row: repo } : null) };
  const page = (await (await handler(new Request("http://darius.test/w/demo/rituals/daily-report"), ctx)).text()).replaceAll("<!-- -->", "");
  const text = page.replaceAll(/<[^>]+>/gu, "");
  assert.ok(text.includes("Defined in .darius.toml at commit abcdef123456, host host-a"), "the source line");
  assert.ok(text.includes("(uncommitted changes)"), "dirty");
  assert.ok(text.includes("07:00 Europe/Berlin") && text.includes("30m"), "at, zone and timeout");
  assert.ok(text.includes("Arguments") && text.includes("--site acme"), "the skill arguments");
  assert.ok(text.includes("mirror is from host-b, this checkout differs"), "the warning");
  assert.ok(text.includes("set mode = ") && text.includes("in .darius.toml and commit"), "the off notice points to git");
  assert.equal(text.includes("darius ritual set daily-report --mode"), false, "no edit command for a git-owned field");
  const unmanaged = { ...RITUAL.row, source: "unmanaged" as const };
  const other = (await (await handler(new Request("http://darius.test/w/demo/rituals/daily-report"), { ...context, ritual: () => ({ ...RITUAL, row: unmanaged }) })).text()).replaceAll("<!-- -->", "");
  assert.ok(other.includes("Not in .darius.toml"), "unmanaged");
});

test("unknown projects, rituals, runs and paths answer a themed 404", async () => {
  for (const path of ["/w/ghost", "/w/ghost/vigils", "/w/ghost/rituals", "/w/ghost/milestones", "/w/ghost/milestones/M7", "/w/demo/milestones/M99", "/w/demo/milestones/..%2FM7", "/w/demo/rituals/nope", "/w/ghost/rituals/daily-report", "/w/demo/runs/NOPE", "/w/ghost/runs", "/nowhere", "/p/demo/runs"]) {
    const page = await get(path);
    assert.equal(page.status, 404, path);
    assert.ok(page.body.includes("Nothing here"), path);
    assertScriptsCarryNonce(page.body, path);
  }
});

test("the 0.9 run URL redirects to the workspace run page", async () => {
  const response = await handler(new Request(`http://darius.test/runs/demo/${DONE}`), context);
  assert.equal(response.status, 301);
  assert.equal(response.headers.get("location"), `/w/demo/runs/${DONE}`);
});

test("client navigation fetches route data from the same handler", async () => {
  const response = await handler(new Request("http://darius.test/w/demo.data"), context);
  assert.equal(response.status, 200);
  assert.ok((await response.text()).includes("/home/test/demo"));
});

/** The Coming up section of the Rituals or Vigils page: from its id to its end. */
function comingOf(body: string): string {
  const start = body.indexOf('id="coming-up"');
  return body.slice(start, body.indexOf("</section>", start));
}

function h1Of(body: string): string {
  return (/<h1\b[^>]*>(.*?)<\/h1>/su.exec(body)?.[1] ?? "").replaceAll(/<[^>]+>/gu, "").replaceAll("<!-- -->", "");
}

test("the workspace pages split rituals like the home page: djinns follow a skill, scheduled checks do not", async () => {
  const project = STATUS.projects[0]!;
  const heartbeat = { ...project.rituals[0]!, slug: "heartbeat", title: "Heartbeat check", skill: null, heldRun: null };
  const split: HostStatus = { ...STATUS, projects: [{ ...project, rituals: [...project.rituals, heartbeat] }] };
  const read = async (path: string): Promise<string> => await (await handler(new Request(`http://darius.test${path}`), { ...context, status: () => split })).text();
  const section = await read("/w/demo/rituals");
  assert.ok(comingOf(section).includes("Heartbeat check"), "a scheduled check is listed in the Rituals section");
  const overview = await read("/w/demo");
  const reports = overview.indexOf('id="reports"');
  assert.ok(reports !== -1, "the Overview has Latest reports");
  assert.doesNotMatch(overview.slice(reports), /<article[^>]*>(?:(?!<\/article>).)*Heartbeat check/su, "no skill, no report row");
  assert.equal(overview.includes('id="coming-up"'), false, "what is coming up lives in the sections, not on the Overview");
});

test("a run open far past the run timeout shows as possibly stuck, against the status time", async () => {
  const { DEFAULT_RUN_TIMEOUT_MS } = await import("../src/runner/run-due.ts");
  assert.equal(DEFAULT_RUN_TIMEOUT_MS, 20 * 60_000, "the page says runs stop after 20 min");
  const project = STATUS.projects[0]!;
  const STUCK = "01KEEEEEEEEEEEEEEEEEEEEEEE";
  const FRESH = "01KFFFFFFFFFFFFFFFFFFFFFFF";
  const stuck = { ...runRow(STUCK, "running", null), startedAt: "2026-09-27T21:00:00.000Z" };
  const fresh = { ...runRow(FRESH, "running", null), startedAt: "2026-09-28T08:30:00.000Z" };
  const busy: HostStatus = { ...STATUS, projects: [{ ...project, runs: [stuck, fresh, ...project.runs] }] };
  const busyContext: WebContext = {
    ...context,
    status: () => busy,
    run: (name, run) => {
      const row = busy.projects[0]!.runs.find((candidate) => candidate.run === run);
      return name === "demo" && row !== undefined ? runDetail(row) : null;
    },
  };
  const read = async (path: string): Promise<string> => (await (await handler(new Request(`http://darius.test${path}`), busyContext)).text()).replaceAll("<!-- -->", "");
  const page = await read(`/w/demo/runs/${STUCK}`);
  assert.ok(page.includes("Running for 12 h. Runs stop after 20 min, so this one may be stuck."), "the warning line");
  assert.ok(page.includes("May be stuck"), "the warning state");
  const young = await read(`/w/demo/runs/${FRESH}`);
  assert.equal(young.includes("may be stuck"), false, "a run half an hour old is just running");
  const home = await read("/all");
  const needs = home.slice(home.indexOf("Needs you"), home.indexOf('id="now"'));
  const nowRows = home.slice(home.indexOf('id="now"'), home.indexOf("<aside"));
  assert.match(nowRows, new RegExp(`/w/demo/runs/${FRESH}`, "u"), "Now lists the fresh run");
  assert.doesNotMatch(nowRows, new RegExp(STUCK, "u"), "the stuck run has its card in Needs you, not a row in Now");
  assert.match(needs, new RegExp(`id="stuck-${STUCK}".*href="/w/demo/runs/${STUCK}".*stuck, 12 h`, "su"), "a Needs you card that opens the run");
  assert.doesNotMatch(needs, new RegExp(FRESH, "u"), "none for the fresh run");
  assert.ok(home.includes("Three things need you."), "held, stuck and flagged count");
});

test("the run page title: the report heading for a complete run, the ritual title otherwise", async () => {
  const done = await get(`/w/demo/runs/${DONE}`);
  assert.equal(h1Of(done.body), "Findings heading");
  for (const run of [FAILED, HELD]) {
    const page = await get(`/w/demo/runs/${run}`);
    assert.equal(h1Of(page.body), "Daily &lt;script&gt;alert(1)&lt;/script&gt; report", run);
  }
});

test("Places counts the things that need you, like the verdict: not questions", async () => {
  const page = await get("/w/demo");
  assert.ok(page.body.includes("2 needs you") || page.body.includes("2 need you"), "the workspace entry names the number");
  assert.match(page.body, /<span class="places-need">2 need you<\/span>/u, "All workspaces says 2 need you");
  assert.equal(h1Of((await get("/all")).body), "Two things need you.", "the same number as the verdict");
});

/** The count of one segment of the home status strip, or null when the segment is absent. */
function segment(body: string, label: string): string | null {
  return new RegExp(`<span class="pill-n">(\\d+)</span><span class="pill-l">${label}</span>`, "u").exec(body)?.[1] ?? null;
}

test("the busy home page: the verdict in words, the status strip, one card per thing, the health line", async () => {
  const body = (await get("/all")).body.replaceAll("<!-- -->", "");
  assert.equal(h1Of(body), "Two things need you.");
  assert.match(body, /<h1 class="verdict-h ink-bad">/u, "a flagged vigil makes the verdict red");
  assert.ok(body.includes('<a href="#needs" class="pill tone-wait">'), "the strip links the held card");
  assert.ok(body.includes('href="#flagged-demo-soak"'), "the strip links the flagged card");
  assert.equal(segment(body, "need you"), "1");
  assert.equal(segment(body, "flagged"), "1");
  assert.equal(segment(body, "running"), null, "a zero is left out");
  assert.equal(segment(body, "failed"), null);
  assert.match(body.replaceAll(/<[^>]+>/gu, ""), /Timer ok, last run 1 h ago\. Synced 5 min ago\./u, "the newest run the timer started, and the sync");
  assert.equal(body.includes("Watch"), false, "no gauges");
  assert.equal(body.includes("Recent runs"), false, "the run list lives on /runs");
  assert.equal(body.match(/<article id="[a-z]+-/gu)?.length, 2, "one card per thing: the held run and the flagged vigil");
  assert.equal(body.includes(`/w/demo/runs/${DONE}`), false, "an older run of a held djinn does not show");
});

test("the quiet home page: Nothing needs you, the last night card, and the self-test as one line in the host line of Places", async () => {
  const demo = STATUS.projects[0]!;
  const selftest = {
    ...demo,
    name: "darius-selftest",
    checkout: null,
    rituals: [{ ...demo.rituals[0]!, slug: "heartbeat", title: "Heartbeat", skill: null, heldRun: null, overdueDays: 0, nextDue: "2026-09-29" }],
    runs: [{ ...RUNS[2]!, run: "01KGGGGGGGGGGGGGGGGGGGGGGG", item: "ritual/heartbeat" }],
    vigils: [{ slug: "date-failed", title: "date failed", state: "open", verdict: null, flagged: true, lastOutcome: "failed", due: "2026-09-27", until: null }],
  };
  const quiet: HostStatus = {
    ...STATUS,
    projects: [
      { ...demo, rituals: [{ ...demo.rituals[0]!, heldRun: null, overdueDays: 0, isDue: false, nextDue: "2026-09-29" }], runs: [RUNS[2]!], vigils: [{ ...demo.vigils[0]!, flagged: false }] },
      selftest,
    ],
  };
  const body = (await (await handler(new Request("http://darius.test/all"), { ...context, status: () => quiet })).text()).replaceAll("<!-- -->", "");
  assert.equal(h1Of(body), "Nothing needs you.");
  assert.match(body, /<h1 class="verdict-h ink-ok">/u);
  assert.ok(body.includes('<p class="verdict-sub">Mon 28 Sep, 11:00</p>'), "the sub line is the host clock only");
  assert.match(body, /class="nextup".*?<span class="nextup-t">Daily &lt;script&gt;alert\(1\)&lt;\/script&gt; report<\/span><span class="nextup-w">tomorrow<\/span>/su, "the Next line: what is next, derived from nextDue");
  assert.equal(body.includes('id="needs"'), false, "nothing needs you: no Needs you section, and no Quiet line");
  assert.equal(body.includes("Quiet."), false);
  assert.ok(body.includes("Last ritual run 1 h ago, complete."), "the last run moved into the health line");
  assert.ok(body.includes("Last night"), "the completed djinn");
  assert.ok(body.includes("Findings heading"), "with its report excerpt");
  assert.equal(segment(body, "flagged"), null, "the self-test vigil does not count");
  assert.equal(segment(body, "need you"), null, "a zero segment does not render");
  assert.ok(body.includes("Self-test: heartbeat ran 1 h ago. 1 vigil flagged."), "one muted line at the end of Places");
  assert.equal(body.includes("date failed"), false, "no card for the self-test vigil");
  const page = await (await handler(new Request("http://darius.test/w/darius-selftest"), { ...context, status: () => quiet })).text();
  assert.ok(page.includes("date failed") && page.includes("last check failed"), "its own Overview shows it in full");
});

test("a failed run: both pages say what happens next, then who acknowledged it; the board drops an acknowledged failure", async () => {
  const project = STATUS.projects[0]!;
  const failedRow: RunRow = { ...runRow(FAILED, "closed", "failed"), startedAt: "2026-09-28T08:10:00.000Z" };
  const ack = { at: "2026-09-28T08:30:00.000Z", who: "owner", note: `known ${EVIL} outage` };
  const setup = (acknowledged: typeof ack | null): WebContext => {
    const row = { ...failedRow, acknowledged };
    const ritualRow = { ...project.rituals[0]!, heldRun: null, isDue: true, failedToday: { run: FAILED, acknowledged } };
    const runs = [row, RUNS[2]!];
    const status: HostStatus = { ...STATUS, projects: [{ ...project, rituals: [ritualRow], runs, vigils: [{ ...project.vigils[0]!, flagged: false }] }] };
    return {
      ...context,
      status: () => status,
      ritual: (name, slug) => (name === "demo" && slug === "daily-report" ? { ...RITUAL, row: ritualRow, runs } : null),
      run: (name, run) => {
        const found = runs.find((candidate) => candidate.run === run);
        return name === "demo" && found !== undefined ? runDetail(found) : null;
      },
    };
  };
  const read = async (path: string, ctx: WebContext): Promise<string> => (await (await handler(new Request(`http://darius.test${path}`), ctx)).text()).replaceAll("<!-- -->", "");

  const open = setup(null);
  for (const path of [`/w/demo/runs/${FAILED}`, "/w/demo/rituals/daily-report"]) {
    const page = await read(path, open);
    assert.ok(page.includes("What happens next"), path);
    assert.ok(page.includes("This run failed. darius does not retry it today. The timer starts the ritual again when it is next due, tomorrow for a daily ritual."), path);
    assert.ok(page.includes("darius run now daily-report --project demo"), path);
    assert.ok(page.includes(`darius run ack ${FAILED} --project demo`), path);
  }
  const done = await read(`/w/demo/runs/${DONE}`, open);
  assert.equal(done.includes("What happens next"), false, "a complete run has no next step");
  assert.match(await read("/w/demo", open), /id="reports".*<li class="rw rw-rail tone-bad">.*<span class="rw-state tone-bad">Failed<\/span>/su, "the latest-report row shows an open failure in the failure colour, with a rail");
  const needed = await read("/all", open);
  assert.equal(h1Of(needed), "One thing needs you.");
  assert.ok(needed.includes(`id="failed-demo-daily-report"`), "an open failure needs the operator");
  assert.match(comingOf(await read("/rituals", open)), /Tomorrow.*<li class="rw rw-rail tone-bad">.*<span class="rw-state tone-bad">Failed<\/span>/su, "Coming up puts the failed djinn tomorrow, in the failure colour");

  const seen = setup(ack);
  for (const path of [`/w/demo/runs/${FAILED}`, "/w/demo/rituals/daily-report"]) {
    const page = await read(path, seen);
    assert.ok(page.includes("What happens next"), path);
    assert.ok(page.includes("Acknowledged by owner at 10:30: known &lt;script&gt;alert(1)&lt;/script&gt; outage."), path);
    assert.equal(page.includes("darius run ack"), false, path);
    assert.equal(page.includes(EVIL), false, `${path}: the note stays text`);
  }
  // Every page shows an acknowledged failure quietly: grey "Failed, seen", never the failure colour.
  for (const path of ["/all", "/rituals", "/runs", "/w/demo", "/w/demo/rituals/daily-report", `/w/demo/runs/${FAILED}`]) {
    const page = await read(path, seen);
    assert.match(page, /<span class="(?:status|rw-state) tone-idle">Failed, seen<\/span>/u, `${path}: the grey word`);
    for (const red of ["tone-bad", "edge-bad", "ink-bad"]) assert.equal(page.includes(red), false, `${path}: no ${red}`);
  }
  const card = await read("/w/demo", seen);
  assert.match(card, /id="reports".*<li class="rw">.*Failed, seen.*Acknowledged by owner at 10:30: known &lt;script&gt;alert\(1\)&lt;\/script&gt; outage\./su, "the latest-report row is grey and has no rail, with the acknowledgement");
  const home = await read("/all", seen);
  assert.equal(h1Of(home), "Nothing needs you.");
  const coming = comingOf(await read("/rituals", seen));
  assert.match(coming, /<li class="rw">.*<span class="rw-state tone-idle">Failed, seen<\/span>/su, "Coming up says so, in grey");
  assert.equal(coming.includes("tone-bad"), false, "no failure colour in Coming up");
  assert.equal(home.includes(`id="failed-`), false, "no Needs you card");
  assert.match(home, /<h1 class="verdict-h ink-ok">/u);
  assert.match(home, /Last night.*<li id="done-demo-daily-report" class="rw">/su, "a plain Last night row");
  assert.match(home, /Last night.*Acknowledged by owner at 10:30: known &lt;script&gt;alert\(1\)&lt;\/script&gt; outage\./su, "with the acknowledgement");
});

test("the ritual page says where a pinned ritual runs", async () => {
  const project = STATUS.projects[0]!;
  const pinned = { ...project.rituals[0]!, host: "host-b" };
  const ctx: WebContext = { ...context, ritual: (name, slug) => (name === "demo" && slug === "daily-report" ? { ...RITUAL, row: pinned } : null) };
  const page = (await (await handler(new Request("http://darius.test/w/demo/rituals/daily-report"), ctx)).text()).replaceAll("<!-- -->", "");
  assert.ok(page.includes(`Runs on <code class="inline-code">host-b</code> only; the timer of any other host skips it.`));
  assert.equal((await get("/w/demo/rituals/daily-report")).body.includes("Runs on"), false, "no pin, no line");
});

test("the ritual page says what a hold match does: holds the run, or with on_hold deny refuses the command (0.66.0)", async () => {
  const ctx: WebContext = { ...context, ritual: (name, slug) => (name === "demo" && slug === "daily-report" ? { ...RITUAL, policy: { ...RITUAL.policy, onHold: "deny" } } : null) };
  const page = (await (await handler(new Request("http://darius.test/w/demo/rituals/daily-report"), ctx)).text()).replaceAll("<!-- -->", "");
  assert.ok(page.includes("On a match"));
  assert.ok(page.includes("refuses the command; the run goes on and records it for a decision"));
  assert.ok((await get("/w/demo/rituals/daily-report")).body.includes("holds the run until someone answers"), "the default");
});

test("a manual ritual reads \"manual ritual\" with the hand, has a note box with the way to automate it, and its instructions open", async () => {
  const project = STATUS.projects[0]!;
  const manual = { ...project.rituals[0]!, slug: "by-hand", title: "Done by hand", mode: "off", skill: null, heldRun: null, overdueDays: 13, nextDue: "2026-09-15" };
  const ctx: WebContext = { ...context, ritual: (name, slug) => (name === "demo" && slug === "by-hand" ? { ...RITUAL, row: manual, policy: { ...RITUAL.policy, mode: "off" } } : null) };
  const page = (await (await handler(new Request("http://darius.test/w/demo/rituals/by-hand"), ctx)).text()).replaceAll("<!-- -->", "");
  assert.match(page, /<span class="kind-word c-manual"><svg class="kind-icon kind-manual"[^>]*>.*?<\/svg>manual ritual<\/span>/su, "one coloured word with the hand: manual ritual");
  assert.equal(page.includes("chip-x c-ritual"), false, "no kind chip boxes");
  assert.ok(page.includes('<span class="rw-state tone-late">13 days late</span>'), "the state word in the vocabulary");
  assert.ok(page.includes('<h1 class="page-title page-title-sans">'), "the title is sans");
  assert.ok(page.includes("darius does not start this ritual (mode off). You run it by hand; darius tracks the schedule."), "the note box");
  assert.ok(page.includes('<code class="inline-code">darius ritual set by-hand --mode report ...</code>'), "and the way to let darius run it");
  assert.match(page, /<details class="fold scroll-mt-20" open=""><summary>Instructions<\/summary>/u, "Instructions are open for a ritual done by hand");
  assert.match(page, /<details class="fold scroll-mt-20"><summary>Rules/u, "Rules stay closed");
  const auto = (await get("/w/demo/rituals/daily-report")).body;
  assert.ok(auto.includes('<span class="kind-word c-ritual">'), "an automatic ritual reads ritual");
  assert.equal(auto.includes("c-manual"), false, "and has no manual mark");
  assert.match(auto, /<details class="fold scroll-mt-20"><summary>Instructions/u, "its instructions stay closed");
});

test("the ritual page shows the note for the next run, with the operator's answer (0.26.0)", async () => {
  const from = "01KJJJJJJJJJJJJJJJJJJJJJJJ";
  const handoff = {
    run: from,
    at: "2026-09-30T10:12:00.000Z",
    note: "Check post 7 again.",
    questions: [{ text: "Delete the card?" }],
    operator: { who: "owner", at: "2026-09-30T11:00:00.000Z", note: "yes, delete it" },
  };
  const ctx: WebContext = { ...context, ritual: (name, slug) => (name === "demo" && slug === "daily-report" ? { ...RITUAL, handoff } : null) };
  const page = (await (await handler(new Request("http://darius.test/w/demo/rituals/daily-report"), ctx)).text()).replaceAll("<!-- -->", "");
  assert.ok(page.includes("Note for the next run"));
  assert.ok(page.includes("<p>Check post 7 again.</p>"));
  assert.ok(page.includes("Your answer, owner: yes, delete it"));
  assert.ok(page.includes(`href="/w/demo/runs/${from}"`), "the card links the run that left the note");
  assert.equal((await get("/w/demo/rituals/daily-report")).body.includes("Note for the next run"), false, "no handoff, no card");
});

// --- run results (0.22.0) -------------------------------------------------------------

const ASKS = "01KHHHHHHHHHHHHHHHHHHHHHHH";

const RESULT: RunResult = {
  v: 1,
  status: "attention",
  summary: `37 posts checked ${EVIL}; 1 critical fixed, 1 question.`,
  metrics: [
    { label: "Posts checked", value: 37 },
    { label: "Stale cards", value: 2, unit: "cards", tone: "warn" },
  ],
  items: [
    { title: "Minor typo", severity: "low", state: "open", group: "site-a", target: "post 1039890" },
    { title: "Broken link on the pricing page", severity: "critical", state: "fixed", group: "site-a", target: `post ${EVIL}`, detail: `first line\nsecond ${EVIL} line` },
    { title: "Wrong opening hours", severity: "high", state: "open", group: "site-a", target: "post 1039887" },
    { title: "Price table outdated", severity: "high", state: "needs-decision", group: "site-c" },
    { title: "Loose item", severity: "medium", state: "not-verified" },
  ],
  questions: [{ text: `Delete the two old landing pages ${EVIL} now?`, recommendation: "Yes, delete them." }],
  actions: [
    { text: "Removed the link from the price table", state: "done", target: "site-a post 1039886" },
    { text: "Left the archive alone", state: "skipped" },
  ],
};

const SUMMARY: RunResultSummary = { status: "attention", questions: 1, open: { critical: 0, high: 2, medium: 1, low: 1, info: 0 }, fixed: 1 };

/** The demo project with one complete run whose result asks a question, acknowledged or not. */
function asksContext(acknowledged: Acknowledgement | null): WebContext {
  const project = STATUS.projects[0]!;
  const row: RunRow = { ...runRow(ASKS, "closed", "complete"), startedAt: "2026-09-28T08:10:00.000Z", endedAt: "2026-09-28T08:14:00.000Z", result: SUMMARY, acknowledged };
  const ritualRow = { ...project.rituals[0]!, heldRun: null, overdueDays: 0, nextDue: "2026-09-29" };
  const runs = [row, RUNS[2]!];
  const status: HostStatus = { ...STATUS, projects: [{ ...project, rituals: [ritualRow], runs, vigils: [{ ...project.vigils[0]!, flagged: false }] }] };
  return {
    ...context,
    status: () => status,
    ritual: (name, slug) => (name === "demo" && slug === "daily-report" ? { ...RITUAL, row: ritualRow, runs } : null),
    run: (name, run) => {
      const found = runs.find((candidate) => candidate.run === run);
      if (name !== "demo" || found === undefined) return null;
      return runDetail(found, found.run === ASKS ? RESULT : null);
    },
  };
}

/** The part of `text` from `start` up to `end`. */
function between(text: string, start: number, end: number): string {
  return text.slice(start, end);
}

async function readPage(path: string, ctx: WebContext): Promise<string> {
  return (await (await handler(new Request(`http://darius.test${path}`), ctx)).text()).replaceAll("<!-- -->", "");
}

function textOf(html: string): string {
  return html.replaceAll(/<[^>]+>/gu, "");
}

test("a run with a result: the banner, tiles, the question with the ack command, grouped items and actions, above the report", async () => {
  const ctx = asksContext(null);
  const page = await readPage(`/w/demo/runs/${ASKS}`, ctx);
  assert.equal(page.includes(EVIL), false, "result text never becomes a script");
  assert.equal(h1Of(page), "Findings heading", "the report heading stays the title");
  assert.ok(page.includes('<span class="rw-state tone-wait">Asks you</span>'), "the run state asks");

  const result = page.indexOf('<h2 class="label">Result</h2>');
  const questions = page.indexOf('<h2 class="label">Questions for you</h2>');
  const found = page.indexOf('<h2 class="label">What it found</h2>');
  const changed = page.indexOf('<h2 class="label">What it changed</h2>');
  const report = page.indexOf('<h2 class="label">Report</h2>');
  assert.ok(result !== -1 && result < questions && questions < found && found < changed && changed < report, JSON.stringify([result, questions, found, changed, report]));

  assert.match(page, /<div class="card card-accent result-banner edge-wait"><span class="status tone-wait">.*?Needs attention<\/span>/su, "the banner in the waiting tone, with the word");
  assert.ok(page.includes("37 posts checked &lt;script&gt;alert(1)&lt;/script&gt;; 1 critical fixed, 1 question."), "the summary as text");
  assert.match(textOf(page), /Posts checked37/u);
  assert.match(page, /<div class="tile tone-late">.*?Stale cards.*?2<span class="tile-u">cards<\/span>.*?warning/su, "a toned tile says its tone in words");

  const asked = between(page, questions, found);
  assert.ok(asked.includes("Delete the two old landing pages &lt;script&gt;alert(1)&lt;/script&gt; now?"));
  assert.ok(asked.includes("Recommended:") && asked.includes("Yes, delete them."));
  assert.ok(asked.includes(`darius run ack ${ASKS} --note &quot;your decision&quot; --project demo`), "the command that records the decision");
  assert.ok(asked.includes("card card-accent next edge-wait"));

  const items = textOf(between(page, found, changed));
  const order = ["site-a", "Broken link on the pricing page", "Wrong opening hours", "Minor typo", "site-c", "Price table outdated", "Other items", "Loose item"].map((text) => items.indexOf(text));
  assert.ok(order.every((at, index) => at !== -1 && (index === 0 || at > (order[index - 1] ?? 0))), `grouped, the worst first: ${JSON.stringify(order)}`);
  for (const word of ["critical", "high", "low", "medium", "fixed", "open", "needs decision", "not verified"]) assert.ok(items.includes(word), word);
  assert.ok(page.includes("post &lt;script&gt;alert(1)&lt;/script&gt;"), "the target as text");
  assert.match(page, /<details class="fold scroll-mt-20"><summary>Detail<\/summary><div class="fold-body"><p class="ritem-detail">first line\nsecond &lt;script&gt;alert\(1\)&lt;\/script&gt; line<\/p>/su, "the detail folds away, as text");
  assert.ok(page.includes('<li class="ritem ritem-done">'), "a fixed item is quiet");

  const actions = textOf(between(page, changed, report));
  assert.ok(actions.includes("Removed the link from the price table") && actions.includes("site-a post 1039886") && actions.includes("done") && actions.includes("skipped"));
  assertScriptsCarryNonce(page, "run page with a result");

  const calm = await readPage(`/w/demo/runs/${DONE}`, ctx);
  assert.equal(calm.includes('<h2 class="label">Result</h2>'), false, "no result, no panel");
});

// --- follow-up (0.48.0) -----------------------------------------------------------------

const PARENT = "01KPPPPPPPPPPPPPPPPPPPPPPP";
const CHILD = "01KQQQQQQQQQQQQQQQQQQQQQQQ";
const COMMAND = `pnpm -C tools cli fc --post 12 --confirm 'site <b>a</b>'`;
const WITH_COMMANDS: RunResult = {
  ...RESULT,
  questions: [{ text: "Post the fix to site-a?", recommendation: "Yes.", commands: [COMMAND, "git push origin main"] }, { text: "Rename the page?" }],
};

/** The asks run with a question that lists commands, and the readiness given; `calls` counts the readiness checks. */
function followUpContext(readiness: FollowUpReadiness, links: { followUpOf?: string; followUps?: string[] } = {}): WebContext & { calls: string[] } {
  const base = asksContext(null);
  const calls: string[] = [];
  return {
    ...base,
    calls,
    run: (name, run) => {
      const detail = base.run(name, run);
      if (detail === null || run !== ASKS) return detail;
      return { ...detail, result: WITH_COMMANDS, followUpOf: links.followUpOf ?? null, followUps: links.followUps ?? [] };
    },
    followUp: (project, run) => {
      calls.push(`${project}/${run}`);
      return Promise.resolve(readiness);
    },
  };
}

test("a question's command lines show as written, and the follow-up card offers a button on this host", async () => {
  const ctx = followUpContext({ ready: true, host: "host-a", profile: "opus-skip", questions: [{ n: 1, commands: [COMMAND, "git push origin main"] }] });
  const page = await readPage(`/w/demo/runs/${ASKS}`, ctx);
  assert.deepEqual(ctx.calls, [`demo/${ASKS}`]);
  assert.ok(page.includes("A yes runs, as written:"));
  assert.ok(page.includes("pnpm -C tools cli fc --post 12 --confirm &#x27;site &lt;b&gt;a&lt;/b&gt;&#x27;\ngit push origin main"), "the lines verbatim, as text");
  assert.equal(page.includes("<b>a</b>"), false, "a command line never becomes markup");
  const section = page.indexOf('<h2 class="label">Follow-up</h2>');
  const found = page.indexOf('<h2 class="label">What it found</h2>');
  assert.ok(section !== -1 && section < found, "the card follows the questions");
  const card = textOf(between(page, section, found));
  assert.match(card, /Approve the commands ofQuestion 1 \(2 lines\)/u);
  assert.match(card, /Start follow-up on host-a/u);
  assert.equal(card.includes("Yes, start it"), false, "the confirm box needs the first press");
  assert.match(page, /<input type="checkbox" checked=""/u, "one question with commands: picked");
  assertScriptsCarryNonce(page, "run page with a follow-up card");
});

test("the follow-up card says why it is off and gives the command; a run without commands asks nothing", async () => {
  const ctx = followUpContext({ ready: false, host: "host-a", reason: "gated profile: profile x has permissions gated" });
  const card = textOf(await readPage(`/w/demo/runs/${ASKS}`, ctx));
  assert.match(card, /off A follow-up cannot start from this page: gated profile: profile x has permissions gated/u);
  assert.ok(card.includes(`darius run follow-up ${ASKS} --approve 1 --project demo`));
  assert.equal(card.includes("Start follow-up on"), false);
  const plain = { ...asksContext(null), followUp: () => Promise.resolve<FollowUpReadiness>({ ready: false, host: "host-a", reason: "x" }) };
  const page = await readPage(`/w/demo/runs/${ASKS}`, plain);
  assert.equal(page.includes('<h2 class="label">Follow-up</h2>'), false, "without commands, a card that is off is not shown");
});

test("a complete run with no command question gets a decision card when it is ready (0.65.0)", async () => {
  const base = asksContext(null);
  const ctx: WebContext = { ...base, followUp: () => Promise.resolve<FollowUpReadiness>({ ready: true, host: "host-a", profile: "opus-skip", questions: [] }) };
  const page = await readPage(`/w/demo/runs/${ASKS}`, ctx);
  const card = textOf(page);
  assert.match(card, /Operator decision for the follow-up/u);
  assert.equal(card.includes("Approve the commands of"), false, "no checkboxes without command questions");
  assert.equal(page.includes('type="checkbox"'), false);
  assert.match(card, /Start follow-up on host-a/u);
  assert.match(page, /<button[^>]*disabled=""[^>]*>Start follow-up on host-a/u, "nothing picked and no decision yet");
});

test("on a host without the checkout the follow-up card names the right host and gives the ssh command to copy (0.50.0)", async () => {
  const command = `ssh host-b darius run follow-up ${ASKS} --approve 1 --project demo`;
  const ctx = followUpContext({ ready: false, host: "host-a", reason: `runs on host-b; open this page on host-b, or: ${command}`, rightHost: "host-b", command });
  const page = await readPage(`/w/demo/runs/${ASKS}`, ctx);
  const card = textOf(page);
  assert.match(card, /off This ritual runs on host-b\. Open this page on host-b, or run:/u);
  assert.ok(card.includes(command), "the ssh command, in a copy box");
  assert.ok(page.includes('class="copy"'), "a copy button");
  assert.equal(card.includes("Start follow-up on"), false, "no button: the page never forwards");
});

test("a follow-up links its parent, and the parent lists its follow-ups", async () => {
  const off: FollowUpReadiness = { ready: false, host: "host-a", reason: "x" };
  const child = await readPage(`/w/demo/runs/${ASKS}`, followUpContext(off, { followUpOf: PARENT }));
  assert.match(child, new RegExp(`follows up <a[^>]*href="/w/demo/runs/${PARENT}"[^>]*>run ${PARENT.slice(-8)}</a>`, "u"));
  const parent = await readPage(`/w/demo/runs/${ASKS}`, followUpContext(off, { followUps: [CHILD] }));
  assert.match(textOf(parent), new RegExp(`Follow-ups${CHILD.slice(-8)}`, "u"));
  assert.ok(parent.includes(`href="/w/demo/runs/${CHILD}"`));
});

test("the run page shows the skill hash, 12 characters with the full value in the title, and no row without one", async () => {
  const hash = "0123456789abcdef".repeat(4);
  const withHash: WebContext = { ...context, run: (name, run) => (name === "demo" && run === DONE ? { ...runDetail(RUNS[2]!), skillHash: hash } : null) };
  const shown = await readPage(`/w/demo/runs/${DONE}`, withHash);
  assert.ok(shown.includes(`<code title="${hash}">${hash.slice(0, 12)}</code>`), "short code, full title");
  assert.match(textOf(shown), /Skill hash0123456789ab/u);
  const bare: WebContext = { ...context, run: (name, run) => (name === "demo" && run === DONE ? runDetail(RUNS[2]!) : null) };
  assert.equal((await readPage(`/w/demo/runs/${DONE}`, bare)).includes("Skill hash"), false);
});

test("a result without questions shows no question card and no ack command", async () => {
  const quiet: RunResult = { ...RESULT, status: "ok", questions: [], items: [], actions: [], metrics: [] };
  const ctx: WebContext = { ...context, run: (name, run) => (name === "demo" && run === DONE ? runDetail(RUNS[2]!, quiet) : null) };
  const page = await readPage(`/w/demo/runs/${DONE}`, ctx);
  assert.match(page, /<div class="card card-accent result-banner edge-ok"><span class="status tone-ok">.*?Result ok<\/span>/su);
  for (const absent of ["Questions for you", "What it found", "What it changed", "darius run ack"]) assert.equal(page.includes(absent), false, absent);
});

test("a run that asks: an Asks you card on home, tags in the lists, and no page calls it complete", async () => {
  const ctx = asksContext(null);
  const home = await readPage("/all", ctx);
  assert.equal(h1Of(home), "One thing needs you.");
  assert.match(home, /<h1 class="verdict-h ink-wait">/u, "the waiting tone");
  assert.ok(home.includes('<a href="#needs" class="pill tone-wait">') && home.includes(`<article id="asks-${ASKS}"`), "the strip links the Needs you section, which holds the card");
  const cardAt = home.indexOf(`<article id="asks-${ASKS}"`);
  const card = between(home, cardAt, home.indexOf("</article>", cardAt));
  assert.ok(card.includes("card-accent edge-wait"), "a waiting edge");
  assert.ok(card.includes("Asks you"));
  assert.ok(card.includes(`href="/w/demo/runs/${ASKS}"`), "it opens the run");
  assert.ok(card.includes("Daily &lt;script&gt;alert(1)&lt;/script&gt; report"), "the ritual label");
  assert.ok(card.includes("demo, by timer, 1 question"), "the question count");
  assert.ok(card.includes("Delete the two old landing pages &lt;script&gt;alert(1)&lt;/script&gt; now?") && card.includes("Yes, delete them."), "the question and its recommendation");
  assert.ok(card.includes(`darius run ack ${ASKS} --note &quot;your decision&quot; --project demo`));
  assert.equal(home.includes('id="done-demo-daily-report"'), false, "the run shows once, not also under Last night");
  assert.match(comingOf(await readPage("/rituals", ctx)), /<li class="rw rw-rail tone-wait">.*<span class="rw-state tone-wait">Asks you<\/span>/su, "Coming up says so");
  assert.match(home, /<span class="places-need">1 needs you<\/span>/u, "Places counts the thing that needs you");

  const runs = await readPage("/runs", ctx);
  assert.ok(runs.includes('<span class="chip-x c-late">2 high open</span>'), "open high items");
  assert.ok(runs.includes('<span class="chip-x c-wait">1 question</span>'), "the question, waiting");
  assert.equal(runs.includes("critical open"), false, "no critical item is open");

  const ritual = await readPage("/w/demo/rituals/daily-report", ctx);
  assert.ok(ritual.includes('<h2 class="label">Needs you</h2>'), "the ritual page leads with the question");
  assert.ok(ritual.includes(`darius run ack ${ASKS} --note &quot;your decision&quot; --project demo`));
  assert.ok(ritual.includes('<div class="card card-accent edge-wait">'), "the latest report card waits");

  const project = await readPage("/w/demo", ctx);
  assert.match(project, /id="reports".*?<li class="rw rw-rail tone-wait">.*?Asks you/su, "the latest-report row waits, with a rail");
  for (const page of [home, runs, ritual, project]) assert.equal(page.includes(EVIL), false);
});

test("an answered result: the decision replaces the command, home is quiet, the tag says answered", async () => {
  const ctx = asksContext({ at: "2026-09-28T08:30:00.000Z", who: "owner", note: `yes, delete ${EVIL}` });
  const page = await readPage(`/w/demo/runs/${ASKS}`, ctx);
  assert.ok(page.includes("Answered by owner at 10:30: yes, delete &lt;script&gt;alert(1)&lt;/script&gt;."), "who, when and the decision");
  assert.equal(page.includes("darius run ack"), false, "no command once answered");
  assert.ok(page.includes("card card-accent next edge-idle"), "the question card is quiet");
  assert.ok(page.includes("Complete</span>"), "the run is complete again");
  assert.equal(page.includes(EVIL), false);

  const home = await readPage("/all", ctx);
  assert.equal(h1Of(home), "Nothing needs you.");
  assert.equal(home.includes(`id="asks-`), false);
  assert.match(home, /Last night.*<li id="done-demo-daily-report" class="rw">.*Answered by owner at 10:30/su, "a plain Last night row with the decision");
  assert.equal(home.includes('class="count tone-wait"'), false, "no badge");

  const runs = await readPage("/runs", ctx);
  assert.ok(runs.includes('<span class="chip-x c-idle">1 question, answered</span>'), "answered, in words and without the waiting tone");
});

test("the app can be installed and get push notices: manifest, icons, service worker, and the links to them", async () => {
  const client = join(import.meta.dirname, "..", "web", "build", "client");
  const manifest: { start_url: string; display: string; icons: { src: string; sizes: string; purpose: string }[] } = JSON.parse(readFileSync(join(client, "manifest.webmanifest"), "utf8"));
  assert.equal(manifest.start_url, "/");
  assert.equal(manifest.display, "standalone");
  assert.deepEqual(manifest.icons.map((icon) => `${icon.sizes} ${icon.purpose}`), ["192x192 any", "512x512 any", "512x512 maskable"]);
  for (const icon of manifest.icons) assert.ok(existsSync(join(client, icon.src)), icon.src);
  for (const file of ["apple-touch-icon.png", "badge-72.png"]) assert.ok(existsSync(join(client, file)), file);
  const worker = readFileSync(join(client, "sw.js"), "utf8");
  for (const event of ["push", "notificationclick"]) assert.match(worker, new RegExp(`addEventListener\\("${event}"`, "u"), event);
  assert.doesNotMatch(worker, /addEventListener\("fetch"/u, "no fetch handler: the page is never served from a cache");
  const home = await readPage("/all", context);
  assert.match(home, /<link [^>]*rel="manifest" href="\/manifest.webmanifest"/u);
  assert.match(home, /<link [^>]*rel="apple-touch-icon" href="\/apple-touch-icon.png"/u);
});

test("Coming up and Waiting on an event: dated vigils join the agenda, event vigils wait apart, the same on both pages", async () => {
  const project = STATUS.projects[0]!;
  const dated = { slug: "dated", title: "Dated soak", state: "armed", verdict: null, flagged: false, lastOutcome: null, due: "2026-09-28", until: "the next batch" };
  const event = { slug: "event", title: "Event soak", state: "armed", verdict: null, flagged: false, lastOutcome: null, due: null, until: `the first deploy ${EVIL}` };
  const busy: HostStatus = { ...STATUS, projects: [{ ...project, vigils: [dated, event] }] };
  const read = async (path: string): Promise<string> => (await (await handler(new Request(`http://darius.test${path}`), { ...context, status: () => busy })).text()).replaceAll("<!-- -->", "");
  for (const path of ["/vigils", "/w/demo/vigils"]) {
    const body = await read(path);
    const coming = between(body, body.indexOf('id="coming-up"'), body.indexOf('id="waiting"'));
    assert.ok(coming.includes("Dated soak") && coming.includes("waits for: the next batch"), `${path}: the dated vigil is in Coming up`);
    assert.equal(coming.includes("Event soak"), false, `${path}: the event vigil is not`);
    const waiting = between(body, body.indexOf('id="waiting"'), body.length);
    assert.ok(waiting.includes("Event soak") && waiting.includes("the first deploy &lt;script&gt;"), `${path}: the event vigil waits, as text`);
    assert.equal(waiting.includes(EVIL), false, `${path}: store text stays text`);
  }
  assert.match(await read("/all"), /<a [^>]*href="\/vigils#waiting"[^>]*>.*?<span class="pill-n">2<\/span><span class="pill-l">vigils armed<\/span>/su, "the strip counts armed vigils and links the waiting list");
});

// --- the information architecture (0.39.0, reworked 0.63.0): scopes, Places, tabs, settings -------------

const SETTINGS_COOKIE = "darius-settings";

/** A page read with a settings cookie, the way the browser sends it. */
async function readWith(path: string, settings: Record<string, string>, status: HostStatus = STATUS): Promise<{ status: number; body: string; location: string | null }> {
  const cookie = `${SETTINGS_COOKIE}=${encodeURIComponent(new URLSearchParams(settings).toString())}`;
  const response = await handler(new Request(`http://darius.test${path}`, { headers: { Cookie: cookie } }), { ...context, status: () => status });
  return { status: response.status, body: (await response.text()).replaceAll("<!-- -->", ""), location: response.headers.get("location") };
}

/** A second workspace and the self-test one, next to demo. */
function threeWorkspaces(): HostStatus {
  const demo = STATUS.projects[0]!;
  const other = { ...demo, name: "atlas", rituals: [], runs: [], vigils: [], checkout: null };
  const selftest = { ...demo, name: "darius-selftest", rituals: [], runs: [], vigils: [{ slug: "st", title: "Self-test vigil", state: "open", verdict: null, flagged: true, lastOutcome: "failed", due: "2026-09-27", until: null }], checkout: null };
  return { ...STATUS, projects: [demo, other, selftest] };
}

/** The status and the location of a request that is not followed. */
async function redirectOf(path: string): Promise<[number, string | null]> {
  const response = await handler(new Request(`http://darius.test${path}`), context);
  return [response.status, response.headers.get("location")];
}

test("the old addresses redirect with a 301 to the workspace forms; the query stays", async () => {
  assert.deepEqual(await redirectOf("/p/demo"), [301, "/w/demo"]);
  assert.deepEqual(await redirectOf("/p/ghost"), [301, "/w/ghost"], "the redirect does not look the workspace up; the new address answers 404");
  assert.deepEqual(await redirectOf("/p/demo/rituals/daily-report"), [301, "/w/demo/rituals/daily-report"]);
  assert.deepEqual(await redirectOf(`/p/demo/runs/${DONE}`), [301, `/w/demo/runs/${DONE}`]);
  assert.deepEqual(await redirectOf(`/runs/demo/${DONE}`), [301, `/w/demo/runs/${DONE}`]);
  assert.deepEqual(await redirectOf("/p/my%20project/rituals/a%20b"), [301, "/w/my%20project/rituals/a%20b"]);
  assert.deepEqual(await redirectOf("/runs?project=demo"), [301, "/w/demo/runs"]);
  assert.deepEqual(await redirectOf("/runs?project=demo&state=failed&imported=1"), [301, "/w/demo/runs?state=failed&imported=1"]);
  assert.deepEqual(await redirectOf("/findings?project=demo"), [301, "/w/demo/findings"]);
  assert.deepEqual(await redirectOf("/findings?project=demo&view=all&ritual=daily-report&severity=high"), [301, "/w/demo/findings?view=all&ritual=daily-report&severity=high"]);
  assert.equal((await get("/runs?project=")).status, 200, "an empty project is no filter");
  assert.equal((await get("/w/ghost")).status, 404);
  assert.equal((await get("/w/demo/rituals/daily-report")).status, 200);
});

test("/ is a 302 to the default workspace, or to /all when there is none", async () => {
  const status = threeWorkspaces();
  const plain = await readWith("/", {}, status);
  assert.deepEqual([plain.status, plain.location], [302, "/all"]);
  const set = await readWith("/", { ws: "demo" }, status);
  assert.deepEqual([set.status, set.location], [302, "/w/demo"]);
  const ghost = await readWith("/", { ws: "gone" }, status);
  assert.deepEqual([ghost.status, ghost.location], [302, "/all"], "a default that this host does not have is ignored");
});

/** The opening tag of the first link to an address, or null. */
function linkTo(body: string, href: string): string | null {
  return [...body.matchAll(/<a\b[^>]*>/gu)].map((match) => match[0]).find((tag) => tag.includes(` href="${href}"`)) ?? null;
}

/** The demo workspace with its ritual late by a day and nothing held. */
function lateStatus(status: HostStatus = STATUS): HostStatus {
  const [demo, ...rest] = status.projects;
  return { ...status, projects: [{ ...demo!, rituals: [{ ...demo!.rituals[0]!, heldRun: null }] }, ...rest] };
}

/** The inside of the nav with an aria-label, or "" when the page has none. */
function navOf(body: string, label: string): string {
  const from = body.indexOf(`<nav aria-label="${label}"`);
  return from === -1 ? "" : body.slice(from, body.indexOf("</nav>", from));
}

/** The opening tag of the row of a scope in Places (the brand and the Overview row go to the same address), or null. */
function scopeRow(places: string, href: string): string | null {
  return [...places.matchAll(/<a\b[^>]*>/gu)].map((match) => match[0]).find((tag) => tag.includes("places-scope") && tag.includes(` href="${href}"`)) ?? null;
}

/** The addresses of the links in a piece of HTML, in order. */
function hrefsOf(html: string): string[] {
  return [...html.matchAll(/href="([^"]+)"/gu)].map((match) => match[1] ?? "");
}

test("the frame: a drawer button naming the scope, Places, and five tabs: Overview, Vigils, Rituals, Findings, Milestones", async () => {
  const { body } = await readWith("/w/demo", {}, lateStatus());
  assert.match(body, /<details data-menu="true" class="drawer"><summary class="topbar">.*?<span class="topbar-cap">Workspace<\/span><span class="topbar-now">demo<\/span>/u, "the top bar is the drawer button");
  assert.equal(body.includes("Sections"), false, "no section tabs under a top bar any more");
  assert.equal(body.includes("<footer"), false, "no footer");
  assert.equal(body.includes('class="gear'), false, "no gear in a bar");
  const tabs = navOf(body, "Tabs");
  assert.deepEqual(hrefsOf(tabs), ["/w/demo", "/w/demo/vigils", "/w/demo/rituals", "/w/demo/findings", "/w/demo/milestones"], "the five tabs in order, no Runs");
  assert.ok(linkTo(tabs, "/w/demo")?.includes('aria-current="page"'), "the Overview tab is lit on the Overview");
  assert.equal([...tabs.matchAll(/aria-current/gu)].length, 1, "one tab is lit");
  const all = await get("/milestones");
  const allTabs = navOf(all.body, "Tabs");
  assert.deepEqual(hrefsOf(allTabs), ["/all", "/vigils", "/rituals", "/findings", "/milestones"], "the tabs of all workspaces have plain addresses");
  assert.ok(linkTo(allTabs, "/milestones")?.includes('aria-current="page"'), "the Milestones tab is lit");
  // The badges: vigils due today or late, rituals late.
  const rituals = await readWith("/rituals", {}, lateStatus());
  assert.match(navOf(rituals.body, "Tabs"), /<span class="tab-bdg tone-late" title="1 late">/u, "the ritual is one day late");
  assert.ok(linkTo(navOf(rituals.body, "Tabs"), "/rituals")?.includes('aria-current="page"'), "the Rituals tab is lit");
  assert.equal(rituals.body.includes("due today or late"), false, "no vigil is due today or late");
  assert.match(navOf(rituals.body, "Tabs"), /<span class="tab-bdg tone-wait" title="2 need you">/u, "the Findings tab counts what needs you");
});

test("both navs are in the HTML: the tab bar for a phone and Places for a desktop; the host line ends Places", async () => {
  const { body } = await readWith("/w/demo", {}, lateStatus());
  assert.ok(body.indexOf('aria-label="Places"') !== -1 && body.indexOf('aria-label="Tabs"') !== -1);
  const places = navOf(body, "Places");
  const hostLine = places.slice(places.indexOf('class="places-foot"'));
  assert.match(hostLine.replaceAll(/<[^>]+>/gu, ""), /testhost, darius [^,]+, updated \d\d:\d\d, seen by [^.]+\./u, "host, version, time, viewer");
  assert.ok(places.indexOf('class="places-foot"') > places.indexOf("This host"), "after the host pages");
});

test("Places lists All workspaces and each workspace with what needs you; the scope is expanded to its six places, one lit", async () => {
  const status = threeWorkspaces();
  const { body } = await readWith("/w/demo/rituals", {}, status);
  const places = navOf(body, "Places");
  const names = [...places.matchAll(/<span class="places-name">([^<]+)<\/span>/gu)].map((match) => match[1]);
  assert.deepEqual(names, ["All workspaces", "demo", "Overview", "Vigils", "Rituals", "Findings", "Milestones", "Runs", "atlas", "Status", "Profiles", "Settings"], "the self-test workspace is not listed; only the scope is expanded");
  assert.ok(linkTo(places, "/all") !== null && linkTo(places, "/w/atlas") !== null, "a workspace row opens its Overview");
  assert.ok(scopeRow(places, "/w/demo")?.includes('aria-current="true"'), "the current scope is marked");
  assert.equal(scopeRow(places, "/w/atlas")?.includes("aria-current"), false, "another scope is not");
  assert.ok(linkTo(places, "/w/demo/rituals")?.includes('aria-current="page"'), "the Rituals row is lit");
  assert.equal([...places.matchAll(/aria-current="page"/gu)].length, 1, "one row is lit");
  assert.match(places, /<span class="places-need">2 need you<\/span>/u, "the count of a workspace");
  assert.match(places, /<span class="places-clear">all clear<\/span>/u, "a quiet workspace says so");
  assert.match(places, /<span class="tab-bdg tone-wait" title="2 need you">/u, "the section rows carry the badges of the tabs");
  assert.deepEqual(hrefsOf(places.slice(places.indexOf("This host"))).slice(0, 3), ["/status", "/profiles", "/settings"]);
  assert.equal(body.includes('class="topbar-dot"'), false, "no red square: the workspace you are in is the one that needs you");
  const other = await readWith("/w/atlas", {}, status);
  assert.ok(other.body.includes('class="topbar-dot"'), "a red square on the button when another workspace needs you");
  const all = await readWith("/all", {}, status);
  assert.equal(all.body.includes('class="topbar-dot"'), false, "All workspaces already holds every workspace");
});

test("the lit row of Places follows the page: a run lights its item's section, a host page lights its own row", async () => {
  const lit = (body: string): string[] => [...navOf(body, "Places").matchAll(/<a\b[^>]*aria-current="page"[^>]*href="([^"]+)"/gu)].map((match) => match[1] ?? "");
  const litTabs = (body: string): string[] => [...navOf(body, "Tabs").matchAll(/<a\b[^>]*aria-current="page"[^>]*href="([^"]+)"/gu)].map((match) => match[1] ?? "");
  const ritualRun = await get(`/w/demo/runs/${DONE}`);
  assert.deepEqual(lit(ritualRun.body), ["/w/demo/rituals"], "a ritual run lights Rituals");
  assert.deepEqual(litTabs(ritualRun.body), ["/w/demo/rituals"]);
  const runs = await get("/w/demo/runs");
  assert.deepEqual(lit(runs.body), ["/w/demo/runs"], "the Runs list lights Runs");
  assert.deepEqual(litTabs(runs.body), [], "Runs is not a tab");
  const ritual = await get("/w/demo/rituals/daily-report");
  assert.deepEqual(lit(ritual.body), ["/w/demo/rituals"]);
  const milestone = await get("/w/demo/milestones/M7");
  assert.deepEqual(litTabs(milestone.body), ["/w/demo/milestones"]);
  const status = await get("/status");
  assert.deepEqual(lit(status.body), ["/status"], "Status lights its row");
  assert.deepEqual(litTabs(status.body), [], "no tab on a host page");
  assert.deepEqual(lit((await get("/settings/backups")).body), ["/settings"], "every settings tab lights Settings");
});

test("a host page points the tabs and Places at the last scope: the cookie darius_scope", async () => {
  const status = threeWorkspaces();
  const read = async (path: string, scope: string | null): Promise<string> => {
    const headers = scope === null ? undefined : { Cookie: `darius_scope=${encodeURIComponent(scope)}` };
    return (await (await handler(new Request(`http://darius.test${path}`, { headers }), { ...context, status: () => status })).text()).replaceAll("<!-- -->", "");
  };
  const atlas = await read("/status", "atlas");
  assert.deepEqual(hrefsOf(navOf(atlas, "Tabs")), ["/w/atlas", "/w/atlas/vigils", "/w/atlas/rituals", "/w/atlas/findings", "/w/atlas/milestones"]);
  assert.ok(scopeRow(navOf(atlas, "Places"), "/w/atlas")?.includes('aria-current="true"'), "the last scope is the marked one");
  assert.match(atlas, /<span class="topbar-cap">Host<\/span><span class="topbar-now">testhost<\/span>/u, "a host page names the host");
  assert.deepEqual(hrefsOf(navOf(await read("/profiles", "*"), "Tabs")), ["/all", "/vigils", "/rituals", "/findings", "/milestones"], "* is all workspaces");
  const ghost = await read("/settings", "gone");
  assert.equal(hrefsOf(navOf(ghost, "Tabs"))[0], "/all", "a workspace this host lacks is ignored: no default, so all workspaces");
  const withDefault = await readWith("/status", { ws: "demo" }, status);
  assert.equal(hrefsOf(navOf(withDefault.body, "Tabs"))[0], "/w/demo", "no cookie: the default workspace");
  assert.equal(hrefsOf(navOf((await get("/nope")).body, "Tabs"))[0], "/all", "an unknown path has no scope: the last one");
});

test("an error page offers a way back to the last scope", async () => {
  const response = await handler(new Request("http://darius.test/nope", { headers: { Cookie: "darius_scope=demo" } }), context);
  const body = (await response.text()).replaceAll("<!-- -->", "");
  assert.match(body, /<a class="back" href="\/w\/demo"/u, "the link goes to the Overview of the last scope");
  assert.ok(body.includes("Back to demo"));
  assert.ok((await get("/nope")).body.includes("Back to All workspaces"));
});

test("a section page covers one scope: a workspace, or all of them", async () => {
  const status = threeWorkspaces();
  const extra = { ...status.projects[1]!, rituals: [{ ...status.projects[0]!.rituals[0]!, slug: "atlas-ritual", title: "Atlas ritual", heldRun: null }], vigils: [{ slug: "av", title: "Atlas vigil", state: "open", verdict: null, flagged: false, lastOutcome: null, due: "2026-09-29", until: null }] };
  const two: HostStatus = { ...status, projects: [status.projects[0]!, extra, status.projects[2]!] };
  const one = await readWith("/w/demo/rituals", {}, two);
  assert.ok(one.body.includes("Daily &lt;script&gt;") && !one.body.includes("Atlas ritual"), "one workspace: only its rituals");
  const everything = await readWith("/rituals", {}, two);
  assert.ok(everything.body.includes("Atlas ritual") && everything.body.includes("Daily &lt;script&gt;"), "all workspaces: every ritual");
  assert.ok(everything.body.includes("<span>All workspaces</span>"), "the head names the scope");
  const vigils = await readWith("/w/atlas/vigils", {}, two);
  assert.ok(vigils.body.includes("Atlas vigil") && !vigils.body.includes("Guard soak"), "vigils of one workspace");
  assert.equal(vigils.body.includes("Self-test vigil"), false, "never the self-test workspace");
});

test("showSelftest hides the self-test workspace from Places, the badges and the all-workspaces lists", async () => {
  const status = threeWorkspaces();
  const off = await readWith("/vigils", {}, status);
  assert.equal(off.body.includes("Self-test vigil"), false, "no row in the all-workspaces list");
  assert.equal(off.body.includes('<span class="places-name">darius-selftest</span>'), false, "not in Places");
  assert.equal(off.body.includes("due today or late"), false, "not in the badge");
  assert.equal(h1Of((await readWith("/all", {}, status)).body), "Two things need you.", "not in the verdict");
  assert.ok(navOf((await readWith("/all", {}, status)).body, "Places").includes("Self-test:"), "its line stays in the host line of Places");
  const on = await readWith("/vigils", { selftest: "1" }, status);
  assert.ok(on.body.includes("Self-test vigil"), "the row shows");
  assert.ok(on.body.includes('<span class="places-name">darius-selftest</span>'), "it is in Places");
  assert.match(on.body, /<span class="tab-bdg tone-wait" title="1 due today or late">/u, "it counts");
  assert.equal(h1Of((await readWith("/all", { selftest: "1" }, status)).body), "Three things need you.", "and needs you");
  assert.equal((await readWith("/w/darius-selftest", {}, status)).status, 200, "its own address always works");
});

test("/all is always all workspaces, whatever the default workspace is", async () => {
  const status = threeWorkspaces();
  const plain = await readWith("/all", {}, status);
  assert.match(plain.body, /<span class="topbar-now">All workspaces<\/span>/u, "no default: all workspaces");
  const set = await readWith("/w/demo", { ws: "demo" }, status);
  assert.match(set.body, /<span class="topbar-now">demo<\/span>/u, "the default workspace");
  assert.ok(set.body.includes("/home/test/demo"), "it is the workspace Overview, with its checkout");
  assert.ok(linkTo(set.body, "/all") !== null, "all workspaces have an address of their own");
  const all = await readWith("/all", { ws: "demo" }, status);
  assert.match(all.body, /<span class="topbar-now">All workspaces<\/span>/u);
  assert.equal(h1Of(all.body), "Two things need you.");
  const ghost = await readWith("/all", { ws: "gone" }, status);
  assert.match(ghost.body, /<span class="topbar-now">All workspaces<\/span>/u, "a default that this host does not have is ignored");
});

test("the status page: strip, machine, hosts, a link to the backups, and no backup controls", async () => {
  const page = await get("/status");
  assert.equal(page.status, 200);
  const body = page.body;
  for (const text of ["Status", "other-host", "this host", "never", "sync-bucket", "Machine", "Hosts", "Projects and syncs", "since backup"]) {
    assert.ok(body.includes(text), `the status page shows: ${text}`);
  }
  for (const text of ["Back up now", "Snapshots", "Test the bucket", "Delete in bucket", "bk-secret", "DARIUS_SNAPSHOT_ENDPOINT"]) {
    assert.equal(body.includes(text), false, `the status page leaves out: ${text}`);
  }
  assert.ok(linkTo(body, "/settings/backups") !== null, "the pill and the notice link to the backups");
  assert.match(body, /<a\b[^>]*href="\/settings\/backups"[^>]*>(?:(?!<\/a>).)*since backup/u, "the since backup pill is a link");
  assert.ok(body.includes("One thing blocks backups."), "the backup problem shows as a one line notice");
  assert.equal(body.includes(EVIL), false, "store text never becomes a tag");
  assert.equal(body.includes(SECRET), false, "no secret on the page");
  assert.ok(linkTo(navOf(body, "Places"), "/status")?.includes('aria-current="page"'), "the Status row of Places is lit");
  assert.ok(linkTo(navOf((await get("/settings")).body, "Places"), "/status") !== null, "the Status row is on every page");
  assertScriptsCarryNonce(body, "/status");
});

/** The opening tag of the link in the settings tab row that goes to an address, or null. */
function settingsTab(body: string, href: string): string | null {
  const from = body.indexOf('aria-label="Settings sections"');
  if (from === -1) return null;
  return linkTo(body.slice(from, body.indexOf("</nav>", from)), href);
}

test("the settings tabs: a row of four, one lit, the other tabs' content not drawn", async () => {
  const general = (await get("/settings")).body;
  const hrefs = [...general.slice(general.indexOf('aria-label="Settings sections"')).matchAll(/href="([^"]+)"/gu)].slice(0, 4).map((match) => match[1]);
  assert.deepEqual(hrefs, ["/settings", "/settings/notifications", "/settings/backups", "/settings/about"], "the four tabs in order");
  assert.ok(settingsTab(general, "/settings")?.includes('aria-current="page"'), "General is lit on /settings");
  assert.equal(settingsTab(general, "/settings/backups")?.includes("aria-current"), false, "Backups is not lit on /settings");
  for (const text of ["Appearance", "Default workspace"]) assert.ok(general.includes(text), `General shows: ${text}`);
  for (const text of ["Back up now", "Test the bucket", "Seen by"]) assert.equal(general.includes(text), false, `General leaves out: ${text}`);

  const backups = (await get("/settings/backups")).body;
  assert.ok(settingsTab(backups, "/settings/backups")?.includes('aria-current="page"'), "Backups is lit on /settings/backups");
  assert.equal(settingsTab(backups, "/settings")?.includes("aria-current"), false, "General is not lit under it");
  assert.ok(linkTo(navOf(backups, "Places"), "/settings")?.includes('aria-current="page"'), "the Settings row of Places is lit on a settings tab");
  for (const text of ["Appearance", "Default workspace", "Seen by"]) assert.equal(backups.includes(text), false, `Backups leaves out: ${text}`);

  const notifications = (await get("/settings/notifications")).body;
  assert.ok(settingsTab(notifications, "/settings/notifications")?.includes('aria-current="page"'), "Notifications is lit");
  assert.equal(notifications.includes("Back up now"), false, "the backup controls stay on their own tab");
});

test("the backups tab: an env-locked field, no secret, the controls", async () => {
  const page = await get("/settings/backups");
  assert.equal(page.status, 200);
  const body = page.body;
  for (const text of ["Backups", "Back up now", "Snapshots", "this host", "not on this host", "bucket", "darius-testhost-20260928T070000Z.tar.gz", "50 MiB", "Delete here", "Delete in bucket", "Set by the environment", "DARIUS_SNAPSHOT_ENDPOINT", "Reset to default", "saved on this host", "Remove the saved key", "Test the bucket", "Set these with environment variables", "DARIUS_SNAPSHOT_SECRET_ACCESS_KEY", "/home/test/.config/darius/web.env", "tar -xzf", "Copies go to bucket"]) {
    assert.ok(body.includes(text), `the backups tab shows: ${text}`);
  }
  const input = (id: string): string => [...body.matchAll(/<input\b[^>]*>/gu)].map((match) => match[0]).find((tag) => tag.includes(`id="${id}"`)) ?? "";
  assert.match(input("bk-set-endpoint"), /\bdisabled\b/u, "the endpoint is set by the environment, so its field is disabled");
  assert.doesNotMatch(input("bk-set-bucket"), /\bdisabled\b/u, "a saved field stays editable");
  assert.match(input("bk-secret"), /type="password"/u, "the secret field is a password field");
  assert.match(input("bk-secret"), /autoComplete="off"|autocomplete="off"/u, "the browser is told not to remember it");
  assert.doesNotMatch(input("bk-secret"), /\bvalue="[^"]/u, "the secret field is never prefilled");
  assert.equal(body.includes(SECRET), false, "no secret on the page");
  assert.equal(body.includes(EVIL), false, "store text never becomes a tag");
  assert.ok(body.includes("the folder is not writable &lt;script&gt;alert(1)&lt;/script&gt;"), "a problem shows, escaped");
  assert.match(body, /<button(?![^>]*\bdisabled\b)[^>]*>Back up now<\/button>/u, "the Back up now button is on while nothing runs");
  const secretAt = body.indexOf('id="bk-secret"');
  assert.ok(secretAt !== -1 && body.lastIndexOf("<form", secretAt) === -1, "the key pair sits in no form, so an early Enter cannot send the secret in a URL");
  assertScriptsCarryNonce(body, "/settings/backups");
});

/** The settings row around the control with this id: from its opening tag to the next row. */
function settingRow(body: string, id: string): string {
  const at = body.indexOf(`id="${id}"`);
  const starts = [...body.matchAll(/<div class="st-row(?: st-row-inline)?">/gu)].map((match) => match.index);
  const start = starts.findLast((index) => index < at) ?? 0;
  const end = starts.find((index) => index > at);
  return body.slice(start, end);
}

test("the backups tab: a marker only where a value is not the default", async () => {
  const body = (await get("/settings/backups")).body.replaceAll("<!-- -->", "");
  for (const id of ["bk-set-region", "bk-set-keep", "bk-set-dir", "bk-set-prefix"]) {
    const row = settingRow(body, id);
    assert.ok(row.includes(`id="${id}"`), `${id}: the row is found`);
    assert.equal(row.includes("st-mark"), false, `${id}: a default value carries no marker`);
    assert.equal(/\bdefault\b/iu.test(row.replace(/Reset to default/gu, "")), false, `${id}: no "default" badge`);
  }
  const bucket = settingRow(body, "bk-set-bucket");
  assert.ok(bucket.includes("Saved here") && bucket.includes("Reset to default"), "a value saved here says so and can be reset");
  const endpoint = settingRow(body, "bk-set-endpoint");
  assert.ok(endpoint.includes("Set by the environment") && endpoint.includes("DARIUS_SNAPSHOT_ENDPOINT"), "an environment value names its variable");
  assert.equal(endpoint.includes("Reset to default"), false, "an environment value cannot be reset here");
});

test("the backups tab: the remote copy says at once whether there is one", async () => {
  const set = (await get("/settings/backups")).body.replaceAll("<!-- -->", "");
  assert.ok(set.includes("Copies go to bucket"), "a remote copy shows its bucket in the summary");
  assert.match(set, /<div id="[^"]+" hidden="">/u, "the remote fields start folded");
  assert.match(set, /aria-expanded="false"[^>]*>Change<\/button>/u, "one button opens them");

  const none: BackupsStatus = { ...BACKUPS, remoteConfigured: false, remote: null, settings: { ...BACKUPS.settings, endpoint: { value: "", source: "default" }, bucket: { value: "", source: "default" } } };
  const response = await handler(new Request("http://darius.test/settings/backups"), { ...context, backups: () => none });
  const body = (await response.text()).replaceAll("<!-- -->", "");
  assert.ok(body.includes("No remote copy set up. Snapshots stay on this host only."), "no remote copy is said plainly");
  assert.match(body, /aria-expanded="false"[^>]*>Set up a remote copy<\/button>/u, "the button offers to set one up");
  assert.equal(body.includes(">Test the bucket</button>"), false, "no bucket test without a bucket");
});

function count(body: string): number {
  return body.split('aria-label="Close the finding').length - 1;
}

test("the findings page: the view, project, ritual and severity filters, closed and fixed rows without a Close button, store text as text", async () => {
  const needs = await get("/findings");
  assert.ok(needs.body.includes("Tax rate missing") && needs.body.includes("Broken"), "the default view lists what needs you");
  assert.equal(needs.body.includes("Old banner"), false);
  assert.equal(count(needs.body), 2, "a Close button on each");
  const open = await get("/findings?view=open");
  assert.ok(open.body.includes("Old banner") && open.body.includes("Old feed") && open.body.includes(">stale<"));
  assert.equal(open.body.includes("Shut thing"), false);
  const all = await get("/findings?view=all");
  assert.ok(all.body.includes("Shut thing") && all.body.includes("Done thing"));
  assert.equal(count(all.body), 4, "no Close button on a closed or a fixed finding");
  assert.ok(all.body.includes("Closed by op"), "the fold says who closed it");
  const severe = await get("/findings?view=open&severity=critical");
  assert.ok(severe.body.includes("Tax rate missing") && !severe.body.includes("Old banner"));
  const none = await get("/w/demo/findings?ritual=nothing");
  assert.ok(none.body.includes("No finding matches this filter."));
  const quiet = await handler(new Request("http://darius.test/findings"), { ...context, findings: () => Promise.resolve([]) });
  assert.ok((await quiet.text()).includes("Nothing needs you."));
  const strip = (await get("/all")).body.replaceAll("<!-- -->", "");
  assert.match(strip, /href="\/findings"[^>]*>.*?<span class="pill-n">2<\/span><span class="pill-l">findings<\/span>/su, "the status strip counts them and opens the page");
  assert.match((await get("/w/demo")).body.replaceAll("<!-- -->", ""), /href="\/w\/demo\/findings"/u);
  assert.ok((await get("/vigils")).body.includes('href="/findings"'), "the Findings tab");
});

test("the run page shows an item's key and the needs-code state", async () => {
  const result: RunResult = {
    v: 1,
    status: "attention",
    summary: "one thing",
    metrics: [],
    items: [{ key: "link-12", title: "Broken link", severity: "high", state: "needs-code" }],
    questions: [],
    actions: [],
  };
  const response = await handler(new Request(`http://darius.test/w/demo/runs/${DONE}`), { ...context, run: (project, run) => (project === "demo" && run === DONE ? runDetail(RUNS[2]!, result) : null) });
  const body = (await response.text()).replaceAll("<!-- -->", "");
  assert.ok(body.includes("needs code") && body.includes("key link-12"));
});

const lib = await import("../web/app/lib/findings.ts");

test("findings filter logic: views, narrowing, facet options, addresses and words", () => {
  const read = (search: string) => lib.readQuery(new URLSearchParams(search));
  assert.deepEqual(read(""), lib.DEFAULT_QUERY);
  assert.deepEqual(read("view=bogus&severity=bogus"), lib.DEFAULT_QUERY, "unknown values read as no filter");
  const keys = (query: string) => lib.filterFindings(FINDINGS, read(query)).map((row) => row.key);
  assert.deepEqual(keys(""), ["link-12", "tax-1"]);
  assert.deepEqual(keys("view=open"), ["link-12", "tax-1", "banner-3", "feed-9"]);
  assert.equal(keys("view=all").length, 6);
  assert.deepEqual(keys("view=all&severity=low"), ["feed-9"]);
  assert.deepEqual(keys("view=all&ritual=other"), []);
  assert.deepEqual(keys("view=all&project=demo&ritual=daily-report&severity=critical"), ["tax-1"]);
  const query = read("view=open");
  assert.deepEqual([lib.viewCount(FINDINGS, query, "needs-you"), lib.viewCount(FINDINGS, query, "open"), lib.viewCount(FINDINGS, query, "all")], [2, 4, 6]);
  assert.deepEqual(lib.facetOptions(FINDINGS, query, "severity"), ["critical", "high", "medium", "low"], "worst first, only those in the view");
  assert.deepEqual(lib.facetOptions(FINDINGS, read("severity=low"), "severity"), ["critical", "high", "low"], "a chosen value stays; the others come from the other filters");
  assert.deepEqual(lib.facetOptions(FINDINGS, read(""), "ritual"), ["daily-report"]);
  assert.equal(lib.findingsHref(null, lib.DEFAULT_QUERY), "/findings");
  assert.equal(lib.findingsHref("demo", { view: "open", project: "", ritual: "daily-report", severity: "high" }), "/w/demo/findings?view=open&ritual=daily-report&severity=high");
  assert.equal(lib.filterText(read("view=open&project=demo&severity=high"), null), "Open findings in demo, severity high, worst first.");
  assert.equal(lib.filterText(read(""), "demo"), "Findings that need you in demo, worst first.");
  assert.deepEqual([lib.emptyText(read("")), lib.emptyText(read("view=open")), lib.emptyText(read("severity=low"))], ["Nothing needs you.", "No open findings.", "No finding matches this filter."]);
});

/** The opening tags of the links inside the `Filter` nav of a page, as [href, tag]. */
function filterLinks(body: string): [string, string][] {
  const from = body.indexOf('aria-label="Filter"');
  const nav = body.slice(from, body.indexOf("</nav>", from));
  return [...nav.matchAll(/<a\b[^>]*>/gu)].map((match): [string, string] => [/href="([^"]+)"/u.exec(match[0])?.[1] ?? "", match[0]]);
}

test("on the all-workspaces Findings and Runs pages the chip row is Workspace, and each chip changes scope", async () => {
  const status = threeWorkspaces();
  const atlas = status.projects[1]!;
  const withAtlas: HostStatus = { ...status, projects: [status.projects[0]!, { ...atlas, runs: [{ ...RUNS[2]!, run: "01KHHHHHHHHHHHHHHHHHHHHHHH" }] }, status.projects[2]!] };
  const ctx: WebContext = { ...context, status: () => withAtlas, findings: () => Promise.resolve([...FINDINGS, finding("atlas-1", { project: "atlas", severity: "high", status: "needs-you", state: "needs-code" })]) };
  const read = async (path: string): Promise<string> => (await (await handler(new Request(`http://darius.test${path}`), ctx)).text()).replaceAll("<!-- -->", "");
  const findings = await read("/findings?view=open");
  assert.ok(findings.includes('aria-label="Workspace"') && !findings.includes('aria-label="Project"'), "the row is named Workspace");
  const chips = new Set(filterLinks(findings).map(([link]) => link));
  assert.ok(chips.has("/w/demo/findings?view=open") && chips.has("/w/atlas/findings?view=open"), "a chip opens the findings of that workspace, and keeps the view");
  assert.ok(filterLinks(findings).some(([link, tag]) => link === "/findings?view=open" && tag.includes('aria-current="true"')), "all workspaces is the lit chip");
  const workspace = await read("/w/atlas/findings");
  assert.equal(workspace.includes('aria-label="Workspace"'), false, "a workspace page has no workspace row");
  const runs = await read("/runs?state=failed");
  assert.ok(runs.includes('aria-label="Workspace"') && !runs.includes('aria-label="Project"'));
  const links = new Set(filterLinks(runs).map(([link]) => link));
  assert.ok(links.has("/runs?state=failed") && links.has("/w/demo/runs?state=failed") && links.has("/w/atlas/runs?state=failed"), "the chips keep the state filter and change scope");
  const one = await read("/w/atlas/runs");
  assert.equal(one.includes('aria-label="Workspace"'), false, "no workspace row inside a workspace");
  assert.ok(filterLinks(one).some(([link]) => link === "/w/atlas/runs?state=failed"), "the state chips stay in the workspace");
});

/** The part of a page from one section's opening tag to the next section. */
function sectionOf(body: string, id: string): string {
  const from = body.indexOf(`id="${id}"`);
  assert.ok(from !== -1, `the page has a section ${id}`);
  const next = body.indexOf("<section", from);
  return body.slice(from, next === -1 ? undefined : next);
}

function homesStatus(): HostStatus {
  const demo = STATUS.projects[0]!;
  const atlas = { ...demo, name: "atlas", rituals: [{ ...demo.rituals[0]!, slug: "sweep", title: "Atlas sweep", heldRun: null, overdueDays: 0, isDue: false, nextDue: "2026-10-02" }], runs: [], vigils: [], checkout: null };
  const spaced = { ...demo, name: "my shop", rituals: [], runs: [], vigils: [], checkout: null };
  const broken = { ...demo, name: "broken", rituals: [], runs: [], vigils: [], checkout: null, error: "cannot read the store" };
  const selftest = { ...demo, name: "darius-selftest", rituals: [], runs: [], vigils: [], checkout: null };
  return { ...STATUS, projects: [demo, atlas, spaced, broken, selftest] };
}

test("/all lists each workspace but the self-test one, the ones that need you first, each with a working link", async () => {
  const status = homesStatus();
  const { body } = await readWith("/all", {}, status);
  const list = sectionOf(body, "workspaces");
  assert.ok(body.indexOf('id="needs"') < body.indexOf('id="workspaces"'), "after Needs you");
  assert.ok(list.includes(">Workspaces<"));
  const names = [...list.matchAll(/<a [^>]*class="rw-title"[^>]*>([^<]*)<\/a>/gu)].map((match) => match[1]);
  assert.deepEqual(names, ["demo", "broken", "atlas", "my shop"], "needs first (demo 2, broken 1), then by name; no self-test workspace");
  assert.match(list, />2 need you</u, "a count in the wait tone");
  assert.match(list, /rw-state tone-wait">2 need you</u);
  assert.match(list, /rw-state tone-bad">unreadable</u);
  assert.match(list, /rw-state tone-idle">all clear</u);
  assert.ok(list.includes("Next: Atlas sweep, Fri 2 Oct"), "one quiet line for what is next");
  assert.equal(/class="rw-title"[^>]*>darius-selftest/u.test(list), false);
  for (const link of ["/w/demo", "/w/broken", "/w/atlas", "/w/my%20shop"]) {
    assert.ok(linkTo(list, link)?.includes('class="rw-title"'), `${link} is the name of a row`);
    const page = await readWith(link, {}, status);
    assert.equal(page.status, 200, `${link} opens`);
  }
});

test("/all with no workspace says how to link one", async () => {
  const { body } = await readWith("/all", {}, { ...STATUS, projects: [] });
  assert.ok(sectionOf(body, "workspaces").includes("No workspace is linked on this host. Run darius link in a checkout."));
});

test("a workspace Overview has no Workspaces list; its facts end the rail and All runs opens its runs", async () => {
  const { body } = await readWith("/w/demo", {}, homesStatus());
  assert.equal(body.includes('id="workspaces"'), false);
  const rail = body.slice(body.indexOf('<aside class="board-rail">'));
  const facts = rail.indexOf("sec-facts");
  assert.ok(facts !== -1, "the facts are in the rail");
  assert.ok(facts > rail.indexOf('class="health'), "below the health line");
  assert.ok(rail.slice(facts).includes("/home/test/demo") && rail.slice(facts).includes("at most report mode") && rail.slice(facts).includes("synced"));
  assert.equal(body.slice(0, body.indexOf('<aside class="board-rail">')).includes("/home/test/demo"), false, "nothing of it under the verdict");
  assert.ok(linkTo(body, "/w/demo/runs")?.length, "All runs opens the runs of the workspace");
  assert.ok(body.includes(">All runs<"));
});

// --- the navigation crawl (0.63.0): every link a page offers leads somewhere real ---------------------

const crawlPaths = await import("../web/app/lib/paths.ts");

/** Decode the entities React writes into an attribute. */
function unescapeAttribute(value: string): string {
  return value.replaceAll("&amp;", "&").replaceAll("&quot;", '"').replaceAll("&#x27;", "'").replaceAll("&lt;", "<").replaceAll("&gt;", ">");
}

/** The addresses of the links in a piece of HTML, entities decoded. */
function anchorsOf(html: string): string[] {
  return [...html.matchAll(/<a\b[^>]*?\shref="([^"]*)"/gu)].map((match) => unescapeAttribute(match[1] ?? ""));
}

/** The inside of main, or "". */
function mainOf(body: string): string {
  const from = body.indexOf("<main");
  return from === -1 ? "" : body.slice(from, body.indexOf("</main>", from));
}

/** Every id in a page. */
function idsOf(body: string): Set<string> {
  return new Set([...body.matchAll(/\sid="([^"]+)"/gu)].map((match) => unescapeAttribute(match[1] ?? "")));
}

/** The scope a page belongs to: its own, or the one in the cookie for a page with none. */
function crawlScopeOf(path: string, cookieScope: string): string | null {
  const place = crawlPaths.placeOf(new URL(path, "http://darius.test").pathname);
  return place.kind === "host" || place.kind === "unknown" ? cookieScope : place.scope;
}

interface Crawl {
  path: string;
  /** How many tabs must be lit, and the address of the lit one when it is one. */
  lit: string | null;
}

const CRAWL: Crawl[] = [
  { path: "/all", lit: "/all" },
  { path: "/w/demo", lit: "/w/demo" },
  { path: "/w/demo/rituals", lit: "/w/demo/rituals" },
  { path: "/w/demo/findings?view=all", lit: "/w/demo/findings" },
  { path: "/w/demo/runs", lit: null },
  { path: "/w/demo/rituals/daily-report", lit: "/w/demo/rituals" },
  { path: `/w/demo/runs/${DONE}`, lit: "/w/demo/rituals" },
  { path: `/w/demo/runs/${HELD}`, lit: "/w/demo/rituals" },
  { path: "/w/demo/milestones/M7", lit: "/w/demo/milestones" },
  { path: "/status", lit: null },
  { path: "/settings/backups", lit: null },
  { path: "/profiles", lit: null },
  { path: "/nope", lit: null },
];

test("the navigation crawl: every link in Places, Tabs, Breadcrumb and main leads to a real page in the same scope", async () => {
  const status = threeWorkspaces();
  const request = (path: string): Promise<Response> => handler(new Request(`http://darius.test${path}`, { headers: { Cookie: "darius_scope=demo" } }), { ...context, status: () => status });
  const pages = new Map<string, { status: number; body: string; location: string | null }>();
  const read = async (path: string): Promise<{ status: number; body: string; location: string | null }> => {
    const known = pages.get(path);
    if (known !== undefined) return known;
    const response = await request(path);
    const page = { status: response.status, body: (await response.text()).replaceAll("<!-- -->", ""), location: response.headers.get("location") };
    pages.set(path, page);
    return page;
  };
  const checked = new Set<string>();

  for (const { path, lit } of CRAWL) {
    const { body } = await read(path);
    const places = navOf(body, "Places");
    const tabs = navOf(body, "Tabs");
    const crumbs = navOf(body, "Breadcrumb");
    const scope = crawlScopeOf(path, "demo");

    for (const [region, html] of [["Places", places], ["Tabs", tabs], ["Breadcrumb", crumbs], ["main", mainOf(body)]] as const) {
      for (const address of anchorsOf(html)) {
        if (/^(?:https?:|mailto:)/u.test(address)) continue;
        const target = address.startsWith("#") ? path.split("#")[0]! : address.split("#")[0]!;
        const fragment = address.includes("#") ? decodeURIComponent(address.slice(address.indexOf("#") + 1)) : "";
        const key = `${path} ${region} ${address}`;
        if (checked.has(key)) continue;
        checked.add(key);
        let landed = await read(target);
        // 1) 200, or a 301 to a URL that answers 200.
        if (landed.status === 301) {
          assert.ok(landed.location !== null, `${key}: a 301 names a place`);
          landed = await read(landed.location);
        }
        assert.equal(landed.status, 200, `${key}: the link answers 200`);
        // 2) a #fragment is an id on the page it opens.
        if (fragment !== "") assert.ok(idsOf(landed.body).has(fragment), `${key}: #${fragment} is an id on ${target}`);
      }
    }

    // 3) tabs and breadcrumbs keep the scope of the page (host and error pages: the cookie scope).
    for (const [region, html] of [["Tabs", tabs], ["Breadcrumb", crumbs]] as const) {
      for (const address of anchorsOf(html)) {
        const place = crawlPaths.placeOf(address.split(/[?#]/u)[0]!);
        assert.equal(place.scope, scope, `${path} ${region} ${address}: the scope stays ${scope ?? "All workspaces"}`);
      }
    }

    // 4) one lit tab, or none.
    const litTabs = [...tabs.matchAll(/<a\b[^>]*aria-current="page"[^>]*\shref="([^"]+)"|<a\b[^>]*\shref="([^"]+)"[^>]*aria-current="page"/gu)].map((match) => match[1] ?? match[2] ?? "");
    assert.deepEqual(litTabs, lit === null ? [] : [lit], `${path}: the lit tab`);
    assert.ok(tabs !== "", `${path}: the tab bar is there`);

    // 5) Places lists every workspace but the self-test one, and marks the current scope.
    const rows = [...places.matchAll(/<a\b[^>]*places-scope[^>]*>/gu)].map((match) => match[0]);
    const scopeHrefs = rows.map((row) => /\shref="([^"]+)"/u.exec(row)?.[1] ?? "").filter((address) => address === "/all" || /^\/w\/[^/]+$/u.test(address));
    assert.deepEqual(new Set(scopeHrefs), new Set(["/all", "/w/demo", "/w/atlas"]), `${path}: Places lists All workspaces and each workspace, not the self-test one`);
    const marked = rows.filter((row) => row.includes('aria-current="true"')).map((row) => /\shref="([^"]+)"/u.exec(row)?.[1]);
    assert.deepEqual(marked, [scope === null ? "/all" : crawlPaths.href({ to: "overview", ws: scope })], `${path}: Places marks the current scope`);
    assert.ok([...places.matchAll(/aria-current="page"/gu)].length <= 1, `${path}: at most one row is lit`);
  }
  assert.ok(checked.size > 100 && [...checked].some((key) => key.includes("#")), "the crawl follows many links, fragments among them");
});

test("the crawl reads the scope from the cookie on a host page, and a section page ignores it", async () => {
  const status = threeWorkspaces();
  const read = async (path: string, scope: string): Promise<string> => (await (await handler(new Request(`http://darius.test${path}`, { headers: { Cookie: `darius_scope=${scope}` } }), { ...context, status: () => status })).text()).replaceAll("<!-- -->", "");
  assert.equal(anchorsOf(navOf(await read("/status", "atlas"), "Tabs"))[0], "/w/atlas");
  assert.equal(anchorsOf(navOf(await read("/w/demo/vigils", "atlas"), "Tabs"))[0], "/w/demo", "the page wins over the cookie");
});
