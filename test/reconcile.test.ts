/**
 * Reconcile (src/core/reconcile.ts; docs/architecture/marker-v3.md, section
 * 4.2): a v3 marker mirrored into the store. Fixed instants throughout.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ritualLifecycle } from "../src/core/due.ts";
import { appendLine, readLedger } from "../src/core/ledger.ts";
import { definitionHash, readMarker, resolvedPolicy } from "../src/core/marker.ts";
import type { LedgerLine, Ritual } from "../src/core/model.ts";
import { mirrorHash, reconcileProject, RITUAL_DEFINED, skillDirty } from "../src/core/reconcile.ts";
import { buildPrompt, writeRunFiles } from "../src/runner/launch.ts";
import { itemRef, openProject, readItemText, type Project } from "../src/core/store.ts";
import { commitAll, dirty, initRepo, NO_GIT } from "./helpers/git.ts";

const SANDBOX = mkdtempSync(join(tmpdir(), "darius-reconcile-"));
process.env.DARIUS_STATE_DIR = join(SANDBOX, "state");
process.env.DARIUS_CONFIG_DIR = join(SANDBOX, "config");
delete process.env.DARIUS_PROJECT;

const FIXTURE = readFileSync(join(import.meta.dirname, "fixtures", "marker-v3.toml"), "utf8");
const HOST = "host-a";
const T1 = new Date("2026-10-01T06:00:00.000Z");
const T2 = new Date("2026-10-01T06:15:00.000Z");
const T3 = new Date("2026-10-01T06:30:00.000Z");

let counter = 0;

interface Setup {
  project: Project;
  dir: string;
}

/** A fresh store project and a checkout dir holding the fixture marker, renamed to the project. */
function setup(opts: { git: boolean; marker?: string }): Setup {
  counter += 1;
  const name = `acme-web-${String(counter)}`;
  const dir = join(SANDBOX, `repo-${String(counter)}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, ".darius.toml"), (opts.marker ?? FIXTURE).replace('project = "acme-web"', `project = "${name}"`));
  writeFileSync(join(dir, "README.md"), "# acme-web\n");
  if (opts.git) {
    initRepo(dir);
    commitAll(dir, "init");
  }
  return { project: openProject(name, { create: true }), dir };
}

function ritual(project: Project, slug: string): Ritual {
  const doc = project.readItem<Ritual>("ritual", slug);
  assert.ok(doc !== null, `no ritual ${slug}`);
  return doc.header;
}

function defined(project: Project): LedgerLine[] {
  return readLedger(project).filter((line) => line.type === RITUAL_DEFINED);
}

/** The fixture marker without the `[rituals.weekly-audit]` table (the last one in the file). */
function withoutWeekly(text: string): string {
  return text.slice(0, text.indexOf("[rituals.weekly-audit]"));
}

test("adopt: a new repo ritual becomes a store item that mirrors the marker", { skip: NO_GIT }, () => {
  const { project, dir } = setup({ git: true });
  const result = reconcileProject(project, dir, HOST, T1);
  assert.equal(result.ok, true);
  assert.equal(result.marker, "v3");
  assert.equal(result.dirty, false);
  assert.match(result.commit ?? "", /^[0-9a-f]{12}$/u);
  assert.deepEqual(result.adopted, ["daily-report", "weekly-audit"]);
  assert.deepEqual([result.updated, result.unchanged, result.retired, result.unmanaged], [[], [], [], []]);

  const marker = readMarker(dir);
  assert.ok(marker !== null);
  const [dailyDef] = marker.rituals;
  assert.ok(dailyDef !== undefined);
  const daily = ritual(project, "daily-report");
  assert.equal(daily.source, "repo");
  assert.equal(daily.title, "Daily site report");
  assert.equal(daily.cadence, "1d");
  assert.equal(daily.anchor, "due");
  assert.equal(daily.at, "07:00");
  assert.equal(daily.tz, "Europe/Berlin", "the root tz is mirrored when the ritual has none");
  assert.equal(daily.timeout, "30m");
  assert.equal(daily.skill, "daily-report");
  assert.deepEqual(daily.policy, { mode: "report", may: ["Bash(cd tools)", "Bash(pnpm cli *)", "Bash(date *)"], hold: ["\\bdeploy\\b", "--confirm\\b"] });
  assert.equal(daily.def_hash, mirrorHash(marker, dailyDef));
  assert.notEqual(daily.def_hash, definitionHash(dailyDef), "the hash covers the resolved tz");
  assert.equal(daily.def_commit, result.commit);
  assert.equal(daily.def_dirty, false);
  assert.equal(daily.def_host, HOST);
  assert.equal(daily.def_at, T1.toISOString());
  assert.equal(daily.updated, T1.toISOString());
  assert.equal(daily.created, T1.toISOString());
  assert.deepEqual(daily.tags, []);
  assert.equal(project.readItem<Ritual>("ritual", "daily-report")?.body, "");

  const weekly = ritual(project, "weekly-audit");
  assert.deepEqual([weekly.tz, weekly.from, weekly.at], ["UTC", "2026-10-05", "09:05"]);
  assert.deepEqual(weekly.policy, {
    mode: "act", may: ["Bash(cd tools)", "Bash(pnpm cli *)"], hold: ["\\bdeploy\\b"], notes: "Never push. Hand in a diff.", model: "opus", max_turns: 200,
  });
  assert.equal(weekly.timeout, undefined);

  const lines = defined(project);
  assert.equal(lines.length, 2);
  const line = lines.find((entry) => entry.slug === "daily-report");
  assert.equal(line?.item, "ritual/daily-report");
  assert.equal(line?.change, "adopted");
  assert.equal(line?.def_hash, daily.def_hash);
  assert.equal(line?.commit, result.commit);
  assert.equal(line?.dirty, false);
  assert.equal(line?.at, T1.toISOString());
});

test("adopt: a store ritual of the same slug keeps its store-owned fields; git fields and body are replaced", { skip: NO_GIT }, () => {
  const { project, dir } = setup({ git: true });
  project.writeItem({
    header: {
      id: "01JAAAAAAAAAAAAAAAAAAAAAAA", kind: "ritual", slug: "daily-report", title: "Old title", created: "2026-01-01T00:00:00.000Z",
      updated: "2026-01-01T00:00:00.000Z", tags: ["ops"], cadence: "2d", anchor: "completion", host: "host-b", owner: "ops", agent: "claude",
      imported_from: "legacy/daily", policy: { mode: "off", may: ["Read"], hold: [], profile: "old" },
    },
    body: "# old procedure\n",
  });
  const result = reconcileProject(project, dir, HOST, T1);
  assert.deepEqual(result.adopted, ["daily-report", "weekly-audit"]);
  const doc = project.readItem<Ritual>("ritual", "daily-report");
  assert.ok(doc !== null);
  const { header } = doc;
  assert.equal(doc.body, "");
  assert.deepEqual(
    [header.id, header.created, header.host, header.owner, header.agent, header.imported_from, header.tags],
    ["01JAAAAAAAAAAAAAAAAAAAAAAA", "2026-01-01T00:00:00.000Z", "host-b", "ops", "claude", "legacy/daily", ["ops"]],
  );
  assert.deepEqual([header.title, header.cadence, header.anchor, header.source], ["Daily site report", "1d", "due", "repo"]);
  assert.equal(header.policy.profile, undefined, "a git-owned field the marker leaves out is cleared");
  assert.equal(header.updated, T1.toISOString());
});

test("a repo ritual without cadence mirrors with no cadence, and dropping the cadence clears the store cadence", { skip: NO_GIT }, () => {
  const { project, dir } = setup({ git: true });
  reconcileProject(project, dir, HOST, T1);
  assert.equal(ritual(project, "weekly-audit").cadence, "1w");
  const marker = join(dir, ".darius.toml");
  const text = readFileSync(marker, "utf8");
  const start = text.indexOf("[rituals.weekly-audit]");
  const table = text.slice(start).split("\n").filter((line) => !/^(cadence|at|from)\s*=/u.test(line)).join("\n");
  writeFileSync(marker, text.slice(0, start) + table);
  commitAll(dir, "weekly on demand");
  const result = reconcileProject(project, dir, HOST, T2);
  assert.ok(result.updated.includes("weekly-audit"));
  const weekly = ritual(project, "weekly-audit");
  assert.equal("cadence" in weekly, false);
  assert.deepEqual([weekly.at, weekly.from], [undefined, undefined]);
  assert.equal(ritual(project, "daily-report").cadence, "1d");
});

test("unchanged: the same hash, commit and dirty flag write nothing", { skip: NO_GIT }, () => {
  const { project, dir } = setup({ git: true });
  reconcileProject(project, dir, HOST, T1);
  const before = readItemText(project, "ritual", "daily-report");
  const ledgerBefore = readLedger(project).length;
  const result = reconcileProject(project, dir, "host-b", T2);
  assert.deepEqual(result.unchanged, ["daily-report", "weekly-audit"]);
  assert.deepEqual([result.adopted, result.updated, result.retired], [[], [], []]);
  assert.equal(readItemText(project, "ritual", "daily-report"), before);
  assert.equal(readLedger(project).length, ledgerBefore);
});

test("update: a changed definition or a new commit rewrites the mirror and the def keys", { skip: NO_GIT }, () => {
  const { project, dir } = setup({ git: true });
  reconcileProject(project, dir, HOST, T1);
  const first = ritual(project, "daily-report");
  const marker = join(dir, ".darius.toml");
  writeFileSync(marker, readFileSync(marker, "utf8").replace('title = "Daily site report"', 'title = "Daily report"'));
  const commit = commitAll(dir, "rename");
  const result = reconcileProject(project, dir, "host-b", T2);
  assert.deepEqual(result.updated, ["daily-report", "weekly-audit"], "weekly-audit: same hash, new commit");
  const daily = ritual(project, "daily-report");
  assert.equal(daily.title, "Daily report");
  assert.notEqual(daily.def_hash, first.def_hash);
  assert.deepEqual([daily.def_commit, daily.def_host, daily.def_at, daily.updated], [commit, "host-b", T2.toISOString(), T2.toISOString()]);
  assert.equal(daily.created, first.created);
  const changes = defined(project).filter((line) => line.slug === "daily-report").map((line) => line.change);
  assert.deepEqual(changes, ["adopted", "updated"]);
});

test("retire: a repo ritual that left the marker is retired once, with a note", { skip: NO_GIT }, () => {
  const { project, dir } = setup({ git: true });
  reconcileProject(project, dir, HOST, T1);
  writeFileSync(join(dir, ".darius.toml"), withoutWeekly(readFileSync(join(dir, ".darius.toml"), "utf8")));
  const commit = commitAll(dir, "drop weekly");
  const result = reconcileProject(project, dir, HOST, T2);
  assert.deepEqual(result.retired, ["weekly-audit"]);
  assert.deepEqual(result.updated, ["daily-report"]);
  const ledger = readLedger(project);
  assert.equal(ritualLifecycle(ledger, "weekly-audit"), "retired");
  const lifecycle = ledger.find((line) => line.type === "ritual.lifecycle" && line.item === "ritual/weekly-audit");
  assert.equal(lifecycle?.note, `left .darius.toml at ${commit}`);
  const line = defined(project).find((entry) => entry.slug === "weekly-audit" && entry.change === "retired");
  assert.equal(line?.commit, commit);
  assert.equal(line?.def_hash, ritual(project, "weekly-audit").def_hash);
  assert.equal(ritual(project, "weekly-audit").source, "repo", "the item stays as the last mirror");

  const again = reconcileProject(project, dir, HOST, T3);
  assert.deepEqual(again.retired, []);
  assert.deepEqual(again.unmanaged, []);
});

test("retired stays retired: a slug that comes back in the marker is not revived, and a warning says so", { skip: NO_GIT }, () => {
  const { project, dir } = setup({ git: true });
  reconcileProject(project, dir, HOST, T1);
  const full = readFileSync(join(dir, ".darius.toml"), "utf8");
  writeFileSync(join(dir, ".darius.toml"), withoutWeekly(full));
  commitAll(dir, "drop weekly");
  reconcileProject(project, dir, HOST, T2);
  const before = ritual(project, "weekly-audit");
  writeFileSync(join(dir, ".darius.toml"), full.replace('title = "Weekly audit"', 'title = "Weekly audit, back"'));
  commitAll(dir, "bring weekly back");
  const again = reconcileProject(project, dir, HOST, T3);
  assert.deepEqual(again.warnings, ["weekly-audit was retired; use a new slug"]);
  assert.deepEqual([again.adopted, again.updated, again.retired], [[], ["daily-report"], []], "only the other ritual follows the new commit");
  assert.equal(ritualLifecycle(readLedger(project), "weekly-audit"), "retired");
  assert.deepEqual(ritual(project, "weekly-audit"), before, "the mirror is not rewritten");
  assert.deepEqual(defined(project).filter((entry) => entry.slug === "weekly-audit").map((entry) => entry.change), ["adopted", "retired"]);
});

test("retired stays retired: a retired store ritual named in the marker is not adopted, and a warning says so", { skip: NO_GIT }, () => {
  const { project, dir } = setup({ git: true });
  project.writeItem({
    header: {
      id: "01JBBBBBBBBBBBBBBBBBBBBBBB", kind: "ritual", slug: "daily-report", title: "Old title", created: "2026-01-01T00:00:00.000Z",
      updated: "2026-01-01T00:00:00.000Z", tags: [], cadence: "1d", anchor: "due", policy: { mode: "off", may: [], hold: [] },
    },
    body: "",
  });
  appendLine(project, { who: "test", type: "ritual.lifecycle", item: itemRef("ritual", "daily-report"), state: "retired" });
  const result = reconcileProject(project, dir, HOST, T1);
  assert.deepEqual(result.warnings, ["daily-report was retired; use a new slug"]);
  assert.deepEqual(result.adopted, ["weekly-audit"]);
  assert.equal(ritual(project, "daily-report").title, "Old title", "the store item is not rewritten");
});

test("unmanaged: a store ritual the marker does not name is listed and never written", { skip: NO_GIT }, () => {
  const { project, dir } = setup({ git: true });
  project.writeItem({
    header: {
      id: "01JBBBBBBBBBBBBBBBBBBBBBBB", kind: "ritual", slug: "heartbeat", title: "Heartbeat", created: "2026-01-01T00:00:00.000Z",
      updated: "2026-01-01T00:00:00.000Z", tags: [], cadence: "1d", anchor: "due", policy: { mode: "off", may: [], hold: [] },
    },
    body: "# Heartbeat\n",
  });
  const before = readItemText(project, "ritual", "heartbeat");
  const result = reconcileProject(project, dir, HOST, T1);
  assert.deepEqual(result.unmanaged, ["heartbeat"]);
  assert.deepEqual(result.retired, []);
  assert.equal(readItemText(project, "ritual", "heartbeat"), before);
  assert.equal(ritualLifecycle(readLedger(project), "heartbeat"), "active");
  assert.equal(defined(project).some((line) => line.slug === "heartbeat"), false);
});

test("invalid: a parse error returns file:line and writes nothing", { skip: NO_GIT }, () => {
  const { project, dir } = setup({ git: true });
  reconcileProject(project, dir, HOST, T1);
  const before = readItemText(project, "ritual", "daily-report");
  const ledgerBefore = readLedger(project).length;
  writeFileSync(join(dir, ".darius.toml"), readFileSync(join(dir, ".darius.toml"), "utf8").replace('cadence = "1d"', 'cadence = "daily"'));
  const result = reconcileProject(project, dir, HOST, T2);
  assert.equal(result.ok, false);
  assert.equal(result.marker, "invalid");
  assert.match(result.error ?? "", /\.darius\.toml:\d+: cadence/u);
  assert.deepEqual([result.adopted, result.updated, result.unchanged, result.retired, result.unmanaged], [[], [], [], [], []]);
  assert.equal(readItemText(project, "ritual", "daily-report"), before, "the last mirror stays");
  assert.equal(readLedger(project).length, ledgerBefore);
});

test("invalid: a marker of another project, or no marker, is refused", () => {
  const { project, dir } = setup({ git: false, marker: FIXTURE.replace('project = "acme-web"', 'project = "other-web"') });
  const result = reconcileProject(project, dir, HOST, T1);
  assert.equal(result.marker, "invalid");
  assert.match(result.error ?? "", /"other-web", not "acme-web-\d+"/u);
  const empty = join(SANDBOX, "no-marker");
  mkdirSync(empty, { recursive: true });
  assert.match(reconcileProject(project, empty, HOST, T1).error ?? "", /no \.darius\.toml/u);
  assert.deepEqual(project.listItems("ritual"), []);
});

test("v2: a v1 or v2 marker is a no-op", { skip: NO_GIT }, () => {
  const { project, dir } = setup({ git: true, marker: 'v = 2\nproject = "acme-web"\n' });
  project.writeItem({
    header: {
      id: "01JCCCCCCCCCCCCCCCCCCCCCCC", kind: "ritual", slug: "heartbeat", title: "Heartbeat", created: "2026-01-01T00:00:00.000Z",
      updated: "2026-01-01T00:00:00.000Z", tags: [], cadence: "1d", anchor: "due", policy: { mode: "off", may: [], hold: [] },
    },
    body: "# Heartbeat\n",
  });
  const ledgerBefore = readLedger(project).length;
  const result = reconcileProject(project, dir, HOST, T1);
  assert.deepEqual(result, { ok: true, marker: "v2", dirty: false, adopted: [], updated: [], unchanged: [], retired: [], unmanaged: [], warnings: [] });
  assert.equal(readLedger(project).length, ledgerBefore);
});

test("no git: commit is absent, dirty is false, and the mirror is still written", () => {
  const { project, dir } = setup({ git: false });
  const result = reconcileProject(project, dir, HOST, T1);
  assert.equal(result.ok, true);
  assert.equal(result.commit, undefined);
  assert.equal(result.dirty, false);
  assert.deepEqual(result.adopted, ["daily-report", "weekly-audit"]);
  const daily = ritual(project, "daily-report");
  assert.equal(daily.def_commit, undefined);
  assert.equal(daily.def_dirty, false);
  assert.equal(reconcileProject(project, dir, HOST, T2).unchanged.length, 2);
  // A retire outside git names no commit.
  writeFileSync(join(dir, ".darius.toml"), withoutWeekly(readFileSync(join(dir, ".darius.toml"), "utf8")));
  assert.deepEqual(reconcileProject(project, dir, HOST, T3).retired, ["weekly-audit"]);
  const note = readLedger(project).find((line) => line.type === "ritual.lifecycle")?.note;
  assert.equal(note, "left .darius.toml");
});

test("dirty: only an uncommitted .darius.toml counts; it is recorded and rewrites the mirror", { skip: NO_GIT }, () => {
  const { project, dir } = setup({ git: true });
  dirty(dir, "README.md");
  const clean = reconcileProject(project, dir, HOST, T1);
  assert.equal(clean.dirty, false, "another dirty file never counts");
  dirty(dir, ".darius.toml");
  const result = reconcileProject(project, dir, HOST, T2);
  assert.equal(result.dirty, true);
  assert.deepEqual(result.updated, ["daily-report", "weekly-audit"], "same hash and commit, dirty flag changed");
  assert.equal(ritual(project, "daily-report").def_dirty, true);
  const line = defined(project).findLast((entry) => entry.slug === "daily-report");
  assert.equal(line?.dirty, true);
  assert.deepEqual(reconcileProject(project, dir, HOST, T3).unchanged, ["daily-report", "weekly-audit"]);
});

// --- may_extra and hold_extra reach the mirror ------------------------------------------

function policyFixture(name: string): string {
  return readFileSync(join(import.meta.dirname, "fixtures", `marker-policy-${name}.toml`), "utf8");
}

test("extras: the mirror holds the effective policy; factoring a policy rewrites only what changed order", () => {
  const { project, dir } = setup({ git: false, marker: policyFixture("inline") });
  const first = reconcileProject(project, dir, HOST, T1);
  assert.deepEqual(first.adopted, ["daily-report", "link-audit", "fact-check", "content-fix"]);
  writeFileSync(join(dir, ".darius.toml"), policyFixture("factored").replace('project = "acme-web"', `project = "${project.name}"`));
  const second = reconcileProject(project, dir, HOST, T2);
  assert.deepEqual(second.unchanged, ["daily-report", "link-audit", "content-fix"], "the same lists in the same order hash the same");
  assert.deepEqual(second.updated, ["fact-check"], "the inline twin lists its rules in another order");
  const marker = readMarker(dir);
  assert.ok(marker !== null);
  for (const def of marker.rituals) {
    const item = ritual(project, def.slug);
    assert.deepEqual(item.policy.may, def.policy.may, def.slug);
    assert.deepEqual(item.policy.hold, def.policy.hold, def.slug);
    assert.equal(item.policy.mode, def.policy.mode, def.slug);
    assert.equal(item.def_hash, mirrorHash(marker, def), def.slug);
    const view = resolvedPolicy(def);
    assert.deepEqual(item.policy.may.toSorted(), view.may, def.slug);
    assert.deepEqual(item.policy.hold.toSorted(), view.hold, def.slug);
  }
  const content = ritual(project, "content-fix");
  assert.ok(content.policy.may.includes("Bash(pnpm cli content patch *)"));
  assert.ok(content.policy.hold.includes("\\bpnpm\\s+cli\\s+content\\s+publish\\b"));
  assert.equal((readItemText(project, "ritual", "content-fix") ?? "").includes("_extra"), false, "the store item carries the resolved lists only");
});

// --- skillDirty ------------------------------------------------------------------------

test("skillDirty: a modified or an untracked file in the skill folder counts; other folders do not", { skip: NO_GIT }, () => {
  const dir = join(SANDBOX, "skill-dirty");
  mkdirSync(join(dir, ".claude", "skills", "daily"), { recursive: true });
  mkdirSync(join(dir, ".claude", "skills", "other"), { recursive: true });
  writeFileSync(join(dir, ".claude", "skills", "daily", "SKILL.md"), "---\nname: daily\n---\n");
  writeFileSync(join(dir, ".claude", "skills", "other", "SKILL.md"), "---\nname: other\n---\n");
  initRepo(dir);
  commitAll(dir, "init");
  assert.equal(skillDirty(dir, "daily"), false);
  dirty(dir, join(".claude", "skills", "daily", "SKILL.md"));
  assert.equal(skillDirty(dir, "daily"), true, "modified");
  assert.equal(skillDirty(dir, "other"), false, "only the named folder counts");
  commitAll(dir, "commit");
  writeFileSync(join(dir, ".claude", "skills", "daily", "notes.md"), "draft\n");
  assert.equal(skillDirty(dir, "daily"), true, "untracked");
  assert.equal(skillDirty(dir, "dailyx"), false, "a folder whose name only starts the same does not count");
});

test("skillDirty: false outside git, as markerDirty", () => {
  const dir = join(SANDBOX, "skill-no-git");
  mkdirSync(join(dir, ".claude", "skills", "daily"), { recursive: true });
  writeFileSync(join(dir, ".claude", "skills", "daily", "SKILL.md"), "x\n");
  assert.equal(skillDirty(dir, "daily"), false);
});

/** A marker whose ritual names a policy that has notes, and adds its own. */
function notesMarker(own: string): string {
  return `v = 3\nproject = "acme-web"\ntz = "UTC"\n[policies.guarded]\nmode = "report"\nnotes = "Never push."\n[rituals.daily]\ntitle = "Daily"\nskill = "daily"\npolicy = "guarded"\nnotes = "${own}"\n`;
}

test("a ritual with a policy and its own notes mirrors the joined notes, changes the hash with them, and reaches the run prompt", { skip: NO_GIT }, () => {
  const { project, dir } = setup({ git: true, marker: notesMarker("Hand in a diff.") });
  assert.equal(reconcileProject(project, dir, HOST, T1).ok, true);
  const mirrored = ritual(project, "daily");
  assert.equal(mirrored.policy.notes, "Never push.\n\nHand in a diff.");
  const prompt = buildPrompt({ project: project.name, run: "r1", ritual: mirrored, body: "Do it." });
  assert.ok(prompt.includes("Notes:\nNever push.\n\nHand in a diff."), "the effective notes are in the prompt");
  const before = mirrored.def_hash;
  writeFileSync(join(dir, ".darius.toml"), notesMarker("Hand in a patch.").replace('project = "acme-web"', `project = "${project.name}"`));
  commitAll(dir, "notes");
  const second = reconcileProject(project, dir, HOST, T2);
  assert.deepEqual(second.updated, ["daily"]);
  assert.notEqual(ritual(project, "daily").def_hash, before);
});

test("on_hold deny mirrors into the store item, and the prompt and policy.json carry it (0.66.0)", { skip: NO_GIT }, () => {
  const marker = 'v = 3\nproject = "acme-web"\ntz = "UTC"\n[policies.guarded]\nmode = "report"\nhold = [\'\\bwp\\s\']\non_hold = "deny"\n[rituals.daily]\ntitle = "Daily"\nskill = "daily"\npolicy = "guarded"\n';
  const { project, dir } = setup({ git: true, marker });
  assert.equal(reconcileProject(project, dir, HOST, T1).ok, true);
  const mirrored = ritual(project, "daily");
  assert.equal(mirrored.policy.on_hold, "deny");
  assert.match(readItemText(project, "ritual", "daily") ?? "", /on_hold: deny/u);
  const prompt = buildPrompt({ project: project.name, run: "r1", ritual: mirrored, body: "Do it." });
  assert.ok(prompt.includes("a match is refused and the run goes on"), "the prompt says what a hold match does");
  assert.ok(prompt.includes("Record it as a needs-decision item with the exact command"));
  const files = writeRunFiles(project.root, { project: project.name, run: "r1", ritual: mirrored, body: "Do it." });
  assert.equal(JSON.parse(readFileSync(files.policy, "utf8")).on_hold, "deny");
  const plain = buildPrompt({ project: project.name, run: "r2", ritual: { ...mirrored, policy: { mode: "report", may: [], hold: [] } }, body: "Do it." });
  assert.ok(plain.includes("a match holds the run"), "the default prompt is as before");
});
