/**
 * The CLI routes of the snapshot feature that the web Backups page also has
 * (0.51.0): `snapshot config [set|unset]`, `snapshot credentials
 * [status|set|clear]`, `snapshot list --remote`, and the timer section of
 * `snapshot status`.
 *
 * SAFETY: the config dir, the state dir and the snapshot folder are `mkdtemp`
 * dirs. systemctl is an injected fake, so no test asks the real user manager;
 * the subprocess runs get a missing `DARIUS_SYSTEMCTL`. The bucket is the
 * in-process fake on a loopback port (test/helpers/fake-s3.ts).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { UsageError, type ParsedArgs } from "../src/cli/registry.ts";
import { runSnapshotCommand, type SnapshotDeps } from "../src/cli/snapshot.ts";
import { runSnapshot } from "../src/core/snapshot.ts";
import { clearSnapshotCredentials, readSnapshotFile, resolveSnapshotSettings, snapshotCredentialsPath, writeSnapshotCredentials, writeSnapshotFile } from "../src/core/snapshot-settings.ts";
import { startFakeS3, type FakeS3 } from "./helpers/fake-s3.ts";

const sandbox = mkdtempSync(join(tmpdir(), "darius-snapshot-config-test-"));
const configRoot = join(sandbox, "config");
const stateRoot = join(sandbox, "state");
process.env.DARIUS_CONFIG_DIR = configRoot;
process.env.DARIUS_STATE_DIR = stateRoot;
process.env.DARIUS_SNAPSHOT_DIR = join(sandbox, "snapshots");
mkdirSync(configRoot, { recursive: true });
mkdirSync(join(stateRoot, "proj"), { recursive: true });
writeFileSync(join(stateRoot, "proj", "note.md"), "hello\n");
const HOST_CONFIG = 'host = "host-a"\n';
writeFileSync(join(configRoot, "config.toml"), HOST_CONFIG);

const BIN = join(import.meta.dirname, "..", "bin", "darius");
const SECRET = "Very-Secret-Value-42";

interface Ran {
  code: number;
  out: string;
  err: string;
}

const noSystemd = (): string => {
  throw new Error("systemctl: not found");
};

function deps(overrides: Partial<SnapshotDeps> = {}): SnapshotDeps {
  return {
    systemctl: noSystemd,
    stdinIsTTY: () => false,
    readStdin: () => {
      throw new Error("stdin was not expected");
    },
    ...overrides,
  };
}

function args(positional: string[], flags: Record<string, string | boolean> = {}, stdin?: string): ParsedArgs {
  const parsed: ParsedArgs = { positional, flags, json: flags.json === true, repeated: {} };
  if (stdin !== undefined) parsed.stdin = stdin;
  return parsed;
}

/** Runs one verb in this process with console output captured. */
async function run(parsed: ParsedArgs, with_: SnapshotDeps = deps()): Promise<Ran> {
  const out: string[] = [];
  const err: string[] = [];
  const log = console.log;
  const error = console.error;
  console.log = (...items: unknown[]) => out.push(items.join(" "));
  console.error = (...items: unknown[]) => err.push(items.join(" "));
  try {
    return { code: await runSnapshotCommand(parsed, with_), out: out.join("\n"), err: err.join("\n") };
  } finally {
    console.log = log;
    console.error = error;
  }
}

/** Runs `darius <argv>` in a child, with the sandbox and no systemd. */
function darius(argv: string[], input: string, runtime: string, env: NodeJS.ProcessEnv = {}): Ran {
  const child = spawnSync(BIN, argv, {
    encoding: "utf8",
    input,
    env: { ...process.env, DARIUS_RUNTIME: runtime, DARIUS_SYSTEMCTL: join(sandbox, "no-systemctl"), ...env },
    cwd: tmpdir(),
    timeout: 20_000,
  });
  return { code: child.status ?? -1, out: child.stdout, err: child.stderr };
}

/** The message of the usage error `pending` must end in. */
async function usageMessage(pending: Promise<Ran>): Promise<string> {
  try {
    await pending;
  } catch (error) {
    if (error instanceof UsageError) return error.message;
    throw error;
  }
  return assert.fail("expected a usage error");
}

