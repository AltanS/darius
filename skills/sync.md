---
name: darius-sync
model: sonnet
user-invocable: false
description: Detect manual implementations and sync tracker state with reality
argument-hint: "[M2-api-layer/01-AUTH]"
allowed-tools: Bash, AskUserQuestion, Skill
---

# Sync Tracker

**Before anything else**, run this line with Bash. If it prints a message, show the message to the user and stop.

```bash
command -v darius >/dev/null || { echo "darius is not installed. Install it: bash <(curl -fsSL https://raw.githubusercontent.com/AltanS/darius/main/scripts/install.sh)"; exit 1; }
```

Detect items implemented manually (without `/darius-work`) and update the tracker to match reality.

1. **Load state**: `!darius list specs --json`
2. **Seed with drift ledger**: check for `.tracker/.pending-sync`; lines are paths flagged by the drift hook.
3. **Detect implementations** for each pending item:
   - `!darius verify <spec-path> --dry-run` to see which items even *have* an executable check. `--dry-run` classifies only, it runs nothing, so it is never evidence on its own. Run the real `verify-item <spec-path> <idx>` (no `--dry-run`) on the ones marked `WOULD EXECUTE`; that executes the check and marks a passing item `executed`.
   - Check file existence for mentioned paths
   - `git log --oneline -20 --grep="<keywords>"` for recent commit evidence
4. **Categorize** (LLM judgment): Confirmed Complete (verification passes), Likely Complete (git commits match), Uncertain (partial signals), Still Pending (no evidence).
5. **Present summary** grouped by category with evidence. Highlight items from `.pending-sync`.
6. **Ask user** which to mark verified: all confirmed, all + likely, select individually, or skip.
7. **Update tracker** for each selected item:
   `!darius mark <spec-path> <idx> --verified --evidence "<the evidence from step 3/4>"`
   `mark` never executes anything, so it stamps `verification_method: manual` and logs one line to `.tracker/.verification-log.jsonl`. On an item whose `Command:` is a shell no-op (`echo …`, `true`, `:`) a bare `--verified` is **refused**, pass `--evidence`. Prefer re-running `verify-item <spec-path> <idx>` (no `--dry-run`) for items with a real Command: that marks them as `executed`.
8. **Rebuild index**: `!darius index --rebuild`
9. **Clear drift ledger**: truncate or prune `.pending-sync` entries that are now verified.
10. **Create worklog entry** via `darius worklog append` documenting the sync with evidence used.
11. **Commit** via `/darius-commit`. When `.tracker` is a link to the darius store, tracker files are not in git and the commit holds code only; step 8 (`darius index --rebuild`) is the darius verb that records the tracker changes.
