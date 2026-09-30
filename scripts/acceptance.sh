#!/usr/bin/env bash
# Acceptance run for darius on the lead host, the one that runs the bucket
# (docs/plan-tonight.md, task T14).
#
# Runs nine steps against the REAL store (~/.local/share/darius, or
# $DARIUS_STATE_DIR), the real config (~/.config/darius) and the real bucket.
# It stops at the first failed step and names it. Each step prints one line:
# ✓ when it passed, ✗ when it failed.
#
# Safe to run again. A second run on the same host must pass too:
#   - `selftest seed` is idempotent.
#   - A selftest vigil that an earlier run already closed is checked for the
#     verdict it recorded, not for a fresh transition.
#   - Step 4's second host is a throwaway state dir, removed at exit.
#   - Step 7 starts the real `claude -p` only when heartbeat has no completed
#     run today. Otherwise it checks that run and starts nothing.
#
# What it never does: write under any .tracker/ directory, touch another
# SeaweedFS's seaweedfs.service or port 9900, sweep or run-due the acceptance
# repo, or print a credential value. Every command runs under `timeout`.
#
# Environment overrides:
#   DARIUS_ACCEPTANCE_REPO  a checkout with a .tracker/ directory to import
#                           read-only (step 5). Unset: step 5 is skipped.
#   DARIUS_TRACKER_CLI      the legacy tracker CLI (tracker.mts). Unset: step 5
#                           skips the comparison with the legacy due list.
#   DARIUS_TAILNET_IP       this host's tailnet address (default: the first
#                           line of `tailscale ip -4`; step 3 fails without one)
#   DARIUS_PORT         the SeaweedFS S3 port (default 9910)
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 1

DARIUS="$ROOT/bin/darius"
ACCEPTANCE_REPO="${DARIUS_ACCEPTANCE_REPO:-}"
TRACKER_CLI="${DARIUS_TRACKER_CLI:-}"
TAILNET_IP="${DARIUS_TAILNET_IP:-}"
if [ -z "$TAILNET_IP" ] && command -v tailscale >/dev/null 2>&1; then
  TAILNET_IP="$(timeout 10 tailscale ip -4 2>/dev/null | head -n 1)"
fi
PORT="${DARIUS_PORT:-9910}"
SELFTEST="darius-selftest"
STORE="${DARIUS_STATE_DIR:-$HOME/.local/share/darius}"
TIMERS=(darius-sync.timer darius-vigil-sweep.timer darius-run-due.timer)

WORK="$(mktemp -d "${TMPDIR:-/tmp}/darius-acceptance.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

STEP=""

begin() { STEP="$1"; }
pass() { printf '✓ %s: %s\n' "$STEP" "$1"; }
fail() {
  printf '✗ %s: %s\n' "$STEP" "$1"
  shift
  for file in "$@"; do
    [ -s "$file" ] || continue
    printf '  --- %s (last 30 lines) ---\n' "$(basename "$file")"
    tail -n 30 "$file" | sed 's/^/  /'
  done
  printf '✗ acceptance stopped at step "%s"\n' "$STEP"
  exit 1
}
note() { printf '  %s\n' "$1"; }

# run NAME SECONDS CMD... : stdout to $WORK/NAME.out, stderr to $WORK/NAME.err.
# Returns the command's exit code. A timeout stops the whole run at once.
run() {
  local name="$1" secs="$2"
  shift 2
  timeout -k 10 "$secs" "$@" >"$WORK/$name.out" 2>"$WORK/$name.err"
  local rc=$?
  if [ "$rc" -eq 124 ] || [ "$rc" -eq 137 ]; then
    fail "'$*' hung and was stopped after ${secs}s" "$WORK/$name.out" "$WORK/$name.err"
  fi
  return "$rc"
}

