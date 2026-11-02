/**
 * The box plan (src/core/box.ts): the bwrap argv and the scrubbed environment
 * for one run, from injected facts. No bwrap runs here; test/box-real.test.ts
 * runs a plan on the real one.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { scanSockets } from "../src/core/box-host.ts";
import { BoxError, boxPlan, DEFAULT_BOX_WRITABLE, envPassProblem, hostPortText, parseHostPort, writableProblem, type BoxEntry, type BoxEnv, type BoxPlanInput, type HostBoxSettings, type RitualBoxKeys, type SocketScan } from "../src/core/box.ts";
import { claudeHarness, claudeProjectDirName } from "../src/harness/claude.ts";

const HOME = "/home/op";
const STORE = `${HOME}/.local/share/darius`;
const CONFIG = `${HOME}/.config/darius`;
const RUNTIME = "/run/user/1000";
const WORK = "/srv/repo";
const RUN_DIR = `${STORE}/acme/runs/r1`;
const AGENT = `${RUNTIME}/gcr/ssh`;
/** Claude Code's projects folder of WORK, and its memory folder. */
const PROJECT = `${HOME}/.claude/projects/-srv-repo`;
const MEMORY = `${PROJECT}/memory`;
/** Claude Code's per-run folders, which the box covers with an empty tmpfs. */
const SCRATCH = ["shell-snapshots", "session-env", "todos", "tasks", "debug", "statsig", "file-history"].map((name) => `${HOME}/.claude/${name}`);

/** A fake filesystem: path to entry. A missing path has no entry. */
type Tree = Map<string, BoxEntry>;

function dir(real: string): BoxEntry {
  return { real, kind: "dir" };
}

function file(real: string): BoxEntry {
  return { real, kind: "file" };
}

/** The tree of a typical host: home, store, config, work dir with git, run dir, Claude, caches. */
function baseTree(): Tree {
  const tree: Tree = new Map();
  for (const path of [HOME, STORE, CONFIG, `${STORE}/acme`, `${STORE}/acme/runs`, RUN_DIR, WORK, `${WORK}/.git`, `${WORK}/.git/hooks`, `${HOME}/.claude`, `${HOME}/.claude/projects`, `${HOME}/.claude/todos`, `${HOME}/.cache`, `${HOME}/.npm`, `${HOME}/.ssh`, RUNTIME, "/run/wrappers"]) {
    tree.set(path, dir(path));
  }
  for (const path of [`${WORK}/.git/config`, `${HOME}/.claude/.credentials.json`, `${HOME}/.claude/settings.json`, `${HOME}/.claude.json`, `${CONFIG}/alerts.json`, `${HOME}/.aws/credentials`, `${HOME}/.config/gh/hosts.yml`, `${HOME}/.npmrc`, `${HOME}/.ssh/id_ed25519`]) {
    tree.set(path, file(path));
  }
  tree.set("/run/current-system", { real: "/nix/store/abc-system", kind: "dir", link: "/nix/store/abc-system" });
  tree.set(AGENT, { real: AGENT, kind: "other" });
  return tree;
}

const RUNNER_ENV: BoxEnv = {
  HOME,
  USER: "op",
  PATH: `/usr/bin:relative/bin::${HOME}/.local/bin:/usr/bin`,
  TERM: "xterm-256color",
  LANG: "en_US.UTF-8",
  LC_TIME: "de_DE.UTF-8",
  TZ: "Europe/Berlin",
  GH_TOKEN: "gh-token-placeholder",
  AWS_ACCESS_KEY_ID: "aws-key-placeholder",
  AWS_SECRET_ACCESS_KEY: "aws-secret-placeholder",
  DBUS_SESSION_BUS_ADDRESS: `unix:path=${RUNTIME}/bus`,
  DARIUS_BWRAP: "/usr/bin/bwrap",
  DARIUS_RUN_SANDBOX: "box",
  DARIUS_STATE_DIR: "/elsewhere/darius",
  SSH_AUTH_SOCK: AGENT,
  ANTHROPIC_API_KEY: "sk-ant-your-key-here",
  ACME_TOKEN: "acme-placeholder",
};

interface Overrides {
  tree?: Tree;
  env?: BoxEnv;
  ritual?: RitualBoxKeys;
  host?: HostBoxSettings;
  envPass?: readonly string[];
  isReport?: boolean;
  hasTty?: boolean;
  workDir?: string;
  runId?: string;
  relayPort?: number;
  sockets?: SocketScan;
}

function input(overrides: Overrides = {}): BoxPlanInput {
  const tree = overrides.tree ?? baseTree();
  return {
    bwrap: "/usr/bin/bwrap",
    command: ["/usr/bin/true"],
    run: { id: overrides.runId ?? "r1", dir: RUN_DIR, policy: `${RUN_DIR}/policy.json`, project: "acme" },
    workDir: overrides.workDir ?? WORK,
    isReport: overrides.isReport ?? false,
    hasTty: overrides.hasTty ?? false,
    relayPort: overrides.relayPort ?? 18_080,
    ritual: overrides.ritual ?? {},
    host: overrides.host ?? { sshAgent: false },
    harness: claudeHarness,
    envPass: overrides.envPass ?? [],
    facts: {
      home: HOME,
      user: "op",
      uid: 1000,
      runtimeDir: RUNTIME,
      store: STORE,
      config: CONFIG,
      app: `${HOME}/.local/opt/darius`,
      env: overrides.env ?? RUNNER_ENV,
      masked: { files: [`${CONFIG}/alerts.json`], dirs: [] },
      secrets: {
        dirs: [CONFIG],
        files: [`${HOME}/.aws/credentials`, `${HOME}/.claude/.credentials.json`, `${HOME}/.config/gh/hosts.yml`],
        sshDir: `${HOME}/.ssh`,
        home: HOME,
      },
      sockets: overrides.sockets ?? { found: [], timedOut: false, capMs: 30_000 },
      entry: (path) => tree.get(path),
    },
  };
}

