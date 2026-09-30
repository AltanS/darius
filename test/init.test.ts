/**
 * `darius init` (src/cli/init.ts): a fresh repo, a legacy `.tracker/` repo, a
 * re-run, the refusals, and the done check of the plan: from nothing to
 * `darius next` and `darius run now --dry-run` with the printed lines alone.
 *
 * Every run points HOME, CLAUDE_CONFIG_DIR, DARIUS_STATE_DIR and
 * DARIUS_CONFIG_DIR at a throwaway dir. A repo is a dir with an empty `.git`
 * dir: init finds the root by it, and the test needs no git binary.
 */

import { after, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

import { projectNameFrom } from "../src/cli/init.ts";

const BIN = join(import.meta.dirname, "..", "bin", "darius");
const FIXTURE = join(import.meta.dirname, "fixtures", "tracker-mini");
const SANDBOX = mkdtempSync(join(tmpdir(), "darius-init-"));
after(() => rmSync(SANDBOX, { recursive: true, force: true }));

interface CliResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

interface Host {
  home: string;
  env: NodeJS.ProcessEnv;
}

let hosts = 0;

/** A fake `claude` that only answers --version, so `run now --dry-run` does not need Claude Code installed. */
const FAKE_BIN = join(SANDBOX, "bin");
mkdirSync(FAKE_BIN);
writeFileSync(join(FAKE_BIN, "claude"), `#!${process.execPath}\nconsole.log("2.1.286 (Claude Code)");\n`, { mode: 0o755 });

/** A fresh host: its own HOME, store, config and Claude dir. */
function host(): Host {
  hosts += 1;
  const home = join(SANDBOX, `host-${String(hosts)}`);
  mkdirSync(home, { recursive: true });
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: home,
    CLAUDE_CONFIG_DIR: join(home, ".claude"),
    DARIUS_STATE_DIR: join(home, ".local", "share", "darius"),
    DARIUS_CONFIG_DIR: join(home, ".config", "darius"),
    DARIUS_WHO: "dev@example.com",
    PATH: `${FAKE_BIN}:${process.env.PATH ?? ""}`,
    NO_COLOR: "1",
  };
  delete env.DARIUS_PROJECT;
  return { home, env };
}

