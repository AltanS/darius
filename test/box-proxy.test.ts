/**
 * The box proxy (src/core/box-proxy.ts): the decision table, driven through the
 * pure `decide` without a socket, and the real proxy on a Unix socket.
 *
 * No real DNS: every resolver here is injected. The local servers bind to
 * 127.0.0.1 only. The real `decide` refuses loopback, so the one end to end
 * tunnel that reaches a local server injects a decision that allows exactly
 * that server, and nothing else.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, statSync, existsSync, writeFileSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { connect, createServer } from "node:net";
import type { AddressInfo, Server, Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { decide, hostAddresses, judgeHost, parseHostPort, parseRequest, startBoxProxy, withWebAddresses } from "../src/core/box-proxy.ts";
import type { BoxPolicy, Decide, Decision, HostPort, Resolver } from "../src/core/box-proxy.ts";
import { boxPolicy } from "../src/runner/box-launch.ts";

const DIR = mkdtempSync(join(tmpdir(), "darius-box-proxy-"));
let sockets = 0;
function socketPath(): string {
  sockets += 1;
  return join(DIR, `p${sockets}.sock`);
}

function policy(change: Partial<BoxPolicy> = {}): BoxPolicy {
  return { net: "public", reach: [], harnessHosts: [], ownAddresses: [], ownSubnets: [], webPorts: [], ...change };
}

function hp(text: string): HostPort {
  return parseHostPort(text);
}

function judge(host: string, port: number, addresses: string[], rules: BoxPolicy): Decision {
  return decide({ host, port, addresses }, rules);
}

function assertRefused(decision: Decision, rule: string): void {
  assert.equal(decision.allow, false, `expected refuse (${rule}), got ${JSON.stringify(decision)}`);
  assert.equal(decision.rule, rule);
}

function assertAllowed(decision: Decision, rule: string): void {
  assert.equal(decision.allow, true, `expected allow (${rule}), got ${JSON.stringify(decision)}`);
  assert.equal(decision.rule, rule);
}

// ---------------------------------------------------------------------------
// The decision table

test("every always-refused class is refused as a literal, as a resolved address and when listed", () => {
  const cases: [string, string][] = [
    ["127.0.0.1", "loopback"],
    ["127.9.8.7", "loopback"],
    ["::1", "loopback"],
    ["0:0:0:0:0:0:0:1", "loopback"],
    ["::ffff:127.0.0.1", "loopback"],
    ["::ffff:7f00:1", "loopback"],
    ["0.0.0.0", "unspecified"],
    ["0.1.2.3", "unspecified"],
    ["::", "unspecified"],
    ["::ffff:0.0.0.0", "unspecified"],
    ["169.254.169.254", "link-local"],
    ["::ffff:169.254.169.254", "link-local"],
    ["fe80::1", "link-local"],
    ["febf::1", "link-local"],
    ["224.0.0.1", "multicast"],
    ["239.255.255.250", "multicast"],
    ["ff02::1", "multicast"],
    ["240.0.0.1", "reserved"],
    ["255.255.255.255", "reserved"],
    ["::7f00:1", "reserved"],
    ["64:ff9b::7f00:1", "loopback"],
    ["2002:7f00:1::1", "loopback"],
  ];
  for (const [address, rule] of cases) {
    const port = 443;
    const literal = address.includes(":") ? `[${address}]` : address;
    const listed = policy({ reach: [hp(`${literal}:${port}`), hp(`evil.example:${port}`)], harnessHosts: [hp(`evil.example:${port}`)] });
    assertRefused(judge(address, port, [], policy()), rule);
    assertRefused(judge(address, port, [], listed), rule);
    assertRefused(judge("evil.example", port, [address], policy()), rule);
    assertRefused(judge("evil.example", port, [address], listed), rule);
  }
});

test("every address of this host is refused, IPv4-mapped too, even when listed", () => {
  const rules = policy({ ownAddresses: ["203.0.113.7", "2001:db8::7"], reach: [hp("me.example:22"), hp("203.0.113.7:22")] });
  assertRefused(judge("203.0.113.7", 22, [], rules), "this-host");
  assertRefused(judge("::ffff:203.0.113.7", 22, [], rules), "this-host");
  assertRefused(judge("me.example", 22, ["203.0.113.7"], rules), "this-host");
  assertRefused(judge("me.example", 22, ["2001:db8:0:0::7"], rules), "this-host");
  assertAllowed(judge("other.example", 443, ["203.0.113.8"], rules), "public");
});

test("IPv4-mapped IPv6 is judged as its IPv4 before any range check", () => {
  assertRefused(judge("::ffff:10.0.0.1", 443, [], policy()), "private");
  assertRefused(judge("::ffff:a00:1", 443, [], policy()), "private");
  assertRefused(judge("::ffff:192.168.1.1", 443, [], policy()), "private");
  assertRefused(judge("::ffff:100.64.0.1", 443, [], policy()), "private");
  assertRefused(judge("::FFFF:127.0.0.1", 443, [], policy({ reach: [hp("[::ffff:127.0.0.1]:443")] })), "loopback");
  assertRefused(judge("mapped.example", 443, ["::ffff:7f00:1"], policy({ reach: [hp("mapped.example:443")] })), "loopback");
  assertRefused(judge("mapped.example", 443, ["0:0:0:0:0:ffff:169.254.169.254"], policy()), "link-local");
  assertRefused(judge("mapped.example", 443, ["::ffff:224.0.0.1"], policy()), "multicast");
  // A mapped literal matches a reach entry for the same IPv4.
  assertAllowed(judge("::ffff:10.9.9.9", 443, [], policy({ reach: [hp("10.9.9.9:443")] })), "reach");
  // A mapped public address is public.
  assertAllowed(judge("mapped.example", 443, ["::ffff:93.184.216.34"], policy()), "public");
  // A mapped address of this host is this host.
  assertRefused(judge("mapped.example", 443, ["::ffff:203.0.113.7"], policy({ ownAddresses: ["203.0.113.7"] })), "this-host");
  assertRefused(judge("mapped.example", 443, ["203.0.113.7"], policy({ ownAddresses: ["::ffff:203.0.113.7"] })), "this-host");
});

test("port 22 passes only by a reach entry, in every net mode", () => {
  const harness = [hp("api.harness.example:22")];
  for (const net of ["public", "listed", "none"] as const) {
    assertRefused(judge("public.example", 22, ["93.184.216.34"], policy({ net })), "ssh-not-listed");
    assertRefused(judge("93.184.216.34", 22, [], policy({ net })), "ssh-not-listed");
    assertRefused(judge("api.harness.example", 22, ["93.184.216.34"], policy({ net, harnessHosts: harness })), "ssh-not-listed");
    // Listed on another port is not listed on 22.
    assertRefused(judge("git.example", 22, ["93.184.216.34"], policy({ net, reach: [hp("git.example:2222")] })), "ssh-not-listed");
  }
  assertAllowed(judge("git.example", 22, ["93.184.216.34"], policy({ reach: [hp("git.example:22")] })), "reach");
  assertAllowed(judge("git.example", 22, ["93.184.216.34"], policy({ net: "listed", reach: [hp("git.example:22")] })), "reach");
  // net none takes harness hosts only, so even a listed port 22 is refused there.
  assertRefused(judge("git.example", 22, ["93.184.216.34"], policy({ net: "none", reach: [hp("git.example:22")] })), "net-none");
  // A reach entry never lends port 22 to a loopback or this-host address.
  assertRefused(judge("git.example", 22, ["127.0.0.1"], policy({ reach: [hp("git.example:22")] })), "loopback");
  assertRefused(judge("git.example", 22, ["203.0.113.7"], policy({ reach: [hp("git.example:22")], ownAddresses: ["203.0.113.7"] })), "this-host");
  // Port 2222 on a public host is ordinary public traffic.
  assertAllowed(judge("public.example", 2222, ["93.184.216.34"], policy()), "public");
});

test("names under localhost are refused by name", () => {
  assertRefused(judge("localhost", 80, ["93.184.216.34"], policy()), "loopback");
  assertRefused(judge("api.localhost", 80, ["93.184.216.34"], policy()), "loopback");
  assertRefused(judge("LOCALHOST.", 80, ["93.184.216.34"], policy()), "loopback");
});

test("the tailnet range 100.64/10 is private: refused unless listed", () => {
  for (const address of ["100.64.0.1", "100.100.100.100", "100.127.255.254", "::ffff:100.64.0.1"]) {
    assertRefused(judge("peer.example", 22, [address], policy()), "private");
    assertAllowed(judge("peer.example", 22, [address], policy({ reach: [hp("peer.example:22")] })), "reach");
  }
  assertAllowed(judge("edge.example", 443, ["100.63.255.255"], policy()), "public");
  assertAllowed(judge("edge.example", 443, ["100.128.0.1"], policy()), "public");
});

test("every private range is refused unless listed", () => {
  for (const address of ["10.0.0.1", "172.16.0.1", "172.31.255.255", "192.168.1.1", "fc00::1", "fd12:3456::1", "fec0::1"]) {
    assertRefused(judge("inner.example", 443, [address], policy()), "private");
    assertRefused(judge(address, 443, [], policy()), "private");
  }
  assertAllowed(judge("edge.example", 443, ["172.15.255.255"], policy()), "public");
  assertAllowed(judge("edge.example", 443, ["172.32.0.1"], policy()), "public");
});

test("decimal, octal and hex IPv4 forms are refused before any lookup", () => {
  for (const host of ["2130706433", "0177.0.0.1", "0x7f.1", "0x7f000001", "127.1", "127.0.1", "010.0.0.1", "1.2.3.4.5", "0x7F.0.0.1", "example.0x10"]) {
    // Even if a resolver claimed a public address, the form alone refuses it.
    assertRefused(judge(host, 80, ["93.184.216.34"], policy({ reach: [{ host, port: 80 }] })), "ipv4-form");
    assert.equal(judgeHost(host).kind, "bad");
  }
});

test("a trailing dot: on an IPv4 literal it is refused; on a name it is the same name", () => {
  assertRefused(judge("127.0.0.1.", 80, [], policy()), "ipv4-form");
  assertRefused(judge("93.184.216.34.", 80, [], policy()), "ipv4-form");
  assertRefused(judge("0x7f.1.", 80, [], policy()), "ipv4-form");
  assertRefused(judge("inner.example.", 22, ["10.1.2.3"], policy()), "private");
  assertAllowed(judge("inner.example.", 22, ["10.1.2.3"], policy({ reach: [hp("inner.example:22")] })), "reach");
  assertRefused(judge("loop.example.", 22, ["127.0.0.1"], policy({ reach: [hp("loop.example:22")] })), "loopback");
  assertRefused(judge("a..example", 22, ["93.184.216.34"], policy()), "bad-host");
  assertRefused(judge("example.com..", 22, ["93.184.216.34"], policy()), "bad-host");
});

test("a name that resolves to public and private addresses is refused unless listed", () => {
  assertRefused(judge("mixed.example", 443, ["93.184.216.34", "10.0.0.5"], policy()), "private");
  assertRefused(judge("mixed.example", 443, ["10.0.0.5", "93.184.216.34"], policy()), "private");
  assertRefused(judge("mixed.example", 443, ["2606:2800::1", "fd00::5"], policy()), "private");
  const listed = assertAllowedResult(judge("mixed.example", 443, ["93.184.216.34", "10.0.0.5"], policy({ reach: [hp("mixed.example:443")] })));
  assert.deepEqual(listed, ["93.184.216.34", "10.0.0.5"]);
});

function assertAllowedResult(decision: Decision): string[] {
  if (!decision.allow) throw new Error(`expected allow, got ${JSON.stringify(decision)}`);
  return decision.addresses;
}

test("a name with any always-refused address is refused, even with public ones and when listed", () => {
  const rules = policy({ reach: [hp("mixed.example:443")] });
  assertRefused(judge("mixed.example", 443, ["93.184.216.34", "127.0.0.1"], rules), "loopback");
  assertRefused(judge("mixed.example", 443, ["93.184.216.34", "::ffff:169.254.169.254"], rules), "link-local");
});

test("a listed private host is allowed on its port only, and only by its name", () => {
  const rules = policy({ reach: [hp("git.inner.example:22"), hp("10.9.9.9:5432"), hp("[fd00::9]:443")] });
  assertAllowed(judge("git.inner.example", 22, ["10.1.2.3"], rules), "reach");
  assertAllowed(judge("GIT.Inner.Example", 22, ["10.1.2.3"], rules), "reach");
  assertRefused(judge("git.inner.example", 2222, ["10.1.2.3"], rules), "private");
  assertRefused(judge("other.inner.example", 22, ["10.1.2.3"], rules), "private");
  assertAllowed(judge("10.9.9.9", 5432, [], rules), "reach");
  assertRefused(judge("10.9.9.9", 22, [], rules), "private");
  assertAllowed(judge("fd00:0::9", 443, [], rules), "reach");
  assertAllowed(judge("::ffff:10.9.9.9", 5432, [], rules), "reach");
});

test("a listed host that is loopback is still refused", () => {
  const rules = policy({ reach: [hp("db.example:5432"), hp("127.0.0.1:5432"), hp("[::1]:5432"), hp("localhost:5432")] });
  assertRefused(judge("db.example", 5432, ["127.0.0.1"], rules), "loopback");
  assertRefused(judge("db.example", 5432, ["::1"], rules), "loopback");
  assertRefused(judge("127.0.0.1", 5432, [], rules), "loopback");
  assertRefused(judge("::1", 5432, [], rules), "loopback");
  assertRefused(judge("localhost", 5432, ["127.0.0.1"], rules), "loopback");
  assertRefused(judge("db.example", 5432, ["::1"], policy({ net: "none", harnessHosts: [hp("db.example:5432")] })), "loopback");
});

test("a darius web port on a non-public address is refused, even when listed", () => {
  const web = [{ host: "", port: 4747 }, { host: "", port: 4748 }, hp("darius.example:8443")];
  const rules = policy({ webPorts: web, reach: [hp("box.inner.example:4747"), hp("10.0.0.9:4748"), hp("darius.example:8443")] });
  assertRefused(judge("box.inner.example", 4747, ["10.0.0.9"], rules), "web-port");
  assertRefused(judge("10.0.0.9", 4748, [], rules), "web-port");
  assertRefused(judge("box.inner.example", 4747, ["100.64.1.2"], rules), "web-port");
  // The named web host is refused on its port by name, public or not.
  assertRefused(judge("darius.example", 8443, ["93.184.216.34"], rules), "web-port");
  // A web port on a public address of another host is fine.
  assertAllowed(judge("public.example", 4747, ["93.184.216.34"], rules), "public");
  // The same private host on another port, listed, is fine.
  assertAllowed(judge("box.inner.example", 22, ["10.0.0.9"], policy({ webPorts: web, reach: [hp("box.inner.example:22")] })), "reach");
});

test("a web entry that names an address refuses that address by any name", () => {
  const rules = policy({ webPorts: [hp("198.51.100.4:443")] });
  assertRefused(judge("alias.example", 443, ["198.51.100.4"], rules), "web-port");
  assertAllowed(judge("alias.example", 444, ["198.51.100.4"], rules), "public");
});

test("net none: harness hosts only", () => {
  const rules = policy({ net: "none", harnessHosts: [hp("api.harness.example:443")], reach: [hp("git.example:22"), hp("inner.example:22")] });
  assertAllowed(judge("api.harness.example", 443, ["93.184.216.34"], rules), "harness");
  assertRefused(judge("api.harness.example", 80, ["93.184.216.34"], rules), "net-none");
  assertRefused(judge("public.example", 443, ["93.184.216.34"], rules), "net-none");
  assertRefused(judge("git.example", 22, ["93.184.216.34"], rules), "net-none");
  assertRefused(judge("inner.example", 22, ["10.0.0.1"], rules), "net-none");
});

test("net listed: reach and harness hosts, nothing else", () => {
  const rules = policy({ net: "listed", harnessHosts: [hp("api.harness.example:443")], reach: [hp("git.example:22"), hp("inner.example:22")] });
  assertAllowed(judge("api.harness.example", 443, ["93.184.216.34"], rules), "harness");
  assertAllowed(judge("git.example", 22, ["93.184.216.34"], rules), "reach");
  assertAllowed(judge("inner.example", 22, ["192.168.7.7"], rules), "reach");
  assertRefused(judge("public.example", 443, ["93.184.216.34"], rules), "not-listed");
  assertRefused(judge("git.example", 443, ["93.184.216.34"], rules), "not-listed");
});

test("net public: public addresses on any port, plus reach and harness hosts", () => {
  const rules = policy({ harnessHosts: [hp("api.harness.example:443")], reach: [hp("inner.example:22")] });
  assertAllowed(judge("public.example", 443, ["93.184.216.34"], rules), "public");
  assertAllowed(judge("public.example", 25, ["2606:2800:220:1::1"], rules), "public");
  assertAllowed(judge("93.184.216.34", 8080, [], rules), "public");
  assertAllowed(judge("::ffff:93.184.216.34", 8080, [], rules), "public");
  assertAllowed(judge("api.harness.example", 443, ["93.184.216.34"], rules), "harness");
  assertAllowed(judge("inner.example", 22, ["10.0.0.1"], rules), "reach");
});

test("a harness host never unlocks a private address", () => {
  assertRefused(judge("api.harness.example", 443, ["10.0.0.1"], policy({ net: "none", harnessHosts: [hp("api.harness.example:443")] })), "private");
});

test("an address literal is judged by itself, not by what the resolver says", () => {
  assertRefused(judge("127.0.0.1", 80, ["93.184.216.34"], policy()), "loopback");
  assertAllowed(judge("93.184.216.34", 80, ["127.0.0.1"], policy()), "public");
});

test("no address, a bad address, a bad port and a bad name are refused", () => {
  assertRefused(judge("gone.example", 443, [], policy()), "no-address");
  assertRefused(judge("odd.example", 443, ["not-an-ip"], policy()), "bad-address");
  assertRefused(judge("odd.example", 443, ["0177.0.0.1"], policy()), "bad-address");
  assertRefused(judge("odd.example", 443, ["fe80::1%eth0"], policy()), "bad-address");
  assertRefused(judge("public.example", 0, ["93.184.216.34"], policy()), "bad-port");
  assertRefused(judge("public.example", 65_536, ["93.184.216.34"], policy()), "bad-port");
  assertRefused(judge("pub lic.example", 443, ["93.184.216.34"], policy()), "bad-host");
  assertRefused(judge("exämple.example", 443, ["93.184.216.34"], policy()), "bad-host");
  assertRefused(judge("", 443, ["93.184.216.34"], policy()), "bad-host");
  assertRefused(judge("1:2:3", 443, [], policy()), "bad-host");
});

test("parseHostPort needs a port and brackets for IPv6", () => {
  assert.deepEqual(parseHostPort("Git.Example:22"), { host: "git.example", port: 22 });
  assert.deepEqual(parseHostPort("[fd00::1]:443"), { host: "fd00::1", port: 443 });
  for (const text of ["git.example", "fd00::1:443", "[fd00::1]", "git.example:0", "git.example:65536", "git.example:022", "git.example:", ":22", "[nope]:22"]) {
    assert.throws(() => parseHostPort(text), undefined, text);
  }
});

test("parseRequest takes CONNECT and absolute-form plain HTTP only", () => {
  const empty = Buffer.alloc(0);
  assert.deepEqual(parseRequest("CONNECT api.example:443 HTTP/1.1\r\nHost: api.example:443", empty), { kind: "connect", host: "api.example", port: 443, rest: empty });
  const plain = parseRequest("GET http://Plain.Example/a?b=1 HTTP/1.1\r\nHost: x", empty);
  assert.equal(plain.kind, "http");
  if (plain.kind === "http") {
    assert.equal(plain.host, "plain.example");
    assert.equal(plain.port, 80);
    assert.equal(plain.path, "/a?b=1");
    assert.equal(plain.bodyLength, 0);
  }
  const post = parseRequest("POST http://plain.example/ HTTP/1.1\r\nContent-Length: 3\r\ncontent-length: 3", empty);
  assert.equal(post.kind === "http" && post.bodyLength, 3, "the same length twice is one length");
  for (const head of [
    "GARBAGE",
    "CONNECT api.example HTTP/1.1",
    "CONNECT ::1:443 HTTP/1.1",
    "CONNECT api.example:443 HTTP/2",
    "CONNECT  api.example:443 HTTP/1.1",
    "GET /relative HTTP/1.1",
    "GET https://api.example/ HTTP/1.1",
    "GET http://user@api.example/ HTTP/1.1",
    "BREW http://api.example/ HTTP/1.1",
    "CONNECT api.example:443 HTTP/1.1\r\nno colon here",
    "CONNECT api.example:443 HTTP/1.1\r\n folded: header",
    "POST http://api.example/ HTTP/1.1\r\nTransfer-Encoding: chunked",
    "POST http://api.example/ HTTP/1.1\r\nContent-Length: 3\r\nContent-Length: 4",
    "POST http://api.example/ HTTP/1.1\r\nContent-Length: -1",
  ]) {
    const parsed = parseRequest(head, empty);
    assert.equal(parsed.kind, "error", head);
    if (parsed.kind === "error") assert.equal(parsed.status, 400, head);
  }
  const long = parseRequest(`CONNECT api.example:443 HTTP/1.1\r\nX-Pad: ${"a".repeat(9000)}`, empty);
  assert.equal(long.kind === "error" && long.status, 431);
});

test("hostAddresses lists this host's interfaces plus the extras", () => {
  const found = hostAddresses(["100.64.0.42"]);
  assert.ok(found.includes("100.64.0.42"));
  assert.equal(new Set(found).size, found.length);
});

// ---------------------------------------------------------------------------
// The proxy on a Unix socket

function isAddressInfo(info: AddressInfo | string | null): info is AddressInfo {
  return info !== null && typeof info !== "string";
}

/** Binds a test server to 127.0.0.1 only, on a free port. */
function listen(server: Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const info = server.address();
      if (!isAddressInfo(info)) throw new Error("no port");
      resolve(info.port);
    });
  });
}