/** The flags between bwrap and `--`. */
function flags(argv: readonly string[]): string[] {
  return argv.slice(1, argv.indexOf("--"));
}

/** The index of the first `flag a b` triple (or `flag a` pair when `b` is undefined). -1 when absent. */
function at(argv: readonly string[], flag: string, first: string, second?: string): number {
  return argv.findIndex((arg, index) => arg === flag && argv[index + 1] === first && (second === undefined || argv[index + 2] === second));
}

function has(argv: readonly string[], flag: string, first: string, second?: string): boolean {
  return at(argv, flag, first, second) !== -1;
}

// --- order and namespaces ------------------------------------------------------------

test("the base layout comes first, in order: root, dev, proc, tmp, run, the NixOS re-binds, the runtime dir, the box dir", () => {
  const { argv, boxDir } = boxPlan(input());
  assert.equal(argv[0], "/usr/bin/bwrap");
  assert.equal(boxDir, `${RUNTIME}/darius-box/r1`);
  assert.deepEqual(flags(argv).slice(0, 30), [
    "--ro-bind", "/", "/", "--dev", "/dev", "--proc", "/proc", "--tmpfs", "/tmp", "--tmpfs", "/run",
    "--symlink", "/nix/store/abc-system", "/run/current-system",
    "--ro-bind", "/run/wrappers", "/run/wrappers",
    "--tmpfs", "/var/tmp", "--dir", "/var/tmp/cache", "--dir", "/var/tmp/npm",
    "--perms", "0700", "--tmpfs", RUNTIME,
    "--ro-bind", boxDir, "/run/darius",
  ]);
  assert.equal(has(argv, "--ro-bind", "/run/opengl-driver"), false, "a missing NixOS path is not bound");
  assert.equal(has(argv, "--ro-bind", "/run/booted-system"), false);
});

test("namespaces: net, pid, die with parent, and a new session unless the surface needs a tty", () => {
  const plain = flags(boxPlan(input()).argv);
  for (const flag of ["--unshare-net", "--unshare-pid", "--die-with-parent", "--new-session", "--clearenv"]) assert.ok(plain.includes(flag), flag);
  const tty = flags(boxPlan(input({ hasTty: true })).argv);
  assert.ok(tty.includes("--unshare-net"));
  assert.equal(tty.includes("--new-session"), false);
});

test("the command follows -- unchanged", () => {
  const plan = boxPlan({ ...input(), command: ["/opt/darius", "box", "enter", "--", "claude", "-p", "hi there"] });
  assert.deepEqual(plan.argv.slice(plan.argv.indexOf("--") + 1), ["/opt/darius", "box", "enter", "--", "claude", "-p", "hi there"]);
});

// --- work dir and run dir --------------------------------------------------------------

test("the work dir is bound writable, read-only in report mode, with .git, .claude and .darius.toml read-only on themselves", () => {
  const tree = baseTree();
  tree.set(`${WORK}/.claude`, dir(`${WORK}/.claude`));
  tree.set(`${WORK}/.darius.toml`, file(`${WORK}/.darius.toml`));
  const act = boxPlan(input({ tree })).argv;
  assert.ok(has(act, "--bind", WORK, WORK));
  for (const guard of [`${WORK}/.git`, `${WORK}/.claude`, `${WORK}/.darius.toml`]) {
    assert.ok(at(act, "--ro-bind", guard, guard) > at(act, "--bind", WORK, WORK), `${guard} comes after the work dir`);
  }
  // .git is one mount point: no separate binds inside it, so nothing in it is writable and it cannot be renamed.
  assert.equal(has(act, "--ro-bind", `${WORK}/.git/config`), false);
  assert.equal(has(act, "--ro-bind", `${WORK}/.git/hooks`), false);
  assert.equal(act.some((arg) => arg.startsWith(`${WORK}/.git/`)), false, "nothing under .git is bound on its own");
  const report = boxPlan(input({ tree, isReport: true })).argv;
  assert.ok(has(report, "--ro-bind", WORK, WORK));
  assert.equal(has(report, "--bind", WORK, WORK), false);
  assert.ok(has(report, "--ro-bind", `${WORK}/.git`, `${WORK}/.git`));
});

test("a linked worktree's .git file is bound read-only on itself", () => {
  const tree = baseTree();
  for (const path of [...tree.keys()].filter((key) => key.startsWith(`${WORK}/.git`))) tree.delete(path);
  tree.set(`${WORK}/.git`, file(`${WORK}/.git`));
  const { argv } = boxPlan(input({ tree }));
  assert.ok(at(argv, "--ro-bind", `${WORK}/.git`, `${WORK}/.git`) > at(argv, "--bind", WORK, WORK));
});

test("a missing .claude gets an empty read-only folder from the box dir; in report mode it gets none", () => {
  const plan = boxPlan(input());
  const empty = `${plan.boxDir}/empty`;
  assert.ok(at(plan.argv, "--ro-bind", empty, `${WORK}/.claude`) > at(plan.argv, "--bind", WORK, WORK));
  assert.ok(plan.creates.some((create) => create.path === empty && create.kind === "dir" && create.mode === 0o500), "the launcher makes the empty folder");
  assert.equal(has(plan.argv, "--ro-bind", `${WORK}/.darius.toml`), false, "a missing marker is left out");
  const report = boxPlan(input({ isReport: true }));
  assert.equal(has(report.argv, "--ro-bind", `${report.boxDir}/empty`), false, "a read-only work dir needs no mount point");
  assert.equal(report.creates.some((create) => create.path.endsWith("/empty")), false);
});

