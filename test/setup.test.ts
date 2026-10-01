/**
 * `src/cli/setup.ts`: the CLI symlink, the config skeleton, the state dir,
 * `--systemd`'s unit install, and `--remote`'s `ensureBucket` call.
 *
 * HOME SAFETY: every test that reaches `runSetup` passes its own `SetupDeps`
 * with `root`/`home` pointed at a `mkdtemp` dir and fakes for `systemctl`,
 * `bucketFactory` and `unitHost`. Neither the real `systemctl --user`, a real
 * S3 client, nor the real PATH is ever used from this file. The two tests that exercise `setupCommand`
 * (which always builds its own `defaultDeps()`, since the `Command`
 * interface has no injection point) redirect `process.env.HOME`,
 * `DARIUS_CONFIG_DIR` and `DARIUS_STATE_DIR` to throwaway dirs first, and
 * pass neither `--systemd` nor `--remote`, so `defaultDeps().systemctl` and
 * `.bucketFactory` are never called — see the comment on those two tests.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  defaultDeps,
  formatSteps,
  runSetup,
  selectUnits,
  timerPlan,
  setupCommand,
  type BucketFactory,
  type RemoteBucket,
  type SetupDeps,
  type Step,
  type SystemctlRunner,
} from "../src/cli/setup.ts";
import type { UnitHost } from "../src/core/unit-path.ts";

function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

/** What `recordingSystemctl` hands back: a fake runner plus the calls it recorded. */
interface RecordingSystemctl {
  runner: SystemctlRunner;
  calls: string[][];
}

/** A `SystemctlRunner` that records every call instead of running `systemctl`. */
function recordingSystemctl(): RecordingSystemctl {
  const calls: string[][] = [];
  return { runner: (args) => calls.push(args), calls };
}

/** A `BucketFactory` that returns a fixed outcome without touching a network. */
function fakeBucketFactory(outcome: "exists" | "created" | Error): BucketFactory {
  return () => {
    const bucket: RemoteBucket = {
      async ensureBucket() {
        if (outcome instanceof Error) throw outcome;
        return outcome;
      },
    };
    return bucket;
  };
}

/**
 * A `UnitHost` where exactly `dirs` exist. The temp dir is one no test uses, so
 * a `mkdtemp` home is not dropped from the rendered PATH as a temp path.
 */
function fakeHost(envPath = "/usr/bin", dirs: readonly string[] = ["/usr/bin"], files: readonly string[] = []): UnitHost {
  const existing = new Set(dirs);
  const existingFiles = new Set(files);
  return {
    user: "tester",
    envPath,
    tmpDir: "/nonexistent-darius-test-tmp",
    runtimeDir: undefined,
    isDir: (path) => existing.has(path),
    isFile: (path) => existingFiles.has(path),
    realpath: () => undefined,
  };
}

function fakeDeps(
  root: string,
  home: string,
  systemctl: SystemctlRunner,
  bucketFactory: BucketFactory,
  unitHost: UnitHost = fakeHost(),
): SetupDeps {
  return { root, app: join(home, ".local", "opt", "darius"), home, templateDir: join(root, "systemd"), unitHost, systemctl, bucketFactory };
}

const UNIT_FILES = [
  "darius-sync.service",
  "darius-sync.timer",
  "darius-vigil-sweep.service",
  "darius-vigil-sweep.timer",
  "darius-run-due.service",
  "darius-run-due.timer",
  "darius-web.service",
  "darius-snapshot.service",
  "darius-snapshot.timer",
] as const;

const UNITS_TO_ENABLE = ["darius-sync.timer", "darius-vigil-sweep.timer", "darius-run-due.timer", "darius-web.service", "darius-snapshot.timer"] as const;

/** Writes the nine unit files `--systemd` installs, with placeholder content, under `<root>/systemd/`. */
function writeFakeUnits(root: string): void {
  const dir = join(root, "systemd");
  mkdirSync(dir, { recursive: true });
  for (const name of UNIT_FILES) {
    writeFileSync(join(dir, name), `# fake unit: ${name}\n`);
  }
}

/** This repo's real unit templates. */
const REPO_SYSTEMD = fileURLToPath(new URL("../systemd/", import.meta.url));

/** Copies this repo's nine real unit templates into `dir`. */
function copyRealUnits(dir: string): void {
  mkdirSync(dir, { recursive: true });
  for (const name of UNIT_FILES) copyFileSync(join(REPO_SYSTEMD, name), join(dir, name));
}

/** Writes `<root>/bin/darius`, the symlink target `installCliSymlink` points at. */
function writeFakeBin(root: string): void {
  mkdirSync(join(root, "bin"), { recursive: true });
  writeFileSync(join(root, "bin", "darius"), "#!/bin/sh\nexit 0\n");
}

function stepFor(steps: readonly Step[], what: string): Step {
  const step = steps.find((candidate) => candidate.what === what);
  assert.ok(step !== undefined, `no step named "${what}" (got: ${steps.map((s) => s.what).join(", ")})`);
  return step;
}

// --- formatSteps: the ✓ / · / ! visual contract -------------------------------

test("formatSteps marks ok with ✓, skipped with ·, and a failed step with ! (never a red ✗)", () => {
  const steps: Step[] = [
    { ok: true, what: "cli", detail: "linked" },
    { ok: true, skipped: true, what: "config", detail: "already exists" },
    { ok: false, what: "remote", detail: "no [remote] section" },
  ];
  const lines = formatSteps(steps);
  assert.equal(lines.length, 3);
  assert.match(lines[0] ?? "", /^✓ cli\s+linked$/);
  assert.match(lines[1] ?? "", /^· config\s+already exists$/);
  assert.match(lines[2] ?? "", /^! remote\s+no \[remote\] section$/);
});

// --- the cli symlink step, through runSetup -----------------------------------

