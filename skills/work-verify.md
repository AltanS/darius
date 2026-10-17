---
name: darius-work-verify
model: sonnet
context: fork
description: Verify completed work, artifact scan, stub scan, run verification commands, mark tasks complete, update index
allowed-tools: Bash
---

# Work Verify

Mechanical verification after implementation. Input: spec path (tracker-relative, `M1-x/01-y.md`), thread ID, touched files.

A line that starts with `!darius ...` is a shell command. Run it with Bash and use its output. Checklist indexes are 0-based: the first item is `0`.

$ARGUMENTS

1. **Artifact scan**: `!darius scan artifacts <touched-files>`
   Critical → log via `darius worklog append`, return `STATUS: fail / REASON: artifacts`. Warnings → log, continue.

2. **Stub scan**: `!darius scan stubs <touched-files>`
   Critical → log, return `STATUS: fail / REASON: stubs`. Warnings → log, continue.

3. **Run verification**: `!darius verify <spec-path> [--timeout <s>]`
   It runs every unchecked item that has a Command/Expected pair, in one call, and skips `[x]` items. Each pass is ticked (`verification_method: executed`) and written to the ledger, the same as `verify-item`. Add `--recheck` only when the user asks to re-prove ticked items; a fail there reports `REGRESSION` and leaves the box ticked.
   Read the checklist with `darius show <spec-path> --json` (`tasks[]` with `index`); never grep the spec file.
   Exit 1 means a failed item, a timeout, a regression or a spec parse error: log details, return `STATUS: fail / REASON: verification`. Exit 2 is a usage error, such as a bad `--timeout`. Exit 0 means nothing failed, but it can still list **manual** items.
   After a fix, re-run one item with `!darius verify-item <spec-path> <idx>`.
   Commands run from the checkout root (the project directory with `.darius.toml`), so a repo-scoped check must say `cd <repo> && …` itself. A check that needs more than 60s (test suite, typecheck, build) needs `--timeout <seconds>`, a blown budget reports `TIMED OUT`, which is not a failure and not a pass.
   An item whose `Command:` is a shell no-op (`echo …`, `printf`, `true`, `:`) is classified **manual**: nothing runs and nothing is marked. `verify` lists it and still exits 0; `verify-item` exits 1 naming it. Handle it in step 4.

4. **Mark complete**: passing items are already marked by `verify` itself (it stamps `verification_method: executed`); do **not** re-mark them. Only a **manual** item needs an explicit mark, and only with evidence:
   `!darius mark <spec-path> <idx> --verified --evidence "<what was checked, how, by whom/which agent, tier>"`
   Bare `--verified` on a no-op Command is refused.

   A **runnable** check (a real `Command:`) is never marked by hand: `mark --verified` refuses it and tells you to run `verify-item`. If the check truly cannot run here (no network, a missing service, a tool not installed), say why on the record:
   `!darius mark <spec-path> <idx> --verified --override "<why it cannot run>" --evidence "<what was checked instead>"`
   `--override` needs `--evidence` and applies to a runnable check only. The ledger line has outcome `manual-override`. Never use it because a check fails.

   Every executed check and every mark appends one line to `.verification-log.jsonl` in the tracker root. That ledger is the evidence behind each `[x]`.

5. **Rebuild index**: `!darius index --rebuild`

6. **Log artifacts**: `darius worklog append <thread-id> --section Artifacts --message "<paths>"`. Use repo-relative paths, separated by commas or by new lines. A glob, `.` or a path outside the project is refused. The `committed` stage checks that none of them is dirty, and that the commit touches one. A spec with no code has no artifacts: commit then needs `--no-code "<reason>"`.

7. **Stamp loop stage** (only when every check above passed):
   `!darius worklog set-stage <thread-id> verified`
   It succeeds only with ledger evidence: a passing `verify` or `verify-item` (or an evidenced `mark`) for this spec since the dispatch, and no item whose latest result failed. So call it after steps 3 and 4. If it refuses, return `STATUS: fail / REASON: verification` with its message. On any `STATUS: fail` return, skip this, the thread stays `dispatched` so the exit gate keeps the loop open.

8. **Return**: `STATUS: pass | SPEC: {path} | VERIFIED: {done}/{total} | TOUCHED_FILES: {list}`

Never fix code, only verify. Return failures for the implementing agent. Sole writer for `[x]`, `verified:`, `verification_passed:`, and `verification_method:`. `commit` reads but never writes these.