/** Sends `text` to the proxy and reads until the proxy closes. */
function exchange(path: string, text: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect(path);
    let got = "";
    socket.on("data", (chunk) => {
      got += chunk.toString("latin1");
    });
    socket.on("close", () => resolve(got));
    socket.on("error", reject);
    socket.write(text);
  });
}

/** Opens a CONNECT tunnel and resolves once the proxy answered 200. */
function tunnel(path: string, target: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = connect(path);
    let got = "";
    const onData = (chunk: Buffer): void => {
      got += chunk.toString("latin1");
      if (!got.includes("\r\n\r\n")) return;
      socket.off("data", onData);
      if (!got.startsWith("HTTP/1.1 200 ")) {
        reject(new Error(got));
        return;
      }
      resolve(socket);
    };
    socket.on("data", onData);
    socket.on("error", reject);
    socket.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`);
  });
}

function readSome(socket: Socket): Promise<string> {
  return new Promise((resolve) => socket.once("data", (chunk) => resolve(chunk.toString("latin1"))));
}

function closed(socket: Socket): Promise<void> {
  return new Promise((resolve) => {
    if (socket.destroyed) {
      resolve();
      return;
    }
    socket.once("close", () => resolve());
  });
}

function echoServer(): Server {
  return createServer((socket) => socket.pipe(socket));
}

const fakeResolver =
  (table: Record<string, string[]>): Resolver =>
  (name) =>
    Promise.resolve(table[name] ?? []);

/** The real rule, plus exactly one local server it would refuse as loopback. */
function allowOnly(port: number): Decide {
  return (target, rules) => (target.host === "upstream.test" && target.port === port && target.addresses.join() === "127.0.0.1" ? { allow: true, rule: "reach", addresses: ["127.0.0.1"] } : decide(target, rules));
}

test("end to end: a CONNECT tunnel through the Unix socket reaches the one injected local server", async () => {
  const echo = echoServer();
  const port = await listen(echo);
  const lines: string[] = [];
  const path = socketPath();
  const proxy = await startBoxProxy({ socketPath: path, policy: policy({ reach: [hp(`upstream.test:${port}`)] }), log: (line) => lines.push(line), resolve: fakeResolver({ "upstream.test": ["127.0.0.1"] }), decide: allowOnly(port) });
  try {
    assert.equal(statSync(path).mode & 0o777, 0o600);
    const socket = await tunnel(path, `upstream.test:${port}`);
    socket.write("ping through the box");
    assert.equal(await readSome(socket), "ping through the box");
    socket.destroy();

    // The same server by its address goes through the real rule: loopback, 403.
    const refused = await exchange(path, `CONNECT 127.0.0.1:${port} HTTP/1.1\r\n\r\n`);
    assert.match(refused, /^HTTP\/1\.1 403 Forbidden\r\n/u);
    assert.match(refused, /\r\n\r\ndarius box: refused 127\.0\.0\.1:\d+ \(loopback\): .+\n$/u);
    // Another port on the same name is refused too: the name still resolves to loopback.
    const other = await exchange(path, `CONNECT upstream.test:${port + 1 > 65_535 ? 1 : port + 1} HTTP/1.1\r\n\r\n`);
    assert.match(other, /^HTTP\/1\.1 403 /u);
    // ::ffff:127.0.0.1 in brackets is loopback.
    assert.match(await exchange(path, `CONNECT [::ffff:127.0.0.1]:${port} HTTP/1.1\r\n\r\n`), /\(loopback\)/u);
    assert.match(await exchange(path, `CONNECT 2130706433:${port} HTTP/1.1\r\n\r\n`), /\(ipv4-form\)/u);

    const logged = lines.map((line) => JSON.parse(line));
    assert.equal(logged.length, 5);
    assert.equal(logged[0].host, "upstream.test");
    assert.equal(logged[0].port, port);
    assert.deepEqual(logged[0].addresses, ["127.0.0.1"]);
    assert.equal(logged[0].decision, "allow");
    assert.equal(logged[0].rule, "reach");
    assert.ok(!Number.isNaN(Date.parse(logged[0].time)));
    assert.equal(logged[1].decision, "refuse");
    assert.equal(logged[1].rule, "loopback");
  } finally {
    await proxy.close();
    echo.close();
  }
  assert.equal(existsSync(path), false);
});

test("end to end: plain HTTP in absolute form reaches the server in origin form, proxy headers gone", async () => {
  let seen: { url: string | undefined; host: string | undefined; proxy: string | undefined; connection: string | undefined } | null = null;
  const web = createHttpServer((request, response) => {
    seen = { url: request.url, host: request.headers.host, proxy: request.headers["proxy-authorization"], connection: request.headers.connection };
    response.end("hello");
  });
  const port = await listen(web);
  const path = socketPath();
  const proxy = await startBoxProxy({ socketPath: path, policy: policy(), log: () => {}, resolve: fakeResolver({ "upstream.test": ["127.0.0.1"] }), decide: allowOnly(port) });
  try {
    const answer = await exchange(path, `GET http://upstream.test:${port}/path?q=1 HTTP/1.1\r\nHost: upstream.test:${port}\r\nProxy-Authorization: Basic eDp5\r\nProxy-Connection: keep-alive\r\n\r\n`);
    assert.match(answer, /^HTTP\/1\.1 200 /u);
    assert.match(answer, /hello$/u);
    assert.deepEqual(seen, { url: "/path?q=1", host: `upstream.test:${port}`, proxy: undefined, connection: "close" });
  } finally {
    await proxy.close();
    web.close();
  }
});