// --- config -----------------------------------------------------------------------------------

test("config shows every key with its value and source, as text and JSON", async () => {
  writeSnapshotFile(new Map([["keep", 5]]));
  writeFileSync(join(configRoot, "config.toml"), `${HOST_CONFIG}[snapshot]\nregion = "eu-west-1"\n`);
  try {
    const text = await run(args(["config"]));
    assert.equal(text.code, 0);
    assert.match(text.out, /^keep += 5 {2}\(file\)$/mu);
    assert.match(text.out, /^region += "eu-west-1" {2}\(config\)$/mu);
    assert.match(text.out, /^dir += ".*" {2}\(env DARIUS_SNAPSHOT_DIR\)$/mu);
    assert.match(text.out, /^sse += false {2}\(default\)$/mu);

    const json = await run(args(["config"], { json: true }));
    const parsed: { settings: Record<string, { value: unknown; source: string }>; problems: string[] } = JSON.parse(json.out);
    assert.deepEqual(parsed.settings.keep, { value: 5, source: "file" });
    assert.deepEqual(parsed.settings.region, { value: "eu-west-1", source: "config" });
    assert.equal(parsed.settings.enabled?.source, "default");
    assert.deepEqual(parsed.problems, []);
  } finally {
    writeSnapshotFile(new Map());
    writeFileSync(join(configRoot, "config.toml"), HOST_CONFIG);
  }
});

test("remote_prune: default true, every layer, the boolean words, a bad value refused, shown by config", async () => {
  const resolve = (env: NodeJS.ProcessEnv, file: Map<"remote_prune", boolean> = new Map(), config: Record<string, string | boolean> = {}) =>
    resolveSnapshotSettings({ env, file, config, stateDir: stateRoot, configDir: configRoot });
  assert.equal(resolve({}).settings.remotePrune, true);
  assert.equal(resolve({}).sources.get("remote_prune"), "default");
  assert.equal(resolve({}, new Map(), { remote_prune: false }).settings.remotePrune, false);
  assert.equal(resolve({}, new Map([["remote_prune", false]]), { remote_prune: true }).sources.get("remote_prune"), "file");
  for (const word of ["0", "false", "no", "off"]) assert.equal(resolve({ DARIUS_SNAPSHOT_REMOTE_PRUNE: word }, new Map([["remote_prune", true]])).settings.remotePrune, false, word);
  for (const word of ["1", "true", "yes", "on"]) assert.equal(resolve({ DARIUS_SNAPSHOT_REMOTE_PRUNE: word }).settings.remotePrune, true, word);
  const bad = resolve({ DARIUS_SNAPSHOT_REMOTE_PRUNE: "maybe" });
  assert.deepEqual(bad.problems, ["DARIUS_SNAPSHOT_REMOTE_PRUNE: remote_prune must be true or false"]);

  const refused = await run(args(["config", "set", "remote_prune", "sometimes"], { json: true }));
  assert.equal(refused.code, 1);
  assert.match(refused.out, /remote_prune must be true or false/u);
  const set = await run(args(["config", "set", "remote_prune", "off"], { json: true }));
  assert.equal(set.code, 0, set.out);
  assert.deepEqual(JSON.parse(set.out), { ok: true, key: "remote_prune", value: false, source: "file" });
  try {
    const shown = await run(args(["config"]));
    assert.match(shown.out, /^remote_prune = false {2}\(file\)$/mu);
  } finally {
    await run(args(["config", "unset", "remote_prune"]));
  }
  assert.equal(readSnapshotFile().has("remote_prune"), false);
});

