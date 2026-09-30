/**
 * The app install and its updates: src/core/app.ts (layout, tags, lock,
 * prune, install kinds), src/cli/update.ts (`darius update`, `--check`,
 * `--hosts`) and scripts/install.sh (a fresh install, adopting a legacy clone,
 * piped over a fake ssh).
 *
 * HOME SAFETY: nothing here reaches GitHub, the network, the real
 * `~/.local`, the real systemd, the real store or the tailnet. Every release
 * comes from a local source repo in a temp dir, cloned over `file://`. Its
 * `bin/darius` is a bash stand-in that logs its argv and refuses to run with
 * a HOME outside this file's temp dirs. `systemctl` is an injected recorder
 * for `runUpdate`, and a fake first on PATH for install.sh. ssh is a fake
 * that maps a host to a temp home. HOME itself points at a temp dir for the
 * whole file, and git reads no global or system config.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, symlinkSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  currentTag,
  flipCurrent,
  installKind,
  newestTag,
  pruneChoice,
  stageVersion,
  tagsFromLsRemote,
  takeUpdateLock,
  toTag,
  versionDir,
} from "../src/core/app.ts";
import {
  hostLine,
  parseProbe,
  pushExitCode,
  runPush,
  runUpdate,
  updateLines,
  webHealthUrl,
  type HostReport,
  type UpdateDeps,
  type UpdateRequest,
} from "../src/cli/update.ts";

const PREFIX = "darius-update-test-";
const REPO = fileURLToPath(new URL("../", import.meta.url));
const INSTALL_SH = join(REPO, "scripts", "install.sh");

function tempDir(label: string): string {
  return mkdtempSync(join(tmpdir(), `${PREFIX}${label}-`));
}

// No test may touch the operator's home or git config.
process.env.HOME = tempDir("home");
process.env.GIT_CONFIG_GLOBAL = "/dev/null";
process.env.GIT_CONFIG_NOSYSTEM = "1";
delete process.env.DARIUS_SOURCE;

/** bash by full path. The Nix build sandbox has no /usr/bin/env for a shebang to use. */
const BASH =
  (process.env.PATH ?? "")
    .split(":")
    .map((dir) => join(dir, "bash"))
    .find((candidate) => candidate.startsWith("/") && existsSync(candidate)) ?? "/bin/bash";

function git(cwd: string, args: readonly string[]): string {
  const ran = spawnSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", "-c", "tag.gpgsign=false", ...args], {
    cwd,
    encoding: "utf8",
  });
  assert.equal(ran.status, 0, `git ${args.join(" ")}: ${ran.stderr}`);
  return ran.stdout;
}

// --- fakes ---------------------------------------------------------------------

/** A stand-in for darius at one version: it logs argv, answers --version, setup and update. */
function fakeDarius(version: string): string {
  return `#!${BASH}
# The update tests' stand-in for darius ${version}.
set -eu
version="${version}"
if [ -n "\${FAKE_DARIUS_LOG:-}" ]; then printf '%s %s\\n' "$version" "$*" >> "$FAKE_DARIUS_LOG"; fi
case "$HOME" in *${PREFIX}*) ;; *) echo "fake darius: refusing to run with HOME=$HOME" >&2; exit 97 ;; esac
case "\${1:-}" in
  --version) echo "darius $version (node)" ;;
  setup)
    if [ "\${FAKE_SETUP_FAILS:-}" = "$version" ]; then echo "! systemd  it broke"; exit 1; fi
    app="\${DARIUS_APP_DIR:-$HOME/.local/opt/darius}"
    mkdir -p "$HOME/.local/bin"
    ln -sfn "$app/current/bin/darius" "$HOME/.local/bin/darius"
    echo "✓ cli  linked" ;;
  update)
    to="\${2#v}"
    if [ "$to" = "$version" ]; then outcome=up-to-date; else outcome=updated; fi
    echo "a login script says hello"
    printf '{"ok":true,"outcome":"%s","from":"%s","to":"%s","detail":"","pruned":[]}\\n' "$outcome" "$version" "$to" ;;
  skill) exit "\${FAKE_SKILL_STATUS:-1}" ;;
  *) echo "fake darius $version: $*" ;;
esac
`;
}

interface Release {
  tag: string;
  /** The version package.json carries; the tag's own version unless a test wants a liar. */
  packageVersion?: string;
}

/** A local source repo and the `file://` URL a clone reads it through. */
interface Source {
  dir: string;
  url: string;
}

/** A source repo with one annotated tag per release, each a tree with bin/darius, package.json and scripts/install.sh. */
function makeSource(releases: readonly Release[]): Source {
  const dir = tempDir("source");
  git(dir, ["init", "-q", "-b", "main"]);
  for (const release of releases) addRelease(dir, release);
  return { dir, url: `file://${dir}` };
}