test("a .git, .claude or .darius.toml that is a link is refused: the run could swap the link", () => {
  for (const name of [".git", ".claude", ".darius.toml"]) {
    const tree = baseTree();
    tree.set(`${WORK}/${name}`, { real: `/srv/shared/${name}`, kind: name === ".darius.toml" ? "file" : "dir", link: `/srv/shared/${name}` });
    assert.throws(() => boxPlan(input({ tree })), (cause: Error) => cause instanceof BoxError && cause.message.startsWith(`${WORK}/${name} is a link`), name);
  }
});


test("the run dir is read-only; only gate.jsonl and scratch/ are writable, and the plan says to make them", () => {
  const plan = boxPlan(input());
  const ro = at(plan.argv, "--ro-bind", RUN_DIR, RUN_DIR);
  assert.ok(ro !== -1);
  assert.ok(at(plan.argv, "--bind", `${RUN_DIR}/gate.jsonl`, `${RUN_DIR}/gate.jsonl`) > ro);
  assert.ok(at(plan.argv, "--bind", `${RUN_DIR}/scratch`, `${RUN_DIR}/scratch`) > ro);
  assert.equal(has(plan.argv, "--bind", `${RUN_DIR}/policy.json`), false);
  assert.deepEqual(plan.creates[0], { path: plan.boxDir, kind: "dir", mode: 0o700 }, "the box dir first");
  assert.deepEqual(plan.creates.filter((create) => create.path.startsWith(RUN_DIR)), [
    { path: `${RUN_DIR}/gate.jsonl`, kind: "file", mode: 0o600 },
    { path: `${RUN_DIR}/scratch`, kind: "dir", mode: 0o700 },
  ]);
});

test("a gate.jsonl or scratch that is a link, or the wrong type, is refused", () => {
  const linked = baseTree();
  linked.set(`${RUN_DIR}/gate.jsonl`, { real: `${HOME}/.bashrc`, kind: "file", link: `${HOME}/.bashrc` });
  assert.throws(() => boxPlan(input({ tree: linked })), /gate\.jsonl must be a plain file/u);
  const wrong = baseTree();
  wrong.set(`${RUN_DIR}/scratch`, file(`${RUN_DIR}/scratch`));
  assert.throws(() => boxPlan(input({ tree: wrong })), /scratch must be a plain folder/u);
  const existing = baseTree();
  existing.set(`${RUN_DIR}/gate.jsonl`, file(`${RUN_DIR}/gate.jsonl`));
  assert.equal(boxPlan(input({ tree: existing })).creates.some((create) => create.path.endsWith("gate.jsonl")), false, "a plain file there is kept");
});

test("a run dir outside the store, or no folder, is refused", () => {
  const tree = baseTree();
  tree.set("/srv/run", dir("/srv/run"));
  assert.throws(() => boxPlan({ ...input({ tree }), run: { id: "r1", dir: "/srv/run", policy: "/srv/run/policy.json", project: "acme" } }), /not in the store/u);
  const missing = baseTree();
  missing.delete(RUN_DIR);
  assert.throws(() => boxPlan(input({ tree: missing })), /the run dir .* is not a folder/u);
});

test("the work dir is refused when it is the root, home, holds the store, or is in a protected path; in the store it is read-only", () => {
  const tree = baseTree();
  tree.set("/", dir("/"));
  tree.set(`${HOME}/.config`, dir(`${HOME}/.config`));
  tree.set(`${HOME}/.ssh/work`, dir(`${HOME}/.ssh/work`));
  tree.set("/run/user/1000/w", dir("/run/user/1000/w"));
  assert.throws(() => boxPlan(input({ tree, workDir: "/" })), BoxError);
  assert.throws(() => boxPlan(input({ tree, workDir: HOME })), /the work dir \/home\/op is refused: it holds/u);
  assert.throws(() => boxPlan(input({ tree, workDir: `${HOME}/.config` })), /it holds/u);
  assert.throws(() => boxPlan(input({ tree, workDir: `${HOME}/.ssh/work` })), /is in \/home\/op\/\.ssh/u);
  assert.throws(() => boxPlan(input({ tree, workDir: "/run/user/1000/w" })), /is in \/run/u);
  assert.throws(() => boxPlan(input({ tree, workDir: "/srv/nothing" })), /is not a folder/u);
  const inStore = boxPlan(input({ tree, workDir: `${STORE}/acme` })).argv;
  assert.ok(has(inStore, "--ro-bind", `${STORE}/acme`, `${STORE}/acme`), "a project with no repo gets its store dir read-only");
  assert.equal(has(inStore, "--bind", `${STORE}/acme`, `${STORE}/acme`), false);
});

test("the store and the config dir are bound read-only, so a tmpfs cannot leave them writable", () => {
  const { argv } = boxPlan(input());
  assert.ok(has(argv, "--ro-bind", STORE, STORE));
  assert.ok(has(argv, "--ro-bind", CONFIG, CONFIG));
});

// --- the harness ------------------------------------------------------------------------

test("~/.claude is read-only; the login, the history and this work dir's projects folder persist; ~/.claude.json is a per-run copy", () => {
  const tree = baseTree();
  tree.set(`${HOME}/.claude/history.jsonl`, file(`${HOME}/.claude/history.jsonl`));
  const plan = boxPlan(input({ tree }));
  const { argv } = plan;
  const ro = at(argv, "--ro-bind", `${HOME}/.claude`, `${HOME}/.claude`);
  assert.ok(ro !== -1);
  for (const path of [`${HOME}/.claude/.credentials.json`, `${HOME}/.claude/history.jsonl`, PROJECT]) assert.ok(at(argv, "--bind", path, path) > ro, path);
  assert.equal(has(argv, "--bind", `${HOME}/.claude/projects`, `${HOME}/.claude/projects`), false, "other work dirs' sessions and memory stay read-only");
  assert.equal(has(argv, "--bind", `${HOME}/.claude/settings.json`), false);
  assert.equal(has(argv, "--bind", `${HOME}/.claude`, `${HOME}/.claude`), false);
  const copy = `${plan.boxDir}/copies/0-.claude.json`;
  assert.deepEqual(plan.copies, [{ from: `${HOME}/.claude.json`, to: copy }]);
  assert.ok(has(argv, "--bind", copy, `${HOME}/.claude.json`));
  assert.equal(has(boxPlan(input()).argv, "--bind", `${HOME}/.claude/history.jsonl`), false, "a missing file is not bound");
});

