/**
 * `darius restore` (src/core/restore.ts, src/core/tar-read.ts,
 * src/cli/restore.ts).
 *
 * SAFETY: every store, snapshot folder and config dir is a `mkdtemp` dir.
 * systemd is never asked: the core tests inject `unitActive`, and the CLI
 * runs get a fake `DARIUS_SYSTEMCTL` script or a missing file. The archives
 * with bad entries are built here byte by byte, so no real `tar` ever
 * unpacks them.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, symlinkSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { gzipSync } from "node:zlib";

import { hostId, readLedger } from "../src/core/ledger.ts";
import { fixTail, liveStoreProblem, runRestore, safeEntryPath, START_LINE, STOP_LINE, type RestoreDeps, type RestoreOptions } from "../src/core/restore.ts";
import { openProject } from "../src/core/store.ts";
import { ulid } from "../src/core/ulid.ts";

const sandbox = mkdtempSync(join(tmpdir(), "darius-restore-test-"));
process.env.DARIUS_CONFIG_DIR = join(sandbox, "config");
mkdirSync(process.env.DARIUS_CONFIG_DIR, { recursive: true });
const BIN = join(import.meta.dirname, "..", "bin", "darius");
const HOST = hostId();
const NOW = new Date(Date.UTC(2026, 9, 8, 12, 0, 0));
const STAMP = "20261008T120000Z";

// --- a tiny tar writer, so a test controls every byte of an archive -------------------------------

interface Entry {
  path: string;
  data?: string;
  /** "0" file (default), "5" folder, "2" symlink. */
  flag?: string;
  link?: string;
}

function header(entry: Entry, size: number): Buffer {
  const block = Buffer.alloc(512);
  const field = (text: string, at: number, length: number): void => {
    block.write(text, at, length, "utf8");
  };
  const octal = (value: number, at: number, length: number): void => {
    field(`${value.toString(8).padStart(length - 1, "0")}\0`, at, length);
  };
  field(entry.path, 0, 100);
  octal(entry.flag === "5" ? 0o755 : 0o644, 100, 8);
  octal(0, 108, 8);
  octal(0, 116, 8);
  octal(size, 124, 12);
  octal(Math.floor(NOW.getTime() / 1000), 136, 12);
  field(entry.flag ?? "0", 156, 1);
  field(entry.link ?? "", 157, 100);
  field("ustar\0", 257, 6);
  field("00", 263, 2);
  block.fill(0x20, 148, 156);
  let sum = 0;
  for (const byte of block) sum += byte;
  field(`${sum.toString(8).padStart(6, "0")}\0 `, 148, 8);
  return block;
}

function tarGz(entries: readonly Entry[]): Buffer {
  const parts: Buffer[] = [];
  for (const entry of entries) {
    const data = Buffer.from(entry.data ?? "", "utf8");
    parts.push(header(entry, data.length), data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  parts.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(parts));
}

function snapshot(dir: string, archive: Buffer, extra: { host?: string; sha?: string; name?: string } = {}): string {
  const name = extra.name ?? `darius-${extra.host ?? HOST}-${STAMP}.tar.gz`;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), archive);
  const manifest = {
    v: 1,
    name,
    host: extra.host ?? HOST,
    at: NOW.toISOString(),
    darius: "9.9.9",
    files: 1,
    storeBytes: 1,
    bytes: archive.length,
    sha256: extra.sha ?? createHash("sha256").update(archive).digest("hex"),
  };
  writeFileSync(join(dir, `${name}.json`), JSON.stringify(manifest));
  return name;
}

const madeLines = new Map<string, string>();
/** One valid ledger line per project and second; the same call gives the same line. */
function ledgerLine(project: string, second: number): string {
  const key = `${project}/${String(second)}`;
  const known = madeLines.get(key);
  if (known !== undefined) return known;
  const ms = Date.UTC(2026, 9, 1, 0, 0, second);
  const line = JSON.stringify({ v: 1, id: ulid(ms), at: new Date(ms).toISOString(), host: HOST, who: "tester", project, type: "test.event" });
  madeLines.set(key, line);
  return line;
}

