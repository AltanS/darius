---
name: darius-enrich
model: opus
user-invocable: false
description: Reflect on recent work and enrich tracker specs with discovered tasks, scope changes, and corrected assumptions
argument-hint: "[M2-api-layer/01-AUTH | --all | --milestone M2]"
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, AskUserQuestion, Skill
---

# Enrich Tracker

**Before anything else**, run this line with Bash. If it prints a message, show the message to the user and stop.

```bash
command -v darius >/dev/null || { echo "darius is not installed. Install it: bash <(curl -fsSL https://raw.githubusercontent.com/AltanS/darius/main/scripts/install.sh)"; exit 1; }
```

Reflect on what recent implementation work revealed and propose updates to tracker specs, new tasks discovered, tasks that turned out unnecessary, verification items that need updating, scope changes, or new specs/dependencies that emerged. Also produces **Lessons** when a milestone completes.

Invoked manually, by the Work Loop driver (`/darius-work` Stage 6, and after a counsel rejection exposes a genuine gap), and automatically by `archive` at milestone completion.

## Auto-Run Policy

1. **`.tracker/config.yml`**: auto-invoke after spec completion only when `auto_enrich: on`. Default is `off`.
2. **Size threshold**: even with `auto_enrich: on`, skip specs whose total diff from start to completion is ≤ `enrich_threshold_loc` LOC across referenced files (default 20).
3. **`enrich: skip` frontmatter**: excluded from auto-runs regardless of config.

## Idempotency Watermark

Compute `current_sha = sha256(spec_body + worklog_thread_body)` and compare against `last_enriched_sha:` in spec frontmatter. If they match, print `NO_OP: <spec-slug> sha=<current_sha>` and stop. After a successful pass, write the new sha and `enriched_at: <ISO>`.

Write proposals to `.tracker/.enrich/<spec-slug>.draft.md` first; atomic-rename onto the spec only after user approval. A crash mid-run leaves the draft recoverable; the spec itself is never partially modified.

Phase 4b (milestone Lessons) uses a separate idempotency check based on an HTML marker in the README.

## Phase 1: Gather Context

1. **Determine scope** from `$ARGUMENTS`:
   - `M2-api-layer/01-AUTH` → focus on that spec
   - `--all` → scan every spec in the current focus milestone
   - `--milestone M2` → scope to one milestone, emit lessons (see Phase 4b)
   - no argument → current focus milestone

2. **Load tracker state**:
   `!darius status --json`
   Read `currentFocus` to identify the active milestone.

3. **List in-scope specs**:
   `!darius list specs --milestone <slug> --json`

4. **Load each spec's parsed state**:
   `!darius show <spec-path> --json`

5. **Read counsel transcripts**: for each in-scope spec, read `{MILESTONE}/_counsel/{spec-slug}.md` if present.

6. **Read recent work and code**:
   - `git log --oneline -30` and `git diff HEAD~10 --stat`
   - Active worklog threads: `!darius worklog list --active --json`
   - Skim implementation state of files mentioned in specs or touched in recent commits.

## Phase 2: Identify Drift

Compare what specs say against what actually exists:

- **New tasks discovered**: work the spec didn't anticipate
- **Tasks that are wrong or unnecessary**: wrong approach, or obviated by a different solution
- **Verification items that need updating**: moved files, changed APIs, outdated assertions
- **Scope changes**: feature turned out bigger or smaller than expected
- **Signature-cascade tail**: a shared-signature change (job `handle()`, controller action, service method) that cascaded into many call-site/test updates the spec didn't budget. If the actual fan-out was materially larger than planned, note it in the spec's Overview as a forecast for *next* time and call it out in Lessons, the estimate prevents the next work-plan from looking smaller than reality.
- **Missing dependencies**: `depends_on` that turned out to be critical
- **New specs needed**: work revealed an entirely new feature deserving its own spec
- **Counsel predictions vs reality**: did an advisor warn about something that came true?

## Phase 3: Propose Changes

Present findings as a structured proposal grouped by spec file:

```
## Proposed Enrichments

### 01-auth.md

**Add tasks:**
- [ ] Create token refresh middleware (discovered during JWT implementation)
  - Command: `grep -q "refreshToken" src/middleware/auth.ts`
  - Expected: `exit 0`

**Update tasks:**
- "Implement login endpoint" → "Implement login endpoint with rate limiting"

**Update verification:**
- `exit 0` → `stdout matches /\d+ passed/` for auth.test.ts

**Remove tasks:**
- "Create custom session store", using Redis adapter instead, handled by 02-session.md

**depends_on update:**
- add `02-session.md`, auth turned out to need the session store

**Counsel echo:**
- Advisor #3 warned about token rotation under load; confirmed in practice

### New spec needed:
- "Token Refresh Flow", discovered during auth work, complex enough for its own spec
```

## Phase 4: Apply

1. **Ask user** via AskUserQuestion: apply all / select subset / skip.
2. **Apply selected changes**: edit spec files, add/remove/update checklist items, update frontmatter counts and `depends_on`. **Repo-relative paths only**: every path you write into a spec, `Command:`/`Expected:` lines (as in the `src/middleware/auth.ts` example above) and prose, must be repo-relative, never `/home/you/repo/...`. Verification runs from the repo root and `.tracker/` is committed, so absolute paths leak the author's home-dir layout into git history and won't run on other machines.
3. **Rebuild index**:
   `!darius index --rebuild`
4. **New specs**: if approved, invoke `darius add`.
5. **Commit**: invoke `/darius-commit` with context "tracker enrich: update specs based on implementation learnings".

## Phase 4b: Lessons (when `--milestone M{N}` is passed)

1. Read the milestone's `00-README.md` and frontmatter.
2. **Skip flag**: if frontmatter has `lessons: skip`, print `LESSONS_SKIPPED: M{N}` and stop.
3. **Idempotency check** on the existing `## Lessons` section:
   - First non-blank line is `<!-- enriched: <ISO> -->` → enrich-authored, may be replaced.
   - Section non-empty and lacks the marker → human-authored. Print `LESSONS_HUMAN: M{N}` and stop.
   - Section empty (or contains only the placeholder comment) → proceed.
4. Synthesize honestly. Skim counsel transcripts, worklog threads, recent diffs. Look for: counsel warnings that came true, plan misses added mid-flight, approaches worth templating, approaches that failed, weak verification commands.
5. **No-lessons path**: if nothing genuine surfaces, write exactly:
   ```
   <!-- enriched: <ISO> -->
   _No lessons of note, mechanical milestone._
   ```
6. Otherwise write 3–7 bullets prefixed by `<!-- enriched: <ISO> -->`, replacing any prior enrich-authored content.
7. Commit via `/darius-commit` with context "tracker enrich: milestone lessons".

## Rules

- **Propose, don't auto-edit**: always show the proposal and get user approval before changing specs. Phase 4b writes the Lessons section directly, but only when empty or marked with a prior `<!-- enriched: -->` comment; never overwrite human-authored lessons.
- **Be specific**: every proposed change must cite what triggered it (a commit, a file, a worklog finding, a counsel warning).
- **Don't re-sync status**: that's `/sync`'s job. Enrich changes content (tasks, descriptions, verification, depends_on), not status (`[ ]` → `[x]`).
- **Don't inflate**: only propose changes that genuinely reflect learnings.
- **Preserve verified items**: never modify or remove items already marked `[x]`.
- **Respect counsel sidecars**: read them, quote them when relevant, never delete them.
- If nothing to propose, say so: "Specs look accurate, no enrichment needed."
