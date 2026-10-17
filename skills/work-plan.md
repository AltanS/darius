---
name: darius-work-plan
model: sonnet
context: fork
description: Find the next tracked task, check gates, and prepare context for implementation
argument-hint: "[--batch N] [--override \"<reason>\"] [--skip-commit-first]"
allowed-tools: Bash
---

# Work Plan

Plan the next task with one verb, then report it. Never write code.

$ARGUMENTS

1. Run, passing on the flags from the arguments (`--batch N`, `--override "<reason>"`, `--skip-commit-first`):
   `darius work plan --json`
   It runs the commit-first gate, `next`, the dependency gate, `spec check`, the review stamp, the worklog context, the claim, the thread (opened at `planned`, or reused) and the roster. Never add `--skip-commit-first` or `--override` on your own.
   Exit 3 means no tracker here, or a step whose output darius could not read: report stderr and stop.

2. Pick an agent for each task whose `agent` is null: the entry of `availableAgents` whose description fits the spec's work. If none fits, say so and leave it empty. `main` means an empty roster: the main thread does the work. Never invent a name.

3. Return this block, filled from the JSON. Copy values; do not read spec files.

   ```
   STATUS: {status}
   SPECS: {specs, one per line}                  # commit_first, spec_invalid
   PROBLEMS: {problems, one per line}            # spec_invalid, blocked
   SPEC / RISK_REASONS / TRANSCRIPT: {review}    # review_required, blocked, counsel_exhausted
   BATCH_SIZE: {number of tasks}
   TASKS:
     - SPEC: {spec}
       SPEC_ABS_PATH: {specAbsPath}
       MILESTONE_SLUG: {milestone}
       TASK: {task}
       THREAD_ID: {threadId}
       WORKLOG_PATH: {worklogPath}
       AGENT: {agent}
       AGENT_SELECTION: {agent}, {one-line reason}
       VERIFICATION: {verification: command and expected}
       PRIOR_ARTIFACTS: {priorArtifacts}
       COUNSEL_TRANSCRIPT: {counselTranscript}
       WORKLOG_CONTEXT: {context lines of this milestone, short}
   available_agents: {availableAgents, invocable names}
   BLOCKED:
     - SPEC: {spec}  REASON: {reason}
   WARNINGS: {warnings}
   ```

   Drop the lines that do not apply. With `status: complete`, list `pending` threads instead of TASKS.

The driver acts on STATUS: `commit_first` goes to `/darius-commit`, `spec_invalid` to `/darius-enrich`, `review_required` to one reviewer (see `/darius-work`, Review Handling). The verb claims each spec and opens its thread; release a claim with `darius release <spec>` when the work lands or is parked. Paths in specs stay repo-relative.
