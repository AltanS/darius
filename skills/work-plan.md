---
name: darius-work-plan
model: sonnet
context: fork
description: Find the next tracked task, check gates, and prepare context for implementation
argument-hint: "[--batch N]"
allowed-tools: Read, Write, Edit, Glob, Grep, Bash
---

# Work Plan

**Before anything else**, run this line with Bash. If it prints a message, show the message to the user and stop.

```bash
command -v darius >/dev/null || { echo "darius is not installed. Install it: bash <(curl -fsSL https://raw.githubusercontent.com/AltanS/darius/main/scripts/install.sh)"; exit 1; }
```

Find the next actionable implementation task (or a batch of independent tasks) and prepare everything needed before delegation.

A line that starts with `!darius ...` in this skill is a shell command. Run it with Bash and use its output. Paths in specs and in darius verbs are tracker-relative (`M2-api-layer/01-auth.md`). To read a tree file, take `absPath` from `next --json`, `show --json` or `list specs --json`, or `trackerRoot` from `darius root --json`. Checklist indexes are 0-based.

$ARGUMENTS

Recognized flags:
- `--batch N` (N ≥ 2): return up to N independent tasks for parallel execution. Default returns a single task.
- `--override "<reason>"`: skip the review gate for a blocked or exhausted spec. Refuse without a non-empty reason. It never skips the spec check. See step 3.
- `--skip-commit-first`: bypass the commit-first gate (step 0). Use only when the uncommitted-verified work is intentionally being deferred.

0. **Commit-first gate** (deterministic, runs before anything else):
   `!darius uncommitted-verified --json`
   If the array is **non-empty**, do NOT plan new work. Verified-but-uncommitted specs are an open debt, opening new work on top of them is how completed work gets stranded uncommitted. Return immediately and stop:
   ```
   STATUS: commit_first
   SPECS:
     - {path}   ({gitStatus})   # store mode: gitStatus is verified-uncommitted, plus threadId and dirtyArtifacts
   ```
   The driving agent routes this straight to `/darius-commit` (scoped to those specs) before re-invoking work-plan. Skip this gate only with `--skip-commit-first` (intentional deferral) or when the CLI is unavailable / not a git repo (the command exits non-zero, proceed in that case).

1. **Find candidate tasks**:
   `!darius next --json`
   Do not read `currentFocus` from `status`. `next` picks the work. It returns `{ status, label, file, spec, milestone, absPath, skippedClaimed }`. `status` is `task`, `complete`, `broken` or `claimed`. `spec` is the tracker-relative path to use in later verbs. `absPath` is there in store mode.
   `next` skips every spec that another **live** session on this checkout claimed, and offers the next free one. `skippedClaimed` lists each skipped spec with its `session` and `host`. Report it under BLOCKED. A **stale** claim only prints a notice and the work proceeds.
   `next` exits 1 with `status: claimed` only when every ready spec is claimed. Return `STATUS: blocked / REASON: every ready spec is claimed` and list `skippedClaimed`. Never use `--force`.
   For a batch, enumerate specs via `darius list specs --milestone <slug> --json` and inspect each via `darius show <path> --json`. Find the first `[ ]` or `[~]` item per spec. Skip `[!]` (blocked) items.

2. **Dependency gate**: For each candidate, check `depends_on` from `darius show --json`. A spec is ready only if every dependency's status is `Complete`. Record blocked-on-deps separately.

3. **Spec check and review gate** (always on since darius 0.74.0):

   For every candidate spec run the deterministic check. It uses no model:
   `!darius spec check <spec-path> --json`
   It returns `{ ok, risk, riskReasons, problems, reviewGate, reviewRequired, counsel }` and exits 0 (pass), 1 (problems) or 2 (usage).

   - **`ok: false`** → do not plan this spec. Return immediately:
     ```
     STATUS: spec_invalid
     SPEC: {path}
     PROBLEMS:
       - {each entry of problems, verbatim}
     ```
     The driver routes this to `/darius-enrich` to fix the spec, then re-plans. The checks are: every checklist item has a `Command:` and an `Expected:` in the verify grammar, or is manual (`Expected: manual (...)` or a shell no-op Command) with a `- Manual: <reason>` line; every `depends_on` target exists; a high-risk spec has a `## Rollback` section with text.
   - **`reviewRequired: false`** (low risk, or `review_gate: off`) → no review; proceed.
   - **`reviewRequired: true`** → read `counsel`, the spec's stamp:
     - `<ISO>` or `overridden` → a review stamp exists; proceed. The stamp is tied to the spec text, and `spec check` does not see a later edit. If `worklog dispatch` later refuses with "changed since its review", return `STATUS: review_required` for that spec.
     - `rejected` (no `--override`) → return `STATUS: blocked / REASON: review rejected / SPEC: {path} / TRANSCRIPT: {path}`. The driver classifies it (see `/darius-work` **Review Handling**).
     - `exhausted` (no `--override`) → return `STATUS: counsel_exhausted` and run nothing. Only `--override "<reason>"` clears it.
     - **no stamp** → the review must run, but spawning the reviewer belongs to the driver, not this forked skill. Compose a self-contained brief (goal, approach, tasks, verification, dependencies, rollback, and the files and code the spec names), readable without the spec. Return immediately:
       ```
       STATUS: review_required
       SPEC: {path}
       RISK_REASONS:
         - {pattern} ({class}) line {line}: {text}
       BRIEF: |
         {the composed brief}
       ```
   - **`--override "<reason>"`**: skip the review for this spec with the CLI:
     `!darius counsel-gate --spec <spec-path> --override "<reason>"`
     It stamps the spec and logs the reason. Refuse without a non-empty reason. Never write `counsel:`, `counsel_override:` or `counsel: addressed` into frontmatter by hand: dispatch refuses a stamp the CLI did not write.

   **Important**: the risk and the verdict are owned by the CLI, never by you. Risk comes from a fixed pattern list (`RISK_PATTERNS` in darius); frontmatter `risk: high` raises it, and nothing lowers it. Never edit a spec to make it look low risk. `review_gate: off` in `config.yml` of the tracker root skips the reviewer; the old `counsel_gate:` key, `on` or `off`, now reads as `auto`.