# The JSON checks, in one small node program. `node checks.mjs <check> <files...>`
# prints one summary line and exits 0, or prints why and exits 1.
cat >"$WORK/checks.mjs" <<'JS'
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const [check, ...files] = process.argv.slice(2);
const load = (file) => JSON.parse(readFileSync(file, "utf8"));
const die = (message) => { console.log(message); process.exit(1); };
const localDate = (iso) => new Date(iso).toLocaleDateString("sv-SE");
const today = new Date().toLocaleDateString("sv-SE");

function vigils(statusFile) {
  const map = new Map();
  for (const vigil of load(statusFile).vigils) map.set(vigil.slug, vigil);
  return map;
}
function swept(sweepFile) {
  const map = new Map();
  for (const vigil of load(sweepFile).vigils) map.set(vigil.slug, vigil);
  return map;
}
function need(map, slug) {
  const value = map.get(slug);
  if (value === undefined) die(`vigil ${slug} is missing`);
  return value;
}
function closedHeld(status, slug) {
  const vigil = need(status, slug);
  if (vigil.state !== "closed" || vigil.verdict !== "held") {
    die(`${slug}: expected closed held, found ${vigil.state} ${vigil.verdict ?? ""}`.trimEnd());
  }
}

const checks = {
  setupRerun([file]) {
    const report = load(file);
    if (!report.ok) die(`setup reported ok=false`);
    const busy = report.steps.filter((step) => step.skipped !== true);
    if (busy.length > 0) die(`second run still did work: ${busy.map((s) => `${s.what} (${s.detail})`).join("; ")}`);
    console.log(`second run: ${report.steps.length} steps, all skipped`);
  },
  setupOk([file]) {
    const report = load(file);
    if (!report.ok) die(`setup reported ok=false: ${report.steps.filter((s) => !s.ok).map((s) => s.detail).join("; ")}`);
    console.log(report.steps.map((s) => `${s.what}=${s.skipped === true ? "unchanged" : "done"}`).join(" "));
  },
  seed([file]) {
    const report = load(file);
    const got = report.items.map((i) => `${i.kind}/${i.slug}`).toSorted().join(" ");
    const want = ["ritual/heartbeat", "vigil/date-held", "vigil/date-failed", "vigil/event-gated", "vigil/heavy-one", "vigil/mixed-manual"].toSorted().join(" ");
    if (got !== want) die(`seed items differ: got ${got}`);
    const added = report.items.filter((i) => i.status === "added").length;
    console.log(`1 ritual, 5 vigils (${added} added, ${report.items.length - added} unchanged)`);
  },
  syncOk([file]) {
    const report = load(file);
    if (!report.ok || report.errors.length > 0) die(`sync not ok: ${JSON.stringify(report.errors)}`);
    const p = report.projects[0];
    if (p === undefined) die("sync reported no project");
    if (p.skipped !== undefined) die(`sync skipped: ${p.skipped}`);
    console.log(`chunks ${p.pulledChunks} in / ${p.pushedChunks} out, items ${p.itemsPulled} in / ${p.itemsPushed} out`);
  },
  hasHeartbeat([file]) {
    const rows = load(file).rituals;
    const row = rows.find((r) => r.slug === "heartbeat");
    if (row === undefined) die(`due on the second store has no heartbeat (rituals: ${rows.map((r) => r.slug).join(", ") || "none"})`);
    console.log(`second store sees heartbeat (lifecycle ${row.lifecycle}, next due ${row.nextDue ?? "-"})`);
  },
  importFirst([file]) {
    const r = load(file);
    if (r.rituals.found < 1) die("import found no rituals");
    if (r.problems.length > 0) die(`import problems: ${r.problems.join("; ")}`);
    console.log(`${r.rituals.found} rituals, ${r.evidence.found} evidence lines, ${r.totalNew} new`);
  },
  importAgain([file]) {
    const r = load(file);
    if (r.totalNew !== 0) die(`second import wrote ${r.totalNew} new lines, expected 0`);
    console.log("second import: 0 new");
  },
  dueSets([dariusFile, legacyFile]) {
    const ours = new Set(load(dariusFile).rituals.filter((r) => r.isDue).map((r) => r.slug));
    const theirs = new Set(load(legacyFile).rituals.map((r) => r.slug).filter((s) => s !== "cohort-assign"));
    const onlyOurs = [...ours].filter((s) => !theirs.has(s));
    const onlyTheirs = [...theirs].filter((s) => !ours.has(s));
    if (onlyOurs.length + onlyTheirs.length > 0) {
      die(`due sets differ. only darius: [${onlyOurs.join(", ")}]; only legacy: [${onlyTheirs.join(", ")}]`);
    }
    console.log(`same ${ours.size} due rituals: ${[...ours].toSorted().join(", ")}`);
  },
  sweepFirst([sweepFile, beforeFile, afterFile]) {
    const s = swept(sweepFile);
    const before = vigils(beforeFile);
    const after = vigils(afterFile);
    const out = [];
    // date-held: auto-closes held, or was closed held by an earlier run.
    if (need(before, "date-held").state === "closed") { closedHeld(before, "date-held"); out.push("date-held already closed held"); }
    else {
      const v = need(s, "date-held");
      if (v.outcome !== "held" || !v.closed) die(`date-held: expected outcome held and closed, got ${v.outcome} closed=${v.closed}`);
      closedHeld(after, "date-held");
      out.push("date-held closed held");
    }
    // date-failed: fails, stays armed, flagged.
    const failed = need(s, "date-failed");
    if (failed.outcome !== "failed" || failed.closed || !failed.flagged) {
      die(`date-failed: expected failed, open, flagged; got ${failed.outcome} closed=${failed.closed} flagged=${failed.flagged}`);
    }
    if (need(after, "date-failed").state !== "open") die("date-failed was closed");
    out.push("date-failed failed+open+flagged");
    // event-gated: gate not fired, nothing else.
    if (need(before, "event-gated").state === "closed") { closedHeld(before, "event-gated"); out.push("event-gated already closed held"); }
    else {
      const v = need(s, "event-gated");
      if (v.gate !== "not-fired" || v.closed || v.checks.length > 0) die(`event-gated: expected gate not-fired and no checks, got gate=${v.gate} closed=${v.closed} checks=${v.checks.length}`);
      out.push("event-gated not-fired");
    }
    // heavy-one: bucket heavy, no execution.
    if (need(before, "heavy-one").state === "closed") { closedHeld(before, "heavy-one"); out.push("heavy-one already closed held"); }
    else {
      const v = need(s, "heavy-one");
      if (v.bucket !== "heavy" || v.closed || v.checks.length > 0) die(`heavy-one: expected bucket heavy and no checks, got ${v.bucket} checks=${v.checks.length}`);
      out.push("heavy-one bucket heavy");
    }
    // mixed-manual: awaiting-manual, open, not flagged.
    const mixed = need(s, "mixed-manual");
    if (mixed.outcome !== "awaiting-manual" || mixed.closed || mixed.flagged) {
      die(`mixed-manual: expected awaiting-manual, open, not flagged; got ${mixed.outcome} closed=${mixed.closed} flagged=${mixed.flagged}`);
    }
    out.push("mixed-manual awaiting-manual");
    console.log(out.join(", "));
  },
  sweepFired([sweepFile, beforeFile, afterFile]) {
    const before = vigils(beforeFile);
    if (need(before, "event-gated").state !== "closed") {
      const v = need(swept(sweepFile), "event-gated");
      if (v.gate !== "fired" || v.outcome !== "held" || !v.closed) die(`event-gated after the marker: gate=${v.gate} outcome=${v.outcome} closed=${v.closed}`);
    }
    closedHeld(vigils(afterFile), "event-gated");
    console.log("event-gated closed held");
  },
  sweepHeavy([sweepFile, beforeFile, afterFile]) {
    const before = vigils(beforeFile);
    if (need(before, "heavy-one").state !== "closed") {
      const v = need(swept(sweepFile), "heavy-one");
      if (v.outcome !== "held" || !v.closed) die(`heavy-one with --include-heavy: outcome=${v.outcome} closed=${v.closed}`);
    }
    const after = vigils(afterFile);
    closedHeld(after, "heavy-one");
    for (const slug of ["date-failed", "mixed-manual"]) {
      if (need(after, slug).state !== "open") die(`${slug} should still be open`);
    }
    console.log("heavy-one closed held; date-failed and mixed-manual still open");
  },
  vigilState([statusFile, slug]) {
    console.log(need(vigils(statusFile), slug).state);
  },
  // Exit 0 and print the run id when heartbeat already completed today.
  // Exit 10 when a fresh run is needed. Exit 1 when today's run failed or is open.
  heartbeatToday([listFile]) {
    const runs = load(listFile).runs.filter((r) => r.item === "ritual/heartbeat" && localDate(r.startedAt) === today);
    const done = runs.findLast((r) => r.phase === "closed" && r.outcome === "complete");
    if (done !== undefined) { console.log(done.run); return; }
    const other = runs.at(-1);
    if (other !== undefined) die(`heartbeat run ${other.run} today is ${other.phase}${other.outcome ? ` (${other.outcome})` : ""}; not starting another`);
    process.exit(10);
  },
  runDueReport([file]) {
    const report = load(file);
    const project = report.projects.find((p) => p.project === "darius-selftest");
    if (project === undefined) die("report has no darius-selftest entry");
    const entry = project.rituals.find((r) => r.slug === "heartbeat");
    if (entry === undefined) die("report has no heartbeat entry");
    if (entry.action !== "started") die(`heartbeat was not started: ${entry.action} ${entry.reason ?? ""} ${entry.detail ?? ""}`);
    if (entry.end !== "complete") die(`heartbeat ended ${entry.end} (exit ${entry.exitCode}, timedOut ${entry.timedOut})`);
    console.log(entry.run);
  },
  runSummary([listFile, storeRoot, runId, reportFile]) {
    const row = load(listFile).runs.find((r) => r.run === runId);
    if (row === undefined) die(`run ${runId} not in run list`);
    if (row.phase !== "closed" || row.outcome !== "complete") die(`run ${runId} is ${row.phase} ${row.outcome}`);
    const lines = [];
    const ledgerDir = join(storeRoot, "ledger");
    for (const host of readdirSync(ledgerDir)) {
      for (const chunk of readdirSync(join(ledgerDir, host))) {
        if (!chunk.endsWith(".jsonl")) continue;
        for (const text of readFileSync(join(ledgerDir, host, chunk), "utf8").split("\n")) {
          if (text.trim() === "") continue;
          const line = JSON.parse(text);
          if (line.run === runId) lines.push(line);
        }
      }
    }
    const completed = lines.filter((l) => l.type === "run.completed");
    if (completed.length !== 1) die(`expected one run.completed for ${runId}, found ${completed.length}`);
    const started = lines.find((l) => l.type === "run.started");
    const done = completed[0];
    console.log(`run ${runId}: started ${started?.at} by ${started?.who}, completed ${done.at} by ${done.who}, outcome ${done.outcome}${done.session_id ? `, session ${done.session_id}` : ""}`);
    if (reportFile !== undefined && existsSync(reportFile)) {
      const entry = load(reportFile).projects.flatMap((p) => p.rituals).find((r) => r.run === runId);
      if (entry !== undefined) {
        const cost = entry.costUsd === undefined ? "not reported" : `$${entry.costUsd.toFixed(4)}`;
        console.log(`claude exit ${entry.exitCode}, ${Math.round((entry.durationMs ?? 0) / 1000)} s, cost ${cost}`);
      }
    }
    const sha = done.findings_sha;
    const blob = typeof sha === "string" ? join(storeRoot, "blobs", sha) : "";
    if (blob === "" || !existsSync(blob)) { console.log("findings: none recorded"); return; }
    console.log("findings:");
    for (const text of readFileSync(blob, "utf8").slice(0, 2000).trimEnd().split("\n")) console.log(`| ${text}`);
  },
};