function addRelease(dir: string, release: Release): void {
  const version = release.tag.slice(1);
  mkdirSync(join(dir, "bin"), { recursive: true });
  mkdirSync(join(dir, "scripts"), { recursive: true });
  writeFileSync(join(dir, "bin", "darius"), fakeDarius(version));
  chmodSync(join(dir, "bin", "darius"), 0o755);
  writeFileSync(join(dir, "package.json"), `${JSON.stringify({ name: "darius", version: release.packageVersion ?? version }, null, 2)}\n`);
  copyFileSync(INSTALL_SH, join(dir, "scripts", "install.sh"));
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "-m", `release ${release.tag}`]);
  git(dir, ["tag", "-a", release.tag, "-m", `darius ${version}`]);
}

const MINORS: readonly Release[] = [{ tag: "v0.1.0" }, { tag: "v0.1.1" }, { tag: "v0.2.0" }];

/** A fake `systemctl --user` and the calls it saw. */
interface Recorder {
  calls: string[][];
  run: (args: string[]) => void;
}

/** A recorder for `systemctl --user`; `webEnabled` decides what `is-enabled` answers. */
function recorder(webEnabled = true): Recorder {
  const calls: string[][] = [];
  return {
    calls,
    run: (args) => {
      calls.push(args);
      if (args[0] === "is-enabled" && !webEnabled) throw new Error("disabled");
    },
  };
}

/** A dir of fake programs, and the log they write. */
interface FakeBin {
  dir: string;
  log: string;
}

/** A fake dir first on PATH: a `systemctl` that logs, so install.sh never reaches the real one. */
function fakeBin(): FakeBin {
  const dir = tempDir("bin");
  const log = join(dir, "systemctl.log");
  writeFileSync(join(dir, "systemctl"), `#!${BASH}\nprintf '%s\\n' "$*" >> "${log}"\n`);
  chmodSync(join(dir, "systemctl"), 0o755);
  return { dir, log };
}

/** PATH for a subprocess: the fake bin first, then this PATH without any dir that holds a real darius. */
function sandboxPath(bin: string): string {
  const rest = (process.env.PATH ?? "").split(":").filter((dir) => dir.startsWith("/") && !existsSync(join(dir, "darius")));
  return [bin, ...rest].join(":");
}

interface Host {
  app: string;
  home: string;
  log: string;
  systemctl: Recorder;
  health: string[];
  source: Source;
}

/** A host with an app install at `installed`, staged and flipped through src/core/app.ts. */
function host(releases: readonly Release[], installed: string, webEnabled = true): Host {
  const source = makeSource(releases);
  const home = tempDir("host");
  const app = join(home, ".local", "opt", "darius");
  const staged = stageVersion(app, installed, source.url);
  assert.equal(staged.ok, true);
  flipCurrent(app, installed);
  const log = join(home, "darius.log");
  process.env.FAKE_DARIUS_LOG = log;
  return { app, home, log, systemctl: recorder(webEnabled), health: [], source };
}

function deps(h: Host, healthy = true, overrides: Partial<UpdateDeps> = {}): UpdateDeps {
  const running = currentTag(h.app) ?? "v0.0.0";
  return {
    root: versionDir(h.app, running),
    app: h.app,
    home: h.home,
    systemctl: h.systemctl.run,
    health: async (url) => {
      h.health.push(url);
      return healthy;
    },
    healthTimeoutMs: 50,
    now: () => new Date("2026-09-29T12:00:00Z"),
    ssh: join(h.home, "no-ssh"),
    ...overrides,
  };
}

function request(fields: Partial<UpdateRequest> = {}): UpdateRequest {
  return { target: undefined, check: false, major: false, source: undefined, ...fields };
}

function logLines(h: Host): string[] {
  return existsSync(h.log) ? readFileSync(h.log, "utf8").trim().split("\n") : [];
}

function updateRecord(app: string): { from: string; to: string; at: string; outcome: string; detail: string } {
  return JSON.parse(readFileSync(join(app, "update.json"), "utf8"));
}

// --- tags and versions -------------------------------------------------------------

test("tags: ls-remote output parses to plain release tags in SemVer order, newest last", () => {
  const listed = [
    "aaa\trefs/tags/v0.10.0",
    "bbb\trefs/tags/v0.9.1",
    "ccc\trefs/tags/v1.0.0-rc.1",
    "ddd\trefs/tags/latest",
    "eee\trefs/tags/v0.2.0",
    "",
  ].join("\n");
  assert.deepEqual(tagsFromLsRemote(listed), ["v0.2.0", "v0.9.1", "v0.10.0"]);
  assert.equal(newestTag(["v0.2.0", "v0.10.0", "v0.9.1"]), "v0.10.0");
  assert.equal(toTag("0.17.0"), "v0.17.0");
  assert.equal(toTag("v0.17.0"), "v0.17.0");
  assert.equal(toTag("latest"), null);
});