test("the projects folder of this work dir is made when missing, with its memory folder read-only over it", () => {
  const plan = boxPlan(input());
  assert.ok(at(plan.argv, "--ro-bind", MEMORY, MEMORY) > at(plan.argv, "--bind", PROJECT, PROJECT), "memory comes after the writable projects folder");
  assert.deepEqual(plan.creates.filter((create) => create.path.startsWith(`${HOME}/.claude/projects`)), [
    { path: PROJECT, kind: "dir", mode: 0o700 },
    { path: MEMORY, kind: "dir", mode: 0o700 },
  ]);
  // No projects folder at all: it is made first, then the work dir's, then memory.
  const bare = baseTree();
  bare.delete(`${HOME}/.claude/projects`);
  const fresh = boxPlan(input({ tree: bare }));
  assert.deepEqual(fresh.creates.filter((create) => create.path.startsWith(`${HOME}/.claude/projects`)).map((create) => create.path), [`${HOME}/.claude/projects`, PROJECT, MEMORY]);
  // Both there: nothing to make, the same binds.
  const ready = baseTree();
  ready.set(PROJECT, dir(PROJECT));
  ready.set(MEMORY, dir(MEMORY));
  const kept = boxPlan(input({ tree: ready }));
  assert.equal(kept.creates.some((create) => create.path.startsWith(PROJECT)), false);
  assert.ok(has(kept.argv, "--ro-bind", MEMORY, MEMORY));
  // A memory folder that is a link could be swapped in the writable projects folder.
  const linked = baseTree();
  linked.set(PROJECT, dir(PROJECT));
  linked.set(MEMORY, { real: "/srv/memory", kind: "dir", link: "/srv/memory" });
  assert.throws(() => boxPlan(input({ tree: linked })), /the harness path .*memory is a link/u);
});

test("Claude Code's per-run folders are an empty tmpfs over the real ones, made when missing, never bound", () => {
  const plan = boxPlan(input());
  const ro = at(plan.argv, "--ro-bind", `${HOME}/.claude`, `${HOME}/.claude`);
  for (const path of SCRATCH) {
    assert.ok(at(plan.argv, "--tmpfs", path) > ro, path);
    assert.equal(has(plan.argv, "--bind", path, path), false, path);
  }
  const made = plan.creates.filter((create) => SCRATCH.includes(create.path)).map((create) => create.path);
  assert.deepEqual(made, SCRATCH.filter((path) => !path.endsWith("/todos")), "todos is there already; the others are made");
});

test("claudeProjectDirName: every character but a letter or digit is a dash; a name over 200 characters is refused", () => {
  assert.equal(claudeProjectDirName("/srv/repo"), "-srv-repo");
  assert.equal(claudeProjectDirName("/home/op/my.repo/.claude/worktrees/a_b"), "-home-op-my-repo--claude-worktrees-a-b");
  assert.throws(() => claudeProjectDirName(`/srv/${"a".repeat(200)}`), BoxError);
});

test("a harness path that links out of ~/.claude is held to the writable rules", () => {
  const tree = baseTree();
  tree.set(`${HOME}/.claude/projects`, { real: `${HOME}/.ssh`, kind: "dir", link: `${HOME}/.ssh` });
  assert.throws(() => boxPlan(input({ tree })), /the harness path .*projects\/-srv-repo is refused: it resolves to \/home\/op\/\.ssh\/-srv-repo/u);
  const fine = baseTree();
  fine.set(`${HOME}/.claude/projects`, { real: "/srv/claude-projects", kind: "dir", link: "/srv/claude-projects" });
  const plan = boxPlan(input({ tree: fine }));
  assert.ok(has(plan.argv, "--bind", "/srv/claude-projects/-srv-repo", "/srv/claude-projects/-srv-repo"));
  assert.ok(plan.creates.some((create) => create.path === "/srv/claude-projects/-srv-repo"));
  const scratch = baseTree();
  scratch.set(`${HOME}/.claude/todos`, { real: "/tmp/todos", kind: "dir", link: "/tmp/todos" });
  assert.throws(() => boxPlan(input({ tree: scratch })), /the harness path .*todos is refused: it resolves to \/tmp\/todos, and it is in \/tmp/u);
});

// --- writable extras -----------------------------------------------------------------------

test("the default [box] writable is empty: no shared cache is bound; [box] writable names some; the ritual's writable adds", () => {
  assert.deepEqual(DEFAULT_BOX_WRITABLE, []);
  const plain = boxPlan(input()).argv;
  assert.equal(has(plain, "--bind", `${HOME}/.cache`), false);
  assert.equal(has(plain, "--bind", `${HOME}/.npm`), false);
  const tree = baseTree();
  tree.set(`${HOME}/build`, dir(`${HOME}/build`));
  tree.set("/srv/out", dir("/srv/out"));
  tree.set(`${HOME}/.cache/pnpm`, dir(`${HOME}/.cache/pnpm`));
  const custom = boxPlan(input({ tree, host: { writable: ["~/build", "~/.cache/pnpm"], sshAgent: false }, ritual: { writable: ["/srv/out", "~/missing"] } })).argv;
  assert.ok(has(custom, "--bind", `${HOME}/build`, `${HOME}/build`));
  assert.ok(has(custom, "--bind", `${HOME}/.cache/pnpm`, `${HOME}/.cache/pnpm`), "a folder in ~/.cache, named by the operator");
  assert.ok(has(custom, "--bind", "/srv/out", "/srv/out"));
  assert.equal(has(custom, "--bind", `${HOME}/missing`), false);
});

