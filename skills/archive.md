---
name: darius-archive
model: sonnet
user-invocable: false
description: Archive completed milestones into consolidated summary documents
argument-hint: "[M1] [--dry-run] [--keep]"
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, AskUserQuestion, Skill
---

# Archive Completed Milestones

**Before anything else**, run this line with Bash. If it prints a message, show the message to the user and stop.

```bash
command -v darius >/dev/null || { echo "darius is not installed. Install it: bash <(curl -fsSL https://raw.githubusercontent.com/AltanS/darius/main/scripts/install.sh)"; exit 1; }
```

Consolidate completed milestones into archive documents, clean up the active dashboard, and preserve the full audit trail (overview, spec content, counsel transcripts, lessons).

1. **Validate**: load milestone state:
   `!darius list milestones --json`
   Identify milestones with "Complete" status. For a specific milestone, verify 100% via:
   `!darius list specs --milestone <slug> --json`
   If incomplete, list unverified items and stop.

   Then run the **unrunnable-vigil gate**, archiving a milestone that armed a vigil nobody can run orphans that vigil permanently:
   `!darius archive-check <slug>`
   A non-zero exit names each blocking vigil. There is no `--force`: fix the vigil (`darius vigil set-body <slug> --stdin` with a real `Command:`) or close it with `darius vigil close <slug> --verdict held|failed`, then re-run. Do not proceed while it refuses.

2. **Structural review gate** (skip for `--dry-run`): check worklog for a recent passing milestone review (<24h):
   `!darius worklog list --milestone <slug> --json`
   If none found, collect artifact file paths from all specs and invoke `dev-tools:code-review`. If critical findings surface, ask via AskUserQuestion: fix-and-retry / override / cancel. Do not proceed without explicit override.

3. **Trigger enrich-lessons** (skip for `--dry-run`; skip if `00-README.md` frontmatter has `lessons: skip`): invoke `/darius-enrich --all --milestone {M}` to produce the Lessons section. Wait for completion.

4. **Gather data**:
   - Read milestone `00-README.md`.
   - Spec list: `!darius list specs --milestone <slug> --json`
   - Each spec: `darius show <path> --json` for structured verification data.
   - Worklog: `!darius worklog list --milestone <slug> --json`
   - Every counsel transcript in `.tracker/{milestone-slug}/_counsel/*.md`.

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
   - **Counsel Transcripts** appendix, inline every `_counsel/*.md`

7. **Commit archive** via `/darius-commit` before cleanup.

8. **Clean up**: `rm -rf .tracker/{milestone-slug}/` (skipped by `--keep`). The worklog is **distilled, never deleted**, its stub stays in `.tracker/worklog/` as a findable anchor long after the milestone folder is gone:
   - Author an anchor stub from the worklog content already in context. Template, selectivity rule, size budget and the secrets rule: `skills/dream/SKILL.md` §3-4.
   - Land it (no Write tool, quoted heredoc):
     ```bash
     darius \
       worklog distill {milestone-slug}.md --stdin <<'STUB'
     # {milestone-slug} Worklog
     ...
     STUB
     ```
   - The CLI copies the original to `.tracker/archive/worklog-raw/{milestone-slug}.md` and stamps the source digest before swapping. If it refuses, an open thread reappeared, the archive doc is not on disk yet, leave the worklog whole and report the reason.
   - `--keep` means "skip distillation": milestone folder and worklog file both stay untouched.

9. **Rebuild index**:
   `!darius index --rebuild`
   The rebuilder scans `.tracker/archive/*.md` and renders the Archived Milestones section automatically, do not hand-edit it. It also rebuilds `.tracker/worklog/00-INDEX.md`, so the distilled worklog flips to state `distilled` in the same pass. Verify the archived milestone appears there, its row is gone from the Progress Dashboard, and Current Focus moved to the next active milestone.

10. **Report** with stats (specs archived, items verified, duration, counsel transcripts preserved, milestone folder removed, worklog distilled with bytes before → after).

## Rules

- Archive is a permanent record, never delete archive files.
- A worklog's end of life is a stub, never a delete. Never `rm` a worklog file, and never hand-edit one, `worklog distill` is the only sanctioned rewrite, and it preserves the raw bytes first.
- Commit archive before deleting originals.
- If archive file already exists, ask via AskUserQuestion: overwrite / skip / cancel.
- Items without `Verified:` timestamps get current timestamp with a note.
- Every counsel transcript MUST make it into the archive.
- The Lessons gate passes if: (a) `## Lessons` contains synthesized content, (b) frontmatter sets `lessons: skip`, or (c) section contains `_No lessons of note, mechanical milestone._`. Otherwise run enrich-lessons first, never archive with an empty Lessons section and no skip flag.