test("install kinds: a version dir is app, the Nix store is nix, anything else a checkout", () => {
  const app = "/home/me/.local/opt/darius";
  assert.deepEqual(installKind(`${app}/versions/v0.17.0`, app), { kind: "app", tag: "v0.17.0" });
  assert.deepEqual(installKind(`${app}/versions/v0.17.0/`, `${app}/`), { kind: "app", tag: "v0.17.0" });
  assert.deepEqual(installKind("/nix/store/abc-darius/share/darius", app), { kind: "nix" });
  assert.deepEqual(installKind("/home/me/projects/darius", app), { kind: "checkout" });
  assert.deepEqual(installKind(app, app), { kind: "checkout" }, "the old full clone at the app root is a checkout");
  assert.deepEqual(installKind(`${app}/versions/v0.17.0.tmp`, app), { kind: "checkout" });
  assert.deepEqual(installKind(`${app}/versions/v0.17.0/sub`, app), { kind: "checkout" });
});

test("runUpdate refuses from a checkout, naming install.sh, and from the Nix store, naming nixos-rebuild", async () => {
  const h = host(MINORS, "v0.1.0");
  const checkout = tempDir("checkout");
  const fromCheckout = await runUpdate(request(), deps(h, true, { root: checkout }));
  assert.equal(fromCheckout.code, 1);
  assert.equal(fromCheckout.report.outcome, "refused");
  assert.match(fromCheckout.report.detail, /checkout/);
  assert.ok(fromCheckout.report.detail.includes(join(checkout, "scripts", "install.sh")));

  const fromNix = await runUpdate(request(), deps(h, true, { root: "/nix/store/00000000000000000000000000000000-darius/share/darius" }));
  assert.equal(fromNix.code, 1);
  assert.match(fromNix.report.detail, /nixos-rebuild switch/);
  assert.equal(currentTag(h.app), "v0.1.0");
});

// --- darius update -------------------------------------------------------------------

test("update takes the newest release: stage, preflight, flip, the new setup, a web restart, health, a record", async () => {
  const h = host(MINORS, "v0.1.0");
  const done = await runUpdate(request(), deps(h));
  assert.equal(done.code, 0, done.report.detail);
  assert.equal(done.report.outcome, "updated");
  assert.equal(done.report.from, "0.1.0");
  assert.equal(done.report.to, "0.2.0");
  assert.deepEqual(updateLines(done.report), ["✓ updated 0.1.0 -> 0.2.0"]);

  assert.equal(readlinkSync(join(h.app, "current")), join("versions", "v0.2.0"));
  assert.equal(readlinkSync(join(h.home, ".local", "bin", "darius")), join(h.app, "current", "bin", "darius"));
  // preflight of the staged dir, then its setup, then the health check through ~/.local/bin/darius.
  assert.deepEqual(logLines(h), ["0.2.0 --version", "0.2.0 setup --systemd --keep-stopped", "0.2.0 --version"]);
  assert.deepEqual(h.systemctl.calls, [["is-enabled", "--quiet", "darius-web.service"], ["restart", "darius-web.service"]]);
  assert.deepEqual(h.health, ["http://127.0.0.1:4747/healthz"]);
  assert.deepEqual(updateRecord(h.app), { from: "0.1.0", to: "0.2.0", at: "2026-09-29T12:00:00.000Z", outcome: "updated", detail: "" });
  assert.equal(existsSync(join(h.app, "update.lock")), false, "the lock is released");
  // The clone's origin is the source: a later update needs no --source.
  assert.equal(git(versionDir(h.app, "v0.2.0"), ["remote", "get-url", "origin"]).trim(), h.source.url);
});

test("update keeps a stopped timer stopped and restarts an active one, one line per timer it left stopped (0.42.3)", async () => {
  const h = host(MINORS, "v0.1.0");
  const unitDir = join(h.home, ".config", "systemd", "user");
  mkdirSync(unitDir, { recursive: true });
  for (const unit of ["darius-sync.timer", "darius-vigil-sweep.timer", "darius-run-due.timer"]) writeFileSync(join(unitDir, unit), "# fake\n");
  const stopped = new Set(["darius-vigil-sweep.timer", "darius-run-due.timer"]);
  const calls: string[][] = [];
  const systemctl = (args: string[]): void => {
    calls.push(args);
    if (args[0] === "is-active" && stopped.has(args[2] ?? "")) throw new Error("inactive");
  };
  const done = await runUpdate(request(), deps(h, true, { systemctl }));
  assert.equal(done.code, 0, done.report.detail);
  assert.deepEqual(done.report.leftStopped, ["darius-vigil-sweep.timer", "darius-run-due.timer"]);
  assert.deepEqual(updateLines(done.report), [
    "✓ updated 0.1.0 -> 0.2.0",
    "· left stopped: darius-vigil-sweep.timer",
    "· left stopped: darius-run-due.timer",
  ]);
  assert.deepEqual(
    calls.filter((call) => call[0] === "stop" || call[0] === "restart"),
    [
      ["stop", "darius-vigil-sweep.timer"],
      ["stop", "darius-run-due.timer"],
      ["restart", "darius-sync.timer"],
      ["restart", "darius-web.service"],
    ],
  );
  assert.equal(calls.some((call) => call[0] === "enable" || call[0] === "start"), false);
});