test("end to end: the real rule refuses a name the resolver maps to loopback, and never asks twice", async () => {
  const asked: string[] = [];
  const path = socketPath();
  const proxy = await startBoxProxy({
    socketPath: path,
    policy: policy({ reach: [hp("rebind.example:443")] }),
    log: () => {},
    resolve: (name) => {
      asked.push(name);
      return Promise.resolve(asked.length === 1 ? ["127.0.0.1"] : ["93.184.216.34"]);
    },
  });
  try {
    assert.match(await exchange(path, "CONNECT rebind.example:443 HTTP/1.1\r\n\r\n"), /^HTTP\/1\.1 403 .*\(loopback\)/su);
    assert.deepEqual(asked, ["rebind.example"]);
    // A numeric form never reaches the resolver.
    assert.match(await exchange(path, "CONNECT 0177.0.0.1:443 HTTP/1.1\r\n\r\n"), /\(ipv4-form\)/u);
    assert.match(await exchange(path, "CONNECT 0x7f.1:443 HTTP/1.1\r\n\r\n"), /\(ipv4-form\)/u);
    assert.deepEqual(asked, ["rebind.example"]);
  } finally {
    await proxy.close();
  }
});

test("end to end: a malformed request gets 400 and an over-long header gets 431, both logged", async () => {
  const lines: string[] = [];
  const path = socketPath();
  const proxy = await startBoxProxy({ socketPath: path, policy: policy(), log: (line) => lines.push(line), resolve: fakeResolver({}) });
  try {
    for (const request of ["GARBAGE\r\n\r\n", "CONNECT api.example HTTP/1.1\r\n\r\n", "GET /relative HTTP/1.1\r\n\r\n", "CONNECT ::1:443 HTTP/1.1\r\n\r\n", "CONNECT api.example:99999 HTTP/1.1\r\n\r\n"]) {
      assert.match(await exchange(path, request), /^HTTP\/1\.1 400 Bad Request\r\n/u, request);
    }
    // No blank line within 8 KB: refused without waiting for the rest.
    assert.match(await exchange(path, `CONNECT api.example:443 HTTP/1.1\r\nX-Pad: ${"a".repeat(9000)}`), /^HTTP\/1\.1 431 /u);
    // A complete header that is too long.
    assert.match(await exchange(path, `CONNECT api.example:443 HTTP/1.1\r\nX-Pad: ${"a".repeat(8200)}\r\n\r\n`), /^HTTP\/1\.1 431 /u);
    const rules = lines.map((line) => JSON.parse(line).rule);
    assert.deepEqual(rules, ["bad-request", "bad-request", "bad-request", "bad-request", "bad-request", "header-too-long", "header-too-long"]);
  } finally {
    await proxy.close();
  }
});

