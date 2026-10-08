---
name: darius-archive
model: sonnet
context: fork
user-invocable: false
description: Archive completed milestones into consolidated summary documents
argument-hint: "<milestone> [--dry-run] [--keep] [--overwrite] [--override-review \"<reason>\"]"
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, Skill
---

# Archive Completed Milestones

**Before anything else**, run this line with Bash. If it prints a message, show the message to the user and stop.

```bash
command -v darius >/dev/null || { echo "darius is not installed. Install it: bash <(curl -fsSL https://raw.githubusercontent.com/AltanS/darius/main/scripts/install.sh)"; exit 1; }
```

Consolidate completed milestones into archive documents, clean up the active dashboard, and preserve the full audit trail (overview, spec content, review transcripts, lessons).

This skill runs in a fork: it does not see the conversation and cannot ask the user. Everything it needs comes from `$ARGUMENTS` and the tracker. When it needs a decision, it stops and returns a `STATUS` block (see **Return**); the main thread asks the user and invokes the skill again with the answer as an argument.

- `<milestone>` is required: the folder name (`M3-cart`), its slug (`cart`) or `M3`. Without it, list the milestones with "Complete" status and return `STATUS: needs_decision` with that list.
- `--overwrite`: the archive document exists and the user chose to write it again.
- `--override-review "<reason>"`: the user accepted the critical review findings of step 2.

1. **Validate**: load milestone state:
   `!darius list milestones --json`
   For the named milestone, verify 100% via:
   `!darius list specs --milestone <slug> --json`
   If incomplete, return `STATUS: refused` with the unverified items.

   Then run the **unrunnable-vigil gate**, archiving a milestone that armed a vigil nobody can run orphans that vigil permanently:
   `!darius archive-check <slug>`
   A non-zero exit names each blocking vigil. There is no `--force`: return `STATUS: refused` with each vigil and its fix (`darius vigil set-body <slug> --stdin` with a real `Command:`, or `darius vigil close <slug> --verdict held|failed`). Do not proceed while it refuses.

2. **Structural review gate** (skip for `--dry-run`): check worklog for a recent passing milestone review (<24h):
   `!darius worklog list --milestone <slug> --json`
   If none found, collect artifact file paths from all specs and invoke `dev-tools:code-review`. If critical findings surface and there is no `--override-review`, return `STATUS: needs_decision` with the findings and the choices fix-and-retry / override / cancel. Do not proceed without an explicit override.

3. **Lessons gate** (skip for `--dry-run`): the gate passes when `00-README.md` frontmatter has `lessons: skip`, or its `## Lessons` section has content (see **Rules**). Otherwise return `STATUS: needs_lessons`. Lessons come from `/darius-enrich --milestone {M}`, which needs the conversation, so the main thread runs it and then invokes this skill again. Never run enrich from this fork.

4. **Gather data**:
   - Read milestone `00-README.md`.
   - Spec list: `!darius list specs --milestone <slug> --json`
   - Each spec: `darius show <path> --json` for structured verification data.
   - Worklog: `!darius worklog list --milestone <slug> --json`
   - Every review transcript in `.tracker/{milestone-slug}/_counsel/*.md` (the plain copies, not `.objects/`).

5. **Resolve commits**: for each verified item, use `git log --until="<verified timestamp>" --format="%h %aI %s" -1 -- <artifact-paths>`.

