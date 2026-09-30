/**
 * `darius setup`: make darius usable on this host. Every step is idempotent.
 * Running it twice never rotates a secret, duplicates a unit, or clobbers
 * something the operator wrote by hand.
 *
 * Base steps (always run):
 *   1. link `<home>/.local/bin/darius`. From an app install (darius runs
 *      from `<app>/versions/<tag>`, src/core/app.ts) the link points at
 *      `<app>/current/bin/darius`, so `darius update` flips `current` and
 *      never relinks. From a checkout it points at the checkout's
 *      `bin/darius`. A link to any darius `bin/darius` (an old checkout, an
 *      old version dir, even a dangling one) is replaced; a real file there,
 *      or a link to anything else, is left alone. When darius runs from the
 *      Nix store, this step writes nothing: the store path changes on every
 *      upgrade, and the Nix profile already puts darius on PATH.
 *   2. write `~/.config/darius/config.toml`, a skeleton, if none exists.
 *      `src/core/config.ts` owns the format.
 *   3. create the state root (`~/.local/share/darius`, or `DARIUS_STATE_DIR`).
 *   4. refresh the Claude Code skill file when it carries a darius stamp
 *      (src/cli/skill.ts); it never installs one. With no user-level file,
 *      it says `darius skill install`, unless an installed plugin ships a
 *      stamped darius skill: then the plugin teaches and nothing is needed.
 *
 * `--systemd`: renders the units that config.toml's `[setup] units` lists
 * (sync, vigil-sweep, run-due, web and export; all of them when the key is
 * absent; export only when `[backup] repo` is set) from
 * the templates in `systemd/` into `~/.config/systemd/user/`, then runs
 * `daemon-reload` and `enable --now` on their timers, or on the standing
 * `darius-web.service`. A unit that is not listed gets `disable --now` and
 * its files removed, but only files darius wrote: a link into the Nix store
 * is home-manager's and is left alone with a `!`. Rendering fills in
 * `@PATH@` from this host's PATH and `@DARIUS@` with the binary to call
 * (`src/core/unit-path.ts` holds the rules). A re-run compares the rendered
 * text with the installed files, so a changed PATH rewrites them. From the
 * Nix store, ExecStart calls the profile link that resolves into the store;
 * with no such link the step refuses and names the home-manager module.
 * It never touches `darius-seaweedfs.service`: only
 * `scripts/seaweedfs-install.sh` installs that unit.
 *
 * `--keep-stopped` (with `--systemd`, 0.42.3): a timer whose unit file is
 * installed but that is not active stays stopped; setup rewrites its files
 * and does not enable it. `darius update` passes it, so an update never
 * starts a timer the operator stopped. A setup without it enables every
 * listed unit, as before.
 *
 * `--remote`: calls `ensureBucket()` against the configured `[remote]`,
 * through the injectable `BucketFactory`, so a test never needs a live
 * endpoint.
 *
 * Output marks: `✓` done, `·` nothing needed doing (a re-run reads quiet),
 * `!` needs the operator. Never a red ✗: the step did not crash, it found
 * something that needs a decision, and the remedy is on the same line.
 */

import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, realpathSync, statSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir, tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { Command, ParsedArgs } from "./registry.ts";
import { currentBin, installKind } from "../core/app.ts";
import { loadConfig, loadConfigIfPresent, SETUP_UNITS, writeConfigSkeleton } from "../core/config.ts";
import type { Config, SetupUnit } from "../core/config.ts";
import { loadCredentials } from "../core/credentials.ts";
import { appDir, claudeDir, stateDir } from "../core/paths.ts";
import { createS3 } from "../core/s3.ts";
import type { Credentials, RemoteConfig } from "../core/s3.ts";
import { isNixStorePath, renderUnit, unitDarius, unitPath } from "../core/unit-path.ts";
import type { UnitHost } from "../core/unit-path.ts";
import { errorMessage } from "../runtime.ts";
import { listCommands } from "./registry.ts";
import { findPluginSkill, refreshSkill, renderSkill, skillPath } from "./skill.ts";