const fn = checks[check];
if (fn === undefined) die(`unknown check ${check}`);
fn(files);
JS

js() { timeout -k 5 30 node --no-warnings "$WORK/checks.mjs" "$@"; }

printf 'darius acceptance on %s, %s, HEAD %s\n' "$(hostname -s)" "$(date '+%Y-%m-%d %H:%M %Z')" "$(git -C "$ROOT" rev-parse --short HEAD)"
printf 'store %s\n\n' "$STORE"

# --- 1. the three gates ----------------------------------------------------------
begin "1 gates"
run lint 300 bun run lint || fail "lint failed" "$WORK/lint.out" "$WORK/lint.err"
run tsc 300 bun x tsc --noEmit || fail "typecheck failed" "$WORK/tsc.out" "$WORK/tsc.err"
run test 900 bun run test || fail "test suite failed" "$WORK/test.out" "$WORK/test.err"
tests="$(grep -E '^ℹ (tests|pass|fail) ' "$WORK/test.out" | tr -d 'ℹ' | xargs)"
pass "lint, typecheck and suite green ($tests)"

# --- 2. setup twice -----------------------------------------------------------------
begin "2 setup"
run setup1 180 "$DARIUS" setup --systemd --remote --json || fail "first setup exited non-zero" "$WORK/setup1.out" "$WORK/setup1.err"
first="$(js setupOk "$WORK/setup1.out")" || fail "$first"
run setup2 180 "$DARIUS" setup --systemd --remote --json || fail "second setup exited non-zero" "$WORK/setup2.out" "$WORK/setup2.err"
second="$(js setupRerun "$WORK/setup2.out")" || fail "$second"
pass "first run: $first; $second"