test("update without the web unit checks only the version, and restarts nothing", async () => {
  const h = host(MINORS, "v0.1.0", false);
  const done = await runUpdate(request(), deps(h));
  assert.equal(done.code, 0, done.report.detail);
  assert.deepEqual(h.systemctl.calls, [["is-enabled", "--quiet", "darius-web.service"]]);
  assert.deepEqual(h.health, []);
});

test("--check prints current and newest and changes nothing", async () => {
  const h = host(MINORS, "v0.1.0");
  const checked = await runUpdate(request({ check: true }), deps(h));
  assert.equal(checked.code, 0);
  assert.equal(checked.report.outcome, "available");
  assert.equal(checked.report.from, "0.1.0");
  assert.equal(checked.report.to, "0.2.0");
  assert.deepEqual(updateLines(checked.report).slice(0, 2), ["current  0.1.0", "newest   0.2.0"]);
  assert.equal(currentTag(h.app), "v0.1.0");
  assert.deepEqual(readdirSync(join(h.app, "versions")), ["v0.1.0"]);
  assert.equal(existsSync(join(h.app, "update.json")), false);
  assert.deepEqual(logLines(h), []);
});

test("an up-to-date host says so, exits 0, and runs nothing", async () => {
  const h = host(MINORS, "v0.2.0");
  const same = await runUpdate(request(), deps(h));
  assert.equal(same.code, 0);
  assert.equal(same.report.outcome, "up-to-date");
  assert.deepEqual(updateLines(same.report), ["· up to date (0.2.0)"]);
  const checked = await runUpdate(request({ check: true }), deps(h));
  assert.equal(checked.report.outcome, "up-to-date");
  assert.deepEqual(logLines(h), []);
  assert.deepEqual(h.systemctl.calls, []);
});

test("a newer MAJOR is refused without --major, names the CHANGELOG and the newest minor, and --major takes it", async () => {
  const h = host([...MINORS, { tag: "v1.0.0" }], "v0.1.0");
  const refused = await runUpdate(request(), deps(h));
  assert.equal(refused.code, 1);
  assert.equal(refused.report.outcome, "refused");
  assert.match(refused.report.detail, /CHANGELOG\.md/);
  assert.match(refused.report.detail, /darius update v1\.0\.0 --major/);
  assert.match(refused.report.detail, /darius update v0\.2\.0/);
  assert.equal(currentTag(h.app), "v0.1.0");
  assert.equal(existsSync(versionDir(h.app, "v1.0.0")), false);

  const explicit = await runUpdate(request({ target: "v1.0.0" }), deps(h));
  assert.equal(explicit.code, 1, "an explicit major still needs --major");

  const checked = await runUpdate(request({ check: true }), deps(h));
  assert.equal(checked.code, 0);
  assert.match(checked.report.detail, /--major/);

  const crossed = await runUpdate(request({ major: true }), deps(h));
  assert.equal(crossed.code, 0, crossed.report.detail);
  assert.equal(crossed.report.to, "1.0.0");
  assert.equal(currentTag(h.app), "v1.0.0");
});

test("an explicit older version is allowed, and says it is a rollback by hand", async () => {
  const h = host(MINORS, "v0.2.0");
  const back = await runUpdate(request({ target: "v0.1.1" }), deps(h));
  assert.equal(back.code, 0, back.report.detail);
  assert.equal(back.report.outcome, "updated");
  assert.match(back.report.detail, /older than 0\.2\.0: a rollback by hand/);
  assert.equal(currentTag(h.app), "v0.1.1");
  assert.equal(updateRecord(h.app).outcome, "updated");
});