test("end to end: at most the tunnel limit, idle tunnels close, and closing the proxy ends every tunnel", async () => {
  const echo = echoServer();
  const port = await listen(echo);
  const path = socketPath();
  const options = { socketPath: path, policy: policy(), log: () => {}, resolve: fakeResolver({ "upstream.test": ["127.0.0.1"] }), decide: allowOnly(port) };
  const proxy = await startBoxProxy({ ...options, maxTunnels: 2 });
  try {
    const first = await tunnel(path, `upstream.test:${port}`);
    const second = await tunnel(path, `upstream.test:${port}`);
    assert.match(await exchange(path, `CONNECT upstream.test:${port} HTTP/1.1\r\n\r\n`), /^HTTP\/1\.1 503 .*\(too-many-tunnels\)/su);
    await proxy.close();
    await Promise.all([closed(first), closed(second)]);
  } finally {
    await proxy.close().catch(() => {});
  }

  const idlePath = socketPath();
  const idle = await startBoxProxy({ ...options, socketPath: idlePath, idleMs: 100 });
  try {
    const quiet = await tunnel(idlePath, `upstream.test:${port}`);
    await closed(quiet);
  } finally {
    await idle.close();
    echo.close();
  }
});

test("startBoxProxy refuses a policy it cannot judge by", async () => {
  const base = { socketPath: socketPath(), log: () => {} };
  await assert.rejects(startBoxProxy({ ...base, policy: policy({ ownAddresses: ["not-an-ip"] }) }));
  await assert.rejects(startBoxProxy({ ...base, policy: policy({ reach: [{ host: "2130706433", port: 22 }] }) }));
  await assert.rejects(startBoxProxy({ ...base, policy: policy({ reach: [{ host: "git.example", port: 0 }] }) }));
});