# --- 2b. the Claude Code skill, into a throwaway config dir ---------------------------
# Never the real ~/.claude: CLAUDE_CONFIG_DIR points into $WORK.
begin "2b skill"
SKILL_DIR="$WORK/claude"
SKILL_FILE="$SKILL_DIR/skills/darius/SKILL.md"
run skill1 30 env CLAUDE_CONFIG_DIR="$SKILL_DIR" "$DARIUS" skill install || fail "skill install exited non-zero" "$WORK/skill1.out" "$WORK/skill1.err"
[ "$(cat "$WORK/skill1.out")" = "$SKILL_FILE" ] || fail "skill install did not print $SKILL_FILE" "$WORK/skill1.out"
bytes="$(wc -c <"$SKILL_FILE")"
[ "$bytes" -lt 4096 ] || fail "the skill is $bytes bytes, over 4096"
grep -q '^<!-- darius-skill ' "$SKILL_FILE" || fail "the skill has no darius stamp"
run skill2 30 env CLAUDE_CONFIG_DIR="$SKILL_DIR" "$DARIUS" skill uninstall || fail "skill uninstall exited non-zero" "$WORK/skill2.out" "$WORK/skill2.err"
[ ! -e "$SKILL_FILE" ] || fail "skill uninstall left $SKILL_FILE"
pass "installed $bytes bytes with a stamp, then removed it"

