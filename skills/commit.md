---
name: darius-commit
model: sonnet
context: fork
description: Commit code with the tracker record, check verification state, and create a semantic commit. Stages tracker files too only when the tracker is in git
argument-hint: "[<milestone-or-spec-path>...] [--all]"
allowed-tools: Bash
---

# Tracker Commit

Commit the verified work of the scoped specs. One check verb does the mechanics; you write the message.

$ARGUMENTS

**Scope**: the spec paths in the arguments (`M1-x/01-y.md`). A milestone slug means its specs with an open thread: list them with `darius worklog list --active --json`. With no scope, use every thread at stage `verified` there.

1. Check, read only (it also rebuilds the index):
   `darius work commit-check <spec>... --json`
   Exit 1 is a refusal: a thread not `verified`, no artifacts, or nothing to commit. Each `problems` line has a `next:` command on stderr. Report them and stop, apart from two cases:
   - A spec that changed no code: `darius worklog set-stage <thread-id> committed --no-code "<why no code changed>"`.
   - Code committed before its thread existed: `darius worklog set-stage <thread-id> committed --commit <sha> --force --reason "code committed before the thread opened: <sha>"`. This is the one use of `--force`.
   `warnings` (such as `.pending-sync` drift) never block.

2. Stage only the listed paths, never `git add -A`: `git add <add[]>`. With `--all`, stage every modified file.

3. Commit with a conventional message you write from the change, and the progress trailer as its own paragraph:
   `git commit -m "<type>(<scope>): <summary>" -m "<trailer>"`

4. For each thread: `darius worklog set-stage <thread-id> committed --commit <sha>`, with the sha from `git rev-parse HEAD`. It also drops the thread's artifacts from `.pending-sync`. Exit 3: report it, do not retry. Review is not this skill's job.

5. Return:
   ```
   STATUS: {committed | refused}
   COMMIT: {sha}
   THREADS: {thread-id: stage}
   PROBLEMS: {problems}
   ```

Store mode commits code only. Git mode (deprecated) also stages the spec, worklog, index and ledger files, which `add` lists. Run `darius onboard` to move it. This skill reads `[x]` but never writes it.
