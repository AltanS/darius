/**
 * Reaping a box (src/core/box-reap.ts), on a fake process table: the outer
 * bwrap is found by its `--ro-bind <box dir> /run/darius`, every process in a
 * pid namespace it started is killed with it, other processes are left
 * alone, a zombie counts as gone, and one that will not die is reported.
 * test/box-real.test.ts reaps a real box.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { reapBox, type ProcTable } from "../src/core/box-reap.ts";

const BOX = "/run/user/1000/darius-box/01JREAP";
const OWN = "pid:[1]";

interface Proc {
  argv: string[];
  ppid: number;
  ns: string;
  /** Kills it takes to die; Infinity: never. */
  lives?: number;
  zombie?: boolean;
}

function table(procs: Map<number, Proc>, killed: number[]): ProcTable {
  return {
    pids: () => [...procs.keys(), process.pid],
    cmdline: (pid) => procs.get(pid)?.argv,
    ppid: (pid) => procs.get(pid)?.ppid,
    pidNs: (pid) => (pid === process.pid ? OWN : procs.get(pid)?.ns),
    isZombie: (pid) => procs.get(pid)?.zombie === true,
    kill: (pid) => {
      killed.push(pid);
      const proc = procs.get(pid);
      if (proc === undefined) return;
      proc.lives = (proc.lives ?? 1) - 1;
      if (proc.lives <= 0) procs.delete(pid);
    },
  };
}

const bwrap = ["bwrap", "--ro-bind", "/", "/", "--ro-bind", BOX, "/run/darius", "--", "darius", "box", "enter"];

test("the outer bwrap and every process of its pid namespace are killed; another box, a lookalike in our namespace's argv elsewhere and a zombie are not", async () => {
  const procs = new Map<number, Proc>([
    [10, { argv: bwrap, ppid: 1, ns: OWN }],
    [11, { argv: bwrap, ppid: 10, ns: "pid:[9]" }],
    [12, { argv: ["claude", "-p"], ppid: 11, ns: "pid:[9]" }],
    [13, { argv: ["sh", "-c", "sleep 60"], ppid: 12, ns: "pid:[9]" }],
    [20, { argv: ["bwrap", "--ro-bind", `${BOX}-other`, "/run/darius"], ppid: 1, ns: OWN }],
    [21, { argv: ["grep", BOX], ppid: 1, ns: OWN }],
    [30, { argv: bwrap, ppid: 1, ns: OWN, zombie: true }],
  ]);
  const killed: number[] = [];
  const reaped = await reapBox({ boxDir: BOX, table: table(procs, killed), waitMs: 500 });
  assert.deepEqual(reaped, { killed: 4, left: [] });
  assert.deepEqual(killed.toSorted(), [10, 11, 12, 13]);
  assert.ok(procs.has(20) && procs.has(21) && procs.has(30));
});

test("a process left in the namespace after its bwrap died is still found and killed", async () => {
  const procs = new Map<number, Proc>([
    [10, { argv: bwrap, ppid: 1, ns: OWN }],
    [12, { argv: ["claude"], ppid: 10, ns: "pid:[9]", lives: 2 }],
  ]);
  const killed: number[] = [];
  const reaped = await reapBox({ boxDir: BOX, table: table(procs, killed), waitMs: 500 });
  assert.deepEqual(reaped.left, []);
  assert.deepEqual(killed, [10, 12, 12], "the second poll finds the namespace without its bwrap");
});

test("a box that will not die is reported after the wait; no box is no work", async () => {
  const procs = new Map<number, Proc>([[10, { argv: bwrap, ppid: 1, ns: OWN, lives: Number.POSITIVE_INFINITY }]]);
  const reaped = await reapBox({ boxDir: BOX, table: table(procs, []), waitMs: 120 });
  assert.deepEqual(reaped.left, [10]);
  assert.deepEqual(await reapBox({ boxDir: BOX, table: table(new Map(), []), waitMs: 120 }), { killed: 0, left: [] });
});