function put(root: string, path: string, data: string): void {
  const full = join(root, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, data);
}

/** Every path under `root`, for a "nothing changed" check. */
function tree(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { recursive: true, encoding: "utf8" }).toSorted();
}

interface Case {
  root: string;
  state: string;
  snaps: string;
}

let caseCount = 0;
/** A fresh state dir and snapshot dir; the state dir is the one this process's store code reads. */
function freshCase(): Case {
  caseCount += 1;
  const root = join(sandbox, `case-${String(caseCount)}`);
  const state = join(root, "state");
  const snaps = join(root, "snaps");
  mkdirSync(state, { recursive: true });
  mkdirSync(snaps, { recursive: true });
  process.env.DARIUS_STATE_DIR = state;
  return { root, state, snaps };
}

function deps(over: Partial<RestoreDeps> & { active?: string[] } = {}): RestoreDeps {
  const active = new Set(over.active ?? []);
  return {
    unitActive: (unit) => active.has(unit),
    stdinIsTTY: () => false,
    ask: () => Promise.resolve(""),
    now: () => NOW,
    ...over,
  };
}

function options(target: Case, name: string, over: Partial<RestoreOptions> = {}): RestoreOptions {
  return { target: name, mode: "full", dryRun: false, yes: true, stateDir: target.state, snapshotDir: target.snaps, host: HOST, ...over };
}

/** A store archive: one ritual file, a ledger with a cut open.jsonl, a closed chunk, a run with a cut gate log, a lock, a sync.json. */
function storeArchive(): Buffer {
  const chunk = `${ulid(Date.UTC(2026, 9, 1))}.jsonl`;
  return tarGz([
    { path: "./", flag: "5" },
    { path: "./proj/", flag: "5" },
    { path: "./proj/items/rituals/daily.md", data: "# from the snapshot\n" },
    { path: `./proj/ledger/${HOST}/${chunk}`, data: `${ledgerLine("proj", 1)}\n` },
    { path: `./proj/ledger/${HOST}/open.jsonl`, data: `${ledgerLine("proj", 2)}\n${ledgerLine("proj", 3)}\n{"v":1,"id":"01K` },
    { path: "./proj/runs/run-1/gate.jsonl", data: '{"ok":true}\n{"ok":' },
    { path: "./proj/sync.json", data: '{"v":1,"seen":[],"base":{}}' },
    { path: "./proj/.lock", data: "1 elsewhere 2026-10-01T00:00:00.000Z x\n" },
    { path: "./_global/ledger/", flag: "5" },
    { path: "./run-due-digest.json", data: "{}" },
  ]);
}

// --- pure parts -------------------------------------------------------------------------------------

test("entry paths: relative ones pass, absolute paths and .. are refused", () => {
  assert.deepEqual(safeEntryPath("./proj/items/a.md"), { ok: true, path: "proj/items/a.md" });
  assert.deepEqual(safeEntryPath("./"), { ok: true, path: "" });
  assert.equal(safeEntryPath("/etc/passwd").ok, false);
  assert.equal(safeEntryPath("./proj/../../evil").ok, false);
  assert.equal(safeEntryPath("../evil").ok, false);
});

function check(row: string): void {
  JSON.parse(row);
}

test("the tail rule trims one cut line and adds a missing newline to a whole one", () => {
  assert.equal(fixTail("", "f", check), null);
  assert.equal(fixTail('{"a":1}\n', "f", check), null);
  assert.deepEqual(fixTail('{"a":1}\n{"a":', "f", check), { text: '{"a":1}\n', trimmed: true });
  assert.deepEqual(fixTail('{"a":1}\n{"a":2}', "f", check), { text: '{"a":1}\n{"a":2}\n', trimmed: false });
});