// ---------------------------------------------------------------------------
// 0.122.0: web hosts by address, one request per connection, new own addresses, NAT64

test("NAT64 64:ff9b::/96 is judged by its IPv4: loopback, this host, private, a web host and a reach entry all match", () => {
  // 64:ff9b::c633:6407 carries 198.51.100.7; 64:ff9b::a00:1 carries 10.0.0.1.
  assertRefused(judge("64:ff9b::7f00:1", 443, [], policy()), "loopback");
  assertRefused(judge("64:ff9b::c633:6407", 443, [], policy({ ownAddresses: ["198.51.100.7"] })), "this-host");
  assertRefused(judge("nat64.example", 443, ["64:ff9b::c633:6407"], policy({ ownAddresses: ["198.51.100.7"] })), "this-host");
  assertRefused(judge("64:ff9b::a00:1", 443, [], policy()), "private");
  assertAllowed(judge("64:ff9b::a00:1", 443, [], policy({ reach: [hp("10.0.0.1:443")] })), "reach");
  assertRefused(judge("64:ff9b::c633:6407", 8443, [], policy({ webPorts: [hp("198.51.100.7:8443")] })), "web-port");
  assertAllowed(judge("64:ff9b::c633:6407", 443, [], policy()), "public");
});

test("the local-use NAT64 prefix 64:ff9b:1::/48 is refused unless a reach entry names it", () => {
  assertRefused(judge("64:ff9b:1::5", 443, [], policy()), "private");
  assertRefused(judge("nat.example", 443, ["64:ff9b:1::5"], policy()), "private");
  assertAllowed(judge("64:ff9b:1::5", 443, [], policy({ reach: [hp("[64:ff9b:1::5]:443")] })), "reach");
  assertAllowed(judge("nat.example", 443, ["64:ff9b:1::5"], policy({ reach: [hp("nat.example:443")] })), "reach");
});

