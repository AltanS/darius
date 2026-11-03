/**
 * Inside the box (src/core/box-inside.ts, src/core/box-files.ts, src/cli/box.ts):
 * the wrapper and ssh config text, the box dir files, the relay, `box connect`
 * and `box enter` with its exit codes and signals.
 *
 * Nothing here runs in a real box (test/box-real.test.ts does). `box enter`
 * finds its marker through DARIUS_BOX_MARKER, a file in a temp dir. Every
 * server binds 127.0.0.1 or a Unix socket in a temp dir. The real `decide`
 * refuses loopback, so a tunnel to a local server injects a decision that
 * allows exactly that server and passes everything else to `decide`. No
 * test reads the real ~/.ssh or reaches a real host.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { connect, createServer, type AddressInfo, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";

import { BOX_BIN, BoxError } from "../src/core/box.ts";
import {
  BOX_RELAY_PORT,
  boxDarius,
  boxEnterCommand,
  boxFiles,
  boxPathProblem,
  boxSshConfig,
  filterSshConfig,
  findOnPath,
  hostBoxFiles,
  proxyCommandLine,
  shellWord,
  wrapperScript,
  writeBoxFiles,
} from "../src/core/box-files.ts";
import { connectAuthority, connectTunnel, enterBox, exitCodeOf, forwardedSignals, readBoxMarker, startRelay } from "../src/core/box-inside.ts";
import { decide, startBoxProxy, type BoxPolicy, type BoxProxy, type Decide } from "../src/core/box-proxy.ts";

const DARIUS = fileURLToPath(new URL("../bin/darius", import.meta.url));
const DIR = mkdtempSync(join(tmpdir(), "darius-box-inside-"));
let count = 0;
function fresh(name: string): string {
  count += 1;
  return join(DIR, `${name}${String(count)}`);
}

function policy(): BoxPolicy {
  return { net: "public", reach: [], harnessHosts: [], ownAddresses: [], ownSubnets: [], webPorts: [] };
}

/** Allows 127.0.0.1:`port` and nothing else the real rule refuses. */
function allowLocal(port: number): Decide {
  return (target, rules) => (target.host === "127.0.0.1" && target.port === port ? { allow: true, rule: "reach", addresses: ["127.0.0.1"] } : decide(target, rules));
}

function listen(server: Server): Promise<number> {
  // SAFETY: a TCP server that listens has an AddressInfo address.
  return new Promise((resolve) => server.listen({ host: "127.0.0.1", port: 0 }, () => resolve((server.address() as AddressInfo).port)));
}

function echoServer(): Server {
  return createServer((socket) => socket.pipe(socket));
}

async function proxyFor(port: number): Promise<{ proxy: BoxProxy; path: string; lines: string[] }> {
  const path = `${fresh("p")}.sock`;
  const lines: string[] = [];
  const proxy = await startBoxProxy({ socketPath: path, policy: policy(), log: (line) => lines.push(line), decide: allowLocal(port) });
  return { proxy, path, lines };
}

