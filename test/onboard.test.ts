/**
 * `darius onboard` (src/cli/onboard.ts) against the real vendored legacy CLI,
 * in temp git repos: the move, that every tracker verb answers the same
 * before and after it, that a write verb then changes only the store, the
 * refusals, and that `--dry-run` writes nothing.
 *
 * The fixture tracker is made by the legacy CLI itself, then committed. It
 * has no `vigils/` folder: the vigil import is another module's work.
 */

import { after, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

import { withKinds } from "../src/cli/onboard.ts";
import { decodeMarker } from "../src/core/marker.ts";
import { NO_GIT } from "./helpers/git.ts";

const BIN = join(import.meta.dirname, "..", "bin", "darius");
const SANDBOX = mkdtempSync(join(tmpdir(), "darius-onboard-"));
after(() => rmSync(SANDBOX, { recursive: true, force: true }));

interface Run {
  code: number | null;
  stdout: string;
  stderr: string;
}

interface Host {
  env: NodeJS.ProcessEnv;
  state: string;
}

let count = 0;

function host(): Host {
  count += 1;
  const home = join(SANDBOX, `host-${String(count)}`);
  mkdirSync(home, { recursive: true });
  const state = join(home, "state");
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: home,
    CLAUDE_CONFIG_DIR: join(home, ".claude"),
    DARIUS_STATE_DIR: state,
    DARIUS_CONFIG_DIR: join(home, "config"),
    DARIUS_WHO: "dev@example.com",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    NO_COLOR: "1",
  };
  delete env.DARIUS_PROJECT;
  return { env, state };
}