test("the cli step links, then reports skipped on a second identical run", async () => {
  const root = tempDir("darius-setup-root-");
  const home = tempDir("darius-setup-home-");
  writeFakeBin(root);
  const { runner } = recordingSystemctl();
  const deps = fakeDeps(root, home, runner, fakeBucketFactory("exists"));

  const first = stepFor(await runSetup({ systemd: false, remote: false }, deps), "cli");
  assert.equal(first.ok, true);
  assert.equal(first.skipped, undefined);
  assert.equal(readlinkSync(join(home, ".local", "bin", "darius")), join(root, "bin", "darius"));

  const second = stepFor(await runSetup({ systemd: false, remote: false }, deps), "cli");
  assert.equal(second.ok, true);
  assert.equal(second.skipped, true);
});

test("the cli step refuses a real file that is not our symlink, and leaves it in place", async () => {
  const root = tempDir("darius-setup-root-");
  const home = tempDir("darius-setup-home-");
  writeFakeBin(root);
  mkdirSync(join(home, ".local", "bin"), { recursive: true });
  const foreign = join(home, ".local", "bin", "darius");
  writeFileSync(foreign, "#!/bin/sh\necho not ours\n");
  const { runner } = recordingSystemctl();
  const deps = fakeDeps(root, home, runner, fakeBucketFactory("exists"));

  const step = stepFor(await runSetup({ systemd: false, remote: false }, deps), "cli");
  assert.equal(step.ok, false);
  assert.match(step.detail, /not our symlink/);
  assert.equal(readFileSync(foreign, "utf8"), "#!/bin/sh\necho not ours\n");
});

// --- config skeleton and state dir, through runSetup (env-scoped) ------------

test("config and state-dir steps write once, then report skipped", async () => {
  const configDir = tempDir("darius-setup-config-");
  const stateBase = tempDir("darius-setup-state-");
  const stateDir = join(stateBase, "darius");
  const root = tempDir("darius-setup-root-");
  const home = tempDir("darius-setup-home-");
  writeFakeBin(root);

  await withEnvAsync("DARIUS_CONFIG_DIR", configDir, async () => {
    await withEnvAsync("DARIUS_STATE_DIR", stateDir, async () => {
      const { runner } = recordingSystemctl();
      const deps = fakeDeps(root, home, runner, fakeBucketFactory("exists"));

      const first = await runSetup({ systemd: false, remote: false }, deps);
      const firstConfig = stepFor(first, "config");
      const firstState = stepFor(first, "state dir");
      assert.equal(firstConfig.ok, true);
      assert.equal(firstConfig.skipped, undefined);
      assert.equal(firstState.ok, true);
      assert.equal(firstState.skipped, undefined);
      assert.equal(readFileSync(join(configDir, "config.toml"), "utf8").includes("host ="), true);

      const second = await runSetup({ systemd: false, remote: false }, deps);
      assert.equal(stepFor(second, "config").skipped, true);
      assert.equal(stepFor(second, "state dir").skipped, true);
    });
  });
});

/** `withEnv`, but for an async body — the config/state-dir steps call into async `runSetup`. */
async function withEnvAsync(name: string, value: string, run: () => Promise<void>): Promise<void> {
  const previous = process.env[name];
  process.env[name] = value;
  try {
    await run();
  } finally {
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  }
}

// --- --systemd: unit install + enable, never darius-seaweedfs.service --------

test("--systemd copies the seven sync/vigil-sweep/run-due/web units and enables the three timers plus darius-web.service, never darius-seaweedfs.service", async () => {
  const root = tempDir("darius-setup-root-");
  const home = tempDir("darius-setup-home-");
  writeFakeBin(root);
  writeFakeUnits(root);
  const { runner, calls } = recordingSystemctl();
  const deps = fakeDeps(root, home, runner, fakeBucketFactory("exists"));

  const step = stepFor(await runSetup({ systemd: true, remote: false }, deps), "systemd");
  assert.equal(step.ok, true);

  const unitDir = join(home, ".config", "systemd", "user");
  for (const name of UNIT_FILES) {
    assert.equal(readFileSync(join(unitDir, name), "utf8"), `# fake unit: ${name}\n`);
  }

  // HARD SAFETY RULE: darius-seaweedfs.service is installed only by
  // scripts/seaweedfs-install.sh. This step must never write it or mention it.
  assert.equal(existsSyncQuiet(join(unitDir, "darius-seaweedfs.service")), false);
  assert.deepEqual(calls, [["daemon-reload"], ["enable", "--now", ...UNITS_TO_ENABLE]]);
  for (const call of calls) {
    assert.equal(call.some((arg) => arg.includes("seaweedfs")), false);
  }
});

test("--systemd leaves unit files that link into the Nix store alone (home-manager owns them), and never calls systemctl", async () => {
  const root = tempDir("darius-setup-root-");
  const home = tempDir("darius-setup-home-");
  writeFakeBin(root);
  writeFakeUnits(root);
  const unitDir = join(home, ".config", "systemd", "user");
  mkdirSync(unitDir, { recursive: true });
  const target = "/nix/store/00000000000000000000000000000000-home-manager-files/.config/systemd/user/darius-sync.service";
  symlinkSync(target, join(unitDir, "darius-sync.service"));
  const { runner, calls } = recordingSystemctl();
  const deps = fakeDeps(root, home, runner, fakeBucketFactory("exists"));

  const step = stepFor(await runSetup({ systemd: true, remote: false }, deps), "systemd");
  assert.equal(step.ok, true);
  assert.equal(step.skipped, true);
  assert.match(step.detail, /home-manager/);
  assert.equal(readlinkSync(join(unitDir, "darius-sync.service")), target);
  assert.equal(existsSyncQuiet(join(unitDir, "darius-run-due.service")), false);
  assert.equal(existsSyncQuiet(join(unitDir, "darius-web.service")), false);
  assert.deepEqual(calls, []);
});

