/**
 * `darius snapshot config push --hosts` and `snapshot config receive`
 * (src/cli/snapshot-push.ts, src/core/snapshot-push.ts).
 *
 * SAFETY: no real host and no real ssh. `DARIUS_SSH` is never read here: the
 * push gets a fake ssh program in its deps. The fake records its argv and
 * its stdin, then runs the command in a local bash, with the host's own
 * config dir under the sandbox. The host's darius is a wrapper in a fake app
 * dir that records its own argv and environment, then runs this checkout's
 * bin/darius. Every config dir, state dir and HOME is a mkdtemp dir.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { UsageError, type ParsedArgs } from "../src/cli/registry.ts";
import { runSnapshotCommand, type SnapshotDeps } from "../src/cli/snapshot.ts";
import { configPushLines, isThisHost, redact, REMOTE_RECEIVE_SCRIPT, runConfigPush, type ConfigPushDeps } from "../src/cli/snapshot-push.ts";
import { parsePushDocument, pushedKeys } from "../src/core/snapshot-push.ts";
import { readSnapshotFile, SNAPSHOT_KEYS, writeSnapshotCredentials, writeSnapshotFile } from "../src/core/snapshot-settings.ts";

const sandbox = mkdtempSync(join(tmpdir(), "darius-snapshot-push-test-"));
const senderConfig = join(sandbox, "sender-config");
process.env.HOME = join(sandbox, "home");
process.env.DARIUS_CONFIG_DIR = senderConfig;
process.env.DARIUS_STATE_DIR = join(sandbox, "sender-state");
for (const name of Object.keys(process.env)) {
  if (name.startsWith("DARIUS_SNAPSHOT_")) delete process.env[name];
}
mkdirSync(senderConfig, { recursive: true });
mkdirSync(process.env.HOME, { recursive: true });
writeFileSync(join(senderConfig, "config.toml"), 'host = "host-a"\n');

const REPO_BIN = join(import.meta.dirname, "..", "bin", "darius");
const SECRET = "Very-Secret-Value-42/xyz";
const KEY_ID = "AKIAEXAMPLEPUSH";
const BASH =
  (process.env.PATH ?? "")
    .split(":")
    .map((dir) => join(dir, "bash"))
    .find((candidate) => candidate.startsWith("/") && existsSync(candidate)) ?? "/bin/bash";

/** The sender's settings: a bucket and a few values that differ from the defaults. */
function senderSettings(): void {
  writeSnapshotFile(
    new Map<(typeof SNAPSHOT_KEYS)[number], string | number | boolean>([
      ["endpoint", "https://s3.example.com"],
      ["bucket", "team-backups"],
      ["region", "eu-central-1"],
      ["keep_remote", 45],
      ["keep", 9],
      ["enabled", false],
    ]),
  );
  writeSnapshotCredentials(KEY_ID, SECRET);
}
senderSettings();

// --- the fake mesh ------------------------------------------------------------------------------

interface Mesh {
  root: string;
  deps: ConfigPushDeps;
  /** Every argv the fake ssh got, one array per call. */
  calls(): string[][];
  /** The stdin the fake ssh got for `host`. */
  stdin(host: string): string;
  /** The argv lines and environment the host's darius got. */
  remoteSeen(host: string): string;
  configOf(host: string): string;
}

/**
 * Hosts: `down*` cannot be reached (exit 255); `old*` has a darius without
 * the receive verb (usage, exit 2); `locked*` sets DARIUS_SNAPSHOT_REGION in
 * its environment; `alias*` has the sender's host id. Any other host is fresh.
 */