# --- 2c. legacy verbs under both runtimes, in a throwaway repo -------------------------
# darius hands every verb it does not own to the vendored legacy CLI
# (src/core/kinds.ts). Both runtimes must run it and print the same thing.
begin "2c legacy"
LEGACY_REPO="$WORK/legacy-repo"
mkdir -p "$LEGACY_REPO/.tracker"
cp -R "$ROOT/test/fixtures/tracker-mini/." "$LEGACY_REPO/.tracker/"
for runtime in node bun; do
  (cd "$LEGACY_REPO" && run "status-$runtime" 60 env DARIUS_RUNTIME="$runtime" "$DARIUS" status) || fail "darius status failed under $runtime" "$WORK/status-$runtime.out" "$WORK/status-$runtime.err"
  (cd "$LEGACY_REPO" && run "vigils-$runtime" 60 env DARIUS_RUNTIME="$runtime" "$DARIUS" vigil list --json) || fail "darius vigil list --json failed under $runtime" "$WORK/vigils-$runtime.out" "$WORK/vigils-$runtime.err"
done
cmp -s "$WORK/status-node.out" "$WORK/status-bun.out" || fail "darius status differs between node and bun" "$WORK/status-node.out" "$WORK/status-bun.out"
cmp -s "$WORK/vigils-node.out" "$WORK/vigils-bun.out" || fail "darius vigil list --json differs between node and bun" "$WORK/vigils-node.out" "$WORK/vigils-bun.out"
pass "darius status and darius vigil list --json run under node and bun, same output"