test("--systemd leaves darius-web.service alone too when it alone links into the Nix store, and never calls systemctl", async () => {
  const root = tempDir("darius-setup-root-");
  const home = tempDir("darius-setup-home-");
  writeFakeBin(root);
  writeFakeUnits(root);
  const unitDir = join(home, ".config", "systemd", "user");
  mkdirSync(unitDir, { recursive: true });
  const target = "/nix/store/00000000000000000000000000000000-home-manager-files/.config/systemd/user/darius-web.service";
  symlinkSync(target, join(unitDir, "darius-web.service"));
  const { runner, calls } = recordingSystemctl();
  const deps = fakeDeps(root, home, runner, fakeBucketFactory("exists"));

  const step = stepFor(await runSetup({ systemd: true, remote: false }, deps), "systemd");
  assert.equal(step.ok, true);
  assert.equal(step.skipped, true);
  assert.match(step.detail, /darius-web\.service/);
  assert.match(step.detail, /home-manager/);
  assert.equal(readlinkSync(join(unitDir, "darius-web.service")), target);
  assert.equal(existsSyncQuiet(join(unitDir, "darius-sync.service")), false);
  assert.deepEqual(calls, []);
});

/** A `SystemctlRunner` whose `is-enabled` fails, as for a timer that is not enabled. */
function disabledTimers(args: string[]): void {
  if (args[0] === "is-enabled") throw new Error("disabled");
}

test("--systemd reports skipped on a re-run when the units are unchanged and the timers run", async () => {
  const root = tempDir("darius-setup-root-");
  const home = tempDir("darius-setup-home-");
  writeFakeBin(root);
  writeFakeUnits(root);
  await runSetup({ systemd: true, remote: false }, fakeDeps(root, home, recordingSystemctl().runner, fakeBucketFactory("exists")));

  const { runner, calls } = recordingSystemctl();
  const step = stepFor(await runSetup({ systemd: true, remote: false }, fakeDeps(root, home, runner, fakeBucketFactory("exists"))), "systemd");
  assert.equal(step.ok, true);
  assert.equal(step.skipped, true);
  assert.equal(calls.some((call) => call[0] === "enable" || call[0] === "daemon-reload"), false);

  // A timer that is not enabled makes the re-run install and enable again.
  const again = stepFor(await runSetup({ systemd: true, remote: false }, fakeDeps(root, home, disabledTimers, fakeBucketFactory("exists"))), "systemd");
  assert.equal(again.skipped, undefined);
});

test("timerPlan keeps an installed, inactive timer stopped, restarts an active one, and leaves a new one to setup (0.42.3)", () => {
  assert.deepEqual(
    timerPlan([
      { unit: "darius-sync.timer", installed: true, active: true },
      { unit: "darius-run-due.timer", installed: true, active: false },
      { unit: "darius-vigil-sweep.timer", installed: false, active: false },
    ]),
    { keepStopped: ["darius-run-due.timer"], restart: ["darius-sync.timer"] },
  );
  assert.deepEqual(timerPlan([]), { keepStopped: [], restart: [] });
});

test("--systemd --keep-stopped rewrites the units but does not enable a timer that was stopped; plain --systemd still enables all", async () => {
  const root = tempDir("darius-setup-root-");
  const home = tempDir("darius-setup-home-");
  writeFakeBin(root);
  writeFakeUnits(root);
  await runSetup({ systemd: true, remote: false }, fakeDeps(root, home, recordingSystemctl().runner, fakeBucketFactory("exists")));

  const calls: string[][] = [];
  const runDueStopped: SystemctlRunner = (args) => {
    calls.push(args);
    if (args[0] === "is-active" && args[2] === "darius-run-due.timer") throw new Error("inactive");
  };
  const kept = stepFor(await runSetup({ systemd: true, remote: false, keepStopped: true }, fakeDeps(root, home, runDueStopped, fakeBucketFactory("exists"))), "systemd");
  assert.equal(kept.ok, true, kept.detail);
  assert.match(kept.detail, /left stopped darius-run-due\.timer/u);
  assert.equal(calls.some((call) => call.includes("darius-run-due.timer") && call[0] !== "is-active"), false, "run-due is never enabled or started");

  const fresh = recordingSystemctl();
  await runSetup({ systemd: true, remote: false }, fakeDeps(root, home, (args) => {
    fresh.runner(args);
    if (args[0] === "is-active" && args[2] === "darius-run-due.timer") throw new Error("inactive");
  }, fakeBucketFactory("exists")));
  assert.ok(fresh.calls.some((call) => call[0] === "enable" && call.includes("darius-run-due.timer")), "a setup without the flag enables every unit");
});

function existsSyncQuiet(path: string): boolean {
  try {
    readFileSync(path);
    return true;
  } catch {
    return false;
  }
}

test("--systemd fails loud when a unit template is missing, and never calls systemctl", async () => {
  const root = tempDir("darius-setup-root-"); // no systemd/ dir written
  const home = tempDir("darius-setup-home-");
  writeFakeBin(root);
  const { runner, calls } = recordingSystemctl();
  const deps = fakeDeps(root, home, runner, fakeBucketFactory("exists"));

  const step = stepFor(await runSetup({ systemd: true, remote: false }, deps), "systemd");
  assert.equal(step.ok, false);
  assert.deepEqual(calls, []);
});

// --- --systemd: rendering the real templates ------------------------------------

/** Runs `run` with DARIUS_CONFIG_DIR and DARIUS_STATE_DIR on throwaway dirs, so the base steps stay off the real store. */
async function inSandbox(run: () => Promise<void>): Promise<void> {
  await withEnvAsync("DARIUS_CONFIG_DIR", tempDir("darius-setup-config-"), async () => {
    await withEnvAsync("DARIUS_STATE_DIR", join(tempDir("darius-setup-state-"), "darius"), run);
  });
}

const EXEC_ARGS = {
  "darius-sync.service": "sync --all-projects --json",
  "darius-vigil-sweep.service": "vigil sweep --all-projects --daily --json",
  "darius-run-due.service": "run-due --unattended --json",
} as const;