function darius(at: Host, argv: string[], cwd: string, runtime = "node"): CliResult {
  const result = spawnSync(BIN, argv, { cwd, env: { ...at.env, DARIUS_RUNTIME: runtime }, encoding: "utf8", input: "", timeout: 30_000 });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** A repo dir under the host's home, with an empty `.git` dir. */
function repo(at: Host, name: string): string {
  const dir = join(at.home, "projects", name);
  mkdirSync(join(dir, ".git"), { recursive: true });
  return dir;
}

/** Every file under `dir`: relative path, mode and bytes, in one sha256. */
function treeHash(dir: string): string {
  const hash = createHash("sha256");
  const walk = (at: string): void => {
    for (const name of readdirSync(at).toSorted()) {
      const path = join(at, name);
      const stat = statSync(path);
      hash.update(`${relative(dir, path)}\0${String(stat.mode)}\0`);
      if (stat.isDirectory()) walk(path);
      else hash.update(readFileSync(path));
    }
  };
  walk(dir);
  return hash.digest("hex");
}

/** Splits one printed command line into argv: spaces separate, double quotes group. */
function argvOf(line: string): string[] {
  const words = [...line.matchAll(/"([^"]*)"|(\S+)/gu)].map((match) => match[1] ?? match[2] ?? "");
  assert.equal(words[0], "darius", line);
  return words.slice(1);
}

test("the done check: from nothing to darius next and run now --dry-run with the printed lines alone", () => {
  for (const runtime of ["node", "bun"]) {
    const at = host();
    const dir = repo(at, "my-app");
    mkdirSync(join(dir, "src"));
    const init = darius(at, ["init"], join(dir, "src"), runtime);
    assert.equal(init.code, 0, init.stderr);
    const commands = init.stdout
      .split("\n")
      .filter((line) => line.startsWith("  darius "))
      .map((line) => line.trim());
    assert.deepEqual(
      commands.map((line) => argvOf(line).slice(0, 2).join(" ")),
      ["add milestone", "add spec", "next", "ritual add", "run now"],
      init.stdout,
    );
    let last: CliResult | undefined;
    for (const line of commands) {
      last = darius(at, argvOf(line), dir, runtime);
      assert.equal(last.code, 0, `${line}: ${last.stderr}`);
      if (line === "darius next") assert.match(last.stdout, /^\[ \] /u, "next names the first open task");
    }
    assert.match(last?.stdout ?? "", /weekly-review: due, would start/u);
  }
});

test("a fresh repo: marker, link, .tracker/ and the commit line; the root is the git root", () => {
  const at = host();
  const dir = repo(at, "fresh");
  mkdirSync(join(dir, "deep", "er"), { recursive: true });
  const result = darius(at, ["init"], join(dir, "deep", "er"));
  assert.equal(result.code, 0, result.stderr);
  const lines = result.stdout.split("\n");
  assert.deepEqual(lines.slice(0, 4), [
    '✓ wrote .darius.toml: project = "fresh"',
    `✓ linked fresh to ${dir} on this host`,
    "✓ created .tracker/00-INDEX.md",
    'Commit .darius.toml and .tracker: git add .darius.toml .tracker && git commit -m "darius init"',
  ]);
  assert.match(readFileSync(join(dir, ".darius.toml"), "utf8"), /^v = 2\nproject = "fresh"\n$/mu);
  assert.ok(existsSync(join(dir, ".tracker", "00-INDEX.md")));
  const links = readFileSync(join(at.env.DARIUS_CONFIG_DIR ?? "", "links.toml"), "utf8");
  assert.match(links, new RegExp(`fresh = "${dir}"`, "u"));

  const again = darius(at, ["init", "--json"], dir, "bun");
  assert.equal(again.code, 0, again.stderr);
  const json = JSON.parse(again.stdout);
  assert.deepEqual([json.marker, json.link, json.tracker, json.import], ["present", "unchanged", "present", null]);
  assert.match(darius(at, ["init"], dir).stdout, /^· already linked: fresh at /u);
});

test("a legacy repo: init imports rituals, runs and evidence, writes the marker, links, and leaves .tracker/ unchanged", () => {
  const at = host();
  const dir = repo(at, "legacy-app");
  cpSync(FIXTURE, join(dir, ".tracker"), { recursive: true });
  const before = treeHash(join(dir, ".tracker"));

  const refused = darius(at, ["ritual", "list"], dir);
  assert.equal(refused.code, 1);
  assert.match(refused.stderr, /this repo is not linked: run darius init/u);

  const result = darius(at, ["init"], dir);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /^✓ imported 4 rituals, \d+ runs and \d+ evidence lines from \.tracker\/ into the darius store/mu);
  assert.match(result.stdout, /^Commit \.darius\.toml: git add \.darius\.toml && git commit/mu);
  assert.doesNotMatch(result.stdout, /created \.tracker/u);
  assert.equal(treeHash(join(dir, ".tracker")), before);
  assert.match(darius(at, ["ritual", "list"], dir).stdout, /weekly-check/u);

  const again = darius(at, ["init"], dir);
  assert.equal(again.code, 0, again.stderr);
  assert.match(again.stdout, /^· already linked: legacy-app/u);
  assert.doesNotMatch(again.stdout, /imported/u);
});

