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

A line that starts with `!darius ...` is a shell command. Run it with Bash and use its output.

**Two modes.** Run `darius root --json` first. It prints `{mode, trackerRoot, project, linked}`.

- **Store mode** (`mode: "store"`; the project's `.darius.toml` `kinds` lists `milestone`): the tracker tree lives in the darius store, the checkout has no `.tracker` path, and nothing of the tree is in git. The commit holds code only. `darius uncommitted-verified` reads worklog thread stages here, not git. Steps 5 and 6 reduce to the code files. Specs are named tracker-relative (`M1-x/01-y.md`).
- **Git mode** (`mode: "git"`, deprecated; `darius onboard` moves it): `.tracker/` is a real folder in git, and code and tracker files go into one commit. Steps 5 and 6 stage the tracker files too.

**Scope** (read `$ARGUMENTS` first): if one or more milestone slugs / spec paths are passed (e.g. `M191` or `M191-foo/04-thing.md`), this is a **scoped** commit. Stage ONLY the code artifacts recorded in the worklog threads of those specs (git mode: plus the spec files). Do not sweep unrelated dirty files (other milestones, unrelated specs) into the commit. With no scope argument, stage the changes belonging to the current work (default), or everything with `--all`. The commit-first gate in `/darius-work-plan` always passes a scope, honor it.

1. **Analyze changes**: `git status` and `git diff --name-only`. When scoped, narrow to the scope's worklog-recorded code artifacts (git mode: plus the spec files). If nothing is dirty, there is no commit to make. In git mode, exit. In store mode, still run step 4 (the index rebuild records tracker-only edits), then go to step 9 for any `verified` thread whose code is already committed, and stop.
2. **Drift warning**: if `.pending-sync` in the tracker root (`trackerRoot` from `darius root --json`) is non-empty, print a one-line warning and go on. Drift never blocks a commit.
3. **Verify-check**: confirm the scoped work is verified. Git mode: for any staged spec with new `[x]` items, confirm a `verification_passed:` timestamp exists. Store mode: no spec is staged, so list the scoped threads (`darius worklog list --active --json`, filtered by the scoped spec paths) and confirm each is at stage `verified`. Refuse if a check fails, and direct the user to `/darius-work-verify`. Pass `--skip-verify-check` to bypass.
4. **Validate index (CRITICAL)**:
   `!darius index --rebuild`
   Wait for success before staging. In store mode this is the darius verb that records tracker edits in the store.
5. **Stage**: explicitly `git add <paths>`, never `git add -A`. Git mode: the in-scope code files + updated tracker files (including `00-INDEX.md`); when scoped, only the scoped specs + their code artifacts + `00-INDEX.md`. Store mode: the in-scope code files only. With `--all`: stage all modified files (store mode: the tree is not in the checkout, so there is nothing of it to stage).
6. **Prune drift ledger**: remove `.pending-sync` entries for files now staged. Git mode: stage the updated ledger. Store mode: `.pending-sync` is host-local, so prune it and do not stage it.
7. **Compose commit message** (LLM): conventional commit reflecting the code change with a tracker progress trailer, e.g. `Tracker: M2-api-layer/01-AUTH 3/5 -> 4/5 verified`. Read the progress from `darius show <spec> --json` (`verified` and `total`), never from a git diff. The "before" count is the one the Work Loop context recorded at plan time. If it is unknown, write `4/5 verified`.
8. **Create commit** via Bash using the composed message.
9. **Stamp loop stage**: after the commit lands, read its sha (`git rev-parse HEAD`). For each worklog thread whose spec is in this commit's scope:
   `!darius worklog set-stage <thread-id> committed --commit <sha>`
   (Thread IDs come from the Work Loop context or `darius worklog list --active --json` filtered by the scoped spec paths. Skip threads not at stage `verified`. There is one thread per spec.) It refuses (exit 1) when the sha is not in HEAD's history, an artifact of the thread is still dirty or untracked (commit those files, then retry), the thread has no artifacts, or no commit since dispatch touches an artifact. Outside a git repo it exits 3; report that instead of retrying. The review stage (`reviewed`) is not this skill's job.

   - **A spec with no code** (tracker text only, a decision, a doc in the store): there is no code commit. Stamp it with a reason, and no `--commit`:
     `!darius worklog set-stage <thread-id> committed --no-code "<why no code changed>"`
     `--no-code` is refused when the thread records artifacts.
   - **A commit made before the thread exists** (the code went in first, the thread was opened later): the range check finds no commit since dispatch and refuses `--commit <sha>` alone. Record the sha you made, and say why it is early:
     `!darius worklog set-stage <thread-id> committed --commit <sha> --force --reason "code committed before the thread opened: <sha>"`
     `--force` is the exception for this case only. It marks the stamp `forced`. Do not use it to skip a dirty artifact or a missing verification. Next time, open the thread (work-plan) before the commit.

If no tracker exists, stage changed files and create a conventional commit directly via Bash.

**Single-Writer Discipline**: This skill reads `[x]` and `verification_passed:` but never writes them. `work-verify` owns those fields.