test("--systemd renders the real templates from a checkout: no placeholder left, the host PATH, ExecStart on ~/.local/bin", async () => {
  const root = tempDir("darius-setup-root-");
  const home = tempDir("darius-setup-home-");
  writeFakeBin(root);
  copyRealUnits(join(root, "systemd"));
  const host = fakeHost("/opt/tools/bin:/opt/other/bin:/usr/bin", ["/opt/tools/bin", "/opt/other/bin", "/usr/bin", "/run/current-system/sw/bin"], [
    "/opt/tools/bin/node",
  ]);

  await inSandbox(async () => {
    const step = stepFor(
      await runSetup({ systemd: true, remote: false }, fakeDeps(root, home, recordingSystemctl().runner, fakeBucketFactory("exists"), host)),
      "systemd",
    );
    assert.equal(step.ok, true, step.detail);
  });

  const unitDir = join(home, ".config", "systemd", "user");
  // /opt/other/bin holds no tool the units need, so it stays out.
  const expectedPath = [`${home}/.local/bin`, "/opt/tools/bin", "/run/current-system/sw/bin", "/usr/bin"].join(":");
  for (const name of UNIT_FILES) {
    const text = readFileSync(join(unitDir, name), "utf8");
    assert.equal(text.includes("@PATH@"), false, `${name} still holds @PATH@`);
    assert.equal(text.includes("@DARIUS@"), false, `${name} still holds @DARIUS@`);
  }
  for (const [name, args] of Object.entries(EXEC_ARGS)) {
    const lines = readFileSync(join(unitDir, name), "utf8").split("\n");
    assert.deepEqual(lines.filter((line) => line.startsWith("Environment=")), [`Environment="PATH=${expectedPath}"`]);
    assert.deepEqual(lines.filter((line) => line.startsWith("ExecStart=")), [`ExecStart=%h/.local/bin/darius ${args}`]);
  }
  // darius-web.service: a standing service, so its ExecStart takes no args
  // (bind/port come from the EnvironmentFile), and it enables itself.
  const webLines = readFileSync(join(unitDir, "darius-web.service"), "utf8").split("\n");
  assert.deepEqual(webLines.filter((line) => line.startsWith("Environment=")), [`Environment="PATH=${expectedPath}"`]);
  assert.deepEqual(webLines.filter((line) => line.startsWith("ExecStart=")), ["ExecStart=%h/.local/bin/darius serve"]);
  assert.ok(webLines.includes("EnvironmentFile=-%h/.config/darius/web.env"));
  assert.ok(webLines.includes("Restart=on-failure"));
  assert.ok(webLines.includes("WantedBy=default.target"));
  // Timers carry no placeholder: they land byte for byte.
  for (const name of ["darius-sync.timer", "darius-vigil-sweep.timer", "darius-run-due.timer"]) {
    assert.equal(readFileSync(join(unitDir, name), "utf8"), readFileSync(join(REPO_SYSTEMD, name), "utf8"));
  }
});

// --- running from the Nix store --------------------------------------------------

/** A root under the Nix store that no host has. Nothing here reads or writes it. */
const STORE_ROOT = "/nix/store/00000000000000000000000000000000-darius-test/share/darius/";
const PROFILE_DARIUS = "/etc/profiles/per-user/tester/bin/darius";

/** A host whose PATH holds the store's own bin dir, then a per-user profile link into the store. */
function storeHost(withProfileLink: boolean): UnitHost {
  const links = new Map<string, string>([
    ["/nix/store/00000000000000000000000000000000-darius-test/bin/darius", "/nix/store/00000000000000000000000000000000-darius-test/bin/darius"],
  ]);
  if (withProfileLink) links.set(PROFILE_DARIUS, "/nix/store/00000000000000000000000000000000-darius-test/bin/darius");
  return {
    ...fakeHost(
      "/nix/store/00000000000000000000000000000000-darius-test/bin:/etc/profiles/per-user/tester/bin:/usr/bin",
      ["/etc/profiles/per-user/tester/bin", "/usr/bin"],
    ),
    isFile: (path) => links.has(path),
    realpath: (path) => links.get(path),
  };
}

function storeDeps(home: string, systemctl: SystemctlRunner, withProfileLink: boolean): SetupDeps {
  const templateDir = join(tempDir("darius-setup-templates-"), "systemd");
  copyRealUnits(templateDir);
  return {
    root: STORE_ROOT,
    app: join(home, ".local", "opt", "darius"),
    home,
    templateDir,
    unitHost: storeHost(withProfileLink),
    systemctl,
    bucketFactory: fakeBucketFactory("exists"),
  };
}

test("from the Nix store, the cli step writes no link, and leaves an existing one alone", async () => {
  const home = tempDir("darius-setup-home-");
  const link = join(home, ".local", "bin", "darius");

  await inSandbox(async () => {
    const first = stepFor(await runSetup({ systemd: false, remote: false }, storeDeps(home, recordingSystemctl().runner, true)), "cli");
    assert.equal(first.ok, true);
    assert.equal(first.skipped, true);
    assert.match(first.detail, /Nix store/);
    assert.equal(existsSync(join(home, ".local", "bin")), false);

    mkdirSync(join(home, ".local", "bin"), { recursive: true });
    symlinkSync("/old/checkout/bin/darius", link);
    const second = stepFor(await runSetup({ systemd: false, remote: false }, storeDeps(home, recordingSystemctl().runner, true)), "cli");
    assert.equal(second.skipped, true);
    assert.equal(readlinkSync(link), "/old/checkout/bin/darius");
  });
});

test("from the Nix store, --systemd points ExecStart at the profile link that resolves into the store", async () => {
  const home = tempDir("darius-setup-home-");
  const { runner, calls } = recordingSystemctl();

  await inSandbox(async () => {
    const step = stepFor(await runSetup({ systemd: true, remote: false }, storeDeps(home, runner, true)), "systemd");
    assert.equal(step.ok, true, step.detail);
  });

  const unitDir = join(home, ".config", "systemd", "user");
  for (const [name, args] of Object.entries(EXEC_ARGS)) {
    const text = readFileSync(join(unitDir, name), "utf8");
    assert.match(text, new RegExp(`^ExecStart=${PROFILE_DARIUS} ${args}$`, "mu"));
    assert.equal(text.includes("/nix/store"), false, `${name} must not name a store path`);
    assert.match(text, /^Environment="PATH=[^"]*:\/etc\/profiles\/per-user\/tester\/bin:\/usr\/bin"$/mu);
  }
  const webText = readFileSync(join(unitDir, "darius-web.service"), "utf8");
  assert.match(webText, new RegExp(`^ExecStart=${PROFILE_DARIUS} serve$`, "mu"));
  assert.equal(webText.includes("/nix/store"), false, "darius-web.service must not name a store path");
  assert.deepEqual(calls.at(-1), ["enable", "--now", ...UNITS_TO_ENABLE]);
});