interface Ran {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** Runs the darius CLI. `env` adds to a copy of this process's env. */
function darius(args: readonly string[], options: { env?: Record<string, string>; input?: string; onStdout?: (text: string, child: ReturnType<typeof spawn>) => void } = {}): Promise<Ran> {
  return new Promise((resolve) => {
    const child = spawn(DARIUS, [...args], { env: { ...process.env, ...options.env }, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
      options.onStdout?.(stdout, child);
    });
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    if (options.input === undefined) child.stdin.end();
    else child.stdin.write(options.input);
  });
}

function marker(): string {
  const path = `${fresh("marker")}.json`;
  writeFileSync(path, '{"v":1,"run":"r1","darius":"0.0.0"}\n');
  return path;
}

// --- the text ---------------------------------------------------------------------

test("the wrapper runs the real program with the box ssh config and every argument", () => {
  assert.equal(wrapperScript("/usr/bin/ssh"), '#!/bin/sh\n# darius box: ssh in the box reaches hosts only through the box proxy.\nexec /usr/bin/ssh -F /run/darius/ssh_config "$@"\n');
  assert.match(wrapperScript("/opt/my tools/ssh"), /^exec '\/opt\/my tools\/ssh' -F /mu);
  assert.throws(() => wrapperScript("ssh"), BoxError);
  assert.throws(() => wrapperScript("/usr/bin/ssh\nrm -rf x"), BoxError);
});

test("shellWord quotes anything the shell would read as more than one word", () => {
  assert.equal(shellWord("/a/b-c.d"), "/a/b-c.d");
  assert.equal(shellWord("/a b"), "'/a b'");
  assert.equal(shellWord("/it's"), `'/it'\\''s'`);
  assert.equal(shellWord("/a;b"), "'/a;b'");
});

test("the ssh config filter drops Include, ProxyCommand, ProxyJump and each Match exec block, and keeps the rest", () => {
  const user = [
    "Include ~/.ssh/config.d/*",
    "ServerAliveInterval 30",
    "",
    "Host git.example.com",
    "  User git",
    "  ProxyJump bastion.example.com",
    "  proxycommand=nc %h %p",
    "  IdentityFile ~/.ssh/id_test",
    "Match exec \"test -f /x\" host *.example.org",
    "  User exec-user",
    "  ProxyCommand evil",
    "",
    "Match host build.example.org",
    "  Port 2222",
    "Match !exec \"false\"",
    "  User negated",
    "Host other.example.net",
    "  INCLUDE more",
    "  Hostname 192.0.2.10",
  ].join("\n");
  const out = filterSshConfig(user).split("\n");
  assert.deepEqual(out, [
    "# darius box dropped: Include ~/.ssh/config.d/*",
    "ServerAliveInterval 30",
    "",
    "Host git.example.com",
    "  User git",
    "# darius box dropped: ProxyJump bastion.example.com",
    "# darius box dropped: proxycommand=nc %h %p",
    "  IdentityFile ~/.ssh/id_test",
    "# darius box dropped: Match exec \"test -f /x\" host *.example.org",
    "# darius box dropped: User exec-user",
    "# darius box dropped: ProxyCommand evil",
    "",
    "Match host build.example.org",
    "  Port 2222",
    "# darius box dropped: Match !exec \"false\"",
    "# darius box dropped: User negated",
    "Host other.example.net",
    "# darius box dropped: INCLUDE more",
    "  Hostname 192.0.2.10",
  ]);
  assert.equal(filterSshConfig("Host a\r\n  Include b\r\n"), "Host a\n# darius box dropped: Include b\n");
});

test("the box ssh config starts with Host * and the darius ProxyCommand, then the filtered user config", () => {
  const text = boxSshConfig("/opt/darius/bin/darius", "Host git.example.com\n  ProxyJump b\n  User git\n");
  const lines = text.split("\n");
  assert.equal(lines[1], "Host *");
  assert.equal(lines[2], "  ProxyCommand /opt/darius/bin/darius box connect %h %p");
  assert.ok(lines.includes("  ControlPath none"), "no master connection outside the box");
  assert.ok(text.includes("Host git.example.com\n# darius box dropped: ProxyJump b\n  User git\n"));
  assert.ok(text.endsWith("\n") && !text.endsWith("\n\n"));
  assert.equal(boxSshConfig("/d", undefined).split("\n")[2], "  ProxyCommand /d box connect %h %p");
  assert.equal(proxyCommandLine("/home/a b/100%/darius"), "ProxyCommand '/home/a b/100%%/darius' box connect %h %p");
  assert.throws(() => proxyCommandLine("darius"), BoxError);
});

test("boxFiles: the marker, one wrapper per program found, and the ssh config, with their modes", () => {
  const files = boxFiles({ run: "r1", darius: "/opt/darius/bin/darius", tools: [{ name: "ssh", path: "/usr/bin/ssh" }, { name: "sftp", path: "/usr/bin/sftp" }], userSshConfig: undefined });
  assert.deepEqual(files.map((file) => [file.path, file.mode]), [["box.json", 0o600], ["bin/ssh", 0o700], ["bin/sftp", 0o700], ["ssh_config", 0o600]]);
  const parsed = JSON.parse(files[0]?.text ?? "");
  assert.equal(parsed.v, 1);
  assert.equal(parsed.run, "r1");
});

test("boxEnterCommand puts darius box enter with the relay port and the proxy socket around the harness", () => {
  assert.deepEqual(boxEnterCommand("/d", ["claude", "-p", "--json"]), ["/d", "box", "enter", "--relay-port", String(BOX_RELAY_PORT), "--proxy", "/run/darius/proxy.sock", "--", "claude", "-p", "--json"]);
  assert.throws(() => boxEnterCommand("/d", []), BoxError);
});

test("boxPathProblem names what the box empties or hides", () => {
  const view = { home: "/home/u", runtimeDir: "/run/user/1000" };
  assert.equal(boxPathProblem("/usr/bin/ssh", view), undefined);
  assert.equal(boxPathProblem("/home/u/.local/opt/darius/versions/1/bin/darius", view), undefined);
  assert.equal(boxPathProblem("/run/current-system/sw/bin/ssh", view), undefined);
  assert.match(boxPathProblem("/run/user/1000/x", view) ?? "", /empties/u);
  assert.match(boxPathProblem("/run/other/ssh", view) ?? "", /\/run/u);
  assert.match(boxPathProblem("/tmp/darius/bin/darius", view) ?? "", /\/tmp/u);
  assert.match(boxPathProblem("/var/tmp/x", view) ?? "", /\/var\/tmp/u);
  assert.match(boxPathProblem("/home/u/.local/state/x", view) ?? "", /hides/u);
  assert.equal(boxPathProblem("/var/tmp/t/home/bin/darius", { home: "/var/tmp/t/home", runtimeDir: "/var/tmp/t/run" }), undefined, "a home under /var/tmp is bound back");
});

// --- the host side ----------------------------------------------------------------

function fakeProgram(path: string): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, "#!/bin/sh\n");
  chmodSync(path, 0o755);
}

