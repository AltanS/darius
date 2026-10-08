---
name: darius-wrap-up
model: sonnet
context: fork
user-invocable: false
description: End-of-session reconciliation, rebuild index from specs, close stale worklogs, and commit all tracker changes
argument-hint: "[--dry-run]"
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, Skill
---

# Wrap Up

**Before anything else**, run this line with Bash. If it prints a message, show the message to the user and stop.

```bash
command -v darius >/dev/null || { echo "darius is not installed. Install it: bash <(curl -fsSL https://raw.githubusercontent.com/AltanS/darius/main/scripts/install.sh)"; exit 1; }
```

End-of-session skill: rebuild index from spec reality, close stale worklog threads, commit everything atomically.

A line that starts with `!darius ...` is a shell command. Run it with Bash and use its output. Spec paths are tracker-relative (`M1-x/01-y.md`). Find the tree with `darius root --json` (`trackerRoot`).

This skill runs in a fork: it does not see the conversation. It judges from the tracker and git only, never from "the current work". It asks nothing; it ends with the **Return** block.

## Phase 1: Rebuild Index (ALWAYS runs)

`!darius index --rebuild`

Wait for `darius index: rebuilt …` before proceeding. If exit non-zero, surface the error and stop.

This one command rebuilds both indexes: `00-INDEX.md` and the worklog index at `worklog/00-INDEX.md`, both in the tracker tree (the latter is skipped silently when there is no worklog directory).

Then run `darius doctor`. If it lists an open tree conflict, put it in the report with its restore line. Do not run `darius tree resolve` yourself: that keeps the current version and needs the user's word.

## Phase 2: Close Stale Worklog Threads

1. List active threads:
   `!darius worklog list --active --json`

2. For each active thread, judge staleness:
   - `openedAt` >24h ago → close as stale
   - Associated spec at 100% verified (check via `darius show <spec> --json`) → close as done

3. Close stale/done threads:
   `!darius worklog close <thread-id> --status done`
   Use `--status blocked` when the reason is unclear.

## Phase 3: Report and Commit

1. **Report** (use current status as source of truth):
   `!darius status --json`
   Summarize index count changes and worklog threads closed. If `--dry-run`, show what WOULD change but write nothing.
2. **Commit**: if files changed and NOT `--dry-run`, invoke `/darius-commit` with message context "tracker wrap-up: reconcile index and close worklogs". In store mode (`darius root --json` says `mode: "store"`), the tracker files are not in git: commit only code changes, and skip the commit when only tracker files changed. The index rebuild in Phase 1 still runs; it is the darius verb that records the tracker changes.

## Return

One compact block, and nothing after it. The main thread relays it as it is:

```
STATUS: done | dry_run | failed
INDEX: rebuilt ({specs} specs, {verified}/{items} items verified)
THREADS_CLOSED: {n} ({thread ids, status each}) | none
COMMIT: {sha} {subject} | none ({why})
NEXT: {the next actionable spec from darius status} | none
REASON: {what failed, for failed}
```

Read-heavy, write-careful: read everything, only write what's actually wrong. Never modify verification checklist items (`[x]`, `[ ]`, etc.). Idempotent: running twice produces no changes the second time.
