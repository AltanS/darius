---
name: darius-work-verify
model: sonnet
context: fork
description: Verify completed work, artifact scan, stub scan, run verification commands, mark tasks complete, update index
allowed-tools: Bash
---

# Work Verify

Verify one finished task with one verb. Input: spec path (tracker-relative, `M1-x/01-y.md`), thread id, touched files. Never fix code, never read the spec file.

$ARGUMENTS

1. Run, with the touched files joined by commas:
   `darius work verify <spec> --thread <thread-id> --touched <file1,file2> --json`
   Add `--timeout <seconds>` when a check runs a test suite, a typecheck or a build. It runs the artifact and stub scans, `verify` on the whole spec (ticked items are skipped), the index rebuild, the Artifacts entry, and `set-stage verified` when all of it passed. On a failure it logs one note on the thread.

2. Act on `status`:
   - `pass`: done. The stage line is in `stamp`.
   - `fail`: return the findings. Do not fix, do not mark. The thread stays `dispatched`, so the exit gate keeps the loop open.
   - `manual`: each item in `manual[]` has a no-op Command. Check it the way its label says, then record the evidence:
     `darius mark <spec> <index> --verified --evidence "<what was checked, how, by whom, which tier>"`
     Then: `darius worklog set-stage <thread-id> verified`. If it refuses, return `fail` with its message.
   A runnable check that truly cannot run here (no network, a missing service) is the one exception: `darius mark <spec> <index> --verified --override "<why it cannot run>" --evidence "<what was checked instead>"`. Never use it because a check fails.

3. Return:
   ```
   STATUS: {pass | fail | manual}
   REASON: {reason}            # fail only: artifacts | stubs | verification | spec_grammar
   FINDINGS: {findings, one per line}
   SPEC: {spec}
   VERIFIED: {verified}/{total}
   TOUCHED_FILES: {touched}
   ```

Indexes are 0-based. Every executed check and every mark writes one line to the ledger, the evidence behind each `[x]`. This skill is the sole writer of `[x]` and the `verified` stage; commit only reads them.