test("config set and unset persist in snapshot.json and report the new value and source", async () => {
  const set = await run(args(["config", "set", "keep", "4"], { json: true }));
  assert.equal(set.code, 0);
  assert.deepEqual(JSON.parse(set.out), { ok: true, key: "keep", value: 4, source: "file" });
  assert.equal(readSnapshotFile().get("keep"), 4);
  assert.equal(resolveSnapshotSettings().sources.get("keep"), "file");

  const text = await run(args(["config", "set", "path_style", "off"]));
  assert.equal(text.code, 0);
  assert.match(text.out, /✓ path_style += false {2}\(file\)/u);

  const unset = await run(args(["config", "unset", "keep"], { json: true }));
  assert.equal(unset.code, 0);
  assert.deepEqual(JSON.parse(unset.out), { ok: true, key: "keep", value: 7, source: "default" });
  assert.equal(readSnapshotFile().has("keep"), false);
  await run(args(["config", "unset", "path_style"]));
  assert.equal(readSnapshotFile().size, 0);
});

test("a key the environment sets is refused with exit 1 and names the variable, also from snapshot.env", async () => {
  process.env.DARIUS_SNAPSHOT_KEEP = "3";
  try {
    const refused = await run(args(["config", "set", "keep", "9"], { json: true }));
    assert.equal(refused.code, 1);
    const parsed: { ok: boolean; key: string; error: string } = JSON.parse(refused.out);
    assert.equal(parsed.ok, false);
    assert.match(parsed.error, /DARIUS_SNAPSHOT_KEEP/u);
    assert.equal((await run(args(["config", "unset", "keep"]))).code, 1);
  } finally {
    delete process.env.DARIUS_SNAPSHOT_KEEP;
  }
  writeFileSync(join(configRoot, "snapshot.env"), '# units only\nexport DARIUS_SNAPSHOT_REGION="eu-central-1"\n');
  try {
    const fromFile = await run(args(["config", "set", "region", "us-west-2"]));
    assert.equal(fromFile.code, 1);
    assert.match(fromFile.out, /DARIUS_SNAPSHOT_REGION/u);
    assert.match(fromFile.out, /snapshot\.env/u);
    const shown = await run(args(["config"], { json: true }));
    assert.deepEqual(JSON.parse(shown.out).settings.region, { value: "eu-central-1", source: "env" });
  } finally {
    rmSync(join(configRoot, "snapshot.env"), { force: true });
  }
  assert.equal(readSnapshotFile().size, 0);
});

test("keep_monthly is 0 (off) by default and takes 0 to 120 in every layer", async () => {
  assert.deepEqual(resolveSnapshotSettings({ env: {}, config: {}, file: new Map() }).settings.keepMonthly, 0);
  assert.equal(resolveSnapshotSettings({ env: { DARIUS_SNAPSHOT_KEEP_MONTHLY: "12" }, config: {}, file: new Map() }).settings.keepMonthly, 12);
  assert.equal(resolveSnapshotSettings({ env: {}, config: { keep_monthly: 3 }, file: new Map() }).settings.keepMonthly, 3);
  assert.equal(resolveSnapshotSettings({ env: {}, config: { keep_monthly: 3 }, file: new Map([["keep_monthly", 0]]) }).settings.keepMonthly, 0);
  const high = resolveSnapshotSettings({ env: { DARIUS_SNAPSHOT_KEEP_MONTHLY: "121" }, config: {}, file: new Map() });
  assert.equal(high.settings.keepMonthly, 0, "the invalid layer is skipped");
  assert.match(high.problems.join("; "), /keep_monthly must be a whole number from 0 to 120/u);

  const bad = await run(args(["config", "set", "keep_monthly", "121"]));
  assert.equal(bad.code, 1);
  assert.equal(bad.out, "! keep_monthly must be a whole number from 0 to 120");
  assert.equal((await run(args(["config", "set", "keep_monthly", "-1"]))).code, 1);
  const set = await run(args(["config", "set", "keep_monthly", "0"], { json: true }));
  assert.deepEqual(JSON.parse(set.out), { ok: true, key: "keep_monthly", value: 0, source: "file" });
  const ok = await run(args(["config", "set", "keep_monthly", "12"], { json: true }));
  assert.deepEqual(JSON.parse(ok.out), { ok: true, key: "keep_monthly", value: 12, source: "file" });
  await run(args(["config", "unset", "keep_monthly"]));
  assert.equal(readSnapshotFile().has("keep_monthly"), false);
});