// --- refusals -----------------------------------------------------------------------------------------

test("a SHA-256 that does not match the manifest refuses and touches nothing", async () => {
  const at = freshCase();
  put(at.state, "proj/items/rituals/daily.md", "# live\n");
  const name = snapshot(at.snaps, storeArchive(), { sha: "0".repeat(64) });
  const before = tree(at.root);
  const report = await runRestore(options(at, name), deps());
  assert.equal(report.code, 1);
  assert.match(report.error ?? "", /SHA-256 does not match/u);
  assert.deepEqual(tree(at.root), before);
});

test("a ritual run never restores", async () => {
  const at = freshCase();
  const name = snapshot(at.snaps, storeArchive());
  const report = await runRestore(options(at, name, { run: "01RUN" }), deps());
  assert.equal(report.code, 1);
  assert.match(report.error ?? "", /never a run/u);
});

test("a missing manifest refuses and says how to fetch both files", async () => {
  const at = freshCase();
  const name = `darius-${HOST}-${STAMP}.tar.gz`;
  writeFileSync(join(at.snaps, name), storeArchive());
  const report = await runRestore(options(at, name), deps());
  assert.equal(report.code, 1);
  assert.match(report.error ?? "", /snapshot fetch/u);
});

test("an active unit refuses and prints the stop line", async () => {
  const at = freshCase();
  const name = snapshot(at.snaps, storeArchive());
  const report = await runRestore(options(at, name), deps({ active: ["darius-sync.timer"] }));
  assert.equal(report.code, 1);
  assert.match(report.error ?? "", /darius-sync\.timer/u);
  assert.match(report.error ?? "", /systemctl --user stop darius-web /u);
  // Runs only waits for the run-due timer alone.
  const runs = await runRestore(options(at, name, { mode: "runs-only", dryRun: true }), deps({ active: ["darius-sync.timer"] }));
  assert.equal(runs.code, 0, runs.error ?? "");
  const busy = await runRestore(options(at, name, { mode: "runs-only", dryRun: true }), deps({ active: ["darius-run-due.timer"] }));
  assert.equal(busy.code, 1);
  const unknown = await runRestore(
    options(at, name),
    deps({
      unitActive: () => {
        throw new Error("no bus");
      },
    }),
  );
  assert.equal(unknown.code, 1);
  assert.match(unknown.error ?? "", /cannot ask systemd/u);
});

test("a snapshot of another host refuses without --from-host and passes with it", async () => {
  const at = freshCase();
  const name = snapshot(at.snaps, storeArchive(), { host: "other-host" });
  const refused = await runRestore(options(at, name, { dryRun: true }), deps());
  assert.equal(refused.code, 1);
  assert.match(refused.error ?? "", /--from-host other-host/u);
  const wrong = await runRestore(options(at, name, { dryRun: true, fromHost: "third-host" }), deps());
  assert.equal(wrong.code, 1);
  const named = await runRestore(options(at, name, { dryRun: true, fromHost: "other-host" }), deps());
  assert.equal(named.code, 0, named.error ?? "");
});