test("withWebAddresses adds each web host's addresses on its port; the web page is then refused by address under any name", async () => {
  const entries = [{ host: "", port: 4747 }, hp("darius.example:8443"), hp("gone.example:9443")];
  const added = await withWebAddresses(entries, fakeResolver({ "darius.example": ["198.51.100.7", "2001:DB8::7", "fe80::1%eth0", "198.51.100.7"] }));
  assert.deepEqual(added, [...entries, { host: "198.51.100.7", port: 8443 }, { host: "2001:db8::7", port: 8443 }], "a scoped address is left out, a repeat once");
  const rules = policy({ webPorts: added });
  assertRefused(judge("other-name.example", 8443, ["198.51.100.7"], rules), "web-port");
  assertRefused(judge("2001:db8::7", 8443, [], rules), "web-port");
  assertRefused(judge("::ffff:198.51.100.7", 8443, [], rules), "web-port");
  assertAllowed(judge("other-name.example", 443, ["198.51.100.7"], rules), "public");
  // Before 0.122.0 only the name was refused: the same address under another name passed.
  assertAllowed(judge("other-name.example", 8443, ["198.51.100.7"], policy({ webPorts: entries })), "public");
});

test("boxPolicy resolves the DARIUS_WEB_URL host of web.env and refuses its addresses on that port", async () => {
  const dir = mkdtempSync(join(DIR, "config-"));
  writeFileSync(join(dir, "web.env"), "DARIUS_WEB_URL=https://darius.example:8443\n");
  const before = process.env.DARIUS_CONFIG_DIR;
  process.env.DARIUS_CONFIG_DIR = dir;
  try {
    const asked: string[] = [];
    const rules = await boxPolicy({}, { boxHosts: [] }, (name) => {
      asked.push(name);
      return Promise.resolve(name === "darius.example" ? ["198.51.100.7"] : []);
    });
    assert.deepEqual(asked, ["darius.example"]);
    assert.ok(rules.webPorts.some((entry) => entry.host === "198.51.100.7" && entry.port === 8443), JSON.stringify(rules.webPorts));
    assertRefused(decide({ host: "alias.example", port: 8443, addresses: ["198.51.100.7"] }, rules), "web-port");
  } finally {
    if (before === undefined) delete process.env.DARIUS_CONFIG_DIR;
    else process.env.DARIUS_CONFIG_DIR = before;
  }
});