test("a failed health check rolls back once: the old version, its setup and a web restart come back", async () => {
  const h = host(MINORS, "v0.1.0");
  const failed = await runUpdate(request(), deps(h, false));
  assert.equal(failed.code, 1);
  assert.equal(failed.report.outcome, "rolled-back");
  assert.match(failed.report.detail, /darius-web\.service did not answer http:\/\/127\.0\.0\.1:4747\/healthz/);
  assert.match(failed.report.detail, /0\.1\.0 failed its checks too/, "the rollback is checked once, and not rolled again");
  assert.equal(currentTag(h.app), "v0.1.0");
  assert.deepEqual(logLines(h), ["0.2.0 --version", "0.2.0 setup --systemd --keep-stopped", "0.2.0 --version", "0.1.0 setup --systemd --keep-stopped", "0.1.0 --version"]);
  assert.deepEqual(
    h.systemctl.calls.filter((call) => call[0] === "restart"),
    [
      ["restart", "darius-web.service"],
      ["restart", "darius-web.service"],
    ],
  );
  assert.equal(h.health.length, 2);
  assert.equal(updateRecord(h.app).outcome, "rolled-back");
  assert.ok(existsSync(versionDir(h.app, "v0.2.0")), "a rolled-back run prunes nothing");
});

test("a failed setup of the new version rolls back, and a healthy rollback says only that", async () => {
  const h = host(MINORS, "v0.1.0");
  process.env.FAKE_SETUP_FAILS = "0.2.0";
  try {
    const failed = await runUpdate(request(), deps(h));
    assert.equal(failed.code, 1);
    assert.equal(failed.report.outcome, "rolled-back");
    assert.match(failed.report.detail, /setup --systemd of 0\.2\.0 failed: systemd {2}it broke/);
    assert.match(failed.report.detail, /so 0\.1\.0 is back$/);
  } finally {
    delete process.env.FAKE_SETUP_FAILS;
  }
  assert.equal(currentTag(h.app), "v0.1.0");
});

test("a tag whose package.json names another version is refused, and leaves no dir behind", async () => {
  const h = host([...MINORS, { tag: "v0.2.1", packageVersion: "0.2.0" }], "v0.2.0");
  const refused = await runUpdate(request({ target: "v0.2.1" }), deps(h));
  assert.equal(refused.code, 1);
  assert.equal(refused.report.outcome, "failed");
  assert.match(refused.report.detail, /tag v0\.2\.1 carries package\.json version 0\.2\.0/);
  assert.deepEqual(readdirSync(join(h.app, "versions")), ["v0.2.0"]);
  assert.equal(currentTag(h.app), "v0.2.0");
  assert.equal(updateRecord(h.app).outcome, "failed");
});

test("a tag the source does not have is refused; an unreachable source exits 3", async () => {
  const h = host(MINORS, "v0.1.0");
  const missing = await runUpdate(request({ target: "v0.9.0" }), deps(h));
  assert.equal(missing.code, 1);
  assert.match(missing.report.detail, /no tag v0\.9\.0/);

  const gone = `file://${join(tempDir("gone"), "nothing")}`;
  const unreachable = await runUpdate(request({ source: gone }), deps(h));
  assert.equal(unreachable.code, 3);
  assert.equal(unreachable.report.outcome, "unreachable");
  const checked = await runUpdate(request({ check: true, source: gone }), deps(h));
  assert.equal(checked.code, 3);
  assert.equal(currentTag(h.app), "v0.1.0");
});

test("the prune keeps current plus two others, the previous version first", async () => {
  const h = host([...MINORS, { tag: "v0.3.0" }], "v0.1.0");
  for (const tag of ["v0.1.1", "v0.2.0", "v0.3.0"]) {
    const step = await runUpdate(request({ target: tag }), deps(h));
    assert.equal(step.code, 0, step.report.detail);
  }
  assert.deepEqual(readdirSync(join(h.app, "versions")).toSorted(), ["v0.1.1", "v0.2.0", "v0.3.0"]);

  // A rollback by hand to an old version keeps the version it came from.
  const back = await runUpdate(request({ target: "v0.1.0" }), deps(h));
  assert.equal(back.code, 0, back.report.detail);
  assert.deepEqual(back.report.pruned, ["v0.1.1"]);
  assert.deepEqual(readdirSync(join(h.app, "versions")).toSorted(), ["v0.1.0", "v0.2.0", "v0.3.0"]);
  assert.deepEqual(pruneChoice(["v0.1.0", "v0.1.1", "v0.2.0", "v0.3.0"], "v0.1.0", "v0.3.0"), { keep: ["v0.1.0", "v0.3.0", "v0.2.0"], remove: ["v0.1.1"] });
  assert.deepEqual(pruneChoice(["v0.1.0", "v0.2.0"], "v0.2.0", "v0.1.0"), { keep: ["v0.2.0", "v0.1.0"], remove: [] });
});