4. **Parallel-safety check** (batch mode only): at most one task per spec per batch. Warn if two selected specs touch overlapping file paths.

5. **Load worklog context**:
   `!darius worklog list --active --milestone <slug> --json`
   Note prior decisions, blockers, and findings from related threads. If an open thread already has the spec's `specPath`, reuse it in step 6. One thread per spec.

6. **Create worklog thread(s)**: one per selected spec, never two for the same spec:
   `!darius worklog open <milestone-slug> --spec <spec-path> --message "<task description>" --stage planned`
   Returns the generated `thread-id`. It refuses a spec another live session claimed (`--takeover` overrides; do not use it unless the user says so). A `--session` that is not this session is refused unless `--as-other-session` is given. The `--stage planned` stamp arms the Work Loop exit gate: from this moment the thread must progress (`dispatched` → `verified` → `committed` → `reviewed`) or be explicitly parked, the driving agent cannot silently end the turn on it.

   Then **claim the spec**, one per selected task, on shared checkouts:
   `!darius claim <spec-path>`
   Advisory and expiring (default TTL 8h; `--ttl`). Session id comes from `--session <id>`, else `$CLAUDE_CODE_SESSION_ID` (Claude Code sets it), else the older `$CLAUDE_SESSION_ID`, without one the claim is refused, so drop the task from the plan rather than claiming anonymously. A live claim by another session is refused naming it (`--takeover` overrides, only when the user says so); a stale one is taken over automatically with a notice. Release with `darius release <spec-path>` when the spec's work lands or is parked.

7. **Determine agent** per task by fetching the live agent roster via `darius agents --json`:
   `!darius agents --json`
   This returns an `AgentDescriptor[]` array (`{invocable, description, source}`). Match the spec's work domain to the agent whose `description` best fits. If the spec has an `agent:` frontmatter field and that agent appears in the roster, use it directly without matching. **If the roster is `[]`, there is no agent to pick.** Return `AGENT: main` and `AGENT_SELECTION: main, empty roster, the main thread does the work`. Never invent an agent.

   Embed the full roster in the TASKS output as `available_agents: [...]` at the **batch level** (once for the whole batch, not duplicated per task). This avoids redundant context window usage when batch size > 1.

   Surface the selection to the user: include a visible line in the TASKS output: `AGENT_SELECTION: <invocable>, <one-line reason why this agent's description matched>`.

8. **Return structured result**:

   Single-task:
   ```
   STATUS: ready
   BATCH_SIZE: 1
   TASKS:
     - SPEC: {tracker-relative spec path}
       SPEC_ABS_PATH: {absPath, store mode}
       MILESTONE_SLUG: {e.g. M2-api-layer}
       TASK: {checklist item description}
       THREAD_ID: {ULID-prefixed thread id}
       WORKLOG_PATH: {<trackerRoot>/worklog/{file}, trackerRoot from `darius root --json`}
       AGENT: {agent type}
       VERIFICATION:
         - command: {shell string}
           expected: {grammar form}
       PRIOR_ARTIFACTS: {paths from earlier worklog entries, or empty}
       COUNSEL_TRANSCRIPT: {<trackerRoot>/{MILESTONE}/_counsel/{spec-slug}.md, if present}
       WORKLOG_CONTEXT: {brief summary of relevant prior context}
   ```

   Batch: list each task under `TASKS:` with the same fields.

   Blocked summary (always present if non-empty):
   ```
   BLOCKED:
     - SPEC: {spec-path}  REASON: {review rejected | spec invalid | depends_on: M2-api/01-auth.md | blocked item}
   ```

If legacy v1 structure detected (flat specs at root), return `STATUS: blocked, REASON: Legacy v1 structure, run `darius doctor --fix`. Never write code, this skill only plans and prepares. The review transcript path is stable (`{MILESTONE}/_counsel/{spec-slug}.md` below the tracker root, a plain file): reference it so enrich/archive can locate transcripts without re-inferring.

**Repo-relative paths in spec files.** The envelope fields above (`SPEC_ABS_PATH`, `WORKLOG_PATH`, `COUNSEL_TRANSCRIPT`) are runtime pointers and stay absolute. But any path the implementing agent writes *into the committed spec*, `Command:`/`Expected:` lines and prose, MUST be repo-relative (e.g. `src/x.ts`), never `/home/you/repo/...`. Verification runs from the repo root and the tracker tree is shared with other hosts, so absolute paths leak the author's home-dir layout and won't run on other machines. Carry this rule into the `VERIFICATION.command` strings you emit.