test("hostBoxFiles finds ssh, scp and sftp on PATH past the box bin, follows the ssh config link, and resolves darius", () => {
  const base = fresh("host");
  const home = join(base, "home");
  // In the home: a program under /tmp or /var/tmp outside it is one the box cannot see.
  const binA = join(home, "a");
  const binB = join(home, "b");
  // The runtime dir: the box empties it, so a program there is skipped.
  const hiddenBin = join(base, "run", "bin");
  fakeProgram(join(hiddenBin, "sftp"));
  fakeProgram(join(hiddenBin, "scp"));
  fakeProgram(join(binA, "ssh"));
  fakeProgram(join(binB, "ssh"));
  fakeProgram(join(binB, "scp"));
  writeFileSync(join(binB, "sftp"), "not executable\n");
  fakeProgram(join(home, "app", "bin", "darius"));
  symlinkSync(join(home, "app"), join(home, "current"));
  mkdirSync(join(home, ".ssh"), { recursive: true });
  mkdirSync(join(home, "dotfiles"), { recursive: true });
  writeFileSync(join(home, "dotfiles", "ssh_config"), "Host x\n  ProxyJump y\n");
  symlinkSync(join(home, "dotfiles", "ssh_config"), join(home, ".ssh", "config"));

  const input = hostBoxFiles({ run: "r1", dariusBin: join(home, "current", "bin", "darius"), home, runtimeDir: join(base, "run"), env: { PATH: `${BOX_BIN}:relative:${hiddenBin}:${binA}:${binB}` } });
  // scp in the runtime dir comes first on PATH; the wrapper runs the one the box can see. sftp has none: no wrapper.
  assert.deepEqual(input.tools, [{ name: "ssh", path: join(binA, "ssh") }, { name: "scp", path: join(binB, "scp") }]);
  assert.equal(input.darius, join(home, "app", "bin", "darius"), "the link is resolved outside");
  assert.equal(input.userSshConfig, "Host x\n  ProxyJump y\n");
  assert.equal(findOnPath("sftp", `${binA}:${binB}`), undefined, "a file that is not executable is not a program");

  fakeProgram(join(base, "run", "darius"));
  assert.throws(() => boxDarius(join(base, "run", "darius"), { home, runtimeDir: join(base, "run") }), /cannot run in the box: it is in .*empties/u);
  const bare = join(base, "bare-home");
  fakeProgram(join(bare, "bin", "darius"));
  assert.equal(hostBoxFiles({ run: "r1", dariusBin: join(bare, "bin", "darius"), home: bare, runtimeDir: "/run/user/1", env: {} }).userSshConfig, undefined, "no ~/.ssh/config: none");
});