6. **Generate archive** at `.tracker/archive/{milestone-slug}.md`:
   - Frontmatter (name, slug, archived, completed, started, duration, totals, owner, goal), `name`, `slug`, and `archived` (date) are read by `darius index --rebuild` to render the Archived Milestones section
   - **Overview**: copied from `00-README.md`
   - **Lessons**: copied from the milestone README's Lessons section
   - Summary of what the milestone implemented
   - Verification Timeline table (date, item, spec, commit, chronological)
   - Commit Index table
   - Worklog content (all threads with updates and artifacts), inline it in full. There is no "too large to inline" escape hatch: step 8 preserves the original bytes verbatim under `archive/worklog-raw/`, so length is never a reason to substitute a placeholder note.
   - Full original spec content under `## Specs`
   - **Review Transcripts** appendix, inline every `_counsel/*.md`. For a ```darius-review block (darius 0.74.0), add a one-line table per spec first: reviewer, then each of the five items with its verdict. Older four-advisor transcripts go in as they are.

   If the file already exists and there is no `--overwrite`, return `STATUS: needs_decision` with the choices overwrite / skip / cancel.

7. **Commit the archive** before cleanup, when the tracker is in git: invoke `/darius-commit`. When the darius store owns the tracker (`darius root --json` says `mode: "store"`), the archive document is a store file, not a git file, so there is nothing to commit. The next step records it, and every file version stays in the store.

8. **Clean up** (skipped by `--keep`). Never `rm` the folder. Check first, then remove:
   `!darius milestone archive {milestone-slug} --dry-run`
   It lists every check and every file it would remove, and writes nothing. It refuses (exit 1) when the archive document is missing or empty, or while a worklog thread of the milestone is open. On a refusal, return `STATUS: refused` with its output. With `--dry-run`, stop here and return `STATUS: dry_run`. Then:
   `!darius milestone archive {milestone-slug} --json`
   What it does depends on where the tracker lives (`mode` in the output):
   - **Store** (`mode: "store"`, `action: "remove"`): it removes the folder as one delete, rebuilds the index, and prints the line that undoes it in `undo`: `darius tree restore .tracker/{milestone-slug}/`. Keep that line for the report.
   - **Git** (`mode: "git"`, `action: "print"`): darius writes nothing to a tracker in git. Run the printed `command` yourself, exactly: `git rm -r -q .tracker/{milestone-slug}/`. Then commit the delete via `/darius-commit`. Before that commit `git checkout HEAD -- .tracker/{milestone-slug}/` undoes it; after it, `git revert`.

   The worklog is **distilled, never deleted**, its stub stays in `.tracker/worklog/` as a findable anchor long after the milestone folder is gone. Distill it after the folder is gone (the distill gate needs that). The archive verb names the worklog file and its state:
   - Author an anchor stub from the worklog content already in context. Template, selectivity rule, size budget and the secrets rule: `skills/dream/SKILL.md` §3-4.
   - Land it (no Write tool, quoted heredoc):
     ```bash
     darius \
       worklog distill {milestone-slug}.md --stdin <<'STUB'
     # {milestone-slug} Worklog
     ...
     STUB
     ```
   - The CLI copies the original to `.tracker/archive/worklog-raw/{milestone-slug}.md` and stamps the source digest before swapping. If it refuses (an open thread reappeared, the archive doc is not on disk yet, a worklog file without the `M<n>-` prefix is too recent), leave the worklog whole and report the reason.
   - `--keep` means "skip distillation": milestone folder and worklog file both stay untouched.

9. **Rebuild index**:
   `!darius index --rebuild`
   The rebuilder scans `.tracker/archive/*.md` and renders the Archived Milestones section automatically, do not hand-edit it. It also rebuilds `.tracker/worklog/00-INDEX.md`, so the distilled worklog flips to state `distilled` in the same pass. Verify the archived milestone appears there, its row is gone from the Progress Dashboard, and Current Focus moved to the next active milestone.

10. **Return** one compact block, and nothing after it. The main thread relays it as it is:
    ```
    STATUS: archived | dry_run | refused | needs_decision | needs_lessons
    MILESTONE: {milestone-slug}
    ARCHIVE_DOC: .tracker/archive/{milestone-slug}.md
    STATS: {specs} specs, {items} items verified, {duration}, {n} review transcripts
    REMOVED: {n} files | kept (--keep) | none
    WORKLOG: distilled {before} -> {after} bytes | left whole: {reason}
    UNDO: darius tree restore .tracker/{milestone-slug}/ | git checkout HEAD -- .tracker/{milestone-slug}/ (before the commit) | none
    REASON: {why it stopped, for refused}
    QUESTION: {the choice to put to the user, for needs_decision}
    ```
    Leave out a line that does not apply. `UNDO` is the `undo` of `milestone archive`; never drop it after a removal.

## Rules

- Archive is a permanent record, never delete archive files.
- A worklog's end of life is a stub, never a delete. Never `rm` a worklog file, and never hand-edit one, `worklog distill` is the only sanctioned rewrite, and it preserves the raw bytes first.
- In a git tracker, commit the archive before deleting originals. In the store, the removal is undone with `darius tree restore .tracker/{milestone-slug}/`; `darius tree log <path>` lists every version.
- Remove a milestone folder only with `darius milestone archive`, never with `rm`.
- If the archive file already exists and there is no `--overwrite`, return `STATUS: needs_decision`: overwrite / skip / cancel.
- Items without `Verified:` timestamps get current timestamp with a note.
- Every review transcript MUST make it into the archive.
- The Lessons gate passes if: (a) `## Lessons` contains synthesized content, (b) frontmatter sets `lessons: skip`, or (c) section contains `_No lessons of note, mechanical milestone._`. Otherwise run enrich-lessons first, never archive with an empty Lessons section and no skip flag.
