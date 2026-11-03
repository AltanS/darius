/**
 * The first message in a herdr tab must land (0.124.1). `agent start` can
 * return before Claude Code draws its folder trust dialog, and a prompt typed
 * into the dialog is lost. launchHerdr then confirms the prompt (agent
 * working, gate log grown, protocol line) and sends it again when it did not
 * land, at most twice.
 *
 * launchHerdr runs against a fake `herdr` script. Its `agent get` pops one
 * state per call from a `states` file (the last one repeats), and
 * `after-<n>` replaces the states once the n-th prompt arrived. Nothing here
 * reaches a real herdr.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { launchHerdr, type HerdrPlan } from "../src/surface/herdr.ts";

const ROOT = mkdtempSync(join(tmpdir(), "darius-herdr-prompt-"));

const FAKE = `#!/usr/bin/env bash
set -euo pipefail
dir="$FAKE_HERDR_DIR"
printf '%s\\n' "$*" >> "$dir/calls"
case "$1 \${2:-}" in
  "workspace list") printf '{"result":{"workspaces":[{"label":"darius-runs","workspace_id":"w1"}]}}\\n' ;;
  "tab create") printf '{"result":{"tab":{"tab_id":"w1:t1"},"root_pane":{"pane_id":"w1:p1"}}}\\n' ;;
  "agent start") printf '{"result":{"type":"agent_started"}}\\n' ;;
  "agent prompt")
    n=$(( $(cat "$dir/prompt-count" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$dir/prompt-count"
    if [ -e "$dir/after-$n" ]; then cp "$dir/after-$n" "$dir/states"; fi
    if [ -e "$dir/gate-after-$n" ]; then echo '{"decision":"allow"}' >> "$RUN_DIR/gate.jsonl"; fi
    printf '{"result":{"type":"agent_prompted"}}\\n' ;;
  "agent get")
    f="$dir/states"
    state="$(head -n1 "$f")"
    if [ "$(wc -l < "$f")" -gt 1 ]; then tail -n +2 "$f" > "$f.next"; mv "$f.next" "$f"; fi
    if [ "$state" = gone ]; then
      printf '{"error":{"code":"agent_not_found","message":"gone"}}\\n' >&2; exit 1
    fi
    printf '{"result":{"agent":{"agent_status":"%s"}}}\\n' "$state" ;;
  "tab close") printf '{"result":{"type":"ok"}}\\n' ;;
  *) printf '{"error":{"code":"unknown","message":"fake herdr: %s"}}\\n' "$*" >&2; exit 1 ;;
esac
`;

interface Case {
  dir: string;
  runDir: string;
  held: string[];
  plan: HerdrPlan;
}

/** A fake herdr dir and a plan with short times. `states` is the agent's state per `agent get`. */
function setup(name: string, states: string[], extra: { after?: Record<number, string[]>; gateAfter?: number; closed?: boolean } = {}): Case {
  const dir = join(ROOT, name);
  const runDir = join(dir, "run");
  mkdirSync(runDir, { recursive: true });
  const bin = join(dir, "herdr");
  writeFileSync(bin, FAKE);
  chmodSync(bin, 0o755);
  writeFileSync(join(dir, "states"), `${states.join("\n")}\n`);
  for (const [n, list] of Object.entries(extra.after ?? {})) writeFileSync(join(dir, `after-${n}`), `${list.join("\n")}\n`);
  if (extra.gateAfter !== undefined) writeFileSync(join(dir, `gate-after-${String(extra.gateAfter)}`), "");
  process.env.FAKE_HERDR_DIR = dir;
  process.env.RUN_DIR = runDir;
  const held: string[] = [];
  const plan: HerdrPlan = {
    target: { bin },
    kind: "claude",
    argv: ["claude"],
    message: "Run ritual x now.",
    cwd: dir,
    env: {},
    label: "x abc123",
    run: `run-${name}`,
    runDir,
    timeoutMs: 20_000,
    pollMs: 20,
    graceMs: 400,
    confirmMs: 3_000,
    idleMs: 150,
    phase: () => (extra.closed === true || held.length > 0 ? "closed" : "running"),
    hold: (question) => {
      held.push(question);
    },
  };
  return { dir, runDir, held, plan };
}

