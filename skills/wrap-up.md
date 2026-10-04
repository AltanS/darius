---
name: darius-wrap-up
model: sonnet
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

## Phase 1: Rebuild Index (ALWAYS runs)

`!darius index --rebuild`

Wait for `tracker index: rebuilt …` before proceeding. If exit non-zero, surface the error and stop.

This one command rebuilds both indexes: `.tracker/00-INDEX.md` and the worklog index at `.tracker/worklog/00-INDEX.md` (the latter is skipped silently when there is no worklog directory).

## Phase 2: Close Stale Worklog Threads

1. List active threads:
   `!darius worklog list --active --json`

2. For each active thread, judge staleness:
   - `startedAt` >24h ago → close as stale
   - Associated spec at 100% verified (check via `darius show <spec> --json`) → close as done

3. Close stale/done threads:
   `!darius worklog close <thread-id> --status done`
   Use `--status blocked` when the reason is unclear.

## Phase 3: Report and Commit

1. **Report** (use current status as source of truth):
   `!darius status --json`
   Summarize index count changes and worklog threads closed. If `--dry-run`, show what WOULD change but write nothing.
2. **Commit**: if files changed and NOT `--dry-run`, invoke `/darius-commit` with message context "tracker wrap-up: reconcile index and close worklogs". When `.tracker` is a link to the darius store (`kinds` lists `milestone`), the tracker files are not in git: commit only code changes, never `git add .tracker`, and skip the commit when only tracker files changed. The index rebuild in Phase 1 still runs; it is the darius verb that records the tracker changes.

Read-heavy, write-careful: read everything, only write what's actually wrong. Never modify verification checklist items (`[x]`, `[ ]`, etc.). Idempotent: running twice produces no changes the second time.