test("an unknown key is a usage error that lists the keys; a bad value exits 1 with the page's text", async () => {
  assert.match(await usageMessage(run(args(["config", "set", "colour", "red"]))), /unknown key "colour"; keys: enabled, dir, keep/u);
  assert.match(await usageMessage(run(args(["config", "unset", "keep", "colour"]))), /unknown key "colour"/u);
  await assert.rejects(run(args(["config", "set", "keep"])), UsageError);
  await assert.rejects(run(args(["config", "unset"])), UsageError);
  await assert.rejects(run(args(["config", "frob"])), UsageError);

  const bad = await run(args(["config", "set", "keep", "0"]));
  assert.equal(bad.code, 1);
  assert.equal(bad.out, "! keep must be a whole number from 1 to 3650");
  const prefix = await run(args(["config", "set", "prefix", "../up"], { json: true }));
  assert.equal(prefix.code, 1);
  assert.match(JSON.parse(prefix.out).error, /prefix may hold/u);
  const envDir = process.env.DARIUS_SNAPSHOT_DIR;
  delete process.env.DARIUS_SNAPSHOT_DIR;
  try {
    const inside = await run(args(["config", "set", "dir", join(stateRoot, "snaps")]));
    assert.equal(inside.code, 1);
    assert.match(inside.out, /overlaps the store/u);
  } finally {
    process.env.DARIUS_SNAPSHOT_DIR = envDir;
  }
  const http = await run(args(["config", "set", "endpoint", "http://example.com", "bucket", "bucket-1"]));
  assert.equal(http.code, 1, "plain http to a public host is refused, as on the page");
  assert.equal(readSnapshotFile().size, 0);
});

test("endpoint and bucket go together: one alone is refused with the fix, both in one call are saved", async () => {
  const half = await run(args(["config", "set", "endpoint", "https://s3.example.test"]));
  assert.equal(half.code, 1);
  assert.match(half.out, /needs both an endpoint and a bucket; set both in one call: darius snapshot config set endpoint <url> bucket <name>/u);
  const both = await run(args(["config", "set", "endpoint", "https://s3.example.test", "bucket", "bucket-1"], { json: true }));
  assert.equal(both.code, 0, both.out);
  assert.deepEqual(JSON.parse(both.out), {
    ok: true,
    changed: [
      { key: "endpoint", value: "https://s3.example.test", source: "file" },
      { key: "bucket", value: "bucket-1", source: "file" },
    ],
  });
  assert.equal(resolveSnapshotSettings().settings.remote?.bucket, "bucket-1");
  assert.equal((await run(args(["config", "unset", "bucket"]))).code, 1, "a half-cleared bucket is refused too");
  const cleared = await run(args(["config", "unset", "endpoint", "bucket"]));
  assert.equal(cleared.code, 0);
  assert.equal(readSnapshotFile().size, 0);
});

// --- credentials ---------------------------------------------------------------------------------

test("credentials set reads the secret from stdin, stores the pair at 0600, and never prints the secret", async () => {
  clearSnapshotCredentials();
  const outputs: string[] = [];
  for (const json of [false, true]) {
    const ran = await run(args(["credentials", "set"], { "key-id": "AKIAEXAMPLE", json }), deps({ readStdin: () => `${SECRET}\n` }));
    assert.equal(ran.code, 0, ran.out);
    outputs.push(ran.out, ran.err);
  }
  assert.equal(statSync(snapshotCredentialsPath()).mode & 0o777, 0o600);
  const file = readFileSync(snapshotCredentialsPath(), "utf8");
  assert.match(file, new RegExp(`aws_secret_access_key = ${SECRET}\n`, "u"), "one trailing newline is trimmed");

  const status = await run(args(["credentials"]));
  const statusJson = await run(args(["credentials", "status"], { json: true }));
  outputs.push(status.out, status.err, statusJson.out);
  assert.match(status.out, /key id AKIAEXAMPLE/u);
  assert.deepEqual(JSON.parse(statusJson.out), { source: "file", stored: true, keyId: "AKIAEXAMPLE", file: snapshotCredentialsPath(), error: null });
  for (const text of outputs) assert.doesNotMatch(text, new RegExp(SECRET, "u"));
});

