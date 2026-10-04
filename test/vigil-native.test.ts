/**
 * The native vigil verbs as a drop-in for the legacy ones: the legacy
 * command-line forms through `bin/darius`, in a throwaway repo whose marker
 * owns `vigil`; the import of a legacy `.tracker/vigils/`; the read-only
 * projection back to legacy files; and `darius due`.
 *
 * Every test runs against a throwaway state dir. Nothing here reads or
 * writes the operator's real store or any real `.tracker/`.
 */

import { after, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { linesFor, readLedger } from "../src/core/ledger.ts";
import type { JsonValue, Vigil } from "../src/core/model.ts";
import { itemRef, openProject, readItemText } from "../src/core/store.ts";
import { importLegacyVigils } from "../src/core/vigil-import.ts";
import { projectedVigilPath, projectVigils, treeDirOf } from "../src/core/vigil-projection.ts";
import { localToday } from "../src/core/sweep.ts";

const BIN = join(import.meta.dirname, "..", "bin", "darius");
const SANDBOX = mkdtempSync(join(tmpdir(), "darius-vigil-native-"));
process.env.DARIUS_STATE_DIR = join(SANDBOX, "state");
process.env.DARIUS_CONFIG_DIR = join(SANDBOX, "config");
after(() => rmSync(SANDBOX, { recursive: true, force: true }));
mkdirSync(process.env.DARIUS_STATE_DIR, { recursive: true });
mkdirSync(process.env.DARIUS_CONFIG_DIR, { recursive: true });
delete process.env.DARIUS_PROJECT;
delete process.env.DARIUS_SWEEP_ACTIVE;

// The legacy dash in the text lines, written as an escape so no em dash sits in the source.
const DASH = "\u2014";

const BODY = "# Acme soak\n\n## Verification Checklist\n\n- [ ] it passes\n  - Command: `test 1 = 1`\n  - Expected: `exit 0`\n";
const BODY_TWO = "# Acme soak\n\n## Verification Checklist\n\n- [ ] first\n  - Command: `test 1 = 1`\n  - Expected: `exit 0`\n- [ ] second\n  - Command: `test 2 = 2`\n  - Expected: `exit 0`\n";

/** One parsed JSON record. */
type Row = Record<string, JsonValue>;

interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
}

