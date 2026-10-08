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

$ARGUMENTS

Recognized flags:
- `--batch N` (N ≥ 2): return up to N independent tasks for parallel execution. Default returns a single task.
- `--override "<reason>"`: skip the counsel gate for blocked specs, recording the reason in worklog. Refuse without a non-empty reason.
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
   `!darius status --json`
   Identify Current Focus milestone from `currentFocus`. Then:
   `!darius next`
   For a batch, enumerate specs via `darius list specs --milestone <slug> --json` and inspect each via `darius show <path> --json`. Find the first `[ ]` or `[~]` item per spec. Skip `[!]` (blocked) items.
   `next` exits 1 when the spec it would hand out is claimed by another **live** session on this checkout (`list specs` marks those too, in text and JSON). Treat it as blocked-on-a-peer and pick different work; a **stale** claim only prints a notice and the work proceeds.

2. **Dependency gate**: For each candidate, check `depends_on` from `darius show --json`. A spec is ready only if every dependency's status is `Complete`. Record blocked-on-deps separately.

3. **Counsel gate** (opt-in, **OFF by default**):

   - **Default: skip.** Unless `.tracker/config.yml` contains `counsel_gate: on`, skip this step entirely, do not run counsel, do not stamp frontmatter. (Two milestones of production history produced zero counsel blocks; the gate is reserved for projects that opt in for high-risk work.)
   - **v9 upgrade notice (one line, first run only):** if the gate is off, no `counsel_gate:` key exists in config, AND any spec in the current milestone carries a `counsel:` stamp (evidence this project ran under v9's on-by-default gate), append to the output: `NOTE: counsel gate is now OFF by default (v10). This project has prior counsel stamps, set 'counsel_gate: on' in .tracker/config.yml to restore the old behavior.` Suppress the note once the config contains an explicit `counsel_gate:` key (either value).
   - **`--override "<reason>"`** (only meaningful when the gate is on): skip gate for this spec. Set `counsel: overridden` in frontmatter. Log a `Counsel override: <reason>` note to worklog. Refuse without a non-empty reason.

   When `counsel_gate: on`, evaluate the spec's `counsel` frontmatter:
   - `counsel: <ISO>`, `overridden`, or `addressed` → gate already passed; proceed.
   - `counsel: rejected` (and no `--override`, no `addressed`) → treat as blocked: return `STATUS: blocked / REASON: counsel rejected / SPEC: {path} / TRANSCRIPT: {path}`. The driver classifies the rejection (see `/darius-work` **Counsel Handling**) or the user runs `/darius-enrich`.
   - `counsel: exhausted` (round budget spent; no `--override`, no `addressed`) → return `STATUS: counsel_exhausted` without re-running anything, the loop is closed. Only an explicit `--override "<reason>"` or a driver `counsel: addressed` classification clears it.
   - **No `counsel` field** → counsel must run, but advisor-spawning belongs to the driving agent, not this forked skill. Compose the brief (goal, approach, tasks, verification criteria, dependencies, self-contained, readable without the spec) and return immediately:
     ```
     STATUS: counsel_required
     SPEC: {path}
     BRIEF: |
       {the composed brief}
     ```
     The driver then: (1) runs `/dev-tools:counsel --four` with the brief (advisors pinned to sonnet); (2) writes the transcript content-addressed, `BRIEF_HASH = sha256(brief)`, full transcript to `{TRACKER_ROOT}/.tracker/{MILESTONE}/_counsel/.objects/{BRIEF_HASH}.md` (frontmatter: `model`, `timestamp`, `brief_hash`, `advisors`), stable symlink `{MILESTONE}/_counsel/{spec-slug}.md → .objects/{BRIEF_HASH}.md`, old objects never deleted; (3) runs the deterministic gate:
     `darius counsel-gate {TRANSCRIPT_PATH} --spec {SPEC_PATH}`
     and acts on its `STATUS` (`ready` / `needs_ack` / `blocked` / `counsel_exhausted`) per `/darius-work` **Counsel Handling**; (4) re-invokes work-plan, which now sees the stamped frontmatter.

   **Important**: the threshold decision is owned by the CLI (`counsel_threshold:`, `max_counsel_rounds:`, `counsel_single_dissent:` in `.tracker/config.yml`), never by an LLM reading the verdicts. Earlier prompt-only thresholds (v9.6.0) were silently overridden by the model's "this looks severe → block" prior. Call the CLI, read its output, do what it says.

4. **Parallel-safety check** (batch mode only): at most one task per spec per batch. Warn if two selected specs touch overlapping file paths.

5. **Load worklog context**:
   `!darius worklog list --active --milestone <slug> --json`
   Note prior decisions, blockers, and findings from related threads.

6. **Create worklog thread(s)**: one per selected task:
   `!darius worklog open <milestone-slug> --spec <spec-path> --message "<task description>" --stage planned`
   Returns the generated `thread-id`. The `--stage planned` stamp arms the Work Loop exit gate: from this moment the thread must progress (`dispatched` → `verified` → `committed`) or be explicitly parked, the driving agent cannot silently end the turn on it.

   Then **claim the spec**, one per selected task, on shared checkouts:
   `!darius claim <spec-path>`
   Advisory and expiring (default TTL 8h; `--ttl`). Session id comes from `--session <id>`, else `$CLAUDE_CODE_SESSION_ID` (Claude Code sets it), else the older `$CLAUDE_SESSION_ID`, without one the claim is refused, so drop the task from the plan rather than claiming anonymously. A live claim by another session is refused naming it (`--takeover` overrides); a stale one is taken over automatically with a notice. Release with `darius release <spec-path>` when the spec's work lands or is parked.

7. **Determine agent** per task by fetching the live agent roster via `darius agents --json`:
   `!darius agents --json`
   This returns an `AgentDescriptor[]` array (`{invocable, description, source}`). Match the spec's work domain to the agent whose `description` best fits. If the spec has an `agent:` frontmatter field and that agent appears in the roster, use it directly without matching.

   Embed the full roster in the TASKS output as `available_agents: [...]` at the **batch level** (once for the whole batch, not duplicated per task). This avoids redundant context window usage when batch size > 1.

   Surface the selection to the user: include a visible line in the TASKS output: `AGENT_SELECTION: <invocable>, <one-line reason why this agent's description matched>`.

8. **Return structured result**:

   Single-task:
   ```
   STATUS: ready
   BATCH_SIZE: 1
   TASKS:
     - SPEC: {absolute spec path}
       MILESTONE_SLUG: {e.g. M2-api-layer}
       TASK: {checklist item description}
       THREAD_ID: {ULID-prefixed thread id}
       WORKLOG_PATH: {absolute path to .tracker/worklog/{slug}.md}
       AGENT: {agent type}
       VERIFICATION:
         - command: {shell string}
           expected: {grammar form}
       PRIOR_ARTIFACTS: {paths from earlier worklog entries, or empty}
       COUNSEL_TRANSCRIPT: {absolute path to _counsel/{spec-slug}.md, if present}
       WORKLOG_CONTEXT: {brief summary of relevant prior context}
   ```

   Batch: list each task under `TASKS:` with the same fields.

   Blocked summary (always present if non-empty):
   ```
   BLOCKED:
     - SPEC: {spec-path}  REASON: {counsel rejected | depends_on: M2-api/01-auth.md | blocked item}
   ```

If legacy v1 structure detected (flat specs at root), return `STATUS: blocked, REASON: Legacy v1 structure, run `darius doctor --fix`. Never write code, this skill only plans and prepares. Counsel sidecar path is stable: reference it by the symlink so enrich/archive can locate transcripts without re-inferring.

**Repo-relative paths in spec files.** The envelope fields above (`SPEC`, `WORKLOG_PATH`, `COUNSEL_TRANSCRIPT`) are runtime pointers and stay absolute. But any path the implementing agent writes *into the committed spec*, `Command:`/`Expected:` lines and prose, MUST be repo-relative (e.g. `src/x.ts`), never `/home/you/repo/...`. Verification runs from the repo root and `.tracker/` is shared (committed, or synced through the darius store), so absolute paths leak the author's home-dir layout and won't run on other machines. Carry this rule into the `VERIFICATION.command` strings you emit.