test("credentials set refuses a terminal, a secret in argv or a flag, and a missing key id, all with exit 2", async () => {
  const tty = deps({ stdinIsTTY: () => true });
  assert.match(await usageMessage(run(args(["credentials", "set"], { "key-id": "AKIA" }), tty)), /not a terminal: printf %s "\$SECRET" \| darius snapshot credentials set --key-id ID/u);
  assert.doesNotMatch(await usageMessage(run(args(["credentials", "set", SECRET], { "key-id": "AKIA" }))), new RegExp(SECRET, "u"));
  assert.doesNotMatch(await usageMessage(run(args(["credentials", "set"], { "key-id": "AKIA", secret: SECRET }))), new RegExp(SECRET, "u"));
  await assert.rejects(run(args(["credentials", "set"], {}, SECRET)), UsageError);
  const empty = await run(args(["credentials", "set"], { "key-id": "AKIA" }, "\n"));
  assert.equal(empty.code, 1);
  assert.match(empty.out, /both the access key id and the secret key are needed/u);
});

test("credentials clear removes the pair; the environment's pair refuses set and clear and names the variables", async () => {
  writeSnapshotCredentials("AKIAEXAMPLE", SECRET);
  process.env.DARIUS_SNAPSHOT_ACCESS_KEY_ID = "AKIAFROMENV";
  process.env.DARIUS_SNAPSHOT_SECRET_ACCESS_KEY = "env-secret";
  try {
    const set = await run(args(["credentials", "set"], { "key-id": "AKIA", json: true }, SECRET));
    assert.equal(set.code, 1);
    assert.equal(JSON.parse(set.out).error, "the key pair is set by DARIUS_SNAPSHOT_ACCESS_KEY_ID and DARIUS_SNAPSHOT_SECRET_ACCESS_KEY; change it where the service starts", "the page's message");
    const clear = await run(args(["credentials", "clear"]));
    assert.equal(clear.code, 1);
    assert.match(clear.out, /DARIUS_SNAPSHOT_ACCESS_KEY_ID/u);
    const status = await run(args(["credentials"]));
    assert.match(status.out, /key pair from the environment .*key id AKIAFROMENV/u);
    assert.match(status.out, /is not used while the environment sets one/u);
    assert.doesNotMatch(status.out, /env-secret/u);
    assert.match(readFileSync(snapshotCredentialsPath(), "utf8"), /AKIAEXAMPLE/u, "a refused clear keeps the file");
  } finally {
    delete process.env.DARIUS_SNAPSHOT_ACCESS_KEY_ID;
    delete process.env.DARIUS_SNAPSHOT_SECRET_ACCESS_KEY;
  }
  const cleared = await run(args(["credentials", "clear"], { json: true }));
  assert.deepEqual(JSON.parse(cleared.out), { ok: true, removed: true });
  const again = await run(args(["credentials", "clear"]));
  assert.equal(again.out, "· no saved key pair");
  const none = await run(args(["credentials"], { json: true }));
  assert.deepEqual(JSON.parse(none.out), { source: "none", stored: false, keyId: null, file: snapshotCredentialsPath(), error: null });
});

test("the real CLI takes the secret from a pipe under both runtimes and prints it nowhere", () => {
  for (const runtime of ["node", "bun"]) {
    clearSnapshotCredentials();
    for (const argv of [
      ["snapshot", "credentials", "set", "--key-id", "AKIAPIPE"],
      ["snapshot", "credentials", "set", "--key-id", "AKIAPIPE", "--json"],
    ]) {
      const ran = darius(argv, `${SECRET}\n`, runtime);
      assert.equal(ran.code, 0, `${runtime}: ${ran.err}`);
      assert.doesNotMatch(ran.out + ran.err, new RegExp(SECRET, "u"));
    }
    assert.equal(statSync(snapshotCredentialsPath()).mode & 0o777, 0o600);
    assert.match(readFileSync(snapshotCredentialsPath(), "utf8"), /aws_access_key_id = AKIAPIPE\n/u);
    const status = darius(["snapshot", "credentials", "--json"], "", runtime);
    assert.equal(status.code, 0);
    assert.equal(JSON.parse(status.out).keyId, "AKIAPIPE");
    assert.doesNotMatch(status.out + status.err, new RegExp(SECRET, "u"));
  }
  clearSnapshotCredentials();
});