function darius(argv: string[], cwd: string, input = ""): Run {
  const result = spawnSync(BIN, argv, { cwd, env: { ...process.env }, encoding: "utf8", input, timeout: 30_000 });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** Makes the tree directory of a store project, as a project that owns the tracker tree has. */
function withTree(name: string): string {
  const tree = join(process.env.DARIUS_STATE_DIR ?? "", name, "tracker");
  mkdirSync(tree, { recursive: true });
  return tree;
}

/** A repo whose marker owns `vigil`. The project is named like the directory. */
function ownedRepo(name: string): string {
  const repo = join(SANDBOX, "repos", name);
  mkdirSync(repo, { recursive: true });
  writeFileSync(join(repo, ".darius.toml"), `v = 3\nproject = "${name}"\ntz = "Europe/Berlin"\nkinds = ["ritual", "vigil"]\n`);
  return repo;
}

function lines(project: string, slug: string, type: string): ReturnType<typeof readLedger> {
  return linesFor(readLedger(openProject(project)), itemRef("vigil", slug)).filter((line) => line.type === type);
}

// --- add, set-body, list, close: the legacy forms ------------------------------------

test("add takes the legacy form, prints the legacy-style line, and a repeat add changes nothing", () => {
  const repo = ownedRepo("nv-add");
  const add = darius(
    ["vigil", "add", "acme-soak", "--name", "Acme soak", "--until", "first batch", "--from", "M1/S02", "--agent", "host-a", "--opened", "2026-09-28", "--stdin"],
    repo,
    BODY,
  );
  assert.equal(add.status, 0, add.stderr);
  assert.equal(add.stdout, "created vigil acme-soak in nv-add (1 executable Command)\n");

  const stored = openProject("nv-add").readItem<Vigil>("vigil", "acme-soak");
  assert.ok(stored);
  assert.equal(stored.header.title, "Acme soak");
  assert.equal(stored.header.until, "first batch");
  assert.equal(stored.header.from, "M1/S02");
  assert.equal(stored.header.agent, "host-a");
  assert.equal(new Date(stored.header.created).getHours(), 12, "created is local noon of --opened");
  assert.equal(stored.body, BODY);

  const before = readItemText(openProject("nv-add"), "vigil", "acme-soak");
  const again = darius(["vigil", "add", "acme-soak", "--name", "Other", "--until", "x", "--stdin"], repo, BODY_TWO);
  assert.equal(again.status, 0, again.stderr);
  assert.equal(again.stdout, "already exists: vigil acme-soak\n");
  assert.equal(readItemText(openProject("nv-add"), "vigil", "acme-soak"), before);

  const two = darius(["vigil", "add", "acme-two", "--due", "2026-10-05", "--content", BODY_TWO], repo);
  assert.equal(two.status, 0, two.stderr);
  assert.equal(two.stdout, "created vigil acme-two in nv-add (2 executable Commands)\n", "--content may carry the text");
  assert.equal(openProject("nv-add").readItem<Vigil>("vigil", "acme-two")?.header.title, "acme-two", "the name falls back to the slug");
});

test("add reads --content as a file path, like the legacy verb", () => {
  const repo = ownedRepo("nv-content");
  const file = join(SANDBOX, "body.md");
  writeFileSync(file, BODY);
  const add = darius(["vigil", "add", "from-file", "--until", "x", "--content", file], repo);
  assert.equal(add.status, 0, add.stderr);
  assert.equal(openProject("nv-content").readItem("vigil", "from-file")?.body, BODY);
});

test("add refuses a missing gate, a bad date, and a body the legacy check refuses", () => {
  const repo = ownedRepo("nv-refuse");
  const noGate = darius(["vigil", "add", "no-gate", "--stdin"], repo, BODY);
  assert.equal(noGate.status, 2);
  assert.match(noGate.stderr, /needs a gate/u);

  const badDate = darius(["vigil", "add", "bad-date", "--due", "2026-13-40", "--stdin"], repo, BODY);
  assert.equal(badDate.status, 2);
  assert.match(badDate.stderr, /--due must be a date/u);

  const noChecklist = darius(["vigil", "add", "no-list", "--until", "x", "--stdin"], repo, "# just a title\n");
  assert.equal(noChecklist.status, 1);
  assert.match(noChecklist.stderr, /Verification Checklist/u);

  const empty = darius(["vigil", "add", "empty", "--until", "x", "--stdin"], repo, "  \n");
  assert.equal(empty.status, 1);
  assert.match(empty.stderr, /empty body/u);

  assert.deepEqual(openProject("nv-refuse").listItems("vigil"), []);
});

test("set-body replaces the body, validates it, and refuses a closed vigil", () => {
  const repo = ownedRepo("nv-body");
  assert.equal(darius(["vigil", "add", "soak", "--name", "Soak", "--until", "x", "--stdin"], repo, BODY).status, 0);
  const set = darius(["vigil", "set-body", "soak", "--stdin"], repo, BODY_TWO);
  assert.equal(set.status, 0, set.stderr);
  assert.equal(set.stdout, "wrote vigil soak in nv-body (2 executable Commands)\n");
  assert.equal(openProject("nv-body").readItem("vigil", "soak")?.body, BODY_TWO);
  assert.equal(lines("nv-body", "soak", "item.changed").length, 2, "add and set-body each wrote through the store");

  const refused = darius(["vigil", "set-body", "soak", "--stdin"], repo, "# nothing to run\n");
  assert.equal(refused.status, 1);
  assert.equal(openProject("nv-body").readItem("vigil", "soak")?.body, BODY_TWO, "a refused body changes nothing");

  assert.equal(darius(["vigil", "close", "soak", "--verdict", "held"], repo).status, 0);
  const closed = darius(["vigil", "set-body", "soak", "--stdin"], repo, BODY);
  assert.equal(closed.status, 1);
  assert.match(closed.stderr, /is closed/u);
  assert.equal(darius(["vigil", "set-body", "ghost", "--stdin"], repo, BODY).status, 1);
});

test("list: text lines, the open filter, and --all in file-name order", () => {
  const repo = ownedRepo("nv-list");
  assert.equal(darius(["vigil", "list"], repo).stdout, "No open vigils\n");
  assert.equal(darius(["vigil", "list", "--all"], repo).stdout, "No vigils\n");
  darius(["vigil", "add", "guard-soak", "--name", "Guard soak", "--due", "2026-10-05", "--until", "first real batch", "--from", "M1/S02", "--opened", "2026-09-28", "--stdin"], repo, BODY);
  darius(["vigil", "add", "cache-check", "--name", "Cache check", "--until", "someday", "--opened", "2026-09-01", "--stdin"], repo, BODY);
  darius(["vigil", "close", "cache-check", "--verdict", "held", "--date", "2026-09-10"], repo);

  const open = darius(["vigil", "list"], repo);
  assert.equal(open.stdout, `guard-soak  (due 2026-10-05; until: first real batch)  ${DASH} Guard soak  (opened 2026-09-28)  [from M1/S02]\n`);
  const all = darius(["vigil", "list", "--all"], repo);
  assert.equal(all.stdout, `cache-check  [held, resolved 2026-09-10]  ${DASH} Cache check\n${open.stdout}`);
});

test("list --json is a bare pretty array with the legacy fields in order, then the native ones", () => {
  const repo = ownedRepo("nv-json");
  withTree("nv-json");
  darius(["vigil", "add", "guard-soak", "--name", "Guard soak", "--until", "first batch", "--from", "M1/S02", "--agent", "host-a", "--opened", "2026-09-28", "--stdin"], repo, BODY);
  darius(["vigil", "add", "bare", "--due", "2026-10-05", "--stdin"], repo, BODY);
  const run = darius(["vigil", "list", "--json"], repo);
  assert.equal(run.status, 0, run.stderr);
  assert.ok(run.stdout.startsWith('[\n  {\n    "slug": "bare",'), run.stdout);
  assert.ok(run.stdout.endsWith("}\n]\n"));
  const records: Row[] = JSON.parse(run.stdout);
  assert.equal(records.length, 2);
  const order = ["slug", "name", "due", "until", "from", "agent", "opened", "resolved", "verdict", "path", "state", "flagged", "heavy", "lastOutcome"];
  for (const record of records) assert.deepEqual(Object.keys(record), order);
  const [bare, soak] = records;
  assert.deepEqual(
    { ...bare, opened: null },
    { slug: "bare", name: "bare", due: "2026-10-05", until: null, from: null, agent: null, opened: null, resolved: null, verdict: null, path: bare?.path, state: "open", flagged: false, heavy: false, lastOutcome: null },
  );
  assert.equal(bare?.opened, localToday());
  assert.deepEqual(soak, {
    slug: "guard-soak",
    name: "Guard soak",
    due: null,
    until: "first batch",
    from: "M1/S02",
    agent: "host-a",
    opened: "2026-09-28",
    resolved: null,
    verdict: null,
    path: soak?.path,
    state: "open",
    flagged: false,
    heavy: false,
    lastOutcome: null,
  });
  assert.equal(soak?.path, projectedVigilPath(treeDirOf(openProject("nv-json")), "guard-soak"), "path is the projected file");
  assert.ok(existsSync(String(soak?.path)));
  assert.equal(darius(["vigil", "list", "--all", "--json"], ownedRepo("nv-json-empty")).stdout, "[]\n");
});

test("close: idempotent for the same verdict, exit 1 for another, --date sets local noon, failed prints the remediation line", () => {
  const repo = ownedRepo("nv-close");
  darius(["vigil", "add", "soak", "--until", "x", "--stdin"], repo, BODY);
  darius(["vigil", "add", "other", "--until", "x", "--stdin"], repo, BODY);

  const first = darius(["vigil", "close", "soak", "--verdict", "held", "--date", "2026-09-10"], repo);
  assert.equal(first.status, 0, first.stderr);
  assert.equal(first.stdout, "closed vigil soak in nv-close (verdict held, resolved 2026-09-10)\n");
  const closed = lines("nv-close", "soak", "vigil.closed");
  assert.equal(closed.length, 1);
  assert.equal(closed[0]?.verdict, "held");
  assert.equal(new Date(closed[0]?.at ?? "").getHours(), 12);
  assert.equal(localDay(closed[0]?.at ?? ""), "2026-09-10");

  const same = darius(["vigil", "close", "soak", "--verdict", "held"], repo);
  assert.equal(same.status, 0, same.stderr);
  assert.equal(same.stdout, "already closed: soak (held), not overwritten\n");
  assert.equal(lines("nv-close", "soak", "vigil.closed").length, 1);

  const different = darius(["vigil", "close", "soak", "--verdict", "failed"], repo);
  assert.equal(different.status, 1);
  assert.match(different.stderr, /already closed held/u);

  const failed = darius(["vigil", "close", "other", "--verdict", "failed"], repo);
  assert.equal(failed.status, 0, failed.stderr);
  assert.match(failed.stdout, /^closed vigil other in nv-close \(verdict failed, resolved \d{4}-\d{2}-\d{2}\)\n {2}Remediation goes to a new spec via darius add\. Never bolt it onto the vigil\.\n$/u);

  assert.equal(darius(["vigil", "close", "ghost", "--verdict", "held"], repo).status, 1);
  assert.equal(darius(["vigil", "close", "soak", "--verdict", "maybe"], repo).status, 2);
  assert.equal(darius(["vigil", "close", "soak", "--verdict", "held", "--date", "yesterday"], repo).status, 2);
});

test("set turns heavy on and off, edits the gates, and writes through the store", () => {
  const repo = ownedRepo("nv-set");
  assert.equal(darius(["vigil", "add", "soak", "--until", "x", "--stdin"], repo, BODY).status, 0);
  const heavy = darius(["vigil", "set", "soak", "--heavy"], repo);
  assert.equal(heavy.status, 0, heavy.stderr);
  assert.equal(heavy.stdout, "updated vigil soak in nv-set: heavy=true\n");
  assert.equal(openProject("nv-set").readItem<Vigil>("vigil", "soak")?.header.heavy, true);

  const light = darius(["vigil", "set", "soak", "--no-heavy", "--due", "2026-10-05", "--until", "later", "--gate-command", "test -f /tmp/ready"], repo);
  assert.equal(light.status, 0, light.stderr);
  assert.equal(light.stdout, "updated vigil soak in nv-set: heavy=false, due=2026-10-05, until=later, gate_command=test -f /tmp/ready\n");
  const stored = openProject("nv-set").readItem<Vigil>("vigil", "soak");
  assert.deepEqual([stored?.header.heavy, stored?.header.due, stored?.header.until, stored?.header.gate_command], [false, "2026-10-05", "later", "test -f /tmp/ready"]);
  assert.equal(stored?.body, BODY, "the body is untouched");
  assert.equal(lines("nv-set", "soak", "item.changed").length, 3, "add and each set wrote through writeItemText");

  const json = darius(["vigil", "set", "soak", "--heavy", "--json"], repo);
  assert.equal(JSON.parse(json.stdout).updated.heavy, true);
  assert.equal(JSON.parse(json.stdout).project, "nv-set");
});

test("set refuses a closed vigil (exit 1), no flag or a bad flag (exit 2), and a self-sweeping gate", () => {
  const repo = ownedRepo("nv-set-refuse");
  darius(["vigil", "add", "soak", "--until", "x", "--stdin"], repo, BODY);
  assert.equal(darius(["vigil", "set", "soak"], repo).status, 2, "no flag is a usage error");
  assert.equal(darius(["vigil", "set", "soak", "--heavy", "--no-heavy"], repo).status, 2);
  assert.equal(darius(["vigil", "set", "soak", "--due", "tomorrow"], repo).status, 2);
  assert.equal(darius(["vigil", "set", "soak", "--gate-command", "darius vigil sweep"], repo).status, 1);
  assert.equal(darius(["vigil", "set", "ghost", "--heavy"], repo).status, 1);
  darius(["vigil", "close", "soak", "--verdict", "held"], repo);
  const before = readItemText(openProject("nv-set-refuse"), "vigil", "soak");
  const closed = darius(["vigil", "set", "soak", "--heavy"], repo);
  assert.equal(closed.status, 1);
  assert.match(closed.stderr, /is closed/u);
  assert.equal(readItemText(openProject("nv-set-refuse"), "vigil", "soak"), before);
});

function localDay(iso: string): string {
  return localToday(new Date(iso));
}

// --- import ------------------------------------------------------------------------

/** A throwaway `.tracker/` holding the given `vigils/` files. */
function legacyTracker(name: string, files: Record<string, string>): string {
  const tracker = join(SANDBOX, "legacy", name, ".tracker");
  mkdirSync(join(tracker, "vigils"), { recursive: true });
  for (const [file, text] of Object.entries(files)) writeFileSync(join(tracker, "vigils", file), text);
  return tracker;
}

function legacyFile(fields: Record<string, string>, body = "\n## Verification Checklist\n\n- [ ] check\n  - Command: `test 1 = 1`\n  - Expected: `exit 0`\n"): string {
  const header = Object.entries(fields).map(([key, value]) => `${key}: ${value}`);
  return ["---", "type: vigil", ...header, "---", body].join("\n");
}

const OPEN_FILE = legacyFile({ name: "Guard soak", slug: "guard-soak", due: "2026-10-05", until: "first real batch", from: "M1/S02", agent: "host-a", opened: "2026-09-28", resolved: "", verdict: "" });
const CLOSED_FILE = legacyFile({ name: "Cache check", slug: "cache-check", due: "", until: "", from: "", agent: "", opened: "2026-09-01", resolved: "2026-09-10", verdict: "held" });

test("import: open and closed vigils, local noon dates, the close line, and the body byte for byte", () => {
  const project = openProject("nv-import", { create: true });
  const tracker = legacyTracker("nv-import", { "guard-soak.md": OPEN_FILE, "cache-check.md": CLOSED_FILE, "_template.md": "x", "00-INDEX.md": "x" });
  const result = importLegacyVigils(project, tracker, { dryRun: false });
  assert.deepEqual(result, { imported: ["cache-check", "guard-soak"], unchanged: [], closed: 1, problems: [] });
  assert.deepEqual(project.listItems("vigil"), ["cache-check", "guard-soak"]);

  const open = project.readItem<Vigil>("vigil", "guard-soak");
  assert.ok(open);
  assert.deepEqual(
    [open.header.title, open.header.due, open.header.until, open.header.from, open.header.agent, open.header.heavy, open.header.imported_from],
    ["Guard soak", "2026-10-05", "first real batch", "M1/S02", "host-a", true, ".tracker/vigils/guard-soak.md"],
  );
  assert.equal(new Date(open.header.created).getHours(), 12);
  assert.equal(localDay(open.header.created), "2026-09-28");
  const source = readFileSync(join(tracker, "vigils", "guard-soak.md"), "utf8");
  assert.equal(open.body, source.slice(source.indexOf("\n---\n", 4) + "\n---\n".length), "the body is kept byte for byte");
  assert.equal(lines("nv-import", "guard-soak", "vigil.closed").length, 0);
  assert.equal(project.readItem<Vigil>("vigil", "cache-check")?.header.heavy, false, "a closed vigil stays heavy: false");

  const closedLines = lines("nv-import", "cache-check", "vigil.closed");
  assert.equal(closedLines.length, 1);
  const [line] = closedLines;
  assert.deepEqual([line?.verdict, line?.by, line?.who, line?.imported_from], ["held", "import", "import", ".tracker/vigils/cache-check.md"]);
  assert.equal(new Date(line?.at ?? "").getHours(), 12);
  assert.equal(localDay(line?.at ?? ""), "2026-09-10");
});

test("import is idempotent: a second run is unchanged and writes no line", () => {
  const project = openProject("nv-idem", { create: true });
  const tracker = legacyTracker("nv-idem", { "guard-soak.md": OPEN_FILE, "cache-check.md": CLOSED_FILE });
  importLegacyVigils(project, tracker, { dryRun: false });
  const ledgerBefore = readLedger(project).length;
  const textBefore = readItemText(project, "vigil", "guard-soak");
  const again = importLegacyVigils(project, tracker, { dryRun: false });
  assert.deepEqual(again, { imported: [], unchanged: ["cache-check", "guard-soak"], closed: 0, problems: [] });
  assert.equal(readLedger(project).length, ledgerBefore);
  assert.equal(readItemText(project, "vigil", "guard-soak"), textBefore);
});

test("a re-import keeps the stored heavy value, so --no-heavy survives it", () => {
  const repo = ownedRepo("nv-keep-heavy");
  const project = openProject("nv-keep-heavy", { create: true });
  const tracker = legacyTracker("nv-keep-heavy", { "guard-soak.md": OPEN_FILE });
  importLegacyVigils(project, tracker, { dryRun: false });
  assert.equal(project.readItem<Vigil>("vigil", "guard-soak")?.header.heavy, true, "an imported open vigil is heavy");
  assert.equal(darius(["vigil", "set", "guard-soak", "--no-heavy"], repo).status, 0);
  const again = importLegacyVigils(project, tracker, { dryRun: false });
  assert.equal(project.readItem<Vigil>("vigil", "guard-soak")?.header.heavy, false);
  assert.deepEqual(again.problems, []);
});

test("import does not close twice when the store already holds a vigil.closed line", () => {
  const project = openProject("nv-closed-once", { create: true });
  const tracker = legacyTracker("nv-closed-once", { "cache-check.md": CLOSED_FILE });
  importLegacyVigils(project, tracker, { dryRun: false });
  const [first] = lines("nv-closed-once", "cache-check", "vigil.closed");
  assert.ok(first);
  // The operator closed it again in the store, then the legacy file is re-imported: still one line each way.
  const rerun = importLegacyVigils(project, tracker, { dryRun: false });
  assert.equal(rerun.closed, 0);
  assert.equal(lines("nv-closed-once", "cache-check", "vigil.closed").length, 1);
});

test("import --dry-run writes nothing and says what it would do", () => {
  const project = openProject("nv-dry", { create: true });
  const tracker = legacyTracker("nv-dry", { "guard-soak.md": OPEN_FILE, "cache-check.md": CLOSED_FILE });
  const result = importLegacyVigils(project, tracker, { dryRun: true });
  assert.deepEqual(result, { imported: ["cache-check", "guard-soak"], unchanged: [], closed: 1, problems: [] });
  assert.deepEqual(project.listItems("vigil"), []);
  assert.equal(readLedger(project).length, 0);
});

test("import: a bad slug and a broken header are problems, and a real run then writes nothing at all", () => {
  const project = openProject("nv-problems", { create: true });
  const tracker = legacyTracker("nv-problems", {
    "guard-soak.md": OPEN_FILE,
    "Bad_Slug.md": OPEN_FILE,
    "no-header.md": "# just text, no frontmatter\n",
    "unclosed.md": "---\nname: x\nnever closes\n",
    "bad-verdict.md": legacyFile({ name: "x", verdict: "maybe" }),
  });
  const result = importLegacyVigils(project, tracker, { dryRun: false });
  assert.equal(result.problems.length, 4, result.problems.join("\n"));
  assert.match(result.problems.join("\n"), /'Bad_Slug' is not a valid slug/u);
  assert.match(result.problems.join("\n"), /no-header\.md: no usable frontmatter header/u);
  assert.match(result.problems.join("\n"), /unclosed\.md: no usable frontmatter header/u);
  assert.match(result.problems.join("\n"), /verdict 'maybe'/u);
  assert.deepEqual(project.listItems("vigil"), [], "a problem stops the whole write");
  assert.equal(readLedger(project).length, 0);
});

test("import: a same-slug item of another origin is a problem; a body the validator refuses still imports", () => {
  const project = openProject("nv-origin", { create: true });
  const repo = ownedRepo("nv-origin");
  assert.equal(darius(["vigil", "add", "guard-soak", "--until", "x", "--stdin"], repo, BODY).status, 0);
  const clash = importLegacyVigils(project, legacyTracker("nv-origin", { "guard-soak.md": OPEN_FILE }), { dryRun: false });
  assert.equal(clash.problems.length, 1);
  assert.match(clash.problems[0] ?? "", /already exists and was not imported from/u);

  const odd = "\nno checklist here, and an unquoted <placeholder> too\n";
  const tracker = legacyTracker("nv-origin-odd", { "odd-one.md": legacyFile({ name: "Odd" }, odd) });
  const ok = importLegacyVigils(project, tracker, { dryRun: false });
  assert.deepEqual(ok, { imported: ["odd-one"], unchanged: [], closed: 0, problems: [] });
  assert.equal(project.readItem("vigil", "odd-one")?.body, odd);
  assert.equal(readItemText(project, "vigil", "odd-one")?.includes("odd-one"), true);
});

test("import: a vigil with no opened date takes the file mtime; a missing vigils dir is empty", () => {
  const project = openProject("nv-mtime", { create: true });
  const tracker = legacyTracker("nv-mtime", { "undated.md": legacyFile({ name: "Undated", until: "x" }) });
  const stamp = new Date(2026, 5, 15, 8, 30);
  utimesSync(join(tracker, "vigils", "undated.md"), stamp, stamp);
  importLegacyVigils(project, tracker, { dryRun: false });
  assert.equal(new Date(project.readItem<Vigil>("vigil", "undated")?.header.created ?? "").getTime(), stamp.getTime());
  assert.deepEqual(importLegacyVigils(project, join(SANDBOX, "no-such-tracker"), { dryRun: false }), { imported: [], unchanged: [], closed: 0, problems: [] });
});

// --- the golden: native list after an import equals the legacy list --------------------

test("native list --json after an import carries the same legacy fields as the legacy CLI", () => {
  const files = {
    "guard-soak.md": OPEN_FILE,
    "cache-check.md": CLOSED_FILE,
    "a-b.md": legacyFile({ name: "Dash slug", until: "later", opened: "2026-08-01" }),
    "a.md": legacyFile({ name: "Plain slug", due: "2026-12-01", opened: "2026-08-02", agent: "host-b" }),
    "failed-one.md": legacyFile({ name: "Failed one", opened: "2026-07-01", resolved: "2026-07-09", verdict: "failed", from: "M2/S01" }),
  };
  // The legacy side: a repo with no marker, so the verb goes to the vendored legacy CLI.
  const legacyRepo = join(SANDBOX, "legacy-golden");
  const tracker = join(legacyRepo, ".tracker");
  mkdirSync(join(tracker, "vigils"), { recursive: true });
  for (const [file, text] of Object.entries(files)) writeFileSync(join(tracker, "vigils", file), text);
  const legacy = darius(["vigil", "list", "--all", "--json"], legacyRepo);
  assert.equal(legacy.status, 0, legacy.stderr);
  const legacyRecords: Row[] = JSON.parse(legacy.stdout);
  assert.equal(legacyRecords.length, 5);

  // The native side: import the same files, then list through the marker-owned route.
  const repo = ownedRepo("nv-golden");
  importLegacyVigils(openProject("nv-golden", { create: true }), tracker, { dryRun: false });
  const native = darius(["vigil", "list", "--all", "--json"], repo);
  assert.equal(native.status, 0, native.stderr);
  const nativeRecords: Row[] = JSON.parse(native.stdout);

  const fields = ["slug", "name", "due", "until", "from", "agent", "opened", "resolved", "verdict"];
  const pick = (record: Row): Row => Object.fromEntries(fields.map((field) => [field, record[field]]));
  assert.deepEqual(nativeRecords.map(pick), legacyRecords.map(pick));
  assert.deepEqual(Object.keys(nativeRecords[0] ?? {}).slice(0, 9), fields, "the legacy fields come first, in the legacy order");

  const legacyText = darius(["vigil", "list", "--all"], legacyRepo);
  const nativeText = darius(["vigil", "list", "--all"], repo);
  assert.equal(nativeText.stdout, legacyText.stdout, "the text lines match too");
  assert.equal(darius(["vigil", "list"], repo).stdout, darius(["vigil", "list"], legacyRepo).stdout);
});

// --- projection ----------------------------------------------------------------------

test("projection: files in the legacy format, a stale file removed, an unchanged file not rewritten", () => {
  const project = openProject("nv-proj", { create: true });
  const tracker = legacyTracker("nv-proj", { "guard-soak.md": OPEN_FILE, "cache-check.md": CLOSED_FILE });
  importLegacyVigils(project, tracker, { dryRun: false });
  const tree = join(SANDBOX, "tree", "nv-proj");
  projectVigils(project, tree);
  assert.deepEqual(readdirSync(join(tree, "vigils")), ["cache-check.md", "guard-soak.md"]);

  const text = readFileSync(projectedVigilPath(tree, "guard-soak"), "utf8");
  assert.ok(
    text.startsWith(
      "---\ntype: vigil\nname: Guard soak\nslug: guard-soak\ndue: 2026-10-05\nuntil: first real batch\nfrom: M1/S02\nagent: host-a\nopened: 2026-09-28\nresolved:\nverdict:\n---\n\n## Verification Checklist\n",
    ),
    text,
  );
  const closed = readFileSync(projectedVigilPath(tree, "cache-check"), "utf8");
  assert.match(closed, /^---\ntype: vigil\nname: Cache check\nslug: cache-check\ndue:\nuntil:\nfrom:\nagent:\nopened: 2026-09-01\nresolved: 2026-09-10\nverdict: held\n---\n/u);

  // A stale file goes; an unchanged file keeps its mtime.
  writeFileSync(join(tree, "vigils", "stale.md"), "old");
  const old = new Date(2020, 0, 1);
  utimesSync(projectedVigilPath(tree, "guard-soak"), old, old);
  projectVigils(project, tree);
  assert.equal(existsSync(join(tree, "vigils", "stale.md")), false);
  assert.equal(statSync(projectedVigilPath(tree, "guard-soak")).mtimeMs, old.getTime(), "an unchanged file is not rewritten");

  // A changed store vigil rewrites its file only (the tree dir exists, so the verb projects).
  const repo = ownedRepo("nv-proj");
  withTree("nv-proj");
  assert.equal(darius(["vigil", "close", "guard-soak", "--verdict", "failed", "--date", "2026-10-01"], repo).status, 0);
  projectVigils(project, tree);
  assert.match(readFileSync(projectedVigilPath(tree, "guard-soak"), "utf8"), /resolved: 2026-10-01\nverdict: failed\n/u);
});

test("projection: the legacy vigil parser and the legacy list read the files", async () => {
  const project = openProject("nv-legacy-read", { create: true });
  const tracker = legacyTracker("nv-legacy-read", {
    "guard-soak.md": legacyFile({ name: "Colon: in the name", slug: "guard-soak", until: "it's # not a comment", opened: "2026-09-28" }),
    "cache-check.md": CLOSED_FILE,
  });
  importLegacyVigils(project, tracker, { dryRun: false });
  const tree = join(SANDBOX, "tree", "nv-legacy-read");
  projectVigils(project, tree);

  const legacyModule = new URL("../src/legacy/lib/documents/vigil.ts", import.meta.url);
  // SAFETY: the vendored legacy tree's pure parser module; parseVigil returns the header fields as strings.
  const { parseVigil } = (await import(legacyModule.href)) as { parseVigil(raw: string): { input: Record<string, string | undefined>; content: string } };
  const parsed = parseVigil(readFileSync(projectedVigilPath(tree, "guard-soak"), "utf8"));
  assert.equal(parsed.input.type, "vigil");
  assert.equal(parsed.input.name, "Colon: in the name");
  assert.equal(parsed.input.until, "it's # not a comment");
  assert.equal(parsed.input.opened, "2026-09-28");
  assert.match(parsed.content, /## Verification Checklist/u);

  // The whole legacy CLI reads the projection as a tracker tree.
  const repo = join(SANDBOX, "legacy-read-repo");
  mkdirSync(repo, { recursive: true });
  symlinkSync(tree, join(repo, ".tracker"));
  const list = darius(["vigil", "list", "--all", "--json"], repo);
  assert.equal(list.status, 0, list.stderr);
  const records: { slug: string; name: string; verdict: string | null }[] = JSON.parse(list.stdout);
  assert.deepEqual(
    records.map((record) => [record.slug, record.name, record.verdict]),
    [
      ["cache-check", "Cache check", "held"],
      ["guard-soak", "Colon: in the name", null],
    ],
  );
});

test("projection: an empty store leaves no tree behind", () => {
  const project = openProject("nv-proj-empty", { create: true });
  const tree = join(SANDBOX, "tree", "nv-proj-empty");
  projectVigils(project, tree);
  assert.equal(existsSync(tree), false);
});

// --- due ---------------------------------------------------------------------------

test("due lists the vigils of a project that owns vigil: due ones and armed ones", () => {
  const repo = ownedRepo("nv-due");
  const yesterday = localToday(new Date(Date.now() - 2 * 86_400_000));
  darius(["vigil", "add", "date-due", "--name", "Date due", "--due", yesterday, "--from", "M1/S01", "--stdin"], repo, BODY);
  darius(["vigil", "add", "waiting", "--name", "Waiting", "--until", "first batch", "--opened", "2026-09-28", "--stdin"], repo, BODY);
  darius(["vigil", "add", "future", "--name", "Future", "--due", "2999-01-01", "--stdin"], repo, BODY);
  darius(["vigil", "add", "done", "--name", "Done", "--until", "x", "--stdin"], repo, BODY);
  darius(["vigil", "close", "done", "--verdict", "held"], repo);

  const json = darius(["due", "--json"], repo);
  assert.equal(json.status, 0, json.stderr);
  const parsed: { project: string; rituals: unknown[]; vigils: { due: Row[]; armed: Row[] } } = JSON.parse(json.stdout);
  assert.equal(parsed.project, "nv-due");
  assert.deepEqual(parsed.rituals, []);
  assert.deepEqual(parsed.vigils.due.map((row) => [row.slug, row.daysOverdue, row.name, row.from, row.project]), [["date-due", 2, "Date due", "M1/S01", "nv-due"]]);
  assert.deepEqual(parsed.vigils.armed.map((row) => [row.slug, row.until, row.opened]), [["waiting", "first batch", "2026-09-28"]]);

  const text = darius(["due"], repo);
  assert.equal(
    text.stdout,
    `Vigils due:\n  nv-due/date-due  (overdue 2d, due ${yesterday})  ${DASH} Date due  [from M1/S01]\nVigils armed (event-gated):\n  nv-due/waiting  ${DASH} waiting on: first batch  (opened 2026-09-28)\n`,
  );
});

test("due lists no vigils for a project that does not own vigil, and keeps the ritual-only text", () => {
  const repo = join(SANDBOX, "repos", "nv-due-plain");
  mkdirSync(repo, { recursive: true });
  writeFileSync(join(repo, ".darius.toml"), 'v = 3\nproject = "nv-due-plain"\ntz = "Europe/Berlin"\n');
  const project = openProject("nv-due-plain", { create: true });
  importLegacyVigils(project, legacyTracker("nv-due-plain", { "guard-soak.md": OPEN_FILE }), { dryRun: false });
  const json = darius(["due", "--json"], repo);
  assert.deepEqual(JSON.parse(json.stdout).vigils, { due: [], armed: [] });
  assert.equal(darius(["due"], repo).stdout, "no rituals due\n");
});

test("a vigil verb never creates the tree dir; with a tree dir it refreshes the projection", () => {
  const repo = ownedRepo("nv-guard");
  assert.equal(darius(["vigil", "add", "soak", "--until", "x", "--stdin"], repo, BODY).status, 0);
  assert.equal(darius(["vigil", "set-body", "soak", "--stdin"], repo, BODY_TWO).status, 0);
  assert.equal(darius(["vigil", "set", "soak", "--no-heavy"], repo).status, 0);
  assert.equal(darius(["vigil", "close", "soak", "--verdict", "held"], repo).status, 0);
  const storeDir = join(process.env.DARIUS_STATE_DIR ?? "", "nv-guard");
  assert.equal(existsSync(join(storeDir, "tracker")), false, "no tracker/ folder in the store dir");

  const tree = withTree("nv-guard");
  assert.equal(existsSync(join(tree, "vigils")), false);
  assert.equal(darius(["vigil", "add", "second", "--until", "x", "--stdin"], repo, BODY).status, 0);
  assert.deepEqual(readdirSync(join(tree, "vigils")), ["second.md", "soak.md"], "with the tree dir present the verb projects into it");
});

test("the store was the only thing the native verbs wrote: no .tracker/ appears in the repo", () => {
  const repo = ownedRepo("nv-no-tracker");
  darius(["vigil", "add", "soak", "--until", "x", "--stdin"], repo, BODY);
  darius(["vigil", "close", "soak", "--verdict", "held"], repo);
  assert.equal(existsSync(join(repo, ".tracker")), false);
});

