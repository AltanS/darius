/**
 * `src/core/config.ts` and `src/core/credentials.ts`: the config.toml loader,
 * the allow_http refusal rule, and the credentials file mode check.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";

import { loadConfig, writeConfigSkeleton } from "../src/core/config.ts";
import { loadCredentials } from "../src/core/credentials.ts";

function withConfigDir(run: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "darius-config-test-"));
  const previous = process.env.DARIUS_CONFIG_DIR;
  process.env.DARIUS_CONFIG_DIR = dir;
  try {
    run(dir);
  } finally {
    if (previous === undefined) delete process.env.DARIUS_CONFIG_DIR;
    else process.env.DARIUS_CONFIG_DIR = previous;
  }
}

test("loadConfig loads the sample config from docs/plan-tonight.md", () => {
  withConfigDir((dir) => {
    writeFileSync(
      join(dir, "config.toml"),
      [
        'host = "host-a"',
        "",
        "[remote]",
        'endpoint = "http://127.0.0.1:9910"',
        'bucket = "darius"',
        'region = "us-east-1"',
        "path_style = true",
        "allow_http = true",
        "sse = true",
        'credentials = "~/.config/darius/credentials"',
        "",
        "[notify]",
        'webhook = ""',
        "",
      ].join("\n"),
    );

    const config = loadConfig();
    assert.equal(config.host, "host-a");
    assert.ok(config.remote !== undefined);
    assert.equal(config.remote?.endpoint, "http://127.0.0.1:9910");
    assert.equal(config.remote?.bucket, "darius");
    assert.equal(config.remote?.region, "us-east-1");
    assert.equal(config.remote?.path_style, true);
    assert.equal(config.remote?.allow_http, true);
    assert.equal(config.remote?.sse, true);
    assert.equal(config.remote?.credentials, join(homedir(), ".config", "darius", "credentials"));
    assert.equal(config.notify.webhook, "");
  });
});

test("a tailnet http endpoint is accepted with allow_http = true", () => {
  withConfigDir((dir) => {
    writeFileSync(
      join(dir, "config.toml"),
      [
        'host = "host-b"',
        "[remote]",
        'endpoint = "http://100.64.1.10:9910"',
        'bucket = "darius"',
        "allow_http = true",
      ].join("\n"),
    );

    const config = loadConfig();
    assert.equal(config.remote?.endpoint, "http://100.64.1.10:9910");
  });
});

test("allow_http against a non-loopback, non-tailnet host is refused, naming the rule", () => {
  withConfigDir((dir) => {
    writeFileSync(
      join(dir, "config.toml"),
      [
        'host = "host-a"',
        "[remote]",
        'endpoint = "http://1.2.3.4:9910"',
        'bucket = "darius"',
        "allow_http = true",
      ].join("\n"),
    );

    assert.throws(() => loadConfig(), /allow_http/);
  });
});

test("an http endpoint without allow_http = true is refused", () => {
  withConfigDir((dir) => {
    writeFileSync(
      join(dir, "config.toml"),
      ['host = "host-a"', "[remote]", 'endpoint = "http://127.0.0.1:9910"', 'bucket = "darius"'].join(
        "\n",
      ),
    );

    assert.throws(() => loadConfig(), /allow_http/);
  });
});

test("writeConfigSkeleton writes once, then reports exists", () => {
  withConfigDir(() => {
    assert.equal(writeConfigSkeleton(), "written");
    assert.equal(writeConfigSkeleton(), "exists");

    const config = loadConfig();
    assert.equal(config.notify.webhook, "");
    assert.ok(config.host.length > 0);
    assert.equal(config.remote, undefined);
  });
});

test("[setup] units: all five when absent, a listed subset in a fixed order, an unknown name refused with the valid ones", () => {
  withConfigDir((dir) => {
    const file = join(dir, "config.toml");
    writeFileSync(file, 'host = "host-b"\n');
    assert.deepEqual(loadConfig().setup.units, ["sync", "vigil-sweep", "run-due", "web", "snapshot"]);

    writeFileSync(file, 'host = "host-b"\n\n[setup]\nunits = ["web", "sync", "sync"]\n');
    assert.deepEqual(loadConfig().setup.units, ["sync", "web"]);

    writeFileSync(file, '[setup]\nunits = []\n');
    assert.deepEqual(loadConfig().setup.units, []);

    writeFileSync(file, '[setup]\nunits = ["sync", "backup"]\n');
    assert.throws(() => loadConfig(), /unknown unit "backup" \(valid: "sync", "vigil-sweep", "run-due", "web", "snapshot"\)/);

    writeFileSync(file, '[setup]\nunits = "sync"\n');
    assert.throws(() => loadConfig(), /\[setup\] "units" must be an array/);
  });
});

test("[snapshot]: kept as a raw table for src/core/snapshot-settings.ts, absent when the table is", () => {
  withConfigDir((dir) => {
    const file = join(dir, "config.toml");
    writeFileSync(file, 'host = "host-b"\n');
    assert.equal(loadConfig().snapshot, undefined);
    writeFileSync(file, 'host = "host-b"\n\n[snapshot]\nkeep = 3\nbucket = "bucket-1"\n');
    assert.deepEqual(loadConfig().snapshot, { keep: 3, bucket: "bucket-1" });
  });
});

test("the retired [backup] table and the retired export unit name are refused or ignored as documented", () => {
  withConfigDir((dir) => {
    const file = join(dir, "config.toml");
    writeFileSync(file, 'host = "host-b"\n\n[backup]\nrepo = "file:///srv/backup.git"\n');
    assert.equal(loadConfig().host, "host-b", "an old [backup] table is ignored, not an error");
    writeFileSync(file, '[setup]\nunits = ["sync", "export"]\n');
    assert.throws(() => loadConfig(), /unknown unit "export"/);
  });
});

test("loadConfig refuses when no config.toml exists", () => {
  withConfigDir(() => {
    assert.throws(() => loadConfig(), /no config found/);
  });
});

test("a malformed config.toml names the file in the error", () => {
  withConfigDir((dir) => {
    const file = join(dir, "config.toml");
    writeFileSync(file, "host = not-a-value\n");
    assert.throws(() => loadConfig(), new RegExp(file.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  });
});

/** A well-formed credentials file with the given mode. */
function credentialsFile(mode: number): string {
  const dir = mkdtempSync(join(tmpdir(), "darius-creds-test-"));
  const file = join(dir, "credentials");
  writeFileSync(file, "[default]\naws_access_key_id = AKIAEXAMPLE\naws_secret_access_key = topsecret\n");
  chmodSync(file, mode);
  return file;
}

