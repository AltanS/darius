---
name: darius-commit
model: sonnet
context: fork
description: Commit code with the tracker record, check verification state, and create a semantic commit. Stages tracker files too only when the tracker is in git
argument-hint: "[<milestone-or-spec-path>...] [--all] [--work]"
allowed-tools: Bash
---

# Tracker Commit

**Before anything else**, run this line with Bash. If it prints a message, show the message to the user and stop.

```bash
command -v darius >/dev/null || { echo "darius is not installed. Install it: bash <(curl -fsSL https://raw.githubusercontent.com/AltanS/darius/main/scripts/install.sh)"; exit 1; }
```

Atomically commit code changes alongside the tracker record.

**Two modes.** Check `.tracker` first (`test -L .tracker`).

- **Legacy mode** (`.tracker/` is a real folder in git): code and tracker files go into one commit. Steps 5 and 6 stage the tracker files too.
- **Store mode** (`.tracker` is a link, because the project's `.darius.toml` `kinds` lists `milestone`): the tracker tree lives in the darius store and nothing under it is in git. The commit holds code only. Never `git add .tracker`. `darius uncommitted-verified` reads worklog thread stages here, not git. Steps 5 and 6 reduce to the code files.

**Scope** (read `$ARGUMENTS` first): if one or more milestone slugs / spec paths are passed (e.g. `M191` or `.tracker/M191-foo/04-thing.md`), this is a **scoped** commit. Stage ONLY the code artifacts recorded in the worklog threads of those specs (legacy mode: plus the spec files). Do not sweep unrelated dirty files (other milestones, unrelated specs) into the commit. With no scope argument, stage the changes belonging to the current work (default), or everything with `--all`. The commit-first gate in `/darius-work-plan` always passes a scope, honor it.

1. **Analyze changes**: `git status` and `git diff --name-only`. When scoped, narrow to the scope's worklog-recorded code artifacts (legacy mode: plus the spec files). If nothing is dirty, there is no commit to make. In legacy mode, exit. In store mode, still run step 4 (the index rebuild records tracker-only edits), then go to step 9 for any `verified` thread whose code is already committed, and stop.
2. **Drift warning**: if `.tracker/.pending-sync` is non-empty, print a one-line warning and go on. Drift never blocks a commit.
3. **Verify-check**: confirm the scoped work is verified. Legacy mode: for any staged spec with new `[x]` items, confirm a `verification_passed:` timestamp exists. Store mode: no spec is staged, so list the scoped threads (`darius worklog list --active --json`, filtered by the scoped spec paths) and confirm each is at stage `verified`. Refuse if a check fails, and direct the user to `/darius-work-verify`. Pass `--skip-verify-check` to bypass.
4. **Validate index (CRITICAL)**:
   `!darius index --rebuild`
   Wait for success before staging. In store mode this is the darius verb that records tracker edits in the store.
5. **Stage**: explicitly `git add <paths>`, never `git add -A`. Legacy mode: the in-scope code files + updated tracker files (including `00-INDEX.md`); when scoped, only the scoped specs + their code artifacts + `00-INDEX.md`. Store mode: the in-scope code files only. With `--all`: stage all modified files (store mode: still never `.tracker`).
6. **Prune drift ledger**: remove `.pending-sync` entries for files now staged. Legacy mode: stage the updated ledger. Store mode: `.pending-sync` is host-local, so prune it and do not stage it.
7. **Compose commit message** (LLM): conventional commit reflecting the code change with a tracker progress trailer, e.g. `Tracker: M2-api-layer/01-AUTH 3/5 -> 4/5 verified`. Read the progress from `darius show <spec> --json` (`verified` and `total`), never from a git diff. The "before" count is the one the Work Loop context recorded at plan time. If it is unknown, write `4/5 verified`.
8. **Create commit** via Bash using the composed message.
9. **Stamp loop stage**: after the commit lands, for each worklog thread whose spec is in this commit's scope:
   `!darius worklog set-stage <thread-id> committed`
   (Thread IDs come from the Work Loop context or `darius worklog list --active --json` filtered by the scoped spec paths. Skip threads not at stage `verified`.)

If no tracker exists, stage changed files and create a conventional commit directly via Bash.

**Single-Writer Discipline**: This skill reads `[x]` and `verification_passed:` but never writes them. `work-verify` owns those fields.