function mesh(): Mesh {
  const root = mkdtempSync(join(sandbox, "mesh-"));
  const app = join(root, "app");
  mkdirSync(join(app, "current", "bin"), { recursive: true });
  const wrapper = join(app, "current", "bin", "darius");
  writeFileSync(
    wrapper,
    `#!${BASH}
seen="${root}/seen-$FAKE_HOST"
printf 'argv:%s\\n' "$@" >> "$seen"
env >> "$seen"
exec "${REPO_BIN}" "$@"
`,
  );
  chmodSync(wrapper, 0o755);
  const program = join(root, "ssh");
  writeFileSync(
    program,
    `#!${BASH}
# ssh -o X -o Y <host> <command...>
set -u
{ printf '%s\\x1f' "$@"; printf '\\n'; } >> "${root}/argv.log"
while [ "\${1:-}" = "-o" ]; do shift 2; done
host="$1"; shift
cat > "${root}/stdin-$host"
case "$host" in slow*) exec sleep 30 ;; esac
case "$host" in down*) echo "ssh: connect to host $host port 22: Connection refused" >&2; exit 255 ;; esac
case "$host" in old*) echo "darius: snapshot config takes no verb, set, or unset" >&2; exit 2 ;; esac
for name in $(env | sed -n 's/^\\(DARIUS_SNAPSHOT_[A-Z_]*\\)=.*/\\1/p'); do unset "$name"; done
case "$host" in locked*) export DARIUS_SNAPSHOT_REGION=ap-south-9 ;; esac
export HOME="${root}/$host"
export DARIUS_CONFIG_DIR="${root}/$host/config"
export DARIUS_STATE_DIR="${root}/$host/state"
export DARIUS_APP_DIR="${app}"
export FAKE_HOST="$host"
mkdir -p "$DARIUS_CONFIG_DIR" "$DARIUS_STATE_DIR"
[ -f "$DARIUS_CONFIG_DIR/config.toml" ] || case "$host" in
  alias*) echo 'host = "host-a"' > "$DARIUS_CONFIG_DIR/config.toml" ;;
  *) echo "host = \\"$host\\"" > "$DARIUS_CONFIG_DIR/config.toml" ;;
esac
command="$*"
# A login shell would read this machine's profile; the fake host has none.
command="\${command/bash -l -s/bash -s}"
# A pipe, as from sshd: bash must read its script line by line.
cat "${root}/stdin-$host" | "${BASH}" -c "$command"
`,
  );
  chmodSync(program, 0o755);
  return {
    root,
    deps: { ssh: program, hostId: "host-a", hostname: "host-a.example.com", timeoutMs: 60_000 },
    calls: () =>
      read(join(root, "argv.log"))
        .split("\n")
        .filter((line) => line !== "")
        .map((line) => line.split("\x1f").filter((word) => word !== "")),
    stdin: (host) => read(join(root, `stdin-${host}`)),
    remoteSeen: (host) => read(join(root, `seen-${host}`)),
    configOf: (host) => join(root, host, "config"),
  };
}

function read(path: string): string {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

/** Every file under `dir`, as text, for a secret scan. */
function filesUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .map((name) => join(dir, name))
    .filter((path) => statSync(path).isFile());
}

interface Captured<T> {
  value: T;
  out: string;
}

function capture<T>(work: () => T): Captured<T> {
  const lines: string[] = [];
  const log = console.log;
  const error = console.error;
  console.log = (...items: unknown[]) => lines.push(items.join(" "));
  console.error = (...items: unknown[]) => lines.push(items.join(" "));
  try {
    return { value: work(), out: lines.join("\n") };
  } finally {
    console.log = log;
    console.error = error;
  }
}

function noSecretIn(text: string, where: string): void {
  assert.ok(!text.includes(SECRET), `the secret is in ${where}`);
}

function args(positional: string[], flags: Record<string, string | boolean> = {}): ParsedArgs {
  return { positional, flags, json: flags.json === true, repeated: {} };
}

// --- push ----------------------------------------------------------------------------------------