function calls(c: Case): string[] {
  return readFileSync(join(c.dir, "calls"), "utf8").trim().split("\n");
}

function prompts(c: Case): number {
  return calls(c).filter((line) => line.startsWith("agent prompt")).length;
}

function runLog(c: Case): string {
  const file = join(c.runDir, "run.log");
  return existsSync(file) ? readFileSync(file, "utf8") : "";
}

test("start ok, the agent stays idle with no sign of work: one resend, then the agent works", async () => {
  const c = setup("idle-once", ["idle"], { after: { 2: ["working", "gone"] } });
  const result = await launchHerdr(c.plan);
  assert.equal(prompts(c), 2, calls(c).join("\n"));
  assert.match(result.stderrTail, /the agent exited/u);
  assert.equal(c.held.length, 0);
  const lines = runLog(c).trim().split("\n");
  assert.equal(lines.length, 1, runLog(c));
  assert.match(lines[0] ?? "", /first message did not land \(the agent stayed idle for 150 ms with no sign of work\); sending it again \(resend 1 of 2\)/u);
});

test("start ok, then a dialog (blocked), then idle: it waits for the dialog and sends the prompt once more", async () => {
  const c = setup("dialog", ["blocked", "blocked", "blocked", "blocked", "idle"], { after: { 2: ["working", "gone"] } });
  await launchHerdr(c.plan);
  const all = calls(c);
  assert.equal(prompts(c), 2, all.join("\n"));
  const between = all.slice(all.findIndex((line) => line.startsWith("agent prompt")) + 1, all.findLastIndex((line) => line.startsWith("agent prompt")));
  assert.ok(between.filter((line) => line.startsWith("agent get")).length >= 4, "it polled until the dialog was answered");
  assert.match(runLog(c), /a dialog was up\); sending it again \(resend 1 of 2\)/u);
  assert.equal(runLog(c).trim().split("\n").length, 1);
});

test("start ok, the agent goes working: the prompt landed, no resend", async () => {
  const c = setup("working", ["working", "gone"]);
  const result = await launchHerdr(c.plan);
  assert.equal(prompts(c), 1, calls(c).join("\n"));
  assert.equal(runLog(c), "");
  assert.match(result.stderrTail, /the agent exited/u);
});

test("a gate log line is a sign too: an agent that stays idle after a tool call gets no resend", async () => {
  const c = setup("gate-line", ["idle"], { gateAfter: 1 });
  await launchHerdr(c.plan);
  assert.equal(prompts(c), 1, calls(c).join("\n"));
  assert.equal(runLog(c), "");
  assert.match(c.held[0] ?? "", /the agent waits for input in herdr tab "x abc123" \(idle for over/u, "the normal watch holds it");
});

test("a run that already has a protocol line needs no resend", async () => {
  const c = setup("protocol", ["idle"], { closed: true });
  await launchHerdr(c.plan);
  assert.equal(prompts(c), 1);
  assert.equal(runLog(c), "");
});

test("the prompt never lands: exactly two resends, then the normal watch holds the run", async () => {
  const c = setup("never", ["idle"]);
  const result = await launchHerdr(c.plan);
  assert.equal(prompts(c), 3, "the first send and two resends, never a fourth");
  const lines = runLog(c).trim().split("\n");
  assert.equal(lines.length, 2, runLog(c));
  assert.match(lines[0] ?? "", /resend 1 of 2/u);
  assert.match(lines[1] ?? "", /resend 2 of 2/u);
  assert.equal(c.held.length, 1);
  assert.match(c.held[0] ?? "", /the agent waits for input in herdr tab "x abc123" \(idle for over/u);
  assert.match(result.stderrTail, /past the grace time/u);
});