# --- 3. SeaweedFS -------------------------------------------------------------------
begin "3 seaweedfs"
[ -n "$TAILNET_IP" ] || fail "no tailnet address: set DARIUS_TAILNET_IP or start tailscale"
state="$(timeout 10 systemctl --user is-active darius-seaweedfs.service)"
[ "$state" = "active" ] || fail "darius-seaweedfs.service is '$state', expected active"
for host in 127.0.0.1 "$TAILNET_IP"; do
  timeout 15 curl -fsS -o /dev/null "http://$host:$PORT/status" || fail "curl http://$host:$PORT/status failed"
done
binds="$(timeout 10 ss -ltnH "sport = :$PORT" | awk '{print $4}' | sort | xargs)"
want="$(printf '%s\n' "127.0.0.1:$PORT" "$TAILNET_IP:$PORT" | sort | xargs)"
[ "$binds" = "$want" ] || fail "port $PORT listens on '$binds', expected exactly '$want'"
other="$(timeout 10 systemctl --user is-active seaweedfs.service)"
[ "$other" = "inactive" ] || fail "the other seaweedfs.service is '$other', expected inactive"
pass "service active; /status 200 on 127.0.0.1 and $TAILNET_IP; binds: $binds; other seaweedfs.service inactive"

# --- 4. sync round-trip -------------------------------------------------------------
begin "4 sync"
run seed 60 "$DARIUS" selftest seed --project "$SELFTEST" --json || fail "selftest seed failed" "$WORK/seed.out" "$WORK/seed.err"
seeded="$(js seed "$WORK/seed.out")" || fail "$seeded"
run sync 120 "$DARIUS" sync --project "$SELFTEST" --json || fail "sync exited non-zero" "$WORK/sync.out" "$WORK/sync.err"
pushed="$(js syncOk "$WORK/sync.out")" || fail "$pushed"
second_store="$WORK/second-host"
mkdir -p "$second_store"
DARIUS_STATE_DIR="$second_store" run pull 120 "$DARIUS" sync --project "$SELFTEST" --pull-only --json ||
  fail "second store pull exited non-zero" "$WORK/pull.out" "$WORK/pull.err"
pulled="$(js syncOk "$WORK/pull.out")" || fail "$pulled"
DARIUS_STATE_DIR="$second_store" run due2 60 "$DARIUS" due --project "$SELFTEST" --json ||
  fail "due on the second store failed" "$WORK/due2.out" "$WORK/due2.err"
seen="$(js hasHeartbeat "$WORK/due2.out")" || fail "$seen"
pass "$seeded; push: $pushed; second store pull: $pulled; $seen"

# --- 5. import a checkout's .tracker/, read-only --------------------------------------
begin "5 import"
if [ -z "$ACCEPTANCE_REPO" ]; then
  printf '%s\n' "- 5 import: skipped: set DARIUS_ACCEPTANCE_REPO to a checkout that has a .tracker/ directory"