test("init refuses a second import when the store holds the project's rituals; --no-import links without it", () => {
  const at = host();
  const dir = repo(at, "moved");
  cpSync(FIXTURE, join(dir, ".tracker"), { recursive: true });
  assert.equal(darius(at, ["init"], dir).code, 0);
  rmSync(join(dir, ".darius.toml"));
  const links = join(at.env.DARIUS_CONFIG_DIR ?? "", "links.toml");
  rmSync(links);

  const refused = darius(at, ["init"], dir);
  assert.equal(refused.code, 1);
  assert.match(refused.stderr, /already holds 4 rituals for project moved, so init will not import again/u);
  assert.match(refused.stderr, /darius init --no-import/u);
  assert.match(refused.stderr, /darius init --project <name>/u);
  assert.ok(!existsSync(join(dir, ".darius.toml")), "a refusal writes nothing");

  const linked = darius(at, ["init", "--no-import", "--json"], dir);
  assert.equal(linked.code, 0, linked.stderr);
  const json = JSON.parse(linked.stdout);
  assert.equal(json.import, null);
  assert.equal(json.marker, "written");
});

test("init refuses a name linked to another checkout, a --project the marker contradicts, and the home dir", () => {
  const at = host();
  const first = repo(at, "one");
  assert.equal(darius(at, ["init", "--project", "shared"], first).code, 0);
  const second = repo(at, "two");
  const clash = darius(at, ["init", "--project", "shared"], second);
  assert.equal(clash.code, 1);
  assert.match(clash.stderr, /project shared is already linked to .*one on this host\. Pick another name: darius init --project <name>/u);
  assert.ok(!existsSync(join(second, ".darius.toml")));

  const wrong = darius(at, ["init", "--project", "other"], first);
  assert.equal(wrong.code, 2);
  assert.match(wrong.stderr, /\.darius\.toml says project = "shared", but --project names "other"/u);

  const home = darius(at, ["init"], at.home);
  assert.equal(home.code, 1);
  assert.match(home.stderr, /is not a repo\. cd into the repo, then run darius init there/u);
  assert.ok(!existsSync(join(at.home, ".darius.toml")));

  const bad = darius(at, ["init", "--project", "_global"], second);
  assert.equal(bad.code, 2);
  assert.match(bad.stderr, /cannot be a project name/u);
});

test("a committed marker on a new host: init links it, makes a missing .tracker/, and never imports", () => {
  const lead = host();
  const dir = repo(lead, "cloned");
  cpSync(FIXTURE, join(dir, ".tracker"), { recursive: true });
  writeFileSync(join(dir, ".darius.toml"), 'v = 2\nproject = "cloned"\n');

  const second = host();
  const result = darius(second, ["init"], dir);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /^✓ linked cloned to /mu);
  assert.match(result.stdout, /^! \.tracker\/rituals\/ has 4 rituals, and this host's store has none for cloned\. If sync is set up: darius sync\. If no host ever imported them: darius import \.tracker$/mu);
  assert.equal(darius(second, ["ritual", "list", "--json"], dir).stdout.includes("weekly-check"), false, "no import");

  rmSync(join(dir, ".tracker"), { recursive: true });
  const bare = darius(host(), ["init"], dir);
  assert.equal(bare.code, 0, bare.stderr);
  assert.match(bare.stdout, /^✓ created \.tracker\/00-INDEX\.md$/mu);
  assert.match(bare.stdout, /^Commit \.tracker: git add \.tracker && git commit/mu);
});

test("a tracker verb that fails with no .tracker/ names darius init", () => {
  const at = host();
  const dir = repo(at, "empty");
  const result = darius(at, ["next"], dir);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /no \.tracker\/ here or above\. Run darius init in the repo root to create one\./u);
});

test("projectNameFrom keeps a valid dir name and turns other runs of characters into '-'", () => {
  assert.equal(projectNameFrom("/x/acme-web"), "acme-web");
  assert.equal(projectNameFrom("/x/My App!"), "My-App");
  assert.equal(projectNameFrom("/x/.hidden"), "hidden");
  assert.equal(projectNameFrom("/x/___"), "");
});
