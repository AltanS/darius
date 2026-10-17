/**
 * Spec path forms in store mode, verb by verb (evals B1). The docs (concept.md, decision 22)
 * say a verb takes a spec as tracker-relative (`M1-alpha/01-spec-one.md`), as the old
 * `.tracker/M1-alpha/01-spec-one.md`, or as the absolute store path. A bare file name
 * (`01-spec-one.md`) is not a documented form, so it is not tested.
 *
 * A pair that fails today is marked `todo` ("path resolver, B2"): the suite stays green, and
 * node:test reports the fix as a passing todo. Every test uses its own temp dirs and its own
 * state and config dirs; nothing touches the real store.
 */

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { commitAll, initRepo, NO_GIT } from "./helpers/git.ts";

const SANDBOX = mkdtempSync(join(tmpdir(), "darius-path-forms-"));
after(() => rmSync(SANDBOX, { recursive: true, force: true }));

const BIN = join(import.meta.dirname, "..", "bin", "darius");
const SPEC = "M1-alpha/01-spec-one.md";
const SESSION = "path-forms";

/** Pairs that fail today, as `verb|form`. */
const FAILS_TODAY = new Set<string>([]);
const TODO = "path resolver, B2";

interface Run {
  code: number | null;
  stdout: string;
  stderr: string;
}

interface Repo {
  dir: string;
  home: string;
  tree: string;
}

function env(home: string): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: home,
    CLAUDE_CONFIG_DIR: join(home, ".claude"),
    DARIUS_STATE_DIR: join(home, "state"),
    DARIUS_CONFIG_DIR: join(home, "config"),
    DARIUS_WHO: "dev@example.com",
    DARIUS_RUNTIME: "node",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
  };
  for (const name of ["DARIUS_PROJECT", "DARIUS_TRACKER_ROOT", "DARIUS_CHECKOUT_ROOT", "CLAUDE_CODE_SESSION_ID", "CLAUDE_SESSION_ID"]) delete out[name];
  return out;
}

function darius(repo: { home: string; dir: string }, argv: string[]): Run {
  const r = spawnSync(BIN, argv, { cwd: repo.dir, env: env(repo.home), encoding: "utf8", timeout: 60_000 });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

/** A store-mode repo with milestone alpha and one spec whose one task passes when `out.txt` exists. */
function makeRepo(name: string): Repo {
  const home = join(SANDBOX, name);
  mkdirSync(join(home, "config"), { recursive: true });
  const dir = join(home, "repo");
  mkdirSync(dir, { recursive: true });
  initRepo(dir);
  writeFileSync(join(dir, "README.md"), "# repo\n");
  const repo = { home, dir, tree: join(home, "state", name, "tracker") };
  const run = (argv: string[]): void => {
    const r = darius(repo, argv);
    assert.equal(r.code, 0, `darius ${argv.join(" ")}: ${r.stdout}${r.stderr}`);
  };
  run(["init", "--project", name]);
  commitAll(dir, "darius init");
  run(["add", "milestone", "--name", "Alpha", "--slug", "alpha", "--owner", "dev@example.com"]);
  run(["add", "spec", "--milestone", "alpha", "--name", "Spec one", "--template", "generic"]);
  writeFileSync(
    join(repo.tree, SPEC),
    [
      "---",
      "updated: 2026-10-08",
      "depends_on: []",
      "agent: unassigned",
      "template: generic",
      "---",
      "",
      "# Spec one",
      "",
      "## Goal",
      "",
      "Create `out.txt`.",
      "",
      "## Ground Truth",
      "",
      "The repo has README.md only.",
      "",
      "## Verification Checklist",
      "",
      "- [ ] Create `out.txt`",
      "  - Command: `test -f out.txt`",
      "  - Expected: `exit 0`",
      "",
    ].join("\n"),
  );
  run(["index", "--rebuild"]);
  writeFileSync(join(dir, "out.txt"), "hello\n");
  return repo;
}

/** The verbs, each as the argv for a spec written in one form. Each must exit 0. */
const VERBS: { name: string; argv: (spec: string) => string[] }[] = [
  { name: "show", argv: (spec) => ["show", spec, "--json"] },
  { name: "spec check", argv: (spec) => ["spec", "check", spec, "--json"] },
  { name: "claim", argv: (spec) => ["claim", spec, "--session", SESSION] },
  { name: "worklog open --spec", argv: (spec) => ["worklog", "open", "alpha", "--spec", spec, "--message", "start", "--stage", "planned", "--session", SESSION] },
  { name: "mark", argv: (spec) => ["mark", spec, "0", "--in-progress"] },
  { name: "verify-item", argv: (spec) => ["verify-item", spec, "0"] },
];

const FORMS: { name: string; slug: string; spec: (tree: string) => string }[] = [
  { name: "tracker-relative", slug: "rel", spec: () => SPEC },
  { name: ".tracker/", slug: "dot", spec: () => `.tracker/${SPEC}` },
  { name: "absolute store path", slug: "abs", spec: (tree) => join(tree, SPEC) },
];

for (const form of FORMS) {
  describe(`store mode: a spec as ${form.name}`, { skip: NO_GIT }, () => {
    let repo: Repo;
    before(() => {
      repo = makeRepo(`pf-${form.slug}`);
    });
    for (const verb of VERBS) {
      const todo = FAILS_TODAY.has(`${verb.name}|${form.name}`) ? TODO : false;
      test(`${verb.name} accepts it`, { todo }, () => {
        const r = darius(repo, verb.argv(form.spec(repo.tree)));
        assert.equal(r.code, 0, `${r.stdout}${r.stderr}`);
      });
    }
  });
}
