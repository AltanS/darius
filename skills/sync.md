---
name: darius-sync
model: sonnet
context: fork
user-invocable: false
description: Detect manual implementations and sync tracker state with reality
argument-hint: "[M2-api-layer/01-AUTH] [--apply confirmed|likely|<spec>:<idx>,...]"
allowed-tools: Bash, Skill
---

# Sync Tracker

**Before anything else**, run this line with Bash. If it prints a message, show the message to the user and stop.

```bash
command -v darius >/dev/null || { echo "darius is not installed. Install it: bash <(curl -fsSL https://raw.githubusercontent.com/AltanS/darius/main/scripts/install.sh)"; exit 1; }
```

Detect items implemented manually (without `/darius-work`) and update the tracker to match reality.

This skill runs in a fork: it does not see the conversation and cannot ask the user. So it runs in two passes:

- **Without `--apply`** it runs steps 1 to 5, marks nothing by hand (a real `verify-item` run still records its result, as before), and returns `STATUS: needs_decision` with the categories. The main thread asks the user which items to mark.
- **With `--apply`** it marks what the user chose and runs steps 7 to 11. `--apply confirmed` marks Confirmed Complete, `--apply likely` marks Confirmed and Likely Complete, and `--apply <spec>:<idx>,...` marks the named items only. Run step 3 again for each chosen item first, so the evidence is current; drop an item whose evidence is gone and report it.

1. **Load state**: `!darius list specs --json`
2. **Seed with drift ledger**: check for `.tracker/.pending-sync`; lines are paths flagged by the drift hook.
3. **Detect implementations** for each pending item:
   - `!darius verify <spec-path> --dry-run` to see which items even *have* an executable check. `--dry-run` classifies only, it runs nothing, so it is never evidence on its own. Run the real `verify-item <spec-path> <idx>` (no `--dry-run`) on the ones marked `WOULD EXECUTE`; that executes the check and marks a passing item `executed`.
   - Check file existence for mentioned paths
   - `git log --oneline -20 --grep="<keywords>"` for recent commit evidence
4. **Categorize** (LLM judgment): Confirmed Complete (verification passes), Likely Complete (git commits match), Uncertain (partial signals), Still Pending (no evidence).
5. **Present summary** grouped by category with evidence. Highlight items from `.pending-sync`.
6. **Stop for the decision** (no `--apply`): return the **Return** block with `STATUS: needs_decision`. The choices are `--apply confirmed`, `--apply likely`, `--apply <spec>:<idx>,...`, or skip.
7. **Update tracker** for each selected item:
   `!darius mark <spec-path> <idx> --verified --evidence "<the evidence from step 3/4>"`
   `mark` never executes anything, so it stamps `verification_method: manual` and logs one line to `.tracker/.verification-log.jsonl`. On an item whose `Command:` is a shell no-op (`echo …`, `true`, `:`) a bare `--verified` is **refused**, pass `--evidence`. Prefer re-running `verify-item <spec-path> <idx>` (no `--dry-run`) for items with a real Command: that marks them as `executed`.
8. **Rebuild index**: `!darius index --rebuild`
9. **Clear drift ledger**: truncate or prune `.pending-sync` entries that are now verified.
10. **Create worklog entry** via `darius worklog append` documenting the sync with evidence used.
11. **Commit** via `/darius-commit`. When `.tracker` is a link to the darius store, tracker files are not in git and the commit holds code only; step 8 (`darius index --rebuild`) is the darius verb that records the tracker changes.

## Return

One compact block, and nothing after it. The main thread relays it as it is:

```
STATUS: needs_decision | synced | nothing_pending | failed
CONFIRMED: {spec}:{idx} {evidence}, ... | none
LIKELY: {spec}:{idx} {evidence}, ... | none
UNCERTAIN: {spec}:{idx}, ... | none
MARKED: {n} items ({spec}:{idx}, ...) | none
COMMIT: {sha} {subject} | none ({why})
QUESTION: {the choice for the user, for needs_decision}
REASON: {what failed, for failed}
```

Leave out a line that does not apply.