test("the lock: a live holder refuses the update, a dead one is stale and taken over", async () => {
  const h = host(MINORS, "v0.1.0");
  writeFileSync(join(h.app, "update.lock"), `${process.pid}\n`);
  const refused = await runUpdate(request(), deps(h));
  assert.equal(refused.code, 1);
  assert.match(refused.report.detail, new RegExp(`another update runs \\(pid ${process.pid}\\)`));
  assert.equal(currentTag(h.app), "v0.1.0");

  const dead = spawnSync("true").pid;
  writeFileSync(join(h.app, "update.lock"), `${dead}\n`);
  const done = await runUpdate(request(), deps(h));
  assert.equal(done.code, 0, done.report.detail);
  assert.equal(existsSync(join(h.app, "update.lock")), false);

  const first = takeUpdateLock(h.app);
  assert.equal(first.held, false);
  const second = takeUpdateLock(h.app);
  assert.deepEqual(second, { held: true, pid: process.pid });
  if (!first.held) first.release();
  assert.equal(existsSync(join(h.app, "update.lock")), false);
});

test("the health URL takes DARIUS_WEB_PORT from web.env", () => {
  const home = tempDir("web-env");
  assert.equal(webHealthUrl(home), "http://127.0.0.1:4747/healthz");
  mkdirSync(join(home, ".config", "darius"), { recursive: true });
  writeFileSync(join(home, ".config", "darius", "web.env"), "DARIUS_WEB_BIND=127.0.0.1\nDARIUS_WEB_PORT=4748\n");
  assert.equal(webHealthUrl(home), "http://127.0.0.1:4748/healthz");
});

// --- scripts/install.sh ------------------------------------------------------------------

interface InstallRun {
  status: number | null;
  stdout: string;
  stderr: string;
}

function runInstall(home: string, app: string, bin: string, args: readonly string[]): InstallRun {
  const ran = spawnSync(BASH, [INSTALL_SH, ...args], {
    encoding: "utf8",
    env: { ...process.env, HOME: home, DARIUS_APP_DIR: app, PATH: sandboxPath(bin) },
  });
  return { status: ran.status, stdout: ran.stdout, stderr: ran.stderr };
}

test("install.sh installs the newest tag fresh, runs setup, and a second run changes nothing", () => {
  const source = makeSource([...MINORS, { tag: "v1.0.0" }]);
  const home = tempDir("fresh");
  const app = join(home, ".local", "opt", "darius");
  const bin = fakeBin();
  const log = join(home, "darius.log");
  process.env.FAKE_DARIUS_LOG = log;

  const first = runInstall(home, app, bin.dir, ["--source", source.url]);
  assert.equal(first.status, 0, first.stderr);
  assert.equal(readlinkSync(join(app, "current")), "versions/v1.0.0");
  assert.deepEqual(readdirSync(join(app, "versions")), ["v1.0.0"]);
  assert.equal(readlinkSync(join(home, ".local", "bin", "darius")), join(app, "current", "bin", "darius"));
  assert.match(first.stdout, /✓ cloned v1\.0\.0/);
  assert.match(first.stdout, /✓ darius 1\.0\.0 runs from/);
  assert.deepEqual(readFileSync(log, "utf8").trim().split("\n"), ["1.0.0 --version", "1.0.0 setup --systemd", "1.0.0 skill status"]);
  assert.deepEqual(readFileSync(bin.log, "utf8").trim().split("\n"), ["--user try-restart darius-web.service"]);
  const tail = first.stdout.trim().split("\n").slice(-3);
  assert.match(tail[0] ?? "", /^! .*\/\.local\/bin is not on PATH\. Add it: echo 'export PATH="\$HOME\/\.local\/bin:\$PATH"' >> ~\/\.(bash|zsh)rc, then open a new shell$/u);
  assert.equal(tail[1], "next: cd into a repo you track and run: darius init");
  assert.equal(tail[2], "next: to teach Claude Code sessions darius, run: darius skill install");

  process.env.FAKE_SKILL_STATUS = "0";
  const taught = runInstall(home, app, bin.dir, ["--tag", "v1.0.0", "--source", source.url]);
  delete process.env.FAKE_SKILL_STATUS;
  assert.equal(taught.status, 0, taught.stderr);
  assert.match(taught.stdout, /next: cd into a repo you track and run: darius init\n$/u, "a skill already teaches: no skill line");

  const second = runInstall(home, app, bin.dir, ["--tag", "v1.0.0", "--source", `file://${join(tempDir("gone"), "x")}`]);
  assert.equal(second.status, 0, second.stderr);
  assert.doesNotMatch(second.stdout, /✓ cloned|✓ current/);
  assert.match(second.stdout, /· v1\.0\.0 is already in/);
  assert.match(second.stdout, /· current already points at versions\/v1\.0\.0/);
  assert.equal(readFileSync(bin.log, "utf8").trim().split("\n").length, 1, "no restart when nothing changed");
});