test("~/.cache itself and every path in, or holding, a PATH entry of the runner is refused, as written and through a link", () => {
  const tree = baseTree();
  tree.set(`${HOME}/bin-link`, { real: "/opt/tools/bin", kind: "dir", link: "/opt/tools/bin" });
  tree.set("/opt/tools", dir("/opt/tools"));
  tree.set(`${HOME}/pnpm-link`, { real: `${HOME}/.local/share/pnpm/store`, kind: "dir", link: ".local/share/pnpm/store" });
  const env = { ...RUNNER_ENV, PATH: `/usr/bin:${HOME}/.local/share/pnpm:${HOME}/.bun/bin:${HOME}/bin-link:relative` };
  const refused: [string, RegExp][] = [
    ["~/.cache", /it is the cache folder/u],
    ["~/.local/share/pnpm", /is in \/home\/op\/\.local\/share\/pnpm, a PATH entry/u],
    ["~/.local/share/pnpm/global", /is in \/home\/op\/\.local\/share\/pnpm, a PATH entry/u],
    ["~/.bun", /holds \/home\/op\/\.bun\/bin, a PATH entry/u],
    ["/usr", /holds \/usr\/bin, a PATH entry/u],
    ["/opt/tools", /holds \/opt\/tools\/bin, a PATH entry/u],
    ["~/pnpm-link", /resolves to .*\.local\/share\/pnpm\/store, and it is in .*pnpm, a PATH entry/u],
  ];
  for (const [path, why] of refused) {
    assert.throws(() => boxPlan(input({ tree, env, ritual: { writable: [path] } })), (cause: Error) => cause instanceof BoxError && cause.message.startsWith(`the ritual's writable "${path}" is refused`) && why.test(cause.message), path);
    assert.throws(() => boxPlan(input({ tree, env, host: { writable: [path], sshAgent: false } })), (cause: Error) => cause.message.startsWith(`[box] writable "${path}" is refused`) && why.test(cause.message), path);
  }
  const dirs = { home: HOME, store: STORE, config: CONFIG, app: "/opt/darius" };
  assert.match(writableProblem("~/.cache", dirs) ?? "", /it is the cache folder/u, "~/.cache is refused at load too");
  assert.equal(writableProblem("~/.cache/pnpm", dirs), undefined);
  assert.match(writableProblem("~/.local/share/pnpm", { ...dirs, pathEntries: [`${HOME}/.local/share/pnpm`, "relative/bin"] }) ?? "", /a PATH entry/u);
  assert.equal(writableProblem("~/.local/share/pnpm", dirs), undefined, "a load check without PATH entries skips that rule; the plan has them");
});

test("writable extras come before the work dir, so an extra that holds it cannot undo report mode", () => {
  const tree = baseTree();
  tree.set("/srv", dir("/srv"));
  const { argv } = boxPlan(input({ tree, ritual: { writable: ["/srv"] }, isReport: true }));
  assert.ok(at(argv, "--bind", "/srv", "/srv") < at(argv, "--ro-bind", WORK, WORK));
  assert.ok(at(argv, "--bind", "/srv", "/srv") < at(argv, "--ro-bind", `${WORK}/.git`, `${WORK}/.git`));
});