test("a held project lock or a running snapshot refuses", async () => {
  const at = freshCase();
  const name = snapshot(at.snaps, storeArchive());
  put(at.state, "proj/.lock", `${String(process.pid)} ${hostname()} ${new Date().toISOString()} x\n`);
  const locked = await runRestore(options(at, name), deps());
  assert.equal(locked.code, 1);
  assert.match(locked.error ?? "", /lock of proj/u);

  const other = freshCase();
  const second = snapshot(other.snaps, storeArchive());
  writeFileSync(join(other.snaps, "lock.json"), JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
  const running = await runRestore(options(other, second), deps());
  assert.equal(running.code, 1);
  assert.match(running.error ?? "", /snapshot run holds the lock/u);
});

test("without --yes it refuses off a terminal, and on a terminal only the answer yes goes on", async () => {
  const at = freshCase();
  put(at.state, "proj/items/rituals/daily.md", "# live\n");
  const name = snapshot(at.snaps, storeArchive());
  const before = tree(at.root);
  const piped = await runRestore(options(at, name, { yes: false }), deps());
  assert.equal(piped.code, 1);
  assert.match(piped.error ?? "", /--yes/u);
  const no = await runRestore(options(at, name, { yes: false }), deps({ stdinIsTTY: () => true, ask: () => Promise.resolve("y") }));
  assert.equal(no.code, 1);
  assert.deepEqual(tree(at.root), before);
  const asked: string[] = [];
  const yes = await runRestore(
    options(at, name, { yes: false }),
    deps({
      stdinIsTTY: () => true,
      ask: (question) => {
        asked.push(question);
        return Promise.resolve("yes\n");
      },
    }),
  );
  assert.equal(yes.code, 0, yes.error ?? "");
  assert.match(asked[0] ?? "", /replace the store/u);
});

test("an archive with .., an absolute path or a symlink is refused before anything is written", async () => {
  for (const bad of [
    [{ path: "./proj/../../evil", data: "x" }],
    [{ path: "/tmp/evil-absolute", data: "x" }],
    [{ path: "./proj/runs/link", flag: "2", link: "/etc" }],
  ]) {
    const at = freshCase();
    put(at.state, "proj/items/rituals/daily.md", "# live\n");
    const name = snapshot(at.snaps, tarGz([{ path: "./proj/", flag: "5" }, ...bad]));
    const before = tree(at.root);
    for (const mode of ["full", "runs-only"] as const) {
      const report = await runRestore(options(at, name, { mode }), deps());
      assert.equal(report.code, 1, `${mode} ${bad[0]?.path ?? ""}`);
      assert.match(report.error ?? "", /entries restore refuses/u);
    }
    assert.deepEqual(tree(at.root), before);
    assert.equal(existsSync(join(at.root, "evil")), false);
  }
});

test("a damaged closed chunk refuses: only open.jsonl may lose a cut line", async () => {
  const at = freshCase();
  const name = snapshot(at.snaps, tarGz([{ path: `./proj/ledger/${HOST}/${ulid(Date.UTC(2026, 9, 1))}.jsonl`, data: `${ledgerLine("proj", 1)}\n{"v":1,"id` }]));
  const report = await runRestore(options(at, name), deps());
  assert.equal(report.code, 1);
  assert.match(report.error ?? "", /damaged/u);
  assert.deepEqual(tree(at.state), []);
});

// --- full restore -------------------------------------------------------------------------------------

test("a full restore moves the old store aside, puts the new one in place, trims cut lines and writes store.restored", async () => {
  const at = freshCase();
  put(at.state, "proj/items/rituals/daily.md", "# live, damaged\n");
  put(at.state, "only-in-old.txt", "old");
  const name = snapshot(at.snaps, storeArchive());
  const report = await runRestore(options(at, name), deps());
  assert.equal(report.code, 0, report.error ?? "");

  const aside = `${at.state}.before-restore-${STAMP}`;
  assert.equal(report.moved_to, aside);
  assert.equal(readFileSync(join(aside, "proj/items/rituals/daily.md"), "utf8"), "# live, damaged\n");
  assert.equal(readFileSync(join(aside, "only-in-old.txt"), "utf8"), "old");
  assert.equal(readFileSync(join(at.state, "proj/items/rituals/daily.md"), "utf8"), "# from the snapshot\n");
  assert.equal(existsSync(join(at.state, "only-in-old.txt")), false);
  assert.equal(existsSync(`${at.state}.restoring-${STAMP}`), false);

  const open = readFileSync(join(at.state, `proj/ledger/${HOST}/open.jsonl`), "utf8");
  assert.equal(open, `${ledgerLine("proj", 2)}\n${ledgerLine("proj", 3)}\n`);
  assert.equal(readFileSync(join(at.state, "proj/runs/run-1/gate.jsonl"), "utf8"), '{"ok":true}\n');
  assert.deepEqual(report.trimmed.toSorted(), [`proj/ledger/${HOST}/open.jsonl`, "proj/runs/run-1/gate.jsonl"]);
  assert.equal(existsSync(join(at.state, "proj/.lock")), false);
  assert.equal(readFileSync(join(at.state, "proj/sync.json"), "utf8"), '{"v":1,"seen":[],"base":{}}');
  assert.equal(readLedger(openProject("proj")).length, 3);

  const restored = readLedger(openProject("_global")).filter((line) => line.type === "store.restored");
  assert.equal(restored.length, 1);
  assert.equal(restored[0]?.mode, "full");
  assert.equal(restored[0]?.name, name);
  assert.deepEqual(restored[0]?.trimmed, report.trimmed);
  assert.ok(report.next.some((step) => step.startsWith("darius sync --all-projects")));
  assert.ok(report.next.some((step) => step.includes("darius snapshot status --hosts")));
  assert.ok(report.next.some((step) => step.includes(aside)));
});

test("a sync.json that does not parse is removed with a notice; with no store before, nothing is moved aside", async () => {
  const at = freshCase();
  const name = snapshot(at.snaps, tarGz([{ path: "./proj/items/rituals/a.md", data: "x" }, { path: "./proj/sync.json", data: "{not json" }]));
  const report = await runRestore(options(at, name, { stateDir: join(at.root, "fresh") }), deps());
  assert.equal(report.code, 0, report.error ?? "");
  assert.equal(report.moved_to, null);
  assert.equal(existsSync(join(at.root, "fresh/proj/sync.json")), false);
  assert.ok(report.notices.some((notice) => notice.includes("proj/sync.json does not parse")));
});

test("--dry-run runs every check, counts the files, names the trims and writes nothing", async () => {
  const at = freshCase();
  put(at.state, "proj/items/rituals/daily.md", "# live\n");
  const name = snapshot(at.snaps, storeArchive());
  const before = tree(at.root);
  const report = await runRestore(options(at, name, { dryRun: true, yes: false }), deps());
  assert.equal(report.code, 0, report.error ?? "");
  assert.deepEqual(tree(at.root), before);
  const proj = report.projects.find((project) => project.name === "proj");
  assert.equal(proj?.files, 6);
  assert.equal(proj?.runs, 1);
  assert.equal(report.trimmed.length, 2);
  const runs = await runRestore(options(at, name, { mode: "runs-only", dryRun: true, yes: false }), deps());
  assert.equal(runs.code, 0, runs.error ?? "");
  assert.equal(runs.restored, 1);
  assert.deepEqual(tree(at.root), before);
});

test("a oneshot service that still runs after its timer stopped refuses; the stop line stops it, the start line starts only timers", async () => {
  const at = freshCase();
  const name = snapshot(at.snaps, storeArchive());
  for (const unit of ["darius-sync.service", "darius-run-due.service", "darius-vigil-sweep.service", "darius-snapshot.service"]) {
    const report = await runRestore(options(at, name, { dryRun: true }), deps({ active: [unit] }));
    assert.equal(report.code, 1, unit);
    assert.match(report.error ?? "", new RegExp(`active: ${unit.replaceAll(".", "\\.")}`, "u"));
  }
  const runs = await runRestore(options(at, name, { mode: "runs-only", dryRun: true }), deps({ active: ["darius-run-due.service"] }));
  assert.equal(runs.code, 1);
  for (const unit of ["darius-sync.timer", "darius-run-due.service", "darius-snapshot.service"]) assert.ok(STOP_LINE.split(" ").includes(unit), unit);
  assert.ok(START_LINE.split(" ").includes("darius-web"));
  assert.ok(START_LINE.split(" ").includes("darius-run-due.timer"));
  assert.equal(START_LINE.includes(".service"), false);
});

test("a state dir with a trailing slash restores next to the store, never inside it", async () => {
  const at = freshCase();
  put(at.state, "proj/items/rituals/daily.md", "# live\n");
  const name = snapshot(at.snaps, storeArchive());
  const report = await runRestore(options(at, name, { stateDir: `${at.state}/` }), deps());
  assert.equal(report.code, 0, report.error ?? "");
  assert.equal(report.moved_to, `${at.state}.before-restore-${STAMP}`);
  assert.equal(readFileSync(join(at.state, "proj/items/rituals/daily.md"), "utf8"), "# from the snapshot\n");
  assert.deepEqual(
    readdirSync(at.state).filter((entry) => entry.includes("restor")),
    [],
  );
});

test("the guards run again after the confirmation: a lock or a unit taken while it asked refuses", async () => {
  const at = freshCase();
  put(at.state, "proj/items/rituals/daily.md", "# live\n");
  const name = snapshot(at.snaps, storeArchive());
  const locked = await runRestore(
    options(at, name, { yes: false }),
    deps({
      stdinIsTTY: () => true,
      ask: () => {
        put(at.state, "proj/.lock", `${String(process.pid)} ${hostname()} ${new Date().toISOString()} x\n`);
        return Promise.resolve("yes");
      },
    }),
  );
  assert.equal(locked.code, 1);
  assert.match(locked.error ?? "", /lock of proj/u);
  assert.ok(locked.checks.some((one) => one.name === "store locks (after confirmation)" && !one.ok));
  assert.equal(readFileSync(join(at.state, "proj/items/rituals/daily.md"), "utf8"), "# live\n");
  assert.equal(existsSync(`${at.state}.restoring-${STAMP}`), false);

  const other = freshCase();
  put(other.state, "proj/items/rituals/daily.md", "# live\n");
  const second = snapshot(other.snaps, storeArchive());
  let armed = false;
  const busy = await runRestore(
    options(other, second, { yes: false }),
    deps({
      unitActive: (unit) => armed && unit === "darius-run-due.service",
      stdinIsTTY: () => true,
      ask: () => {
        armed = true;
        return Promise.resolve("yes");
      },
    }),
  );
  assert.equal(busy.code, 1);
  assert.match(busy.error ?? "", /active: darius-run-due\.service/u);
  assert.equal(readFileSync(join(other.state, "proj/items/rituals/daily.md"), "utf8"), "# live\n");
});

test("a store that cannot be moved aside removes the staging folder and names it", async () => {
  const at = freshCase();
  put(at.state, "proj/items/rituals/daily.md", "# live\n");
  const name = snapshot(at.snaps, storeArchive());
  const staging = `${at.state}.restoring-${STAMP}`;
  const report = await runRestore(
    options(at, name),
    deps({
      renameDir: () => {
        throw new Error("EBUSY: busy");
      },
    }),
  );
  assert.equal(report.code, 1);
  assert.match(report.error ?? "", /could not be moved aside.*EBUSY/u);
  assert.ok((report.error ?? "").includes(staging));
  assert.equal(existsSync(staging), false);
  assert.equal(readFileSync(join(at.state, "proj/items/rituals/daily.md"), "utf8"), "# live\n");
});

test("a failed rollback reports both errors and both folders", async () => {
  const at = freshCase();
  put(at.state, "proj/items/rituals/daily.md", "# live\n");
  const name = snapshot(at.snaps, storeArchive());
  const staging = `${at.state}.restoring-${STAMP}`;
  const aside = `${at.state}.before-restore-${STAMP}`;
  let calls = 0;
  const report = await runRestore(
    options(at, name),
    deps({
      renameDir: (from, to) => {
        calls += 1;
        if (calls === 1) renameSync(from, to);
        else throw new Error(calls === 2 ? "EIO: first" : "EIO: second");
      },
    }),
  );
  assert.equal(report.code, 1);
  const error = report.error ?? "";
  assert.match(error, /EIO: first/u);
  assert.match(error, /EIO: second/u);
  assert.ok(error.includes(aside) && error.includes(staging), error);
  assert.equal(readFileSync(join(aside, "proj/items/rituals/daily.md"), "utf8"), "# live\n");
  assert.ok(existsSync(staging));
});

test("a live store that is a symlink or a mount point refuses up front and points to the hand recipe", async () => {
  const at = freshCase();
  const real = join(at.root, "real");
  put(real, "proj/items/rituals/daily.md", "# live\n");
  const link = join(at.root, "linked");
  symlinkSync(real, link);
  const name = snapshot(at.snaps, storeArchive());
  const before = tree(at.root);
  const report = await runRestore(options(at, name, { stateDir: link }), deps());
  assert.equal(report.code, 1);
  assert.match(report.error ?? "", /is a symlink.*By hand/u);
  assert.deepEqual(tree(at.root), before);
  assert.equal(liveStoreProblem(at.state), null);
  assert.equal(liveStoreProblem(join(at.root, "missing")), null);
  if (process.platform === "linux" && existsSync("/proc/self")) assert.match(liveStoreProblem("/proc") ?? "", /mount point.*By hand/u);
});

// --- runs only -----------------------------------------------------------------------------------------

test("--runs-only restores only missing run folders, skips existing ones and unknown projects, and writes nothing else", async () => {
  const at = freshCase();
  put(at.state, "proj/items/rituals/daily.md", "# synced\n");
  put(at.state, "proj/runs/run-1/notes.md", "kept\n");
  const name = snapshot(
    at.snaps,
    tarGz([
      { path: "./proj/items/rituals/daily.md", data: "# from the snapshot\n" },
      { path: `./proj/ledger/${HOST}/open.jsonl`, data: `${ledgerLine("proj", 2)}\n` },
      { path: "./proj/runs/run-1/notes.md", data: "from the snapshot\n" },
      { path: "./proj/runs/run-2/", flag: "5" },
      { path: "./proj/runs/run-2/gate.jsonl", data: '{"ok":true}\n{"ok' },
      { path: "./proj/runs/run-2/out/log.txt", data: "log\n" },
      { path: "./gone/runs/run-3/notes.md", data: "x" },
    ]),
  );
  const report = await runRestore(options(at, name, { mode: "runs-only" }), deps());
  assert.equal(report.code, 0, report.error ?? "");
  assert.equal(report.restored, 1);
  assert.equal(report.skipped, 2);
  assert.equal(readFileSync(join(at.state, "proj/runs/run-1/notes.md"), "utf8"), "kept\n");
  assert.equal(readFileSync(join(at.state, "proj/runs/run-2/gate.jsonl"), "utf8"), '{"ok":true}\n');
  assert.equal(readFileSync(join(at.state, "proj/runs/run-2/out/log.txt"), "utf8"), "log\n");
  assert.deepEqual(report.trimmed, ["proj/runs/run-2/gate.jsonl"]);
  assert.equal(readFileSync(join(at.state, "proj/items/rituals/daily.md"), "utf8"), "# synced\n");
  assert.equal(existsSync(join(at.state, "proj/ledger")), false);
  assert.equal(existsSync(join(at.state, "gone")), false);
  assert.equal(existsSync(`${at.state}.restoring-${STAMP}`), false);
  const line = readLedger(openProject("_global")).find((entry) => entry.type === "store.restored");
  assert.equal(line?.mode, "runs-only");
  assert.equal(line?.restored, 1);
  assert.equal(line?.skipped, 2);
});

test("--runs-only refuses without a live store", async () => {
  const at = freshCase();
  const name = snapshot(at.snaps, storeArchive());
  const report = await runRestore(options(at, name, { mode: "runs-only", stateDir: join(at.root, "missing") }), deps());
  assert.equal(report.code, 1);
  assert.match(report.error ?? "", /no store/u);
});

// --- the command, end to end -------------------------------------------------------------------------

interface Ran {
  code: number;
  out: string;
  err: string;
}

function darius(argv: string[], env: NodeJS.ProcessEnv): Ran {
  const child = spawnSync(BIN, argv, { encoding: "utf8", input: "", env: { ...process.env, ...env }, cwd: tmpdir(), timeout: 30_000 });
  return { code: child.status ?? -1, out: child.stdout, err: child.stderr };
}

test("end to end: snapshot create, damage the store, restore --yes, and the store reads again", () => {
  const at = freshCase();
  const env = { DARIUS_STATE_DIR: at.state, DARIUS_SNAPSHOT_DIR: at.snaps, DARIUS_SYSTEMCTL: join(at.root, "no-systemctl") };
  assert.equal(darius(["ritual", "add", "heartbeat", "--title", "Heartbeat", "--cadence", "1d", "--project", "proj"], env).code, 0);
  const made = darius(["snapshot", "create", "--json"], env);
  assert.equal(made.code, 0, made.err);
  const name: string = JSON.parse(made.out).name;

  writeFileSync(join(at.state, "proj/items/rituals/heartbeat.md"), "---\nnot: [a ritual\n");
  assert.notEqual(darius(["ritual", "list", "--project", "proj"], env).code, 0);

  const refused = darius(["restore", name], env);
  assert.equal(refused.code, 1, refused.out);
  assert.match(refused.out, /--yes/u);

  const restored = darius(["restore", name, "--yes"], env);
  assert.equal(restored.code, 0, `${restored.out}\n${restored.err}`);
  assert.match(restored.out, /Next:/u);
  assert.match(restored.out, /darius sync --all-projects/u);
  const listed = darius(["ritual", "list", "--project", "proj"], env);
  assert.equal(listed.code, 0, listed.err);
  assert.match(listed.out, /heartbeat/u);
  assert.ok(readdirSync(at.root).some((entry) => entry.startsWith("state.before-restore-")));
});

test("the command asks systemctl through DARIUS_SYSTEMCTL and refuses while a unit is active", () => {
  const at = freshCase();
  const fake = join(at.root, "systemctl");
  writeFileSync(fake, '#!/bin/sh\nif [ "$3" = "darius-sync.timer" ]; then echo active; exit 0; fi\necho inactive\nexit 3\n');
  chmodSync(fake, 0o755);
  const name = snapshot(at.snaps, storeArchive());
  const env = { DARIUS_STATE_DIR: at.state, DARIUS_SNAPSHOT_DIR: at.snaps, DARIUS_SYSTEMCTL: fake };
  const ran = darius(["restore", name, "--yes", "--json"], env);
  assert.equal(ran.code, 1, ran.err);
  const report = JSON.parse(ran.out);
  assert.match(report.error, /active: darius-sync\.timer/u);
  assert.deepEqual(tree(at.state), []);
  assert.equal(darius(["restore"], env).code, 2);
});

test("archives of the system tar read in GNU and pax format, long names included", async () => {
  for (const format of ["gnu", "pax"]) {
    const at = freshCase();
    const source = join(at.root, "source");
    const long = `proj/runs/${"r".repeat(120)}/${"n".repeat(110)}.md`;
    put(source, long, "deep\n");
    put(source, "proj/items/rituals/a.md", "a\n");
    const archive = join(at.root, "made.tar.gz");
    const made = spawnSync("tar", [`--format=${format}`, "-czf", archive, "-C", source, "."]);
    assert.equal(made.status, 0, made.stderr.toString());
    const name = snapshot(at.snaps, readFileSync(archive));
    const report = await runRestore(options(at, name), deps());
    assert.equal(report.code, 0, `${format}: ${report.error ?? ""}`);
    assert.equal(readFileSync(join(at.state, long), "utf8"), "deep\n");
  }
});