test("loadCredentials refuses a file with mode 0644", () => {
  assert.throws(() => loadCredentials(credentialsFile(0o644)), /0600/);
});

test("loadCredentials refuses a group-readable file (0640), names the fix, and prints no key value", () => {
  const file = credentialsFile(0o640);
  assert.throws(
    () => loadCredentials(file),
    (cause: Error) =>
      /owner only/.test(cause.message) &&
      cause.message.includes("found 0640") &&
      cause.message.includes(`chmod 600 ${file}`) &&
      !cause.message.includes("topsecret") &&
      !cause.message.includes("AKIAEXAMPLE"),
  );
});

test("loadCredentials accepts an owner-read-only file (0400), as sops-nix delivers it", () => {
  const creds = loadCredentials(credentialsFile(0o400));
  assert.equal(creds.accessKeyId, "AKIAEXAMPLE");
  assert.equal(creds.secretAccessKey, "topsecret");
});

test("loadCredentials reads a well-formed, mode 0600 file", () => {
  const dir = mkdtempSync(join(tmpdir(), "darius-creds-test-"));
  const file = join(dir, "credentials");
  writeFileSync(file, "[default]\naws_access_key_id = AKIAEXAMPLE\naws_secret_access_key = topsecret\n");
  chmodSync(file, 0o600);

  const creds = loadCredentials(file);
  assert.equal(creds.accessKeyId, "AKIAEXAMPLE");
  assert.equal(creds.secretAccessKey, "topsecret");
});

test("loadCredentials refuses a file missing aws_secret_access_key", () => {
  const dir = mkdtempSync(join(tmpdir(), "darius-creds-test-"));
  const file = join(dir, "credentials");
  writeFileSync(file, "[default]\naws_access_key_id = AKIAEXAMPLE\n");
  chmodSync(file, 0o600);

  assert.throws(() => loadCredentials(file), /aws_secret_access_key/);
});