function darius(at: Host, argv: string[], cwd: string): Run {
  const result = spawnSync(BIN, argv, { cwd, env: at.env, encoding: "utf8", input: "", timeout: 30_000 });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

function git(at: Host, dir: string, args: readonly string[]): string {
  const identity = ["-c", "user.name=darius-test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false"];
  const result = spawnSync("git", [...identity, ...args], { cwd: dir, env: at.env, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout;
}

/** Every entry under `dir`: relative path, mode, and the bytes of files, in one sha256. Skips `.git` when asked. */
function treeHash(dir: string, skip: readonly string[] = []): string {
  const hash = createHash("sha256");
  const walk = (at: string): void => {
    for (const name of readdirSync(at).toSorted()) {
      const path = join(at, name);
      if (skip.includes(relative(dir, path))) continue;
      const stats = lstatSync(path);
      hash.update(`${relative(dir, path)}\0${String(stats.mode)}\0`);
      if (stats.isDirectory()) walk(path);
      else if (stats.isSymbolicLink()) hash.update(readlinkSync(path));
      else hash.update(readFileSync(path));
    }
  };
  walk(dir);
  return hash.digest("hex");
}

const MARKER = [
  "# acme-web: the darius marker",
  "v = 3",
  'project = "PROJECT"',
  "",
  "# the zone of every ritual",
  'tz = "Europe/Berlin"',
  "",
  "[rituals.weekly-review]",
  'title = "Weekly review"',
  'skill = "weekly-review"',
  'cadence = "7d"',
  "",
].join("\n");

const SPEC = ".tracker/M1-alpha/01-spec-one.md";

/** One legacy vigil file, as the legacy CLI writes it. `commands` empty: an armed vigil nobody can run. */
function vigilFile(options: { slug: string; from: string; commands: string[]; resolved?: string; verdict?: string }): string {
  const steps =
    options.commands.length === 0
      ? "- [ ] look at the dashboard\n"
      : options.commands.map((command, index) => `- [ ] step ${String(index + 1)}\n  - Command: \`${command}\`\n  - Expected: \`exit 0\`\n`).join("");
  return [
    "---",
    "type: vigil",
    `name: ${options.slug}`,
    `slug: ${options.slug}`,
    "due:",
    "until: first real batch",
    `from: ${options.from}`,
    "agent:",
    "opened: 2026-09-02",
    `resolved: ${options.resolved ?? ""}`,
    `verdict: ${options.verdict ?? ""}`,
    "---",
    "",
    `# ${options.slug}`,
    "",
    "## Verification Checklist",
    "",
    steps,
  ].join("\n");
}

/** Two open vigils (one guards M1 and has no Command) and one closed one. */
const VIGILS = {
  "guard-soak": vigilFile({ slug: "guard-soak", from: "M1/01", commands: [] }),
  "cache-check": vigilFile({ slug: "cache-check", from: "M2/01", commands: ["test -f README.md"] }),
  "old-soak": vigilFile({ slug: "old-soak", from: "M2/01", commands: ["test -f README.md"], resolved: "2026-09-20", verdict: "held" }),
};

/** A committed legacy repo, linked on `at`: a tracker made by the legacy CLI, a v3 marker without kinds. */
function legacyRepo(at: Host, name: string, options: { vigils?: boolean } = {}): string {
  const dir = join(SANDBOX, name);
  mkdirSync(join(dir, ".tracker"), { recursive: true });
  git(at, dir, ["init", "--quiet", "--initial-branch=main"]);
  writeFileSync(join(dir, ".tracker", "00-INDEX.md"), "---\nschema_version: 9\n---\n# Index\n");
  for (const argv of [
    ["add", "milestone", "--name", "Alpha", "--slug", "alpha", "--owner", "dev@example.com"],
    ["add", "spec", "--milestone", "alpha", "--name", "Spec one", "--template", "generic"],
    ["add", "milestone", "--name", "Beta", "--slug", "beta", "--owner", "dev@example.com"],
  ]) {
    const made = darius(at, argv, dir);
    assert.equal(made.code, 0, `${argv.join(" ")}: ${made.stderr}`);
  }
  mkdirSync(join(dir, ".tracker", "worklog"), { recursive: true });
  writeFileSync(join(dir, ".tracker", "worklog", "M1-alpha.md"), "# M1 worklog\n\nA note.\n");
  mkdirSync(join(dir, ".tracker", "archive", "M0-old"), { recursive: true });
  writeFileSync(join(dir, ".tracker", "archive", "M0-old", "summary.md"), "# Old\n");
  writeFileSync(join(dir, ".tracker", "M1-alpha", "diagram.bin"), new Uint8Array([0, 159, 146, 150, 255, 0, 10]));
  writeFileSync(join(dir, ".tracker", "M1-alpha", "check.sh"), "#!/bin/sh\nexit 0\n");
  chmodSync(join(dir, ".tracker", "M1-alpha", "check.sh"), 0o755);
  if (options.vigils === true) {
    mkdirSync(join(dir, ".tracker", "vigils"));
    for (const [slug, text] of Object.entries(VIGILS)) writeFileSync(join(dir, ".tracker", "vigils", `${slug}.md`), text);
  }
  writeFileSync(join(dir, ".darius.toml"), MARKER.replace("PROJECT", name));
  writeFileSync(join(dir, "README.md"), "# acme\n");
  git(at, dir, ["add", "--all"]);
  git(at, dir, ["commit", "--quiet", "--message", "legacy tracker"]);
  const linked = darius(at, ["link"], dir);
  assert.equal(linked.code, 0, linked.stderr);
  return dir;
}

/**
 * What the read verbs print, to compare before and after the move. Since
 * 0.78.0 store mode prints paths tracker-relative and adds `absPath`, so
 * both are folded to one form: no `absPath`, no `.tracker/` prefix.
 */
function readViews(at: Host, dir: string): string[] {
  return [["status"], ["status", "--json"], ["list", "specs", "--json"], ["show", SPEC], ["show", SPEC, "--json"], ["next"]].map((argv) => {
    const result = darius(at, argv, dir);
    assert.equal(result.code, 0, `${argv.join(" ")}: ${result.stderr}`);
    // `absPath` is the last field where a verb adds it.
    const text = result.stdout.replaceAll(/,\n\s*"absPath": "[^"]*"/gu, "");
    return `${argv.join(" ")}\n${text.replaceAll(`${dir}/.tracker/`, "").replaceAll('".tracker/', '"')}`;
  });
}

test("onboard moves the tracker into the store; every read verb answers the same; a write verb changes only the store", { skip: NO_GIT }, () => {
  const at = host();
  const name = "acme-web";
  const dir = legacyRepo(at, name);
  const sourceHash = treeHash(join(dir, ".tracker"));
  const views = readViews(at, dir);
  const head = git(at, dir, ["rev-parse", "HEAD"]).trim();

  const scan = darius(at, ["onboard", "scan", "--json"], dir);
  assert.equal(scan.code, 0, scan.stdout + scan.stderr);
  const report = JSON.parse(scan.stdout);
  assert.equal(report.tracker, "folder");
  assert.deepEqual(report.git, { repo: true, tracked: true, clean: true, dirty: [] });
  assert.deepEqual(report.blockers, []);

  const moved = darius(at, ["onboard"], dir);
  assert.equal(moved.code, 0, moved.stdout + moved.stderr);
  assert.match(moved.stdout, /^✓ 1 vigils: none in \.tracker\/vigils$/mu);
  assert.match(moved.stdout, /^✓ 2 copy: 8 files, \d+ bytes into .*, every sha256 checked$/mu);
  assert.match(moved.stdout, /^ {2}git add \.darius\.toml$/mu);
  assert.match(moved.stdout, /update darius first, pull, and run darius sync/u);

  // The store tree is byte for byte the old folder; the checkout holds no .tracker path (0.78.0).
  const tree = join(at.state, name, "tracker");
  assert.equal(lstatSync(join(dir, ".tracker"), { throwIfNoEntry: false }), undefined);
  assert.equal(treeHash(tree), sourceHash);
  // The removal is staged; the marker kept every comment and got one line.
  const staged = git(at, dir, ["diff", "--cached", "--name-status"]).trim().split("\n");
  assert.equal(staged.length, 8);
  assert.ok(staged.every((line) => line.startsWith("D\t.tracker/")), staged.join("\n"));
  assert.equal(readFileSync(join(dir, ".darius.toml"), "utf8"), MARKER.replace("PROJECT", name).replace('tz = "Europe/Berlin"\n', 'tz = "Europe/Berlin"\nkinds = ["ritual", "vigil", "milestone"]\n'));
  assert.equal(existsSync(join(dir, ".gitignore")), false, "onboard leaves .gitignore alone");
  const ledger = readdirSync(join(at.state, name, "ledger"), { recursive: true, encoding: "utf8" })
    .filter((file) => file.endsWith(".jsonl"))
    .flatMap((file) => readFileSync(join(at.state, name, "ledger", file), "utf8").trim().split("\n"))
    .map((line) => JSON.parse(line));
  const cutover = ledger.filter((line) => line.type === "project.cutover");
  assert.equal(cutover.length, 1);
  assert.deepEqual([cutover[0].kinds, cutover[0].source_commit, cutover[0].files], [["vigil", "milestone"], head, 8]);
  assert.equal(ledger.filter((line) => line.type === "tree.put").length, 7, "every file but the derived 00-INDEX.md");

  assert.deepEqual(readViews(at, dir), views);

  git(at, dir, ["add", ".darius.toml"]);
  git(at, dir, ["commit", "--quiet", "--message", "the store owns the tracker"]);
  assert.equal(git(at, dir, ["status", "--porcelain"]), "");

  const before = readFileSync(join(tree, "M1-alpha", "01-spec-one.md"), "utf8");
  const marked = darius(at, ["mark", SPEC, "0", "--in-progress"], dir);
  assert.equal(marked.code, 0, marked.stderr);
  assert.notEqual(readFileSync(join(tree, "M1-alpha", "01-spec-one.md"), "utf8"), before);
  const open = readFileSync(join(at.state, name, "ledger", readdirSync(join(at.state, name, "ledger"))[0] ?? "", "open.jsonl"), "utf8").trim().split("\n");
  const last = JSON.parse(open.at(-1) ?? "{}");
  assert.deepEqual([last.type, last.path], ["tree.put", "M1-alpha/01-spec-one.md"]);
  assert.equal(git(at, dir, ["status", "--porcelain"]), "", "the checkout stays clean");

  const again = darius(at, ["onboard"], dir);
  assert.equal(again.code, 1);
  assert.match(again.stderr, /already onboarded: the store owns the tracker here/u);
  const rescan = darius(at, ["onboard", "scan"], dir);
  assert.equal(rescan.code, 0, rescan.stdout);
  assert.match(rescan.stdout, /^✓ already onboarded: the store owns the tracker here/mu);
  assert.match(rescan.stdout, /^pending tree changes: none$/mu);
  assert.doesNotMatch(rescan.stdout, /nothing to do/u, "one verdict, not two");
  assert.equal(JSON.parse(darius(at, ["onboard", "scan", "--json"], dir).stdout).status, "already-onboarded");
  const dry = darius(at, ["onboard", "--dry-run"], dir);
  assert.equal(dry.code, 0, dry.stdout);
  assert.match(dry.stdout, /already onboarded/u);
  assert.doesNotMatch(dry.stdout, /no store for the project/u);
  assert.equal(JSON.parse(darius(at, ["onboard", "--dry-run", "--json"], dir).stdout).status, "already-onboarded");
});

test("onboard --dry-run writes nothing to the repo or the store", { skip: NO_GIT }, () => {
  const at = host();
  const dir = legacyRepo(at, "acme-dry");
  const repoBefore = treeHash(dir);
  const stateBefore = treeHash(at.state);
  const dry = darius(at, ["onboard", "--dry-run", "--json"], dir);
  assert.equal(dry.code, 0, dry.stdout + dry.stderr);
  const report = JSON.parse(dry.stdout);
  assert.equal(report.copy.length, 8);
  assert.ok(report.copy.includes("M1-alpha/01-spec-one.md"));
  assert.equal(darius(at, ["onboard", "--dry-run"], dir).code, 0);
  assert.equal(darius(at, ["onboard", "scan"], dir).code, 0);
  assert.equal(treeHash(dir), repoBefore);
  assert.equal(treeHash(at.state), stateBefore);
});

test("onboard refuses a dirty .tracker/, an untracked file, a store that already holds the tree, and no marker", { skip: NO_GIT }, () => {
  const at = host();
  const dir = legacyRepo(at, "acme-refuse");
  const unchanged = (): void => {
    assert.equal(lstatSync(join(dir, ".tracker")).isDirectory(), true);
    assert.doesNotMatch(readFileSync(join(dir, ".darius.toml"), "utf8"), /kinds/u);
  };

  writeFileSync(join(dir, SPEC), "edited\n", { flag: "a" });
  const dirty = darius(at, ["onboard"], dir);
  assert.equal(dirty.code, 1);
  assert.match(dirty.stderr, /\.tracker\/ has uncommitted changes: M \.tracker\/M1-alpha\/01-spec-one\.md\. Commit or remove them first\./u);
  unchanged();
  git(at, dir, ["checkout", "--", SPEC]);

  writeFileSync(join(dir, ".tracker", "M1-alpha", "new.md"), "new\n");
  const untracked = darius(at, ["onboard"], dir);
  assert.equal(untracked.code, 1);
  assert.match(untracked.stderr, /\?\? \.tracker\/M1-alpha\/new\.md/u);
  const scan = darius(at, ["onboard", "scan", "--json"], dir);
  assert.equal(scan.code, 1);
  assert.equal(JSON.parse(scan.stdout).git.clean, false);
  rmSync(join(dir, ".tracker", "M1-alpha", "new.md"));

  // Host-local files may be dirty: the hooks write them all the time.
  writeFileSync(join(dir, ".tracker", ".pending-sync"), "src/a.ts\n");
  writeFileSync(join(dir, ".tracker", "00-INDEX.md"), "regenerated\n");
  assert.equal(darius(at, ["onboard", "scan"], dir).code, 0);

  mkdirSync(join(at.state, "acme-refuse", "tracker"), { recursive: true });
  writeFileSync(join(at.state, "acme-refuse", "tracker", "x.md"), "x\n");
  const onboarded = darius(at, ["onboard"], dir);
  assert.equal(onboarded.code, 1);
  assert.match(onboarded.stderr, /already onboarded: pull the marker commit and run darius sync/u);
  unchanged();

  const bare = join(SANDBOX, "no-marker");
  mkdirSync(bare);
  const none = darius(at, ["onboard"], bare);
  assert.equal(none.code, 1);
  assert.match(none.stderr, /no \.darius\.toml in .* or above it/u);
});

test("onboard refuses an unlinked checkout and a marker that is not v3; --only vigil refuses dirty vigils", { skip: NO_GIT }, () => {
  const at = host();
  const dir = legacyRepo(at, "acme-only");
  const other = host();
  const unlinked = darius(other, ["onboard"], dir);
  assert.equal(unlinked.code, 1);
  assert.match(unlinked.stderr, /this checkout is not linked to acme-only on this host: run darius link here/u);

  mkdirSync(join(dir, ".tracker", "vigils"));
  writeFileSync(join(dir, ".tracker", "vigils", "soak.md"), "---\ntype: vigil\nname: soak\n---\n");
  const vigil = darius(at, ["onboard", "--only", "vigil"], dir);
  assert.equal(vigil.code, 1);
  assert.match(vigil.stderr, /\?\? \.tracker\/vigils\/soak\.md/u);
  const usage = darius(at, ["onboard", "--only", "milestone"], dir);
  assert.equal(usage.code, 2);

  writeFileSync(join(dir, ".darius.toml"), 'v = 2\nproject = "acme-only"\n');
  const v2 = darius(at, ["onboard", "scan"], dir);
  assert.equal(v2.code, 1);
  assert.match(v2.stdout, /\.darius\.toml is v = 2; darius onboard needs v = 3/u);
});

test("withKinds sets or inserts the root kinds line and keeps every other byte", () => {
  const file = "/x/.darius.toml";
  const plain = '# head\nv = 3\nproject = "a"\ntz = "UTC"\n\n# rituals\n[rituals.x]\ntitle = "X"\n';
  assert.equal(withKinds(plain, file, ["ritual", "vigil"]), '# head\nv = 3\nproject = "a"\ntz = "UTC"\nkinds = ["ritual", "vigil"]\n\n# rituals\n[rituals.x]\ntitle = "X"\n');
  const set = 'v = 3\nproject = "a"\nkinds = ["ritual", "vigil"]  # phase 3\ntz = "UTC"\n';
  assert.equal(withKinds(set, file, ["ritual", "vigil", "milestone"]), 'v = 3\nproject = "a"\nkinds = ["ritual", "vigil", "milestone"]  # phase 3\ntz = "UTC"\n');
  const crlf = 'v = 3\r\nproject = "a"\r\ntz = "UTC"\r\n';
  assert.equal(withKinds(crlf, file, ["ritual", "vigil", "milestone"]), 'v = 3\r\nproject = "a"\r\ntz = "UTC"\r\nkinds = ["ritual", "vigil", "milestone"]\r\n');
  assert.equal(existsSync(file), false);
});

test("withKinds keeps a root icon line and the marker still reads it (0.70.0)", () => {
  const file = "/x/.darius.toml";
  const text = 'v = 3\nproject = "a"\ntz = "UTC"\nicon = "assets/logo.svg"\n\n[rituals.x]\ntitle = "X"\nskill = "x"\n';
  const edited = withKinds(text, file, ["ritual", "vigil"]);
  assert.equal(edited, 'v = 3\nproject = "a"\ntz = "UTC"\nicon = "assets/logo.svg"\nkinds = ["ritual", "vigil"]\n\n[rituals.x]\ntitle = "X"\nskill = "x"\n');
  assert.deepEqual(decodeMarker(edited, file).icon, { kind: "image", path: "assets/logo.svg" });
});

/** A vigil record without `path` and without the fields the native list adds. */
function legacyFields(records: Record<string, string | boolean | null>[], keys: readonly string[]): Record<string, string | boolean | null>[] {
  return records
    .map((record) => Object.fromEntries(keys.filter((key) => key !== "path").map((key) => [key, record[key] ?? null])))
    .toSorted((a, b) => String(a.slug).localeCompare(String(b.slug)));
}

function storeVigil(at: Host, project: string, slug: string): string {
  return readFileSync(join(at.state, project, "items", "vigils", `${slug}.md`), "utf8");
}

test("onboard imports real vigils: open ones heavy, projected into the store tree, the same legacy list fields, and archive-check still refuses", { skip: NO_GIT }, () => {
  const at = host();
  const name = "acme-vigils";
  const dir = legacyRepo(at, name, { vigils: true });
  const legacyList = darius(at, ["vigil", "list", "--all", "--json"], dir);
  assert.equal(legacyList.code, 0, legacyList.stderr);
  const before: Record<string, string | boolean | null>[] = JSON.parse(legacyList.stdout);
  assert.equal(before.length, 3);
  const keys = Object.keys(before[0] ?? {});
  const refusedBefore = darius(at, ["archive-check", "M1-alpha"], dir);
  assert.equal(refusedBefore.code, 1);
  assert.match(refusedBefore.stderr, /REFUSED.*guard-soak|guard-soak[\s\S]*REFUSED|REFUSED[\s\S]*guard-soak/u);

  const dry = darius(at, ["onboard", "--dry-run", "--json"], dir);
  assert.equal(dry.code, 0, dry.stdout + dry.stderr);
  assert.match(JSON.parse(dry.stdout).vigil_import.summary, /^would import 3, 0 unchanged, 1 closed; open ones come in heavy$/u);
  assert.equal(readdirSync(join(at.state, name, "items", "vigils")).length, 0, "the dry run imports nothing");

  const moved = darius(at, ["onboard"], dir);
  assert.equal(moved.code, 0, moved.stdout + moved.stderr);
  assert.match(moved.stdout, /^✓ 1 vigils: imported 3, 0 unchanged, 1 closed$/mu);
  assert.match(moved.stdout, /^2 open vigils were imported as heavy: the daily sweep skips them\. Allow one with: darius vigil set <slug> --no-heavy$/mu);

  assert.match(storeVigil(at, name, "guard-soak"), /^heavy: true$/mu);
  assert.match(storeVigil(at, name, "cache-check"), /^heavy: true$/mu);
  assert.match(storeVigil(at, name, "old-soak"), /^heavy: false$/mu);
  const staged = git(at, dir, ["diff", "--cached", "--name-status"]);
  for (const slug of Object.keys(VIGILS)) {
    assert.match(staged, new RegExp(`^D\\t\\.tracker/vigils/${slug}\\.md$`, "mu"));
    assert.ok(existsSync(join(at.state, name, "tracker", "vigils", `${slug}.md`)), `${slug} is projected into the store tree`);
  }
  assert.equal(git(at, dir, ["ls-files", ".tracker"]), "", "nothing under .tracker is in the git index");
  assert.equal(existsSync(join(dir, ".tracker")), false, "the checkout holds no .tracker path (0.78.0)");

  const nativeList = darius(at, ["vigil", "list", "--all", "--json"], dir);
  assert.equal(nativeList.code, 0, nativeList.stderr);
  assert.deepEqual(legacyFields(JSON.parse(nativeList.stdout), keys), legacyFields(before, keys));

  const refused = darius(at, ["archive-check", "M1-alpha"], dir);
  assert.equal(refused.code, 1, refused.stdout);
  assert.match(refused.stderr, /guard-soak/u);
  assert.match(refused.stderr, /no Command: line at all/u);
  assert.equal(darius(at, ["archive-check", "M2-beta"], dir).code, 0, "a vigil with a Command does not block");
});

test("onboard --only vigil moves the vigils into the store and leaves the rest of .tracker/ in git", { skip: NO_GIT }, () => {
  const at = host();
  const name = "acme-only-vigil";
  const dir = legacyRepo(at, name, { vigils: true });
  const moved = darius(at, ["onboard", "--only", "vigil"], dir);
  assert.equal(moved.code, 0, moved.stdout + moved.stderr);
  assert.match(moved.stdout, /^✓ 2 \.darius\.toml: kinds = \["ritual", "vigil"\]$/mu);
  assert.match(moved.stdout, /^2 open vigils were imported as heavy/mu);
  assert.match(moved.stdout, /^ {2}git add \.darius\.toml$/mu);
  assert.match(readFileSync(join(dir, ".darius.toml"), "utf8"), /^kinds = \["ritual", "vigil"\]$/mu);
  assert.equal(lstatSync(join(dir, ".tracker")).isDirectory(), true, ".tracker/ stays a folder in git");
  assert.equal(existsSync(join(dir, ".tracker", "vigils")), false);
  const staged = git(at, dir, ["diff", "--cached", "--name-status"]).trim().split("\n");
  assert.deepEqual(staged.toSorted(), Object.keys(VIGILS).map((slug) => `D\t.tracker/vigils/${slug}.md`).toSorted());
  assert.match(storeVigil(at, name, "guard-soak"), /^heavy: true$/mu);
  const list = darius(at, ["vigil", "list", "--all", "--json"], dir);
  assert.equal(list.code, 0, list.stderr);
  assert.deepEqual(JSON.parse(list.stdout).map((record: { slug: string }) => record.slug).toSorted(), ["cache-check", "guard-soak", "old-soak"]);
  const again = darius(at, ["onboard", "--only", "vigil"], dir);
  assert.equal(again.code, 1);
  assert.match(again.stderr, /already onboarded: the store owns the vigils here/u);
  assert.equal(darius(at, ["onboard", "scan", "--only", "vigil"], dir).code, 0, "already onboarded");
});
