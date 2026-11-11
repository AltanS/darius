/**
 * A fake `hc` (herdr-core CLI) for the hc surface tests: `hc connect` with one
 * JSON-RPC request on stdin, as src/surface/hc.ts sends it. It never reaches a
 * real hc core. A node script, with node by its full path in the shebang (the
 * Nix build sandbox has no /usr/bin/env).
 *
 * State lives in `$FAKE_HC_DIR`:
 *   - `calls.jsonl`: every request, `{method, params}`, one per line.
 *   - `t<n>.json`: one terminal per `terminal.run`, addresses from t1.
 *   - `states`: lines popped by each `terminal.wait` onto the newest terminal,
 *     the last one repeats: `live:<status>` (`live:-` never reported) or
 *     `finished`. Default: `live:working`.
 *   - `after-send-<n>`: replaces `states` once the n-th `terminal.send` came.
 *   - `gate-after-send-<n>`: the n-th send appends a line to `$RUN_DIR/gate.jsonl`.
 *   - `foreground`: the foreground name `terminal.get` shows (default: the
 *     basename of argv[0]); `foreground-pid` "other" gives it another pid.
 *   - `pid`: the pid `terminal.run` gives the terminal, for a real process
 *     tree the watch walks in /proc. Default: 2000000000 + n, above any
 *     pid_max, so /proc has no such process.
 *   - `spawn`: when present, `terminal.run` starts argv detached in its cwd,
 *     with the request's env on top of the fake's own.
 *   - `unavailable`: when present, `server.status` answers an error.
 */

import { chmodSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const SCRIPT = `#!${process.execPath}
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const dir = process.env.FAKE_HC_DIR;
const file = (name) => path.join(dir, name);
const read = (name, fallback) => (fs.existsSync(file(name)) ? fs.readFileSync(file(name), "utf8") : fallback);
const answer = (body) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: 1, ...body }) + "\\n");
const fail = (kind, message) => answer({ error: { code: -32000, message, data: { kind } } });
if (process.argv[2] !== "connect") { process.stderr.write("fake hc: only connect\\n"); process.exit(2); }
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  const request = JSON.parse(input.split("\\n")[0]);
  const params = request.params || {};
  fs.appendFileSync(file("calls.jsonl"), JSON.stringify({ method: request.method, params }) + "\\n");
  const load = (address) => (fs.existsSync(file(address + ".json")) ? JSON.parse(read(address + ".json")) : null);
  const save = (t) => fs.writeFileSync(file(t.address + ".json"), JSON.stringify(t));
  const view = (t) => {
    const live = t.state === "live";
    const name = read("foreground", path.basename(t.argv[0] || "")).trim();
    const pid = read("foreground-pid", "same").trim() === "other" ? t.pid + 1 : t.pid;
    return {
      address: t.address, name: t.name, argv: t.argv, cwd: t.cwd, labels: t.labels, pid: t.pid, state: t.state,
      status: live && t.status !== "-" ? { app: "fake", state: t.status } : null,
      reported: t.reported, foreground: live ? { pid, name, argv: t.argv, cwd: t.cwd } : null,
    };
  };
  switch (request.method) {
    case "server.status":
      if (fs.existsSync(file("unavailable"))) return fail("unavailable", "the core is down");
      return answer({ result: { core: { id: "fake", name: "fake" }, version: "0.1.14" } });
    case "terminal.run": {
      const n = Number(read("count", "0")) + 1;
      fs.writeFileSync(file("count"), String(n));
      const t = { address: "t" + n, name: params.name, argv: params.argv, cwd: params.cwd, labels: params.labels || {}, env: params.env || {}, pid: Number(read("pid", "").trim()) || 2000000000 + n, state: "live", status: "-", reported: false };
      save(t);
      fs.writeFileSync(file("newest"), t.address);
      if (fs.existsSync(file("spawn"))) {
        const child = spawn(t.argv[0], t.argv.slice(1), { cwd: t.cwd, env: { ...process.env, ...t.env }, detached: true, stdio: "ignore" });
        child.unref();
      }
      return answer({ result: view(t) });
    }
    case "terminal.get": {
      const t = load(params.terminal);
      if (t === null) return fail("not_found", "no terminal " + params.terminal);
      return answer({ result: view(t) });
    }
    case "terminal.wait": {
      const t = load(params.terminal);
      if (t === null) return fail("not_found", "no terminal " + params.terminal);
      const lines = read("states", "live:working\\n").trim().split("\\n");
      if (lines.length > 1) fs.writeFileSync(file("states"), lines.slice(1).join("\\n") + "\\n");
      const next = lines[0];
      if (t.state === "live" && next === "finished") t.state = "finished";
      if (t.state === "live" && next.startsWith("live:")) { t.status = next.slice(5); if (t.status !== "-") t.reported = true; }
      save(t);
      const ended = t.state === "finished";
      return answer({ result: { terminal: t.address, ended: ended || t.status !== "working", reason: ended ? "exit" : t.status === "working" ? "timeout" : "status", status: t.status === "-" ? null : t.status, turn: 0, children: [] } });
    }
    case "terminal.send": {
      const n = Number(read("send-count", "0")) + 1;
      fs.writeFileSync(file("send-count"), String(n));
      if (fs.existsSync(file("after-send-" + n))) fs.copyFileSync(file("after-send-" + n), file("states"));
      if (fs.existsSync(file("gate-after-send-" + n))) fs.appendFileSync(path.join(process.env.RUN_DIR, "gate.jsonl"), '{"decision":"allow"}\\n');
      return answer({ result: { started: true, status: "idle", turn: 1 } });
    }
    case "terminal.kill": {
      const t = load(params.terminal);
      if (t === null) return fail("not_found", "no terminal " + params.terminal);
      t.state = "finished";
      save(t);
      return answer({ result: view(t) });
    }
    case "terminal.rm": {
      const t = load(params.terminal);
      if (t === null) return fail("not_found", "no terminal " + params.terminal);
      if (t.state === "live") return fail("live", t.address + " is still running");
      fs.rmSync(file(t.address + ".json"));
      return answer({ result: { removed: t.address } });
    }
    default:
      return fail("invalid_params", "fake hc: " + request.method);
  }
});
`;

/** Writes the fake `hc` into `dir` and returns its path. */
export function writeFakeHc(dir: string): string {
  const bin = join(dir, "hc");
  writeFileSync(bin, SCRIPT);
  chmodSync(bin, 0o755);
  return bin;
}

/** The params of a request the fake saw: the fields src/surface/hc.ts sends. */
export interface FakeHcParams {
  terminal?: string;
  argv?: string[];
  cwd?: string;
  name?: string;
  no_parent?: boolean;
  no_notify?: boolean;
  env?: { [name: string]: string };
  labels?: { [key: string]: string };
  text?: string;
  if?: string;
  timeout?: number;
}

/** One request the fake saw. */
export interface FakeHcCall {
  method: string;
  params: FakeHcParams;
}