test("install.sh moves a legacy clone at the app root aside, never deletes it, and installs the tag", () => {
  const source = makeSource(MINORS);
  const home = tempDir("legacy");
  const app = join(home, ".local", "opt", "darius");
  mkdirSync(join(app, "bin"), { recursive: true });
  git(app, ["init", "-q"]);
  writeFileSync(join(app, "bin", "darius"), "#!/bin/sh\necho old\n");
  mkdirSync(join(home, ".local", "bin"), { recursive: true });
  symlinkSync(join(app, "bin", "darius"), join(home, ".local", "bin", "darius"));
  const bin = fakeBin();
  process.env.FAKE_DARIUS_LOG = join(home, "darius.log");

  const ran = runInstall(home, app, bin.dir, ["--tag", "v0.2.0", "--source", source.url]);
  assert.equal(ran.status, 0, ran.stderr);
  const legacy = readdirSync(join(home, ".local", "opt")).filter((name) => name.startsWith("darius.legacy-"));
  assert.equal(legacy.length, 1);
  assert.match(ran.stdout, /moved the old clone at .* \(nothing deleted\)/);
  assert.ok(existsSync(join(home, ".local", "opt", legacy[0] ?? "", ".git")));
  assert.equal(readFileSync(join(home, ".local", "opt", legacy[0] ?? "", "bin", "darius"), "utf8"), "#!/bin/sh\necho old\n");
  assert.equal(readlinkSync(join(app, "current")), "versions/v0.2.0");
  assert.equal(existsSync(join(app, ".git")), false);
});

test("install.sh refuses a tag whose package.json disagrees, and a missing tag; an unreachable source exits 3", () => {
  const source = makeSource([...MINORS, { tag: "v0.2.1", packageVersion: "0.2.0" }]);
  const home = tempDir("refuse");
  const app = join(home, ".local", "opt", "darius");
  const bin = fakeBin();
  const liar = runInstall(home, app, bin.dir, ["--tag", "v0.2.1", "--source", source.url]);
  assert.equal(liar.status, 1);
  assert.match(liar.stderr, /carries package\.json version 0\.2\.0/);
  assert.equal(existsSync(join(app, "current")), false);
  assert.deepEqual(readdirSync(join(app, "versions")), []);

  const missing = runInstall(home, app, bin.dir, ["--tag", "v0.9.0", "--source", source.url]);
  assert.equal(missing.status, 1);
  const gone = runInstall(home, app, bin.dir, ["--source", `file://${join(tempDir("gone"), "x")}`]);
  assert.equal(gone.status, 3);
  const usage = runInstall(home, app, bin.dir, ["--tag", "latest"]);
  assert.equal(usage.status, 2);
});

// --- darius update --hosts ------------------------------------------------------------------

/** The fake ssh program and the log of the commands it was given. */
interface FakeSsh {
  program: string;
  log: string;
}

/** A fake ssh: host `down*` is unreachable; any other host runs the command in bash with HOME=<root>/<host>. */
function fakeSsh(root: string, bin: string): FakeSsh {
  const program = join(root, "ssh");
  const log = join(root, "ssh.log");
  writeFileSync(
    program,
    `#!${BASH}
# The update tests' ssh: ssh -o X -o Y <host> <command...>.
set -eu
while [ "\${1:-}" = "-o" ]; do shift 2; done
host="$1"; shift
printf '%s %s\\n' "$host" "$*" >> "${log}"
case "$host" in down*) echo "ssh: connect to host $host port 22: Connection refused" >&2; exit 255 ;; esac
# A NixOS host whose darius comes from home-manager answers the probe only.
case "$host" in nix*) echo "darius-probe nix /nix/store/00000000000000000000000000000000-darius/bin/darius"; exit 0 ;; esac
command="$*"
# A login shell would read this machine's /etc/profile; the fake host has none.
command="\${command/bash -l -s/bash -s}"
unset DARIUS_APP_DIR DARIUS_SOURCE
export HOME="${root}/$host"
mkdir -p "$HOME"
export PATH="${sandboxPath(bin)}"
exec "${BASH}" -c "$command"
`,
  );
  chmodSync(program, 0o755);
  return { program, log };
}