// --- the timer in status ----------------------------------------------------------------------------

function systemctlSaying(text: string, seen: string[][] = []): SnapshotDeps["systemctl"] {
  return (argv) => {
    seen.push(argv);
    return text;
  };
}

test("status shows an installed timer with its next run, and the same facts in --json", async () => {
  const seen: string[][] = [];
  const fake = deps({
    systemctl: systemctlSaying("LoadState=loaded\nActiveState=active\nUnitFileState=enabled\nNextElapseUSecRealtime=Fri 2026-10-02 04:05:32 CEST\n", seen),
  });
  const text = await run(args(["status"]), fake);
  assert.equal(text.code, 0);
  assert.match(text.out, /^· timer: enabled, active, next run Fri 2026-10-02 04:05:32 CEST$/mu);
  assert.deepEqual(seen[0]?.slice(0, 2), ["show", "darius-snapshot.timer"]);
  const json = await run(args(["status"], { json: true }), fake);
  assert.deepEqual(JSON.parse(json.out).timer, { known: true, installed: true, enabled: true, active: true, next: "Fri 2026-10-02 04:05:32 CEST", hint: null });

  const stopped = await run(args(["status"]), deps({ systemctl: systemctlSaying("LoadState=loaded\nActiveState=inactive\nUnitFileState=disabled\nNextElapseUSecRealtime=\n") }));
  assert.match(stopped.out, /· timer: disabled, inactive; start it: systemctl --user enable --now darius-snapshot.timer/u);
});

test("a missing timer names the setup command, or the [setup] units entry when the key leaves it out", async () => {
  const missing = deps({ systemctl: systemctlSaying("LoadState=not-found\nActiveState=inactive\nUnitFileState=\nNextElapseUSecRealtime=\n") });
  const text = await run(args(["status"]), missing);
  assert.equal(text.code, 0);
  assert.match(text.out, /^· timer: not installed; run darius setup --systemd to install it$/mu);
  const json = await run(args(["status"], { json: true }), missing);
  assert.deepEqual(JSON.parse(json.out).timer, { known: true, installed: false, enabled: false, active: false, next: null, hint: "run darius setup --systemd to install it" });

  writeFileSync(join(configRoot, "config.toml"), `${HOST_CONFIG}[setup]\nunits = ["sync"]\n`);
  try {
    const listed = await run(args(["status"]), missing);
    assert.match(listed.out, /· timer: not installed; add "snapshot" to \[setup\] units in config.toml, then run darius setup --systemd/u);
  } finally {
    writeFileSync(join(configRoot, "config.toml"), HOST_CONFIG);
  }
});

test("no systemd user session prints one line and never changes the exit code", async () => {
  const text = await run(args(["status"]));
  assert.equal(text.code, 0);
  assert.match(text.out, /^· timer: unknown \(no systemd user session\)$/mu);
  const json = await run(args(["status"], { json: true }));
  assert.equal(json.code, 0);
  assert.deepEqual(JSON.parse(json.out).timer, { known: false, installed: null, enabled: null, active: null, next: null, hint: null });
  const garbage = await run(args(["status"]), deps({ systemctl: systemctlSaying("") }));
  assert.match(garbage.out, /timer: unknown/u);
});

// --- list --remote --------------------------------------------------------------------------------------

function useBucket(fake: FakeS3): () => void {
  const env = {
    DARIUS_SNAPSHOT_ENDPOINT: fake.endpoint,
    DARIUS_SNAPSHOT_BUCKET: fake.bucket,
    DARIUS_SNAPSHOT_ALLOW_HTTP: "true",
  };
  Object.assign(process.env, env);
  writeSnapshotCredentials("test-access", "test-secret");
  return () => {
    for (const name of Object.keys(env)) delete process.env[name];
    clearSnapshotCredentials();
  };
}