test("writeBoxFiles writes each file with its mode, and refuses a file that is there already", () => {
  const box = fresh("box");
  mkdirSync(box, { mode: 0o700 });
  const files = boxFiles({ run: "r1", darius: "/d", tools: [{ name: "ssh", path: "/usr/bin/ssh" }], userSshConfig: "Host a\n" });
  writeBoxFiles(box, files);
  assert.equal(statSync(join(box, "ssh_config")).mode & 0o777, 0o600);
  assert.equal(statSync(join(box, "bin", "ssh")).mode & 0o777, 0o700);
  assert.equal(statSync(join(box, "bin")).mode & 0o777, 0o700);
  assert.equal(readBoxMarker(join(box, "box.json")).run, "r1");
  assert.match(readFileSync(join(box, "ssh_config"), "utf8"), /^Host a$/mu);
  assert.throws(() => writeBoxFiles(box, files), BoxError);
});

test("readBoxMarker refuses a missing file and a file that is not a marker", () => {
  assert.throws(() => readBoxMarker(join(DIR, "none.json")), /not in a box/u);
  const bad = `${fresh("bad")}.json`;
  writeFileSync(bad, '{"v":2}');
  assert.throws(() => readBoxMarker(bad), /not a darius box marker/u);
});

// --- the relay and the tunnel -----------------------------------------------------

test("the relay listens on 127.0.0.1 and pipes bytes both ways to the proxy socket, unread", async () => {
  const path = `${fresh("upstream")}.sock`;
  const seen: string[] = [];
  const upstream = createServer((socket) => {
    socket.on("data", (chunk: Buffer) => {
      seen.push(chunk.toString("utf8"));
      socket.write(`back:${chunk.toString("utf8")}`);
    });
  });
  await new Promise<void>((resolve) => upstream.listen(path, () => resolve()));
  const relay = await startRelay(0, path);
  try {
    const reply = await new Promise<string>((resolve, reject) => {
      const client: Socket = connect({ host: "127.0.0.1", port: relay.port });
      client.once("error", reject);
      client.on("data", (chunk: Buffer) => {
        resolve(chunk.toString("utf8"));
        client.destroy();
      });
      client.write("GET http://example.com/ HTTP/1.1\r\n\r\n");
    });
    assert.equal(reply, "back:GET http://example.com/ HTTP/1.1\r\n\r\n");
    assert.deepEqual(seen, ["GET http://example.com/ HTTP/1.1\r\n\r\n"]);
  } finally {
    await relay.close();
    upstream.close();
  }
});

test("the relay refuses a port that is taken", async () => {
  const taken = createServer();
  const port = await listen(taken);
  try {
    await assert.rejects(startRelay(port, join(DIR, "none.sock")), /cannot listen on 127\.0\.0\.1/u);
  } finally {
    taken.close();
  }
});

test("connectTunnel tunnels bytes through the real proxy to a local echo server", async () => {
  const echo = echoServer();
  const port = await listen(echo);
  const { proxy, path, lines } = await proxyFor(port);
  try {
    const input = new PassThrough();
    const output = new PassThrough();
    let received = "";
    output.on("data", (chunk: Buffer) => {
      received += chunk.toString("utf8");
      if (received === "ping\n") input.end();
    });
    input.write("ping\n");
    const result = await connectTunnel({ proxySocket: path, host: "127.0.0.1", port, input, output });
    assert.deepEqual(result, { ok: true });
    assert.equal(received, "ping\n");
    assert.match(lines[0] ?? "", /"decision":"allow"/u);
  } finally {
    await proxy.close();
    echo.close();
  }
});