test("push gives two fresh hosts the settings and the key pair; the secret travels on stdin only", () => {
  const net = mesh();
  const pushed = capture(() => runConfigPush(["host-b", "host-c"], false, net.deps, (done) => console.log(configPushLines(done).join("\n"))));
  assert.equal(pushed.value.code, 0, pushed.out);
  assert.deepEqual(
    pushed.value.hosts.map((done) => [done.host, done.outcome, done.credentials]),
    [
      ["host-b", "applied", "created"],
      ["host-c", "applied", "created"],
    ],
  );
  assert.match(pushed.out, /^✓ host-b: 5 settings changed, key pair saved$/mu);
  assert.match(pushed.out, /^ {4}bucket: "" -> "team-backups"$/mu);

  for (const host of ["host-b", "host-c"]) {
    const config = net.configOf(host);
    const saved = JSON.parse(readFileSync(join(config, "snapshot.json"), "utf8"));
    const expected = Object.fromEntries(pushedKeys().map((key) => [key, saved.values[key]]));
    assert.equal(saved.values.bucket, "team-backups");
    assert.equal(saved.values.endpoint, "https://s3.example.com");
    assert.equal(saved.values.keep_remote, 45);
    assert.deepEqual(Object.keys(saved.values).toSorted(), Object.keys(expected).toSorted(), "every pushed key, nothing else");
    assert.equal(saved.values.dir, undefined, "dir is host-local");
    assert.equal(saved.values.enabled, undefined, "enabled is host-local");
    assert.equal(saved.values.keep, 9, "keep travels");

    const credentials = join(config, "snapshot-credentials");
    assert.equal(statSync(credentials).mode & 0o777, 0o600);
    assert.match(readFileSync(credentials, "utf8"), new RegExp(`aws_access_key_id = ${KEY_ID}\\naws_secret_access_key = ${SECRET.replace("/", "\\/")}\\n`, "u"));
    assert.deepEqual(
      readdirSync(config).toSorted(),
      ["config.toml", "snapshot-credentials", "snapshot.json"],
      "no temp file left behind",
    );

    // stdin: the script line, then the whole document, which the host's darius read in full.
    const stdin = net.stdin(host);
    assert.ok(stdin.startsWith(REMOTE_RECEIVE_SCRIPT), "the script comes first");
    const sent = parsePushDocument(stdin.slice(REMOTE_RECEIVE_SCRIPT.length).trim());
    assert.ok(sent.ok);
    assert.equal(sent.document.secret, SECRET);
    assert.equal(sent.document.origin, "host-a");

    // The host's darius: its argv and its environment never hold the secret.
    const seen = net.remoteSeen(host);
    assert.match(seen, /^argv:snapshot$/mu);
    assert.match(seen, /^argv:receive$/mu);
    noSecretIn(seen, `the argv or environment of the darius on ${host}`);
  }

  // The ssh argv never holds the secret, nor the key id.
  const calls = net.calls();
  assert.deepEqual(calls, [
    ["-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "host-b", "bash", "-l", "-s", "--"],
    ["-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "host-c", "bash", "-l", "-s", "--"],
  ]);
  noSecretIn(JSON.stringify(calls), "the ssh argv");
  noSecretIn(pushed.out, "the push output");
  noSecretIn(JSON.stringify(pushed.value), "the push result");
});

test("push through the CLI: --json output, an unreachable host gives exit 3 and does not stop the next", async () => {
  const net = mesh();
  const deps: SnapshotDeps = { systemctl: () => "", stdinIsTTY: () => false, readStdin: () => "" };
  const before = process.env.DARIUS_SSH;
  process.env.DARIUS_SSH = net.deps.ssh;
  try {
    const ran = await (async () => {
      const lines: string[] = [];
      const log = console.log;
      console.log = (...items: unknown[]) => lines.push(items.join(" "));
      try {
        return { code: await runSnapshotCommand(args(["config", "push"], { hosts: "down-x,host-d", json: true }), deps), out: lines.join("\n") };
      } finally {
        console.log = log;
      }
    })();
    assert.equal(ran.code, 3);
    const parsed = JSON.parse(ran.out);
    assert.equal(parsed.ok, false);
    assert.deepEqual(
      parsed.hosts.map((done: { host: string; outcome: string }) => [done.host, done.outcome]),
      [
        ["down-x", "unreachable"],
        ["host-d", "applied"],
      ],
    );
    noSecretIn(ran.out, "the --json output");
    noSecretIn(JSON.stringify(net.calls()), "the ssh argv");
  } finally {
    if (before === undefined) delete process.env.DARIUS_SSH;
    else process.env.DARIUS_SSH = before;
  }
});

test("a call that hits the timeout is its own outcome, state unknown, exit 1; only a real connection failure is exit 3", () => {
  const net = mesh();
  const pushed = capture(() => runConfigPush(["slow-x", "down-y"], false, { ...net.deps, timeoutMs: 500 }, (done) => console.log(configPushLines(done).join("\n"))));
  assert.deepEqual(
    pushed.value.hosts.map((done) => [done.host, done.outcome]),
    [
      ["slow-x", "timed-out"],
      ["down-y", "unreachable"],
    ],
  );
  assert.equal(pushed.value.code, 1);
  assert.match(pushed.out, /^! slow-x: timed out, state unknown: run darius snapshot config on slow-x$/mu);
  noSecretIn(pushed.out, "the output");
});

test("push shows the changes and writes nothing when a host has other values, until --overwrite", () => {
  const net = mesh();
  const config = net.configOf("host-e");
  mkdirSync(config, { recursive: true });
  writeFileSync(join(config, "config.toml"), 'host = "host-e"\n');
  const oldFile = `${JSON.stringify({ v: 1, values: { endpoint: "https://old.example.com", bucket: "old-bucket", dir: "/srv/snaps" } }, null, 2)}\n`;
  const oldKeys = "[default]\naws_access_key_id = AKIAOLDKEY\naws_secret_access_key = old-secret\n";
  writeFileSync(join(config, "snapshot.json"), oldFile, { mode: 0o600 });
  writeFileSync(join(config, "snapshot-credentials"), oldKeys, { mode: 0o600 });

  const refused = capture(() => runConfigPush(["host-e"], false, net.deps, (done) => console.log(configPushLines(done).join("\n"))));
  assert.equal(refused.value.code, 1);
  const report = refused.value.hosts[0];
  assert.equal(report?.outcome, "refused");
  assert.equal(report?.needsOverwrite, true);
  assert.equal(report?.keyIdFrom, "AKIAOLDKEY");
  assert.match(refused.out, /run the push again with --overwrite/u);
  assert.match(refused.out, /^ {4}bucket: "old-bucket" -> "team-backups" {2}\(was from file\)$/mu);
  assert.match(refused.out, /^ {4}key id: AKIAOLDKEY -> the pushed one$/mu);
  assert.equal(readFileSync(join(config, "snapshot.json"), "utf8"), oldFile, "the settings are untouched");
  assert.equal(readFileSync(join(config, "snapshot-credentials"), "utf8"), oldKeys, "the key pair is untouched");
  noSecretIn(refused.out, "the refusal");

  const applied = capture(() => runConfigPush(["host-e"], true, net.deps));
  assert.equal(applied.value.code, 0, JSON.stringify(applied.value));
  assert.equal(applied.value.hosts[0]?.credentials, "replaced");
  const saved = JSON.parse(readFileSync(join(config, "snapshot.json"), "utf8"));
  assert.equal(saved.values.bucket, "team-backups");
  assert.equal(saved.values.dir, "/srv/snaps", "dir stays the host's own");
  assert.match(readFileSync(join(config, "snapshot-credentials"), "utf8"), new RegExp(KEY_ID, "u"));

  // Pushed again, the same values change nothing and need no flag.
  const again = runConfigPush(["host-e"], false, net.deps);
  assert.equal(again.code, 0);
  assert.deepEqual(again.hosts[0]?.applied, []);
});

test("push refuses a host whose environment sets a key to another value, names the variable, and writes nothing", () => {
  const net = mesh();
  const pushed = runConfigPush(["locked-f"], true, net.deps);
  assert.equal(pushed.code, 1);
  assert.equal(pushed.hosts[0]?.outcome, "refused");
  assert.match(pushed.hosts[0]?.detail ?? "", /region is set by DARIUS_SNAPSHOT_REGION here to another value/u);
  assert.equal(existsSync(join(net.configOf("locked-f"), "snapshot.json")), false);
  assert.equal(existsSync(join(net.configOf("locked-f"), "snapshot-credentials")), false);
});

test("push refuses the local host without a call, and the receiver refuses its own host id", () => {
  const net = mesh();
  const pushed = runConfigPush(["localhost", "user@host-a", "127.0.0.1", "host-a.example.com", "alias-a"], false, net.deps);
  assert.equal(pushed.code, 1);
  assert.deepEqual(
    pushed.hosts.map((done) => done.outcome),
    ["refused", "refused", "refused", "refused", "refused"],
  );
  assert.deepEqual(
    net.calls().map((call) => call[4]),
    ["alias-a"],
    "only the alias was called; the receiver caught it",
  );
  assert.match(pushed.hosts[4]?.detail ?? "", /this is the sending host \(host-a\)/u);
  assert.equal(existsSync(join(net.configOf("alias-a"), "snapshot-credentials")), false);

  assert.equal(isThisHost("host-b", net.deps), false);
  assert.equal(isThisHost("ops@HOST-A", net.deps), true);
});

test("push to an older darius names the fix; nothing to push refuses before any call", () => {
  const net = mesh();
  const old = runConfigPush(["old-g"], false, net.deps);
  assert.equal(old.code, 1);
  assert.equal(old.hosts[0]?.detail, "no receive verb there: run darius update --hosts old-g first");

  writeSnapshotFile(new Map([["keep", 3]]));
  try {
    const empty = runConfigPush(["host-h"], false, net.deps);
    assert.equal(empty.code, 1);
    assert.match(empty.error ?? "", /^nothing to push: set a bucket first/u);
    assert.deepEqual(empty.hosts, []);
  } finally {
    senderSettings();
  }
  assert.deepEqual(
    net.calls().map((call) => call[4]),
    ["old-g"],
  );
});

test("push takes no secret in argv or a flag, and needs --hosts", async () => {
  const deps: SnapshotDeps = { systemctl: () => "", stdinIsTTY: () => false, readStdin: () => "" };
  for (const parsed of [
    args(["config", "push", SECRET], { hosts: "host-b" }),
    args(["config", "push"], { hosts: "host-b", secret: SECRET }),
    args(["config", "push"]),
    args(["config", "push"], { hosts: "bad host" }),
  ]) {
    const error = await runSnapshotCommand(parsed, deps).then(
      () => null,
      (cause: Error) => cause,
    );
    assert.ok(error instanceof UsageError, "a usage error");
    noSecretIn(error.message, "the usage error");
  }
});

test("every setting but the host-local ones is pushed, so a new key travels too; ping_url stays on each host", () => {
  assert.deepEqual(
    pushedKeys(),
    SNAPSHOT_KEYS.filter((key) => key !== "dir" && key !== "enabled" && key !== "ping_url"),
  );
});

test("redact removes the secret, also in its JSON-escaped form", () => {
  assert.equal(redact(`x ${SECRET} y`, SECRET), "x [secret] y");
  assert.equal(redact('a"b\\c', 'a"b\\c'), "[secret]");
  assert.equal(redact(JSON.stringify('a"b'), 'a"b'), '"[secret]"');
});

// --- receive, in this process --------------------------------------------------------------------------

async function receive(stdin: string, tty = false): Promise<{ code: number; out: string }> {
  const lines: string[] = [];
  const log = console.log;
  const error = console.error;
  console.log = (...items: unknown[]) => lines.push(items.join(" "));
  console.error = (...items: unknown[]) => lines.push(items.join(" "));
  try {
    const deps: SnapshotDeps = { systemctl: () => "", stdinIsTTY: () => tty, readStdin: () => stdin };
    return { code: await runSnapshotCommand(args(["config", "receive"], { json: true }), deps), out: lines.join("\n") };
  } finally {
    console.log = log;
    console.error = error;
  }
}

function document(settings: Record<string, string | number | boolean>, overwrite = false): string {
  return JSON.stringify({ v: 1, origin: "host-z", overwrite, settings, key_id: KEY_ID, secret: SECRET });
}

/** Runs `work` with this process pointed at a fresh receiving config dir. */
async function asReceiver(work: (config: string) => Promise<void>): Promise<void> {
  const config = mkdtempSync(join(sandbox, "receiver-"));
  writeFileSync(join(config, "config.toml"), 'host = "host-r"\n');
  process.env.DARIUS_CONFIG_DIR = config;
  try {
    await work(config);
  } finally {
    process.env.DARIUS_CONFIG_DIR = senderConfig;
  }
}

test("receive applies the settings, then the key pair (0600), and never prints the secret", async () => {
  await asReceiver(async (config) => {
    const ran = await receive(document({ endpoint: "https://s3.example.com", bucket: "team-backups", prefix: "darius" }));
    assert.equal(ran.code, 0, ran.out);
    const answer = JSON.parse(ran.out);
    assert.equal(answer.outcome, "applied");
    assert.equal(answer.credentials, "created");
    assert.deepEqual(answer.applied.toSorted(), ["bucket", "endpoint"]);
    assert.equal(readSnapshotFile().get("bucket"), "team-backups");
    assert.equal(statSync(join(config, "snapshot-credentials")).mode & 0o777, 0o600);
    noSecretIn(ran.out, "the receive answer");
    for (const file of filesUnder(config)) {
      if (!file.endsWith("snapshot-credentials")) noSecretIn(readFileSync(file, "utf8"), file);
    }
  });
});

test("receive refuses a terminal, a broken document, an unknown key and an env-locked key, and leaks nothing", async () => {
  await asReceiver(async (config) => {
    await assert.rejects(receive("", true), /not a terminal/u);

    const broken = await receive(`{"v":1,"secret":"${SECRET}", oops`);
    assert.equal(broken.code, 1);
    assert.equal(JSON.parse(broken.out).detail, "the input is not a snapshot settings document (v 1)");
    noSecretIn(broken.out, "the parse error");

    const unknown = await receive(document({ endpoint: "https://s3.example.com", bucket: "team-backups", some_future_key: true }));
    assert.equal(unknown.code, 1);
    assert.match(JSON.parse(unknown.out).detail, /does not know the setting "some_future_key"/u);

    process.env.DARIUS_SNAPSHOT_BUCKET = "env-bucket";
    try {
      const locked = await receive(document({ endpoint: "https://s3.example.com", bucket: "team-backups" }));
      assert.equal(locked.code, 1);
      const answer = JSON.parse(locked.out);
      assert.equal(answer.outcome, "refused");
      assert.match(answer.detail, /bucket is set by DARIUS_SNAPSHOT_BUCKET here to another value/u);
      noSecretIn(locked.out, "the env refusal");

      // The same value in the environment is no conflict: the key is left to it, and reported.
      const same = await receive(document({ endpoint: "https://s3.example.com", bucket: "env-bucket" }));
      assert.equal(same.code, 0, same.out);
      assert.deepEqual(JSON.parse(same.out).env, ["bucket"]);
      assert.equal(readSnapshotFile().get("bucket"), undefined, "an env-set key is not written");
    } finally {
      delete process.env.DARIUS_SNAPSHOT_BUCKET;
    }
    assert.ok(existsSync(join(config, "snapshot-credentials")));
  });
});

test("receive refuses another key pair set by the environment and keeps the old key on a refused setting", async () => {
  await asReceiver(async (config) => {
    process.env.DARIUS_SNAPSHOT_ACCESS_KEY_ID = "AKIAENVKEY";
    process.env.DARIUS_SNAPSHOT_SECRET_ACCESS_KEY = "env-secret";
    try {
      const ran = await receive(document({ endpoint: "https://s3.example.com", bucket: "team-backups" }));
      assert.equal(ran.code, 1);
      assert.match(JSON.parse(ran.out).detail, /DARIUS_SNAPSHOT_ACCESS_KEY_ID and DARIUS_SNAPSHOT_SECRET_ACCESS_KEY/u);
      assert.equal(existsSync(join(config, "snapshot.json")), false, "nothing written");
    } finally {
      delete process.env.DARIUS_SNAPSHOT_ACCESS_KEY_ID;
      delete process.env.DARIUS_SNAPSHOT_SECRET_ACCESS_KEY;
    }

    const bad = await receive(document({ endpoint: "https://s3.example.com", bucket: "team-backups", keep_remote: 0 }));
    assert.equal(bad.code, 1);
    assert.equal(existsSync(join(config, "snapshot-credentials")), false, "a refused setting writes no key pair");
  });
});