test("list --remote shows the bucket's snapshots newest first and marks the ones that are also here", async () => {
  const fake = await startFakeS3();
  const restore = useBucket(fake);
  try {
    const made = await runSnapshot({ resolved: resolveSnapshotSettings(), host: "host-a", version: "9.9.9", stateDir: stateRoot, now: new Date(Date.UTC(2026, 9, 1, 4)) });
    assert.equal(made.code, 0, made.error ?? "");
    fake.objects.set("darius/host-a/darius-host-a-20260101T000000Z.tar.gz", Buffer.alloc(2048));
    fake.objects.set("darius/host-b/darius-host-b-20261001T050000Z.tar.gz", Buffer.from("other host"));

    const json = await run(args(["list"], { remote: true, json: true }));
    assert.equal(json.code, 0, json.out);
    const parsed: { ok: boolean; local: { name: string; remote: boolean }[]; remote: { name: string; bytes: number; local: boolean }[] } = JSON.parse(json.out);
    assert.equal(parsed.ok, true);
    assert.deepEqual(
      parsed.remote.map((row) => [row.name, row.local]),
      [
        [made.name, true],
        ["darius-host-a-20260101T000000Z.tar.gz", false],
      ],
    );
    assert.equal(parsed.remote[1]?.bytes, 2048);
    assert.equal(parsed.local[0]?.name, made.name);
    assert.equal(parsed.local[0]?.remote, true);

    const text = await run(args(["list"], { remote: true }));
    assert.match(text.out, /also here\n.*bucket only$/u);

    const plain = await run(args(["list"], { json: true }));
    assert.deepEqual(Object.keys(JSON.parse(plain.out)), ["snapshots"], "plain list stays local only");
  } finally {
    restore();
    await fake.stop();
  }
});

test("list --remote exits 1 without a bucket and 3 when the bucket cannot be reached", async () => {
  const none = await run(args(["list"], { remote: true }));
  assert.equal(none.code, 1);
  assert.match(none.out, /no bucket is set up/u);

  const fake = await startFakeS3();
  const restore = useBucket(fake);
  await fake.stop();
  try {
    const offline = await run(args(["list"], { remote: true, json: true }));
    assert.equal(offline.code, 3);
    const parsed: { ok: boolean; remote: unknown[]; local: unknown[] } = JSON.parse(offline.out);
    assert.equal(parsed.ok, false);
    assert.deepEqual(parsed.remote, []);
    assert.ok(Array.isArray(parsed.local));
  } finally {
    restore();
  }
});

// --- ping_url ---------------------------------------------------------------------------------------

const PING = "https://hc.example.com/ping-secret-uuid-1234";
const PING_MASK = "https://hc.example.com/...";

test("ping_url is saved whole, shown masked everywhere, and never printed in full", async () => {
  const outputs: string[] = [];
  const set = await run(args(["config", "set", "ping_url", PING]));
  assert.equal(set.code, 0, set.out);
  assert.equal(set.out, `✓ ping_url     = "${PING_MASK}"  (file)`);
  outputs.push(set.out, set.err);
  try {
    assert.equal(readSnapshotFile().get("ping_url"), PING, "the file holds the whole address");
    assert.equal(resolveSnapshotSettings().settings.pingUrl, PING);

    const json = await run(args(["config", "set", "ping_url", `${PING}2`], { json: true }));
    assert.deepEqual(JSON.parse(json.out), { ok: true, key: "ping_url", value: PING_MASK, source: "file" });
    outputs.push(json.out);
    await run(args(["config", "set", "ping_url", PING]));

    const text = await run(args(["config"]));
    assert.match(text.out, new RegExp(`^ping_url += "${PING_MASK.replaceAll(".", "\\.")}" {2}\\(file\\)$`, "mu"));
    const asJson = await run(args(["config"], { json: true }));
    assert.deepEqual(JSON.parse(asJson.out).settings.ping_url, { value: PING_MASK, source: "file" });
    const status = await run(args(["status"], { json: true }));
    assert.deepEqual(JSON.parse(status.out).settings.ping_url, { value: PING_MASK, source: "file" });
    const statusText = await run(args(["status"]));
    assert.match(statusText.out, new RegExp(`^· dead-man ping: ${PING_MASK.replaceAll(".", "\\.")}$`, "mu"));
    outputs.push(text.out, asJson.out, status.out, statusText.out, text.err, statusText.err);
  } finally {
    await run(args(["config", "unset", "ping_url"]));
  }
  for (const out of outputs) {
    assert.equal(out.includes("ping-secret"), false, out);
    assert.equal(out.includes(PING), false, out);
  }
  assert.equal(readSnapshotFile().has("ping_url"), false);
  const empty = await run(args(["config"], { json: true }));
  assert.deepEqual(JSON.parse(empty.out).settings.ping_url, { value: "", source: "default" });
});