test("--hosts updates a host with an app, bootstraps one without, and reports one unreachable", () => {
  const lead = host(MINORS, "v0.2.0");
  const hosts = tempDir("hosts");
  const bin = fakeBin();
  const ssh = fakeSsh(hosts, bin.dir);

  // alpha has an app install at 0.1.0 already.
  const alpha = join(hosts, "alpha");
  mkdirSync(alpha, { recursive: true });
  const installed = runInstall(alpha, join(alpha, ".local", "opt", "darius"), bin.dir, ["--tag", "v0.1.0", "--source", lead.source.url]);
  assert.equal(installed.status, 0, installed.stderr);

  const pushed = runPush({ hosts: ["alpha", "beta", "down-gamma"], target: "v0.2.0", major: false, source: undefined }, deps(lead, true, { ssh: ssh.program }));
  assert.deepEqual(pushed.hosts.map(hostLine), ["✓ alpha 0.1.0 -> 0.2.0", "✓ beta installed 0.2.0", "! down-gamma unreachable"]);
  assert.equal(pushed.code, 3, "only an unreachable host failed");
  assert.equal(pushed.to, "0.2.0");

  // beta got a real install from install.sh, piped over the fake ssh, from the lead's source.
  const beta = join(hosts, "beta", ".local", "opt", "darius");
  assert.equal(readlinkSync(join(beta, "current")), "versions/v0.2.0");
  assert.equal(readlinkSync(join(hosts, "beta", ".local", "bin", "darius")), join(beta, "current", "bin", "darius"));

  const calls = readFileSync(ssh.log, "utf8").trim().split("\n");
  assert.deepEqual(calls, [
    "alpha bash -l -s --",
    "alpha bash -l -s -- v0.2.0",
    "beta bash -l -s --",
    `beta bash -l -s -- --tag v0.2.0 --source ${lead.source.url}`,
    "down-gamma bash -l -s --",
  ]);
  assert.ok(logLines(lead).includes("0.1.0 update v0.2.0 --json"), "alpha ran its own darius update");
});

test("--hosts passes --major and --source on, reports up to date, and exits 1 when a host fails", () => {
  const lead = host([...MINORS, { tag: "v1.0.0" }], "v0.2.0");
  const hosts = tempDir("hosts");
  const bin = fakeBin();
  const ssh = fakeSsh(hosts, bin.dir);
  const alpha = join(hosts, "alpha");
  mkdirSync(alpha, { recursive: true });
  assert.equal(runInstall(alpha, join(alpha, ".local", "opt", "darius"), bin.dir, ["--tag", "v1.0.0", "--source", lead.source.url]).status, 0);

  const pushed = runPush({ hosts: ["alpha", "beta"], target: "v1.0.0", major: true, source: lead.source.url }, deps(lead, true, { ssh: ssh.program }));
  assert.deepEqual(pushed.hosts.map(hostLine), ["· alpha up to date", "✓ beta installed 1.0.0"]);
  assert.equal(pushed.code, 0);
  assert.ok(readFileSync(ssh.log, "utf8").includes(`alpha bash -l -s -- v1.0.0 --major --source ${lead.source.url}`));

  const failed = runPush({ hosts: ["delta"], target: "v0.9.0", major: false, source: lead.source.url }, deps(lead, true, { ssh: ssh.program }));
  assert.equal(failed.code, 1);
  assert.match(hostLine(failed.hosts[0] ?? { host: "", ok: false, outcome: "failed", from: null, to: null, detail: "" }), /^! delta: install\.sh failed: .*no tag v0\.9\.0/);
});

test("--hosts refuses a host that runs darius from the Nix store, names the remedy, and changes nothing there", () => {
  const lead = host(MINORS, "v0.2.0");
  const hosts = tempDir("hosts");
  const ssh = fakeSsh(hosts, fakeBin().dir);
  const pushed = runPush({ hosts: ["nixbox"], target: "v0.2.0", major: false, source: undefined }, deps(lead, true, { ssh: ssh.program }));
  assert.equal(pushed.code, 1);
  assert.equal(pushed.hosts[0]?.outcome, "refused");
  assert.match(pushed.hosts[0]?.detail ?? "", /Remove the home-manager module \(services\.darius\)/);
  assert.deepEqual(readFileSync(ssh.log, "utf8").trim().split("\n"), ["nixbox bash -l -s --"], "only the probe ran");
});

function hostWith(outcome: HostReport["outcome"]): HostReport {
  return { host: "h", ok: false, outcome, from: null, to: null, detail: "why" };
}

test("the probe answer and the push exit codes", () => {
  assert.deepEqual(parseProbe("motd line\ndarius-probe app darius 0.17.0 (bun)\n"), { kind: "app", what: "darius 0.17.0 (bun)" });
  assert.deepEqual(parseProbe("darius-probe none\n"), { kind: "none", what: "" });
  assert.deepEqual(parseProbe("darius-probe nix /nix/store/abc-darius/bin/darius"), { kind: "nix", what: "/nix/store/abc-darius/bin/darius" });
  assert.equal(parseProbe("Permission denied"), null);

  assert.equal(pushExitCode([hostWith("updated"), hostWith("installed")]), 0);
  assert.equal(pushExitCode([hostWith("updated"), hostWith("unreachable")]), 3);
  assert.equal(pushExitCode([hostWith("unreachable"), hostWith("refused")]), 1);
  assert.equal(hostLine(hostWith("refused")), "! h: why");
});
