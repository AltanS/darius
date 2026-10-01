/**
 * `darius marker factor` (src/core/marker-factor.ts, src/cli/marker.ts) and
 * the unified diff it prints (src/core/text-diff.ts).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseArgs } from "../src/cli/args.ts";
import { markerCommand } from "../src/cli/marker.ts";
import { UsageError } from "../src/cli/registry.ts";
import { decodeMarker, resolvedPolicy, type Marker, type RepoRitual } from "../src/core/marker.ts";
import { findGroups, planFactor, proofDifference, renderFactored, type FactorRender } from "../src/core/marker-factor.ts";
import { unifiedDiff } from "../src/core/text-diff.ts";
import { commitAll, dirty, initRepo, NO_GIT } from "./helpers/git.ts";

const SANDBOX = mkdtempSync(join(tmpdir(), "darius-marker-factor-"));
process.env.DARIUS_STATE_DIR = join(SANDBOX, "state");
process.env.DARIUS_CONFIG_DIR = join(SANDBOX, "config");
delete process.env.DARIUS_PROJECT;

const FILE = "/repo/.darius.toml";

function fixture(name: string): string {
  return readFileSync(join(import.meta.dirname, "fixtures", name), "utf8");
}

const INLINE = fixture("marker-policy-inline.toml");
const THREE = fixture("marker-factor-three.toml");
const MIXED = fixture("marker-factor-mixed.toml");

interface CliRun {
  code: number;
  stdout: string;
  stderr: string;
}

async function runFactor(argv: string[]): Promise<CliRun> {
  const args = parseArgs(["factor", ...argv]);
  const out: string[] = [];
  const err: string[] = [];
  const { log, error } = console;
  console.log = (...parts: string[]) => out.push(parts.join(" "));
  console.error = (...parts: string[]) => err.push(parts.join(" "));
  try {
    const code = await markerCommand.run(args);
    return { code, stdout: out.join("\n"), stderr: err.join("\n") };
  } finally {
    console.log = log;
    console.error = error;
  }
}

let counter = 0;

/** A checkout with `text` as its marker and a skill file for every ritual it names. */
function checkout(text: string): string {
  counter += 1;
  const dir = join(SANDBOX, `repo-${String(counter)}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, ".darius.toml"), text);
  for (const match of text.matchAll(/^skill = "([a-z0-9-]+)"$/gmu)) {
    const skill = match[1] ?? "";
    mkdirSync(join(dir, ".claude", "skills", skill), { recursive: true });
    writeFileSync(join(dir, ".claude", "skills", skill, "SKILL.md"), `---\nname: ${skill}\ndescription: x\n---\n`);
  }
  return dir;
}

function proposed(text: string): string {
  const plan = planFactor(text, FILE);
  assert.ok(plan.ok, plan.ok ? "" : plan.error);
  return plan.proposed;
}

/** Every field of a ritual a run reads, the policy as the sorted view plus the effective notes. */
function runView(ritual: RepoRitual) {
  return {
    slug: ritual.slug,
    title: ritual.title,
    cadence: ritual.cadence,
    anchor: ritual.anchor,
    at: ritual.at,
    tz: ritual.tz,
    from: ritual.from,
    skill: ritual.skill,
    args: ritual.args,
    timeoutMs: ritual.timeoutMs,
    profile: ritual.profile,
    model: ritual.model,
    maxTurns: ritual.maxTurns,
    resolved: resolvedPolicy(ritual),
    notes: ritual.policy.notes,
  };
}

function assertSameRuns(before: Marker, after: Marker): void {
  assert.deepEqual(
    after.rituals.map((ritual) => ritual.slug),
    before.rituals.map((ritual) => ritual.slug),
  );
  before.rituals.forEach((ritual, index) => {
    const twin = after.rituals[index];
    assert.ok(twin !== undefined);
    assert.deepEqual(runView(twin), runView(ritual), ritual.slug);
  });
}

/** The text of `[<section>]` from its header to its last key line. */
function tableText(text: string, section: string): string {
  const lines = text.split("\n");
  const start = lines.indexOf(`[${section}]`);
  assert.ok(start !== -1, section);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith("["));
  const body = end === -1 ? rest : rest.slice(0, end);
  // Comment and blank lines right above the next header sit on that header, not in this table.
  while (body.length > 0 && /^(#.*)?$/u.test(body.at(-1) ?? "")) body.pop();
  return [lines[start], ...body].join("\n");
}

test("findGroups: the inline fixture gives one report group; the act ritual stays out", () => {
  const groups = findGroups(decodeMarker(INLINE, FILE));
  assert.equal(groups.length, 1);
  const [group] = groups;
  assert.equal(group?.policy, "report-base");
  assert.equal(group?.mode, "report");
  assert.deepEqual(
    group?.members.map((member) => member.slug),
    ["daily-report", "link-audit", "fact-check"],
  );
  assert.equal(group?.hold.length, 6);
  assert.deepEqual(group?.members[2], { slug: "fact-check", mayExtra: ["Agent"], holdExtra: ["\\bcurl\\b.*-X\\s*(POST|PUT|DELETE)\\b"] });
});

test("factor: three rituals with small differences pass the proof; every field and the resolved policy stay", () => {
  const before = decodeMarker(THREE, FILE);
  const text = proposed(THREE);
  const after = decodeMarker(text, FILE);
  assertSameRuns(before, after);
  assert.deepEqual(after.policies["report-base"], {
    mode: "report",
    may: ["Read", "Grep", "Glob"],
    hold: ["\\bdeploy\\b", "--confirm\\b", "\\bgit\\s+push\\b", "\\brm\\s+-rf\\b", "\\bnpm\\s+publish\\b", "\\bDROP\\s+TABLE\\b"],
  });
  for (const ritual of after.rituals) assert.equal(ritual.policyName, "report-base", ritual.slug);
  const weekly = after.rituals.find((ritual) => ritual.slug === "weekly-digest");
  assert.deepEqual(weekly?.policyExtra, { may: ["WebFetch"], hold: ["\\bcurl\\b.*-X\\s*POST\\b", "\\bssh\\b"] });
  assert.doesNotMatch(text, /^mode = "report"\n(?!may|hold)/mu, "no member keeps its mode line");
  assert.equal(tableText(text, "profiles.light"), tableText(THREE, "profiles.light"));
  assert.ok(text.startsWith(THREE.slice(0, THREE.indexOf("[rituals."))), "the head stays byte for byte");
});

function commentLines(source: string): string[] {
  return source.split("\n").filter((line) => line.startsWith("#"));
}

test("factor: comments, a multi-line notes value, args, a named policy and another mode stay as written", () => {
  const before = decodeMarker(MIXED, FILE);
  const text = proposed(MIXED);
  const after = decodeMarker(text, FILE);
  assertSameRuns(before, after);
  const groups = findGroups(before);
  assert.deepEqual(
    groups.map((group) => [group.policy, group.members.map((member) => member.slug)]),
    [["report-base", ["daily-report", "audit"]]],
  );
  for (const untouched of ["policies.read-only", "rituals.status-page", "rituals.content-fix"]) {
    assert.equal(tableText(text, untouched), tableText(MIXED, untouched), untouched);
  }
  assert.deepEqual(commentLines(text), commentLines(MIXED), "every comment stays, in order");
  assert.ok(text.includes('notes = """\nRead only.\nSay "done" at the end."""\n'), "the multi-line notes stay byte for byte");
  assert.ok(text.includes('args = "--site acme --format short"\npolicy = "report-base"\nmay_extra = ["Bash(git log *)"]\nnotes = """'));
  assert.equal(after.rituals.find((ritual) => ritual.slug === "daily-report")?.policy.notes, 'Read only.\nSay "done" at the end.');
  const policyAt = text.indexOf("[policies.report-base]");
  assert.ok(policyAt < text.indexOf("# The first member."), "the new policy goes above the comment on its first member's header");
  assert.ok(policyAt > text.indexOf("[rituals.status-page]"));
});

test("factor is idempotent: its own output has nothing to factor", () => {
  for (const text of [INLINE, THREE, MIXED]) {
    const once = proposed(text);
    const again = planFactor(once, FILE);
    assert.ok(again.ok);
    assert.equal(again.groups.length, 0);
    assert.equal(again.proposed, once);
  }
});

const ROOT = 'v = 3\nproject = "acme-web"\ntz = "UTC"\n';
const HOLDS = ["\\bone\\b", "\\btwo\\b", "\\bthree\\b", "\\bfour\\b", "\\bfive\\b"];

function inlineRitual(slug: string, holds: readonly string[], mode = "report"): string {
  return `\n[rituals.${slug}]\ntitle = "${slug}"\nskill = "${slug}"\nmode = "${mode}"\nhold = [${holds.map((item) => `'${item}'`).join(", ")}]\n`;
}

test("factor: markers that do not qualify have nothing to factor", () => {
  const cases = [
    `${ROOT}${inlineRitual("a", HOLDS.slice(0, 4))}${inlineRitual("b", HOLDS.slice(0, 4))}`,
    `${ROOT}${inlineRitual("a", HOLDS)}${inlineRitual("b", HOLDS, "off")}`,
    `${ROOT}${inlineRitual("a", HOLDS)}${inlineRitual("b", [...HOLDS.slice(0, 3), "\\bsix\\b", "\\bseven\\b"])}`,
    `${ROOT}${inlineRitual("a", HOLDS)}`,
    ROOT,
  ];
  for (const text of cases) {
    const plan = planFactor(text, FILE);
    assert.ok(plan.ok);
    assert.equal(plan.groups.length, 0, text);
    assert.equal(plan.proposed, text);
  }
});

test("factor: a name an existing [policies.*] table has is skipped; two groups of one mode count up", () => {
  const other = ["\\bsix\\b", "\\bseven\\b", "\\beight\\b", "\\bnine\\b", "\\bten\\b"];
  const text = `${ROOT}\n[policies.report-base]\nmode = "report"\n\n[rituals.named]\ntitle = "n"\nskill = "named"\npolicy = "report-base"\n${inlineRitual("a", HOLDS)}${inlineRitual("b", HOLDS)}${inlineRitual("c", other)}${inlineRitual("d", other)}`;
  const plan = planFactor(text, FILE);
  assert.ok(plan.ok, plan.ok ? "" : plan.error);
  assert.deepEqual(
    plan.groups.map((group) => group.policy),
    ["report-base-2", "report-base-3"],
  );
  assert.equal(tableText(plan.proposed, "policies.report-base"), tableText(text, "policies.report-base"));
  assert.equal(decodeMarker(plan.proposed, FILE).rituals.find((ritual) => ritual.slug === "c")?.policyName, "report-base-3");
});

/** The error of a plan that must fail. */
function errorOf(text: string, render: FactorRender = renderFactored): string {
  const plan = planFactor(text, FILE, render);
  assert.equal(plan.ok, false, "the plan must fail");
  return plan.ok ? "" : plan.error;
}

/** Broken text edits: each one stands for a bug the proof gate must catch. */
const dropHold: FactorRender = (text, marker, groups) => renderFactored(text, marker, groups).replace("hold_extra = ['\\bkubectl\\s+apply\\b']\n", "");
const moveTime: FactorRender = (text, marker, groups) => renderFactored(text, marker, groups).replace('at = "02:30"', 'at = "03:30"');
const loseNotes: FactorRender = (text, marker, groups) => renderFactored(text, marker, groups).replace('notes = "Report broken links only."\n', "");
const breakFile: FactorRender = (text, marker, groups) => `${renderFactored(text, marker, groups)}\n[rituals.nightly-scan]\nmode = "act"\n`;
const changeNothing: FactorRender = (text) => text;

test("proof gate: a render that drops a hold pattern, changes a field or breaks the file fails and names the difference", () => {
  assert.match(errorOf(THREE, dropHold), /^proof failed: \[rituals\.nightly-scan\] resolved hold: was /u);
  assert.match(errorOf(THREE, moveTime), /^proof failed: \[rituals\.nightly-scan\] at: was "02:30", proposed "03:30"$/u);
  assert.match(errorOf(THREE, loseNotes), /\[rituals\.link-check\] notes: was "Report broken links only\.", proposed unset/u);
  assert.match(errorOf(THREE, breakFile), /^proof failed: the proposed marker does not parse: /u);
  assert.match(errorOf(THREE, changeNothing), /policy: expected report-base, proposed none/u);
});

test("proofDifference: equal markers give none; a lost root key or a changed policy is named", () => {
  const before = decodeMarker(MIXED, FILE);
  assert.equal(proofDifference(before, decodeMarker(MIXED, FILE), []), undefined);
  assert.equal(proofDifference(before, decodeMarker(MIXED.replace('tz = "UTC"', 'tz = "Europe/Berlin"'), FILE), []), 'tz: was "UTC", proposed "Europe/Berlin"');
  const widened = MIXED.replace("may = [\"Read\"]\nhold = ['\\bdeploy\\b']", "may = [\"Read\", \"Edit\"]\nhold = ['\\bdeploy\\b']");
  assert.notEqual(widened, MIXED);
  assert.equal(proofDifference(before, decodeMarker(widened, FILE), []), "[policies.read-only] changed");
});

test("factor refuses a layout it cannot edit safely, naming the ritual", () => {
  const commented = THREE.replace("  '\\bkubectl\\s+apply\\b',\n", "  '\\bkubectl\\s+apply\\b', # cluster writes\n");
  assert.notEqual(commented, THREE);
  assert.match(errorOf(commented), /^cannot factor: \[rituals\.nightly-scan\] hold holds a comment in its value/u);
  const trailing = THREE.replace('timeout = "2h"\nmode = "report"', 'timeout = "2h"\nmode = "report" # gate');
  assert.match(errorOf(trailing), /\[rituals\.weekly-digest\] mode holds a comment/u);
  const split = `${THREE}\n[rituals.link-check]\nmodel = "opus"\n`;
  assert.match(errorOf(split), /\[rituals\.link-check\] is written in more than one place/u);
  const twice = THREE.replace('timeout = "2h"\n', 'timeout = "2h"\nmay = ["Read"]\n');
  assert.match(errorOf(twice), /\[rituals\.weekly-digest\] sets may twice/u);
});

test("factor keeps CRLF line ends in the lines it adds", () => {
  const crlf = THREE.replaceAll("\n", "\r\n");
  const text = proposed(crlf);
  assert.ok(!/[^\r]\n/u.test(text), "every newline is CRLF");
  assertSameRuns(decodeMarker(crlf, FILE), decodeMarker(text, FILE));
});

test("unifiedDiff: hunks with three lines of context; equal texts give nothing", () => {
  assert.equal(unifiedDiff("a\n", "a\n", "f"), "");
  const before = "1\n2\n3\n4\n5\n6\n7\n8\n9\n";
  const after = "1\n2\n3\n4\nfive\n6\n7\n8\n9\nten\n";
  assert.equal(unifiedDiff(before, after, "f"), "--- a/f\n+++ b/f\n@@ -2,8 +2,9 @@\n 2\n 3\n 4\n-5\n+five\n 6\n 7\n 8\n 9\n+ten\n");
  assert.equal(unifiedDiff("", "x\n", "f"), "--- a/f\n+++ b/f\n@@ -0,0 +1 @@\n+x\n");
});

test("marker factor: prints a summary and a diff, writes nothing; no group prints nothing to factor", async () => {
  const dir = checkout(INLINE);
  const run = await runFactor([dir]);
  assert.equal(run.code, 0, run.stderr);
  assert.match(run.stdout, /^1 group to factor in .*\.darius\.toml:$/mu);
  assert.match(run.stdout, /^ {2}\[policies\.report-base\] mode report, 10 may, 6 hold: daily-report, link-audit, fact-check$/mu);
  assert.match(run.stdout, /^lines: 124 before, \d+ after$/mu);
  assert.match(run.stdout, /rename each \[policies\.<name>\]/u);
  assert.match(run.stdout, /^--- a\/\.darius\.toml\n\+\+\+ b\/\.darius\.toml\n@@ /mu);
  assert.equal(readFileSync(join(dir, ".darius.toml"), "utf8"), INLINE, "read-only by default");
  const none = await runFactor([checkout(`${ROOT}${inlineRitual("a", HOLDS)}`)]);
  assert.deepEqual([none.code, none.stdout], [0, "nothing to factor"]);
});

test("marker factor --json: groups, proposed, diff and ok", async () => {
  const dir = checkout(THREE);
  const json = JSON.parse((await runFactor([dir, "--json"])).stdout);
  assert.equal(json.ok, true);
  assert.equal(json.written, false);
  assert.deepEqual(json.groups, [
    {
      policy: "report-base",
      rituals: ["nightly-scan", "weekly-digest", "link-check"],
      may: ["Read", "Grep", "Glob"],
      hold: ["\\bdeploy\\b", "--confirm\\b", "\\bgit\\s+push\\b", "\\brm\\s+-rf\\b", "\\bnpm\\s+publish\\b", "\\bDROP\\s+TABLE\\b"],
    },
  ]);
  assert.equal(json.proposed, proposed(THREE));
  assert.equal(json.diff, unifiedDiff(THREE, json.proposed, ".darius.toml"));
  const empty = JSON.parse((await runFactor([checkout(ROOT), "--json"])).stdout);
  assert.deepEqual([empty.ok, empty.groups, empty.diff, empty.proposed], [true, [], "", ROOT]);
  const bad = await runFactor([checkout(`${THREE}\n[rituals.link-check]\nmodel = "opus"\n`), "--json"]);
  assert.equal(bad.code, 1);
  assert.match(JSON.parse(bad.stdout).error, /cannot factor/u);
});

test("marker factor --write writes the printed proposal; the result has nothing to factor", { skip: NO_GIT }, async () => {
  const dir = checkout(MIXED);
  initRepo(dir);
  commitAll(dir, "marker");
  const printed = JSON.parse((await runFactor([dir, "--json"])).stdout).proposed;
  const run = await runFactor([dir, "--write"]);
  assert.equal(run.code, 0, run.stderr);
  assert.equal(readFileSync(join(dir, ".darius.toml"), "utf8"), printed);
  assert.match(run.stdout, /^✓ wrote .*\.darius\.toml$/mu);
  assert.match(run.stdout, /^Check: darius marker check --resolved daily-report$/mu);
  assert.match(run.stdout, /^Check: darius marker check --resolved audit$/mu);
  assert.match(run.stdout, /commit\. darius did not run git\./u);
  assert.equal((await runFactor([dir])).stdout, "nothing to factor");
  await assert.rejects(runFactor([dir, "--write"]), UsageError, "the written marker is uncommitted now");
});

test("marker factor --write refuses a dirty marker, a v2 marker and a marker that fails marker check", { skip: NO_GIT }, async () => {
  const dir = checkout(THREE);
  initRepo(dir);
  commitAll(dir, "marker");
  dirty(dir, ".darius.toml");
  const before = readFileSync(join(dir, ".darius.toml"), "utf8");
  await assert.rejects(runFactor([dir, "--write"]), (cause: Error) => cause instanceof UsageError && /uncommitted changes/u.test(cause.message));
  assert.equal(readFileSync(join(dir, ".darius.toml"), "utf8"), before);

  const v2 = checkout('v = 2\nproject = "acme-web"\n');
  await assert.rejects(runFactor([v2, "--write"]), (cause: Error) => cause instanceof UsageError && /is v = 2; marker factor needs v = 3/u.test(cause.message));
  await assert.rejects(runFactor([v2]), UsageError);

  counter += 1;
  const bare = join(SANDBOX, `repo-${String(counter)}`);
  mkdirSync(bare, { recursive: true });
  writeFileSync(join(bare, ".darius.toml"), THREE);
  await assert.rejects(runFactor([bare, "--write"]), (cause: Error) => cause instanceof UsageError && /fails marker check: \[rituals\.nightly-scan\] skill/u.test(cause.message));
  assert.equal(readFileSync(join(bare, ".darius.toml"), "utf8"), THREE);
});

test("marker factor: a file that does not parse exits 1; no file and extra arguments are usage errors", async () => {
  const bad = await runFactor([checkout('v = 3\nproject = "acme-web"\n')]);
  assert.equal(bad.code, 1);
  assert.match(bad.stderr, /error: .*\.darius\.toml:1: v = 3 needs tz/u);
  counter += 1;
  const empty = join(SANDBOX, `repo-${String(counter)}`);
  mkdirSync(empty, { recursive: true });
  await assert.rejects(runFactor([empty]), (cause: Error) => cause instanceof UsageError && /no \.darius\.toml/u.test(cause.message));
  await assert.rejects(runFactor([empty, "extra"]), UsageError);
});