test("connectTunnel gives the proxy's one line on a refusal", async () => {
  const { proxy, path } = await proxyFor(1);
  try {
    const result = await connectTunnel({ proxySocket: path, host: "127.0.0.1", port: 2, input: new PassThrough(), output: new PassThrough() });
    assert.deepEqual(result, { ok: false, line: "darius box: refused 127.0.0.1:2 (loopback): 127.0.0.1 resolves to 127.0.0.1, loopback" });
  } finally {
    await proxy.close();
  }
  await assert.rejects(connectTunnel({ proxySocket: join(DIR, "none.sock"), host: "a", port: 1, input: new PassThrough(), output: new PassThrough() }), /cannot reach the box proxy/u);
});

test("connectAuthority brackets an IPv6 address once", () => {
  assert.equal(connectAuthority("git.example.com", 22), "git.example.com:22");
  assert.equal(connectAuthority("2001:db8::1", 22), "[2001:db8::1]:22");
  assert.equal(connectAuthority("[2001:db8::1]", 22), "[2001:db8::1]:22");
});

test("exitCodeOf: the code, or 128 plus the signal number", () => {
  assert.equal(exitCodeOf(0, null), 0);
  assert.equal(exitCodeOf(7, null), 7);
  assert.equal(exitCodeOf(null, "SIGTERM"), 143);
  assert.equal(exitCodeOf(null, "SIGKILL"), 137);
});

// --- the CLI ----------------------------------------------------------------------

test("darius box connect tunnels stdin and stdout, and a refusal is one stderr line with exit 1", async () => {
  const echo = echoServer();
  const port = await listen(echo);
  const { proxy, path } = await proxyFor(port);
  try {
    for (const runtime of ["node", "bun"]) {
      const ran = await darius(["box", "connect", "127.0.0.1", String(port), "--proxy", path], {
        env: { DARIUS_RUNTIME: runtime },
        input: "hello through the box\n",
        onStdout: (text, child) => {
          if (text === "hello through the box\n") child.stdin?.end();
        },
      });
      assert.equal(ran.code, 0, `${runtime}: ${ran.stderr}`);
      assert.equal(ran.stdout, "hello through the box\n", runtime);
    }
    const refused = await darius(["box", "connect", "10.0.0.1", "22", "--proxy", path]);
    assert.equal(refused.code, 1);
    assert.equal(refused.stdout, "");
    assert.equal(refused.stderr, "darius box: refused 10.0.0.1:22 (private): 10.0.0.1 resolves to 10.0.0.1, a private address, and 10.0.0.1:22 is not in reach\n");
    const usage = await darius(["box", "connect", "a.example.com", "70000", "--proxy", path]);
    assert.equal(usage.code, 2);
  } finally {
    await proxy.close();
    echo.close();
  }
});

test("darius box enter refuses to run outside a box", async () => {
  const ran = await darius(["box", "enter", "--relay-port", "39001", "--", "true"], { env: { DARIUS_BOX_MARKER: join(DIR, "no-marker.json") } });
  assert.equal(ran.code, 1);
  assert.match(ran.stderr, /not in a box/u);
  const usage = await darius(["box", "enter", "--", "true"], { env: { DARIUS_BOX_MARKER: marker() } });
  assert.equal(usage.code, 2);
});

test("darius box enter passes the exit code, 128 + signal, and 127 for a program that cannot start, under both runtimes", async () => {
  const env = { DARIUS_BOX_MARKER: marker() };
  for (const runtime of ["node", "bun"]) {
    const runEnv = { ...env, DARIUS_RUNTIME: runtime };
    const seven = await darius(["box", "enter", "--relay-port", "39002", "--proxy", join(DIR, "none.sock"), "--", "sh", "-c", "echo out; exit 7"], { env: runEnv });
    assert.equal(seven.code, 7, `${runtime}: ${seven.stderr}`);
    assert.equal(seven.stdout, "out\n");
    const killed = await darius(["box", "enter", "--relay-port", "39002", "--", "sh", "-c", "kill -TERM $$"], { env: runEnv });
    assert.equal(killed.code, 143, runtime);
    const missing = await darius(["box", "enter", "--relay-port", "39002", "--", join(DIR, "no-such-program")], { env: runEnv });
    assert.equal(missing.code, 127, runtime);
    assert.match(missing.stderr, /cannot start/u);
  }
});