test("end to end: an address this host gets during a run is refused from the next decision on", async () => {
  let own: string[] = [];
  const seen: Decision[] = [];
  // The real rule decides; the wrapper then refuses, so no test ever connects to a public address.
  const record: Decide = (target, rules) => {
    const decision = decide(target, rules);
    seen.push(decision);
    return decision.allow ? { allow: false, rule: "not-listed", reason: "test: no connect" } : decision;
  };
  const path = socketPath();
  const proxy = await startBoxProxy({ socketPath: path, policy: policy({ ownAddresses: ["198.51.100.1"] }), log: () => {}, resolve: fakeResolver({ "new.example": ["2001:db8::99"] }), decide: record, ownAddresses: () => own });
  try {
    await exchange(path, "CONNECT new.example:443 HTTP/1.1\r\n\r\n");
    own = ["2001:db8::99", "not-an-address"];
    await exchange(path, "CONNECT new.example:443 HTTP/1.1\r\n\r\n");
    await exchange(path, "CONNECT 198.51.100.1:443 HTTP/1.1\r\n\r\n");
    assert.equal(seen[0]?.allow, true, "before the address appears it is a public address");
    assertRefused(seen[1] ?? refuseNothing(), "this-host");
    assertRefused(seen[2] ?? refuseNothing(), "this-host");
  } finally {
    await proxy.close();
  }
});

function refuseNothing(): Decision {
  return { allow: true, rule: "public", addresses: [] };
}

