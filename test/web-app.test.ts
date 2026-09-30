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

import type { Acknowledgement, HostStatus, RitualDetail, RunDetail, RunResult, RunResultSummary, RunRow, WebContext, WebHandler } from "../src/web/api.ts";

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
      error: null,
    },
  ],
};

const RITUAL: RitualDetail = {
  project: "demo",
  row: STATUS.projects[0]!.rituals[0]!,
  anchor: "due",
  policy: { mode: "report", may: ["git fetch"], hold: ["git push"], notes: "Be brief.", model: null, maxTurns: 40, profile: "careful" },
  body: [
    { kind: "heading", level: 1, content: [{ kind: "text", text: "Steps" }] },
    { kind: "list", ordered: true, start: 1, items: [[{ kind: "text", text: "Read the log" }], [{ kind: "code", text: "darius due" }]] },
  ],
  runs: RUNS,
  handoff: null,
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
  };
}

const context: WebContext = {
  viewer: "owner on phone",
  nonce: NONCE,
  status: () => STATUS,
  ritual: (project, slug) => (project === "demo" && slug === "daily-report" ? RITUAL : null),
  run: (project, run) => {
    const row = project === "demo" ? RUNS.find((candidate) => candidate.run === run) : undefined;
    return row === undefined ? null : runDetail(row);
  },
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
  ["/", ["Two things need you.", "Needs you", `darius run answer ${HELD} 1 &quot;your answer&quot; --project demo`, `darius run answer ${HELD} 2`, "Guard soak", "seen by", "owner on phone", "testhost"]],
  ["/runs", ["Runs", `/p/demo/runs/${DONE}`, `/p/demo/runs/${FAILED}`, "Failed", "Complete"]],
  ["/runs?project=demo&state=failed", [`/p/demo/runs/${FAILED}`]],
  ["/w/demo/milestones", ["Milestones", "In progress", "M7", "7 of 10 checks done", "<details", "M7/01", "6 of 6 checks", "M7/02", "Waiting", "depends on M7/01", "target 10 Sep, past", "3 archived", "Cart &lt;script&gt;alert(1)&lt;/script&gt; survives"]],
  ["/milestones", ["demo", "/w/demo/milestones", "M7/02", "3 archived"]],
  ["/profiles", ["careful", "opus", "headless"]],
  ["/all", ["Two things need you.", "Needs you", "Guard soak"]],
  ["/w/demo", ["/home/test/demo", "/p/demo/rituals/daily-report", "Latest reports", "Recent runs", "synced"]],
  ["/vigils", ["Vigils", "Coming up", "Guard soak", "last check failed", "/w/demo/vigils#vigil-soak"]],
  ["/w/demo/vigils", ["Vigils", "Guard soak", "last check failed"]],
  ["/rituals", ["Rituals", "Coming up", "/p/demo/rituals/daily-report", "Recent runs", "All runs"]],
  ["/w/demo/rituals", ["Rituals", "/p/demo/rituals/daily-report", "/runs?project=demo"]],
  ["/milestones", ["Milestones"]],
  ["/w/demo/milestones", ["Milestones"]],
  ["/settings", ["Settings"]],
  ["/p/demo/rituals/daily-report", ["Rules", "git fetch", "git push", "Be brief.", "Read the log", "darius due", "History", "report mode"]],
  [`/p/demo/runs/${DONE}`, ["Findings heading", "site-a", "2281", '<ol start="3">', "run.completed", "5 min", "Complete"]],
  [`/p/demo/runs/${HELD}`, ["Needs you", "which branch?", `darius run answer ${HELD} 2 &quot;your answer&quot; --project demo`]],
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
  const run = await get(`/p/demo/runs/${DONE}`);
  assert.ok(run.body.includes("store text &lt;script&gt;alert(1)&lt;/script&gt; &amp; more"), "escaped findings");
  const overview = await get("/");
  assert.ok(overview.body.includes("may I push &lt;script&gt;alert(1)&lt;/script&gt;?"), "escaped question");
});

test("the run filter keeps only matching runs", async () => {
  const page = await get("/runs?state=held");
  assert.ok(page.body.includes(`/p/demo/runs/${HELD}`));
  assert.equal(page.body.includes(`/p/demo/runs/${DONE}`), false);
});