test("darius box enter forwards SIGTERM, SIGINT and SIGHUP to the program", async () => {
  const env = { DARIUS_BOX_MARKER: marker() };
  const signals = [["SIGTERM", 41], ["SIGINT", 42], ["SIGHUP", 43]] as const;
  for (const [signal, code] of signals) {
    const program = `process.on("${signal}", () => process.exit(${String(code)})); process.stdout.write("ready\\n"); setInterval(() => {}, 1000);`;
    let sent = false;
    const ran = await darius(["box", "enter", "--relay-port", "39003", "--", process.execPath, "-e", program], {
      env,
      onStdout: (text, child) => {
        if (sent || !text.includes("ready")) return;
        sent = true;
        child.kill(signal);
      },
    });
    assert.equal(ran.code, code, `${signal}: ${ran.stderr}`);
  }
});

test("box enter on a terminal does not send SIGINT a second time: the kernel sends Ctrl-C to the whole foreground group", async () => {
  assert.deepEqual(forwardedSignals(false), ["SIGTERM", "SIGINT", "SIGHUP"]);
  assert.deepEqual(forwardedSignals(true), ["SIGTERM", "SIGHUP"]);
  const run = async (isStdinTty: boolean): Promise<number> => {
    const ready = `${fresh("ready")}.txt`;
    const program = `process.on("SIGINT", () => process.exit(42)); process.on("SIGTERM", () => process.exit(41)); require("node:fs").writeFileSync(${JSON.stringify(ready)}, "ready"); setInterval(() => {}, 1000);`;
    const entered = enterBox({ relayPort: 0, proxySocket: join(DIR, "none.sock"), argv: [process.execPath, "-e", program], markerPath: marker(), stderr: new PassThrough(), isStdinTty });
    for (let tries = 0; tries < 200 && !existsSync(ready); tries += 1) await new Promise((done) => setTimeout(done, 25));
    // What a Ctrl-C does to `box enter` itself; on a terminal the harness gets its own copy from the kernel.
    process.emit("SIGINT", "SIGINT");
    await new Promise((done) => setTimeout(done, 200));
    process.emit("SIGTERM", "SIGTERM");
    return entered;
  };
  assert.equal(await run(false), 42, "no terminal: SIGINT is passed on");
  assert.equal(await run(true), 41, "a terminal: SIGINT is not passed on, and box enter is still there to pass SIGTERM");
});

test("the relay of darius box enter reaches the proxy while the program runs", async () => {
  const echo = echoServer();
  const port = await listen(echo);
  const { proxy, path, lines } = await proxyFor(port);
  try {
    // The program speaks CONNECT to the relay, as an HTTPS_PROXY client does.
    const program = [
      'const net = require("node:net");',
      `const s = net.connect(39004, "127.0.0.1", () => s.write("CONNECT 127.0.0.1:${String(port)} HTTP/1.1\\r\\nHost: x\\r\\n\\r\\nping"));`,
      'let got = ""; s.on("data", (c) => { got += c; if (got.endsWith("ping")) { process.stdout.write(got); process.exit(0); } });',
    ].join("\n");
    const ran = await darius(["box", "enter", "--relay-port", "39004", "--proxy", path, "--", process.execPath, "-e", program], { env: { DARIUS_BOX_MARKER: marker() } });
    assert.equal(ran.code, 0, ran.stderr);
    assert.equal(ran.stdout, "HTTP/1.1 200 Connection Established\r\n\r\nping");
    assert.equal(lines.length, 1);
  } finally {
    await proxy.close();
    echo.close();
  }
});