test("from the Nix store with no profile link, --systemd refuses, names the module, and never calls systemctl", async () => {
  const home = tempDir("darius-setup-home-");
  const { runner, calls } = recordingSystemctl();

  await inSandbox(async () => {
    const step = stepFor(await runSetup({ systemd: true, remote: false }, storeDeps(home, runner, false)), "systemd");
    assert.equal(step.ok, false);
    assert.match(step.detail, /no darius outside the store is on PATH/);
    assert.match(step.detail, /services\.darius/);
  });
  assert.deepEqual(calls, []);
  assert.equal(existsSync(join(home, ".config", "systemd", "user")), false);
});

// --- --systemd: idempotency compares the rendered text ----------------------------

test("--systemd skips a re-run with the same PATH, and a changed PATH rewrites, reloads and re-enables", async () => {
  const root = tempDir("darius-setup-root-");
  const home = tempDir("darius-setup-home-");
  writeFakeBin(root);
  copyRealUnits(join(root, "systemd"));
  const before = fakeHost("/usr/bin", ["/usr/bin"]);
  const after = fakeHost("/opt/new/bin:/usr/bin", ["/opt/new/bin", "/usr/bin"], ["/opt/new/bin/node"]);
  const unitDir = join(home, ".config", "systemd", "user");

  await inSandbox(async () => {
    await runSetup({ systemd: true, remote: false }, fakeDeps(root, home, recordingSystemctl().runner, fakeBucketFactory("exists"), before));

    const same = recordingSystemctl();
    const unchanged = stepFor(
      await runSetup({ systemd: true, remote: false }, fakeDeps(root, home, same.runner, fakeBucketFactory("exists"), before)),
      "systemd",
    );
    assert.equal(unchanged.skipped, true);
    assert.equal(same.calls.some((call) => call[0] === "daemon-reload" || call[0] === "enable"), false);

    const changed = recordingSystemctl();
    const rewritten = stepFor(
      await runSetup({ systemd: true, remote: false }, fakeDeps(root, home, changed.runner, fakeBucketFactory("exists"), after)),
      "systemd",
    );
    assert.equal(rewritten.ok, true);
    assert.equal(rewritten.skipped, undefined);
    // Only the services changed: the timers render the same and are not rewritten.
    assert.equal(
      rewritten.detail,
      "rewrote darius-sync.service, darius-vigil-sweep.service, darius-run-due.service, darius-web.service, darius-snapshot.service " +
        `in ${unitDir} (rendered content changed); enabled ${UNITS_TO_ENABLE.join(", ")}`,
    );
    assert.deepEqual(changed.calls.slice(-3), [
      ["daemon-reload"],
      ["enable", "--now", ...UNITS_TO_ENABLE],
      ["restart", "darius-web.service"],
    ], "a changed web unit restarts the running page");
    assert.match(readFileSync(join(unitDir, "darius-sync.service"), "utf8"), /^Environment="PATH=[^"]*\/opt\/new\/bin:\/usr\/bin"$/mu);
    assert.match(readFileSync(join(unitDir, "darius-web.service"), "utf8"), /^Environment="PATH=[^"]*\/opt\/new\/bin:\/usr\/bin"$/mu);

    const again = stepFor(
      await runSetup({ systemd: true, remote: false }, fakeDeps(root, home, recordingSystemctl().runner, fakeBucketFactory("exists"), after)),
      "systemd",
    );
    assert.equal(again.skipped, true);
  });
});

// --- --remote: ensureBucket through the injected factory ----------------------

test("--remote refuses cleanly when config.toml has no [remote] section", async () => {
  const configDir = tempDir("darius-setup-config-");
  writeFileSync(join(configDir, "config.toml"), 'host = "test"\n\n[notify]\nwebhook = ""\n');
  const root = tempDir("darius-setup-root-");
  const home = tempDir("darius-setup-home-");
  writeFakeBin(root);

  await withEnvAsync("DARIUS_CONFIG_DIR", configDir, async () => {
    const { runner } = recordingSystemctl();
    const deps = fakeDeps(root, home, runner, fakeBucketFactory("exists"));
    const step = stepFor(await runSetup({ systemd: false, remote: true }, deps), "remote");
    assert.equal(step.ok, false);
    assert.match(step.detail, /no \[remote\] section/);
  });
});

