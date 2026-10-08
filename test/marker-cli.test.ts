/**
 * `darius marker check` (src/cli/marker.ts) and the v3 suffix of
 * `darius link --list` (src/cli/link.ts).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseArgs } from "../src/cli/args.ts";
import { linkCommand } from "../src/cli/link.ts";
import { markerCommand } from "../src/cli/marker.ts";
import { NotFoundError, UsageError, type Command } from "../src/cli/registry.ts";

const SANDBOX = mkdtempSync(join(tmpdir(), "darius-marker-cli-"));
process.env.DARIUS_STATE_DIR = join(SANDBOX, "state");
process.env.DARIUS_CONFIG_DIR = join(SANDBOX, "config");
delete process.env.DARIUS_PROJECT;

const FIXTURE = join(import.meta.dirname, "fixtures", "marker-v3.toml");

interface CliRun {
  code: number;
  stdout: string;
  stderr: string;
}

async function runCli(command: Command, argv: string[]): Promise<CliRun> {
  const args = parseArgs(argv);
  const out: string[] = [];
  const err: string[] = [];
  const { log, error } = console;
  console.log = (...parts: string[]) => out.push(parts.join(" "));
  console.error = (...parts: string[]) => err.push(parts.join(" "));
  try {
    const code = await command.run(args);
    return { code, stdout: out.join("\n"), stderr: err.join("\n") };
  } finally {
    console.log = log;
    console.error = error;
  }
}

let counter = 0;

function checkout(marker: string | null): string {
  counter += 1;
  const dir = join(SANDBOX, `repo-${String(counter)}`);
  mkdirSync(dir, { recursive: true });
  if (marker !== null) writeFileSync(join(dir, ".darius.toml"), marker);
  return dir;
}

function addSkill(dir: string, name: string): void {
  mkdirSync(join(dir, ".claude", "skills", name), { recursive: true });
  writeFileSync(join(dir, ".claude", "skills", name, "SKILL.md"), `---\nname: ${name}\ndescription: x\n---\n`);
}

function v3Checkout(): string {
  const dir = checkout(null);
  copyFileSync(FIXTURE, join(dir, ".darius.toml"));
  return dir;
}

test("marker check: a missing skill file is an error and exits 1; with the files it is ok", async () => {
  const dir = v3Checkout();
  const run = await runCli(markerCommand, ["check", dir]);
  assert.equal(run.code, 1, run.stdout);
  assert.match(run.stderr, /error: \[rituals\.daily-report\] skill "daily-report" has no \.claude\/skills\/daily-report\/SKILL\.md in this checkout/u);
  assert.match(run.stderr, /error: \[rituals\.weekly-audit\] skill "weekly-audit" has no/u);
  assert.doesNotMatch(run.stdout, /^ok:/mu, "no ok line when it fails");
  const json = JSON.parse((await runCli(markerCommand, ["check", dir, "--json"])).stdout);
  assert.equal(json.ok, false);
  assert.equal(json.errors.length, 2);
  addSkill(dir, "daily-report");
  const half = await runCli(markerCommand, ["check", dir]);
  assert.equal(half.code, 1, "one skill is still missing");
  assert.doesNotMatch(half.stderr, /daily-report/u);
  addSkill(dir, "weekly-audit");
  const clean = await runCli(markerCommand, ["check", dir]);
  assert.equal(clean.code, 0, clean.stderr);
  assert.equal(clean.stdout, "ok: v3, 2 rituals, 1 policies\nkinds: ritual");
});

test("marker check: a bad file prints file:line and exits 1; --json carries the same error", async () => {
  const dir = checkout('v = 3\nproject = "acme-web"\n');
  const run = await runCli(markerCommand, ["check", dir]);
  assert.equal(run.code, 1);
  assert.match(run.stderr, /\.darius\.toml:1: v = 3 needs tz/u);
  const json = JSON.parse((await runCli(markerCommand, ["check", dir, "--json"])).stdout);
  assert.equal(json.ok, false);
  assert.match(json.errors[0], /\.darius\.toml:1: v = 3 needs tz/u);
});

test("marker check: warns about an unused policy and an empty v3 marker", async () => {
  const dir = checkout('v = 3\nproject = "acme-web"\ntz = "UTC"\n[policies.spare]\nmode = "off"\n');
  const run = await runCli(markerCommand, ["check", dir]);
  assert.equal(run.code, 0);
  assert.match(run.stdout, /warning: no \[rituals\.<slug>\] tables/u);
  assert.match(run.stdout, /warning: \[policies\.spare\] is not used by any ritual/u);
  assert.match(run.stdout, /ok: v3, 0 rituals, 1 policies/u);
});

test("marker check: a v2 or v1 file is ok with no ritual counts", async () => {
  assert.equal((await runCli(markerCommand, ["check", checkout('v = 2\nproject = "acme-web"\n')])).stdout, "ok: v2\nkinds: ritual");
  assert.equal((await runCli(markerCommand, ["check", checkout('project = "acme-web"\n')])).stdout, "ok: v1\nkinds: ritual");
});

test("marker check: --json reports version, counts, errors and warnings", async () => {
  const dir = v3Checkout();
  addSkill(dir, "daily-report");
  addSkill(dir, "weekly-audit");
  const json = JSON.parse((await runCli(markerCommand, ["check", dir, "--json"])).stdout);
  assert.equal(json.ok, true);
  assert.equal(json.version, 3);
  assert.equal(json.rituals, 2);
  assert.equal(json.policies, 1);
  assert.deepEqual(json.errors, []);
  assert.deepEqual(json.warnings, []);
});

test("marker check: no file is a usage error; a missing verb or extra argument too", async () => {
  await assert.rejects(runCli(markerCommand, ["check", checkout(null)]), (cause: Error) => cause instanceof UsageError && /no \.darius\.toml/u.test(cause.message));
  await assert.rejects(runCli(markerCommand, []), UsageError);
  await assert.rejects(runCli(markerCommand, ["check", "a", "b"]), UsageError);
});

function policyCheckout(name: string): string {
  const dir = checkout(null);
  copyFileSync(join(import.meta.dirname, "fixtures", `marker-policy-${name}.toml`), join(dir, ".darius.toml"));
  return dir;
}

test("marker check --resolved: mode, then may, then hold, each sorted, one per line", async () => {
  const run = await runCli(markerCommand, ["check", policyCheckout("factored"), "--resolved", "link-audit"]);
  assert.equal(run.code, 0, run.stderr);
  assert.equal(
    run.stdout,
    [
      "mode: report",
      "may: Bash(cd tools)",
      "may: Bash(curl -s https://example.com/*)",
      "may: Bash(date *)",
      "may: Bash(git diff *)",
      "may: Bash(git status)",
      "may: Bash(pnpm cli report *)",
      "may: Bash(pnpm cli status *)",
      "may: Glob",
      "may: Grep",
      "may: Read",
      "may: WebFetch",
      "hold: --confirm\\b",
      "hold: \\bDROP\\s+TABLE\\b",
      "hold: \\bdeploy\\b",
      "hold: \\bgit\\s+push\\b",
      "hold: \\bpnpm\\s+publish\\b",
      "hold: \\brm\\s+-rf\\b",
    ].join("\n"),
  );
});

test("marker check --resolved: the inline and the factored fixture print the same bytes for every ritual", async () => {
  const inline = policyCheckout("inline");
  const factored = policyCheckout("factored");
  for (const slug of ["daily-report", "link-audit", "fact-check", "content-fix"]) {
    const left = await runCli(markerCommand, ["check", inline, "--resolved", slug]);
    const right = await runCli(markerCommand, ["check", factored, "--resolved", slug]);
    assert.equal(left.code, 0, left.stderr);
    assert.equal(right.code, 0, right.stderr);
    assert.match(left.stdout, /^mode: /u);
    assert.equal(left.stdout, right.stdout, slug);
  }
});

test("marker check --resolved --json: the sorted view, with the policy name when there is one", async () => {
  const json = JSON.parse((await runCli(markerCommand, ["check", policyCheckout("factored"), "--resolved", "fact-check", "--json"])).stdout);
  assert.equal(json.ok, true);
  assert.equal(json.slug, "fact-check");
  assert.equal(json.policy, "read-only");
  assert.equal(json.mode, "report");
  assert.deepEqual(json.may, [...json.may].toSorted());
  assert.equal(json.may.filter((rule: string) => rule === "Read").length, 1);
  assert.ok(json.may.includes("Agent"));
  assert.ok(json.hold.includes("\\bcurl\\b.*-X\\s*(POST|PUT|DELETE)\\b"));
  const inline = JSON.parse((await runCli(markerCommand, ["check", policyCheckout("inline"), "--resolved", "fact-check", "--json"])).stdout);
  assert.equal(inline.policy, undefined);
  assert.deepEqual([inline.mode, inline.may, inline.hold], [json.mode, json.may, json.hold]);
  assert.equal(json.on_hold, "stop", "the effective on_hold, the default when unset");
});

test("marker check --resolved prints on_hold: deny, in text and JSON (0.66.0)", async () => {
  const dir = checkout(`v = 3\nproject = "acme-web"\ntz = "UTC"\n[policies.p]\nmode = "report"\nhold = ['x']\non_hold = "deny"\n[rituals.daily]\ntitle = "Daily"\nskill = "daily"\npolicy = "p"\n`);
  const text = await runCli(markerCommand, ["check", dir, "--resolved", "daily"]);
  assert.equal(text.stdout, "mode: report\non_hold: deny\nhold: x");
  const json = JSON.parse((await runCli(markerCommand, ["check", dir, "--resolved", "daily", "--json"])).stdout);
  assert.equal(json.on_hold, "deny");
});

test("marker check --resolved: an unknown slug is not found (exit 1) and names the known slugs; a bad file exits 1", async () => {
  await assert.rejects(
    runCli(markerCommand, ["check", policyCheckout("factored"), "--resolved", "nope"]),
    (cause: Error) => cause instanceof NotFoundError && /no \[rituals\.nope\] in .*known: daily-report, link-audit, fact-check, content-fix$/u.test(cause.message),
  );
  await assert.rejects(
    runCli(markerCommand, ["check", checkout('v = 2\nproject = "acme-web"\n'), "--resolved", "x"]),
    (cause: Error) => cause instanceof NotFoundError && cause.message.endsWith("known: none"),
  );
  const bad = await runCli(markerCommand, ["check", checkout(`v = 3\nproject = "acme-web"\ntz = "UTC"\n[rituals.a]\ntitle = "A"\nskill = "a"\nhold_extra = ['(']\n`), "--resolved", "a"]);
  assert.equal(bad.code, 1);
  assert.match(bad.stderr, /\.darius\.toml:7: hold_extra must be a list of regular expressions that compile/u);
  assert.throws(() => parseArgs(["check", "--resolved"]), UsageError);
});

test("link --list adds v3 (N rituals) to the ok line, and only for v3", async () => {
  const v3 = v3Checkout();
  const v2 = checkout('v = 2\nproject = "mc-v2"\n');
  assert.equal((await runCli(linkCommand, [v3])).code, 0);
  assert.equal((await runCli(linkCommand, [v2])).code, 0);
  const text = (await runCli(linkCommand, ["--list"])).stdout;
  assert.match(text, new RegExp(`acme-web +${v3.replaceAll("/", "\\/")}  v3 \\(2 rituals\\)$`, "mu"));
  assert.match(text, new RegExp(`mc-v2 +${v2.replaceAll("/", "\\/")}$`, "mu"));
  const links: { project: string; state: string; marker?: string }[] = JSON.parse((await runCli(linkCommand, ["--list", "--json"])).stdout).links;
  assert.deepEqual(links.find((one) => one.project === "acme-web"), { project: "acme-web", dir: v3, state: "ok", marker: "v3 (2 rituals)" });
  assert.equal(links.find((one) => one.project === "mc-v2")?.marker, undefined);
});

// --- warnings: overlapping hold lists and long notes ------------------------------------

const HOLDS = ["\\bpush\\b", "\\bdeploy\\b", "--force\\b", "\\brm\\b", "\\bsudo\\b", "\\bcurl\\b"];
const ROOT = 'v = 3\nproject = "acme-web"\ntz = "UTC"\n';

function holdList(items: readonly string[]): string {
  return `hold = [${items.map((item) => `'${item}'`).join(", ")}]`;
}

function inlineRitual(slug: string, holds: readonly string[], extra = ""): string {
  return `[rituals.${slug}]\ntitle = "${slug}"\nskill = "${slug}"\nmode = "report"\n${holdList(holds)}\n${extra}`;
}

function withSkills(text: string, slugs: readonly string[]): string {
  const dir = checkout(text);
  for (const slug of slugs) addSkill(dir, slug);
  return dir;
}

test("marker check warns about two rituals that share most of their hold patterns, once per pair, and exits 0", async () => {
  const dir = withSkills(`${ROOT}${inlineRitual("a", HOLDS)}${inlineRitual("b", [...HOLDS.slice(0, 5), "\\bother\\b"])}${inlineRitual("c", ["\\bunique\\b"])}`, ["a", "b", "c"]);
  const run = await runCli(markerCommand, ["check", dir]);
  assert.equal(run.code, 0, run.stderr);
  assert.match(run.stdout, /^warning: \[rituals\.a\] and \[rituals\.b\] share 5 of 6 hold patterns: factor into \[policies\.<name>\] with hold_extra$/mu);
  assert.equal(run.stdout.split("\n").filter((line) => line.includes("share")).length, 1);
  const json = JSON.parse((await runCli(markerCommand, ["check", dir, "--json"])).stdout);
  assert.equal(json.ok, true);
  assert.equal(json.warnings.length, 1);
  assert.match(json.warnings[0], /share 5 of 6 hold patterns/u);
});

test("marker check: the overlap warning counts the shorter list, and stays silent below 5 patterns or 80 percent", async () => {
  const text = (...rituals: string[]): string => `${ROOT}${rituals.join("")}`;
  const slugs = ["a", "b"];
  // The shorter list (5) is fully inside the longer (6): 5 of 5.
  const inside = await runCli(markerCommand, ["check", withSkills(text(inlineRitual("a", HOLDS), inlineRitual("b", HOLDS.slice(0, 5))), slugs)]);
  assert.match(inside.stdout, /share 5 of 5 hold patterns/u);
  // Four shared patterns: below the 5-entry floor.
  const few = await runCli(markerCommand, ["check", withSkills(text(inlineRitual("a", HOLDS.slice(0, 4)), inlineRitual("b", HOLDS.slice(0, 4))), slugs)]);
  assert.doesNotMatch(few.stdout, /share/u);
  // 5 of 6 is 83 percent: warns. 4 of 6 would not, and neither would 5 of 7.
  const seven = [...HOLDS, "\\bseventh\\b"];
  const low = await runCli(markerCommand, ["check", withSkills(text(inlineRitual("a", seven), inlineRitual("b", [...HOLDS.slice(0, 5), "\\bx\\b", "\\by\\b"])), slugs)]);
  assert.doesNotMatch(low.stdout, /share/u, "5 of 7 is 71 percent");
  const exact = await runCli(markerCommand, ["check", withSkills(text(inlineRitual("a", HOLDS.slice(0, 5)), inlineRitual("b", [...HOLDS.slice(0, 4), "\\bx\\b"])), slugs)]);
  assert.match(exact.stdout, /share 4 of 5 hold patterns/u, "80 percent of the shorter list is enough, once it has 5 entries");
});

function named(slug: string): string {
  return `[rituals.${slug}]\ntitle = "${slug}"\nskill = "${slug}"\npolicy = "guarded"\nhold_extra = ['\\b${slug}\\b']\n`;
}

test("marker check: rituals that name the same policy are not reported, even with extras", async () => {
  const policy = `[policies.guarded]\nmode = "report"\n${holdList(HOLDS)}\n`;
  const dir = withSkills(`${ROOT}${policy}${named("a")}${named("b")}`, ["a", "b"]);
  const run = await runCli(markerCommand, ["check", dir]);
  assert.equal(run.code, 0, run.stderr);
  assert.doesNotMatch(run.stdout, /share/u);
  // A ritual on the policy and an inline twin of it are still a pair.
  const mixed = withSkills(`${ROOT}${policy}${named("a")}${inlineRitual("b", HOLDS)}`, ["a", "b"]);
  assert.match((await runCli(markerCommand, ["check", mixed])).stdout, /\[rituals\.a\] and \[rituals\.b\] share 6 of 6/u);
});

test("marker check warns about notes over 300 characters in a ritual and in a policy, and not at 300", async () => {
  const long = "x".repeat(301);
  const dir = withSkills(
    `${ROOT}[policies.spare]\nmode = "off"\nnotes = "${long}"\n${inlineRitual("a", [], `notes = "${"y".repeat(300)}"\n`)}${inlineRitual("b", [], `notes = """\n${"z".repeat(350)}\n"""\n`)}[rituals.c]\ntitle = "c"\nskill = "c"\npolicy = "spare"\n`,
    ["a", "b", "c"],
  );
  const run = await runCli(markerCommand, ["check", dir]);
  assert.equal(run.code, 0, run.stderr);
  assert.match(run.stdout, /^warning: \[policies\.spare\] notes is 301 characters: procedure belongs in the skill, rules in hold$/mu);
  assert.match(run.stdout, /^warning: \[rituals\.b\] notes is 351 characters: procedure belongs in the skill, rules in hold$/mu);
  assert.doesNotMatch(run.stdout, /rituals\.a\] notes/u, "300 characters is allowed");
  assert.doesNotMatch(run.stdout, /rituals\.c\] notes/u, "a policy's notes are reported once, on the policy");
  const json = JSON.parse((await runCli(markerCommand, ["check", dir, "--json"])).stdout);
  assert.equal(json.warnings.length, 2);
});

function notesPolicy(name: string, size: number): string {
  return `[policies.${name}]\nmode = "off"\nnotes = "${"p".repeat(size)}"\n`;
}

function notesRitual(slug: string, name: string, size: number): string {
  return `[rituals.${slug}]\ntitle = "${slug}"\nskill = "${slug}"\npolicy = "${name}"\nnotes = "${"o".repeat(size)}"\n`;
}

test("marker check counts own notes and policy notes apart, never the joined text", async () => {
  // Each part is 200 characters: 402 joined, but neither is over 300.
  const short = withSkills(`${ROOT}${notesPolicy("short", 200)}${notesRitual("a", "short", 200)}`, ["a"]);
  const quiet = await runCli(markerCommand, ["check", short]);
  assert.equal(quiet.code, 0, quiet.stderr);
  assert.doesNotMatch(quiet.stdout, /warning/u);
  // Own notes over 300 warn for the ritual only; the policy's notes are fine.
  const own = withSkills(`${ROOT}${notesPolicy("calm", 100)}${notesRitual("b", "calm", 301)}`, ["b"]);
  const ownRun = await runCli(markerCommand, ["check", own]);
  assert.match(ownRun.stdout, /^warning: \[rituals\.b\] notes is 301 characters: procedure belongs in the skill, rules in hold$/mu);
  assert.doesNotMatch(ownRun.stdout, /policies\.calm\] notes/u);
  // Policy notes over 300 warn for the policy only; short own notes do not add a ritual warning.
  const base = withSkills(`${ROOT}${notesPolicy("wide", 301)}${notesRitual("c", "wide", 10)}`, ["c"]);
  const baseRun = await runCli(markerCommand, ["check", base]);
  assert.match(baseRun.stdout, /^warning: \[policies\.wide\] notes is 301 characters/mu);
  assert.doesNotMatch(baseRun.stdout, /rituals\.c\] notes/u);
  assert.equal(JSON.parse((await runCli(markerCommand, ["check", base, "--json"])).stdout).warnings.length, 1);
});

test("marker check: short notes and unrelated hold lists give no warning", async () => {
  const dir = withSkills(`${ROOT}${inlineRitual("a", HOLDS, 'notes = "Never push."\n')}${inlineRitual("b", HOLDS.map((item) => `${item}2`))}`, ["a", "b"]);
  const run = await runCli(markerCommand, ["check", dir]);
  assert.equal(run.stdout, "ok: v3, 2 rituals, 0 policies\nkinds: ritual");
});

test("marker check warns about a hold pattern with a literal shell operator, once, and never for a class (0.66.0)", async () => {
  const policy = `[policies.p]\nmode = "report"\nhold = ['curl.*\\|\\s*(ba)?sh', '(^|[;&|(]\\s*)wp\\s']\n`;
  const dir = withSkills(
    `${ROOT}${policy}[rituals.a]\ntitle = "a"\nskill = "a"\npolicy = "p"\nhold_extra = ['make && make install']\n${inlineRitual("b", ["a;b", "\\bcurl\\b(?![^|;&]*\\s-G\\s)", "x|y"])}`,
    ["a", "b"],
  );
  const run = await runCli(markerCommand, ["check", dir]);
  assert.equal(run.code, 0, run.stderr);
  const lines = run.stdout.split("\n").filter((line) => line.includes("shell operator"));
  assert.deepEqual(lines, [
    "warning: [policies.p] hold pattern 'curl.*\\|\\s*(ba)?sh' holds the shell operator \\|: since 0.66.0 a pattern is matched per command and cannot span commands unless the line has a loader (bash, sh, xargs, ssh and the like)",
    "warning: [rituals.a] hold pattern 'make && make install' holds the shell operator &&: since 0.66.0 a pattern is matched per command and cannot span commands unless the line has a loader (bash, sh, xargs, ssh and the like)",
    "warning: [rituals.b] hold pattern 'a;b' holds the shell operator ;: since 0.66.0 a pattern is matched per command and cannot span commands unless the line has a loader (bash, sh, xargs, ssh and the like)",
  ]);
});

test("marker check shows the kinds, in text and in --json", async () => {
  const dir = checkout('v = 3\nproject = "acme-web"\ntz = "UTC"\nkinds = ["ritual", "vigil"]\n');
  const text = await runCli(markerCommand, ["check", dir]);
  assert.equal(text.code, 0, text.stderr);
  assert.match(text.stdout, /^kinds: ritual, vigil$/mu);
  assert.deepEqual(JSON.parse((await runCli(markerCommand, ["check", dir, "--json"])).stdout).kinds, ["ritual", "vigil"]);
  const plain = JSON.parse((await runCli(markerCommand, ["check", checkout('project = "acme-web"\n'), "--json"])).stdout);
  assert.deepEqual(plain.kinds, ["ritual"]);
});

test("marker check --resolved lists follow_up_may, in text and JSON (0.69.0)", async () => {
  const dir = checkout(`v = 3\nproject = "acme-web"\ntz = "UTC"\n[policies.p]\nmode = "report"\nhold = ['x']\nfollow_up_may = ["Bash(b *)"]\n[rituals.daily]\ntitle = "Daily"\nskill = "daily"\npolicy = "p"\nfollow_up_may_extra = ["Bash(a *)"]\n`);
  const text = await runCli(markerCommand, ["check", dir, "--resolved", "daily"]);
  assert.equal(text.stdout, "mode: report\nhold: x\nfollow_up_may: Bash(a *)\nfollow_up_may: Bash(b *)");
  const json = JSON.parse((await runCli(markerCommand, ["check", dir, "--resolved", "daily", "--json"])).stdout);
  assert.deepEqual(json.follow_up_may, ["Bash(a *)", "Bash(b *)"]);
});

test("marker check shows an icon, in text and in --json (0.70.0)", async () => {
  const dir = checkout('v = 3\nproject = "acme-web"\ntz = "UTC"\nicon = "🎯"\n');
  const text = await runCli(markerCommand, ["check", dir]);
  assert.equal(text.code, 0, text.stderr);
  assert.match(text.stdout, /^icon: 🎯$/mu);
  assert.doesNotMatch(text.stdout, /warning: icon/u);
  assert.deepEqual(JSON.parse((await runCli(markerCommand, ["check", dir, "--json"])).stdout).icon, { kind: "emoji", text: "🎯" });
  const none = JSON.parse((await runCli(markerCommand, ["check", checkout('v = 3\nproject = "acme-web"\ntz = "UTC"\n'), "--json"])).stdout);
  assert.equal(none.icon, undefined);
});

test("marker check warns when an image icon is missing or not an image here, and exits 0 (0.70.0)", async () => {
  const dir = checkout('v = 3\nproject = "acme-web"\ntz = "UTC"\nicon = "assets/logo.svg"\n');
  const missing = await runCli(markerCommand, ["check", dir]);
  assert.equal(missing.code, 0, missing.stderr);
  assert.match(missing.stdout, /^icon: assets\/logo\.svg \(image\)$/mu);
  assert.match(missing.stdout, /^warning: icon "assets\/logo\.svg": the icon file cannot be found: .*; the web shows no icon$/mu);
  mkdirSync(join(dir, "assets"));
  writeFileSync(join(dir, "assets", "logo.svg"), "not an image\n");
  assert.match((await runCli(markerCommand, ["check", dir])).stdout, /^warning: icon "assets\/logo\.svg": the icon file is not a PNG, WebP or SVG image; the web shows no icon$/mu);
  writeFileSync(join(dir, "assets", "logo.svg"), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/>\n');
  const valid = await runCli(markerCommand, ["check", dir, "--json"]);
  const report = JSON.parse(valid.stdout);
  assert.deepEqual(report.icon, { kind: "image", path: "assets/logo.svg" });
  assert.deepEqual(report.warnings, ["no [rituals.<slug>] tables: this v3 marker defines no rituals"]);
});