else
  tracker="$ACCEPTANCE_REPO/.tracker"
  [ -d "$tracker" ] || fail "no tracker at $tracker"
  before="$(timeout 30 git -C "$ACCEPTANCE_REPO" status --porcelain --ignored -- .tracker)"
  run import1 300 "$DARIUS" import "$tracker" --project acme-web --json ||
    fail "import failed" "$WORK/import1.out" "$WORK/import1.err"
  imported="$(js importFirst "$WORK/import1.out")" || fail "$imported"
  run import2 300 "$DARIUS" import "$tracker" --project acme-web --json ||
    fail "second import failed" "$WORK/import2.out" "$WORK/import2.err"
  again="$(js importAgain "$WORK/import2.out")" || fail "$again"
  after="$(timeout 30 git -C "$ACCEPTANCE_REPO" status --porcelain --ignored -- .tracker)"
  [ "$before" = "$after" ] || fail "git status of .tracker changed during import: before '$before', after '$after'"
  [ -z "$(timeout 30 git -C "$ACCEPTANCE_REPO" status --porcelain -- .tracker)" ] ||
    fail "git status --porcelain .tracker is not empty in $ACCEPTANCE_REPO"
  if [ -z "$TRACKER_CLI" ]; then
    pass "$imported; $again; .tracker clean; legacy comparison skipped: set DARIUS_TRACKER_CLI"
  else
    run due-darius 60 "$DARIUS" due --project acme-web --json ||
      fail "darius due failed" "$WORK/due-darius.out" "$WORK/due-darius.err"
    (cd "$ACCEPTANCE_REPO" && run due-legacy 120 node --experimental-strip-types --no-warnings "$TRACKER_CLI" due --json) ||
      fail "legacy tracker due failed" "$WORK/due-legacy.out" "$WORK/due-legacy.err"
    compared="$(js dueSets "$WORK/due-darius.out" "$WORK/due-legacy.out")" || fail "$compared"
    pass "$imported; $again; .tracker clean; $compared (legacy minus cohort-assign)"
  fi
fi

# --- 6. vigil sweep on darius-selftest only --------------------------------------------
begin "6 sweep"
status() { run "$1" 60 "$DARIUS" selftest status --project "$SELFTEST" --json || fail "selftest status failed" "$WORK/$1.out" "$WORK/$1.err"; }
sweep() {
  local name="$1"
  shift
  run "$name" 300 "$DARIUS" vigil sweep --project "$SELFTEST" --json "$@" ||
    fail "vigil sweep $* exited non-zero" "$WORK/$name.out" "$WORK/$name.err"
}
status st0
# A marker left by an interrupted earlier run would fire the gate too soon.
if [ "$(js vigilState "$WORK/st0.out" event-gated)" = "open" ]; then
  rm -f "$STORE/$SELFTEST/fired.marker"
fi
sweep sw1
status st1
first="$(js sweepFirst "$WORK/sw1.out" "$WORK/st0.out" "$WORK/st1.out")" || fail "first sweep: $first"
run fire 30 "$DARIUS" selftest fire --project "$SELFTEST" --json || fail "selftest fire failed" "$WORK/fire.out" "$WORK/fire.err"
sweep sw2
status st2
fired="$(js sweepFired "$WORK/sw2.out" "$WORK/st1.out" "$WORK/st2.out")" || fail "after the marker: $fired"
sweep sw3 --include-heavy
status st3
heavy="$(js sweepHeavy "$WORK/sw3.out" "$WORK/st2.out" "$WORK/st3.out")" || fail "with --include-heavy: $heavy"
pass "$first; marker: $fired; --include-heavy: $heavy"

# --- 7. run-due with the real claude, once --------------------------------------------
begin "7 run-due"
run runs0 60 "$DARIUS" run list --project "$SELFTEST" --json || fail "run list failed" "$WORK/runs0.out" "$WORK/runs0.err"
run_id="$(js heartbeatToday "$WORK/runs0.out")"
rc=$?
if [ "$rc" -eq 0 ]; then
  mode="heartbeat already completed today; verified that run, started nothing"
