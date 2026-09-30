/**
 * `src/core/unit-path.ts`: the rendered unit PATH, the binary ExecStart
 * calls, and placeholder rendering. Every host fact is faked, so nothing here
 * reads the real PATH or filesystem.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { CHECKOUT_DARIUS, isNixStorePath, renderUnit, unitDarius, unitPath } from "../src/core/unit-path.ts";
import type { UnitPathInput } from "../src/core/unit-path.ts";

const HOME = "/home/tester";

/**
 * A `UnitPathInput` where exactly `dirs` exist and exactly `files` are files.
 * The temp dir is /tmp and the runtime dir /run/user/1000.
 */
function pathInput(envPath: string, dirs: readonly string[], files: readonly string[] = []): UnitPathInput {
  const existingDirs = new Set(dirs);
  const existingFiles = new Set(files);
  return {
    home: HOME,
    user: "tester",
    envPath,
    tmpDir: "/tmp",
    runtimeDir: "/run/user/1000",
    isDir: (path) => existingDirs.has(path),
    isFile: (path) => existingFiles.has(path),
  };
}

// --- unitPath ------------------------------------------------------------------

test("unitPath orders ~/.local/bin, ~/.bun/bin, the setup-time dirs that hold a tool, then the well-known dirs", () => {
  const input = pathInput(
    "/opt/tools/bin:/opt/other/bin:/usr/bin",
    [`${HOME}/.local/bin`, `${HOME}/.bun/bin`, "/opt/tools/bin", "/opt/other/bin", "/run/current-system/sw/bin", "/usr/bin", "/bin"],
    ["/opt/tools/bin/node", "/opt/other/bin/jq", "/usr/bin/bash"],
  );
  assert.equal(
    unitPath(input),
    [`${HOME}/.local/bin`, `${HOME}/.bun/bin`, "/opt/tools/bin", "/run/current-system/sw/bin", "/usr/bin", "/bin"].join(":"),
  );
});

test("unitPath does not copy a coreutils replacement that the login PATH puts ahead of /usr/bin", () => {
  // host-a, 2026-09-28: Homebrew's uutils dir sat ahead of /usr/bin in the login PATH.
  const uubin = "/home/linuxbrew/.linuxbrew/opt/uutils-coreutils/libexec/uubin";
  const input = pathInput(`${uubin}:/usr/local/bin:/usr/bin`, [uubin, "/usr/local/bin", "/usr/bin", "/bin"], [
    `${uubin}/ls`,
    `${uubin}/sleep`,
    "/usr/bin/bash",
    "/usr/bin/sleep",
  ]);
  assert.equal(unitPath(input), `${HOME}/.local/bin:/usr/local/bin:/usr/bin:/bin`);
});

test("unitPath takes the first dir that holds a tool, as the operator's shell would", () => {
  const nvm = `${HOME}/.config/nvm/versions/node/v24.8.0/bin`;
  const input = pathInput(`${nvm}:/usr/bin`, [nvm, "/usr/bin"], [`${nvm}/node`, "/usr/bin/node", "/usr/bin/bash"]);
  assert.equal(unitPath(input), `${HOME}/.local/bin:${nvm}:/usr/bin`);
});

test("unitPath keeps ~/.local/bin even when it does not exist yet, and drops a missing ~/.bun/bin", () => {
  assert.equal(unitPath(pathInput("", ["/usr/bin"])), `${HOME}/.local/bin:/usr/bin`);
});

test("unitPath drops store, temp, runtime-dir, relative, unsafe and missing entries, even when they hold a tool", () => {
  const entries = [
    "/nix/store/abc123-bash-5.2/bin",
    "/nix/store",
    "/tmp/devshell/bin",
    "/tmp",
    "/run/user/1000/fnm/bin",
    "relative/bin",
    "",
    ".",
    "/has space/bin",
    "/pct%h/bin",
    "/back\\slash/bin",
    '/quote"d/bin',
    "/dollar$/bin",
    "/does/not/exist",
    "/opt/ok/bin",
  ];
  const absolute = entries.filter((entry) => entry.startsWith("/"));
  const input = pathInput(
    entries.join(":"),
    absolute.filter((entry) => entry !== "/does/not/exist"),
    absolute.map((entry) => `${entry}/claude`),
  );
  assert.equal(unitPath(input), `${HOME}/.local/bin:/opt/ok/bin`);
});

test("unitPath keeps the first occurrence of each dir, treating a trailing slash as the same dir", () => {
  const input = pathInput("/opt/a/bin/:/usr/bin:/opt/a/bin", ["/usr/bin", "/opt/a/bin"], ["/opt/a/bin/node", "/opt/a/bin/bun"]);
  assert.equal(unitPath(input), `${HOME}/.local/bin:/opt/a/bin:/usr/bin`);
});

