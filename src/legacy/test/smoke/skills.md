# Skill Smoke Tests — Mechanical Skills

Manual smoke-test checklist for the 11 mechanical tracker skills. Each entry documents the user intent, the CLI command(s) the skill invokes, and the expected user-facing output.

---

## /tracker:init

**Intent**: User says "set up the tracker" / "initialize tracker for this project"
**CLI**:
```
tracker init
tracker add milestone --name "<name>" --slug "<slug>" --owner "<email>" [--target "<date>"]
tracker add spec --milestone "<slug>" --name "<feature>" --template generic
tracker index --rebuild
```
**Output**: Confirmation of created `.tracker/` directory, first milestone folder, first spec file, and rebuilt index. Suggests `/tracker:add` and `/tracker:work` as next steps.

---

## /tracker:add

**Intent**: User says "add a milestone for auth refactor" / "add a spec for the login form"
**CLI**:
```
tracker list milestones
tracker add milestone --name "<name>" --slug "<slug>" --owner "<email>" [--target "<date>"]
# or
tracker add spec --milestone "<slug>" --name "<name>" --template <generic|api-endpoint|ui-component|library> [--depends-on <path>] [--agent <name>]
tracker index --rebuild
```
**Output**: Confirmation of the created milestone folder or spec file path. Counsel gate result (pass/fail). Suggests next steps.

---

## /tracker:status

**Intent**: User asks "what's the status?" / "how far along are we?" / "darius what's done?"
**CLI**:
```
tracker status
tracker status --detailed
tracker status --json
```
**Output**: Markdown progress dashboard pasted directly — Active Milestones table, Current Focus spec table, Next task line, Blockers. No LLM rewrite.

---

## /tracker:update-index

**Intent**: Called by other skills after spec changes; user rarely invokes directly ("rebuild the index")
**CLI**:
```
tracker index --rebuild
```
**Output**: Single line confirming the rebuilt index path. Returns `INDEX_UPDATED: true` to the calling skill.

---

## /tracker:sync

**Intent**: User says "sync the tracker" / "I implemented some things manually, update the tracker"
**CLI**:
```
tracker list specs --json
tracker verify <spec-path> --dry-run              (classify only — runs nothing)
tracker verify-item <spec-path> <idx>              (for each item marked WOULD EXECUTE)
tracker mark <spec-path> <idx> --verified          (for each confirmed/approved item)
tracker index --rebuild
tracker worklog append <thread-id> --section Updates --message "<evidence summary>"
```
**Output**: Categorized evidence report (Confirmed/Likely/Uncertain/Pending), user confirmation prompt, then summary of items marked verified and index rebuild confirmation.

---

## /tracker:commit

**Intent**: User says "commit the changes" / "save my progress"
**CLI**:
```
tracker index --rebuild
# then git status, git add, git commit via Bash
```
**Output**: Drift warning if `.pending-sync` is non-empty. Verify-check result for any staged `[x]` items. Confirmation of staged files and the composed commit message with tracker progress trailer.

---

## /tracker:worklog

**Intent**: Called by other skills to open/append/close/list worklog threads
**CLI**:
```
tracker worklog open <milestone-slug> --spec <path> [--message "..."]
tracker worklog append <thread-id> --section "<Updates|Artifacts>" --message "..."
tracker worklog close <thread-id> --status <done|blocked|cancelled>
tracker worklog list [--active] [--milestone <slug>] [--json]
```
**Output**: `open` returns the generated thread-id. `append` and `close` confirm the operation. `list` returns thread summaries or JSON.

---

## /tracker:doctor

**Intent**: User says "check the tracker" / "is the tracker healthy?" / "fix tracker issues"
**CLI**:
```
tracker doctor
tracker doctor --fix
```
**Output**: Structured report with Critical / Warning / Info findings and summary counts. In fix mode, reports each phase of remediation applied.

---

## /tracker:check-artifacts

**Intent**: Called by `/tracker:work` after task completion with a file list
**CLI**:
```
tracker scan artifacts <path>
```
**Output**: `PASSED — no artifacts found` or `FAILED — N findings in M files` with severity-tagged finding list (file:line — message).

---

## /tracker:check-stubs

**Intent**: Called by `/tracker:work` after task completion with a file list
**CLI**:
```
tracker scan stubs <path>
```
**Output**: `PASSED — no stubs found` or `FAILED — N findings in M files` with severity-tagged finding list (category: message).

---

## /tracker:work-verify

**Intent**: Called by darius/work orchestrator after implementation — "verify the work on spec M2/01-auth.md"
**CLI**:
```
tracker scan artifacts <touched-files>
tracker scan stubs <touched-files>
tracker verify-item <spec-path> <idx>              (for each item with Command/Expected)
tracker mark <spec-path> <idx> --verified          (for each passing item)
tracker index --rebuild
tracker worklog append <thread-id> --section Artifacts --message "<paths>"
```
**Output**: Structured result block — `STATUS: pass|fail`, `SPEC:`, `VERIFIED: N/total`, `TOUCHED_FILES:`. On failure includes `REASON:` and `FINDINGS:` or `DETAILS:`.