test("end to end: plain HTTP is one request per upstream connection: Connection: close, the body by Content-Length, nothing after it", async () => {
  // A raw server that ignores Connection: close and keeps the connection open, so only the proxy can end it.
  const received: string[] = [];
  let closes = 0;
  const raw = createServer((socket) => {
    let got = "";
    socket.on("data", (chunk) => {
      got += chunk.toString("latin1");
      if (got.includes("\r\n\r\n") && got.endsWith("abc")) socket.write("HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: keep-alive\r\n\r\nok");
    });
    socket.on("close", () => {
      received.push(got);
      closes += 1;
    });
  });
  const port = await listen(raw);
  const path = socketPath();
  const proxy = await startBoxProxy({ socketPath: path, policy: policy(), log: () => {}, resolve: fakeResolver({ "upstream.test": ["127.0.0.1"] }), decide: allowOnly(port) });
  try {
    const client = connect(path);
    let answer = "";
    const isAnswered = new Promise<void>((resolve) => {
      client.on("data", (chunk) => {
        answer += chunk.toString("latin1");
        if (answer.endsWith("ok")) resolve();
      });
    });
    client.write(`POST http://upstream.test:${port}/one HTTP/1.1\r\nHost: upstream.test:${port}\r\nContent-Length: 3\r\nConnection: keep-alive\r\n\r\nab`);
    client.write("c");
    await isAnswered;
    assert.match(answer, /^HTTP\/1\.1 200 OK/u);
    // A second request on the same client connection: the proxy closes both sides, nothing reaches the server.
    client.write(`GET http://other.test:${port}/two HTTP/1.1\r\nHost: other.test\r\n\r\n`);
    await closed(client);
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(closes, 1);
    const [only = ""] = received;
    assert.match(only, /^POST \/one HTTP\/1\.1\r\n/u);
    assert.match(only, /\r\nConnection: close\r\n\r\nabc$/u, "Connection: close goes upstream, then exactly the body");
    assert.doesNotMatch(only, /keep-alive|\/two|other\.test/u);
    // A chunked body is refused before any connection.
    assert.match(await exchange(path, `POST http://upstream.test:${port}/ HTTP/1.1\r\nTransfer-Encoding: chunked\r\n\r\n0\r\n\r\n`), /^HTTP\/1\.1 400 .*chunked/su);
    assert.equal(closes, 1);
  } finally {
    await proxy.close();
    raw.close();
  }
});

// ---------------------------------------------------------------------------
// 0.123.0: this host's subnets, IPv4-translated, Teredo, discard-only, benchmarking

test("an address in a subnet of this host's interfaces is private, v4 and v6: a reach entry lets it pass", () => {
  const rules = policy({ ownSubnets: ["2001:db8:aa:bb::5/64", "203.0.113.5/24", "10.8.0.3/24"] });
  assertRefused(judge("2001:db8:aa:bb::99", 443, [], rules), "private");
  assertRefused(judge("printer.example", 443, ["2001:db8:aa:bb:1:2:3:4"], rules), "private");
  assertRefused(judge("203.0.113.200", 443, [], rules), "private");
  assertRefused(judge("::ffff:203.0.113.200", 443, [], rules), "private");
  assertAllowed(judge("2001:db8:aa:bb::99", 443, [], policy({ ...rules, reach: [hp("[2001:db8:aa:bb::99]:443")] })), "reach");
  assertAllowed(judge("2001:db8:aa:cc::99", 443, [], rules), "public");
  assertAllowed(judge("203.0.114.1", 443, [], rules), "public");
  assertRefused(judge("2001:db8:aa:bb::99", 4747, [], policy({ ...rules, webPorts: [{ host: "", port: 4747 }] })), "web-port");
});

test("IPv4-translated ::ffff:0:0/96 is judged by its IPv4", () => {
  assertRefused(judge("::ffff:0:7f00:1", 443, [], policy()), "loopback");
  assertRefused(judge("::ffff:0:a00:1", 443, [], policy()), "private");
  assertRefused(judge("::ffff:0:c633:6407", 443, [], policy({ ownAddresses: ["198.51.100.7"] })), "this-host");
  assertAllowed(judge("::ffff:0:c633:6407", 443, [], policy()), "public");
});

test("Teredo 2001::/32 and discard-only 100::/64 are refused, even when listed", () => {
  for (const address of ["2001::1", "2001:0:4136:e378:8000:63bf:3fff:fdd2", "100::1", "100::ffff:1"]) {
    assertRefused(judge(address, 443, [], policy()), "reserved");
    assertRefused(judge("tunnel.example", 443, [address], policy({ reach: [hp("tunnel.example:443")] })), "reserved");
  }
  assertAllowed(judge("2001:1::1", 443, [], policy()), "public");
  assertAllowed(judge("100:0:0:1::1", 443, [], policy()), "public");
});

test("198.18.0.0/15 and 192.0.0.0/24 are private", () => {
  for (const address of ["198.18.0.1", "198.19.255.254", "192.0.0.8"]) assertRefused(judge(address, 443, [], policy()), "private");
  for (const address of ["198.17.255.255", "198.20.0.1", "192.0.1.1"]) assertAllowed(judge(address, 443, [], policy()), "public");
  assertAllowed(judge("198.18.0.1", 443, [], policy({ reach: [hp("198.18.0.1:443")] })), "reach");
});

test("a subnet that does not parse is refused at start; a subnet this host gets during a run is private from the next decision on", async () => {
  const base = { socketPath: socketPath(), log: () => {} };
  await assert.rejects(startBoxProxy({ ...base, policy: policy({ ownSubnets: ["2001:db8::/129"] }) }));
  await assert.rejects(startBoxProxy({ ...base, policy: policy({ ownSubnets: ["not-a-subnet"] }) }));
  let subnets: string[] = [];
  const seen: Decision[] = [];
  const record: Decide = (target, rules) => {
    const decision = decide(target, rules);
    seen.push(decision);
    return decision.allow ? { allow: false, rule: "not-listed", reason: "test: no connect" } : decision;
  };
  const path = socketPath();
  const proxy = await startBoxProxy({ socketPath: path, policy: policy(), log: () => {}, decide: record, ownAddresses: () => [], ownSubnets: () => subnets });
  try {
    await exchange(path, "CONNECT [2001:db8:aa:bb::99]:443 HTTP/1.1\r\n\r\n");
    subnets = ["2001:db8:aa:bb::5/64", "bad"];
    await exchange(path, "CONNECT [2001:db8:aa:bb::99]:443 HTTP/1.1\r\n\r\n");
    assert.equal(seen[0]?.allow, true);
    assertRefused(seen[1] ?? refuseNothing(), "private");
  } finally {
    await proxy.close();
  }
});