test("unitPath adds the NixOS profile dirs, in order, when they exist", () => {
  const nixDirs = [
    "/run/wrappers/bin",
    `${HOME}/.nix-profile/bin`,
    "/etc/profiles/per-user/tester/bin",
    `${HOME}/.local/state/nix/profile/bin`,
    "/nix/var/nix/profiles/default/bin",
    "/run/current-system/sw/bin",
  ];
  // The PATH a bare `systemd-run --user` gets on NixOS: /usr/bin holds only env.
  const input = pathInput("", [...nixDirs, "/usr/bin"]);
  assert.equal(unitPath(input), [`${HOME}/.local/bin`, ...nixDirs, "/usr/bin"].join(":"));
});

test("unitPath keeps the well-known order when a tool sits in a well-known dir", () => {
  // host-b's login PATH lists the per-user profile before the system profile.
  const input = pathInput(
    "/etc/profiles/per-user/tester/bin:/run/current-system/sw/bin",
    ["/run/wrappers/bin", "/etc/profiles/per-user/tester/bin", "/run/current-system/sw/bin"],
    ["/etc/profiles/per-user/tester/bin/node", "/run/current-system/sw/bin/bash"],
  );
  assert.equal(
    unitPath(input),
    [`${HOME}/.local/bin`, "/run/wrappers/bin", "/etc/profiles/per-user/tester/bin", "/run/current-system/sw/bin"].join(":"),
  );
});

test("unitPath skips the per-user profile dir when the user name is empty", () => {
  const input = { ...pathInput("", ["/etc/profiles/per-user/bin", "/etc/profiles/per-user//bin"]), user: "" };
  assert.equal(unitPath(input), `${HOME}/.local/bin`);
});

test("unitPath ignores an unset runtime dir and never treats / as a temp dir", () => {
  const input = { ...pathInput("/opt/a/bin", ["/opt/a/bin"], ["/opt/a/bin/bash"]), tmpDir: "/", runtimeDir: undefined };
  assert.equal(unitPath(input), `${HOME}/.local/bin:/opt/a/bin`);
});

// --- unitDarius ------------------------------------------------------------------

test("unitDarius calls the ~/.local/bin link when darius runs from a checkout", () => {
  const darius = unitDarius({
    root: "/home/tester/projects/darius/",
    envPath: "/usr/bin",
    isFile: () => false,
    realpath: () => undefined,
  });
  assert.equal(darius, CHECKOUT_DARIUS);
  assert.equal(darius, "%h/.local/bin/darius");
});

test("unitDarius picks the first profile link on PATH that resolves into the store", () => {
  const links = new Map([
    // A store dir on PATH: skipped, garbage collection deletes it later.
    ["/nix/store/aaa-darius/bin/darius", "/nix/store/aaa-darius/bin/darius"],
    // Exists, but resolves outside the store: not a Nix install.
    ["/usr/local/bin/darius", "/opt/darius/bin/darius"],
    // An unsafe dir: a `%` would be expanded in ExecStart.
    ["/weird%dir/darius", "/nix/store/bbb-darius/bin/darius"],
    ["/etc/profiles/per-user/tester/bin/darius", "/nix/store/ccc-darius/bin/darius"],
    [`${HOME}/.nix-profile/bin/darius`, "/nix/store/ddd-darius/bin/darius"],
  ]);
  const darius = unitDarius({
    root: "/nix/store/ccc-darius/share/darius/",
    envPath: [
      "/nix/store/aaa-darius/bin",
      "/usr/local/bin",
      "/weird%dir",
      "/missing/bin",
      "/etc/profiles/per-user/tester/bin",
      `${HOME}/.nix-profile/bin`,
    ].join(":"),
    isFile: (path) => links.has(path),
    realpath: (path) => links.get(path),
  });
  assert.equal(darius, "/etc/profiles/per-user/tester/bin/darius");
});

test("unitDarius returns undefined from the store when no profile link is on PATH", () => {
  const darius = unitDarius({
    root: "/nix/store/ccc-darius/share/darius/",
    envPath: "/nix/store/ccc-darius/bin:/usr/bin",
    isFile: (path) => path === "/nix/store/ccc-darius/bin/darius",
    realpath: (path) => path,
  });
  assert.equal(darius, undefined);
});

test("isNixStorePath matches the store and paths below it, nothing else", () => {
  assert.equal(isNixStorePath("/nix/store/abc-darius/"), true);
  assert.equal(isNixStorePath("/nix/store"), true);
  assert.equal(isNixStorePath("/nix/storefront/x"), false);
  assert.equal(isNixStorePath("/home/tester/nix/store/x"), false);
});

// --- renderUnit ------------------------------------------------------------------

test("renderUnit fills every placeholder in one pass", () => {
  const template = 'Environment="PATH=@PATH@"\nExecStart=@DARIUS@ sync --json\n# @PATH@ again\n';
  const rendered = renderUnit(template, "/a/@DARIUS@/bin:/usr/bin", "%h/.local/bin/darius");
  assert.equal(
    rendered,
    'Environment="PATH=/a/@DARIUS@/bin:/usr/bin"\nExecStart=%h/.local/bin/darius sync --json\n# /a/@DARIUS@/bin:/usr/bin again\n',
  );
});

test("renderUnit leaves a template without placeholders unchanged", () => {
  assert.equal(renderUnit("[Timer]\nOnCalendar=daily\n", "/usr/bin", "/x/darius"), "[Timer]\nOnCalendar=daily\n");
});