// --- reporting ----------------------------------------------------------------

/** One line of setup output. `skipped` prints dim `·`; a false `ok` prints `!`, never a red `✗`. */
export interface Step {
  ok: boolean;
  skipped?: boolean;
  what: string;
  detail: string;
}

function mark(step: Step): string {
  if (!step.ok) return "!";
  return step.skipped === true ? "·" : "✓";
}

/** Plain, colour-free lines. `NO_COLOR` and a non-TTY pipe already read fine without escape codes. */
export function formatSteps(steps: readonly Step[]): string[] {
  const width = steps.reduce((widest, step) => Math.max(widest, step.what.length), 0);
  return steps.map((step) => `${mark(step)} ${step.what.padEnd(width)}  ${step.detail}`);
}

// --- step: the ~/.local/bin symlink ---------------------------------------------

/** darius's own root: two directories up from this file (src/cli/setup.ts). */
function checkoutRoot(): string {
  return fileURLToPath(new URL("../../", import.meta.url));
}

/** The real path of `path`, or `path` itself when it does not exist yet. */
function realOrSame(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/**
 * What `<home>/.local/bin/darius` should point at: `<app>/current/bin/darius`
 * when darius runs from an app version dir, else `<root>/bin/darius`.
 */
function cliLinkTarget(root: string, app: string): string {
  const realApp = realOrSame(app);
  return installKind(root, realApp).kind === "app" ? currentBin(realApp) : join(root, "bin", "darius");
}

/** A link some darius setup wrote: it points at a `bin/darius`. It may dangle, once its version dir is pruned. */
function isDariusLink(target: string): boolean {
  return target === "bin/darius" || target.endsWith("/bin/darius");
}

/**
 * Links `<home>/.local/bin/darius` to `cliLinkTarget`. Only ever replaces a
 * symlink that points at another darius `bin/darius`. A real file there, or
 * a link to anything else, belongs to someone else and is left alone. From
 * the Nix store it writes, replaces and removes nothing.
 */
function installCliSymlink(root: string, app: string, home: string): Step {
  if (isNixStorePath(root)) {
    return {
      ok: true,
      skipped: true,
      what: "cli",
      detail: "darius runs from the Nix store; your Nix profile puts it on PATH. No link written.",
    };
  }
  const binDir = join(home, ".local", "bin");
  const link = join(binDir, "darius");
  const source = cliLinkTarget(root, app);
  try {
    mkdirSync(binDir, { recursive: true });
    const existing = lstatSync(link, { throwIfNoEntry: false });
    if (existing !== undefined) {
      const current = existing.isSymbolicLink() ? readlinkSync(link) : undefined;
      if (current === undefined || !isDariusLink(current)) {
        return {
          ok: false,
          what: "cli",
          detail: `${link} exists and is not our symlink, so it was left untouched. Remove it, or put ${binDir} on PATH some other way, then re-run.`,
        };
      }
      if (current === source) {
        return { ok: true, skipped: true, what: "cli", detail: `${link} already points here` };
      }
      unlinkSync(link);
    }
    symlinkSync(source, link);
  } catch (cause) {
    return { ok: false, what: "cli", detail: `could not link ${link}: ${errorMessage(cause)}` };
  }
  return { ok: true, what: "cli", detail: `linked ${link} -> ${source}` };
}

// --- step: config skeleton -------------------------------------------------------

function installConfigSkeleton(): Step {
  try {
    const result = writeConfigSkeleton();
    return result === "written"
      ? { ok: true, what: "config", detail: "wrote a config.toml skeleton" }
      : { ok: true, skipped: true, what: "config", detail: "config.toml already exists" };
  } catch (cause) {
    return { ok: false, what: "config", detail: errorMessage(cause) };
  }
}

// --- step: state dir --------------------------------------------------------------

function ensureStateDir(): Step {
  const dir = stateDir();
  const already = existsSync(dir);
  try {
    mkdirSync(dir, { recursive: true });
  } catch (cause) {
    return { ok: false, what: "state dir", detail: `could not create ${dir}: ${errorMessage(cause)}` };
  }
  return already
    ? { ok: true, skipped: true, what: "state dir", detail: `${dir} already exists` }
    : { ok: true, what: "state dir", detail: `created ${dir}` };
}

// --- step: --systemd ----------------------------------------------------------------

/** One `[setup] units` name: its unit files, and the unit `enable --now` turns on. */
interface UnitSet {
  files: readonly string[];
  enable: string;
}

/**
 * The nine unit files `--systemd` may install: the four timer/service
 * pairs, plus the standing web service, which has no timer.
 * `darius-seaweedfs.service` is deliberately absent: only
 * `scripts/seaweedfs-install.sh` installs it.
 */
const UNIT_SETS = {
  sync: { files: ["darius-sync.service", "darius-sync.timer"], enable: "darius-sync.timer" },
  "vigil-sweep": { files: ["darius-vigil-sweep.service", "darius-vigil-sweep.timer"], enable: "darius-vigil-sweep.timer" },
  "run-due": { files: ["darius-run-due.service", "darius-run-due.timer"], enable: "darius-run-due.timer" },
  web: { files: ["darius-web.service"], enable: "darius-web.service" },
  export: { files: ["darius-export.service", "darius-export.timer"], enable: "darius-export.timer" },
} as const satisfies Readonly<Record<SetupUnit, UnitSet>>;

/** What `--systemd` does with each unit on this host. */
export interface UnitSelection {
  /** Listed in `[setup] units` (all without the key) and ready to run. */
  install: readonly SetupUnit[];
  /** Listed, but held back: `export` without a `[backup] repo`. Not installed, and removed if darius wrote it. */
  held: readonly SetupUnit[];
}

/**
 * The units `--systemd` installs: config.toml's `[setup] units`, all of them
 * without one (or without a config.toml). The export timer needs
 * `[backup] repo`: without it, `export` is held back even when listed.
 */
export function selectUnits(config: Config | null): UnitSelection {
  const listed = config?.setup.units ?? SETUP_UNITS;
  const hasBackup = config?.backup !== undefined;
  return {
    install: listed.filter((unit) => unit !== "export" || hasBackup),
    held: listed.filter((unit) => unit === "export" && !hasBackup),
  };
}

const NO_DARIUS_OUTSIDE_STORE =
  "darius runs from the Nix store and no darius outside the store is on PATH for the units to call. " +
  "Use the home-manager module (services.darius in this repo's flake.nix), or install darius into a profile, then re-run.";

/** Runs `systemctl --user <args>`. Injected so a test never touches the real user manager. */
export type SystemctlRunner = (args: string[]) => void;

/** The timers `--systemd` may install, in UNIT_SETS order. */
export const TIMER_UNITS: readonly string[] = Object.values(UNIT_SETS)
  .map((set) => set.enable)
  .filter((unit) => unit.endsWith(".timer"));

/** One timer before an update or a `--keep-stopped` setup: is its unit file in the user unit dir, and is it active. */
export interface TimerState {
  unit: string;
  installed: boolean;
  active: boolean;
}

/** The timers a state-keeping run leaves stopped, and the ones it restarts. */
export interface TimerPlan {
  keepStopped: string[];
  restart: string[];
}

/**
 * What a state-keeping run does with each timer (0.42.3). An installed timer
 * that is not active was stopped on purpose: it stays stopped. An active one
 * is restarted, so it picks up the new binary. A timer with no unit file yet
 * is new here: setup installs and enables it, so it is in neither list.
 */
export function timerPlan(states: readonly TimerState[]): TimerPlan {
  const keepStopped: string[] = [];
  const restart: string[] = [];
  for (const state of states) {
    if (!state.installed) continue;
    if (state.active) restart.push(state.unit);
    else keepStopped.push(state.unit);
  }
  return { keepStopped, restart };
}

/** The user unit dir under `home`. */
export function userUnitDir(home: string): string {
  return join(home, ".config", "systemd", "user");
}

/** The state of each timer in `units`. `is-active` is asked only for an installed one. */
export function timerStates(systemctl: SystemctlRunner, unitDir: string, units: readonly string[] = TIMER_UNITS): TimerState[] {
  return units.map((unit) => {
    const installed = lstatSync(join(unitDir, unit), { throwIfNoEntry: false }) !== undefined;
    if (!installed) return { unit, installed, active: false };
    try {
      systemctl(["is-active", "--quiet", unit]);
      return { unit, installed, active: true };
    } catch {
      return { unit, installed, active: false };
    }
  });
}

/** The real `systemctl --user`. `defaultDeps()` wires this in; a test injects a recorder instead. */
export function realSystemctl(args: string[]): void {
  execFileSync("systemctl", ["--user", ...args], { stdio: ["ignore", "pipe", "pipe"] });
}

/** This host's PATH, user and filesystem, as unit rendering reads them. */
export function realUnitHost(): UnitHost {
  return {
    user: loginName(),
    envPath: process.env.PATH ?? "",
    tmpDir: tmpdir(),
    runtimeDir: process.env.XDG_RUNTIME_DIR,
    isDir: (path) => statSync(path, { throwIfNoEntry: false })?.isDirectory() === true,
    isFile: (path) => statSync(path, { throwIfNoEntry: false })?.isFile() === true,
    realpath: (path) => {
      try {
        return realpathSync(path);
      } catch {
        return undefined;
      }
    },
  };
}

/** The account name, which keys `/etc/profiles/per-user/<name>`; `$USER` when the OS has no entry. */
function loginName(): string {
  try {
    return userInfo().username;
  } catch {
    return process.env.USER ?? "";
  }
}

/**
 * True when `systemctl --user is-enabled` and `is-active` both pass for every
 * unit in `units` (timers, and `darius-web.service` itself, which has no
 * timer). One call per unit: with several at once, both verbs exit 0 when
 * ANY one of them matches.
 */
function unitsRunning(systemctl: SystemctlRunner, units: readonly string[]): boolean {
  try {
    for (const unit of units) {
      systemctl(["is-enabled", "--quiet", unit]);
      systemctl(["is-active", "--quiet", unit]);
    }
    return true;
  } catch {
    return false;
  }
}

/** The installed text of a unit file, or undefined when there is none. */
function installedText(path: string): string | undefined {
  return existsSync(path) ? readFileSync(path, "utf8") : undefined;
}

/** True when `path` is a symlink into the Nix store: home-manager's services.darius owns it. */
function isNixLink(path: string): boolean {
  return lstatSync(path, { throwIfNoEntry: false })?.isSymbolicLink() === true && isNixStorePath(readlinkSync(path));
}

/**
 * True when darius wrote the unit file at `path`: a plain file (not a link)
 * whose first line is its template's header, `# systemd/<name>`. Only such a
 * file is removed when its unit leaves `[setup] units`.
 */
function isOwnUnitFile(path: string, name: string): boolean {
  if (lstatSync(path, { throwIfNoEntry: false })?.isFile() !== true) return false;
  return readFileSync(path, "utf8").startsWith(`# systemd/${name}`);
}

/**
 * Renders, writes and enables the listed units. Writing through a link into
 * the Nix store would hit the read-only store, and replacing it would fight
 * the next switch, so any such link among them leaves the step alone.
 */
function installListedUnits(deps: SetupDeps, unitDir: string, sets: readonly UnitSet[], keepStopped: boolean): Step {
  const files = sets.flatMap((set) => set.files);
  const listed = sets.map((set) => set.enable);
  const stopped = keepStopped ? timerPlan(timerStates(deps.systemctl, unitDir, listed.filter((unit) => TIMER_UNITS.includes(unit)))).keepStopped : [];
  const toEnable = listed.filter((unit) => !stopped.includes(unit));
  if (files.length === 0) return { ok: true, skipped: true, what: "systemd", detail: "[setup] units lists no unit, so none is installed" };
  const managed = files.filter((name) => isNixLink(join(unitDir, name)));
  if (managed.length > 0) {
    return {
      ok: true,
      skipped: true,
      what: "systemd",
      detail: `${managed.join(", ")} in ${unitDir} link into the Nix store: home-manager (services.darius) manages them. Left alone.`,
    };
  }
  const enabled = [
    ...(toEnable.length > 0 ? [`enabled ${toEnable.join(", ")}`] : []),
    ...(stopped.length > 0 ? [`left stopped ${stopped.join(", ")}`] : []),
  ].join("; ");
  const darius = unitDarius({ root: deps.root, ...deps.unitHost });
  if (darius === undefined) return { ok: false, what: "systemd", detail: NO_DARIUS_OUTSIDE_STORE };
  const path = unitPath({ home: deps.home, ...deps.unitHost });

  const missing: string[] = [];
  const stale: string[] = [];
  try {
    const rendered = files.map((name) => ({
      name,
      text: renderUnit(readFileSync(join(deps.templateDir, name), "utf8"), path, darius),
    }));
    for (const unit of rendered) {
      const current = installedText(join(unitDir, unit.name));
      if (current === undefined) missing.push(unit.name);
      else if (current !== unit.text) stale.push(unit.name);
    }
    if (missing.length === 0 && stale.length === 0 && unitsRunning(deps.systemctl, toEnable)) {
      return {
        ok: true,
        skipped: true,
        what: "systemd",
        detail: `unit files unchanged in ${unitDir}; ${toEnable.length > 0 ? `${toEnable.join(", ")} already enabled and active` : "nothing to enable"}${stopped.length > 0 ? `; left stopped ${stopped.join(", ")}` : ""}`,
      };
    }
    mkdirSync(unitDir, { recursive: true });
    for (const unit of rendered) {
      if (!missing.includes(unit.name) && !stale.includes(unit.name)) continue;
      const dest = join(unitDir, unit.name);
      writeFileSync(dest, unit.text);
      chmodSync(dest, 0o644);
    }
    deps.systemctl(["daemon-reload"]);
    if (toEnable.length > 0) deps.systemctl(["enable", "--now", ...toEnable]);
    // `enable --now` leaves a running service alone: a changed web unit
    // only takes effect after a restart. Timers re-read their units anyway.
    if (stale.includes("darius-web.service")) deps.systemctl(["restart", "darius-web.service"]);
  } catch (cause) {
    return { ok: false, what: "systemd", detail: errorMessage(cause) };
  }

  const changes: string[] = [];
  if (stale.length > 0) changes.push(`rewrote ${stale.join(", ")} in ${unitDir} (rendered content changed)`);
  if (missing.length > 0) changes.push(`installed ${missing.length} unit files into ${unitDir}`);
  if (changes.length === 0) changes.push(`unit files unchanged in ${unitDir}`);
  return { ok: true, what: "systemd", detail: `${changes.join("; ")}; ${enabled}` };
}

/**
 * Disables and removes the units `[setup] units` does not list, when darius
 * wrote their files. A file darius did not write (a link into the Nix store
 * is home-manager's) stays, and the step says so with `!`.
 */
function removeUnlistedUnits(deps: SetupDeps, unitDir: string, unlisted: readonly SetupUnit[], held: readonly SetupUnit[] = []): Step[] {
  const steps: Step[] = [];
  const files: string[] = [];
  const toDisable: string[] = [];
  for (const unit of unlisted) {
    const set = UNIT_SETS[unit];
    const present = set.files.filter((name) => lstatSync(join(unitDir, name), { throwIfNoEntry: false }) !== undefined);
    if (present.length === 0) continue;
    const foreign = present.filter((name) => !isOwnUnitFile(join(unitDir, name), name));
    if (foreign.length > 0) {
      const nix = foreign.some((name) => isNixLink(join(unitDir, name)));
      steps.push({
        ok: false,
        what: "systemd",
        detail:
          `"${unit}" is not in [setup] units, but darius did not write ${foreign.join(", ")} in ${unitDir}` +
          `${nix ? " (a link into the Nix store: home-manager owns it)" : ""}, so it stays. ` +
          `${nix ? "Turn the unit off in home-manager" : "Remove it by hand"}, or add "${unit}" to [setup] units.`,
      });
      continue;
    }
    files.push(...present);
    toDisable.push(set.enable);
  }
  if (files.length === 0) return steps;
  try {
    deps.systemctl(["disable", "--now", ...toDisable]);
    for (const name of files) unlinkSync(join(unitDir, name));
    deps.systemctl(["daemon-reload"]);
  } catch (cause) {
    steps.push({ ok: false, what: "systemd", detail: `could not remove ${toDisable.join(", ")}: ${errorMessage(cause)}` });
    return steps;
  }
  const why = held.length > 0 ? "not in [setup] units, or export without a [backup] repo" : "not in [setup] units";
  steps.push({ ok: true, what: "systemd", detail: `disabled ${toDisable.join(", ")} and removed ${files.join(", ")} (${why})` });
  return steps;
}

function installSystemdUnits(deps: SetupDeps, keepStopped: boolean): Step[] {
  let selection: UnitSelection;
  try {
    selection = selectUnits(loadConfigIfPresent());
  } catch (cause) {
    return [{ ok: false, what: "systemd", detail: errorMessage(cause) }];
  }
  const units = selection.install;
  const unitDir = userUnitDir(deps.home);
  const listed = installListedUnits(
    deps,
    unitDir,
    units.map((unit) => UNIT_SETS[unit]),
    keepStopped,
  );
  const unlisted = SETUP_UNITS.filter((unit) => !units.includes(unit));
  return [listed, ...removeUnlistedUnits(deps, unitDir, unlisted, selection.held)];
}

// --- step: --remote -------------------------------------------------------------------

/** The only thing `setup --remote` needs from the S3 client. */
export interface RemoteBucket {
  ensureBucket(): Promise<"exists" | "created">;
}

/**
 * Builds a `RemoteBucket` for a `[remote]` config and its credentials. The
 * default is the real client in `src/core/s3.ts`; a test injects a fake, so
 * every step can run and be tested with no live S3 endpoint.
 */
export type BucketFactory = (cfg: RemoteConfig, creds: Credentials) => RemoteBucket;

function defaultBucketFactory(cfg: RemoteConfig, creds: Credentials): RemoteBucket {
  return createS3(cfg, creds);
}

async function ensureRemoteBucket(cfg: Config, factory: BucketFactory): Promise<Step> {
  if (cfg.remote === undefined) {
    return {
      ok: false,
      what: "remote",
      detail: "no [remote] section in config.toml: add one, then re-run with --remote",
    };
  }
  let creds: Credentials;
  try {
    creds = loadCredentials(cfg.remote.credentials);
  } catch (cause) {
    return { ok: false, what: "remote", detail: errorMessage(cause) };
  }
  try {
    const bucket = factory(cfg.remote, creds);
    const result = await bucket.ensureBucket();
    return {
      ok: true,
      skipped: result === "exists",
      what: "remote",
      detail: `bucket "${cfg.remote.bucket}" ${result} at ${cfg.remote.endpoint}`,
    };
  } catch (cause) {
    return { ok: false, what: "remote", detail: `could not reach ${cfg.remote.endpoint}: ${errorMessage(cause)}` };
  }
}

// --- assembling a run --------------------------------------------------------------------

export interface SetupFlags {
  systemd: boolean;
  remote: boolean;
  /** `--keep-stopped`: an installed timer that is not active stays stopped (0.42.3). */
  keepStopped?: boolean;
}

/** Every side effect `runSetup` can have, injectable so a test never touches a real host. */
export interface SetupDeps {
  /** darius's own root. Under `/nix/store/` it means a Nix package, under `<app>/versions/` an app install. */
  root: string;
  /** The app dir, `~/.local/opt/darius` or `DARIUS_APP_DIR` (src/core/app.ts). */
  app: string;
  home: string;
  /** Where the unit templates are read from: `<root>/systemd` for real. */
  templateDir: string;
  /** The PATH, user and filesystem facts the rendered units are built from. */
  unitHost: UnitHost;
  systemctl: SystemctlRunner;
  bucketFactory: BucketFactory;
}

/** The real host: this root, the real home dir and PATH, the real `systemctl --user`, the real S3 client. */
export function defaultDeps(): SetupDeps {
  const root = checkoutRoot();
  return {
    root,
    app: appDir(),
    home: homedir(),
    templateDir: join(root, "systemd"),
    unitHost: realUnitHost(),
    systemctl: realSystemctl,
    bucketFactory: defaultBucketFactory,
  };
}

// --- step: refresh the Claude Code skill --------------------------------------------

/**
 * Rewrites `<claude>/skills/darius/SKILL.md` when it carries a darius stamp
 * and differs from this version's text, so `darius update` (which runs
 * setup) keeps every host's skill current. Installs nothing new: that is
 * `darius skill install`. An unstamped file is the operator's; left alone.
 */
function refreshSkillStep(home: string): Step {
  try {
    const dir = claudeDir(home);
    return { what: "skill", ...refreshSkill(renderSkill(listCommands()), skillPath(dir), findPluginSkill(dir)) };
  } catch (cause) {
    return { ok: false, what: "skill", detail: errorMessage(cause) };
  }
}

export async function runSetup(flags: SetupFlags, deps: SetupDeps = defaultDeps()): Promise<Step[]> {
  const steps: Step[] = [installCliSymlink(deps.root, deps.app, deps.home), installConfigSkeleton(), ensureStateDir(), refreshSkillStep(deps.home)];

  if (flags.systemd) {
    steps.push(...installSystemdUnits(deps, flags.keepStopped === true));
  } else {
    steps.push({
      ok: true,
      skipped: true,
      what: "systemd",
      detail: "skipped (pass --systemd to install and enable the sync / vigil-sweep / run-due / export timers)",
    });
  }

  if (!flags.remote) {
    steps.push({
      ok: true,
      skipped: true,
      what: "remote",
      detail: "skipped (pass --remote to create the bucket if it is missing)",
    });
    return steps;
  }

  try {
    steps.push(await ensureRemoteBucket(loadConfig(), deps.bucketFactory));
  } catch (cause) {
    steps.push({ ok: false, what: "remote", detail: errorMessage(cause) });
  }
  return steps;
}

// --- the command --------------------------------------------------------------------------

function flagOn(args: ParsedArgs, name: string): boolean {
  return args.flags[name] === true;
}

export const setupCommand: Command = {
  name: "setup",
  summary: "link the CLI, write a config skeleton, create the state dir (--systemd [--keep-stopped], --remote)",
  async run(args: ParsedArgs): Promise<number> {
    const steps = await runSetup({ systemd: flagOn(args, "systemd"), remote: flagOn(args, "remote"), keepStopped: flagOn(args, "keep-stopped") });
    const ok = steps.every((step) => step.ok);
    if (args.json) {
      console.log(JSON.stringify({ ok, steps }));
    } else {
      for (const line of formatSteps(steps)) console.log(line);
    }
    return ok ? 0 : 1;
  },
};
