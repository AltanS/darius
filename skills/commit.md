---
name: darius-commit
model: sonnet
context: fork
description: Stage code and tracker changes together, update verification state, and create a semantic commit
argument-hint: "[<milestone-or-spec-path>...] [--all] [--work]"
allowed-tools: Bash
---

# Tracker Commit

**Before anything else**, run this line with Bash. If it prints a message, show the message to the user and stop.

```bash
command -v darius >/dev/null || { echo "darius is not installed. Install it: bash <(curl -fsSL https://raw.githubusercontent.com/AltanS/darius/main/scripts/install.sh)"; exit 1; }
```

Atomically commit code changes alongside tracker documentation updates.

**Scope** (read `$ARGUMENTS` first): if one or more milestone slugs / spec paths are passed (e.g. `M191` or `.tracker/M191-foo/04-thing.md`), this is a **scoped** commit, stage ONLY those specs plus the code artifacts recorded in their worklog threads. Do not sweep unrelated dirty files (other milestones, unrelated specs) into the commit. With no scope argument, stage the changes belonging to the current work (default), or everything with `--all`. The commit-first gate in `/darius-work-plan` always passes a scope, honor it.

1. **Analyze changes**: `git status` and `git diff --name-only`. Exit if nothing to commit. When scoped, narrow to the scope's spec files + their worklog-recorded code artifacts.
2. **Drift warning**: if `.tracker/.pending-sync` is non-empty, warn and wait unless `--skip-drift` is present.
3. **Verify-check**: for any staged spec with new `[x]` items, confirm `verification_passed:` timestamp exists. Refuse if missing, direct user to `/darius-work-verify`. Pass `--skip-verify-check` to bypass.
4. **Validate index (CRITICAL)**:
   `!darius index --rebuild`
   Wait for success before staging.
5. **Stage**: the in-scope code files + updated tracker files (including `00-INDEX.md`). When scoped, stage only the scoped specs + their code artifacts + `00-INDEX.md`, explicitly `git add <paths>`, never `git add -A`. With `--all`: stage all modified files.
6. **Prune drift ledger**: remove `.pending-sync` entries for files now staged. Stage the updated ledger.
7. **Compose commit message** (LLM): conventional commit reflecting the code change with tracker progress trailer, e.g. `Tracker: M2-api-layer/01-AUTH 3/5 -> 4/5 verified`.
8. **Create commit** via Bash using the composed message.
9. **Stamp loop stage**: after the commit lands, for each worklog thread whose spec is in this commit's scope:
   `!darius worklog set-stage <thread-id> committed`
   (Thread IDs come from the Work Loop context or `darius worklog list --active --json` filtered by the scoped spec paths. Skip threads not at stage `verified`.)

If no tracker exists, stage changed files and create a conventional commit directly via Bash.

**Single-Writer Discipline**: This skill reads `[x]` and `verification_passed:` but never writes them. `work-verify` owns those fields.