test("--remote reports created vs. exists, and propagates a credentials-file error", async () => {
  const configDir = tempDir("darius-setup-config-");
  const credsDir = tempDir("darius-setup-creds-");
  const credsPath = join(credsDir, "credentials");
  writeFileSync(credsPath, "[default]\naws_access_key_id = AKIAEXAMPLE\naws_secret_access_key = topsecret\n");
  chmodSync(credsPath, 0o600);
  writeFileSync(
    join(configDir, "config.toml"),
    [
      'host = "test"',
      "",
      "[remote]",
      'endpoint = "http://127.0.0.1:9910"',
      'bucket = "darius"',
      "allow_http = true",
      `credentials = "${credsPath}"`,
    ].join("\n"),
  );
  const root = tempDir("darius-setup-root-");
  const home = tempDir("darius-setup-home-");
  writeFakeBin(root);

  await withEnvAsync("DARIUS_CONFIG_DIR", configDir, async () => {
    const { runner } = recordingSystemctl();

    const created = stepFor(
      await runSetup({ systemd: false, remote: true }, fakeDeps(root, home, runner, fakeBucketFactory("created"))),
      "remote",
    );
    assert.equal(created.ok, true);
    assert.equal(created.skipped, false);
    assert.match(created.detail, /"darius" created/);

    const exists = stepFor(
      await runSetup({ systemd: false, remote: true }, fakeDeps(root, home, runner, fakeBucketFactory("exists"))),
      "remote",
    );
    assert.equal(exists.ok, true);
    assert.equal(exists.skipped, true);

    // Simulates T4 not being reachable yet -- setup must degrade to a
    // reported step, never an uncaught exception (docs/plan-tonight.md, T11:
    // "so setup works before T4 lands").
    const unreachable = stepFor(
      await runSetup(
        { systemd: false, remote: true },
        fakeDeps(root, home, runner, fakeBucketFactory(new Error("connection refused"))),
      ),
      "remote",
    );
    assert.equal(unreachable.ok, false);
    assert.match(unreachable.detail, /could not reach/);
  });

  chmodSync(credsPath, 0o644);
  await withEnvAsync("DARIUS_CONFIG_DIR", configDir, async () => {
    const { runner } = recordingSystemctl();
    const badMode = stepFor(
      await runSetup({ systemd: false, remote: true }, fakeDeps(root, home, runner, fakeBucketFactory("exists"))),
      "remote",
    );
    assert.equal(badMode.ok, false);
    assert.match(badMode.detail, /0600/);
  });
});

// --- flags off: both steps report skipped, nothing touched -------------------

test("with neither flag, systemd and remote both report a clean skip", async () => {
  const root = tempDir("darius-setup-root-");
  const home = tempDir("darius-setup-home-");
  writeFakeBin(root);
  const { runner, calls } = recordingSystemctl();
  const deps = fakeDeps(root, home, runner, fakeBucketFactory("exists"));

  const steps = await runSetup({ systemd: false, remote: false }, deps);
  assert.equal(stepFor(steps, "systemd").skipped, true);
  assert.equal(stepFor(steps, "remote").skipped, true);
  assert.deepEqual(calls, []);
});

// --- the cli link on an app install ------------------------------------------------

/** An app dir, and the version dir darius runs from inside it. */
interface AppVersion {
  app: string;
  root: string;
}

/** An app dir with one version dir that holds a bin/darius, as src/core/app.ts lays it out. */
function appWithVersion(home: string, tag: string): AppVersion {
  const app = join(home, ".local", "opt", "darius");
  const root = join(app, "versions", tag);
  writeFakeBin(root);
  symlinkSync(join("versions", tag), join(app, "current"));
  return { app, root };
}

test("from an app version dir, the cli link points at <app>/current/bin/darius, so a flip needs no relink", async () => {
  const home = tempDir("darius-setup-home-");
  const { app, root } = appWithVersion(home, "v0.17.0");
  const deps: SetupDeps = { ...fakeDeps(root, home, recordingSystemctl().runner, fakeBucketFactory("exists")), app };

  await inSandbox(async () => {
    const step = stepFor(await runSetup({ systemd: false, remote: false }, deps), "cli");
    assert.equal(step.ok, true, step.detail);
    assert.equal(readlinkSync(join(home, ".local", "bin", "darius")), join(app, "current", "bin", "darius"));
    const again = stepFor(await runSetup({ systemd: false, remote: false }, deps), "cli");
    assert.equal(again.skipped, true);
  });
});

test("the cli link replaces a link to any darius bin/darius, even a dangling one, and leaves a foreign link alone", async () => {
  const home = tempDir("darius-setup-home-");
  const { app, root } = appWithVersion(home, "v0.17.0");
  const deps: SetupDeps = { ...fakeDeps(root, home, recordingSystemctl().runner, fakeBucketFactory("exists")), app };
  const link = join(home, ".local", "bin", "darius");
  mkdirSync(join(home, ".local", "bin"), { recursive: true });

  await inSandbox(async () => {
    // The lead host before 0.17.0: the old full clone at the app root, now moved aside.
    for (const old of [join(app, "bin", "darius"), join(app, "versions", "v0.16.0", "bin", "darius"), "/home/someone/projects/darius/bin/darius"]) {
      unlinkQuiet(link);
      symlinkSync(old, link);
      const step = stepFor(await runSetup({ systemd: false, remote: false }, deps), "cli");
      assert.equal(step.ok, true, `${old}: ${step.detail}`);
      assert.equal(readlinkSync(link), join(app, "current", "bin", "darius"));
    }

    unlinkQuiet(link);
    symlinkSync("/usr/local/bin/my-own-wrapper", link);
    const foreign = stepFor(await runSetup({ systemd: false, remote: false }, deps), "cli");
    assert.equal(foreign.ok, false);
    assert.match(foreign.detail, /not our symlink/);
    assert.equal(readlinkSync(link), "/usr/local/bin/my-own-wrapper");
  });
});

function unlinkQuiet(path: string): void {
  rmSync(path, { force: true });
}

// --- --systemd and [setup] units ----------------------------------------------------

/** Runs `run` with a config.toml that holds `setupTable`, plus a throwaway state dir. */
async function withUnits(setupTable: string, run: () => Promise<void>): Promise<void> {
  const configDir = tempDir("darius-setup-config-");
  writeFileSync(join(configDir, "config.toml"), `host = "host-b"\n\n${setupTable}`);
  await withEnvAsync("DARIUS_CONFIG_DIR", configDir, async () => {
    await withEnvAsync("DARIUS_STATE_DIR", join(tempDir("darius-setup-state-"), "darius"), run);
  });
}

test("[setup] units installs and enables only the listed units", async () => {
  const root = tempDir("darius-setup-root-");
  const home = tempDir("darius-setup-home-");
  writeFakeBin(root);
  copyRealUnits(join(root, "systemd"));
  const { runner, calls } = recordingSystemctl();

  await withUnits('[setup]\nunits = ["sync"]\n', async () => {
    const steps = (await runSetup({ systemd: true, remote: false }, fakeDeps(root, home, runner, fakeBucketFactory("exists")))).filter((step) => step.what === "systemd");
    assert.equal(steps.length, 1);
    assert.equal(steps[0]?.ok, true, steps[0]?.detail);
  });

  const unitDir = join(home, ".config", "systemd", "user");
  assert.deepEqual(readdirSync(unitDir).toSorted(), ["darius-sync.service", "darius-sync.timer"]);
  assert.deepEqual(calls, [["daemon-reload"], ["enable", "--now", "darius-sync.timer"]]);
});