test("the home page shows a manual ritual as a late row of Coming up, and never imported runs", async () => {
  const project = STATUS.projects[0]!;
  const manual = { ...project.rituals[0]!, slug: "by-hand", title: "Done by hand", mode: "off", skill: null, heldRun: null, overdueDays: 4, nextDue: "2026-09-24" };
  const imported = { ...RUNS[2]!, run: "01KDDDDDDDDDDDDDDDDDDDDDDD", item: "ritual/by-hand", who: "import" };
  const busy: HostStatus = { ...STATUS, projects: [{ ...project, rituals: [...project.rituals, manual], runs: [...project.runs, imported] }] };
  const response = await handler(new Request("http://darius.test/"), { ...context, status: () => busy });
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

test("unknown projects, rituals, runs and paths answer a themed 404", async () => {
  for (const path of ["/w/ghost", "/w/ghost/vigils", "/w/ghost/rituals", "/w/ghost/milestones", "/p/demo/rituals/nope", "/p/ghost/rituals/daily-report", "/p/demo/runs/NOPE", "/nowhere", "/p/demo/runs"]) {
    const page = await get(path);
    assert.equal(page.status, 404, path);
    assert.ok(page.body.includes("Nothing here"), path);
    assertScriptsCarryNonce(page.body, path);
  }
});

test("the 0.9 run URL redirects to the project run page", async () => {
  const response = await handler(new Request(`http://darius.test/runs/demo/${DONE}`), context);
  assert.equal(response.status, 301);
  assert.equal(response.headers.get("location"), `/p/demo/runs/${DONE}`);
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
  const page = await read(`/p/demo/runs/${STUCK}`);
  assert.ok(page.includes("Running for 12 h. Runs stop after 20 min, so this one may be stuck."), "the warning line");
  assert.ok(page.includes("May be stuck"), "the warning state");
  const young = await read(`/p/demo/runs/${FRESH}`);
  assert.equal(young.includes("may be stuck"), false, "a run half an hour old is just running");
  const home = await read("/");
  const needs = home.slice(home.indexOf("Needs you"), home.indexOf('id="now"'));
  const nowRows = home.slice(home.indexOf('id="now"'), home.indexOf("<aside"));
  assert.match(nowRows, new RegExp(`/p/demo/runs/${FRESH}`, "u"), "Now lists the fresh run");
  assert.doesNotMatch(nowRows, new RegExp(STUCK, "u"), "the stuck run has its card in Needs you, not a row in Now");
  assert.match(needs, new RegExp(`id="stuck-${STUCK}".*href="/p/demo/runs/${STUCK}".*stuck, 12 h`, "su"), "a Needs you card that opens the run");
  assert.doesNotMatch(needs, new RegExp(FRESH, "u"), "none for the fresh run");
  assert.ok(home.includes("Three things need you."), "held, stuck and flagged count");
});

test("the run page title: the report heading for a complete run, the ritual title otherwise", async () => {
  const done = await get(`/p/demo/runs/${DONE}`);
  assert.equal(h1Of(done.body), "Findings heading");
  for (const run of [FAILED, HELD]) {
    const page = await get(`/p/demo/runs/${run}`);
    assert.equal(h1Of(page.body), "Daily &lt;script&gt;alert(1)&lt;/script&gt; report", run);
  }
});

test("the switcher counts the things that need you, like the verdict: not questions", async () => {
  const page = await get("/w/demo");
  assert.ok(page.body.includes("2 needs you") || page.body.includes("2 need you"), "the workspace entry names the number");
  assert.match(page.body, /<span class="sw-need">2 need you<\/span>/u, "All workspaces says 2 need you");
  assert.equal(h1Of((await get("/")).body), "Two things need you.", "the same number as the verdict");
});

/** The count of one segment of the home status strip, or null when the segment is absent. */
function segment(body: string, label: string): string | null {
  return new RegExp(`<span class="pill-n">(\\d+)</span><span class="pill-l">${label}</span>`, "u").exec(body)?.[1] ?? null;
}

test("the busy home page: the verdict in words, the status strip, one card per thing, the health line", async () => {
  const body = (await get("/")).body.replaceAll("<!-- -->", "");
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
  assert.equal(body.includes(`/p/demo/runs/${DONE}`), false, "an older run of a held djinn does not show");
});

test("the quiet home page: Nothing needs you, the last night card, and the self-test as one footer line", async () => {
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
  const body = (await (await handler(new Request("http://darius.test/"), { ...context, status: () => quiet })).text()).replaceAll("<!-- -->", "");
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
  assert.ok(body.includes("Self-test: heartbeat ran 1 h ago. 1 vigil flagged."), "one muted footer line");
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
  for (const path of [`/p/demo/runs/${FAILED}`, "/p/demo/rituals/daily-report"]) {
    const page = await read(path, open);
    assert.ok(page.includes("What happens next"), path);
    assert.ok(page.includes("This run failed. darius does not retry it today. The timer starts the ritual again when it is next due, tomorrow for a daily ritual."), path);
    assert.ok(page.includes("darius run now daily-report --project demo"), path);
    assert.ok(page.includes(`darius run ack ${FAILED} --project demo`), path);
  }
  const done = await read(`/p/demo/runs/${DONE}`, open);
  assert.equal(done.includes("What happens next"), false, "a complete run has no next step");
  assert.match(await read("/w/demo", open), /id="reports".*<li class="rw rw-rail tone-bad">.*<span class="rw-state tone-bad">Failed<\/span>/su, "the latest-report row shows an open failure in the failure colour, with a rail");
  const needed = await read("/", open);
  assert.equal(h1Of(needed), "One thing needs you.");
  assert.ok(needed.includes(`id="failed-demo-daily-report"`), "an open failure needs the operator");
  assert.match(comingOf(await read("/rituals", open)), /Tomorrow.*<li class="rw rw-rail tone-bad">.*<span class="rw-state tone-bad">Failed<\/span>/su, "Coming up puts the failed djinn tomorrow, in the failure colour");

  const seen = setup(ack);
  for (const path of [`/p/demo/runs/${FAILED}`, "/p/demo/rituals/daily-report"]) {
    const page = await read(path, seen);
    assert.ok(page.includes("What happens next"), path);
    assert.ok(page.includes("Acknowledged by owner at 10:30: known &lt;script&gt;alert(1)&lt;/script&gt; outage."), path);
    assert.equal(page.includes("darius run ack"), false, path);
    assert.equal(page.includes(EVIL), false, `${path}: the note stays text`);
  }
  // Every page shows an acknowledged failure quietly: grey "Failed, seen", never the failure colour.
  for (const path of ["/", "/rituals", "/runs", "/w/demo", "/p/demo/rituals/daily-report", `/p/demo/runs/${FAILED}`]) {
    const page = await read(path, seen);
    assert.match(page, /<span class="(?:status|rw-state) tone-idle">Failed, seen<\/span>/u, `${path}: the grey word`);
    for (const red of ["tone-bad", "edge-bad", "ink-bad"]) assert.equal(page.includes(red), false, `${path}: no ${red}`);
  }
  const card = await read("/w/demo", seen);
  assert.match(card, /id="reports".*<li class="rw">.*Failed, seen.*Acknowledged by owner at 10:30: known &lt;script&gt;alert\(1\)&lt;\/script&gt; outage\./su, "the latest-report row is grey and has no rail, with the acknowledgement");
  const home = await read("/", seen);
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
  const page = (await (await handler(new Request("http://darius.test/p/demo/rituals/daily-report"), ctx)).text()).replaceAll("<!-- -->", "");
  assert.ok(page.includes(`Runs on <code class="inline-code">host-b</code> only; the timer of any other host skips it.`));
  assert.equal((await get("/p/demo/rituals/daily-report")).body.includes("Runs on"), false, "no pin, no line");
});

test("a manual ritual reads \"manual ritual\" with the hand, has a note box with the way to automate it, and its instructions open", async () => {
  const project = STATUS.projects[0]!;
  const manual = { ...project.rituals[0]!, slug: "by-hand", title: "Done by hand", mode: "off", skill: null, heldRun: null, overdueDays: 13, nextDue: "2026-09-15" };
  const ctx: WebContext = { ...context, ritual: (name, slug) => (name === "demo" && slug === "by-hand" ? { ...RITUAL, row: manual, policy: { ...RITUAL.policy, mode: "off" } } : null) };
  const page = (await (await handler(new Request("http://darius.test/p/demo/rituals/by-hand"), ctx)).text()).replaceAll("<!-- -->", "");
  assert.match(page, /<span class="kind-word c-manual"><svg class="kind-icon kind-manual"[^>]*>.*?<\/svg>manual ritual<\/span>/su, "one coloured word with the hand: manual ritual");
  assert.equal(page.includes("chip-x c-ritual"), false, "no kind chip boxes");
  assert.ok(page.includes('<span class="rw-state tone-late">13 days late</span>'), "the state word in the vocabulary");
  assert.ok(page.includes('<h1 class="page-title page-title-sans">'), "the title is sans");
  assert.ok(page.includes("darius does not start this ritual (mode off). You run it by hand; darius tracks the schedule."), "the note box");
  assert.ok(page.includes('<code class="inline-code">darius ritual set by-hand --mode report ...</code>'), "and the way to let darius run it");
  assert.match(page, /<details class="fold scroll-mt-20" open=""><summary>Instructions<\/summary>/u, "Instructions are open for a ritual done by hand");
  assert.match(page, /<details class="fold scroll-mt-20"><summary>Rules/u, "Rules stay closed");
  const auto = (await get("/p/demo/rituals/daily-report")).body;
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
  const page = (await (await handler(new Request("http://darius.test/p/demo/rituals/daily-report"), ctx)).text()).replaceAll("<!-- -->", "");
  assert.ok(page.includes("Note for the next run"));
  assert.ok(page.includes("<p>Check post 7 again.</p>"));
  assert.ok(page.includes("Your answer, owner: yes, delete it"));
  assert.ok(page.includes(`href="/p/demo/runs/${from}"`), "the card links the run that left the note");
  assert.equal((await get("/p/demo/rituals/daily-report")).body.includes("Note for the next run"), false, "no handoff, no card");
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
  const page = await readPage(`/p/demo/runs/${ASKS}`, ctx);
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

  const calm = await readPage(`/p/demo/runs/${DONE}`, ctx);
  assert.equal(calm.includes('<h2 class="label">Result</h2>'), false, "no result, no panel");
});

test("a result without questions shows no question card and no ack command", async () => {
  const quiet: RunResult = { ...RESULT, status: "ok", questions: [], items: [], actions: [], metrics: [] };
  const ctx: WebContext = { ...context, run: (name, run) => (name === "demo" && run === DONE ? runDetail(RUNS[2]!, quiet) : null) };
  const page = await readPage(`/p/demo/runs/${DONE}`, ctx);
  assert.match(page, /<div class="card card-accent result-banner edge-ok"><span class="status tone-ok">.*?Result ok<\/span>/su);
  for (const absent of ["Questions for you", "What it found", "What it changed", "darius run ack"]) assert.equal(page.includes(absent), false, absent);
});

test("a run that asks: an Asks you card on home, tags in the lists, and no page calls it complete", async () => {
  const ctx = asksContext(null);
  const home = await readPage("/", ctx);
  assert.equal(h1Of(home), "One thing needs you.");
  assert.match(home, /<h1 class="verdict-h ink-wait">/u, "the waiting tone");
  assert.ok(home.includes('<a href="#needs" class="pill tone-wait">') && home.includes(`<article id="asks-${ASKS}"`), "the strip links the Needs you section, which holds the card");
  const cardAt = home.indexOf(`<article id="asks-${ASKS}"`);
  const card = between(home, cardAt, home.indexOf("</article>", cardAt));
  assert.ok(card.includes("card-accent edge-wait"), "a waiting edge");
  assert.ok(card.includes("Asks you"));
  assert.ok(card.includes(`href="/p/demo/runs/${ASKS}"`), "it opens the run");
  assert.ok(card.includes("Daily &lt;script&gt;alert(1)&lt;/script&gt; report"), "the ritual label");
  assert.ok(card.includes("demo, by timer, 1 question"), "the question count");
  assert.ok(card.includes("Delete the two old landing pages &lt;script&gt;alert(1)&lt;/script&gt; now?") && card.includes("Yes, delete them."), "the question and its recommendation");
  assert.ok(card.includes(`darius run ack ${ASKS} --note &quot;your decision&quot; --project demo`));
  assert.equal(home.includes('id="done-demo-daily-report"'), false, "the run shows once, not also under Last night");
  assert.match(comingOf(await readPage("/rituals", ctx)), /<li class="rw rw-rail tone-wait">.*<span class="rw-state tone-wait">Asks you<\/span>/su, "Coming up says so");
  assert.match(home, /<span class="sw-need">1 needs you<\/span>/u, "the switcher counts the thing that needs you");

  const runs = await readPage("/runs", ctx);
  assert.ok(runs.includes('<span class="chip-x c-late">2 high open</span>'), "open high items");
  assert.ok(runs.includes('<span class="chip-x c-wait">1 question</span>'), "the question, waiting");
  assert.equal(runs.includes("critical open"), false, "no critical item is open");

  const ritual = await readPage("/p/demo/rituals/daily-report", ctx);
  assert.ok(ritual.includes('<h2 class="label">Needs you</h2>'), "the ritual page leads with the question");
  assert.ok(ritual.includes(`darius run ack ${ASKS} --note &quot;your decision&quot; --project demo`));
  assert.ok(ritual.includes('<div class="card card-accent edge-wait">'), "the latest report card waits");

  const project = await readPage("/w/demo", ctx);
  assert.match(project, /id="reports".*?<li class="rw rw-rail tone-wait">.*?Asks you/su, "the latest-report row waits, with a rail");
  for (const page of [home, runs, ritual, project]) assert.equal(page.includes(EVIL), false);
});

test("an answered result: the decision replaces the command, home is quiet, the tag says answered", async () => {
  const ctx = asksContext({ at: "2026-09-28T08:30:00.000Z", who: "owner", note: `yes, delete ${EVIL}` });
  const page = await readPage(`/p/demo/runs/${ASKS}`, ctx);
  assert.ok(page.includes("Answered by owner at 10:30: yes, delete &lt;script&gt;alert(1)&lt;/script&gt;."), "who, when and the decision");
  assert.equal(page.includes("darius run ack"), false, "no command once answered");
  assert.ok(page.includes("card card-accent next edge-idle"), "the question card is quiet");
  assert.ok(page.includes("Complete</span>"), "the run is complete again");
  assert.equal(page.includes(EVIL), false);

  const home = await readPage("/", ctx);
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
  const home = await readPage("/", context);
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
  assert.match(await read("/"), /<a [^>]*href="\/vigils#waiting"[^>]*>.*?<span class="pill-n">2<\/span><span class="pill-l">vigils armed<\/span>/su, "the strip counts armed vigils and links the waiting list");
});

// --- the information architecture (0.39.0): scopes, tabs, the switcher, settings -------------

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

test("/p/<project> redirects to the workspace Overview, and the detail pages keep their addresses", async () => {
  const response = await handler(new Request("http://darius.test/p/demo"), context);
  assert.equal(response.status, 301);
  assert.equal(response.headers.get("location"), "/w/demo");
  const ghost = await handler(new Request("http://darius.test/p/ghost"), context);
  assert.equal(ghost.headers.get("location"), "/w/ghost", "the redirect does not look the workspace up; the new address answers 404");
  assert.equal((await get("/w/ghost")).status, 404);
  assert.equal((await get("/p/demo/rituals/daily-report")).status, 200);
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

test("the top bar has the gem, the switcher and the gear; the tabs are Vigils, Rituals, Milestones, in that order, and no Home or Runs link", async () => {
  const { body } = await readWith("/w/demo", {}, lateStatus());
  assert.ok(linkTo(body, "/w/demo")?.includes('class="brand"'), "the gem opens the Overview of the scope");
  assert.ok(linkTo(body, "/settings")?.includes('aria-label="Settings"'), "the gear opens Settings");
  assert.match(body, /<span class="sw-now">demo<\/span>/u, "the switcher names the scope");
  for (const nav of ["Sections", "Tabs"]) {
    const from = body.indexOf(`aria-label="${nav}"`);
    assert.ok(from !== -1, nav);
    const links = [...body.slice(from, body.indexOf("</nav>", from)).matchAll(/href="([^"]+)"/gu)].map((match) => match[1]);
    assert.deepEqual(links, ["/w/demo/vigils", "/w/demo/rituals", "/w/demo/milestones"], `${nav}: the three tabs in order`);
  }
  assert.equal(body.includes('aria-label="Main"'), false, "no Home and Runs links any more");
  const all = await get("/milestones");
  const tabs = all.body.slice(all.body.indexOf('aria-label="Sections"'));
  assert.ok(linkTo(tabs, "/vigils") !== null && linkTo(tabs, "/rituals") !== null, "the tabs of all workspaces have plain addresses");
  assert.ok(linkTo(tabs, "/milestones")?.includes('aria-current="page"'), "the Milestones tab is lit");
  // The badges: vigils due today or late, rituals late.
  const rituals = await readWith("/rituals", {}, lateStatus());
  assert.match(rituals.body, /<span class="tab-bdg tone-late" title="1 late">/u, "the ritual is one day late");
  assert.ok(linkTo(rituals.body.slice(rituals.body.indexOf('aria-label="Sections"')), "/rituals")?.includes('aria-current="page"'), "the Rituals tab is lit");
  assert.equal(/<span class="tab-bdg tone-wait"/u.test(rituals.body), false, "no vigil is due today or late");
});

test("the switcher lists Overview, All workspaces and each workspace with what needs you, and marks the current one", async () => {
  const status = threeWorkspaces();
  const { body } = await readWith("/w/demo/rituals", {}, status);
  const from = body.indexOf('class="sw-list"');
  const list = body.slice(from, body.indexOf("</details>", from));
  const names = [...list.matchAll(/<span class="sw-name">([^<]+)<\/span>/gu)].map((match) => match[1]);
  assert.deepEqual(names, ["Overview", "All workspaces", "demo", "atlas"], "the self-test workspace is not listed");
  assert.ok(linkTo(list, "/w/demo") !== null && linkTo(list, "/rituals") !== null, "Overview, and All workspaces on the same section");
  assert.ok(linkTo(list, "/w/atlas/rituals") !== null, "switching keeps the section");
  assert.ok(linkTo(list, "/w/demo/rituals")?.includes('aria-current="true"'), "the current workspace is marked");
  assert.match(list, /<span class="sw-need">2 need you<\/span>/u, "the count of a workspace");
  assert.match(list, /<span class="sw-clear">all clear<\/span>/u, "a quiet workspace says so");
  assert.equal(body.includes('class="sw-dot"'), false, "no red square: the workspace you are in is the one that needs you");
  const other = await readWith("/w/atlas", {}, status);
  assert.ok(other.body.includes('class="sw-dot"'), "a red square on the button when another workspace needs you");
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

test("showSelftest hides the self-test workspace from the switcher, the badges and the all-workspaces lists", async () => {
  const status = threeWorkspaces();
  const off = await readWith("/vigils", {}, status);
  assert.equal(off.body.includes("Self-test vigil"), false, "no row in the all-workspaces list");
  assert.equal(off.body.includes('<span class="sw-name">darius-selftest</span>'), false, "not in the switcher");
  assert.equal(off.body.includes("due today or late"), false, "not in the badge");
  assert.equal(h1Of((await readWith("/", {}, status)).body), "Two things need you.", "not in the verdict");
  assert.ok((await readWith("/", {}, status)).body.includes("Self-test:"), "the footer line stays");
  const on = await readWith("/vigils", { selftest: "1" }, status);
  assert.ok(on.body.includes("Self-test vigil"), "the row shows");
  assert.ok(on.body.includes('<span class="sw-name">darius-selftest</span>'), "it is in the switcher");
  assert.match(on.body, /<span class="tab-bdg tone-wait" title="1 due today or late">/u, "it counts");
  assert.equal(h1Of((await readWith("/", { selftest: "1" }, status)).body), "Three things need you.", "and needs you");
  assert.equal((await readWith("/w/darius-selftest", {}, status)).status, 200, "its own address always works");
});

test("defaultWorkspace decides what / opens; /all is always all workspaces", async () => {
  const status = threeWorkspaces();
  const plain = await readWith("/", {}, status);
  assert.match(plain.body, /<span class="sw-now">All workspaces<\/span>/u, "no default: all workspaces");
  const set = await readWith("/", { ws: "demo" }, status);
  assert.match(set.body, /<span class="sw-now">demo<\/span>/u, "the default workspace");
  assert.ok(set.body.includes("/home/test/demo"), "it is the workspace Overview, with its checkout");
  assert.ok(linkTo(set.body, "/all") !== null, "all workspaces get an address of their own");
  const all = await readWith("/all", { ws: "demo" }, status);
  assert.match(all.body, /<span class="sw-now">All workspaces<\/span>/u);
  assert.equal(h1Of(all.body), "Two things need you.");
  const ghost = await readWith("/", { ws: "gone" }, status);
  assert.match(ghost.body, /<span class="sw-now">All workspaces<\/span>/u, "a default that this host does not have is ignored");
});