test("ping_url refusals name the problem and not the address", async () => {
  const cases: Array<[string, RegExp]> = [
    ["http://hc.example.com/ping-secret-uuid-1234", /plain http/u],
    ["ftp://hc.example.com/ping-secret-uuid-1234", /must start with https/u],
    ["https://hc.example.com/ping-secret-uuid-1234?x=1", /plain address/u],
    ["https://user@hc.example.com/ping-secret-uuid-1234", /plain address/u],
    [PING_MASK, /masked form/u],
    ["not a url", /not a valid URL/u],
  ];
  for (const [value, pattern] of cases) {
    const refused = await run(args(["config", "set", "ping_url", value], { json: true }));
    assert.equal(refused.code, 1, value);
    assert.match(JSON.parse(refused.out).error, pattern);
    assert.equal(refused.out.includes("ping-secret"), false, refused.out);
    assert.equal(refused.out.includes("hc.example.com"), false, refused.out);
  }
  assert.equal(readSnapshotFile().size, 0);
  const lanHttp = await run(args(["config", "set", "ping_url", "http://127.0.0.1:8080/abc", "allow_http", "true"]));
  assert.equal(lanHttp.code, 0, lanHttp.out);
  await run(args(["config", "unset", "ping_url", "allow_http"]));
  assert.equal(readSnapshotFile().size, 0);
});

test("a ping_url the environment sets is refused with the variable's name, and shows masked from the environment", async () => {
  process.env.DARIUS_SNAPSHOT_PING_URL = PING;
  try {
    const refused = await run(args(["config", "set", "ping_url", "https://other.example.com/x"]));
    assert.equal(refused.code, 1);
    assert.match(refused.out, /DARIUS_SNAPSHOT_PING_URL/u);
    const shown = await run(args(["config"]));
    assert.match(shown.out, /^ping_url += "https:\/\/hc\.example\.com\/\.\.\." {2}\(env DARIUS_SNAPSHOT_PING_URL\)$/mu);
    assert.equal(shown.out.includes("ping-secret"), false);
  } finally {
    delete process.env.DARIUS_SNAPSHOT_PING_URL;
  }
});

test("the page gets the masked ping address; config push never sends it", async () => {
  const { collectBackups } = await import("../src/web/backups.ts");
  const { buildPushDocument, pushedKeys } = await import("../src/core/snapshot-push.ts");
  await run(args(["config", "set", "ping_url", PING, "endpoint", "https://s3.example.test", "bucket", "bucket-1"]));
  try {
    const page = collectBackups();
    assert.deepEqual(page.settings.pingUrl, { value: PING_MASK, source: "file" });
    assert.equal(JSON.stringify(page).includes("ping-secret"), false, "no part of the page data holds the address");
    assert.equal(pushedKeys().some((key) => key === "ping_url"), false);
    const built = buildPushDocument(resolveSnapshotSettings(), { accessKeyId: "id", secretAccessKey: "secret" }, "host-a", false);
    assert.equal(built.ok, true);
    assert.equal(built.ok && "ping_url" in built.document.settings, false);
    assert.equal(JSON.stringify(built).includes("ping-secret"), false);
  } finally {
    await run(args(["config", "unset", "ping_url", "endpoint", "bucket"]));
  }
});