test("a unit that leaves [setup] units is disabled and its files removed, and a re-run stays quiet", async () => {
  const root = tempDir("darius-setup-root-");
  const home = tempDir("darius-setup-home-");
  writeFakeBin(root);
  copyRealUnits(join(root, "systemd"));
  const unitDir = join(home, ".config", "systemd", "user");

  await withUnits("", async () => {
    const all = await runSetup({ systemd: true, remote: false }, fakeDeps(root, home, recordingSystemctl().runner, fakeBucketFactory("exists")));
    assert.equal(stepFor(all, "systemd").ok, true);
  });
  assert.equal(readdirSync(unitDir).length, 9);

  const { runner, calls } = recordingSystemctl();
  await withUnits('[setup]\nunits = ["sync"]\n', async () => {
    const steps = (await runSetup({ systemd: true, remote: false }, fakeDeps(root, home, runner, fakeBucketFactory("exists")))).filter((step) => step.what === "systemd");
    assert.equal(steps.length, 2);
    assert.equal(steps[0]?.skipped, true, "the sync unit is unchanged and running");
    assert.equal(steps[1]?.ok, true);
    assert.match(steps[1]?.detail ?? "", /disabled darius-vigil-sweep\.timer, darius-run-due\.timer, darius-web\.service, darius-snapshot\.timer/);
  });
  assert.deepEqual(readdirSync(unitDir).toSorted(), ["darius-sync.service", "darius-sync.timer"]);
  assert.deepEqual(
    calls.filter((call) => call[0] !== "is-enabled" && call[0] !== "is-active"),
    [["disable", "--now", "darius-vigil-sweep.timer", "darius-run-due.timer", "darius-web.service", "darius-snapshot.timer"], ["daemon-reload"]],
  );

  const quiet = recordingSystemctl();
  await withUnits('[setup]\nunits = ["sync"]\n', async () => {
    const steps = (await runSetup({ systemd: true, remote: false }, fakeDeps(root, home, quiet.runner, fakeBucketFactory("exists")))).filter((step) => step.what === "systemd");
    assert.equal(steps.length, 1);
    assert.equal(steps[0]?.skipped, true);
  });
  assert.equal(quiet.calls.some((call) => call[0] === "disable" || call[0] === "enable"), false);
});

test("an unlisted unit darius did not write stays: a Nix store link or a hand-written file is reported with !", async () => {
  const root = tempDir("darius-setup-root-");
  const home = tempDir("darius-setup-home-");
  writeFakeBin(root);
  copyRealUnits(join(root, "systemd"));
  const unitDir = join(home, ".config", "systemd", "user");
  mkdirSync(unitDir, { recursive: true });
  const target = "/nix/store/00000000000000000000000000000000-home-manager-files/.config/systemd/user/darius-web.service";
  symlinkSync(target, join(unitDir, "darius-web.service"));
  writeFileSync(join(unitDir, "darius-run-due.timer"), "[Timer]\nOnCalendar=hourly\n");
  const { runner, calls } = recordingSystemctl();

  await withUnits('[setup]\nunits = ["sync", "vigil-sweep"]\n', async () => {
    const steps = (await runSetup({ systemd: true, remote: false }, fakeDeps(root, home, runner, fakeBucketFactory("exists")))).filter((step) => step.what === "systemd");
    const warnings = steps.filter((step) => !step.ok);
    assert.equal(warnings.length, 2);
    assert.match(warnings[0]?.detail ?? "", /"run-due" is not in \[setup\] units, but darius did not write darius-run-due\.timer/);
    assert.match(warnings[0]?.detail ?? "", /Remove it by hand/);
    assert.match(warnings[1]?.detail ?? "", /darius-web\.service.*home-manager owns it/);
    assert.match(formatSteps(warnings)[1] ?? "", /^! systemd/);
  });
  assert.equal(readlinkSync(join(unitDir, "darius-web.service")), target);
  assert.equal(readFileSync(join(unitDir, "darius-run-due.timer"), "utf8"), "[Timer]\nOnCalendar=hourly\n");
  assert.equal(calls.some((call) => call[0] === "disable"), false);
  assert.deepEqual(calls.at(-1), ["enable", "--now", "darius-sync.timer", "darius-vigil-sweep.timer"]);
});

// --- defaultDeps: shape only, never invoked -----------------------------------

test("defaultDeps returns the real home and a root that holds this checkout's bin/darius, without calling systemctl or the bucket factory", () => {
  const deps = defaultDeps();
  assert.ok(deps.root.length > 0);
  assert.ok(deps.home.length > 0);
  assert.equal(existsSync(join(deps.root, "bin", "darius")), true);
  assert.equal(deps.templateDir, join(deps.root, "systemd"));
  assert.equal(existsSync(join(deps.templateDir, "darius-sync.service")), true);
});

// --- setupCommand: the ParsedArgs -> runSetup -> stdout wiring ----------------
//
// setupCommand.run() always builds its own defaultDeps() -- the Command
// interface (src/cli/registry.ts, T13) has no injection point. Both tests
// below redirect HOME, DARIUS_CONFIG_DIR and DARIUS_STATE_DIR to throwaway
// dirs, and pass neither --systemd nor --remote, so defaultDeps().systemctl
// (the real `systemctl --user`) and .bucketFactory (the real S3 client) are
// structurally never reached: runSetup only calls them when the
// corresponding flag is true.