test("every protected writable path is refused, as written and through a link, with its source named", () => {
  const refused: [string, RegExp][] = [
    ["~/.local/share/darius/acme", /is in \/home\/op\/\.local\/share\/darius/u],
    ["~/.config/darius", /is in \/home\/op\/\.config\/darius/u],
    ["~/.claude/projects", /is in \/home\/op\/\.claude/u],
    ["~/.claude.json", /is in \/home\/op\/\.claude\.json/u],
    ["~/.ssh", /is in \/home\/op\/\.ssh/u],
    ["~/.config/systemd/user", /is in \/home\/op\/\.config\/systemd/u],
    ["~/.config/autostart", /is in \/home\/op\/\.config\/autostart/u],
    ["~/.bashrc", /is in \/home\/op\/\.bashrc/u],
    ["~/.zshrc", /\.zshrc/u],
    ["~/.profile", /\.profile/u],
    ["~/.local/bin", /\.local\/bin/u],
    ["~/.local/opt/darius", /\.local\/opt\/darius/u],
    ["~/.gitconfig", /\.gitconfig/u],
    ["~", /holds/u],
    ["~/.config", /holds \/home\/op\/\.config\//u],
    ["~/.local", /holds/u],
    ["/", /the root/u],
    ["/home", /holds/u],
    ["/run/user/1000/x", /is in \/run/u],
    ["/tmp/cache", /is in \/tmp/u],
    ["/proc/self", /is in \/proc/u],
    ["/dev/shm", /is in \/dev/u],
    ["cache", /must start with ~\/ or \//u],
    ["~/.cache/../.ssh", /must not contain \.\./u],
  ];
  for (const [path, why] of refused) {
    assert.throws(() => boxPlan(input({ ritual: { writable: [path] } })), (cause: Error) => cause instanceof BoxError && cause.message.includes(`the ritual's writable "${path}" is refused`) && why.test(cause.message), path);
    assert.throws(() => boxPlan(input({ host: { writable: [path], sshAgent: false } })), (cause: Error) => cause.message.startsWith(`[box] writable "${path}" is refused`), path);
  }
  const tree = baseTree();
  tree.set(`${HOME}/keys-link`, { real: `${HOME}/.ssh`, kind: "dir", link: ".ssh" });
  tree.set(`${HOME}/store-link`, { real: `${STORE}/acme`, kind: "dir", link: `${STORE}/acme` });
  assert.throws(() => boxPlan(input({ tree, ritual: { writable: ["~/keys-link"] } })), /"~\/keys-link" is refused: it resolves to \/home\/op\/\.ssh, and it is in \/home\/op\/\.ssh/u);
  assert.throws(() => boxPlan(input({ tree, ritual: { writable: ["~/store-link"] } })), /resolves to .*darius\/acme/u);
});

test("a store, config dir and runtime dir elsewhere are protected too", () => {
  const problem = writableProblem("/data/darius/acme", { home: HOME, store: "/data/darius", config: "/etc/op/darius", app: "/opt/darius", runtimeDir: "/var/run-op" });
  assert.match(problem ?? "", /is in \/data\/darius/u);
  assert.match(writableProblem("/etc/op", { home: HOME, store: STORE, config: "/etc/op/darius", app: "/opt/darius" }) ?? "", /holds \/etc\/op\/darius/u);
  assert.match(writableProblem("/var/run-op/x", { home: HOME, store: STORE, config: CONFIG, app: "/opt/darius", runtimeDir: "/var/run-op" }) ?? "", /is in \/var\/run-op/u);
  assert.equal(writableProblem("~/.cache/pnpm", { home: HOME, store: STORE, config: CONFIG, app: "/opt/darius" }), undefined);
});

// --- masks -------------------------------------------------------------------------------

test("masked: the mask list, the gate's secrets minus ~/.ssh and the harness login, and ~/.npmrc; files behind /dev/null, last", () => {
  const { argv } = boxPlan(input());
  for (const path of [`${CONFIG}/alerts.json`, `${HOME}/.aws/credentials`, `${HOME}/.config/gh/hosts.yml`, `${HOME}/.npmrc`]) {
    assert.ok(has(argv, "--ro-bind", "/dev/null", path), path);
  }
  assert.equal(has(argv, "--ro-bind", "/dev/null", `${HOME}/.claude/.credentials.json`), false, "the harness login stays");
  assert.equal(has(argv, "--ro-bind", "/dev/null", `${HOME}/.ssh/id_ed25519`), false, "ssh keys stay");
  assert.equal(has(argv, "--tmpfs", CONFIG), false, "the active config dir keeps config.toml and links.toml");
  const firstMask = at(argv, "--ro-bind", "/dev/null");
  const binds = argv.flatMap((arg, index) => (arg === "--bind" ? [index] : []));
  assert.ok(Math.max(...binds) < firstMask, "no bind comes after a mask");
});

test("tools = [\"gh\"] leaves ~/.config/gh/hosts.yml visible", () => {
  const { argv } = boxPlan(input({ ritual: { tools: ["gh"] } }));
  assert.equal(has(argv, "--ro-bind", "/dev/null", `${HOME}/.config/gh/hosts.yml`), false);
  assert.ok(has(argv, "--ro-bind", "/dev/null", `${HOME}/.aws/credentials`));
  assert.throws(() => boxPlan(input({ ritual: { tools: ["aws"] } })), /tools names "aws"/u);
});

test("a symlinked secret is masked at its real path; a secret dir is a tmpfs; another darius config dir is a tmpfs", () => {
  const tree = baseTree();
  tree.set(`${HOME}/.aws/credentials`, { real: "/srv/dotfiles/aws-credentials", kind: "file", link: "/srv/dotfiles/aws-credentials" });
  tree.set(`${CONFIG}/keys`, dir(`${CONFIG}/keys`));
  tree.set("/srv/other-darius-config", dir("/srv/other-darius-config"));
  const base = input({ tree });
  const plan = boxPlan({
    ...base,
    facts: { ...base.facts, masked: { files: [], dirs: [`${CONFIG}/keys`] }, secrets: { ...base.facts.secrets, dirs: [CONFIG, "/srv/other-darius-config"] } },
  });
  assert.ok(has(plan.argv, "--ro-bind", "/dev/null", "/srv/dotfiles/aws-credentials"));
  assert.equal(has(plan.argv, "--ro-bind", "/dev/null", `${HOME}/.aws/credentials`), false, "bwrap cannot mount on a symlink");
  assert.ok(has(plan.argv, "--tmpfs", `${CONFIG}/keys`));
  assert.ok(has(plan.argv, "--tmpfs", "/srv/other-darius-config"));
});

// --- ssh agent ------------------------------------------------------------------------------

test("the agent socket is bound only with SSH_AUTH_SOCK and a reach entry or ssh_agent; otherwise it is masked", () => {
  const none = boxPlan(input());
  assert.equal(none.agent, false);
  assert.equal(has(none.argv, "--bind", AGENT, AGENT), false);
  assert.equal(none.env.SSH_AUTH_SOCK, undefined);
  assert.ok(has(none.argv, "--ro-bind", "/dev/null", AGENT), "a socket on a read-only mount still connects, so it is masked");
  for (const overrides of [{ ritual: { reach: ["git.example.com:22"] } }, { ritual: { sshAgent: true } }, { host: { sshAgent: true } }] satisfies Overrides[]) {
    const plan = boxPlan(input(overrides));
    assert.equal(plan.agent, true, JSON.stringify(overrides));
    assert.ok(at(plan.argv, "--bind", AGENT, AGENT) > at(plan.argv, "--tmpfs", RUNTIME), "after the runtime dir tmpfs");
    assert.equal(plan.env.SSH_AUTH_SOCK, AGENT);
    assert.equal(has(plan.argv, "--ro-bind", "/dev/null", AGENT), false);
  }
  const { SSH_AUTH_SOCK: _sock, ...withoutAgent } = RUNNER_ENV;
  void _sock;
  const unset = boxPlan(input({ env: withoutAgent, ritual: { sshAgent: true } }));
  assert.equal(unset.agent, false);
  assert.equal(unset.env.SSH_AUTH_SOCK, undefined);
});

// --- environment ------------------------------------------------------------------------------

test("the env is a fixed list: nothing else of the runner's env reaches the box", () => {
  const plan = boxPlan(input({ ritual: { reach: ["git.example.com:22"] } }));
  const proxy = "http://127.0.0.1:18080";
  assert.deepEqual(plan.env, {
    HOME,
    USER: "op",
    LOGNAME: "op",
    PATH: `/run/darius/bin:/usr/bin:${HOME}/.local/bin`,
    TERM: "xterm-256color",
    LANG: "en_US.UTF-8",
    TZ: "Europe/Berlin",
    LC_TIME: "de_DE.UTF-8",
    XDG_RUNTIME_DIR: RUNTIME,
    SSH_AUTH_SOCK: AGENT,
    DARIUS_RUN: "r1",
    DARIUS_RUN_POLICY: `${RUN_DIR}/policy.json`,
    DARIUS_PROJECT: "acme",
    DARIUS_STATE_DIR: STORE,
    DARIUS_CONFIG_DIR: CONFIG,
    HTTPS_PROXY: proxy,
    https_proxy: proxy,
    HTTP_PROXY: proxy,
    http_proxy: proxy,
    ALL_PROXY: proxy,
    all_proxy: proxy,
    NO_PROXY: "",
    no_proxy: "",
    NODE_USE_ENV_PROXY: "1",
    XDG_CACHE_HOME: "/var/tmp/cache",
    npm_config_cache: "/var/tmp/npm",
    ANTHROPIC_API_KEY: "sk-ant-your-key-here",
  });
  for (const name of ["GH_TOKEN", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "DBUS_SESSION_BUS_ADDRESS", "DARIUS_BWRAP", "DARIUS_RUN_SANDBOX", "ACME_TOKEN"]) {
    assert.equal(plan.env[name], undefined, name);
    assert.equal(plan.argv.includes(name), false, `${name} is not in the argv`);
  }
});

test("--clearenv comes before every --setenv, and each --setenv is one env entry", () => {
  const { argv, env } = boxPlan(input());
  const clear = argv.indexOf("--clearenv");
  const sets = argv.flatMap((arg, index) => (arg === "--setenv" ? [index] : []));
  assert.ok(sets.length > 0 && sets.every((index) => index > clear));
  assert.deepEqual(Object.fromEntries(sets.map((index) => [argv[index + 1], argv[index + 2]])), env);
});

test("env_pass passes named variables when set; a name the box sets itself is refused", () => {
  const plan = boxPlan(input({ envPass: ["ACME_TOKEN", "NOT_SET"] }));
  assert.equal(plan.env.ACME_TOKEN, "acme-placeholder");
  assert.equal("NOT_SET" in plan.env, false);
  for (const name of ["PATH", "HOME", "SSH_AUTH_SOCK", "DARIUS_RUN", "DARIUS_STATE_DIR", "HTTPS_PROXY", "https_proxy", "NODE_USE_ENV_PROXY", "LC_ALL", "XDG_RUNTIME_DIR", "XDG_CACHE_HOME", "npm_config_cache", "NPM_CONFIG_CACHE"]) {
    assert.throws(() => boxPlan(input({ envPass: [name] })), /env_pass names .* is set by the box itself/u, name);
    assert.match(envPassProblem(name) ?? "", /set by the box itself/u, name);
  }
  assert.match(envPassProblem("A-B") ?? "", /not an environment variable name/u);
  assert.equal(envPassProblem("ACME_TOKEN"), undefined);
});

// --- input checks ------------------------------------------------------------------------------

test("a bad run id, relay port, command or runtime dir is refused", () => {
  assert.throws(() => boxPlan(input({ runId: "../x" })), /run id/u);
  assert.throws(() => boxPlan(input({ relayPort: 0 })), /relay port/u);
  assert.throws(() => boxPlan(input({ relayPort: 70_000 })), /relay port/u);
  assert.throws(() => boxPlan({ ...input(), command: [] }), /needs a command/u);
  const base = input();
  assert.throws(() => boxPlan({ ...base, facts: { ...base.facts, runtimeDir: "" } }), /XDG_RUNTIME_DIR/u);
});

// --- reach entries ------------------------------------------------------------------------------

test("parseHostPort: names, dotted IPv4 and bracketed IPv6, lower-cased; everything else refused", () => {
  assert.deepEqual(parseHostPort("Git.Example.com:22"), { host: "git.example.com", port: 22 });
  assert.deepEqual(parseHostPort("192.0.2.10:443"), { host: "192.0.2.10", port: 443 });
  assert.deepEqual(parseHostPort("[2001:db8::1]:443"), { host: "2001:db8::1", port: 443 });
  assert.equal(hostPortText(parseHostPort("[2001:DB8::1]:443")), "[2001:db8::1]:443");
  for (const bad of ["git.example.com", "git.example.com:", "git.example.com:0", "git.example.com:65536", "git.example.com:022", "git.example.com.:22", "*.example.com:22", "2001:db8::1:443", "[not-v6]:443", "localhost:22", "a.localhost:22", "127.0.0.1:22", "0.0.0.0:80", "[::1]:22", "[::ffff:127.0.0.1]:22", "0x7f000001:22", "127.1:22", "1.2.3:22", "010.0.0.1:22", "host_name:22", ":22", "a b:22"]) {
    assert.throws(() => parseHostPort(bad), /is not host:port/u, bad);
  }
});

// --- sockets and hidden folders ------------------------------------------------------------

test("the hidden home folders that exist are a tmpfs, after the writable extras and before the work dir; /var/tmp is a tmpfs", () => {
  const tree = baseTree();
  for (const name of [".config/herdr", ".local/state", ".cache/com.bitwarden.desktop", ".local/share/containers"]) tree.set(`${HOME}/${name}`, dir(`${HOME}/${name}`));
  tree.set("/srv/out", dir("/srv/out"));
  const { argv } = boxPlan(input({ tree, host: { writable: ["/srv/out"], sshAgent: false } }));
  for (const name of [".config/herdr", ".local/state", ".cache/com.bitwarden.desktop", ".local/share/containers"]) {
    const index = at(argv, "--tmpfs", `${HOME}/${name}`);
    assert.ok(index !== -1, name);
    assert.ok(index > at(argv, "--bind", "/srv/out", "/srv/out"), `${name} comes after the writable binds`);
    assert.ok(index < at(argv, "--bind", WORK, WORK), `${name} comes before the work dir`);
  }
  assert.equal(has(argv, "--tmpfs", `${HOME}/.mozilla`), false, "a missing folder is left out");
  assert.ok(has(argv, "--tmpfs", "/var/tmp"));
});

test("a writable path or a work dir in a hidden folder is refused; one that holds a hidden folder may be writable", () => {
  const tree = baseTree();
  tree.set(`${HOME}/.local/state`, dir(`${HOME}/.local/state`));
  tree.set(`${HOME}/.local/state/app`, dir(`${HOME}/.local/state/app`));
  tree.set(`${HOME}/state-link`, { real: `${HOME}/.local/state/app`, kind: "dir", link: ".local/state/app" });
  for (const path of ["~/.local/state/app", "~/.var/app/x", "~/.config/herdr", "~/.mozilla/firefox", "/var/tmp/cache"]) {
    assert.throws(() => boxPlan(input({ tree, ritual: { writable: [path] } })), /is refused: it is in/u, path);
  }
  assert.throws(() => boxPlan(input({ tree, ritual: { writable: ["~/state-link"] } })), /resolves to .*\.local\/state\/app, and it is in .*\.local\/state, which the box hides/u);
  assert.throws(() => boxPlan(input({ tree, workDir: `${HOME}/.local/state/app` })), /the work dir .* is refused: it is in .*\.local\/state, which the box hides/u);
  assert.match(writableProblem("~/.local/state/x", { home: HOME, store: STORE, config: CONFIG, app: "/opt/darius" }) ?? "", /which the box hides/u);
  assert.throws(() => boxPlan(input({ tree, host: { writable: ["~/.cache"], sshAgent: false } })), /it is the cache folder/u, "~/.cache, which holds a hidden folder, is refused itself");
});

test("every scanned socket is masked behind /dev/null, last; the bound agent is the one exception", () => {
  const tree = baseTree();
  const sockets = [`${HOME}/.config/someapp/app.sock`, `${HOME}/.ssh/agent/s.1`, AGENT];
  for (const path of sockets) tree.set(path, { real: path, kind: "other" });
  const scan: SocketScan = { found: sockets, timedOut: false, capMs: 30_000 };
  const unbound = boxPlan(input({ tree, sockets: scan }));
  for (const path of sockets) assert.ok(has(unbound.argv, "--ro-bind", "/dev/null", path), path);
  assert.deepEqual(unbound.warnings, []);
  const bound = boxPlan(input({ tree, sockets: scan, ritual: { sshAgent: true } }));
  assert.ok(has(bound.argv, "--bind", AGENT, AGENT));
  assert.equal(has(bound.argv, "--ro-bind", "/dev/null", AGENT), false, "the bound agent stays reachable");
  assert.ok(has(bound.argv, "--ro-bind", "/dev/null", `${HOME}/.ssh/agent/s.1`), "another agent socket under ~/.ssh is masked");
  const lastBind = Math.max(...bound.argv.flatMap((arg, index) => (arg === "--bind" ? [index] : [])));
  assert.ok(at(bound.argv, "--ro-bind", "/dev/null", `${HOME}/.config/someapp/app.sock`) > lastBind);
});

test("a socket scan that hit its cap: the plan goes on with the hidden folders and carries a warning for run.log", () => {
  const plan = boxPlan(input({ sockets: { found: [], timedOut: true, capMs: 30_000 } }));
  assert.equal(plan.warnings.length, 1);
  assert.match(plan.warnings[0] ?? "", /^box: the socket scan of \/home\/op stopped after 30 s/u);
  assert.ok(has(plan.argv, "--tmpfs", "/var/tmp"));
});

test("scanSockets: finds sockets without following links, skips pruned folders, node_modules and .git, and stops at its cap", async () => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "darius-box-scan-")));
  const servers: Server[] = [];
  try {
    const home = join(base, "h");
    for (const sub of ["a/b", "node_modules/x", ".git/y", ".local/state/z", "work/w", "outside"]) mkdirSync(join(home, sub), { recursive: true });
    mkdirSync(join(base, "elsewhere"));
    const want = [join(home, "a", "b", "one.sock"), join(home, "top.sock")];
    for (const path of [...want, join(home, "node_modules", "x", "n.sock"), join(home, ".git", "y", "g.sock"), join(home, ".local", "state", "z", "s.sock"), join(home, "work", "w", "w.sock"), join(base, "elsewhere", "e.sock")]) {
      servers.push(await listenOn(path));
    }
    symlinkSync(join(base, "elsewhere"), join(home, "link"));
    const scan = scanSockets({ home, prune: [join(home, ".local", "state"), join(home, "work")], capMs: 30_000 });
    assert.deepEqual([...scan.found].toSorted(), want.toSorted());
    assert.equal(scan.timedOut, false);
    let clock = 0;
    const late = scanSockets({ home, prune: [], capMs: 5, now: () => (clock += 10) });
    assert.equal(late.timedOut, true);
  } finally {
    for (const server of servers) server.close();
    rmSync(base, { recursive: true, force: true });
  }
});

function listenOn(path: string): Promise<Server> {
  return new Promise((done, fail) => {
    const server = createServer();
    server.on("error", fail);
    server.listen(path, () => done(server));
  });
}
