/**
 * The run page does not wait for the follow-up readiness (0.98.0). The check
 * is an ssh dry run of up to 30 s for a ritual pinned to another host. The
 * real WebContext reads a seeded `darius-selftest` project, a ritual pinned
 * to another host has a finished run with a command question, and the
 * committed app build renders `/w/darius-selftest/runs/<run>`. The context's
 * readiness is a stub that takes 5 s and records every call: the page must
 * render in under 1 s and never call it, and the card must hold its place
 * with the busy gem and the sentence that names the ritual's host.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseArgs } from "../src/cli/args.ts";
import type { Command, ParsedArgs } from "../src/cli/registry.ts";
import { ritualCommand } from "../src/cli/ritual.ts";
import { runCommand } from "../src/cli/run.ts";
import type { FollowUpReadiness, WebHandler } from "../src/web/api.ts";
import { webContext } from "../src/web/context.ts";

const SANDBOX = mkdtempSync(join(tmpdir(), "darius-web-serve-run-fast-"));
process.env.DARIUS_STATE_DIR = join(SANDBOX, "state");
process.env.DARIUS_CONFIG_DIR = join(SANDBOX, "config");
process.env.DARIUS_TAILSCALE = join(SANDBOX, "no-tailscale");

const built: { default: WebHandler } = await import("../web/build/server/index.js");

const PROJECT = "darius-selftest";
const SLOW_MS = 5_000;
const FAST_MS = 1_000;

async function cli(command: Command, argv: string[], stdin?: string): Promise<string> {
  const args: ParsedArgs = parseArgs([...argv, "--project", PROJECT]);
  if (stdin !== undefined) args.stdin = stdin;
  const out: string[] = [];
  const { log } = console;
  console.log = (...parts: string[]) => out.push(parts.join(" "));
  try {
    assert.equal(await command.run(args), 0, argv.join(" "));
  } finally {
    console.log = log;
  }
  return out.join("\n");
}

/** The result block of a run, as far as this test needs it. */
interface ResultBlock {
  v: 1;
  status: "ok" | "attention";
  summary: string;
  questions?: { text: string; commands: string[] }[];
}

/** A ritual pinned to another host, and a finished run of it that asks one question with a command. */
async function seed(): Promise<{ withCommands: string; plain: string }> {
  await cli(ritualCommand, ["add", "remote-check", "--title", "Remote check", "--cadence", "1d", "--host", "host-b"]);
  const finish = async (block: ResultBlock): Promise<string> => {
    const run = JSON.parse(await cli(runCommand, ["start", "remote-check", "--json"])).run;
    await cli(runCommand, ["complete", run, "--outcome", "complete", "--findings-stdin"], `done\n\`\`\`darius-result\n${JSON.stringify(block)}\n\`\`\`\n`);
    return run;
  };
  const plain = await finish({ v: 1, status: "ok", summary: "all fine" });
  const withCommands = await finish({ v: 1, status: "attention", summary: "checked", questions: [{ text: "Push the fix?", commands: ["git push origin main"] }] });
  return { withCommands, plain };
}

const { withCommands, plain } = await seed();

/** The real context with a readiness that takes SLOW_MS and counts its calls. */
function slowContext() {
  const calls: string[] = [];
  const context = webContext("owner on phone", "bm9uY2U=");
  context.followUp = (project, run) => {
    calls.push(`${project}/${run}`);
    return new Promise<FollowUpReadiness>((resolve) => {
      setTimeout(() => resolve({ ready: false, host: "host-a", reason: "too late" }), SLOW_MS).unref();
    });
  };
  return { context, calls };
}

const text = (html: string): string => html.replaceAll(/<script\b[\s\S]*?<\/script>/gu, " ").replaceAll(/<[^>]*>/gu, " ").replaceAll(/\s+/gu, " ");

test("a run with a command question of a ritual pinned to another host renders in under 1 s, with the card's place held by the busy gem", async () => {
  const { context, calls } = slowContext();
  const started = Date.now();
  const response = await built.default(new Request(`http://darius.test/w/${PROJECT}/runs/${withCommands}`), context);
  const html = await response.text();
  const took = Date.now() - started;
  assert.equal(response.status, 200);
  assert.ok(took < FAST_MS, `the page took ${String(took)} ms`);
  assert.deepEqual(calls, [], "the loader never asks for the readiness");
  assert.match(text(html), /Follow-up Checking whether a follow-up can start on host-b…/u, "the ritual's host, not this one");
  assert.match(html, /<svg[^>]*class="gem gem-busy"/u, "the busy gem");
});

test("a plain followable run shows no Follow-up section while the check is open", async () => {
  const { context, calls } = slowContext();
  const response = await built.default(new Request(`http://darius.test/w/${PROJECT}/runs/${plain}`), context);
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.deepEqual(calls, []);
  assert.equal(html.includes('<h2 class="label">Follow-up</h2>'), false, "an empty section does not render");
  assert.equal(text(html).includes("Checking whether a follow-up"), false);
});