test("setupCommand --json prints exactly one JSON object with the expected steps", async () => {
  const fakeHome = tempDir("darius-setup-cmd-home-");
  const configDir = tempDir("darius-setup-cmd-config-");
  const stateDir = join(tempDir("darius-setup-cmd-state-"), "darius");

  await withEnvAsync("HOME", fakeHome, async () => {
    await withEnvAsync("DARIUS_CONFIG_DIR", configDir, async () => {
      await withEnvAsync("DARIUS_STATE_DIR", stateDir, async () => {
        const lines: string[] = [];
        const originalLog = console.log;
        console.log = (line: string) => lines.push(line);
        let exitCode: number;
        try {
          exitCode = await setupCommand.run({ positional: [], flags: { json: true }, json: true, repeated: {} });
        } finally {
          console.log = originalLog;
        }
        assert.equal(exitCode, 0);
        assert.equal(lines.length, 1);
        const parsed = JSON.parse(lines[0] ?? "");
        assert.equal(parsed.ok, true);
        const whats = parsed.steps.map((step: Step) => step.what);
        assert.deepEqual(whats, ["cli", "config", "state dir", "skill", "systemd", "remote"]);
        assert.equal(parsed.steps.find((step: Step) => step.what === "systemd").skipped, true);
        assert.equal(parsed.steps.find((step: Step) => step.what === "remote").skipped, true);
      });
    });
  });
});

test("setupCommand without --json prints one ✓/·/! line per step", async () => {
  const fakeHome = tempDir("darius-setup-cmd-home-");
  const configDir = tempDir("darius-setup-cmd-config-");
  const stateDir = join(tempDir("darius-setup-cmd-state-"), "darius");

  await withEnvAsync("HOME", fakeHome, async () => {
    await withEnvAsync("DARIUS_CONFIG_DIR", configDir, async () => {
      await withEnvAsync("DARIUS_STATE_DIR", stateDir, async () => {
        const lines: string[] = [];
        const originalLog = console.log;
        console.log = (line: string) => lines.push(line);
        let exitCode: number;
        try {
          exitCode = await setupCommand.run({ positional: [], flags: {}, json: false, repeated: {} });
        } finally {
          console.log = originalLog;
        }
        assert.equal(exitCode, 0);
        assert.equal(lines.length, 6);
        assert.ok(lines.every((line) => /^[✓·!] /.test(line)));
      });
    });
  });
});

// --- the snapshot timer and the retired export timer -----------------------------------

test("selectUnits: every unit without a config, the listed ones with one", () => {
  const base = { host: "host-b", notify: { webhook: "" }, runner: { claude: "" } };
  assert.deepEqual(selectUnits(null), { install: ["sync", "vigil-sweep", "run-due", "web", "snapshot"] });
  assert.deepEqual(selectUnits({ ...base, setup: { units: ["sync", "snapshot"] } }), { install: ["sync", "snapshot"] });
});

test("--systemd installs darius-snapshot.timer by default from the real templates, and the web unit reads snapshot.env", async () => {
  const root = tempDir("darius-setup-root-");
  const home = tempDir("darius-setup-home-");
  writeFakeBin(root);
  copyRealUnits(join(root, "systemd"));
  const unitDir = join(home, ".config", "systemd", "user");
  const run = recordingSystemctl();

  await withUnits("", async () => {
    const step = stepFor(await runSetup({ systemd: true, remote: false }, fakeDeps(root, home, run.runner, fakeBucketFactory("exists"))), "systemd");
    assert.equal(step.ok, true, step.detail);
  });
  assert.match(readFileSync(join(unitDir, "darius-snapshot.service"), "utf8"), /^ExecStart=\S+ snapshot create --json$/mu);
  assert.match(readFileSync(join(unitDir, "darius-snapshot.service"), "utf8"), /^EnvironmentFile=-%h\/\.config\/darius\/snapshot\.env$/mu);
  assert.match(readFileSync(join(unitDir, "darius-web.service"), "utf8"), /^EnvironmentFile=-%h\/\.config\/darius\/snapshot\.env$/mu);
  const timer = readFileSync(join(unitDir, "darius-snapshot.timer"), "utf8");
  assert.match(timer, /^OnCalendar=04:00$/mu);
  assert.match(timer, /^RandomizedDelaySec=10min$/mu);
  assert.match(timer, /^Persistent=true$/mu);
  assert.ok(run.calls.some((call) => call[0] === "enable" && call.includes("darius-snapshot.timer")));
});

test("--systemd removes the retired export unit when darius wrote it, and leaves one it did not write", async () => {
  const root = tempDir("darius-setup-root-");
  const home = tempDir("darius-setup-home-");
  writeFakeBin(root);
  copyRealUnits(join(root, "systemd"));
  const unitDir = join(home, ".config", "systemd", "user");
  mkdirSync(unitDir, { recursive: true });
  writeFileSync(join(unitDir, "darius-export.service"), "# systemd/darius-export.service: the old git backup\n");
  writeFileSync(join(unitDir, "darius-export.timer"), "# systemd/darius-export.timer: the old git backup\n");

  const first = recordingSystemctl();
  await withUnits('[setup]\nunits = ["sync"]\n', async () => {
    const steps = (await runSetup({ systemd: true, remote: false }, fakeDeps(root, home, first.runner, fakeBucketFactory("exists")))).filter((step) => step.what === "systemd");
    assert.equal(steps.every((step) => step.ok), true);
    assert.match(steps.at(-1)?.detail ?? "", /removed darius-export\.service, darius-export\.timer/u);
  });
  assert.equal(existsSyncQuiet(join(unitDir, "darius-export.timer")), false);
  assert.ok(first.calls.some((call) => call[0] === "disable" && call.includes("darius-export.timer")));

  writeFileSync(join(unitDir, "darius-export.timer"), "# not ours\n");
  const second = recordingSystemctl();
  await withUnits('[setup]\nunits = ["sync"]\n', async () => {
    const steps = (await runSetup({ systemd: true, remote: false }, fakeDeps(root, home, second.runner, fakeBucketFactory("exists")))).filter((step) => step.what === "systemd");
    assert.ok(steps.some((step) => !step.ok && step.detail.includes("darius-export.timer")));
  });
  assert.equal(existsSyncQuiet(join(unitDir, "darius-export.timer")), true);
});
