---
name: darius-work-verify
model: sonnet
context: fork
description: Verify completed work, artifact scan, stub scan, run verification commands, mark tasks complete, update index
allowed-tools: Bash
---

# Work Verify

**Before anything else**, run this line with Bash. If it prints a message, show the message to the user and stop.

```bash
command -v darius >/dev/null || { echo "darius is not installed. Install it: bash <(curl -fsSL https://raw.githubusercontent.com/AltanS/darius/main/scripts/install.sh)"; exit 1; }
```

Mechanical verification after implementation. Input: spec path, thread ID, touched files.

$ARGUMENTS

1. **Artifact scan**: `!darius scan artifacts <touched-files>`
   Critical → log via `darius worklog append`, return `STATUS: fail / REASON: artifacts`. Warnings → log, continue.

2. **Stub scan**: `!darius scan stubs <touched-files>`
   Critical → log, return `STATUS: fail / REASON: stubs`. Warnings → log, continue.

3. **Run verification**: for each item with Command/Expected:
   `!darius verify-item <spec-path> <idx>`
   Failures → log details, return `STATUS: fail / REASON: verification`. Exit 2 → `REASON: spec_grammar`.
   Commands run from the **workspace root** (the parent of `.tracker/`), so a repo-scoped check must say `cd <repo> && …` itself. A check that needs more than 60s (test suite, typecheck, build) needs `--timeout <seconds>`, a blown budget reports `TIMED OUT`, which is not a failure and not a pass. To re-prove an item that is already `[x]`, add `--recheck`; a fail there reports `REGRESSION` and leaves the box ticked.
   An item whose `Command:` is a shell no-op (`echo …`, `printf`, `true`, `:`) is classified **manual**: nothing runs, nothing is marked, and `verify-item` exits 1 naming it. That is not a verification failure, handle it in step 4.

4. **Mark complete**: passing items are already marked by `verify-item` itself (it stamps `verification_method: executed`); do **not** re-mark them. Only a **manual** item needs an explicit mark, and only with evidence:
   `!darius mark <spec-path> <idx> --verified --evidence "<what was checked, how, by whom/which agent, tier>"`
   Bare `--verified` on a no-op Command is refused. Every executed check and every mark appends one line to `.tracker/.verification-log.jsonl`, that ledger is the evidence behind each `[x]`.

5. **Rebuild index**: `!darius index --rebuild`

6. **Log artifacts**: `darius worklog append <thread-id> --section Artifacts --message "<paths>"`

7. **Stamp loop stage** (only when every check above passed):
   `!darius worklog set-stage <thread-id> verified`
   On any `STATUS: fail` return, skip this, the thread stays `dispatched` so the exit gate keeps the loop open.

8. **Return**: `STATUS: pass | SPEC: {path} | VERIFIED: {done}/{total} | TOUCHED_FILES: {list}`

Never fix code, only verify. Return failures for the implementing agent. Sole writer for `[x]`, `verified:`, `verification_passed:`, and `verification_method:`. `commit` reads but never writes these.
