/**
 * Reaping a box (docs/concept.md, "The work dir's guarded files"). The
 * post-run check must not race a live run: on the herdr surface the harness
 * lives on in the tab after the run ends, and a live run could swap a folder
 * for a link between the walk and a rename. So before the check, the runner
 * ends every process of this launch's box.
 *
 * How the box is found. The outer bwrap runs outside the box, with this
 * launch's box dir and `/run/darius` next to each other on its command line
 * (`--ro-bind <box dir> /run/darius`); `systemd-run --scope` execs bwrap, so
 * a scope changes nothing. A run cannot reach that process: it is outside the
 * box's pid namespace. Its children start the box's pid namespace. Every
 * process in that namespace (by `/proc/<pid>/ns/pid`, which a process cannot
 * forge) is killed with SIGKILL, and so is the outer bwrap. When the
 * namespace's first process dies, the kernel kills the rest. A zombie counts
 * as gone.
 */

import { readdirSync, readFileSync, readlinkSync } from "node:fs";
import { join } from "node:path";

import { BOX_MOUNT } from "./box.ts";

/** How long the reap waits for the box to die. */
export const REAP_WAIT_MS = 5_000;
const REAP_POLL_MS = 50;

/** What the reap reads of the process table. The real one is /proc; a test gives a fake. */
export interface ProcTable {
  pids(): number[];
  /** The argv, or undefined when the process is gone. */
  cmdline(pid: number): string[] | undefined;
  ppid(pid: number): number | undefined;
  /** `/proc/<pid>/ns/pid` as a link text, or undefined. */
  pidNs(pid: number): string | undefined;
  isZombie(pid: number): boolean;
  kill(pid: number): void;
}

function readText(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

/** The fields of `/proc/<pid>/stat` after the command name, which may hold spaces and parentheses. */
function statFields(pid: number): string[] | undefined {
  const text = readText(`/proc/${String(pid)}/stat`);
  if (text === undefined) return undefined;
  return text.slice(text.lastIndexOf(")") + 2).split(" ");
}

/** The process table of this host, from /proc. */
export const PROC: ProcTable = {
  pids: () => {
    try {
      return readdirSync("/proc").filter((name) => /^[0-9]+$/u.test(name)).map(Number);
    } catch {
      return [];
    }
  },
  cmdline: (pid) => readText(`/proc/${String(pid)}/cmdline`)?.split("\0"),
  ppid: (pid) => {
    const field = statFields(pid)?.[1];
    return field === undefined ? undefined : Number(field);
  },
  pidNs: (pid) => {
    try {
      return readlinkSync(join("/proc", String(pid), "ns", "pid"));
    } catch {
      return undefined;
    }
  },
  isZombie: (pid) => statFields(pid)?.[0] === "Z",
  kill: (pid) => {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Gone already, or not ours: the next poll says.
    }
  },
};

/** True when `argv` binds `boxDir` at the box mount: this launch's bwrap. */
function isBoxBwrap(argv: readonly string[], boxDir: string): boolean {
  return argv.some((word, index) => word === boxDir && argv[index + 1] === BOX_MOUNT);
}

/** The live processes of the box: the outer bwraps, and every process in a pid namespace one of them started. `spaces` keeps each namespace once seen. */
function boxProcesses(table: ProcTable, boxDir: string, ns: { own: string | undefined; spaces: Set<string> }): number[] {
  const pids = table.pids().filter((pid) => !table.isZombie(pid));
  const outer = new Set(pids.filter((pid) => table.pidNs(pid) === ns.own && isBoxBwrap(table.cmdline(pid) ?? [], boxDir)));
  for (const pid of pids) {
    const space = table.pidNs(pid);
    if (space === undefined || space === ns.own) continue;
    const parent = table.ppid(pid);
    if ((parent !== undefined && outer.has(parent)) || isBoxBwrap(table.cmdline(pid) ?? [], boxDir)) ns.spaces.add(space);
  }
  return pids.filter((pid) => outer.has(pid) || ns.spaces.has(table.pidNs(pid) ?? ""));
}

/** What the reap did: how many processes it killed, and the ones still alive after the wait. */
export interface Reaped {
  killed: number;
  left: number[];
  /** Why the reap could not run, when it threw. */
  error?: string;
}

/**
 * Kills every process of the box at `boxDir` and waits up to `waitMs` until
 * none is left. A pid namespace once seen stays on the list, so a process
 * that outlives its outer bwrap is still found.
 */
export async function reapBox(input: { boxDir: string; waitMs?: number; table?: ProcTable }): Promise<Reaped> {
  const table = input.table ?? PROC;
  const ns = { own: table.pidNs(process.pid), spaces: new Set<string>() };
  const polls = Math.ceil((input.waitMs ?? REAP_WAIT_MS) / REAP_POLL_MS);
  const killed = new Set<number>();
  for (let poll = 0; poll <= polls; poll += 1) {
    const live = boxProcesses(table, input.boxDir, ns);
    if (live.length === 0) return { killed: killed.size, left: [] };
    if (poll === polls) return { killed: killed.size, left: live };
    for (const pid of live) {
      table.kill(pid);
      killed.add(pid);
    }
    await new Promise((resolve) => setTimeout(resolve, REAP_POLL_MS));
  }
  return { killed: killed.size, left: [] };
}