elif [ "$rc" -eq 10 ]; then
  run rundue 420 "$DARIUS" run-due --unattended --project "$SELFTEST" --only heartbeat --who acceptance --timeout 300 --json ||
    fail "run-due exited non-zero" "$WORK/rundue.out" "$WORK/rundue.err"
  run_id="$(js runDueReport "$WORK/rundue.out")" || fail "$run_id" "$WORK/rundue.out" "$WORK/rundue.err"
  mode="started one real claude -p run"
else
  fail "$run_id"
fi
run runs1 60 "$DARIUS" run list --project "$SELFTEST" --json || fail "run list failed" "$WORK/runs1.out" "$WORK/runs1.err"
summary="$(js runSummary "$WORK/runs1.out" "$STORE/$SELFTEST" "$run_id" "$WORK/rundue.out")" || fail "$summary"
pass "$mode"
printf '%s\n' "$summary" | sed 's/^/  /'

# --- 8. timers ------------------------------------------------------------------------------
begin "8 timers"
listed="$(timeout 10 systemctl --user list-timers --all --no-legend)"
for timer in "${TIMERS[@]}"; do
  grep -q " $timer " <<<"$listed " || fail "$timer is not in systemctl --user list-timers"
  enabled="$(timeout 10 systemctl --user is-enabled "$timer")"
  [ "$enabled" = "enabled" ] || fail "$timer is '$enabled', expected enabled"
  active="$(timeout 10 systemctl --user is-active "$timer")"
  [ "$active" = "active" ] || fail "$timer is '$active', expected active"
done
# Prove a timer's service can actually start darius. Sync is the harmless one.
timeout -k 10 180 systemctl --user start darius-sync.service || true
result="$(timeout 10 systemctl --user show -p Result --value darius-sync.service)"
[ "$result" = "success" ] || fail "darius-sync.service ended '$result'; see: journalctl --user -u darius-sync.service -n 30"
pass "${TIMERS[*]} enabled and active; darius-sync.service ran once: $result"
grep -E 'darius-(sync|vigil-sweep|run-due)\.timer' <<<"$listed" | awk '{$1=$1; print}' | sed 's/^/  /'

# --- 9. another host --------------------------------------------------------------------------
# DARIUS_SECOND_HOST names it; its key must exist (DARIUS_CLIENT_HOSTS in
# scripts/seaweedfs-install.sh).
LEAD_HOST="${HOSTNAME%%.*}"
SECOND_HOST="${DARIUS_SECOND_HOST:-host-b}"
begin "9 another host"
pass "to add $SECOND_HOST: run steps 1 and 2 there, then step 3 here (no secrets are printed here)"
cat <<EOF
  # 1. on $SECOND_HOST: copy its credentials from $LEAD_HOST
  mkdir -p ~/.config/darius && scp $LEAD_HOST:.config/darius/keys/$SECOND_HOST.credentials ~/.config/darius/credentials && chmod 600 ~/.config/darius/credentials
  # 2. on $SECOND_HOST: write its config, a sync-only host that uses this host's bucket over the tailnet
  printf '%s\n' 'host = "$SECOND_HOST"' '' '[notify]' 'webhook = ""' '' '[remote]' 'endpoint = "http://$TAILNET_IP:$PORT"' 'bucket = "darius"' 'region = "us-east-1"' 'path_style = true' 'allow_http = true' 'sse = true' 'credentials = "~/.config/darius/credentials"' '' '[setup]' 'units = ["sync"]' > ~/.config/darius/config.toml
  # 3. here: install darius there over SSH, from this host's version
  darius update --hosts $SECOND_HOST
EOF

printf '\n✓ acceptance passed: 9 of 9 steps\n'
